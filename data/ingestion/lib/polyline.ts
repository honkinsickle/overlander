/**
 * Google polyline5 decoder.
 *
 * Pure-function port of the standard Google polyline algorithm
 * (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
 *
 * Used by deploy-corridor.ts to decode the pre-baked LA→Deadhorse
 * polyline from web/src/lib/trips/alaska-route.ts. Inline rather than
 * imported as a dep to avoid adding `@mapbox/polyline` for ~20 lines
 * of code (CLAUDE.md "Don't introduce a new dependency without
 * justifying it").
 *
 * Returns [lng, lat] pairs to match the GeoJSON / project-wide
 * coordinate convention.
 */

/**
 * Decode a polyline5-encoded string into an array of [lng, lat] coords.
 *
 * @param encoded — polyline5-encoded string
 * @param precision — coordinate precision; default 5 (Google standard)
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: [number, number][] = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

/**
 * Naive stride-based downsample to ~targetCount points. Picks every
 * Nth coordinate; preserves first and last. Good enough for the
 * corridor LineString stored in `ingestion_corridor.geometry` — the
 * 80km buffer renders sub-km resolution irrelevant.
 *
 * Stable: same input yields same output.
 */
export function downsample<T>(coords: T[], targetCount: number): T[] {
  if (coords.length <= targetCount) return coords;
  const stride = Math.ceil(coords.length / targetCount);
  const out: T[] = [];
  for (let i = 0; i < coords.length; i += stride) {
    const point = coords[i];
    if (point !== undefined) out.push(point);
  }
  const last = coords[coords.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
}
