# Link the overnight to its existing spine tile

2026-08-24. Implements the overnight slice recommended in
`docs/decisions/notes-to-spine-gap.md` (PR #278). Branch `overnight-spine-tile`.

## Context

The notes-to-spine investigation found the overnight is already a structured,
grounded field — `audit.ts` grounds `overnight.name` pool-first → live-resolve
→ on-corridor guard — and, when it grounds, its place is already present on the
spine (a live-resolved overnight becomes a `segmentSuggestions` tile via
`bake.ts:resolvedToTile`; a pool-hit overnight arrives via the corpus fold). The
gap was **labeling and duplication**, not resolution: the tile was never marked
as the overnight, and the same place was emitted three independent times — an
unlabeled spine tile, the "Camping" briefing block (from `day.overnight`), and
an "Overnight —" prose line in `day.notes`.

Note: production had **no** overnight→tile matching at all. The "lenient
substring match" #278 mentions was only in that investigation's throwaway
measurement script; this change adds a real match to production for the first
time, by **identity**, not substring.

## Decision

- **Match by canonical id, not name.** `audit.ts` records
  `DayAudit.overnightRef` — the id of the tile that IS the overnight: a corpus
  id on a pool-hit, `google:<placeId>` on a live-resolve (derived by
  `overnightTileRef`, which reads the same `groundReference` outcome that grounds
  the overnight). `null` on a desc-only / dropped overnight.
- **Mark the one tile.** `bake.ts:markOvernightTile` flags the tile whose id
  equals `overnightRef` as `isOvernight`, and sets `curated` so it is featured
  on the spine (the spine demotes non-curated tiles in `curatedMode`) rather
  than lost in the pool. Its status line carries the overnight's rationale. Pure
  and unit-tested; a no-op when `overnightRef` is null or matches no tile.
- **Single source of truth, no triplication.**
  - The spine tile badges as "Overnight" (`pickStatus` in
    `day-detail-corridor.tsx`, threaded via `placePool`).
  - The "Camping" briefing block **derives from that tile** when present
    (`day-briefing-card.tsx`), falling back to `day.overnight` only when there
    is no tile.
  - `to-trip.ts:dayNotes` **drops the redundant "Overnight —" prose line** when
    the overnight is on the spine.
- **Fallback, never a forced match.** When the overnight is desc-only or off
  this day's corridor (no tile), nothing is marked, the Camping block reads
  `day.overnight`, and the prose line stays — the same empty/fallback-over-a-
  bad-pick posture as #275. The `MAX_BACKFILLS_PER_DAY` cap and the #276
  backfill are untouched: this links an already-resolved place, it does not
  resolve or pick anything.

## Consequences

- **Existing trips are unaffected.** The bake/notes changes only run at
  generation time, so stored payloads keep their old notes. On render, an
  existing trip has no `isOvernight` tile, so `pickStatus` returns the note
  unchanged and the Camping block falls back to `day.overnight` — byte-identical
  behavior. Only newly generated trips gain the link.
- **The overnight rides the curated-pick path** (featured + badged) rather than
  a bespoke overnight node style. This is the surgical reuse of existing
  machinery; a fully distinct overnight node treatment is a follow-up.
- **Verification:** unit-tested (`overnight-tile.test.ts`, the two new
  `to-trip.test.ts` cases) plus the full `typecheck` + `next build` gate, both
  exit 0. **Not verified via a live end-to-end generation** — that needs the
  authed wizard + LLM, out of reach here; the audit→bake wiring is covered by
  the pure-helper tests and the type gate, not an integration run.

### Open UX questions — flagged, not decided

Per the standing rule (product/UX calls surfaced, not made unilaterally):

1. **Should the "Camping" briefing block remain at all** once the overnight is a
   labeled spine node, or is the block now redundant with the tile? Kept for now
   (deriving from the tile) rather than removed.
2. **Exact overnight affordance** — this uses an "Overnight ·" status prefix on
   the featured card; a distinct badge/icon or a dedicated overnight node style
   may read better.
3. **Overnight == the end-town node.** When the overnight IS the day's end city
   (a town, e.g. "Moab, UT"), its tile is stripped as node-identical, so no
   separate tile is marked and the prose line stays. Whether the end **node**
   itself should be labeled "overnight" is unaddressed.
