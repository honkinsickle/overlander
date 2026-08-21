# 2026-08-20 — Corpus enrichment and cleanup decisions (four related calls, one session)

Four decisions from the same investigation session, recorded together because
they share one thread: what to do about thin/blank corpus rows, and what NOT
to spend Google API budget on until the picture is clearer. Each is
independently load-bearing — treat this as four ADRs in one file, not one
decision with four parts.

## 1. Google Places content warehousing ruled out on compliance grounds; live-fetch-at-render is the only compliant path, and it's parked

### Context

The original plan (per the still-open `docs/decisions/2026-08-13-google-places-strategy-open-question.md`)
assumed grounding could attach a stable Google identity and then store
whatever Place Details fields were useful — `editorialSummary` in
particular, as candidate description text for thin corpus rows.

### Decision

**Ruled out.** Investigated Google's Places API (New) caching policy
directly (`docs/measurements/2026-08-20-google-places-details-compliance-check.md`).
Only two things are cacheable indefinitely: `place_id` and coordinates
(30-day limit on the latter). Every other field — `editorialSummary`,
`websiteUri`, `internationalPhoneNumber`, `regularOpeningHours`, `rating`,
`userRatingCount` — carries **no caching exception at all**. This is a
field-based restriction, not a display-based one: it applies identically
whether the content renders on a map or as our own UI text, and the Places
UI Kit carries the same terms as the raw API. There is no version of "fetch
once, store forever" that is compliant for this content.

**The only compliant path is live-fetch-at-render** — call Place Details at
view time, keyed on a stored `place_id`, and never persist the result. This
trades a storage cost for a cost-per-render-plus-latency shape, which is a
different architecture than what was scoped, not a tuning knob on the
existing one.

### Consequences

- Parked in `docs/BACKLOG.md` §"Surfaced 2026-08-20 (Google Places
  compliance check)", explicitly sequenced **after** the LLM-enrichment pass
  (decision #2 below) — the enrichment ceiling on existing corpus data
  should be established before committing to Google integration work.
- **Related, unresolved compliance gap surfaced in passing, not yet
  triaged:** the existing 127 `google_resolved`/`google` source_records
  already store non-exempt fields (`displayName`, `formattedAddress`)
  indefinitely with no refresh policy. This predates today's session and is
  a live gap, not a new one introduced today.
- The still-open `2026-08-13` ADR's Option A/B (Google grounding +
  hydration) is now effectively answered for the storage half: whatever is
  decided about identity-grounding, the *value* side cannot be warehoused.
  That ADR is not marked superseded here — it covers grounding identity,
  which this finding doesn't resolve — but this decision should be read
  alongside it.

## 2. LLM description enrichment scoped to STRONG/WEAK bucket only; atlas_oddities explicitly excluded

### Context

With Google content warehousing off the table, the alternative for thin
corpus rows is LLM-generated description text from fields already in the
corpus. That needs a defined target population — generating text for every
row regardless of what data backs it risks fabrication with nothing to
ground against.

### Decision

**Target population: STRONG or WEAK bucket, no existing real description —
8,782 rows** (`docs/measurements/2026-08-20-llm-description-generation-pilot.md`
§2). NONE-bucket rows are excluded categorically — by definition they carry
no real signal to generate from, so an LLM asked to describe them can only
fabricate.

**`atlas_oddities` further excluded — 8,782 − 1,628 = 7,154 corrected
target.** Investigated directly rather than assumed: 0 of 2,866 active
`atlas_oddities` rows corpus-wide have any description text at all, yet
1,628 of the 8,782 target rows carry an atlas_oddities source and are
STRONG-bucketed anyway — because their STRONG signal comes from tags/hours
metadata, not narrative content. Real, interesting content likely exists for
these places (oddities are inherently descriptive subjects) but it isn't
present in the ingested corpus data — there's nothing to ground an LLM
generation against without inventing it. Excluding them is a data-grounding
call, not a judgment that oddities are low-value.

### Consequences

- 7,154 rows is the corrected, current target population for any future
  bulk generation run. Not yet run at scale — only the 27-row controlled
  sample below.
- If atlas_oddities content is ever wanted, it needs its own sourcing work
  (better ingestion of the adapter's own descriptive fields, or a
  differently-scoped generation approach) — not a relaxation of this
  exclusion.

## 3. Prompt redesign that fixed fabrication (41% → 4%, small-sample result)

### Context

The first 27-row generation pass (original prompt, target-population sample)
showed real fabrication: 11/27 (41%) any-fabrication, 4/27 (15%) severe
(multiple invented quantitative/historical facts) — specific acreages,
elevations, sub-area names, and historical claims not present in any
provided field.

### Decision

**Redesigned the system prompt** (full text in
`docs/measurements/2026-08-20-llm-description-prompt-iteration.md`) around
three explicit rules: never state a specific number not present in the
provided fields, never name a specific landmark/sub-area/administering unit
not literally provided, and match output length to how much real field data
exists (one thin, honest sentence beats a padded invented one). Re-ran on
the **exact same 27 place IDs**, same model, prompt-only change.

**Result: any-fabrication 41% → 4% (11/27 → 1/27); severe fabrication
15% → 0% (4/27 → 0/27).** All four previously-severe cases were re-examined
side by side and no longer fabricate specifics.

**Flagged explicitly: this is a small-sample result (n=27), not certified at
corpus scale.** One residual any-fabrication case remains (reported
honestly, not treated as a clean win) and a grading-consistency question was
noted in the report ("Uinta Mountains" graded as fabrication while a
structurally identical addition elsewhere was graded clean) — meaning the 4%
figure is soft and could read closer to ~7% under a fully consistent
standard. Do not cite 4% as a corpus-scale guarantee.

### Consequences

- The redesigned prompt is the one to use for any future generation work
  against the 7,154-row target population — not the original.
- A larger validation sample (beyond 27) is needed before this rate is
  trusted at scale. Not scheduled.
- The grading-consistency gap is a methodology note for whoever runs the
  next validation pass, not a fix already made.

## 4. Deactivate unnamed placeholder rows rather than attempt to enrich them

### Context

The NONE-bucket characterization found two large populations of rows whose
`canonical_name` is a literal placeholder string generated by entity
resolution when no real name exists — `"Unnamed picnic area"` (3,481
picnic_area rows) and `"Unnamed ev charging"` (931 ev_charging rows,
confirmed as a genuinely distinct pattern from picnic_area's, not assumed —
see `docs/measurements/2026-08-20-unnamed-ev-charging-deactivation.md` §1).
Within each, the subset that also has no other real signal (NONE bucket) is
a coords-only stub: no name, no description, no usable tags.

### Decision

**Deactivate the placeholder-named, NONE-bucket subset of each category,
rather than attempt LLM enrichment on them.** A coords-only stub has nothing
for an LLM to generate from except the category label and location —
exactly the shape most likely to produce fabricated, generic filler text.
Deactivation (the same TEST mechanism as Phase 0's peak/spring
deactivation: `source_record.is_active = false` → `recompute_master_place()`
→ dangling-`place_match` cleanup) removes them from search/browse/generation
without deleting the underlying data — reversible, and consistent with how
this corpus has handled other low-value populations.

**Deliberately excluded from deactivation:** placeholder-named rows that
*are* STRONG or WEAK bucket (53 + 1 for picnic_area, 177 + 6 for
ev_charging) — these carry real signal from another attached source despite
the stub display name, so deactivating them would destroy real corpus
content over a cosmetic naming gap. And all real-named rows regardless of
bucket (1,187 picnic_area, 2,703 ev_charging) — a real name is a different
question from a missing one, out of scope for this pass.

### Consequences

- **3,427 picnic_area + 748 ev_charging = 4,175 rows deactivated on TEST**,
  verified excluded from `master_place_search_export` and from live
  `pois_along_corridor` generation (0/5 spot-checked in each pass still
  surfaced). Full detail:
  `docs/measurements/2026-08-20-unnamed-picnic-area-deactivation.md`,
  `docs/measurements/2026-08-20-unnamed-ev-charging-deactivation.md`.
- **TEST only.** No PROD equivalent has been run or authorized.
- The real-named remainders (1,187 picnic_area, 2,703 ev_charging) and the
  campground/dispersed_camping mixed-naming pattern noticed but not
  investigated are carried forward in `docs/BACKLOG.md` §"Surfaced
  2026-08-20 (deactivation pass follow-ups)" — this decision does not close
  those categories, only the confirmed-placeholder slice within two of them.
