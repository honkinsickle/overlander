/**
 * Google polyline encoding (precision 5, ~1m resolution). Ported from
 * `scripts/prebake-routes.mjs` so server actions can encode routes for
 * storage in `Trip.routePolyline` at finalize time. Matches the
 * decoder embedded in `components/trip/map-column.tsx`.
 */

import type { LngLat } from "./route-between";

const PRECISION = 5;

/** Encode a sequence of `[lng, lat]` coords. The encoded stream is
 *  `lat,lng` per the polyline spec, so we swap here. */
export function encodePolyline(coords: LngLat[]): string {
  const factor = 10 ** PRECISION;
  const encodeNum = (n: number): string => {
    let v = n < 0 ? ~(n << 1) : n << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    s += String.fromCharCode(v + 63);
    return s;
  };

  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const [lng, lat] of coords) {
    const latI = Math.round(lat * factor);
    const lngI = Math.round(lng * factor);
    out += encodeNum(latI - prevLat) + encodeNum(lngI - prevLng);
    prevLat = latI;
    prevLng = lngI;
  }
  return out;
}
