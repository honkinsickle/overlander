import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

/**
 * Google Places API (New). Nearby Search returns names, location, types,
 * photo references, address, website, phone, and weekday hours in one
 * call — significantly fewer round-trips than the OSM + Wikipedia +
 * Mapillary cascade gives us. Photos come back as references; the
 * actual image bytes need the API key, so the URL we emit routes
 * through `/api/places/photo?ref=...` which proxies with the key.
 *
 * Auth: `X-Goog-Api-Key` header (NOT a query param). Skip with a one-
 * time warning when the key isn't set so dev works without billing
 * being enabled.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/search-nearby
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MAX_RESULTS = 20;
const MAX_RADIUS_M = 50_000;

/** Every slide bucket — the `wanted` set the text-search mapper uses so a
 *  free-text result lands in whatever bucket its Google types imply. */
const ALL_SLIDE_CATEGORIES: SlideCategoryKey[] = [
  "food",
  "scenic",
  "oddity",
  "attraction",
  "camping",
  "overnight",
  "fuel",
];

/** Google "type" → our slide bucket. Pulled from
 *  https://developers.google.com/maps/documentation/places/web-service/place-types
 *  Each `includedTypes` array is what we send to Google; the inverse
 *  mapping below (`categoryForGoogleTypes`) decides which bucket each
 *  returned place lands in. */
const TYPES_BY_CATEGORY: Record<SlideCategoryKey, string[]> = {
  food: ["restaurant", "cafe", "bar", "bakery"],
  scenic: ["tourist_attraction", "park", "national_park"],
  // Formal cultural set → attraction (mirrors the federated corpus split).
  // Moved out of oddity so museums/galleries/landmarks stop rendering as
  // roadside oddities. Google has no roadside-quirky type of its own, so
  // oddity is served live by OSM (artwork, arts_centre, historic markers)
  // and Foursquare instead.
  attraction: ["museum", "art_gallery", "historical_landmark"],
  oddity: [],
  camping: ["campground", "rv_park"],
  overnight: ["lodging", "hotel"],
  fuel: ["gas_station"],
  // Corpus-backed (federated) buckets — no live Google Places fanout.
  interest: [],
  urban: [],
};

/** Pre-joined FieldMask. Google charges by tier based on which fields
 *  are requested; rating/userRatingCount/priceLevel are Pro-tier fields
 *  (a deliberate SKU bump) so the card can show REAL ratings/price
 *  instead of fabricated ones. */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.types",
  "places.photos",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

/** Places API v1 `priceLevel` is an enum string. Map the four paid tiers
 *  to a 1–4 scale ($–$$$$). PRICE_LEVEL_FREE and PRICE_LEVEL_UNSPECIFIED
 *  (and absent) → undefined: the card shows a $-tier only for a real paid
 *  signal, never a fabricated one. */
const PRICE_LEVEL_TIER: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function priceLevelToTier(level?: string): 1 | 2 | 3 | 4 | undefined {
  return level ? PRICE_LEVEL_TIER[level] : undefined;
}

let warnedMissingKey = false;

export const googlePlacesSource: WaypointSource = {
  id: "google",
  async query({ bbox, categories, signal }) {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      if (!warnedMissingKey) {
        console.warn(
          "[google-places] GOOGLE_PLACES_API_KEY not set in web/.env.local — " +
            "skipping Google Places. Enable Places API (New) and create a key " +
            "at https://console.cloud.google.com/google/maps-apis/",
        );
        warnedMissingKey = true;
      }
      return [];
    }

    const includedTypes = Array.from(
      new Set(categories.flatMap((c) => TYPES_BY_CATEGORY[c] ?? [])),
    );
    if (includedTypes.length === 0) return [];

    const [w, s, e, n] = bbox;
    const centerLat = (s + n) / 2;
    const centerLng = (w + e) / 2;
    const radius = Math.min(halfDiagMeters(bbox), MAX_RADIUS_M);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: MAX_RESULTS,
        locationRestriction: {
          circle: {
            center: { latitude: centerLat, longitude: centerLng },
            radius,
          },
        },
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[google-places] HTTP ${res.status} ${body.slice(0, 200)}`,
      );
      return [];
    }

    const json = (await res.json()) as { places?: GooglePlace[] };
    const wanted = new Set(categories);
    return (json.places ?? []).flatMap((p) => placeToSourceResult(p, wanted));
  },
};

/**
 * Google Places `searchText` (v1) — the free-text path for the top-level
 * "search for anything". Same auth, same FieldMask, same response shape as
 * `searchNearby` (so results render through the identical card), but driven
 * by a `textQuery` and bounded to the viewport via
 * `locationRestriction.rectangle`. Ignores `categories`; activates ONLY when
 * `textQuery` is present, so it's inert in the category-tile fanout.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
export const googleTextSearchSource: WaypointSource = {
  id: "google",
  async query({ bbox, textQuery, signal }) {
    const q = textQuery?.trim();
    if (!q) return [];

    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      if (!warnedMissingKey) {
        console.warn(
          "[google-places] GOOGLE_PLACES_API_KEY not set in web/.env.local — " +
            "skipping Google text search.",
        );
        warnedMissingKey = true;
      }
      return [];
    }

    const [w, s, e, n] = bbox;
    const res = await fetch(TEXT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: q,
        maxResultCount: MAX_RESULTS,
        locationRestriction: {
          rectangle: {
            low: { latitude: s, longitude: w },
            high: { latitude: n, longitude: e },
          },
        },
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[google-places] searchText HTTP ${res.status} ${body.slice(0, 200)}`,
      );
      return [];
    }

    const json = (await res.json()) as { places?: GooglePlace[] };
    // Free-text wants any bucket — pass ALL slide categories so the mapper
    // assigns each result whatever its Google types imply (falling back to
    // a neutral bucket below rather than dropping unbucketed businesses).
    const wanted = new Set(ALL_SLIDE_CATEGORIES);
    return (json.places ?? []).flatMap((p) =>
      placeToSourceResult(p, wanted, "scenic"),
    );
  },
};

// ── helpers ───────────────────────────────────────────────────────────

type GooglePlace = {
  id: string;
  displayName?: { text: string; languageCode?: string };
  location?: { latitude: number; longitude: number };
  types?: string[];
  /** Reference name like "places/<id>/photos/<photoId>". Fetched via
   *  our `/api/places/photo` proxy so the API key stays server-side. */
  photos?: Array<{ name: string }>;
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  /** Average rating 1.0–5.0. */
  rating?: number;
  /** Total number of user ratings backing `rating`. */
  userRatingCount?: number;
  /** Enum string: PRICE_LEVEL_FREE / _INEXPENSIVE / _MODERATE /
   *  _EXPENSIVE / _VERY_EXPENSIVE / _UNSPECIFIED. */
  priceLevel?: string;
};

// ── Place Details (v1) — corridor tile hydrate-by-place_id ────────────────

/** The volatile "rich" fields the corridor tile grafts onto an essentials
 *  tile at day-select. NEVER persisted. */
export type PlaceRich = {
  rating?: number;
  reviewCount?: number;
  priceTier?: 1 | 2 | 3 | 4;
  /** Routed through /api/places/photo (key stays server-side). */
  photoUrl?: string;
  hours?: string;
};

/** Single-place RICH field mask — MATCHES the browse discovery field set
 *  exactly (rating / userRatingCount / photos / hours / priceLevel), no
 *  broader. No "places." prefix: Place Details returns the place resource
 *  directly, not a `places[]` wrapper. */
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "rating",
  "userRatingCount",
  "priceLevel",
  "photos",
  "regularOpeningHours.weekdayDescriptions",
].join(",");

/** Live Google Place Details for one place_id — the corridor tile hydrate.
 *  Same auth + rich field set + photo proxy as the browse discovery path;
 *  returns ONLY the volatile fields to graft. NEVER persisted (callers hold
 *  it in a short ephemeral cache, same as browse). Returns null on missing
 *  key, network error, or non-OK response, so the caller keeps essentials.
 *
 *  Docs: https://developers.google.com/maps/documentation/places/web-service/place-details */
export async function placeDetails(
  placeId: string,
  signal?: AbortSignal,
): Promise<PlaceRich | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    if (!warnedMissingKey) {
      console.warn(
        "[google-places] GOOGLE_PLACES_API_KEY not set — skipping placeDetails.",
      );
      warnedMissingKey = true;
    }
    return null;
  }

  let res: Response;
  try {
    res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        },
        signal,
      },
    );
  } catch {
    return null; // network/abort → caller keeps essentials
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[google-places] placeDetails HTTP ${res.status} ${body.slice(0, 160)}`,
    );
    return null;
  }

  const p = (await res.json()) as GooglePlace;
  const photoRef = p.photos?.[0]?.name;
  const tier = priceLevelToTier(p.priceLevel);
  return {
    ...(typeof p.rating === "number" ? { rating: p.rating } : {}),
    ...(typeof p.userRatingCount === "number"
      ? { reviewCount: p.userRatingCount }
      : {}),
    ...(tier ? { priceTier: tier } : {}),
    ...(photoRef
      ? { photoUrl: `/api/places/photo?ref=${encodeURIComponent(photoRef)}` }
      : {}),
    ...(p.regularOpeningHours?.weekdayDescriptions?.length
      ? { hours: p.regularOpeningHours.weekdayDescriptions.join("; ") }
      : {}),
  };
}

function placeToSourceResult(
  p: GooglePlace,
  wanted: Set<SlideCategoryKey>,
  /** Free-text path only: bucket to assign when the Google types match no
   *  `wanted` category, so a real business isn't dropped for lacking a
   *  bucketable type. Omitted on the category fanout (drop = correct there,
   *  the place didn't match the requested category). */
  fallback?: SlideCategoryKey,
): SourceResult[] {
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  const title = p.displayName?.text?.trim();
  if (typeof lat !== "number" || typeof lng !== "number" || !title) return [];

  const category = categoryForGoogleTypes(p.types ?? [], wanted) ?? fallback;
  if (!category) return [];

  const photoRef = p.photos?.[0]?.name;
  const photoUrl = photoRef
    ? `/api/places/photo?ref=${encodeURIComponent(photoRef)}`
    : undefined;

  return [
    {
      sourceId: "google",
      externalId: `gpl/${p.id}`,
      coords: [lng, lat],
      category,
      title,
      photoUrl,
      address: p.formattedAddress,
      website: p.websiteUri,
      phone: p.nationalPhoneNumber,
      openingHours: p.regularOpeningHours?.weekdayDescriptions?.join("; "),
      // Real Google ratings/price — only set when Google actually returned
      // them (a place with no ratings yet omits both).
      ...(typeof p.rating === "number" ? { rating: p.rating } : {}),
      ...(typeof p.userRatingCount === "number"
        ? { reviewCount: p.userRatingCount }
        : {}),
      ...(priceLevelToTier(p.priceLevel)
        ? { priceTier: priceLevelToTier(p.priceLevel) }
        : {}),
      raw: p as unknown as Record<string, unknown>,
    },
  ];
}

/** Most specific first — "park" overlaps with "campground" on Google,
 *  and we want a campground site to land in camping not scenic. */
function categoryForGoogleTypes(
  types: string[],
  wanted: Set<SlideCategoryKey>,
): SlideCategoryKey | null {
  const t = new Set(types);
  if (wanted.has("camping") && (t.has("campground") || t.has("rv_park"))) {
    return "camping";
  }
  if (wanted.has("overnight") && (t.has("lodging") || t.has("hotel"))) {
    return "overnight";
  }
  if (wanted.has("fuel") && t.has("gas_station")) return "fuel";
  if (
    wanted.has("food") &&
    ["restaurant", "cafe", "bar", "bakery"].some((x) => t.has(x))
  ) {
    return "food";
  }
  if (
    wanted.has("attraction") &&
    ["museum", "art_gallery", "historical_landmark"].some((x) => t.has(x))
  ) {
    return "attraction";
  }
  if (
    wanted.has("scenic") &&
    ["tourist_attraction", "park", "national_park"].some((x) => t.has(x))
  ) {
    return "scenic";
  }
  return null;
}

/** Equirectangular approximation — accurate enough at the bbox scales
 *  we hand to discovery (<100 km diag). Saves a haversine import. */
function halfDiagMeters(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const cy = (s + n) / 2;
  const dxKm = (e - w) * 111.32 * Math.cos((cy * Math.PI) / 180);
  const dyKm = (n - s) * 110.574;
  return (Math.sqrt(dxKm * dxKm + dyKm * dyKm) / 2) * 1000;
}
