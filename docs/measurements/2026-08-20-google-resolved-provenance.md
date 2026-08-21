# Provenance investigation: the 127 `google`/`google_resolved` source_records

Read-only investigation, 2026-08-20. No API calls, no writes, no code changes.
Follow-up to `2026-08-20-corpus-gap-scan.md`, which measured Google linkage as
127 active `google`/`google_resolved` source_record rows against a
corpus-wide denominator (84,999 active source_record / 38,950 in-scope
master_place) and characterized it as a "0.15%–0.22% coverage" figure. This
investigation asks whether that framing is correct — was Google matching ever
attempted corpus-wide, or only against a small, unrelated-scope subset?

**Answer, upfront: the latter.** The 127 rows are not the result of any
corpus-wide (or even corpus-sampled) Google matching attempt. They are a
byproduct of the app's itinerary-generation grounding pipeline — every time a
trip is generated or NL-edited on TEST, place names the LLM proposes get
resolved against Google as a fallback when they don't hit the existing
corpus pool, and only names that resolve get written back. The process has
**never had the corpus as its input at all** — its input is "place names an
LLM happened to mention across however many trip generations have run on
TEST." The corpus-wide percentage in the prior report is a real, correctly
computed number, but it answers a different question than "match rate" — see
§5.

## 1. The mechanism

**Code:** `web/src/lib/itinerary/ingest.ts`, function `enqueueResolvedPlaces`.
Upserts each resolved place as a `source_record` via the existing
`upsert_source_record` RPC, `source_id = "google_resolved"`,
`external_id = "google:<place_id>"`. Idempotent; does not trigger entity
resolution or touch `master_place`.

**Called from two places, both AFTER a successful trip persist, both
TEST-guarded at the call site:**
- `web/src/lib/plan/expedition-actions.ts` (`generateExpeditionTripAction`,
  the wizard generation path) — line ~166, gated on
  `currentProjectRef().label === "TEST"`.
- `web/src/lib/itinerary/edit-actions.ts` (NL re-plan path) — line ~585,
  gated by `checkNlRails` → `checkRailsWithFlag`'s own hardcoded `TEST_REF`.

**What feeds it — `resolvedPlaces`, from the generation/edit AUDIT step**
(`web/src/lib/itinerary/audit.ts`): for every day of a generated (or
re-planned) trip, each keyStop name, endpoint, and overnight name is grounded
**pool-first** against the existing corpus (`poolByName`), and only if that
misses does it fall to a **live Google Places Text Search** (`resolve.ts`,
`PlaceResolver.resolve()`). A result is kept only if it also passes a
corridor-distance guard (rejects off-route ambiguous matches). Only
successfully-resolved, guard-passing names ever reach `resolvedPlaces` — and
therefore ever reach `enqueueResolvedPlaces` / `source_record`.

**This is the "three-tier grounding" model, spec `docs/specs/expedition-planner.md`
§8.3** (`ingest.ts`'s own docstring cites "spec §8.3"). It is a per-trip
grounding mechanism, not a corpus-matching batch job. `docs/decisions/
2026-07-23-corpus-writeback-dormant.md` describes it explicitly as a
**"corridor-densification tool"** whose scope is **"only the places trips
actually touch"** — its own design document already states the property this
investigation was asked to confirm.

**Confirmed via git log:** the wiring commit (`b39198c feat(itinerary): wire
enqueueResolvedPlaces at the two persist points`) and the resolver/audit code
(`bb90ae3 feat(itinerary): three-tier grounding + corridor bake for generated
days`) are dated **2026-07-11** (three-tier grounding) and **2026-07-23**
(write-back wiring) in `git log --follow` author dates.

## 2. Scope of a single run — the cap, not a corpus query count

There is no logged aggregate "N places attempted" metric anywhere in the
repo (no telemetry table, no run-history log for this mechanism) — so task
2's literal ask ("how many places did the LAST run attempt") cannot be
answered with an exact historical number. What IS found in code and docs,
which bounds the answer precisely:

- **`PlaceResolver` is constructed fresh per generation/edit call** — no
  state persists across runs. Its cap governs a single run only.
- **Full generation** (`audit.ts` line 273):
  `new PlaceResolver(Math.max(80, output.days.length * 8))` — e.g. **120**
  for a 15-day trip. This is described in its own comment as "a runaway
  guard, not a budget throttle — scale it so it never clips a legitimate
  trip," i.e. it is sized to *not* be the limiting factor; the number of
  actual live calls in a run is the number of names that miss the pool, not
  the cap.
- **NL single-place edits** (`edit-actions.ts`, 4 call sites): 
  `new PlaceResolver()` with no arg → default `RESOLVE_CAP = 15`
  (`resolve.ts`).
- **Each live call is one Google Places `searchText` request**
  (`resolve.ts`'s own cost comment: "~2.5–3.2¢" each), deduped by name within
  that one resolver instance.

**One real, documented per-trip data point exists** (`docs/LOG.md`,
2026-07-26 section): on the instrumented trip `expedition-ms28y793` (a
15-day generated trip, matching the `days×8=120` cap formula), **44 of 48
total tiles** depended on tier-2 (Google) resolution — found while
diagnosing a missing-API-key degradation. That is evidence of the scale of a
*single* generation's tier-2 dependency (dozens, not thousands), not a
corpus-wide sweep — consistent with the cap math above.

**So: the "denominator" for any one run is bounded by a single trip's day
count × names-per-day (tens, capped at 80–120 for a full generation, 15 for
an NL edit) — not by the corpus.** 127 accumulated rows against that scale
is consistent with roughly a handful of TEST generation/edit runs over about
two weeks, not a systematic pass over the corpus.

## 3. Run history from docs — exact dates and counts found

Every count below is transcribed directly from `docs/decisions/
2026-07-23-corpus-writeback-dormant.md` and `docs/DATA_INVENTORY.md`, not
recomputed:

| date | google_resolved | google | source | stated context |
|---|--:|--:|---|---|
| 2026-07-23 (ADR filed) | 0 (dormant, wired to nothing) | — | ADR body | "at the time of writing wired to nothing" |
| 2026-07-27 (first correction) | 47 | — | ADR correction block | "TEST carries 47 google_resolved source_record rows... PROD carries zero" |
| 2026-07-27 (same day, later) | 103 | — | ADR correction block | "after the post-#163 verification generation" |
| 2026-08-10 | 122 | 5 | DATA_INVENTORY.md | first appearance of the now-stable 122/5 pair |
| 2026-08-14 | 122 | 5 | DATA_INVENTORY.md | unchanged |
| 2026-08-16 | 122 | 5 | DATA_INVENTORY.md | unchanged |
| 2026-08-17 | 122 | 5 | DATA_INVENTORY.md | unchanged |
| 2026-08-17 (later) | 122 | 5 | DATA_INVENTORY.md | unchanged |
| 2026-08-20 (gap scan, this session's prior report) | 122 | 5 | live TEST query | unchanged |

**The count grew 0 → 47 → 103 → 122 across 2026-07-23–2026-07-27 (manual
verification/test generations, per the ADR's own description), then the
`google` source added 5 more at some point before 2026-08-10, and the
combined 127 has been completely flat for at least 10 days** (2026-08-10 →
2026-08-20) **despite the rest of the corpus growing by roughly 9× in active
source_record count in that same window** (18,967 total source_record on
2026-08-10 → 168,688 on 2026-08-20, per DATA_INVENTORY.md and this session's
own query). No stated intent for a "Deadhorse expedition" or any other
specific named campaign was found — the ADR frames every addition generically
as "generation" / "verification generation" activity, not a scoped campaign
with its own name.

**PROD carries zero `google_resolved`/`google` rows** — stated explicitly in
the ADR ("PROD remains zero... it cannot have changed: the call-site gate
skips non-TEST projects, and no PROD generation has ever succeeded
(`ANTHROPIC_API_KEY` is unset in Vercel Production)") and consistent with
`DATA_INVENTORY.md`'s PROD section, which never mentions `google_resolved` at
all. This reinforces that the whole 127-row population originates from TEST
trip-generation/edit activity, not any corpus-wide process that could in
principle also run against PROD.

## 4. Is this itinerary-audit-scoped? Yes — stated plainly

**Yes.** The mechanism only ever touches places that an LLM proposed for a
specific generated or NL-edited trip on TEST, and only the subset of those
names that (a) missed the existing corpus pool and (b) successfully resolved
via a live Google call and (c) passed the corridor guard. It has never taken
"the corpus" or any sample of it as input. A master_place that has never
appeared as a keyStop/endpoint/overnight name in a TEST-generated trip has
**zero chance** of having been attempted, successfully or not — it isn't
that Google failed to match it, it's that the process never considered it.

**This means the 2026-08-20 gap-scan report's "Google linkage coverage"
section is measuring a real, correctly-computed count (127 rows, 86 MPs) —
but framing it against a corpus-wide denominator (84,999 active
source_record / 38,950 in-scope master_place) implies an attempted-and-
mostly-failed match process. That implication is wrong. The real denominator
for "how many places has this process actually tried to match" is on the
order of the total keyStops/endpoints/overnights across however many trip
generations have run on TEST — a number bounded by dozens-per-trip × a
handful of trips, not tens of thousands.** See the correction appended to
that report.

## 5. Correction needed on the prior gap-scan report

**Yes, a correction is warranted**, and has been appended in place (per this
repo's documented convention of striking through and annotating superseded
claims rather than silently editing them) to
`docs/measurements/2026-08-20-corpus-gap-scan.md` §3. Summary of the
correction:

- The **127 / 86 / percentages themselves are not wrong** — they are
  accurate counts of what exists in the corpus right now, computed the same
  way in both reports.
- What needs correcting is the **characterization** — "Google linkage
  coverage" and "0.15%/0.22%" read as a match-rate finding (attempted N,
  matched 127). It is not that. It is closer to "127 rows exist as a
  byproduct of TEST development/testing activity, touching a small,
  arbitrary, non-representative slice of the corpus (whatever an LLM
  happened to mention across a handful of trip generations)." A near-zero
  percentage against the full corpus denominator was never a meaningful
  outcome to expect from this mechanism, so it is not evidence that "Google
  matching mostly fails" or "Google linkage work is barely started" in any
  campaign sense — there has never been a campaign.
- The prior report's own §3 caveat (about `google_resolved` rows carrying no
  rich fields, just a resolved id/name/coords) still stands and is
  reinforced, not contradicted, by this finding — it's now clear WHY the
  shape is so minimal: it's a byproduct of navigation-grade name resolution
  during trip generation, not a Places-Details enrichment fetch of any kind.
