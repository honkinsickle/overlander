/**
 * Reverse-geocode `[lng, lat]` → "City, ST" via Mapbox Geocoding v6.
 *
 * Server-callable (same `NEXT_PUBLIC_MAPBOX_TOKEN` as the rest of the
 * routing lib). Returns the closest named "place" (city / town) with a
 * 2-letter region code when available. Used by finalize to label
 * intermediate-day endpoints so users see "Sacramento, CA — Eugene, OR"
 * instead of "Day 2 — Day 3".
 *
 * Returns null on any failure or when no place feature is nearby. The
 * caller falls back to "Day N" labels.
 */

export type LngLat = [number, number];

const MAPBOX_REVERSE = "https://api.mapbox.com/search/geocode/v6/reverse";

type ReverseFeature = {
  properties?: {
    name?: string;
    full_address?: string;
    context?: {
      place?: { name?: string };
      region?: { name?: string; region_code?: string };
    };
  };
};

type ReverseResponse = {
  features?: ReverseFeature[];
};

export async function reverseGeocodeCity(
  coords: LngLat,
): Promise<string | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const [lng, lat] = coords;
  const url =
    `${MAPBOX_REVERSE}` +
    `?longitude=${lng}` +
    `&latitude=${lat}` +
    `&types=place` +
    `&limit=1` +
    `&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as ReverseResponse;
    const feat = json.features?.[0];
    if (!feat) return null;
    const place = feat.properties?.context?.place?.name ?? feat.properties?.name;
    if (!place) return null;
    const region =
      feat.properties?.context?.region?.region_code ??
      feat.properties?.context?.region?.name;
    return region ? `${place}, ${region}` : place;
  } catch {
    return null;
  }
}
