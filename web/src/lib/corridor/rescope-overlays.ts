/**
 * Rescope user overlays across a day-structure change (§ node-stack model). The
 * pure core that a cross-day MOVE and (later) add/remove-day both need: given the
 * user's trip-level overlays and the NEW day layout, decide which overlays still
 * have a valid home and DROP the rest. It never rewrites a nodeId.
 *
 * WHY DROP, NOT REWRITE. A node's id is a NAME slug (`slugify(name+admin)`, see
 * corridor/derive.ts) or a minted-once seed id — NOT a `day-${index}` id. So a
 * day insert/remove/reorder does not invalidate an overlay by index; the geometry
 * re-resolves node positions itself (assignPlacesToStretches). The only thing that
 * can invalidate an overlay is the STOP losing a valid home: its place is gone
 * from every day, or the node it pins/ranks to isn't on the day that now holds it.
 *
 * THE HOME-DAY RULE (the correctness crux). An overlay `{ placeId, nodeId }`
 * survives iff some day that HOLDS `placeId` (in its stop pool) also contains
 * `nodeId` among its nodes. A node with the same id on a DIFFERENT day does NOT
 * count — honoring it is exactly the cross-day "pull-in from nowhere" bug
 * (corridor/bucket.ts applyPlaceOverrides): a stop moved from day A to day B whose
 * override still names a day-A node would re-materialize on day A. Dropping the
 * overlay when its node isn't on the stop's new home day is what makes a move
 * clean. Survivors that stay put pass through unchanged — the node-scoped read
 * spine (corridor/stretches.ts scopeRankKey / bucket.ts applyPlaceOverrides)
 * already re-homes them from the fresh geometry.
 *
 * SIGNATURE NOTE. The exploration proposed `(overlays, oldDays, newDays)`. Against
 * the real model `oldDays` is a dead parameter: survival is decidable from
 * `(placeId, nodeId, newDays)` alone, because nodeIds are name/coords-derived, so
 * there is no dayIndex remap to compute against the old layout. Dropped it.
 *
 * Pure. No dnd-kit, no DB, no async — data in, data out.
 */
import type { PlaceNodeOverride } from "@/lib/trips/types";

/** Trip.placeRanks shape — placeId-keyed, node-scoped authored order. */
export type PlaceRanks = Record<string, { nodeId: string; rank: number }>;

/** The two user-authored overlay maps this function rescopes together. */
export type Overlays = {
  placeRanks: PlaceRanks;
  placeOverrides: PlaceNodeOverride[];
};

/** The minimal per-day facts the rescope needs from the NEW layout. */
export type OverlayDayLayout = {
  /** This day's stop POOL — the placeIds it holds BEFORE overrides
   *  (waypoints ∪ segmentSuggestions ∪ suggestions). Membership source; using
   *  the post-override resolved placeIds here would be circular. */
  placeIds: readonly string[];
  /** Node ids available to host a pin on this day (corridorCities[].id). */
  nodeIds: readonly string[];
};

/**
 * Drop the overlays whose stop no longer has a valid home in `newDays`; keep the
 * rest unchanged. When nothing is dropped, returns the SAME object (referentially
 * identical — a true no-op for an unchanged layout).
 */
export function rescopeOverlays(
  overlays: Overlays,
  newDays: readonly OverlayDayLayout[],
): Overlays {
  // placeId → the union of node ids on the day(s) that now hold that stop. A
  // node with a matching id on a day that does NOT hold the stop is excluded —
  // that exclusion is the cross-day pull-in guard.
  const homeNodes = new Map<string, Set<string>>();
  for (const day of newDays) {
    for (const placeId of day.placeIds) {
      let nodes = homeNodes.get(placeId);
      if (!nodes) {
        nodes = new Set<string>();
        homeNodes.set(placeId, nodes);
      }
      for (const nodeId of day.nodeIds) nodes.add(nodeId);
    }
  }

  const survives = (placeId: string, nodeId: string): boolean =>
    homeNodes.get(placeId)?.has(nodeId) ?? false;

  const keptOverrides = overlays.placeOverrides.filter((o) =>
    survives(o.placeId, o.nodeId),
  );
  const keptRankEntries = Object.entries(overlays.placeRanks).filter(
    ([placeId, { nodeId }]) => survives(placeId, nodeId),
  );

  const overridesUnchanged =
    keptOverrides.length === overlays.placeOverrides.length;
  const ranksUnchanged =
    keptRankEntries.length === Object.keys(overlays.placeRanks).length;

  // No-op fast path: unchanged layout → the exact same object back.
  if (overridesUnchanged && ranksUnchanged) return overlays;

  return {
    placeOverrides: overridesUnchanged
      ? overlays.placeOverrides
      : keptOverrides,
    placeRanks: ranksUnchanged
      ? overlays.placeRanks
      : Object.fromEntries(keptRankEntries),
  };
}
