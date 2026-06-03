import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Maps a browse slide pill to the master_place.primary_category values
 *  the federated corridor RPC filters on.
 *
 *  NOTE: these are the ACTUAL taxonomy values emitted by the data layer
 *  (source_record.inferred_category → resolved primary_category), verified
 *  against the test DB — NOT the placeholder names in the wiring spec. The
 *  real enum uses `gas_station`/`viewpoint`/`peak`/`grocery`, not
 *  `fuel_stop`/`scenic_viewpoint`/`restaurant`/`roadside_attraction`.
 *  `restaurant` is kept as a forward-compat value (no rows yet). Pills with
 *  no federated mapping (oddity, overnight) fall through to the live path. */
export const SLIDE_TO_PRIMARY_CATEGORY: Partial<
  Record<SlideCategoryKey, string[]>
> = {
  camping: ["dispersed_camping", "campground", "recreation_area"],
  fuel: ["gas_station", "ev_charging"],
  food: ["restaurant", "grocery"],
  scenic: ["viewpoint", "peak"],
};

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
    stats: [],
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
