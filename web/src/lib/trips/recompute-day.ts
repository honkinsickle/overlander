import type { CorridorCity, Trip } from "./types";
import {
  routeBetween,
  type LngLat,
  type Route,
} from "@/lib/routing/route-between";
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import { deriveCorridorCities } from "@/lib/corridor/derive";
import { bucketPlacesIntoCorridor } from "@/lib/corridor/bucket";
import gazetteer from "@/lib/corridor/data/cities-na.json";

/**
 * Edit-time route recalculation (Phase 0 of the editable-corridor
 * integration — supersedes the "deferred" status in spec §3.1).
 *
 * Reroutes ONE day through its stops (start → waypoints in order → end)
 * and recomputes the derived values that finalize wrote and edits made
 * stale: `miles`, `driveHours`, `corridorCities`. Introduces
 * route-through-stops semantics — finalize's day values come from a
 * direct start→end slice, so the first edit-recompute of a day can
 * legitimately jump them (the through-stops route is the truthful one).
 *
 * Decoupled by design (2026-07-07 ruling): callers treat this as
 * best-effort AFTER the edit itself has persisted — a Mapbox failure
 * must never block or roll back the user's edit; derived values just
 * stay stale until the next successful recompute.
 *
 * The rerouted polyline is used transiently (corridor derivation) and
 * discarded — day polylines are not persisted. The map's route line is
 * handled display-side (MapColumn routes through waypoints).
 *
 * `deps.route` is injectable for offline tests.
 */
export type DayDerived = {
  miles: number;
  driveHours: number;
  /** Undefined when the corridor couldn't be derived (unsplittable
   *  label, degenerate spine). Callers should PERSIST the undefined —
   *  the old corridor described the pre-edit route and is wrong now;
   *  clients fall back to the two-node corridor (spec decision F). */
  corridorCities?: CorridorCity[];
};

const METERS_PER_MILE = 1609.34;
/** Mapbox Directions per-request coordinate cap (route-between.ts). */
const STOP_CAP = 25;

export async function recomputeDay(
  trip: Trip,
  dayId: string,
  deps: { route?: (coords: LngLat[]) => Promise<Route> } = {},
): Promise<DayDerived | null> {
  const i = trip.days.findIndex((d) => d.id === dayId);
  if (i === -1) return null;
  const day = trip.days[i];
  if (!day.coords) return null;
  const startCoord =
    day.startCoord ?? (i === 0 ? trip.startCoords : trip.days[i - 1].coords);
  if (!startCoord) return null;

  // Start → coord-bearing waypoints → end. Waypoints are routed in
  // GEOGRAPHIC order — projected along the direct start→end chord —
  // not array order ("geography is the order", Phase 3 model A1): adds
  // append to the array, and insertion-order routing sent a downtown-LA
  // add AFTER a Utah-border stop (385-mi day → 1,136 mi). The chord is
  // an API-free ordering proxy; the real polyline doesn't exist until
  // we route. Dedupe consecutive duplicates (Mapbox 422s on them).
  const chord: LngLat[] = [startCoord, day.coords];
  const orderedWaypoints = day.waypoints
    .filter((wp) => wp.coords)
    .map((wp) => ({
      coords: wp.coords as LngLat,
      mi: alongRouteMiles(wp.coords as LngLat, chord)?.miles ?? 0,
    }))
    .sort((a, b) => a.mi - b.mi);
  const stops: LngLat[] = [startCoord];
  for (const wp of orderedWaypoints) stops.push(wp.coords);
  stops.push(day.coords);
  const deduped: LngLat[] = [];
  for (const c of stops) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) deduped.push(c);
  }
  if (deduped.length < 2 || deduped.length > STOP_CAP) return null;

  const route = await (deps.route ?? routeBetween)(deduped);

  const derived: DayDerived = {
    miles: Math.round(route.distanceM / METERS_PER_MILE),
    driveHours: Math.round((route.durationS / 3600) * 10) / 10,
  };

  // Corridor spine + bucketing over the rerouted line. Node names come
  // from the label halves (spec §1.3); via-labels take the LAST part as
  // the end, matching resolve-corridor-cities.
  const parts = day.label.split(" — ");
  const startName = parts[0];
  const endName = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (startName && endName) {
    const spine = deriveCorridorCities({
      line: route.coordinates,
      start: { name: startName, coords: startCoord },
      end: { name: endName, coords: day.coords },
      gazetteer,
    });
    if (spine) {
      // Dedupe by id: adding a suggested place mints a waypoint with the
      // SAME id while the suggestion stays in segmentSuggestions — without
      // this the place buckets twice and the corridor renders twin tiles.
      const pool: { id: string; coords: LngLat }[] = [];
      const seen = new Set<string>();
      for (const p of [...(day.segmentSuggestions ?? []), ...day.waypoints]) {
        if (!p.coords || seen.has(p.id)) continue;
        seen.add(p.id);
        pool.push({ id: p.id, coords: p.coords });
      }
      derived.corridorCities = bucketPlacesIntoCorridor({
        cities: spine,
        places: pool,
        line: route.coordinates,
      });
    }
  }
  return derived;
}
