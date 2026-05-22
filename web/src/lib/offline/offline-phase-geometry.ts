/**
 * Phase geometry + Web Mercator tile enumeration.
 *
 * Three exports:
 *  - computePhaseGeometry: collect the coords + bbox for a phase
 *  - enumerateTiles: list {z,x,y} tiles covering a buffered bbox
 *  - hashPhasePolyline: deterministic hash for drift detection
 *
 * No external dependencies. Buffer math uses the standard
 * ~69 mi/degree-latitude approximation; tile selection doesn't need
 * sub-mile precision since tiles are ~1.5 mi square at z=14 even at
 * the equator and a 25 mi buffer is generous compared to the
 * driving corridor itself.
 */

import { decodePolyline } from "@/lib/routing/point-to-polyline";
import type { OfflinePhase, Trip } from "@/lib/trips/types";
import { fnv1a32 } from "./hash";

type Coord = [number, number]; // [lng, lat]
type Bbox = [number, number, number, number]; // [west, south, east, north]

const MI_PER_DEG_LAT = 69; // standard approximation, good to ~0.5%
// Web Mercator clamps latitude to ±85.0511° — beyond that the tile-Y
// formula explodes (tan(±90°) is infinite). Our corridor maxes out
// around 70°N, but clamp defensively so callers can pass any bbox.
const MERC_LAT_MAX = 85.0511287798066;

// ---------------------------------------------------------------- exports

export function computePhaseGeometry(
  phase: OfflinePhase,
  trip: Trip,
): { coords: Coord[]; bbox: Bbox } {
  const phaseDays = trip.days
    .filter((d) => phase.dayIds.includes(d.id))
    .sort((a, b) => a.dayNumber - b.dayNumber);

  if (phaseDays.length === 0) {
    return { coords: [], bbox: [0, 0, 0, 0] };
  }

  const coords: Coord[] = [];

  // Cut the trip-wide encoded polyline to just this phase's span.
  // Phase start = day-1's startCoord if present, else the prior day's
  // overnight coord (Day N-1's coords), else trip.startCoords for Day 1.
  // Phase end = the last included day's coords (overnight).
  if (trip.routePolyline) {
    const full = decodePolyline(trip.routePolyline);
    const firstDay = phaseDays[0];
    const lastDay = phaseDays[phaseDays.length - 1];
    const firstIdx = trip.days.findIndex((d) => d.id === firstDay.id);
    const phaseStart: Coord | undefined =
      firstDay.startCoord ??
      (firstIdx > 0 ? trip.days[firstIdx - 1].coords : trip.startCoords);
    const phaseEnd = lastDay.coords;
    if (phaseStart && phaseEnd && full.length > 0) {
      const startIdx = closestIndex(full, phaseStart);
      const endIdx = closestIndex(full, phaseEnd);
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      coords.push(...full.slice(lo, hi + 1));
    }
  }

  // Waypoint coords for the phase's days — covers stops that may sit
  // off the road geometry (e.g. a state park 5 mi off the highway).
  for (const day of phaseDays) {
    for (const wp of day.waypoints) {
      if (wp.coords) coords.push(wp.coords);
    }
    // Overnight stop, in case routePolyline is absent (older trips).
    if (day.coords) coords.push(day.coords);
  }

  return { coords, bbox: bboxOf(coords) };
}

/**
 * Enumerate {z,x,y} tiles covering a buffered corridor around a set of
 * polyline sample coords.
 *
 * NOTE on signature: the ADR's pseudo-signature took a bbox, but a bbox
 * over-counts severely for non-rectangular corridors. For LA → Jasper
 * (week 1 of LA-to-Deadhorse) the bbox is ~444K sq mi vs ~95K sq mi for
 * the actual 25 mi-buffered road, a 5× overshoot at z=13 — well over
 * the storage budget. Switched the input to `coords` so each polyline
 * sample contributes a tile neighborhood and the union is corridor-
 * shaped.
 *
 * Algorithm: per-sample neighborhood expansion. For each sample point
 * at zoom z, compute the tile-edge length at that latitude, derive a
 * neighborhood radius in tiles, then add the surrounding square of
 * tiles to the set. Dense polyline sampling (Google-precision ~50m
 * between coords) means adjacent neighborhoods overlap; corner-
 * overshoot of the square vs disc is masked.
 */
export function enumerateTiles(
  coords: Coord[],
  bufferMi: number,
  zoomMin: number,
  zoomMax: number,
): { z: number; x: number; y: number }[] {
  if (coords.length === 0) return [];

  const out: { z: number; x: number; y: number }[] = [];
  for (let z = zoomMin; z <= zoomMax; z++) {
    const tileMax = (1 << z) - 1;
    const seen = new Set<number>(); // x * (tileMax+1) + y, packed
    for (const [lng, lat] of coords) {
      const clampedLat = clampMerc(lat);
      const cx = lngToTileX(lng, z);
      const cy = latToTileY(clampedLat, z);
      const edgeMi = tileEdgeMiAtZoomLat(z, clampedLat);
      const radius = edgeMi > 0 ? Math.ceil(bufferMi / edgeMi) : 0;
      const xLo = clamp(cx - radius, 0, tileMax);
      const xHi = clamp(cx + radius, 0, tileMax);
      const yLo = clamp(cy - radius, 0, tileMax);
      const yHi = clamp(cy + radius, 0, tileMax);
      // Disc filter inside the square. Without this, square corners
      // ~25 mi beyond the buffer line inflate the count by ~38% vs
      // a true corridor at z=13 / 25 mi.
      const bufMiSq = bufferMi * bufferMi;
      for (let x = xLo; x <= xHi; x++) {
        const dxMi = (x - cx) * edgeMi;
        const dxMiSq = dxMi * dxMi;
        for (let y = yLo; y <= yHi; y++) {
          const dyMi = (y - cy) * edgeMi;
          if (dxMiSq + dyMi * dyMi > bufMiSq) continue;
          const key = x * (tileMax + 1) + y;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ z, x, y });
          }
        }
      }
    }
  }
  return out;
}

/** Tile-edge length at given zoom + latitude, in miles. Equator
 *  circumference / 2^z gives EW edge in km; multiply by cos(lat) for
 *  the shrinkage toward the poles. */
function tileEdgeMiAtZoomLat(z: number, lat: number): number {
  const KM_PER_MI = 1.609344;
  const EARTH_CIRC_KM = 40075;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return (EARTH_CIRC_KM * Math.max(cosLat, 0.01)) / (1 << z) / KM_PER_MI;
}

export function hashPhasePolyline(coords: Coord[]): string {
  // Round to 5 decimals (~1m, matches Google polyline precision) so
  // floating-point noise doesn't shift the hash for identical geometry.
  const s = coords
    .map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    .join(";");
  return fnv1a32(s);
}

// ---------------------------------------------------------------- helpers

function bboxOf(coords: Coord[]): Bbox {
  if (coords.length === 0) return [0, 0, 0, 0];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

function closestIndex(polyline: Coord[], target: Coord): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  const [tLng, tLat] = target;
  for (let i = 0; i < polyline.length; i++) {
    const dLng = polyline[i][0] - tLng;
    const dLat = polyline[i][1] - tLat;
    const d = dLng * dLng + dLat * dLat;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      (1 << z),
  );
}

function clampMerc(lat: number): number {
  if (lat > MERC_LAT_MAX) return MERC_LAT_MAX;
  if (lat < -MERC_LAT_MAX) return -MERC_LAT_MAX;
  return lat;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
