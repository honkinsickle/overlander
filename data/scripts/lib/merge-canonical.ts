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
 *
 * This module also owns `resolveGroupMembers()` — the split between members
 * that actually merge and members deliberately excluded from the merge. It
 * lives here rather than in the executor because the canonical pick must be
 * computed over the MERGING members only: excluding a member can change who
 * wins, so the two operations cannot be separated without introducing drift.
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

export interface GroupMemberSplit<T extends MemberForCanonical> {
  /** Members that participate in the merge (canonical + absorbed). */
  merging: T[];
  /** Members deliberately held out — the executor must not touch these. */
  excluded: T[];
}

/**
 * Split a group's members into the ones that merge and the ones deliberately
 * excluded.
 *
 * Why this exists: the union-find grouping in the dry-run tool pulls in any
 * master_place connected by a SAME pair, but "connected" is not always "the
 * same real-world place". Group 83 (Hat Rock, OR) is the worked example — the
 * NPS `Hat Rock` row is the rock formation *inside* Hat Rock State Park, not
 * another copy of the park, so it must survive the merge untouched while its
 * two group-mates collapse together.
 *
 * Excluding is deliberately NOT the same as deleting the member from the group
 * file. Keeping it listed in `member_sides` with an `excluded_ids` entry
 * preserves the record that the grouping saw it and that a human ruled on it.
 *
 * Throws rather than silently coercing on every malformed case — this feeds a
 * write path, so an unrecognised id is a stop, not a no-op.
 */
export function resolveGroupMembers<T extends MemberForCanonical>(
  members: T[],
  excludedIds: readonly string[] | undefined,
): GroupMemberSplit<T> {
  const excludeSet = new Set(excludedIds ?? []);
  if (excludeSet.size === 0) return { merging: members, excluded: [] };

  const memberIds = new Set(members.map((m) => m.id));
  const unknown = [...excludeSet].filter((id) => !memberIds.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `excluded_ids contains id(s) that are not members of this group: ${unknown.join(", ")}`,
    );
  }

  const merging = members.filter((m) => !excludeSet.has(m.id));
  const excluded = members.filter((m) => excludeSet.has(m.id));

  // A merge needs a canonical plus at least one absorbed row. Excluding down
  // to 0 or 1 member means the group should have been dropped, not merged.
  if (merging.length < 2) {
    throw new Error(
      `excluding ${excludeSet.size} member(s) leaves ${merging.length} — a merge needs at least 2. ` +
        `Drop the group instead of excluding into a no-op.`,
    );
  }

  return { merging, excluded };
}
