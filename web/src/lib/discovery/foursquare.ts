import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

/**
 * Foursquare Places API (new platform: places-api.foursquare.com).
 * Free Pro tier returns the default-field set (no `fields=` param —
 * that triggers a credit-charged Premium call). Defaults include
 * name, location, geocodes, tel, website, categories — but NOT
 * photos, hours, or descriptions, so we skip those slots and let
 * Wikidata + OSM keep filling them.
 *
 * Auth: `Authorization: Bearer <FSQ_API_KEY>` plus a date-versioned
 * `X-Places-Api-Version` header. Skip with a one-time warning when
 * the key isn't set.
 *
 * The endpoint is point + radius (in meters), not bbox — same
 * conversion pattern as rec-gov.
 */
const FSQ_BASE = "https://places-api.foursquare.com/places/search";
const FSQ_API_VERSION = "2025-06-17";
const KM_PER_METER = 0.001;
const MAX_FSQ_RADIUS_M = 100_000;
const MAX_RESULTS = 50;

let warnedMissingKey = false;

/** Top-level Foursquare category IDs to scope each search. Stable
 *  across taxonomy revisions; sub-categories within these are then
 *  mapped to our slide buckets via the category-name match below. */
const FSQ_TOP_LEVEL_IDS: Record<SlideCategoryKey, string[]> = {
  food: ["4d4b7105d754a06374d81259"], // Dining and Drinking
  scenic: ["4d4b7105d754a06377d81259"], // Outdoors and Recreation
  oddity: ["4d4b7105d754a06376d81259"], // Arts and Entertainment
  camping: ["4d4b7105d754a06377d81259"], // Outdoors and Recreation
  overnight: ["4d4b7105d754a06379d81259"], // Travel and Transportation
  // Fuel intentionally empty — OSM/BLM cover gas-station coverage well
  // and Foursquare's gas-station data is sparser. Empty array short-
  // circuits in `query()` to return [].
  fuel: [],
};

/** Match a place's Foursquare sub-category names back into our
 *  slide buckets. Order matters: scan the most specific tokens first
 *  so e.g. "Mountain Hut" doesn't get pulled into scenic by the
 *  "mountain" rule before camping/overnight have a chance. */
function categoryForFsqPlace(
  cats: FsqPlace["categories"] | undefined,
  wanted: Set<SlideCategoryKey>,
): SlideCategoryKey | null {
  if (!cats?.length) return null;
  const names = cats.map((c) => (c.name || "").toLowerCase()).join(" | ");

  if (wanted.has("camping") && /\b(campground|rv park|caravan)\b/.test(names)) {
    return "camping";
  }
  if (
    wanted.has("overnight") &&
    /\b(hotel|motel|inn|hostel|lodge|bed.and.breakfast|b&b|cabin)\b/.test(names)
  ) {
    return "overnight";
  }
  if (
    wanted.has("food") &&
    /\b(restaurant|cafe|café|coffee|bar|pub|brewery|bakery|diner|deli|food court|ice cream|tea)\b/
      .test(names)
  ) {
    return "food";
  }
  if (
    wanted.has("oddity") &&
    /\b(museum|historic|monument|memorial|gallery|theater|theatre|landmark|artwork)\b/
      .test(names)
  ) {
    return "oddity";
  }
  if (
    wanted.has("scenic") &&
    /\b(scenic lookout|viewpoint|overlook|mountain|hot spring|waterfall|trail|park|garden|forest|natural|geological|lake|river)\b/
      .test(names)
  ) {
    return "scenic";
  }
  return null;
}

type FsqCategory = { fsq_category_id: string; name: string };
type FsqLocation = {
  address?: string;
  locality?: string;
  region?: string;
  postcode?: string;
  formatted_address?: string;
};
type FsqPlace = {
  fsq_place_id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  location?: FsqLocation;
  tel?: string;
  website?: string;
  email?: string;
  categories?: FsqCategory[];
};
type FsqResponse = { results?: FsqPlace[]; message?: string };

export const foursquareSource: WaypointSource = {
  id: "foursquare",
  async query({ bbox, categories, signal }) {
    const apiKey = process.env.FSQ_API_KEY;
    if (!apiKey) {
      if (!warnedMissingKey) {
        console.warn(
          "[foursquare] FSQ_API_KEY not set in web/.env.local — skipping " +
            "Foursquare source. Get a free key at " +
            "https://foursquare.com/developers/",
        );
        warnedMissingKey = true;
      }
      return [];
    }

    const wanted = new Set(categories);
    const fsqCategoryIds = Array.from(
      new Set(categories.flatMap((c) => FSQ_TOP_LEVEL_IDS[c] ?? [])),
    );
    if (fsqCategoryIds.length === 0) return [];

    const [w, s, e, n] = bbox;
    const centerLng = (w + e) / 2;
    const centerLat = (s + n) / 2;
    const halfDiagKm = haversineKm([w, s], [centerLng, centerLat]);
    const radiusM = Math.min(halfDiagKm / KM_PER_METER, MAX_FSQ_RADIUS_M);

    const url =
      `${FSQ_BASE}?` +
      new URLSearchParams({
        ll: `${centerLat},${centerLng}`,
        radius: Math.round(radiusM).toString(),
        fsq_category_ids: fsqCategoryIds.join(","),
        limit: MAX_RESULTS.toString(),
      }).toString();

    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-places-api-version": FSQ_API_VERSION,
        authorization: `Bearer ${apiKey}`,
      },
      signal,
    });
    if (!res.ok) {
      // Surface the body so credit / auth errors are debuggable.
      const body = await res.text().catch(() => "");
      console.warn(
        `[foursquare] HTTP ${res.status} ${body.slice(0, 200)}`,
      );
      return [];
    }
    const json = (await res.json()) as FsqResponse;
    const places = json.results ?? [];
    return places.flatMap((p) => placeToSourceResult(p, wanted));
  },
};

function placeToSourceResult(
  p: FsqPlace,
  wanted: Set<SlideCategoryKey>,
): SourceResult[] {
  const lat = p.latitude;
  const lng = p.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return [];
  if (!p.name?.trim()) return [];
  const category = categoryForFsqPlace(p.categories, wanted);
  if (!category) return [];

  return [
    {
      sourceId: "foursquare",
      externalId: `fsq/${p.fsq_place_id}`,
      coords: [lng, lat],
      category,
      title: p.name.trim(),
      address:
        p.location?.formatted_address ?? composeAddress(p.location),
      phone: p.tel,
      website: p.website,
      raw: p as unknown as Record<string, unknown>,
    },
  ];
}

function composeAddress(loc?: FsqLocation): string | undefined {
  if (!loc) return undefined;
  return [loc.address, loc.locality, loc.region, loc.postcode]
    .filter(Boolean)
    .join(", ");
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}
