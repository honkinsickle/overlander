/**
 * Fractional-rank sequencing for POIs within a cluster (spec § authored
 * sequence, Option B). A place's ORDER among its siblings lives in a durable,
 * placeId-keyed `Trip.placeRanks` map — independent of node ids, surviving
 * regeneration exactly as placeOverrides do. This is the pure core: given the
 * cluster's INTENDED order after a drag, compute the minimal rank writes.
 *
 * TWO RULES, from the spec's two questions:
 *
 * 1. INTERLEAVE / MATERIALIZE. Rank (a float) and mile (a distance) aren't
 *    comparable, and a partially-ranked cluster is unrepresentable (rank one
 *    place "last" and a naive rule sorts it first). So the cluster is atomic:
 *    the moment ANY member is unranked (first touch, or a newcomer re-bucketed
 *    in), we MATERIALIZE — reseed every member to an integer rank in the given
 *    order. The seed is the caller's current display order (mile on corridor
 *    days, near→far on round-trip days), so the first drag reproduces the
 *    existing order except the moved card. Once materialized, a move is a single
 *    fractional midpoint between the new neighbors — every untouched sibling
 *    keeps its rank.
 *
 * 2. EXHAUSTION. Bisecting the SAME gap underflows a double's 52-bit mantissa
 *    after ~50 inserts. Unreachable in practice (real reorders spread across
 *    slots; each materialize resets gaps to 1.0), and self-healing: if the
 *    midpoint collides with a neighbor we just MATERIALIZE again — the same code
 *    path, no renormalizer, no versioning. Pure.
 */
export type RankWrites = Map<string, number>;

/** Integer gap seeded on materialize — 1.0 → ~50 same-gap bisections before the
 *  self-healing reseed kicks in. */
const SPACING = 1;

/** Reseed the whole cluster to integer ranks in `order` (materialization, and
 *  the underflow fallback). */
function reseed(order: readonly string[]): RankWrites {
  const w: RankWrites = new Map();
  order.forEach((id, i) => w.set(id, i * SPACING));
  return w;
}

/**
 * Compute the rank writes to realize `finalOrder` (the cluster's placeIds in
 * their INTENDED order after the drag, the moved place already at `movedIndex`).
 * Returns a full integer reseed when the cluster isn't fully materialized (or on
 * underflow), else a single `{movedId → midpoint}` write. Merge the result into
 * `Trip.placeRanks`. Pure — no I/O, no mutation of inputs.
 */
export function insertRank(
  finalOrder: readonly string[],
  movedIndex: number,
  ranks: ReadonlyMap<string, number>,
): RankWrites {
  const n = finalOrder.length;
  if (n === 0) return new Map();

  // Rule 1: any unranked member (first touch or a newcomer) → materialize all.
  if (finalOrder.some((id) => ranks.get(id) === undefined)) return reseed(finalOrder);

  // Fully materialized: place movedId between its NEW flanks.
  const movedId = finalOrder[movedIndex];
  const left = movedIndex > 0 ? (ranks.get(finalOrder[movedIndex - 1]) as number) : undefined;
  const right = movedIndex < n - 1 ? (ranks.get(finalOrder[movedIndex + 1]) as number) : undefined;

  // Boundaries: extend one spacing past the lone neighbor.
  if (left === undefined && right === undefined) return new Map([[movedId, 0]]); // singleton
  if (left === undefined) return new Map([[movedId, (right as number) - SPACING]]);
  if (right === undefined) return new Map([[movedId, left + SPACING]]);

  // Middle: midpoint, unless the gap has underflowed → materialize (Rule 2).
  const mid = (left + right) / 2;
  if (mid <= left || mid >= right) return reseed(finalOrder);
  return new Map([[movedId, mid]]);
}
