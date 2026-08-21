# 2026-08-21 — Template descriptions, eligibility, provenance, and review (four related calls, one session)

Four decisions from the same investigation-and-build session, recorded
together because they share one thread: what a zero-fabrication template
description is allowed to count for, and how the corpus stays honest about
where a description actually came from. Each is independently
load-bearing — treat this as four ADRs in one file, not one decision with
four parts (same convention as `2026-08-20-corpus-enrichment-and-cleanup-decisions.md`).

## 1. State assignment rebuilt on real TIGER/Line geometry, all six states at once — not a Nevada-only patch

### Context

A manual spot-check caught the Astoria Column (a real, well-known
landmark on the WA/OR border) labeled Oregon when it reads as Washington.
The state assignment used everywhere in this corpus (a bbox classifier
copied from `six_state_footprint()`'s per-state rectangles, whose own
header explicitly says interior-border overlap is deliberately loose for
scope membership, not fact assertion) was never designed to answer "which
one specific state is this point in." A follow-up fix pass was initially
scoped narrowly: **Nevada's box only**, since the blast-radius
investigation found NV→CA alone accounted for the large majority of
disagreements against a real reference boundary.

### Decision

**Scope grew from "patch Nevada's box" to "replace the mechanism for all
six states with real geometry" once the corpus-wide numbers came in.**
The Nevada-only attempt got as far as a working classifier module and
passing unit tests before being superseded — during its own testing, a
real regression surfaced (Las Vegas and Reno, unambiguously Nevada,
resolved to "ambiguous" under a naive multi-box-vote design, because
California's box independently also overreaches into real Nevada
territory). That regression was the concrete signal that patching one
state's box in isolation doesn't compose safely with the other five
boxes' own errors. Rebuilt instead on genuine point-in-polygon
(`ST_Contains`) against US Census Bureau TIGER/Line 2023 state boundaries
(public domain, full resolution, not the lighter cartographic product),
for all six states in one pass. The Nevada-only module was deleted once
the six-state fix made it fully redundant — nothing referenced it.

### Consequences

- New `state_boundaries` PostGIS table + `resolve_state()` function +
  `master_place.state` column, replacing the ad-hoc bbox classifier
  wherever it was previously copy-pasted into scripts.
- Corpus-wide backfill corrected 2,964 of 32,734 in-scope rows (9.05%) —
  NV→CA was 73.96% of the changes, confirming the blast-radius report's
  root-cause finding at full precision, but two smaller, previously
  uncharacterized patterns also surfaced only by doing all six states
  properly: AZ mildly overreaching into NV and CA, and a genuine,
  near-even OR↔WA reclassification along the Columbia River border that
  isn't simply "the old classifier was wrong in one direction."
- `master_place.state` is a **backfilled snapshot, not a live-recomputed
  field** — deliberately NOT wired into `recompute_master_place`. Whether
  it should be is a separate, still-open architectural question (see
  `docs/BACKLOG.md` if/when that's scoped).
- Full report: `docs/measurements/2026-08-21-state-boundary-fix-all-six-states.md`.

## 2. Template descriptions count as eligible (STRONG), but only because `description_source` keeps them distinguishable and excluded from trip generation by default

### Context

~10,292 NONE-bucket rows had zero-fabrication template descriptions
generated (`"{name} is a {category} in {parent}, {state}."`, built only
from fields that already exist in the corpus). The question this session
had to settle: does having one of these change whether a row counts as
"resolved" for description purposes, given the template text is real but
meaningfully thinner than actual source-derived content?

### Decision

**Yes, template descriptions count toward STRONG** — folded into
`isStrong()` in `lib/eligibility.ts` as a new `has_template_description`
signal, same tier as `has_real_description` (a place that already has
resolved description content, real or template, doesn't need further
generation work; template belongs in the same "no further work needed"
category as an externally-referenced signal, not a strictly weaker one).
Corpus-wide: NONE bucket 10,527 → 235.

**But this is conditioned on two things being built in the same pass, not
deferred:** a real `description_source` provenance signal
(`'source'`/`'template'`/`'llm'`/`null`) surfaced on
`master_place_search_export` and live in the Typesense index, so a
template-backed row is never indistinguishable from a source-backed one
downstream; and default exclusion from trip-stop candidacy in
`pois_along_corridor` for rows whose *only* description is a template
(exactly the rows where `mp.description IS NULL` and a template row
exists — a row with real source content plus an unused template backup
is not excluded, see decision #3). Counting toward eligibility is a
statement about "does this description-generation pipeline need to keep
working on this row"; it is explicitly not a statement about "is this
good enough to hand a trip-planner."

### Consequences

- `lib/eligibility.ts`'s `AggregatedSignals` gained a field set outside
  the normal `foldSignalsInto` path (it's master_place-level data from
  `master_place_generated_content`, not per-source_record) — documented
  inline as the one exception to that pattern.
- `master_place_search_export` and `pois_along_corridor` both changed in
  the same pass as the eligibility signal — none of the three ships
  independently without leaving a gap (eligibility alone would silently
  offer thin template rows as trip stops; provenance alone wouldn't
  change what's "resolved"; exclusion alone would still count NONE rows
  as needing work forever).
- Full report: `docs/measurements/2026-08-21-eligibility-provenance-review.md`.

## 3. "Dual" rows (real description + unused template) are flagged for a future audit, not auto-deleted

### Context

The dual-description investigation found rows where `master_place.description`
is technically non-null (so a template was never needed by the
letter of the rule) but the real description is itself boilerplate —
`"NAME (Category)"` name-repeats, or empty `<p>.</p>` HTML — while the
generated template is often the more informative of the two. 1,404 of
1,757 sampled dual rows fell into exactly those two junk patterns.

### Decision

**Do not auto-remove a template row when `master_place.description`
becomes non-null, and do not delete anything found this session.** On
this population, an auto-delete-on-presence rule would in the majority of
cases strip the more informative field and leave a near-worthless
boilerplate or empty fragment behind. The read path
(`master_place_generated_content`'s own header: "show
`master_place.description` when present; fall back to this table only
when null") already handles display precedence correctly for the common
case — the open question this decision defers is display-time judgment
about *quality*, not presence, which is a `web/` decision, not a `data/`
one.

### Consequences

- Flagged as its own `BACKLOG.md` item ("Boilerplate/near-empty
  descriptions inside the STRONG bucket") rather than acted on — the same
  boilerplate pattern likely exists among STRONG-bucket rows with no
  template at all, so a dedicated description-quality audit is the right
  scope, not a one-off cleanup of the 1,757 dual rows specifically.
- If a future pass wants to reduce this population, the precise lever is
  a stricter substantive-description detector at generation/eligibility
  time (flag `"NAME (Category)"` and near-empty-HTML as equivalent to
  null), not a delete-on-presence rule.

## 4. Review/re-queue mechanism: four flat columns on `master_place_generated_content`, not a companion table

### Context

Manual and automated spot-checks need a way to flag a specific generated
row as wrong (the Astoria Column case — a real WA/OR border mislabel
caught by eye) and later pull a worklist of everything flagged. Two
shapes were on the table: columns directly on
`master_place_generated_content`, or a separate companion table joined by
`generated_content_id`.

### Decision

**Four columns directly on the table** (`needs_review boolean default
false`, `review_reason text`, `flagged_at timestamptz`, `flagged_by
text`), plus a partial index on `flagged_at WHERE needs_review = true`
for the worklist query. Rejected the companion-table shape: the actual
requirement is a single CURRENT flag per row, not a flag-history/audit
log — a companion table would add a join to both the write path and the
worklist read with no capability this session needs. If flag history
becomes a real requirement later (e.g. "who flagged this, then who
unflagged it, then who re-flagged it"), that's the point to introduce a
companion table, not before.

### Consequences

- Both required capabilities — flag a row by id, and query the full
  worklist — confirmed queryable directly against TEST in the same pass,
  not just designed on paper.
- `flagged_by` is a freeform string ("manual", "automated_check"), not
  wired to real user auth, matching the explicit scope of this pass.
- A future review-worklist UI is pure reads against this shape — no
  further schema work anticipated unless the flag-history need above
  actually materializes.
