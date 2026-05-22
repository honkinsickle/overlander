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

export function enumerateTiles(
  bbox: Bbox,
  bufferMi: number,
  zoomMin: number,
  zoomMax: number,
): { z: number; x: number; y: number }[] {
  const [west, south, east, north] = bbox;
  if (!Number.isFinite(west + south + east + north) || west > east || south > north) {
    return [];
  }

  // Buffer outward. Longitude buffer scales with cos(meanLat) because a
  // degree of longitude shrinks toward the poles.
  const meanLat = (south + north) / 2;
  const latBufDeg = bufferMi / MI_PER_DEG_LAT;
  const cosMean = Math.cos((meanLat * Math.PI) / 180);
  const lngBufDeg = bufferMi / (MI_PER_DEG_LAT * Math.max(cosMean, 0.01));

  const bufWest = Math.max(west - lngBufDeg, -180);
  const bufEast = Math.min(east + lngBufDeg, 180);
  const bufSouth = clampMerc(south - latBufDeg);
  const bufNorth = clampMerc(north + latBufDeg);

  const out: { z: number; x: number; y: number }[] = [];
  for (let z = zoomMin; z <= zoomMax; z++) {
    const tileMax = (1 << z) - 1;
    const minX = clamp(lngToTileX(bufWest, z), 0, tileMax);
    const maxX = clamp(lngToTileX(bufEast, z), 0, tileMax);
    // y increases SOUTHWARD, so the north edge gives the min y.
    const minY = clamp(latToTileY(bufNorth, z), 0, tileMax);
    const maxY = clamp(latToTileY(bufSouth, z), 0, tileMax);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        out.push({ z, x, y });
      }
    }
  }
  return out;
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
