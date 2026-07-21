/**
 * Read-spine curated-pick placement under user pin overrides (spec § node-stack
 * model). The read spine positions curated KEY STOPS by their baked
 * `milesFromStart` — the "Key Stops on the timeline" treatment. An EXPLICIT
 * `placeOverride` must win over that: a pinned curated pick renders UNDER its
 * node (kept at its true mile — the out-of-order position is the honest signal,
 * not a bug), matching the edit spine so every surface agrees on where a pinned
 * place lives. The edit spine already honors overrides via CorridorCity.placeIds
 * (see stretches.ts HYBRID MODE); this brings the read spine into line.
 *
 * THE TRIGGER IS THE EXPLICIT OVERRIDE LIST, *NOT* placeIds membership. A curated
 * pick that nearest-node bucketing happens to place under a node keeps its
 * timeline treatment — only a deliberate pin relocates it. If this ever inverted
 * to "in some node's placeIds → relocate," the Key Stops timeline would silently
 * vanish and every curated pick would snap to a node. The guard test in
 * curated-placement.test.ts (a curated pick bucketed under a node with NO
 * override, asserted to stay in `rest`) locks that.
 *
 * A DANGLING override (target node absent this day) falls back to the timeline,
 * mirroring applyPlaceOverrides' dangling-target fallback — never a crash. Pure.
 */
export function classifyCuratedPicks<T extends { id: string; milesFromStart?: number }>(input: {
  /** The day's deduped curated picks. */
  curatedPicks: T[];
  /** ids of the nodes present on this day (CorridorCity.id). */
  presentNodeIds: Set<string>;
  /** The trip's placeOverrides (irrelevant ones are ignored). */
  placeOverrides: { placeId: string; nodeId: string }[];
}): {
  /** nodeId → picks pinned there (present nodes only), mile-ordered. */
  pinnedByNode: Map<string, T[]>;
  /** Non-pinned (or dangling-override) picks → anchor / mile-position as before. */
  rest: T[];
} {
  // placeId → target node, only for overrides whose target exists this day.
  const target = new Map<string, string>();
  for (const o of input.placeOverrides) {
    if (input.presentNodeIds.has(o.nodeId)) target.set(o.placeId, o.nodeId);
  }

  const pinnedByNode = new Map<string, T[]>();
  const rest: T[] = [];
  for (const p of input.curatedPicks) {
    const nodeId = target.get(p.id);
    if (nodeId === undefined) {
      rest.push(p); // no explicit pin → timeline treatment (the default)
      continue;
    }
    const arr = pinnedByNode.get(nodeId) ?? [];
    arr.push(p);
    pinnedByNode.set(nodeId, arr);
  }
  // Mile order within a node (a manual pin is explicit; keep the honest order).
  for (const arr of pinnedByNode.values()) {
    arr.sort((a, b) => (a.milesFromStart ?? 0) - (b.milesFromStart ?? 0));
  }
  return { pinnedByNode, rest };
}
