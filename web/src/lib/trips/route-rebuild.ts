/**
 * Full-trip routePolyline rebuild — a routing helper for structural day edits
 * (the day split) that change day boundaries and therefore invalidate the stored
 * `Trip.routePolyline`.
 *
 * WHY a rebuild, not a clear. `addWaypoint`/`removeWaypoint` CLEAR the polyline
 * and let the client live-route it per render; `removeDay` leaves it STALE (the
 * client then decodes a line through a day that no longer exists — the anti-
 * pattern this avoids). A structural insert must produce a correct line, so we
 * re-route every day and re-assemble, mirroring `assembleRoutePolyline(dayRoutes)`
 * — except `dayRoutes` is transient and gone, so we route live here.
 *
 * SHAPE (directive 3): route days in PARALLEL (follows bake.ts, not audit.ts's
 * sequential loop); SKIP legs where `start === end` — a round-trip/layover day
 * carries no geometry by construction and a call for it is waste; an UNROUTABLE
 * leg straight-lines its own segment (start→end) so the assembled line stays
 * continuous, exactly as the client's live path degrades. Boundary vertices are
 * de-duplicated on concat, matching `concatDayRouteCoords`.
 *
 * `deps.route` is injectable for offline tests.
 */
import type { Trip } from "./types";
import {
  routeBetween,
  type LngLat,
  type Route,
} from "@/lib/routing/route-between";
import { encodePolyline } from "@/lib/routing/polyline";
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";

/** Mapbox Directions per-request coordinate cap (route-between.ts). */
const STOP_CAP = 25;

function sameCoord(a?: LngLat, b?: LngLat): boolean {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/** Ordered stop list for one day: start → coord-bearing waypoints (in GEOGRAPHIC
 *  order along the start→end chord, matching recomputeDay) → end, consecutive
 *  duplicates dropped. Returns null when the day has no start or end coord. */
function dayStops(trip: Trip, i: number): LngLat[] | null {
  const day = trip.days[i];
  const end = day.coords;
  const start = day.startCoord ?? (i === 0 ? trip.startCoords : trip.days[i - 1].coords);
  if (!start || !end) return null;
  const chord: LngLat[] = [start, end];
  const ordered = day.waypoints
    .filter((wp) => wp.coords)
    .map((wp) => ({
      coords: wp.coords as LngLat,
      mi: alongRouteMiles(wp.coords as LngLat, chord)?.miles ?? 0,
    }))
    .sort((a, b) => a.mi - b.mi);
  const stops: LngLat[] = [start, ...ordered.map((o) => o.coords), end];
  const deduped: LngLat[] = [];
  for (const c of stops) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) deduped.push(c);
  }
  return deduped;
}

/**
 * Rebuild the whole trip's `routePolyline` from live routing. Returns the encoded
 * polyline, or `undefined` when no day yielded any geometry (nothing to draw).
 */
export async function rebuildRoutePolyline(
  trip: Trip,
  deps: { route?: (coords: LngLat[]) => Promise<Route> } = {},
): Promise<string | undefined> {
  const route = deps.route ?? routeBetween;

  // Per-day geometry, in parallel (bake.ts shape).
  const perDay = await Promise.all(
    trip.days.map(async (day, i): Promise<LngLat[] | null> => {
      const stops = dayStops(trip, i);
      if (!stops || stops.length < 2) return null;
      // start === end (round-trip / layover): no geometry by construction, skip.
      if (stops.length === 2 && sameCoord(stops[0], stops[1])) return null;
      if (stops.length > STOP_CAP) return [stops[0], stops[stops.length - 1]];
      try {
        return (await route(stops)).coordinates;
      } catch {
        // Unroutable leg → straight-line its own segment so the line stays
        // continuous (the client's live path degrades identically).
        return [stops[0], stops[stops.length - 1]];
      }
    }),
  );

  // Concatenate in day order, dropping the shared boundary vertex between
  // consecutive day slices (concatDayRouteCoords shape).
  const merged: LngLat[] = [];
  for (const coords of perDay) {
    if (!coords || coords.length === 0) continue;
    const start = merged.length === 0 ? 0 : sameCoord(merged[merged.length - 1], coords[0]) ? 1 : 0;
    for (let i = start; i < coords.length; i++) merged.push(coords[i]);
  }
  if (merged.length < 2) return undefined;
  return encodePolyline(merged);
}
