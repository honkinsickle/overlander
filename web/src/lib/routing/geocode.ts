/**
 * Forward-geocode a freeform place label to `[lng, lat]` via the
 * Mapbox Geocoding API. Server-callable (uses the same
 * `NEXT_PUBLIC_MAPBOX_TOKEN` env var as route-between.ts).
 *
 * Single best match only — `limit=1`. The label is what the user
 * typed into the wizard's going step; if their text is ambiguous
 * ("Springfield") we accept whatever Mapbox decides is the strongest
 * match. Phase B adds an autocomplete picker that bakes coords in at
 * selection time, eliminating the ambiguity.
 */

export type LngLat = [number, number];

export class GeocodeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";

export async function geocode(label: string): Promise<LngLat> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new GeocodeError("geocode requires a non-empty label");
  }
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    throw new GeocodeError("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
  }

  const url =
    `${MAPBOX_GEOCODE}` +
    `?q=${encodeURIComponent(trimmed)}` +
    `&limit=1` +
    `&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new GeocodeError(`Mapbox Geocoding HTTP ${res.status}`, res.status);
  }

  const json = (await res.json()) as MapboxGeocodingResponse;
  const feature = json.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords || coords.length < 2) {
    throw new GeocodeError(`No geocoding results for "${trimmed}"`);
  }
  return [coords[0], coords[1]];
}

type MapboxGeocodingResponse = {
  features?: {
    geometry?: { coordinates?: number[] };
  }[];
};
