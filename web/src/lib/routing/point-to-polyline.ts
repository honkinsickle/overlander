/**
 * Google-encoded polyline (precision 5) decode + point-to-polyline distance.
 *
 * Shared between MapColumn (client-side route render) and the
 * trip-browse API route (server-side route-corridor filter).
 */

const FACTOR = 1e5;
const EARTH_KM = 6371;
const KM_PER_MI = 1.609344;

export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lng / FACTOR, lat / FACTOR]);
  }
  return out;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.sqrt(h));
}

/** Equirectangular projection around `ref` — returns local (x, y) in km.
 *  Cheap, single-trig per axis, accurate enough at sub-100km scales. */
function project(
  point: [number, number],
  ref: [number, number],
): [number, number] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(ref[1]));
  const x = toRad(point[0] - ref[0]) * cosLat * EARTH_KM;
  const y = toRad(point[1] - ref[1]) * EARTH_KM;
  return [x, y];
}

/** Min distance (miles) from `point` to any segment of `path`.
 *  `path` may be either an encoded Google polyline (string) or a
 *  pre-decoded coordinate array. Returns Infinity for an empty or
 *  malformed path so callers can treat it as "no corridor". */
export function pointToPolylineMi(
  point: [number, number],
  path: string | [number, number][],
): number {
  if (!path) return Infinity;
  const coords = typeof path === "string" ? decodePolyline(path) : path;
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineKm(point, coords[0]) / KM_PER_MI;

  let minKm = Infinity;
  // Project everything around the query point — distortion is small
  // over a single day's leg (<800km typical) and avoids per-segment
  // haversine cost.
  const p = project(point, point);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = project(coords[i], point);
    const b = project(coords[i + 1], point);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) {
      t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = a[0] + t * abx;
    const cy = a[1] + t * aby;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km < minKm) minKm = km;
  }
  return minKm / KM_PER_MI;
}

export function haversineMi(
  a: [number, number],
  b: [number, number],
): number {
  return haversineKm(a, b) / KM_PER_MI;
}

/** Same projection math as `pointToPolylineMi`, but returns the closest
 *  point on the polyline (back-projected to lng/lat) along with the
 *  distance. Used by snap-to-route for the user-location marker. */
export function projectPointToPolyline(
  point: [number, number],
  path: string | [number, number][],
): { coord: [number, number]; distanceMi: number } | null {
  if (!path) return null;
  const coords = typeof path === "string" ? decodePolyline(path) : path;
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return {
      coord: coords[0],
      distanceMi: haversineKm(point, coords[0]) / KM_PER_MI,
    };
  }

  let minKm = Infinity;
  let bestCx = 0;
  let bestCy = 0;
  const p = project(point, point);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = project(coords[i], point);
    const b = project(coords[i + 1], point);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) {
      t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = a[0] + t * abx;
    const cy = a[1] + t * aby;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km < minKm) {
      minKm = km;
      bestCx = cx;
      bestCy = cy;
    }
  }
  // Inverse equirectangular: ref point was `point` itself, so cx/cy are
  // km offsets from there. Convert back to degrees and add to point.
  const cosLat = Math.cos((point[1] * Math.PI) / 180);
  const degPerRad = 180 / Math.PI;
  const projLng =
    point[0] + (bestCx / (cosLat * EARTH_KM)) * degPerRad;
  const projLat = point[1] + (bestCy / EARTH_KM) * degPerRad;
  return { coord: [projLng, projLat], distanceMi: minKm / KM_PER_MI };
}
