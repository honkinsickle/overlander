/**
 * Stretch assignment (spec § node-stack model, "drive as container"): place a
 * day's POIs into the drive STRETCHES between its nodes, positioned by
 * along-route mile. Pure, no I/O.
 *
 * WHY POSITIONS COME FROM COORDS, NOT `milesFromStart`: on the current
 * generated trips the stored `segmentSuggestions.milesFromStart` is unreliable —
 * a constant ~+589-mi FOREIGN OFFSET vs the true route-relative position (day 1
 * of dawson-cassiar-livingplan-test: stored 625/744/857 vs true 37/155/267). It
 * was baked against a different/longer route origin. So a POI's real position is
 * recovered here by projecting its `coords` onto the trip route polyline. This
 * is a render-time STOPGAP — the coords the corridor engine needs were dropped
 * at persist (itineraryToTrip; see docs/findings/2026-07-20-generated-day-coords-
 * discarded.md), which is also why nodes fall back to a 2-node day spine. Once
 * that persistence bug is fixed and the engine runs at serve, this same pair of
 * functions can be called there instead of in the presenter.
 */
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import type { LngLat } from "@/lib/routing/route-between";
import { DEFAULT_CORRIDOR_PARAMS } from "./derive";

export type PositionedPlace = {
  id: string;
  /** Day-relative along-route mile = route mile − the day's cumulative start. */
  dayMile: number;
  /** Perpendicular miles from the route — the on-corridor gate. */
  offsetMi: number;
  /** offsetMi ≤ bufferMi: a stop ON the drive vs a detour off it. */
  onCorridor: boolean;
};

/** Route-relative start mile for each day = cumulative sum of prior `day.miles`
 *  (a dwell day, miles 0, doesn't advance). Matches the fallbackCorridor node
 *  miles, which are also `day.miles`-based, so POIs and nodes share an origin. */
export function dayStartMiles(days: { miles?: number }[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of days) {
    out.push(acc);
    acc += d.miles ?? 0;
  }
  return out;
}

/** Project each place's coords onto the route → day-relative mile + offset. */
export function positionPlacesOnDay(input: {
  line: LngLat[];
  places: { id: string; coords?: [number, number] }[];
  dayStartMile: number;
  bufferMi?: number;
}): Map<string, PositionedPlace> {
  const buffer = input.bufferMi ?? DEFAULT_CORRIDOR_PARAMS.bufferMi;
  const out = new Map<string, PositionedPlace>();
  if (input.line.length < 2) return out;
  for (const p of input.places) {
    if (!p.coords) continue;
    const r = alongRouteMiles(p.coords, input.line);
    if (!r) continue;
    out.set(p.id, {
      id: p.id,
      dayMile: r.miles - input.dayStartMile,
      offsetMi: r.offsetMi,
      onCorridor: r.offsetMi <= buffer,
    });
  }
  return out;
}

export type Stretch = {
  /** Indices into the node list this stretch runs between. */
  fromNode: number;
  toNode: number;
  /** Place ids in this stretch, ordered by day-relative mile ascending. */
  placeIds: string[];
};

/**
 * Assign positioned places to the stretches between consecutive nodes.
 *   - Interval [A, B]: upstream node wins ties (a place at node B's mile stays
 *     in the stretch ending at B, not the next one).
 *   - A place past the last node (an overnight projecting a mile or two beyond
 *     the end) CLAMPS into the final stretch.
 *   - OFF-CORRIDOR (offsetMi > bufferMi) is the only thing that lands in
 *     "Along the way" — a place you genuinely detour to.
 * Pure.
 */
export function assignPlacesToStretches(input: {
  /** Node day-miles, ascending (fallbackCorridor 2-node day: [0, day.miles]). */
  nodeMiles: number[];
  positioned: Map<string, PositionedPlace>;
}): { stretches: Stretch[]; alongTheWay: string[] } {
  const { nodeMiles, positioned } = input;
  const stretches: Stretch[] = [];
  for (let i = 0; i < nodeMiles.length - 1; i++) {
    stretches.push({ fromNode: i, toNode: i + 1, placeIds: [] });
  }
  const alongTheWay: string[] = [];
  const hits: { id: string; mile: number; s: number }[] = [];

  for (const p of positioned.values()) {
    if (!p.onCorridor) {
      alongTheWay.push(p.id);
      continue;
    }
    if (stretches.length === 0) {
      // Degenerate 1-node day — nowhere to place it on the rail.
      alongTheWay.push(p.id);
      continue;
    }
    // First stretch whose UPPER bound ≥ dayMile (<= → upstream wins ties);
    // a place beyond the last node falls through and clamps to the last stretch.
    let s = -1;
    for (let k = 0; k < stretches.length; k++) {
      if (p.dayMile <= nodeMiles[k + 1]) {
        s = k;
        break;
      }
    }
    if (s === -1) s = stretches.length - 1;
    hits.push({ id: p.id, mile: p.dayMile, s });
  }

  hits.sort((a, b) => a.mile - b.mile);
  for (const h of hits) stretches[h.s].placeIds.push(h.id);
  return { stretches, alongTheWay };
}
