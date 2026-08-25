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

/** State words stripped before comparing a candidate's name to a city label,
 *  so "Carson City, Nevada" and "Carson City, NV" both reduce to the town. */
const STATE_WORDS: ReadonlySet<string> = new Set([
  "california", "ca", "nevada", "nv", "utah", "ut",
  "arizona", "az", "washington", "wa", "oregon", "or",
]);

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop trailing state words: "carson city nevada" → "carson city". */
function stripStateWords(s: string): string {
  const parts = normalizeForCompare(s).split(" ");
  while (parts.length > 1 && STATE_WORDS.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/**
 * Is this candidate just the anchor city under another name?
 *
 * MEASURED NEED: a live run backfilled the corpus row literally named
 * "Carson City, Nevada" (`primary_category=park_feature`, so it cleared the
 * category gate honestly) as the featured stop for the "Carson City, NV" node
 * — a town presented as the thing to see in that town `[measured 2026-08-25]`.
 * Excluding the `urban` slide bucket does not catch this, because the row is
 * not bucketed `urban`.
 *
 * Deliberately EXACT-after-state-stripping, not substring: "Riverside Park"
 * near Riverside is a legitimate stop and must survive. Only a name that
 * reduces to exactly the city is rejected.
 */
export function isCityTautology(candidateName: string, cityLabel: string): boolean {
  const city = stripStateWords(cityLabel.split(",")[0]);
  if (!city) return false;
  return stripStateWords(candidateName) === city;
}

export type AnchorBackfillInput = {
  /** `[lng, lat]` of the day's start anchor. */
  anchor: [number, number];
  /** Display label of the anchor, when known. Used only to reject a candidate
   *  that is just the city itself (see `isCityTautology`). */
  anchorLabel?: string;
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
  const { anchor, anchorLabel, pool, keptRefs, onCorridor } = input;

  const candidates = pool.filter((p) => {
    if (keptRefs.has(p.id) || keptRefs.has(p.name)) return false;
    if (!p.category || !OPENER_CATEGORIES.has(p.category)) return false;
    // A town is not the thing to see in that town.
    if (anchorLabel && isCityTautology(p.name, anchorLabel)) return false;
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
 * Cap on machine-picked stops per day, START anchor and mid-corridor cities
 * together.
 *
 * REASONED CALL, and the alternative was explicitly rejected. Covering EVERY
 * bare corridor city was the obvious generalization and is the wrong one: the
 * model contributes a small handful of real key stops per day (the prompt asks
 * for 2–4), so letting machine picks reach or exceed that count flips the
 * day's character — a "key stop" that appears at every town is no longer a key
 * stop, it is a list of towns. The cap keeps backfills a patch over the worst
 * gaps rather than a second, blander itinerary layered on the real one.
 *
 * Two, not one: one slot is routinely consumed by the start anchor (the case
 * #275 shipped for), so a cap of one would mean mid-corridor cities are only
 * ever covered on days the model already opened well — precisely backwards.
 * Two is deliberately conservative; a bare node is an acceptable outcome and
 * always was.
 */
export const MAX_BACKFILLS_PER_DAY = 2;

/** One backfilled pick and the anchor that motivated it. */
export type BackfillPick = {
  poi: PoolPOI;
  /** Which kind of gap this filled — the note and any downstream consumer can
   *  tell a day-opener from a mid-route town without re-deriving geometry. */
  kind: "start" | "corridor";
  /** Display label of the anchor (day start place, or corridor city name). */
  anchorLabel: string;
};

export type BackfillAnchor = {
  coords: [number, number];
  label: string;
  kind: "start" | "corridor";
};

/**
 * Fill bare anchors for ONE day, in the order given, up to the cap.
 *
 * Deliberately a thin loop over `pickAnchorStop` rather than a second
 * mechanism: every gate, the ranking, and the null-rather-than-pad contract
 * are inherited unchanged. The only things this adds are ordering, the cap,
 * and cross-anchor dedupe.
 *
 * `anchors` should be supplied in the order the traveller meets them, so that
 * when the cap bites it drops the LATEST gaps rather than arbitrary ones — an
 * empty morning is felt more than an empty afternoon, which is the same
 * intuition #274's prompt text and #275's start-anchor scope were built on.
 *
 * Cross-anchor dedupe matters more than it looks: two corridor cities can sit
 * close enough that one POI is the best candidate for both, and without
 * threading each pick back into `keptRefs` the same place would be featured
 * twice on one day.
 */
export function pickBackfillStops(input: {
  anchors: readonly BackfillAnchor[];
  pool: PoolPOI[];
  keptRefs: ReadonlySet<string>;
  onCorridor: (coord: [number, number]) => boolean;
  max?: number;
}): BackfillPick[] {
  const { anchors, pool, onCorridor } = input;
  const max = input.max ?? MAX_BACKFILLS_PER_DAY;
  const taken = new Set(input.keptRefs);
  const picks: BackfillPick[] = [];

  for (const anchor of anchors) {
    if (picks.length >= max) break;
    const poi = pickAnchorStop({
      anchor: anchor.coords,
      anchorLabel: anchor.label,
      pool,
      keptRefs: taken,
      onCorridor,
    });
    if (!poi) continue; // nothing qualified here — the node stays bare
    picks.push({ poi, kind: anchor.kind, anchorLabel: anchor.label });
    taken.add(poi.id);
  }
  return picks;
}

/**
 * Is this anchor already served by something kept (or already backfilled)?
 *
 * Same proximity rule the picker uses, so "covered" and "eligible" cannot
 * disagree — a city is bare precisely when nothing sits within the radius that
 * would have qualified a pick for it.
 */
export function anchorIsBare(
  coveredCoords: readonly [number, number][],
  anchor: [number, number],
): boolean {
  return !hasStopNearAnchor(coveredCoords, anchor);
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

/**
 * The note for a MID-CORRIDOR backfill — a town the route passes through that
 * is neither the day's start nor its end.
 *
 * Same discipline as `anchorStopNote`: strictly positional, no quality claim.
 * Distinct wording ("along the way through") so a start-anchor backfill and a
 * corridor backfill are tellable apart downstream by note alone, which is how
 * both are currently identified in a persisted payload — `KeyStop.note` is the
 * only part of this decision that survives generation.
 */
export function corridorStopNote(cityName: string): string {
  return `near ${cityName}, along the way through`;
}
