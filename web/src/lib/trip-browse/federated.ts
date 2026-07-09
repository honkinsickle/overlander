import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SupabaseClient } from "@supabase/supabase-js";

/** THE canonical map: browse slide bucket → the master_place.primary_category
 *  values it owns. Single source of truth for BOTH the federated corridor RPC
 *  (which filters on these) AND the find-nearby tile fanout (which keys in via
 *  `browseCategoryToSlide`). The two used to diverge — this map reconciles them.
 *
 *  Values are the ACTUAL taxonomy emitted by the data layer
 *  (source_record.inferred_category → resolved primary_category), assigned by
 *  best fit across the full 90-value prod vocabulary. `interest` owns the
 *  residual — anything not cleanly another bucket — and is the same target as
 *  the `?? "interest"` default for future-unknown values. A handful of
 *  zero-row forward-compat values (museum/art_gallery/historical_landmark →
 *  attraction; roadside_attraction → oddity) are kept so those buckets query
 *  something the moment such rows appear. */
export const SLIDE_TO_PRIMARY_CATEGORY: Record<SlideCategoryKey, string[]> = {
  // Real camping place types only. Standalone amenities (dump_station, water,
  // toilet, …) are NOT here — they're suppressed from browse entirely (see
  // SUPPRESSED_PRIMARY_CATEGORIES below), not cards in their own right.
  camping: [
    "dispersed_camping", "campground", "recreation_area", "facility",
    "rv_park", "camping_cabin",
  ],
  fuel: ["gas_station", "ev_charging", "truck_stop"],
  food: [
    "restaurant", "grocery", "grocery_store", "cafe", "diner",
    "fast_food_restaurant", "italian_restaurant", "mexican_restaurant",
    "american_restaurant", "bar_and_grill", "breakfast_restaurant",
    "chicken_restaurant", "hamburger_restaurant", "pizza_restaurant",
    "steak_house", "brazilian_restaurant", "brewpub", "chinese_restaurant",
    "family_restaurant", "fine_dining_restaurant", "french_restaurant",
    "gastropub", "indian_restaurant", "sandwich_shop", "taco_restaurant",
  ],
  scenic: [
    "viewpoint", "peak", "trailhead", "park", "beach", "lake", "hiking_area",
    "mountain_peak", "natural_feature", "river", "national_park", "state_park",
    "scenic_spot", "spring",
    // decision B — park_feature (3168, 24%) is mixed natural/interpretive but
    // unsplittable by primary_category; → scenic preserves today's behavior.
    "park_feature",
  ],
  overnight: ["hotel", "resort_hotel", "motel"],
  // attraction: the formal cultural set only.
  attraction: [
    "visitor_center", "national_historic_site", "landmark",
    // forward-compat (0 rows today)
    "museum", "art_gallery", "historical_landmark",
  ],
  urban: ["shopping_mall", "city_park"],
  // oddity: roadside / generic attractions. `tourist_attraction` (generic POI
  // attraction) lives here, NOT in the formal-cultural `attraction` bucket.
  oddity: ["roadside_attraction", "tourist_attraction"],
  // interest: the residual — every primary_category not cleanly another bucket.
  interest: [
    "rest_area", "activity_pass", "unknown", "permit", "hardware",
    "park_boundary", "outdoor_gear", "ticket_facility", "casino",
    "timed_entry", "venue_reservations", "car_repair", "car_wash", "marina",
    "tree_permit", "atm", "bus_stop", "government_office", "kiosk", "library",
    "national_fish_hatchery", "point_of_interest", "sports_activity_location",
    "amphitheatre", "mobile_home_park",
  ],
};

/** Standalone amenity primary_categories — infrastructure (dump station,
 *  potable water, vault toilet, …), not destinations. SUPPRESSED from browse:
 *  filtered out at the corpus→card boundary (hydratePlacesByIds) so they never
 *  render as their own cards and never fall to the `interest` default. Kept out
 *  of SLIDE_TO_PRIMARY_CATEGORY so no pill/RPC queries them. (Returning the
 *  PARENT campsite for an amenity search is a separate future feature; for now
 *  amenity search yields nothing.) */
export const SUPPRESSED_PRIMARY_CATEGORIES: ReadonlySet<string> = new Set([
  "dump_station", "water", "toilet", "fire_pit", "shower",
  "picnic_area", "picnic_ground",
]);

export function isSuppressedCategory(primary: string): boolean {
  return SUPPRESSED_PRIMARY_CATEGORIES.has(primary);
}

/** Inverse of SLIDE_TO_PRIMARY_CATEGORY: maps a data-layer primary_category
 *  back to the slide bucket it belongs to. Built once from the forward map so
 *  the two never drift. Used by the corpus-wide search hydrate path (arbitrary
 *  primary_category values) to choose each card's palette/icon. A
 *  primary_category not in ANY bucket (a future-new value) falls back to
 *  `interest` — the honest "uncategorized" bucket (was `scenic`). The real
 *  category name still surfaces as a pill via prettyCategory(), so the
 *  fallback only affects accent color/icon. */
const PRIMARY_CATEGORY_TO_SLIDE: Record<string, SlideCategoryKey> =
  Object.entries(SLIDE_TO_PRIMARY_CATEGORY).reduce(
    (acc, [slide, primaries]) => {
      for (const p of primaries ?? []) acc[p] = slide as SlideCategoryKey;
      return acc;
    },
    {} as Record<string, SlideCategoryKey>,
  );

export function primaryCategoryToSlideKey(primary: string): SlideCategoryKey {
  return PRIMARY_CATEGORY_TO_SLIDE[primary] ?? "interest";
}

/** One row from public.pois_along_corridor (SECURITY DEFINER RPC). */
export type MasterPlaceRow = {
  id: string;
  canonical_name: string;
  primary_category: string;
  lng: number;
  lat: number;
  prominence_score: number;
  mvum_corridor: boolean | null;
  overlander_tags: string[] | null;
  amenities: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  access: Record<string, unknown> | null;
  services: Record<string, unknown> | null;
  capacity: Record<string, unknown> | null;
  seasonality: Record<string, unknown> | null;
  cell_signal: Record<string, unknown> | null;
  geometry_polygon: Record<string, unknown> | null;
  description: string | null;
  attribution: Record<string, string> | null;
  /** Linked google source_record place_id (external_id sans 'google:'), or
   *  null when this master_place has no google source. The hydrate key.
   *  Optional: the corridor RPC surfaces it (via a join); the by-id search
   *  hydrate path (hydrate.ts) doesn't, and doesn't need it. */
  google_place_id?: string | null;
};

function prettyCategory(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Project a federated master_place row into the BrowsePlace shape the
 *  panel already renders — no UI changes needed. Carries the enriched
 *  provenance/legality fields (mvumCorridor, attribution, overlanderTags)
 *  through untouched so we can confirm they arrive end-to-end even before
 *  the card renders them. `source: 'master_place'` makes federated rows
 *  visibly distinguishable in the panel. */
export function mapMasterPlaceRow(
  row: MasterPlaceRow,
  slideKey: SlideCategoryKey,
): BrowsePlace {
  const sources = row.attribution
    ? Array.from(new Set(Object.values(row.attribution)))
    : [];
  const contact = (row.contact ?? {}) as {
    phone?: string;
    website?: string;
    address?: string;
  };
  // master_place.hours is `{ raw: <value> }`. Surface a HOURS stat — the
  // same shape the live path emits — ONLY when raw is a clean string
  // (OSM `opening_hours`, "24/7", etc). The NPS array shape (per-day
  // standardHours + exceptions) needs a dedicated formatter to render
  // without misrepresenting closures, so it's omitted here, not garbled.
  const hoursRaw = (row.hours as { raw?: unknown } | null)?.raw;
  const hoursStat =
    typeof hoursRaw === "string" && hoursRaw.trim().length > 0
      ? [{ label: "HOURS", value: hoursRaw.trim() }]
      : [];
  return {
    // Prefix avoids any id collision with live (OSM/RIDB) results so the
    // additive merge never dedupes a federated row against a live one.
    id: `mp:${row.id}`,
    coords: [row.lng, row.lat],
    category: slideKey,
    photoAlt: row.canonical_name,
    title: row.canonical_name,
    pills: [
      { label: prettyCategory(row.primary_category) },
      ...(row.mvum_corridor ? [{ label: "MVUM corridor", status: true }] : []),
    ],
    stats: hoursStat,
    mention: {
      primary: sources.length > 0 ? "Federated from" : "Federated",
      secondary: sources.join(" · "),
    },
    description:
      row.description ??
      `${row.canonical_name} — ${prettyCategory(row.primary_category)}.`,
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: {
      address: typeof contact.address === "string" ? contact.address : "",
      ...(typeof contact.phone === "string"
        ? { phone: { display: contact.phone, href: `tel:${contact.phone}` } }
        : {}),
      ...(typeof contact.website === "string"
        ? {
            website: {
              display: contact.website.replace(/^https?:\/\//, ""),
              href: contact.website,
            },
          }
        : {}),
    },
    cta: "Add to day",
    source: "master_place",
    mvumCorridor: row.mvum_corridor,
    attribution: row.attribution,
    overlanderTags: row.overlander_tags,
    // Hydrate key: present only when a google source backs this place.
    ...(row.google_place_id ? { placeId: row.google_place_id } : {}),
  };
}

/** Fetch federated corridor POIs for one slide pill via the SECURITY
 *  DEFINER RPC (granted EXECUTE to anon, so the web anon+JWT client may
 *  call it). Builds the SAME straight day-segment LineString the
 *  client-side pointToPolylineMi filter uses (start→end) — exact parity
 *  with the current corridor, not the real per-day polyline (deferred).
 *
 *  Returns [] for pills with no federated mapping, and — critically — []
 *  on ANY error, so the browse panel falls back to the live path and never
 *  breaks because the RPC failed. */
export async function fetchFederatedPois(args: {
  supabase: SupabaseClient;
  slideKey: SlideCategoryKey;
  start: [number, number];
  end: [number, number];
  bufferMeters?: number;
  signal?: AbortSignal;
}): Promise<BrowsePlace[]> {
  const categories = SLIDE_TO_PRIMARY_CATEGORY[args.slideKey];
  if (!categories) return [];
  const p_route = {
    type: "LineString",
    coordinates: [args.start, args.end],
  };
  try {
    const query = args.supabase.rpc("pois_along_corridor", {
      p_route,
      p_buffer_m: args.bufferMeters ?? 16000,
      p_categories: categories,
    });
    const { data, error } = args.signal
      ? await query.abortSignal(args.signal)
      : await query;
    if (error) throw error;
    return ((data ?? []) as MasterPlaceRow[]).map((r) =>
      mapMasterPlaceRow(r, args.slideKey),
    );
  } catch (err) {
    console.warn(
      `[federated-pois] ${args.slideKey} RPC failed, falling back to live:`,
      err,
    );
    return [];
  }
}
