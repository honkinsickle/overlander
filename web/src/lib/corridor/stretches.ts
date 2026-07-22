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

/** Node-scope the authored ranks for a day: walk each city's server placeIds and
 *  keep a place's rank ONLY in the cluster its rank was authored for (`entry.nodeId
 *  === c.id`). A place carrying another node's rank (regen/geometry/unpin drift) is
 *  omitted → it reads as unranked in whatever cluster it's in → appended, never
 *  sorted by a stale value. The single map both the edit spine and the read spine
 *  feed to `sortClusterByRank` — one scoping rule, so the surfaces can't drift.
 *  Returns undefined when nothing is ranked (so callers can skip the sort). */
export function scopeRankKey(
  cities: { id: string; placeIds: string[] }[],
  ranks?: ReadonlyMap<string, { nodeId: string; rank: number }>,
): Map<string, number> | undefined {
  if (!ranks || !ranks.size) return undefined;
  const m = new Map<string, number>();
  for (const c of cities) {
    for (const pid of c.placeIds) {
      const e = ranks.get(pid);
      if (e && e.nodeId === c.id) m.set(pid, e.rank);
    }
  }
  return m.size ? m : undefined;
}

/** Order one server cluster: ranked members (by authored rank) first, unranked
 *  ones APPENDED in server order. `rankKey` is node-scoped, so a place carrying
 *  another node's rank isn't in it and lands in the appended tail rather than
 *  sorting by a stale value. No ranked members → server order verbatim.
 *  The single ordering rule shared by every surface — the edit spine (via
 *  assignPlacesToStretches), the read-spine pool cluster (Hop A), and the
 *  read-spine curated key-stop group (Hop B) all call THIS, never a reimplementation. */
export function sortClusterByRank(ids: string[], rankKey?: Map<string, number>): string[] {
  if (!rankKey) return [...ids];
  const ranked = ids.filter((id) => rankKey.has(id));
  if (ranked.length === 0) return [...ids];
  const sorted = ranked.sort((a, b) => (rankKey.get(a) as number) - (rankKey.get(b) as number));
  const rest = ids.filter((id) => !rankKey.has(id));
  return [...sorted, ...rest];
}

/** The stretch a mid-drive place falls in: the first whose UPPER bound ≥
 *  dayMile (<= → upstream wins ties); beyond the last node clamps into the
 *  final stretch. Shared by both assignment modes. */
function stretchIndexFor(
  dayMile: number,
  nodeMiles: number[],
  stretchCount: number,
): number {
  for (let k = 0; k < stretchCount; k++) {
    if (dayMile <= nodeMiles[k + 1]) return k;
  }
  return stretchCount - 1;
}

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
 *
 * HYBRID MODE (`serverClusters`): pass the day's `CorridorCity.placeIds` and
 * cluster membership is taken from the SERVER bucketing verbatim — carrying user
 * pin overrides (applyPlaceOverrides), which pure geometry can't see. Geometry
 * then only positions the RESIDUAL (a place in no server cluster) into stretches
 * / along-the-way. This is the reconciliation the render needs: the server owns
 * "which node owns this place," the client owns "where the leftover mid-drive
 * places sit." A pinned-far place stays in its node's cluster AND keeps its true
 * (projected) mile tick, so the out-of-order mile reads as the honest signal it
 * is. Omit `serverClusters` for pure-geometry mode (unchanged; still used by any
 * caller with no server spine, e.g. a fallback 2-node day with empty placeIds —
 * there every place is residual, reproducing the prior behavior exactly).
 * Pure.
 */
export function assignPlacesToStretches(input: {
  /** Node day-miles, ascending (fallbackCorridor 2-node day: [0, day.miles]). */
  nodeMiles: number[];
  positioned: Map<string, PositionedPlace>;
  maxAttachMi?: number;
  /** Server-authoritative cluster membership (one array per node, matching
   *  `nodeMiles` order) = each `CorridorCity.placeIds`. When present, clusters
   *  are used verbatim and geometry only places the residual — see HYBRID MODE. */
  serverClusters?: string[][];
  /** STRETCH/residual order key — the along-route mile substitute for a
   *  round-trip day (near→far distance-from-anchor, since the spur projects onto
   *  the main route reversed). Absent id → its mile. A DIFFERENT unit from
   *  `rankKey` (miles, not fractional ranks); the two must never cover the same
   *  cluster (asserted). */
  orderKey?: Map<string, number>;
  /** CLUSTER order key — authored fractional ranks, already NODE-SCOPED by the
   *  caller (a place's rank is present here only when it's in the cluster its
   *  rank was authored for). A cluster with ≥1 ranked member sorts its ranked
   *  members by rank and APPENDS the unranked ones in server order — never
   *  demotes to mile, never sorts a foreigner by a stale rank (a foreigner is
   *  simply not in this map). */
  rankKey?: Map<string, number>;
}): { nodeClusters: string[][]; stretches: Stretch[]; alongTheWay: string[] } {
  const { nodeMiles, positioned, serverClusters, orderKey, rankKey } = input;
  const maxAttach = input.maxAttachMi ?? DEFAULT_CORRIDOR_PARAMS.maxAttachMi;
  // Scale guard (spec item 3): authored ranks and near→far miles are different
  // units; they must never both cover a member of the same cluster or the sort
  // mixes scales. rankKey is cluster-scoped, orderKey is residual/round-trip, so
  // in practice they're disjoint — fail LOUDLY if that ever breaks.
  if (rankKey && orderKey) {
    for (const id of rankKey.keys()) {
      if (orderKey.has(id)) {
        throw new Error(
          `assignPlacesToStretches: "${id}" has both an authored rank and a ` +
            `near→far key — different units must never sort the same cluster.`,
        );
      }
    }
  }
  // Sort rank: the order override when present, else the along-route mile.
  const rank = (id: string, mile: number) => orderKey?.get(id) ?? mile;
  const stretches: Stretch[] = [];
  for (let i = 0; i < nodeMiles.length - 1; i++) {
    stretches.push({ fromNode: i, toNode: i + 1, placeIds: [] });
  }
  const alongTheWay: string[] = [];
  const stretchHits: { s: number; id: string; mile: number }[] = [];

  // Hybrid: clusters come from the server (overrides included); geometry only
  // routes the residual — a positioned place in no server cluster — to a stretch
  // (on-corridor) or Along the way (off-corridor). Clustered places keep their
  // server home regardless of where their mile would land them.
  if (serverClusters) {
    // Server order verbatim, EXCEPT an AUTHORED cluster (≥1 node-scoped rank)
    // sorts its ranked members by rank and APPENDS the unranked ones (newcomers
    // arriving via a non-drag path, or foreigners carrying another node's rank)
    // in server order. Never demote to mile (that destroys N authored decisions
    // to avoid one unspecified one); never sort a foreigner by a stale rank (it
    // isn't in rankKey). An untouched cluster (no ranked members) stays verbatim.
    const nodeClusters = serverClusters.map((ids) => sortClusterByRank(ids, rankKey));
    const clustered = new Set(serverClusters.flat());
    for (const p of positioned.values()) {
      if (clustered.has(p.id)) continue;
      if (!p.onCorridor || stretches.length === 0) {
        alongTheWay.push(p.id);
        continue;
      }
      stretchHits.push({
        s: stretchIndexFor(p.dayMile, nodeMiles, stretches.length),
        id: p.id,
        mile: p.dayMile,
      });
    }
    stretchHits.sort((a, b) => rank(a.id, a.mile) - rank(b.id, b.mile));
    for (const h of stretchHits) stretches[h.s].placeIds.push(h.id);
    return { nodeClusters, stretches, alongTheWay };
  }

  // Pure-geometry: nearest-node clustering within maxAttach, else stretch.
  const nodeClusters: string[][] = nodeMiles.map(() => []);
  const clusterHits: { node: number; id: string; mile: number }[] = [];
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
    stretchHits.push({
      s: stretchIndexFor(p.dayMile, nodeMiles, stretches.length),
      id: p.id,
      mile: p.dayMile,
    });
  }

  clusterHits.sort((a, b) => rank(a.id, a.mile) - rank(b.id, b.mile));
  for (const h of clusterHits) nodeClusters[h.node].push(h.id);
  stretchHits.sort((a, b) => rank(a.id, a.mile) - rank(b.id, b.mile));
  for (const h of stretchHits) stretches[h.s].placeIds.push(h.id);
  return { nodeClusters, stretches, alongTheWay };
}
