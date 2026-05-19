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
const MAX_RESULTS = 20;
const MAX_RADIUS_M = 50_000;

/** Google "type" → our slide bucket. Pulled from
 *  https://developers.google.com/maps/documentation/places/web-service/place-types
 *  Each `includedTypes` array is what we send to Google; the inverse
 *  mapping below (`categoryForGoogleTypes`) decides which bucket each
 *  returned place lands in. */
const TYPES_BY_CATEGORY: Record<SlideCategoryKey, string[]> = {
  food: ["restaurant", "cafe", "bar", "bakery"],
  scenic: ["tourist_attraction", "park", "national_park"],
  oddity: ["museum", "art_gallery", "historical_landmark"],
  camping: ["campground", "rv_park"],
  overnight: ["lodging", "hotel"],
  fuel: ["gas_station"],
};

/** Pre-joined FieldMask. Google charges by tier based on which fields
 *  are requested; this set covers card render needs without pulling
 *  in the priciest atomic fields (reviews, contact verifications). */
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
].join(",");

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
};

function placeToSourceResult(
  p: GooglePlace,
  wanted: Set<SlideCategoryKey>,
): SourceResult[] {
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  const title = p.displayName?.text?.trim();
  if (typeof lat !== "number" || typeof lng !== "number" || !title) return [];

  const category = categoryForGoogleTypes(p.types ?? [], wanted);
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
    wanted.has("oddity") &&
    ["museum", "art_gallery", "historical_landmark"].some((x) => t.has(x))
  ) {
    return "oddity";
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
