/**
 * Shared canonical-selection logic for the SAME-bucket merge tooling.
 *
 * Extracted from data/scripts/merge-preview-same-pairs.ts (PR #374) so both
 * the dry-run preview AND the merge executor use the exact same rule. If
 * this file's behavior changes, both consumers change together — no drift.
 *
 * Rule, unchanged from PR #374's inline v2 implementation:
 *   score = 100 · has(state_parks)
 *         + 10  · (has(state_parks) ∧ ¬has(any visitor-source))
 *         + source_ids.length
 * Highest score wins. If the top score is tied across ≥2 members, the
 * group is undecidable — the picker returns `null` rather than guessing.
 *
 * The "undecidable" outcome is a first-class value in the return type; the
 * executor MUST treat it as a hard stop for that group. See PR #379 for the
 * 8 undecidable groups this rule produces on the current SAME-bucket set.
 */

/** The six visitor-content source_ids (one per state, six-state promotion). */
export const VISITOR_SRC = new Set([
  "california_state_parks",
  "washington_state_parks",
  "oregon_state_parks",
  "nevada_state_parks",
  "arizona_state_parks",
  "utah_state_parks",
]);

/**
 * Minimal member shape needed for canonical selection. Consumers pass their
 * own Side/Member type; only these fields are read.
 */
export interface MemberForCanonical {
  id: string;
  source_ids: string[];
}

export interface CanonicalPick<T extends MemberForCanonical> {
  canonical: T | null;
  reason: string;
}

/**
 * Score one member. Higher = better canonical candidate.
 *
 * The 100 vs 10 gap keeps state_parks-GIS backing dominant over the
 * "untagged GIS home" tiebreaker, which itself dominates raw source count.
 * That ordering matches the parent investigation's precedent
 * (docs/investigations/2026-09-02-cross-source-duplicates.md §3).
 */
export function scoreMember(s: MemberForCanonical): number {
  const has_gis = s.source_ids.includes("state_parks");
  const has_visitor = s.source_ids.some((x) => VISITOR_SRC.has(x));
  let score = 0;
  if (has_gis) score += 100;
  if (has_gis && !has_visitor) score += 10;
  score += s.source_ids.length;
  return score;
}

/**
 * Pick the canonical member across an arbitrary-sized group. Ties at the
 * top score → undecidable (returns `null`). Consumers that want an
 * override for undecidable groups MUST apply it explicitly, not by adding
 * heuristics here — every extra heuristic weakens the "undecidable is
 * genuinely ambiguous" signal that the manual-decision doc (PR #379)
 * relies on.
 */
export function pickCanonicalGroup<T extends MemberForCanonical>(
  members: T[],
): CanonicalPick<T> {
  if (members.length === 0) return { canonical: null, reason: "empty group" };
  if (members.length === 1) return { canonical: members[0], reason: "single-member group" };
  const scored = members.map((m) => ({ m, s: scoreMember(m) }));
  const max = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === max);
  if (top.length === 1) {
    const w = top[0].m;
    const has_gis = w.source_ids.includes("state_parks");
    const has_visitor = w.source_ids.some((x) => VISITOR_SRC.has(x));
    const reason = has_gis
      ? has_visitor
        ? "state_parks-GIS-backed row wins (also visitor-tagged; no better GIS candidate in group)"
        : "state_parks-GIS-backed row wins (untagged GIS home)"
      : "no GIS-backed row in group; row with most sources wins";
    return { canonical: w, reason };
  }
  return {
    canonical: null,
    reason: `${top.length} members tie at score ${max} — needs manual review`,
  };
}
