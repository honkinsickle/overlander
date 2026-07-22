import { sortClusterByRank } from "./stretches";

/**
 * Read-spine curated-pick placement under user intent (spec § node-stack model).
 * The read spine positions curated KEY STOPS by their baked `milesFromStart` —
 * the "Key Stops on the timeline" treatment. An EXPLICIT signal that the user
 * placed a pick under a node must win over that: the pick renders UNDER its node
 * (kept at its true mile — the out-of-order position is the honest signal, not a
 * bug), matching the edit spine so every surface agrees on where a pinned place
 * lives AND in what order. The edit spine honors both via CorridorCity.placeIds +
 * placeRanks (see stretches.ts HYBRID MODE / sortClusterByRank); this brings the
 * read spine into line.
 *
 * TWO explicit triggers, both "the user placed this here" — NEVER placeIds
 * membership alone:
 *   1. an explicit `placeOverride` to a present node (a pin), OR
 *   2. an authored, node-scoped rank (`rankKey.has(id)` — scopeRankKey already
 *      proved the rank belongs to that node's cluster). A same-node reorder writes
 *      a rank but no override, so rank is the trigger that surfaces a reordered
 *      (but unpinned) pick under its node.
 * A curated pick that nearest-node bucketing merely places under a node, with
 * NEITHER signal, keeps its timeline treatment. The guard test (bucketed, no
 * override, no rank → stays in `rest`) locks that: without it the Key Stops
 * timeline would silently vanish and every curated pick would snap to a node.
 *
 * ORDER WITHIN A NODE = the ONE rule, `sortClusterByRank(city.placeIds, rankKey)`
 * filtered to the node's pinned picks — the EXACT order the edit spine renders
 * (ranked members by rank, the rest in server/placeIds order — which is mile
 * order for auto-bucketed picks and append order for overridden ones, per
 * applyPlaceOverrides). No separate mile sort: one implementation, so the read
 * and edit spines cannot drift. A pinned pick outside its node's placeIds (a
 * dangling/optimistic override not yet folded into the server cluster) has no
 * cluster position; it appends last in input order.
 *
 * A DANGLING override (target node absent this day) falls back to the timeline,
 * mirroring applyPlaceOverrides' dangling-target fallback — never a crash. Pure.
 */
export function classifyCuratedPicks<T extends { id: string; milesFromStart?: number }>(input: {
  /** The day's deduped curated picks. */
  curatedPicks: T[];
  /** The day's nodes with their server placeIds (CorridorCity-shaped) — supplies
   *  both the present-node set and the cluster order the node group follows. */
  cities: { id: string; placeIds: string[] }[];
  /** The trip's placeOverrides (irrelevant ones are ignored). */
  placeOverrides: { placeId: string; nodeId: string }[];
  /** Node-scoped authored ranks (scopeRankKey output) — the second pin trigger
   *  and the order source. Absent → override-only behavior. */
  rankKey?: Map<string, number>;
}): {
  /** nodeId → picks pinned there (present nodes only), in cluster (rank) order. */
  pinnedByNode: Map<string, T[]>;
  /** Non-pinned (or dangling-override) picks → anchor / mile-position as before. */
  rest: T[];
} {
  const present = new Set(input.cities.map((c) => c.id));
  // placeId → target node from an explicit override (present targets only).
  const overrideTarget = new Map<string, string>();
  for (const o of input.placeOverrides) {
    if (present.has(o.nodeId)) overrideTarget.set(o.placeId, o.nodeId);
  }
  // placeId → the node it's bucketed under (server placeIds), to resolve a
  // rank-authored pick's home (its rank in rankKey is already scoped to it).
  const clusterOf = new Map<string, string>();
  for (const c of input.cities) for (const pid of c.placeIds) clusterOf.set(pid, c.id);

  const pinnedByNode = new Map<string, T[]>();
  const rest: T[] = [];
  for (const p of input.curatedPicks) {
    const nodeId =
      overrideTarget.get(p.id) ??
      (input.rankKey?.has(p.id) ? clusterOf.get(p.id) : undefined);
    if (nodeId === undefined) {
      rest.push(p); // neither signal → timeline treatment (the default)
      continue;
    }
    const arr = pinnedByNode.get(nodeId) ?? [];
    arr.push(p);
    pinnedByNode.set(nodeId, arr);
  }
  // One ordering rule (sortClusterByRank), keyed by cluster position, so the read
  // spine agrees with the edit spine member-for-member.
  for (const [nodeId, arr] of pinnedByNode) {
    const city = input.cities.find((c) => c.id === nodeId)!;
    const order = sortClusterByRank(city.placeIds, input.rankKey);
    const pos = new Map(order.map((id, i) => [id, i]));
    arr.sort((a, b) => {
      const ia = pos.get(a.id);
      const ib = pos.get(b.id);
      if (ia === undefined && ib === undefined) return 0; // both off-cluster → input order
      if (ia === undefined) return 1; // off-cluster (dangling override) sinks last
      if (ib === undefined) return -1;
      return ia - ib;
    });
  }
  return { pinnedByNode, rest };
}
