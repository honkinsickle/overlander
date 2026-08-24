import type { BrowsePlace } from "./places";

/**
 * Verified / Unverified section splitting for a results list.
 *
 * UI-only: this does NOT sort — `resolvePlaces()` already returns the list
 * sorted verified-then-unverified (docs/architecture/resolve-places-design.md
 * §4d). This just inserts a section header at each tier boundary so the tier,
 * which is otherwise invisible (it only affected order), becomes visible.
 *
 * See docs/decisions/2026-08-23-verified-unverified-place-tiers.md and the
 * four surface-cutover plans.
 */

export type TierRow =
  | { kind: "header"; tier: "verified" | "unverified" }
  | { kind: "place"; place: BrowsePlace };

/**
 * True when a list carries meaningful, resolver-produced tier data:
 *   - EVERY place has a `verified` value ("verified" | "unverified"), AND
 *   - the list is already sorted verified-then-unverified (no verified appears
 *     after an unverified).
 *
 * Only the `resolvePlaces()` path produces both — it stamps `verified` on every
 * place (design §D7) and sorts by tier. The legacy paths leave live results
 * without `verified` (so the "every" check fails), or leave federated rows in
 * relevance order (so the "sorted" check fails). Surfaces that never cut over
 * (Date Detail, Day Column) render tiles with no `verified` at all, so this is
 * false there too. Hence: no flag reading — the data itself gates the headers.
 */
export function hasSortedTierData(places: BrowsePlace[]): boolean {
  if (places.length === 0) return false;
  let seenUnverified = false;
  for (const p of places) {
    if (p.verified !== "verified" && p.verified !== "unverified") return false;
    if (p.verified === "unverified") {
      seenUnverified = true;
    } else if (seenUnverified) {
      // a verified AFTER an unverified → not sorted verified-first
      return false;
    }
  }
  return true;
}

/**
 * Insert a section header at each tier boundary of an already-sorted list.
 *
 * When the tier data isn't meaningful (see `hasSortedTierData`), returns the
 * places with NO headers — so flag-off / not-cut-over surfaces render exactly
 * as before. Pure: only divider insertion, never a re-sort.
 *
 * A single-tier list gets ONE header (all-Verified → "Verified"; all-Unverified
 * → "Unverified"). Decision + tradeoff in the PR: a header per non-empty tier is
 * consistent (results are always grouped by trust when the flag is on) and the
 * all-Unverified case gets a genuine "these are all unverified" cue; the cost is
 * a lone "Verified" header on dense all-verified areas, accepted for consistency.
 */
export function splitByTier(places: BrowsePlace[]): TierRow[] {
  if (!hasSortedTierData(places)) {
    return places.map((place) => ({ kind: "place", place }));
  }
  const rows: TierRow[] = [];
  let prev: "verified" | "unverified" | null = null;
  for (const place of places) {
    const tier = place.verified === "verified" ? "verified" : "unverified";
    if (tier !== prev) {
      rows.push({ kind: "header", tier });
      prev = tier;
    }
    rows.push({ kind: "place", place });
  }
  return rows;
}
