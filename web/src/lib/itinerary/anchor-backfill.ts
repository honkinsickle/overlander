/**
 * Start-of-day key-stop backfill (follow-up to #274).
 *
 * WHY. #274 added a SPREAD instruction to the prompt asking the planner to
 * distribute key stops across a day's corridor cities. Measured: coverage
 * improved mid-corridor and at day-end anchors, but the START of a day stayed
 * frequently empty — the exact case the prompt calls out by name. A prompt
 * nudge is a preference; this is the mechanism.
 *
 * WHAT. After the audit has ground the model's own key stops, if NOTHING it
 * kept sits near the day's start anchor, pick one candidate from the corpus
 * pool the model was already given as its palette. Deterministic, no LLM
 * re-ask, no network call — `facts.poolPOIs` is already in memory.
 *
 * WHAT IT IS NOT. It is not a quota. If nothing clears the bar below, this
 * returns null and the day starts with no curated stop — a bare node is
 * correct; a padded irrelevant one is not. That is the explicit requirement
 * and the reason every filter here is a hard gate rather than a score.
 *
 * ⚠ RATING IS NOT PART OF THE BAR, AND CANNOT BE TODAY. `PoolPOI.rating` comes
 * from `master_place.rating`, which is NULL corpus-wide — no ingested source
 * carries a rating `[measured 2026-08-21,
 * docs/measurements/2026-08-21-master-place-enrichment-columns.md]`. The
 * rating comparison in `rank` is therefore inert in practice and kept only so
 * this ranks correctly if/when ratings are ever populated from a source whose
 * terms permit storing them. The bar that actually bites is
 * category + proximity + the caller's corridor guard.
 */

import type { PoolPOI } from "./facts";
import { haversineMi } from "@/lib/routing/point-to-polyline";

/**
 * Categories worth featuring as a day's first curated stop.
 *
 * Deliberately narrower than "not suppressed". The corpus fold already drops
 * standalone amenities (`isSuppressedCategory` — dump_station, water, toilet,
 * …), but four buckets survive that still make poor openers:
 *   - `interest` is the fallback bucket anything unmapped lands in, so it is a
 *     junk drawer, not a category.
 *   - `urban` IS the town — featuring it under its own node is a tautology.
 *   - `fuel` is a errand, not a stop worth a curated card at mile zero.
 *   - `overnight` is the overnight's job, not a key stop's.
 */
const OPENER_CATEGORIES: ReadonlySet<string> = new Set([
  "scenic",
  "food",
  "oddity",
  "attraction",
  "camping",
]);

/**
 * How close to the day's start anchor a candidate must sit.
 *
 * A CHOSEN CONSTANT, not a measured threshold. The intent is "somewhere you'd
 * stop in the first stretch out of town", so it is deliberately far tighter
 * than the audit's own on-corridor guard (`GUARD_MI`), which exists to reject
 * wrong-region resolutions and is much too loose to mean "near the start".
 * Tightening it yields fewer, more relevant backfills; loosening it drifts
 * toward "somewhere on the first leg", which the model already covers.
 */
export const ANCHOR_NEAR_MI = 25;

export type AnchorBackfillInput = {
  /** `[lng, lat]` of the day's start anchor. */
  anchor: [number, number];
  /** The palette the model itself was given. */
  pool: PoolPOI[];
  /** Refs already kept for this day — corpus ids on pool-hits, names on
   *  live-resolves. Prevents re-picking what the model already chose. */
  keptRefs: ReadonlySet<string>;
  /** The caller's day-corridor guard, applied unchanged so a backfill clears
   *  exactly the same geometric test the model's own picks did. */
  onCorridor: (coord: [number, number]) => boolean;
};

/**
 * Pick one opener for the day's start anchor, or null when nothing qualifies.
 *
 * Pure — no I/O, no clock, no randomness — so the bar is unit-testable and the
 * same inputs always yield the same pick.
 */
export function pickAnchorStop(input: AnchorBackfillInput): PoolPOI | null {
  const { anchor, pool, keptRefs, onCorridor } = input;

  const candidates = pool.filter((p) => {
    if (keptRefs.has(p.id) || keptRefs.has(p.name)) return false;
    if (!p.category || !OPENER_CATEGORIES.has(p.category)) return false;
    if (haversineMi(p.coords, anchor) > ANCHOR_NEAR_MI) return false;
    // Same guard the model's picks passed — never a looser test.
    return onCorridor(p.coords);
  });
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => rank(a, anchor) - rank(b, anchor))[0];
}

/**
 * Lower is better: rating, then how well the row will actually RENDER, then
 * proximity.
 *
 * ⚠ The richness term is not cosmetic, it is the fix for a measured defect.
 * The first live runs of this backfill picked `atlas_oddities` rows three
 * times out of four — rows carrying no photo, no description and no rating,
 * which render as an empty placeholder card `[measured 2026-08-25]`. The
 * `oddity` bucket in this corpus is dominated by that source, so ranking on
 * proximity alone systematically surfaces the THINNEST rows available.
 *
 * This is a preference, not a gate: a thin row still wins over no stop at all
 * when it is the only thing near the anchor. Gating on richness would empty
 * the very starts this exists to cover.
 */
function rank(p: PoolPOI, anchor: [number, number]): number {
  // See the rating caveat in the module header — inert while corpus ratings
  // are null, correct the moment they are not.
  const ratingPenalty = typeof p.rating === "number" ? -p.rating * 1000 : 0;
  // Weighted below rating, above distance: a renderable row beats a nearer
  // blank one, but never beats a genuinely better-rated place.
  const richnessPenalty = (p.hasPhoto ? -60 : 0) + (p.hasDescription ? -30 : 0);
  return ratingPenalty + richnessPenalty + haversineMi(p.coords, anchor);
}

/**
 * Does any already-kept stop sit near the anchor?
 *
 * Keyed on coords, not name: a kept stop is a corpus id (pool-hit) or a bare
 * name (live-resolve), and only the former can be looked up in the pool — so
 * the caller passes the coords it already resolved for each kept stop.
 */
export function hasStopNearAnchor(
  keptCoords: readonly [number, number][],
  anchor: [number, number],
): boolean {
  return keptCoords.some((c) => haversineMi(c, anchor) <= ANCHOR_NEAR_MI);
}

/**
 * The note a backfilled stop carries into `KeyStop.note` (required by schema).
 *
 * STRICTLY POSITIONAL. It asserts nothing about the place itself — no quality
 * claim, no description, nothing the corpus did not tell us — because a
 * fabricated note on a machine-picked stop is exactly the grounding failure
 * the whole audit exists to prevent. Proximity is true by construction: the
 * candidate cleared `ANCHOR_NEAR_MI` against this anchor.
 */
export function anchorStopNote(startPlace: string): string {
  return `near ${startPlace}, at the start of the day`;
}
