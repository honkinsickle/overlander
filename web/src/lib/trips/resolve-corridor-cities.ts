import type { Trip } from "./types";
import {
  alongRouteMiles,
  decodePolyline,
  haversineMi,
} from "@/lib/routing/point-to-polyline";
import { deriveCorridorCities } from "@/lib/corridor/derive";
import { bucketPlacesIntoCorridor } from "@/lib/corridor/bucket";
import gazetteer from "@/lib/corridor/data/cities-na.json";

/**
 * Reference-trip corridor derivation (docs/corridor-cities-spec.md §3).
 *
 * Reference trips have no per-day polylines — days are static (label,
 * coords, miles) plus ONE trip-level `routePolyline`. So, unlike the
 * finalize path (which derives from each DaySegment in
 * buildRouteAwareDays), this resolver slices each day's polyline out of
 * the full route, then runs the same deriveCorridorCities call finalize
 * uses.
 *
 * Slicing uses a FORWARD-MOVING CURSOR, not global nearest-projection:
 * the reference route revisits places (LA→Deadhorse→Port Angeles passes
 * Anchorage three times and retraces highways southbound), so a day's
 * start/end coords can be nearest to the WRONG pass of the route.
 * Because days are route-ordered, each day projects its endpoints only
 * onto the route from the previous day's end vertex forward, which pins
 * every day to its own pass. The END projection is additionally bounded
 * by the day's published `miles` (×1.5 + slack) — a repeated destination
 * can otherwise still project onto a later pass AHEAD of the cursor
 * (Day 16 Tok→Anchorage grabbed the day-27 Anchorage pass, a 1,300-mi
 * "slice", before this bound existed).
 *
 * Pure/synchronous — runs in the buildAlaskaTripFromMarkdown chain at
 * seed/snapshot time, so corridors persist in reference_trips payloads
 * and the committed snapshot (precompute-and-persist, spec §3). Days
 * that can't be sliced (missing coords, unparseable label — e.g.
 * "· Buffer" layover days — or a degenerate span) are left without
 * corridorCities and clients fall back per decision F; such days do not
 * advance the cursor.
 */
export function resolveCorridorCities(trip: Trip): Trip {
  if (!trip.routePolyline) return trip;
  const line = decodePolyline(trip.routePolyline);
  if (line.length < 2) return trip;

  // Cumulative miles per vertex, walked once — maps a projected mile
  // position (relative to a window start) back to a vertex index.
  const cumMi: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cumMi.push(cumMi[i - 1] + haversineMi(line[i - 1], line[i]));
  }
  /** First vertex index at/after `mi` miles past vertex `from`. */
  const idxAtMile = (mi: number, from: number): number => {
    const target = cumMi[from] + mi;
    let lo = from;
    let hi = cumMi.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumMi[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let cursor = 0;
  const days = trip.days.map((day, i) => {
    // Reference days predate Day.startCoord — apply the documented
    // fallback chain (types.ts / spec §1.3): trip.startCoords for
    // Day 1, else the previous day's end coords.
    const startCoord =
      day.startCoord ??
      (i === 0 ? trip.startCoords : trip.days[i - 1].coords);
    if (!startCoord || !day.coords) return day;

    // Day labels are "Start City, ST — End City, ST" (same format the
    // finalize path writes; spec §1.3 derives node names from the halves).
    // Some reference labels carry a via segment ("Lake Louise — Icefields
    // Pkwy — Jasper, AB") — the end is the LAST part, not the second.
    const parts = day.label.split(" — ");
    const startName = parts[0];
    const endName = parts.length > 1 ? parts[parts.length - 1] : undefined;
    if (!startName || !endName) return day;

    const window = line.slice(cursor);
    if (window.length < 2) return day;
    const a = alongRouteMiles(startCoord, window);
    if (!a) return day;
    // Bound the END projection by the day's published length: a repeated
    // destination (Anchorage is visited three times) can otherwise
    // project onto a LATER pass ahead of the cursor, ballooning the
    // slice and stranding the cursor downstream. 1.5× + 25 mi absorbs
    // published-miles vs polyline drift while staying far below any
    // later-pass distance.
    const endCapIdx = day.miles
      ? idxAtMile(a.miles + day.miles * 1.5 + 25, cursor)
      : line.length - 1;
    const endWindow = line.slice(cursor, endCapIdx + 1);
    if (endWindow.length < 2) return day;
    const b = alongRouteMiles(day.coords, endWindow);
    if (!b || b.miles <= a.miles) return day;
    const iA = idxAtMile(a.miles, cursor);
    const iB = idxAtMile(b.miles, cursor);
    if (iB - iA < 1) return day;

    const daySlice = line.slice(iA, iB + 1);
    const spine = deriveCorridorCities({
      line: daySlice,
      start: { name: startName, coords: startCoord },
      end: { name: endName, coords: day.coords },
      gazetteer,
    });
    cursor = iB;
    if (!spine) return day;
    // Place→node bucketing (spec §2.3) over the day's full place pool —
    // segmentSuggestions ∪ waypoints (spec §1.4 resolution set). Reference
    // days typically carry only waypoints; suggestions-era days get both.
    const pool = [
      ...(day.segmentSuggestions ?? []),
      ...day.waypoints,
    ]
      .filter((p) => p.coords)
      .map((p) => ({ id: p.id, coords: p.coords as [number, number] }));
    const corridorCities = bucketPlacesIntoCorridor({
      cities: spine,
      places: pool,
      line: daySlice,
    });
    return { ...day, corridorCities };
  });
  return { ...trip, days };
}
