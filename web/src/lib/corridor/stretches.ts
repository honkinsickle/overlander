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
 *
 * TODO(scope): `milesFromStart` is now corrected at persist — bake.ts stamps a
 * day-relative mile on EVERY on-corridor tile (not just curated), and the
 * reseed backfills existing trips (both 2026-07-20). With a correct, day-relative
 * mile stored (present ⇒ on-corridor per the BrowsePlace contract),
 * `positionPlacesOnDay` is DELETABLE — but only after `day-detail-node-blocks.tsx`
 * is refactored to build its PositionedPlace map from stored `milesFromStart`
 * (present → {dayMile, onCorridor:true}; absent → alongTheWay) instead of
 * projecting. Not done in this slice: the stopgap stays until that refactor and
 * until every served trip carries corrected miles (old trips need the reseed).
 */
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import type { LngLat } from "@/lib/routing/route-between";
import { DEFAULT_CORRIDOR_PARAMS } from "./derive";
import { normPlaceName } from "./anchor-match";

export type PositionedPlace = {
  id: string;
  /** Day-relative along-route mile = route mile − the day's cumulative start. */
  dayMile: number;
  /** Perpendicular miles from the route — the on-corridor gate. */
  offsetMi: number;
  /** offsetMi ≤ bufferMi: a stop ON the drive vs a detour off it. */
  onCorridor: boolean;
};

/** Route-relative start mile for each day = cumulative NET route progress.
 *  A round-trip day (start city == end city — a dwell, or an out-and-back
 *  excursion whose `day.miles` are real driving miles but make ZERO net route
 *  progress, e.g. Stewart → Salmon Glacier → Stewart) must NOT advance the
 *  cumulative, or every downstream day drifts by the excursion distance. Matches
 *  the fallbackCorridor node miles so POIs and nodes share an origin. */
export function dayStartMiles(days: { miles?: number; label?: string }[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of days) {
    out.push(acc);
    if (!isRoundTripDay(d.label)) acc += d.miles ?? 0;
  }
  return out;
}

function isRoundTripDay(label?: string): boolean {
  if (!label) return false;
  const parts = label.split(" — ");
  if (parts.length < 2) return false;
  const a = normPlaceName(parts[0]);
  const b = normPlaceName(parts[parts.length - 1]);
  return a.length > 0 && a === b;
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

/** Ties within this many miles keep the upstream node (mirrors bucket.ts). */
const TIE_EPS_MI = 0.01;

/**
 * Assign positioned places to NODE CLUSTERS and drive STRETCHES — the same
 * maxAttachMi idea bucket.ts uses, so a place near a node clusters UNDER it
 * (its arrival — where you eat, where you sleep) and only genuinely mid-drive
 * places sit in the stretch between two nodes.
 *   - Within `maxAttachMi` of the nearest node → that node's cluster (ties keep
 *     the upstream node). This catches an arriving stop or overnight that sits
 *     a mile or two past the node — it lands under the node, not before it.
 *   - Otherwise → the drive stretch it falls in ([A, B], upstream wins ties; a
 *     place beyond the last node clamps into the final stretch).
 *   - OFF-CORRIDOR (offsetMi > bufferMi) → "Along the way", the only thing left.
 * Node-IDENTICAL places (a pool place that IS a node) are already filtered out
 * upstream at the resolver (corridor/node-identity, applied in
 * resolveCorridorCities + bakeGeneratedDays), so the pool reaching here is clean.
 * Pure.
 */
export function assignPlacesToStretches(input: {
  /** Node day-miles, ascending (fallbackCorridor 2-node day: [0, day.miles]). */
  nodeMiles: number[];
  positioned: Map<string, PositionedPlace>;
  maxAttachMi?: number;
}): { nodeClusters: string[][]; stretches: Stretch[]; alongTheWay: string[] } {
  const { nodeMiles, positioned } = input;
  const maxAttach = input.maxAttachMi ?? DEFAULT_CORRIDOR_PARAMS.maxAttachMi;
  const nodeClusters: string[][] = nodeMiles.map(() => []);
  const stretches: Stretch[] = [];
  for (let i = 0; i < nodeMiles.length - 1; i++) {
    stretches.push({ fromNode: i, toNode: i + 1, placeIds: [] });
  }
  const alongTheWay: string[] = [];
  const clusterHits: { node: number; id: string; mile: number }[] = [];
  const stretchHits: { s: number; id: string; mile: number }[] = [];

  for (const p of positioned.values()) {
    if (!p.onCorridor) {
      alongTheWay.push(p.id);
      continue;
    }
    // Nearest node by day-mile; upstream wins ties (bucket.ts §2.3 rule).
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < nodeMiles.length; i++) {
      const d = Math.abs(nodeMiles[i] - p.dayMile);
      if (d < bestDist - TIE_EPS_MI) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= maxAttach) {
      clusterHits.push({ node: best, id: p.id, mile: p.dayMile });
      continue;
    }
    if (stretches.length === 0) {
      // 1-node day and beyond its attach radius — nowhere on the rail.
      alongTheWay.push(p.id);
      continue;
    }
    // First stretch whose UPPER bound ≥ dayMile (<= → upstream wins ties);
    // beyond the last node clamps into the last stretch.
    let s = -1;
    for (let k = 0; k < stretches.length; k++) {
      if (p.dayMile <= nodeMiles[k + 1]) {
        s = k;
        break;
      }
    }
    if (s === -1) s = stretches.length - 1;
    stretchHits.push({ s, id: p.id, mile: p.dayMile });
  }

  clusterHits.sort((a, b) => a.mile - b.mile);
  for (const h of clusterHits) nodeClusters[h.node].push(h.id);
  stretchHits.sort((a, b) => a.mile - b.mile);
  for (const h of stretchHits) stretches[h.s].placeIds.push(h.id);
  return { nodeClusters, stretches, alongTheWay };
}
