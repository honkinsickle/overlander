<!-- Append-only session log. Newest entry at top. One "## YYYY-MM-DD" per
     session; today's entry may gain bullets as the session continues, but
     entries for prior dates are never edited or reordered. 3-8 bullets:
     what happened, what was found, what was decided, what was learned that
     git log won't show. Include corrections and dead ends — a later entry
     corrects an earlier one, the earlier one is not rewritten. Link PRs and
     decision docs. -->

# LOG — append-only session diary

What happened, in order. The running narrative the other docs deliberately
don't keep: STATE.md overwrites, `git log` records commits not findings,
`docs/decisions/` holds single choices.

## 2026-09-01 (later 7) — Photo pilot: NPS-direct pull for NPS-sourced CA campgrounds (TEST)

- **Target set measured: exactly 1 row.** Of 2,632 CA campgrounds, 52 have an
  NPS source_record; only **one** ("Prisoners Harbor Campground", Channel
  Islands) lacks a baked photo. Confirms the standing finding that NPS
  campgrounds almost all already carry a baked photo. PR #335 updated (not
  merged).
- **Matched by STRUCTURED id, not fuzzy.** The NPS ingester stores the campground
  id in `source_record.external_id` as `nps:campground:<id>` (nps.ts:565). Match
  rate: **1/1 structured id, 0 name/geo fallback.** Reported which id and why.
- **Outcome: no_candidate.** The structured id `4ED5E354-…` no longer resolves
  in the current NPS API (absent from CA `stateCode`, `parkCode=chis`, and name
  search) — the unit was removed/renamed upstream since ingestion. Per the rule
  "fall back to name/geo only when NO structured id exists", I did **not** fuzzy-
  match a stale-but-present id (fuzzy-matching an island campground would likely
  hit a mainland unit). Recorded as `match_status='no_candidate'` with the reason,
  not silently skipped.
- **`pickPhoto`/`NON_PHOTO_RE` reused as-is, not extended** — honestly, because
  zero NPS images were retrieved this run (the one unit is gone), so there was no
  new non-photo type to observe. The filter path is wired and ran in the earlier
  dry runs.
- **Schema:** migration `20260901000800` adds `no_candidate` to the match_status
  CHECK and makes `image_url` NULLABLE (a no_candidate row has no image). Applied
  to TEST. NPS accepts (had there been any) would be `match_status='accepted'`,
  `source='nps'`, license "Public domain (U.S. Government work, NPS)", credit →
  attribution — direct-accept, no Google cross-check, no manual_review, per the
  first-party-authoritative instruction.
- **Not wired into rendering.** Driver `scripts/photo-nps-direct.ts`
  (npm: `backfill:photo-nps`), idempotent (delete-then-insert scoped to
  `pilot_run='nps-direct-2026-09-01'`). TEST Supabase + NPS_API_KEY from
  data/.env; no PROD touched.
- **Follow-up flagged:** "Prisoners Harbor Campground" is a corpus row whose NPS
  unit no longer exists upstream — an ingestion-staleness signal worth a broader
  check (are other nps source_records pointing at removed units?). In BACKLOG.

## 2026-09-01 (later 6) — Photo pilot: Google-verified auto-adjudication (TEST)

- **Replaced manual eyeballing with an automated vision comparison.** For all
  253 stored candidates, fetched a LIVE Google reference photo (Places API New:
  text search → photo media) and compared it against the stored candidate photo
  with `claude-opus-5` (structured verdict). PR #335 updated (not merged).
- **Result:** match_status → **10 accepted, 235 rejected, 8 manual_review**;
  google_verdict → match 10, no_match 193, ambiguous 42, no_google_result 5,
  unverified 3. `no_match`/`ambiguous` → rejected (conservative default). The 8
  couldn't-verify rows (5 no-Google-result + 3 API/vision error) were **left at
  their prior status**, not rejected, per instruction (flagged via
  google_verdict).
- **The vision pass is far stricter than name+geo, and correctly so.** It
  rejected geo-proximate-but-wrong Commons photos the earlier matcher had
  accepted or manual-reviewed: a beach for "Van Damme Group Camp", a lichen
  macro for "Warren Group Camp", a snake close-up for "Tamarisk Grove", the
  **Benbow Inn hotel** for "Benbow Lake Campground", an **urban office tower**
  for the OSM place literally named "1". Genuine matches survived: both Tolkan
  entrance-sign photos, and Mount Shasta from Bunny Flat. Only **4 of the
  earlier 6 "accepted" survived** Google verification.
- **Schema:** migration `20260901000700` adds google_verdict/confidence/
  reasoning/ref_source/checked_at and widens match_status to allow `rejected`.
- **COMPLIANCE (live-fetch, not warehouse):** Google reference images were held
  in memory for the single comparison and discarded. A scan of every text
  column of every row found **zero** Google URLs / photo ids / image data —
  only the verdict + a generic `google_ref_source` label are stored; `image_url`
  stays 100% Commons/NPS/RIDB. `google-reference.ts` performs no writes; the
  driver patch carries only verdict columns.
- **Still not wired into rendering.** ANTHROPIC_API_KEY was borrowed from
  web/.env.local into the process env; TEST Supabase + Google key came from
  data/.env — no PROD touched. 3 rows hit transient errors (left unverified).

## 2026-09-01 (later 5) — Photo-backfill pilot: six self-audit fixes + deterministic re-run (TEST)

- **Fixed all six issues from the self-audit** (matcher/nps/driver), re-ran the
  CA-campground pilot clean. PR #335 updated (not merged).
- **#6 root-caused decisively.** The prior "1,967 vs 1,985 target-with-coords"
  wobble was **unordered LIMIT/OFFSET pagination**, not `master_place_search_export`
  instability: with `.order("id")` the count is **2,000 every run (×3)**; unordered
  it gave 1,968 / 1,999 / 1,999 — while the export's own campground row count was a
  constant **6,108** in all runs. Added `.order("id")` to every paged query in
  `enumerateTargets`.
- **#5 verified.** `Round Valley → His_and_Hers.jpg` (0.14 title, description-only
  substring) now correctly routes to `manual_review`; description-substring can no
  longer drive an auto-accept (title-anchored only).
- **#3** license allowlist now recognizes PD-* templates (PD-USGov/PD-US/PD-self/
  CC-PD-Mark/"No restrictions"); **#4** NPS image selection skips maps/diagrams/
  signs; **#2** an NPS unit's mere 5km proximity no longer counts as "had a
  candidate" (must pass adjudication + have a real photo); **#1** `source` column
  now records `wikimedia_commons_geo` vs `_text`.
- **Deterministic re-run** (`pilot_run=ca-campground-2026-09-01-fixed`, prior
  flawed rows deleted first): **253 rows / 69 places — 4 accepted, 249 manual,
  0 no-candidate, 91 rejected** (place-level 4/65/0/91). NPS contributed 0 rows.
  **NOT comparable to the flawed run's 277/6/271** — different 160-place sample
  (the old one was non-deterministic).
- **Actually eyeballed the 4 accepted photos this time.** Nelder Grove (giant
  sequoia — good) and Half Moon Bay (coastal bluff — good) are solid; **Tolkan
  Campground is a photo of the entrance SIGN** and **Benbow is a distant dusk
  hillside at 923 m** — both correct-place but weak heroes. None matched a *wrong*
  place. Lesson stands: geo+title gating prevents wrong-place matches but does not
  guarantee a good depiction.
- **Residual (flagged, not silently fixed):** the map/diagram/sign filter is
  NPS-only per the task's #4 scope; the same issue exists for Commons (Tolkan sign
  is the live example). Noted in BACKLOG for a follow-up rather than scope-creeping
  it here.

## 2026-09-01 (later 4) — Photo scoping investigation + CA-campground photo-backfill pilot (TEST)

- **Scoping first (no changes):** day-detail STOPS cards
  (`category-list-card.tsx`) show a photo only when `photoUrl` is truthy —
  baked from a photo-eligible source_record (`{nps,ridb,wikipedia,
  atlas_oddities,family_destinations,editorial_food}` with
  `normalized_payload.photo.url`) or live-hydrated via a Google `placeId`. Of
  35,474 searchable POIs, **30.0% have any photo, 70.0% render a color block**
  (measured); `campground` = 22%. It's a data-availability gap, not wiring.
  Trip `10d68385…` (TEST) day-3: Dripping Springs Campground has a baked ridb
  photo; Toulon Trail / Bee Canyon have none from any source. **Flagged: the
  screenshot's "Tucalota has a photo" premise is contradicted by the data** —
  Tucalota has no baked photoUrl, no placeId, no source photo, so it renders a
  color block like the other two (deterministic from payload+code; not browser-
  verified).
- **Pilot (implementation, TEST only):** new staging table
  `master_place_photo_candidate` (migration `20260901000600`, applied via
  `db:push-verify --test`) + `data/photo-backfill/` (Wikimedia Commons + NPS
  matchers) + `data/scripts/photo-backfill-pilot.ts`. Deliberately **not wired**
  into any read path — the stop point.
- **Schema decision:** separate table, NOT a `source_record` upsert — the
  existing `backfill-wikipedia-photo.ts` writes a `wikipedia` source_record
  which the corridor RPC auto-reads (would surface immediately). ADR:
  `docs/decisions/2026-09-01-photo-backfill-pilot-staging-table.md`.
- **Target set (computed):** 2,053 CA `campground` rows with zero coverage
  (2,632 total − 579 baked-photo − 5 google). Source tags: osm 1,123,
  usfs 421, state_parks 412, ridb 97.
- **Pilot result (160-place stratified sample, 40/source-tag):** 6 accepted,
  69 manual-only, 3 no-candidate, 82 rejected (place-level). **277 rows stored**
  (6 accepted / 271 manual_review) across 75 places; all license-clear
  (CC-BY/BY-SA/CC0/PD). state_parks yielded best, usfs worst (remote → few
  Commons photos).
- **Two apparatus bugs caught mid-build** (both the "verify the instrument"
  lesson): (1) a zod schema rejected `extmetadata` values that are numbers
  (`CommonsMetadataExtension: 1.2`), silently returning 0 candidates for every
  place until fixed; (2) numeric OSM campground names ("1".."15") passed
  `substringMatch` against any image containing that digit — a false accept —
  fixed with a weak-name guard.
- **Not merged; PR opened for review.** Follow-ups (review candidates, decide
  wiring, tune thresholds/cap manual rows, run full 2,053) in BACKLOG.

## 2026-09-01 (later 3) — PROD Aug-31 regression damage REPAIRED: 2,716 rows recomputed, zero unintended change

- **2,716 rows recomputed on PROD, 0 failed** (~30 min wall clock, chunked 50 at
  a time). Scope: the 2,732 regression batch **minus the 16** whose
  `contact`/`access` would have cleared.
- **Every gate held before the write.** Batch re-derived and unchanged
  (2,730 burst + 2 post-burst verification rows = 2,732). Exclusion set still
  exactly 16, and this time the full signature was confirmed **across all 16
  rather than generalised from a sample** — the mistake the previous two
  sessions each had to walk back. Safety gate on the narrowed set: **0 clearing
  on all nine clearable fields**, with live controls.
- **The repair landed exactly as predicted.** Corpus `mvum_corridor` true
  **52 → 501 = +449** — independently reproducing the floor the earlier
  read-only investigation predicted. `false` went 2,810 → 3,922 (+1,112), and
  **449 + 1,112 = 1,561**, reconciling precisely to the dispersed_camping rows
  in the set that went from all-NULL to all-evaluated.
- **Containment:** +70 edges for the set (1 → 71) and +70 corpus-wide
  (6,217 → 6,287) — identical deltas, so every new edge belongs to a target row.
- **Zero unintended change**, measured before/after rather than assumed:
  description 2,626 → 2,626, contact 50 → 50, access 25 → 25, amenities 0 → 0,
  hours 0 → 0, is_searchable 2,716 → 2,716, land_status 0 → 0. Corpus rows with
  a real description 13,955 → 13,955.
- **The 16 excluded rows are provably untouched** — queried directly, 0 changes
  on every captured field including `last_resolved_at`, which is the decisive
  signal that none was recomputed. Not inferred from the exclusion logic.
- **Scope proven:** rows touched this session 2,716, outside the target set
  **0**, target rows missed **0**.
- **New finding: the `access` half of the exclusion was never data loss.** An
  *active* `usfs` source_record carries an access payload for all 16, but
  `field_precedence` has no `('access','usfs',…)` row, so `resolve_field()`
  structurally cannot see it. `contact` is different — genuinely stranded, only
  inactive `ridb` carries it. Adding the precedence row would let all 16 be
  recomputed safely and close their containment gap in the same pass. Filed.
- **Method notes worth keeping:** the target/exclusion id sets were captured to
  disk *before* the write and every statement drew from those files, so the
  operation was immune to `last_resolved_at` shifting under it; the
  before/after measurement query was ID-pinned for the same reason. Every
  read-only file was linted for write/DDL keywords before running — including
  scratch — closing the process lapse flagged last session. The one write file
  was asserted structurally instead, and labelled as such rather than passed off
  as lint-clean.
- Timing note: the 50-row probe measured ~0.58 s/row cold; the warm rate varied
  between ~0.2 and ~1 s/row, so the initial "~26 minutes" estimate was
  coincidentally close but was never a stable rate.

## 2026-09-01 (later 2) — regression-batch recompute on PROD: AUTHORIZED, ATTEMPTED, HALTED at the safety gate

- **The recompute did NOT run. PROD is unchanged** — SELECT-only this session.
- **Batch re-derived, not hardcoded, and it is unambiguous.** Three independent
  identifiers reconcile exactly: `last_resolved_at >= 2026-08-31` gives **2,732**;
  the tight 22:18:00–22:18:30 UTC burst gives **2,730**; rows recomputed after
  the burst give **2** — and those 2 are precisely PR #331's own verification
  subjects (`Muddy River Picnic Site`, `LAUGHING WATER TH 98-UPPER`). 2,730 + 2 =
  2,732. The set has not shifted. USFS INFRA linkage (2,647) and the mvum-NULL
  signature (1,561 dispersed_camping, all NULL) both still hold inside it.
- **The safety gate FAILED, and it failed on something never previously
  measured.** PR #331's option 2 said the batch "clears 0 descriptions" — that
  is true and re-confirmed (2,642 non-null in batch, **0** would clear). But the
  *other* clearable fields had only ever been measured across the 5,457-row
  union, never for this batch alone. Measured for the batch:
  **`contact` 66 non-null → 16 would clear; `access` 41 non-null → 16 would
  clear.** Every other clearable field has zero non-null rows in the batch.
- **It is the same 16 rows for both fields** (contact 16, access 16, same-row
  16, distinct 16). All `campground`, all USFS INFRA, all `created_at`
  2026-05-29 (16/16), all with exactly 1 active source_record (16/16).
- **Self-audit correction:** I first wrote "each with 3 source_records
  (google/ridb/usfs)" from a **3-row sample**. Measured across all 16: 13 have
  three (`google,ridb,usfs`), **3 have two** (`ridb,usfs`). Wrong for 3 rows.
- **The cause moved from inference to measurement:** the only contact-bearing
  source for these rows is `ridb`, **inactive in all 16**. RIDB supplied the
  values, was deactivated in the six-state trim, and the regressed function
  stranded them. The "content is real" judgement still rests on a 3-of-16
  sample.
- **"PROD is unchanged" is now measured, not asserted:** max `last_resolved_at`
  is still 2026-09-01 07:54:18 — the #331 verification row — and `master_place`
  28,348 / batch 2,732 / `contained_in` 6,217 / `mvum_true` 52 are all identical
  to #331's post-apply state.
- **Halted per instruction** ("if ANY come back non-zero, stop and report rather
  than proceeding"). Did not narrow the boundary myself either — the task
  explicitly said not to guess at it.
- **The narrowed option is unusually cheap and is now written up:** recomputing
  2,732 − 16 = **2,716** clears nothing at all, and costs nothing on the mvum
  repair, because all 16 are `campground` and Step 6.5 assigns
  `mvum_corridor = NULL` to every non-`dispersed_camping` category regardless.
  The only forfeit is containment edges for those 16 rows (count not measured).
- Lesson worth keeping: **option 2 in PR #331 was under-specified and I wrote
  it.** "Clears 0 descriptions" was measured; "clears nothing" was inferred and
  never stated but easily read in. Measuring a sub-population's headline field
  does not license a claim about its other fields.

## 2026-09-01 (later) — PROD deployment of the recompute_master_place() fix: migrations applied, repair recompute BLOCKED on an uncovered side effect

- **All five migrations (`20260901000100`–`000500`) applied to PROD.** Three-gate
  pre-flight first: refs aligned on both sides, exactly the five intended
  migrations pending with zero orphan ledger versions, and live state confirmed
  as the regressed function. Applied via bare `npm run -w data db:push-verify`
  with `data/.env` swapped to PROD and the CLI linked to PROD, per the
  documented production path.
- **Post-apply drift check: PROD and TEST are byte-identical** across all five
  objects — `recompute_master_place`, `compute_prominence`,
  `is_generated_source`, `pois_along_corridor`, `master_place_search_export` —
  plus matching `field_precedence` rows at priority 20/21. No
  environment-specific drift.
- **The reroute is a genuine no-op on PROD.** `master_place_generated_content`
  has **0 rows**. Stated plainly and skipped rather than forced, as the task
  directed.
- **All four verifications pass on PROD**, including the clear-and-restore test
  on a real single-source row (chosen outside the six-state footprint so its
  transient state was never user-visible in search). Test suite 32 files / 626
  passed / 3 skipped.
- **Zero data change.** All 17 baseline metrics identical pre/post apply; only
  the 2 verification subjects were recomputed, both restored.
- **BLOCKED, and this is the important part: applying migrations does not
  recompute anything.** The authorized blanking of 2,725 stale descriptions has
  NOT happened, and the 2,732-row regression batch is still unrepaired. Both
  need a recompute of the union population (5,457 rows; sets measured disjoint).
  Measured what that recompute would clear *inside that population*:
  description **2,725** (authorized) but ALSO **contact 2,000, access 438,
  amenities 210, hours 38** — not covered by the authorization, and absent on
  TEST, where every non-description field cleared 0. The task said to seek
  confirmation on anything not covered; this is that.
- **The clearing is latent, not avoided.** Any normal ER/materialize run that
  touches these rows will now clear those fields incrementally and unobserved.
  The real choice is a measured batch under supervision versus a silent drip.
- Housekeeping: dropped the leftover `public._verify_tmp` table an earlier
  session created on TEST. PROD credentials and CLI link restored to TEST,
  confirmed behaviourally rather than by reading the ref file.

## 2026-09-01 (later) — recompute_master_place() restored, description backfill rerouted through source_record, and a deviation of mine caught by its own verification

- **Both threads closed on TEST.** Migrations `20260901000100`–`20260901000500`.
  ADR: `docs/decisions/2026-09-01-generated-descriptions-as-lowest-precedence-source.md`.
  Report: `docs/measurements/2026-09-01-recompute-restore-and-description-reroute.md`.
- **All five regressions restored across all seven sites.** The function was
  **generated programmatically** from `20260819180000` rather than retyped, then
  diffed against it so the only deltas are the intended ones, then all seven
  sites re-verified against the **live** `pg_get_functiondef` after apply.
  `operational_status` from `20260831100000` kept verbatim.
- **Self-audit correction: that live verification first ran against the
  SUPERSEDED function** (right after `20260901000200`, never re-run after
  `20260901000500` replaced it), and it was substring-based, so my own comment
  prose inflated an `'operational_status'` occurrence count. Re-run
  structurally against the deployed definition: `v_clearable_fields` is exactly
  the nine from `20260819180000`. "Verified" now means verified against what is
  actually running.
- **Self-audit: an effect I never measured before publishing.** Recomputing
  13,942 rows could have NULLed stale `amenities`/`hours`/`contact`/`access`/
  `capacity` etc. via the restored clear-branch; I had no baseline and did not
  check. Measured after the fact **with a control** (the first attempt returned
  zero rows for everything — indistinguishable from a broken query): control
  counts are real (contact 11,105, access 8,335, amenities 1,877, hours 1,723,
  capacity 80) and **stale counts are 0 across every field**. Nothing was
  cleared, and the clear-bug's practical exposure was `description` plus the
  four structural losses, not the other eight columns.
- **Self-audit: ER safety verified rather than reasoned about** — 0 of the
  13,942 synthetic records are unlinked, 0 appear in `place_match`.
- **The reroute makes the exemption unnecessary rather than solving it.** Two
  synthetic sources (`generated_llm` @20, `generated_template` @21, below
  `padus` @10). 13,942 source_records upserted, 13,942 recomputes, 0 failed.
  **Rows a clear-branch restore would still wipe: 0** (was 6,541). The
  description survives because `resolve_field()` re-derives it, not because
  anything exempts it.
- **113 rows correctly did NOT take generated text** — a real RIDB/NPS record
  resolves `description` to an empty JSON string and outranks precedence 20/21.
  That is the right answer and better than PR #327, which overwrote 7 of them.
- **I made a wrong deviation and my own verification caught it.**
  `20260901000200` added `operational_status` to `v_clearable_fields` on the
  reasoning that it is a nullable precedence-resolved column like the other
  nine. Measured right after apply: **0 source_records carry
  `operational_status` in `normalized_payload`** (6,324 active usfs rows carry
  the RAW `props.seasonal_operational_status`; the column's values are all
  direct writes from `backfill-operational-status.ts`). So `resolve_field`
  could never re-derive it and every recompute erased it. **One row lost
  (246→245), restored by re-running the PR #321 backfill (back to 246).**
  Reverted in `20260901000500`. The lesson: "implement it anyway and flag the
  concern" still requires verifying the deviation against real data — the
  reasoning was clean and the data said no. It is also structurally the SAME
  defect this branch exists to fix, in a different column.
- **PR #321's operational_status is not actually wired end-to-end for existing
  data.** Its migration claims the field_precedence pattern, but the normalizer
  emits `operational_status` for NEW ingests only; nothing backfilled
  `normalized_payload`. Filed.
- **Neutrality measured, not assumed:** avg prominence over searchable rows
  0.8606 before and after; export-view rows 33,047 before and after — because
  `compute_prominence()` and `source_count` now exclude generated sources.
  Without that, every affected place would have gained +2.0 prominence
  (`count(distinct source_id) * 2.0`) and silently reordered the corridor.
- **ADR 2026-08-21 §2 checked at corridor scale**, not one row: 815 rows
  returned over LA→Sacramento→Redding at 16 km, **0** template-sourced, 204
  llm-sourced. `description_source` now reports llm/template truthfully instead
  of `'source'`. One row reports `'template'` via the legacy branch — it is
  RIDB-attributed with an empty-string description, pre-existing, same
  empty-string root cause, not introduced here.
- **`contained_in` dropped 110,519 → 106,335** because Step 7 corrected stale
  edges on the rows it touched. Sampled (arbitrary `limit`, not randomized):
  0 of 3,000 rerouted-child edges unsupported by a live `st_covers`, vs **518
  of 3,000** untouched ones. Containment had not run since the regression; a
  corpus-wide recompute is worth scheduling.
- **Apparatus note:** the Management API SQL endpoint 502s on long queries — the
  first collateral check (an `st_covers` join over 106k edges) died at the
  gateway. Split into set-based aggregates and bounded samples.
- **PROD untouched, and the prompt's premise that the regression is "confirmed
  live on PROD" is still not confirmed by me.** I have never queried PROD.

## 2026-09-01 — recompute_master_place() regression audit: it's five behaviours, not one; the requested fix is blocked on a design call

- **Task was "restore the clear branch + add an exception for the PR #327
  backfill rows". Neither half survived investigation intact.** Nothing was
  applied. Full audit:
  `docs/measurements/2026-09-01-recompute-master-place-regression-audit.md`.
- **Got real SQL access to TEST for the first time** — `supabase link
  --project-ref znldzjdatkogdktymtvi` + `supabase db query --linked` (Management
  API). Prior sessions reasoned from migration files because every script goes
  through PostgREST. This is the tool that should have been reached for on
  2026-08-31; the whole under-scoped regression report came from not having it.
  **Only SELECTs issued.** CLI now linked to TEST (gitignored), not PROD.
- **`pg_get_functiondef` live from TEST, diffed against `20260831100000`: the
  function body is identical**, only Postgres's wrapper normalisation differs —
  no out-of-ledger drift; the file is the deployed truth. Good news for the
  ledger, bad news for the function. (First draft said "matches exactly", which
  `pg_get_functiondef` never can — it always reformats the wrapper.)
- **The regression is five behaviours across seven code sites, not one.**
  `20260831100000_operational_status.sql`'s body is **byte-for-byte the
  2026-05-27 original** plus exactly two hunks, both adding
  `operational_status` to an array — proven by diffing the two migration files
  **without** stripping comments or blanks, which still yields only those two
  hunks. ("Five behaviours across seven sites" counts executable sites, not the
  `v_clearable_fields` declaration.) Someone copied the oldest definition, so one `create or
  replace` reverted three months of fixes: both clear-branches (Steps 3 and 5),
  both geometry tie-break determinism clauses (Steps 4 and 5, from the migration
  literally named `resolve_field_determinism`), `is_searchable` derivation,
  Step 6.5 `mvum_corridor` entirely, and Step 7 containment entirely.
  `resolve_field()` itself is untouched.
- **Blast radius on TEST: 2 rows.** Only 2 master_places have
  `last_resolved_at >= 2026-08-31`, and both are this thread's own sentinel
  probes — the function has barely run since. 0 `land_status` rows are wrongly
  searchable. Landmine, not fire: the next `materialize` changes that.
- **Step 2 of the task cannot be built as specified — stopped, per its own stop
  clause.** It said to identify backfill rows "via `description_source =
  'source'` … check how PR #327 marked them". `description_source` is a derived
  `CASE` in a view and an RPC, **not a column**, so it is invisible inside
  `recompute_master_place()`; and PR #327 marked those rows with **nothing**,
  deliberately (attribution is rebuilt wholesale, so any marker there is
  transient — measured and reported at the time). "Has a generated_content row"
  differs only *prospectively*: measured, it exempts the **same 6,541 rows** as
  exact text-equality today. The **3,790** dual rows (resolvable source
  description AND a generated row) only become wrongly-exempted once their
  source goes away and the clear branch starts firing on them. The first draft
  of this entry implied a present mis-exemption; there isn't one.
- **What IS clean, measured:** a naive clear-branch restore would wipe
  **6,541** rows — all with a generated row, all `llm`, all with `description`
  exactly equal to `generated_text`, and **0** rows without a generated row. No
  collateral damage anywhere in the corpus. So text-equality is a *perfect*
  discriminator today (0 false positives in the clear branch's domain) — but
  it's content-keyed, so it fails toward data loss if the text is ever
  regenerated. Three options written up with a recommendation; **Adam's call.**
- **Second-pass self-audit: stopping was a judgment call, not a mandate, and I
  first reported it as the latter.** The stop clause's *letter* fires (the named
  mechanism doesn't exist); its *spirit* — "rather than guessing at an
  approximation" — arguably doesn't, because text-equality is exact, not an
  approximation. Went with the letter because four extra regressions changed the
  migration's shape and the exception's durability is a real design choice. If
  the other reading is preferred, the fix is straightforward from here.
- Also corrected in the second pass: "pg_get_functiondef matches exactly" (it
  never can — wrapper is normalised; the *body* is identical, now diffed); the
  empty-string origin claim (asserted from 7 rows, now measured 108/108); and
  the 2 recomputed rows (asserted, now confirmed by id). Linking the Supabase
  CLI to TEST was an unrequested state change — a bare `db:push-verify` now
  targets TEST where it previously failed for lack of a link.
- **Separate latent bug found: `resolve_field()` treats `''` as a value.** A
  source whose `normalized_payload.description` is an empty JSON string returns
  `{"value": "", …}`, which passes Step 3's `is not null and != 'null'::jsonb`
  guard, so `''` gets written to the column. That is where the corpus's
  empty-string descriptions come from — **108** today, **115** before PR #327
  overwrote 7 of them (arithmetic closes). Those same 7 are the gap between
  PR #327's 6,548 written rows and the 6,541 wipe set, and they are the 7 with a
  stale `attribution.description` — all one phenomenon. Their generated text is
  unstable regardless of the clear branch, via the `if` path.
- **Nothing applied, so none of the task's four required verifications were
  run** — they all need the corrected function in place. Said so rather than
  reporting them green.

## 2026-08-31 (later) — generated-content copy-in: llm half backfilled on TEST, template half held, a regression found underneath it

- **Ran "Fix 1 (copy-in)" for Population A's LLM half on TEST.** New script
  `data/scripts/backfill-description-from-generated-content.ts` (dry-run default,
  `--confirm`, `--undo` from a timestamped snapshot, `--prod` asserts the PROD ref).
  **6,548 rows updated, 0 failed, 6,548/6,548 verified.** Report:
  `docs/measurements/2026-08-31-generated-content-copyin-backfill.md`.
- **Population re-measured, not carried over:** 17,725 generated_content
  description rows → **13,942** in Population A, split **6,548 llm / 7,394
  template / 0 needs_review**, plus 3,783 "dual" rows skipped (gap-fill only).
  A = 13,942 matches this morning's scoping doc exactly — no drift.
- **The scoping split the task didn't anticipate: template rows are excluded from
  trip-stop candidacy on purpose.** `pois_along_corridor` carries
  `and not (mp.description is null and has_template)` per ADR 2026-08-21 §2.
  Copying template text in makes that predicate false. Verified by writing one
  template row's text, re-querying the RPC, and restoring: **not returned →
  returned**. The llm control row was returned both before and after (only its
  description went from null to populated). So the template half is a product
  decision reversing a merged ADR, not a plumbing fix — **held, `--method all`
  is the whole delta.** Exactly 7,394 would be newly admitted (all of them also
  pass the RPC's other gates, so it's an exact figure, not a bound).
- **Correction, caught in a self-audit before Adam reviewed the PR: I wrote
  "24 of the 25 Yellow Post rows are llm" in four places. That was a CAPPED
  SAMPLE reported as a population count** — the probe query carried
  `.limit(25)`, so 25 was my own cap, not the number of rows. Re-measured
  uncapped: `canonical_name ilike '%Yellow Post%'` returns **80** rows — 46
  llm, 11 template, 23 with no generated row at all. So the run fixes 46 of 80
  there, not nearly all. Exactly the "sampled numbers dressed as totals"
  failure `CLAUDE.md` names; the tell was that I chose the limit and then
  quoted the result as a total.
- **Second self-audit correction: the durability experiment had no positive
  control.** It wrote a sentinel, called `recompute_master_place()`, and saw
  the sentinel survive — but neither `description` nor `attribution` changes
  when the function runs successfully on such a row, so the observation could
  not distinguish "the clear branch is gone" from "the RPC did nothing". Re-run
  using `last_resolved_at` (written unconditionally in Step 6) as the control:
  it moved 2026-08-20T23:12:55Z → 2026-09-01T03:52:37Z while the sentinel
  survived. Conclusion unchanged, now actually supported.
- **`attribution` deliberately left alone, after measuring the convention.**
  Across all 19,803 searchable rows whose description was not NULL (19,688 of them non-empty), `attribution.description`
  is always a `source_id` and never absent (ridb 5,344 / nps 4,979 / usfs 4,204 /
  atlas_oddities 2,767 / osm 1,963 / editorial_food 533 / family_destinations 13
  / **0 missing**). `recompute_master_place()` rebuilds the map wholesale from
  `source_record`, so there is no existing "generated, not sourced" value and any
  invented one would be dropped on the next recompute — confirmed directly.
  Follow-up measurement: **7** of the 6,548 written rows carry a *stale*
  `attribution.description` (5 ridb, 2 nps) from the clear-bug era; the other
  6,541 have no key. So the corpus now holds 6,541 rows with a description and
  no attribution entry, which is new, plus 7 whose entry names the wrong
  source. An earlier draft said all 6,548 lacked the key — wrong for 7.
- **Found underneath all of this: the clear-bug fix has been REGRESSED — on
  TEST measured, on PROD `[UNVERIFIED]`.**
  `20260831100000_operational_status.sql` (PR #321, yesterday) is a
  `create or replace` of `recompute_master_place()` built from the **pre-fix**
  body — it drops the `elsif v_field = any(v_clearable_fields)` branch that
  `20260819180000` added. TEST is measured (sentinel + `last_resolved_at`
  positive control, above). **PROD was never queried this session** — that
  half rests on the migration file plus STATE's record that #321 went to both
  environments, which in a repo with documented file-vs-DB drift is inference,
  not measurement. I asserted "TEST and PROD" in bold in four places on that
  basis; corrected. **That regression is the only reason the copy-in approach
  is durable at all.**
  Restoring the clear-bug fix would silently wipe this backfill. The two are
  mutually exclusive as currently built. Filed in BACKLOG with the shape of a
  real reconciliation.
- **Formatting parity checked over the whole population, not a sample:**
  `stripDescriptionHtml()` changes **0 of 6,548** written strings. 0 tags, 0
  entities, 0 double-spaces, 0 untrimmed; 182 carry a paragraph newline.
- **Re-verified through the bake path, not the base table** — queried
  `pois_along_corridor` (what `fetchCorpusForPolyline` → `mapMasterPlaceRow`
  calls) for five previously-noisy tiles; all five now return real text with
  `description_source: source`. Confirms the task's item-7 assumption: **zero
  web-side code changes needed**, verified both by reading the chain and by the
  live RPC.
- **Named, not hidden:** `description_source` flips `'llm'` → `'source'` for these
  rows in the RPC and in `master_place_search_export`. The `verified` tier is
  unchanged (both map to "verified"), but the DB-level provenance signal no longer
  distinguishes them. Typesense was **not** re-synced, so `places_test` still holds
  the pre-backfill values for these rows.
- **Apparatus note:** PostgREST `.in()` filters ride in the URL — 500 UUIDs
  overflowed the 16KB header limit (`UND_ERR_HEADERS_OVERFLOW`) and the error
  arrives as a bare `fetch failed`, not a PostgREST error. Chunk at 150.
- **PROD not touched.** Population B and the entity-resolution duplicates
  (Serrano resolves to 12 `master_place` rows, Fawnskin to 3) were out of scope
  and stay open.
## 2026-09-01 (later) — "IF YOU STOP HERE" back to amber; #329's conflicts resolved

- **Reverses one consequence I flagged in the #329 ADR, by Adam's call.** The
  "IF YOU STOP HERE" simulator heading goes from `var(--type-300)` back to
  `var(--amber-dark)`, matching the shared `Section` component. **Everything
  else #329 did stands** — tag pills, the "ADD TO DAY N" CTA and the Website
  value are all still neutral, untouched.
- **The task's premise had one thing wrong and it changed how I branched:
  #329 was NOT merged.** On `origin/main` that label was still `#A6C9F9`;
  the `var(--type-300)` the task referenced existed only on the open branch.
  So this work is **stacked on `slideup-neutral-tokens`**, not cut from
  `main` — cutting from `main` would have produced a change that conflicts
  with #329 and reads as a competing edit of the same line.
- **Also fixed en route: #329 had merge conflicts** (Adam flagged them
  mid-task). Cause was benign — `STATE.md` and `LOG.md` are both
  newest-at-top files and the little-rock/#327 thread prepended its own
  entries while #329 sat open. **Docs-only; `web/` was untouched by the
  merge.** Resolved keep-both with main's entries first, which also keeps
  #329's STATE masthead directly above #328's so its "the masthead below
  covers PR #328" cross-reference stays true. #329 is `MERGEABLE` again.
  Side effect worth knowing: `LOG.md` now interleaves two parallel
  workstreams, so its headings are **not** in strict date order across
  streams. Each stream's internal order is intact — the most this file's own
  "prior entries are never edited or reordered" rule allows.
- **STEP 1 answer:** the label is a standalone hand-rolled `<span>`, not the
  shared `Section` component — so the change was needed, not redundant. But
  its typography was **already byte-identical** to `Section`'s label (same
  `uppercase` class, `--ff-display`, `14`, `"14px"`, `"0.14em"`), so this is
  colour-only; there was no size/weight/tracking to hand-match, and none was
  added.
- **Did not refactor it onto `<Section>`,** per the task's own escape hatch.
  The label sits inside the simulator card (a `flex flex-col gap-2` div with
  its own background and an `isAdded` opacity/grayscale transition) beside
  several siblings including the bottom `borderTop` divider row carrying the
  CTA. Wrapping those in `Section`'s `<section className="flex flex-col
  gap-2 self-stretch">` would collapse the card's gap distribution onto a
  new nesting level and re-parent that divider — real layout risk for zero
  visual gain, since the typography already matched. It would also conflate
  two roles: `<Section>` is for top-level panel sections separated by
  `<Divider>`; this is a heading *inside* a card.
- **Verified on TEST via CDP, scenic + food.** Compared the label's **full
  computed signature** — colour, font-family, size, line-height,
  letter-spacing, weight, text-transform — against every `<Section>` label
  rendered in the same panel, not just the colour. Identical on both
  categories, amber resolving `rgb(199,116,41)`. Title stayed category-driven
  (`rgb(166,201,249)` scenic vs `rgb(243,134,102)` food), confirming nothing
  category-driven leaked into the label. One frame captures
  `IF YOU STOP HERE` / `DESCRIPTION` / `LOGISTICS` / `DATA SOURCES` together,
  all matching.
- **Coverage caveat:** the two places I opened rendered Description,
  Logistics and Data Sources but not Community or Amenities — those sections
  are data-gated and neither place had the data. So the comparison covers
  three of the five `<Section>` call sites, not all five. All five read the
  same component, so the untested two cannot differ, but I measured three.

## 2026-09-01 — Slide-up non-category chrome goes neutral

- **Closes the follow-up #328 parked.** Adam's design call: the four
  remaining scenic-blue sites in `map-detail-overlay.tsx` should NOT go
  category-driven like the title did — they take fixed neutral tokens.
  Shipped. Every `#A6C9F9` and every `rgba(166,201,249,…)` in the file is
  now gone; verified by grep, not by assumption.
- **Two of the four site labels I wrote into BACKLOG.md after #328 were
  wrong**, and the task inherited them. Located the sites fresh rather than
  trusting the prior report — which is what caught it. **There is no scenic
  blue in the reliability block** (it already used `var(--pin)` /
  `var(--pin-border)`) and **none in the route box**. The four elements that
  actually carried it: tag pills, the **"IF YOU STOP HERE"** simulator
  section label, the **"ADD TO DAY N"** CTA, and the **Website** value in
  the logistics row. Count of four was right; two names were not. BACKLOG
  entry corrected in place.
- **Token choices** (ADR: `docs/decisions/2026-09-01-slideup-non-category-chrome-is-neutral.md`):
  pill text + section label `--type-300`; pill fill `--border-subtle`; pill
  and CTA borders `--border-strong`; CTA fill `--bg-card`; Website value
  `--text-muted`. `--type-300` over `--text-muted` for the two text roles
  because `#888888` reads too dim at 11px/14px against `--bg-panel`.
- **One value outside the task's grep spec was changed deliberately:** the
  CTA's `backgroundColor: "#24354F"`. It contains no `A6C9F9`, so neither
  the task's search terms nor my own found it as a "scenic-blue" site — but
  it is the scenic `cta-bg` literal on the *same element* as a named border.
  Neutralising only the border would have left a blue-filled button and
  failed the task's own "must not read blue-tinted" check.
- **Verified on TEST via CDP**, two ways. (a) Real places, real `Details`
  clicks: scenic `Juan Matias Sanchez Adobe` — the important negative case,
  since a scenic place is the one that previously looked "correct" — plus
  `Marukai Market` (food) and `Mt. Lowe Trail Camp` (camping). Measured
  `--type-300` / `--border-subtle` / `--border-strong` / `--bg-card` /
  `--text-muted` exactly where expected, zero blue-tinted values by an
  `b > r+12 && b > g+12` test. (b) **Invariance run** — same synthetic
  place dispatched twice, only `category` differing, with the title as a
  built-in positive control: title changed `rgb(166,201,249)` →
  `rgb(243,134,102)` (so the variable demonstrably took effect) while all
  four sites stayed byte-identical. Without that control the "identical"
  result would have been vacuous.
- **Real places didn't cover the tag pill.** Only one place I opened carried
  tags (`federal_land` on the scenic one); the food and camping places had
  none, so the pill's cross-category invariance rests on the synthetic run,
  not on two real places. Stated because it is the weakest leg of the
  evidence.
- **Two consequences flagged, not decided by me:** the CTA now reads
  *secondary* against the saturated `--button-primary` DIRECTIONS button
  above it (a hierarchy change, not just a recolour), and "IF YOU STOP HERE"
  is now the only section label in the file that isn't `--amber-dark` — the
  shared `Section` component uses amber for byte-identical typography. Both
  are argued in the ADR with the one-line change if Adam wants them the
  other way.
- **Also learned:** the blue Website value read like a hyperlink but
  `LogisticsCell` renders it in a plain `<span>` — never clickable. The
  neutral is more honest; `--link` exists if it should become real.

## 2026-08-31 (latest) — Slide-up category badge + title colour (map-detail-overlay)

- **The bug, exactly:** `map-detail-overlay.tsx` rendered the place title as an
  `<h2>` with a hardcoded `color: "#A6C9F9"` — the literal `--cat-scenic-title`
  value — applied unconditionally, and rendered no category icon badge at all.
  So a `food` place read scenic-blue with no burger icon while the very same
  place, one column to the left in the day-detail list, read coral with one.
  Two DESIGN.md violations in one line: §6's "no raw hex in components" and
  §1.2's per-category `title` role.
- **Fix** is the day-detail-overview.tsx "Badge + title" block, mirrored:
  `const category = wp?.category ?? "interest"`, a 36×36 / radius-6 badge
  filled `var(--cat-${category}-cta-bg)` with a `0.5px` `cta-border` hairline
  wrapping `<CategoryIconV2 size={22}>`, and the `<h2>` recoloured to
  `var(--cat-${category}-title)`. `Waypoint.category` is typed `Category`,
  which is the same 9-value union as `CategoryIconV2Name`, so no cast is
  needed — the reference block's `as CategoryIconV2Name` is redundant there.
- **Verified on TEST via CDP** at `/trips/la-to-portland` day 1 (428 place
  slots), driving the real `Details` button with a real mouse and reading
  computed styles back against a colour→token map resolved from the live
  `:root` (no hex of my own in the instrument). food `Marukai Market` →
  `rgb(243,134,102)` + burger icon; scenic `Juan Matias Sanchez Adobe` →
  `rgb(166,201,249)` + peak icon; camping `Mt. Lowe Trail Camp` →
  `rgb(110,206,206)` + tent icon. For food and scenic, title colour, badge
  fill and icon markup all matched the same place's day-detail card exactly
  — with the caveat that the icon comparison is over the **first 300
  characters** of the svg's `innerHTML`, which is the whole string for the
  scenic icon but a truncated prefix for food. Badge measured on-screen and
  `elementFromPoint`-reachable, per the CLAUDE.md wiring-vs-reachability
  rule. **The camping card-side comparison is vacuous** — the card-badge
  finder returned `null` for that card variant, so only the overlay side of
  the camping row is evidence; the overlay's inline style reads
  `var(--cat-camping-title)` and its icon is the tent, which is what makes
  camping a real third data point rather than a repeat of scenic.
- **The task named `Philippe The Original` as the food example; I used
  `Marukai Market` instead** and should have said so at the time. Philippe
  was not present anywhere in day 1 of `la-to-portland` at the moment I
  measured (`innerText.includes('Philippe')` false with 428 place slots
  mounted); I did not search the other 10 days. Marukai Market is a
  genuine `food`-category tile on that day and serves the same purpose,
  but the substitution was silent, which it should not have been.
- **Deliberate negative run** (`git stash` the component, re-probe, restore):
  pre-fix the food place rendered `rgb(166,201,249)` with `firstElementChild`
  = the `<h2>` itself (398×26, no svg). The instrument goes red on the broken
  code, so the green result is not vacuous.
- **`camping` and `hotel` are colour-indistinguishable *on the roles these
  surfaces use*.** Precisely: `title`, `cta-bg` and `cta-border` are
  byte-identical between the two in globals.css (`#6ECECE` / `#304C4B` /
  `#6ECECE`); they differ only on `badge-bg` (`#0F2E1F` vs `#304C4B`) and
  `badge-border` (`#4D9A6E` vs `#6ECECE`), which neither the card nor the
  overlay reads. So a colour-only instrument aimed at these two surfaces
  cannot name them apart — only the icon can. **Corrects this entry's own
  first draft**, which claimed all five roles were identical: that was an
  extrapolation from the three roles the instrument actually resolved, not
  a measurement. Same class as the "scope the query to the element under
  test" lesson in CLAUDE.md, one rung up: I generalised past what I read.
- **The `?? "interest"` fallback is defensive, not currently reachable:** all
  **seven** in-repo `trip:openDetail` dispatch sites that pass a place —
  `waypoint-card:54`, `find-nearby-panel:765`, `category-browse-panel:516`,
  `browse-day-section:198`, `map-column:585`, and `day-detail-corridor-column`
  at `:695` and `:759` — pass a `waypoint` (real, or synthesized via
  `browsePlaceToWaypoint`), even though `DetailPlace.waypoint` is optional.
  (An eighth site, `day-detail-corridor-column:1139`, dispatches
  `{ place: null }` to close the overlay and passes no place.) First draft of
  this entry said "six" — an uncounted number, not a wrong measurement. Exercised it by dispatching a waypoint-less place by hand —
  renders the interest diamond + `var(--cat-interest-title)`, no JS error.
- **Found, not fixed (flagged for follow-up):** the rest of
  `map-detail-overlay.tsx` is still heavily raw-hex, including four more
  `#A6C9F9` / `rgba(166,201,249,…)` sites that should be category tokens
  (tag pills `:329-331`, reliability `:528`, route box `:692-693`, stat
  `:810`). Separately, **2 of the 45 category role tokens drift between
  globals.css and DESIGN.md §1.2** — `--cat-interest-title` (`#C9BFA6` live
  vs `#BAB0AF` documented) and `--cat-interest-badge-border` (`#C9BFA6` vs
  `#888888`). globals.css is the master per DESIGN.md §7, so the table is
  the stale side. Both parked in BACKLOG.md.
- **Harness note:** headless Chrome needs `--use-angle=swiftshader
  --enable-unsafe-swiftshader`. Without software WebGL the `MapColumn`
  Mapbox init throws, the slideup hits its error boundary, and the page
  reads "Couldn't load this trip" — which looks exactly like a data or auth
  failure and is neither.

## 2026-08-31 (later) — Day-detail description slot (#323), HTML strip across all description surfaces (#324), google-resolved tile category fix (#325)

- **PR #323 shipped (`2f61aa1`):** added a description slot to the
  `CategoryListCard` primitive and wired it at every day-detail call site —
  6 in `day-detail-corridor.tsx`, 3 in `day-detail-node-blocks.tsx`
  (drag overlay + main tile + Along-the-way pool). Line-clamp is `line-clamp-2`
  per Adam's design call, overriding the `slideup-overlay-states-v2.md:128`
  spec's `line-clamp-3`. Card height math done up front from CSS values
  (not estimated): title 23 + gap 2 + verified 20 + gap 2 + description
  2×21 + gap 2 + status/Details 18 + top pad 4 = 113 with description,
  ~82 without — per-card +33px growth. `PLACE_ROW_PX` pre-mount estimate
  in `continuous-scroll.ts` bumped 96→127 to match, so a cold-scroll
  never-yet-mounted day slot doesn't jump DOWN when real content mounts;
  the corresponding test's hardcoded 96 updated to 127.
- **Visual verification against TEST via CDP** (`/trips/la-to-portland`
  day 1) surfaced a real UX bug that produced a follow-up commit on the
  same PR: every non-curated tile was showing the `mapMasterPlaceRow`
  synthesized `${title} — ${prettyCategory(primary_category)}.` fallback
  string as description ("The Last Bookstore — Oddity.", "Marukai Market —
  Grocery.", "Nijiya Market — Grocery.") — a duplicated-title noise
  pattern that reads as pure garbage on an Atlas Obscura-heavy day. Fixed
  in the primitive via `looksLikeMapperFallback(desc, title)` — pattern
  match on `starts with `${title} — ` + 1-4 Title-Case words + ends with
  `.`. Real editorial descriptions unaffected. Kept the fix in the
  primitive rather than the mapper (`federated.ts:253-255`) because the
  fallback IS load-bearing for surfaces that need any description string
  to render (`MapDetailOverlay`, Top Places) — removing at the mapper
  would need graceful-degrade at those sites too.
- **PR #324 shipped (`f40bee9`):** extracted `stripHtml` to a shared
  module at `web/src/lib/trip-browse/description-text.ts`, upgraded to
  preserve paragraph structure — block-level break tags become `\n`,
  runs of `\n` collapse to at most `\n\n`, and `whiteSpace: "pre-line"`
  added at multi-line render sites so `<p>...</p><p>...</p><p>...</p>`
  sources render as three visual paragraphs. Wired at every non-
  CategoryListCard surface that reads a `master_place`-derived
  description: `map-detail-overlay.tsx`, `day-detail-overview.tsx:501`
  (Top Places), `map-column.tsx:1450` (WaypointDetail),
  `waypoint-card.tsx:127`, `suggestion-card-v2.tsx:101`. `CategoryListCard`
  refactored to import from the shared module. Audit intentionally
  skipped `day-detail-overview.tsx:294` `guide.description`,
  `day-briefing-card.tsx:91` `day.description`, and the
  `category-planning-slide.tsx` demo — all verified not master_place-
  derived. Verified on TEST at `la-to-portland` day 1: Juan Matias Sanchez
  Adobe's overlay now renders three distinct paragraphs with proper
  vertical spacing where the source has a `<p>...</p><p>...</p><p>...</p>`
  sequence.
- **Squash-merge order gotcha this session:** #323 was squash-merged with
  only the first two commits included. The third commit (the shared-
  module extraction that became #324) had been pushed after the squash
  was assembled and didn't ride along. Cherry-picked it cleanly off
  `main` — the removal-of-local-copy + import-from-shared conflict
  resolved automatically because main had the local copy exactly where
  the cherry-pick expected. `day-card-description-bug` branch is
  effectively dead-ended (its commits landed via squash + cherry-pick),
  safe to delete once #324 has settled.
- **PR #325 shipped (`ef62586`):** two-line fix in
  `web/src/lib/itinerary/bake.ts` — `resolvedToTile()` never set
  `category` on the returned `BrowsePlace`, so every LLM-curated Google-
  resolved tile shipped with `category: undefined` and rendered the
  generic "interest" diamond icon on day-detail cards. Threaded
  `rp.category` (already computed by `inferCategory(primaryType)` in
  `resolve.ts:154`) through `primaryCategoryToSlideKey`. Exported
  `resolvedToTile` for testability with 7 assertions in a new
  `bake.resolved-tile.test.ts` covering the Boulder Basin repro
  (`campground → camping`), representatives per category
  (`restaurant → food`, `gas_station → fuel`, `rv_park → camping`,
  `viewpoint → scenic`), and both fallback paths (null → interest,
  unmapped → interest). Measured 352/352 google-resolved tiles across
  TEST's 13 baked trips carried the gap before the fix. Zero regression
  risk — the fix can only replace `undefined` with a valid slide key or
  fall to the same "interest" default.
- **All three fixes are bake-time, not read-time.** Existing baked
  trips — including every reference trip and every UUID trip in
  `public.trips` on TEST — still carry pre-fix `segmentSuggestions[]`
  (Google-resolved tile `category: undefined`, mapper fallback strings
  in descriptions where `master_place.description` was null, raw HTML in
  RIDB/USFS-sourced descriptions). Any new bake picks up all three; the
  existing `refreshCorpusTiles()` action from PR #302 is the retroactive
  path for a user-owned trip.
- **Measurement doc pushed unmerged: `docs/generated-content-bake-gap-
  scope`** — `docs/measurements/2026-08-31-generated-content-bake-gap.md`.
  On TEST: 125,289 `is_searchable` master_place rows total, of which
  105,601 (84.29%) have empty `description`. Of those 105,601: 13,942
  have a `master_place_generated_content` fallback the day-detail bake
  path never reads (the wiring gap A); 91,659 have no fallback anywhere
  (B). A skews 87% OSM-attributed and concentrates in campground/park/
  trailhead/dispersed_camping/ev_charging. B is dominated by peak +
  spring + infrastructure (gas_station, ev_charging, fire_pit, water,
  toilet, dump_station, shower) — the user-facing subset is roughly
  4,700 rows. In the 13 baked trips currently on TEST, 779 wiring-gap
  rows appear in ≥1 trip; only 4 no-fallback rows appear. No PR opened
  per Adam's directive — measurement-only, to inform prioritization.
- **Boulder Basin / Serrano Campground investigations** were both
  reproducers for the same underlying pattern (documented in the
  `2026-08-31-day-detail-description-bug.md` §§6-7 that landed with
  #323): LLM-curated Google-resolved tiles have blank `MapDetailOverlay`
  descriptions because `resolvedToTile()` sets `description: ""` for
  structural reasons (Google's resolve field mask doesn't include
  editorial text). PR #325 fixed the category half of this same
  `resolvedToTile` gap; description is the harder half — Google has
  nothing to give, and merging the duplicate Google-resolved tile with
  its `master_place` equivalent (the "right" fix, entity-resolution
  work) was explicitly parked per Adam's direction. Three real fix
  options for the description half remain listed in the description-bug
  doc §7 for later decision. This is why the Boulder Basin thread ended
  up producing PR #325 (category, narrow) but no description fix (harder,
  not one-line, not chosen).
- **Comprehensive investigation on trip `c70c6a03` day 3** at the tail of
  the session confirmed the important negative: there is NO tile on that
  day where `master_place.description` is populated in the DB but
  `MapDetailOverlay` fails to render it. PR #324's overlay strip + gate
  is correct. Every observed blank or noisy description on the day
  traces to one of two known structural gaps — the Google-resolved
  `description: ""` case (single tile: the LLM-curated "Serrano
  Campground") or the wiring gap the measurement doc covers (many tiles
  showing the mapper fallback string). No code fix in that pass.
- **Category-taxonomy adjacent finding, not resolved:** `facility` as a
  `primary_category` correctly maps to the `interest` slide bucket per
  `federated.ts:17-63`. That means any real campground/park/etc.
  ingested with `primary_category = "facility"` (e.g. "South Fork
  Campground", "California Science Center", most picnic sites on Day 3)
  renders with the diamond icon regardless of what it actually is. Not a
  slide-key bug; a data-vocabulary question. Deliberately left alone per
  the PR #325 prompt.


## 2026-08-31 — Closed-place display filter + operational_status normalization + USFS INFRA PROD ingestion

- **PR #320 (merged to main as `d1a15ff`):** `isClosedDescription()` display-time filter. First iteration was a bare substring match on "closed" — 1,060 matches, 94% false-positive rate (places mentioning closures incidentally). Narrowed to phrase-anchored heuristic (strong phrases + first-sentence + "is closed" with exclusions for activity restrictions, conditionals, schedule notes). Result: 152 matches, ~97% precision.
- **PR #321 (open, `filter-closed-places-display` branch):** operational_status normalization — the structured-field complement to the description heuristic. Investigated all sources for status fields. RIDB `FacilityStatus` confirmed absent from both the search AND individual-facility API endpoints (measured 0/4,793 rows; probed the detail endpoint live — 34 keys, no `FacilityStatus`). **USFS is the only source with structured status data** — `seasonal_operational_status` on 100% of INFRA site rows, `openstatus` on the 6 older recarea rows.
- **Schema changes (3 migrations, applied TEST + PROD):** `master_place.operational_status` TEXT column, `field_precedence` row for `(operational_status, usfs, 1)`, `recompute_master_place()` extended via field_precedence pattern (Option A), `pois_along_corridor` RPC + `master_place_search_export` view both gain `operational_status` column and exclude `CLOSED`/`DECOMMISSIONED` at SQL level.
- **USFS normalizer** (`data/ingestion/sources/usfs.ts`): emits `operational_status` from `props.seasonal_operational_status`. OPEN and NONE → null; everything else stored. The NONE handling was a PROD-discovered bug — 8 PROD recarea rows carry `openstatus="none"` (a "no status recorded" sentinel absent from TEST), initially written as `"NONE"` which `isClosedPlace()` treated as a degraded-status closure. Corrected to null on PROD, added to skip lists.
- **USFS INFRA ingestion ran on PROD** (Adam's explicit sign-off): 3,239 INFRA features fetched, 3,168 rows inserted (71 skipped by category gate, 0 errors). ER produced 2,629 new master_places + 136 auto-linked + 448 manual_review. PROD `master_place` total went from 25,719 → 28,348. The 3,168 vs TEST's 6,324 difference is a corridor-geometry scope difference (PROD has a smaller/different polygon), not a pipeline issue.
- **Backfill results:** TEST: 248 rows updated (242 CLOSED, 3 TEMPORARILY CLOSED, 2 OPEN WITH REDUCED SERVICES, 1 UNREACHABLE). PROD: 51 rows updated (50 CLOSED, 1 TEMPORARILY CLOSED). The PROD CLOSED count is lower because PROD's corridor is smaller.
- **Typesense re-sync:** TEST 33,047 docs (240 pruned). PROD 21,965 docs (6 pruned, +639 net from new USFS places minus closed exclusions).
- **Key architectural finding:** 228 of 246 TEST closed places are caught ONLY by the structured field — their descriptions contain no closure language, so the description heuristic would never have filtered them. This validates the structured-field approach.
- **Display predicate `isClosedPlace()`:** structured status preferred (CLOSED/DECOMMISSIONED always filtered; REDUCED SERVICES/UNREACHABLE filtered only when no photo), heuristic fallback for sources without structured status.
- **Docs:** `docs/specs/operational-status-normalization.md` (scoping spec, status updated to IMPLEMENTED), `docs/decisions/2026-08-31-operational-status-normalization.md` (ADR).

## 2026-08-29 — TasteAtlas six-state editorial source: PR #317 landing fix, TEST build, PROD promotion (both editorial_food and family_destinations)

- **Found and fixed a stacked-PR merge-order bug from the prior session.**
  PR #317 (`editorial_food` multi-publisher source) showed "MERGED" on
  GitHub, but its diff never reached `main`: it was based on PR #316's
  branch, and #316 was squash-merged to `main` *before* #317 landed on
  that branch — so #317's commit was orphaned on a branch GitHub
  considered already merged. Confirmed by direct diff: `data/ingestion/sources/editorial-food.ts`
  didn't exist on `origin/main`. Opened PR #318
  (`feat/editorial-food-multi-source` → `main`, re-targeting #317's exact
  content, no new code) and resolved the resulting merge conflicts:
  `data/ingestion/manual.ts` (kept the branch's `editorial_food` case
  registration — `main` didn't have it, that's the point of the PR) and
  `docs/STATE.md`/`BACKLOG.md`/`LOG.md` (took `main`'s current versions —
  the branch's stale session-diary content was already superseded by
  later sessions). Merged as `2dd8e66`.
- **Built a new `tasteatlas` publisher under the existing `editorial_food`
  source, covering all six states in the trip-planning region** (AZ, NV,
  CA, UT, WA, OR). TasteAtlas's own site is a confirmed Cloudflare
  hard-block (verified via `curl` — not a simple bot-header check, an
  outright "Sorry, you have been blocked" WAF page), so content came from
  Adam manually screenshotting each state's TasteAtlas restaurant page and
  handing them over in batches (10–126 screenshots per state).
- **Repeatable pipeline, same shape every state:** parallel subagents
  extract structured data from the screenshots (name/city/signature-dish/
  description) → dedupe by (name, city) → two-phase Mapbox geocode (city
  forward-geocode for a proximity bias point, then Search Box POI search
  filtered to the correct state) → every wrong-state/no-match/large-distance
  result gets a real WebSearch check (closed? renamed? real address
  elsewhere?) rather than being discarded automatically — this is how most
  closures got caught in the first place → chain-restaurant judgment calls
  (national/international out, single-state/regional-origin stays) → real
  sourced descriptions via WebSearch (never invented; on-card truncated
  text stays truncated) → photo hunt with every candidate URL `curl`-verified
  (200 status + real image content-type) before being trusted — caught the
  fetch tool hallucinating at least one non-existent CDN domain this way →
  any row without a verified real photo gets dropped. Rules doc kept at
  `.context/editorial-food/RULES.md` (gitignored, not in the repo — the
  rules themselves are recorded here since the file isn't).
- **Final counts after all filtering:** AZ 34, NV 15, CA 323, UT 36, WA 60,
  OR 29 = **497 restaurants**. Excluded along the way: confirmed-closed
  businesses (Yelp CLOSED tags / press), a few renamed/rebranded entities,
  national/international chains (Raising Cane's, Panda Express, California
  Pizza Kitchen, Le Pain Quotidien, Sprinkles Cupcakes, Yogurtland, Chin
  Chin, Nobu, Blue Ribbon, Michael Mina, The Original Pancake House, Voodoo
  Doughnut, Salt & Straw), and businesses with no fixed address (food
  trucks). In-region single-state chains (Sammy's Woodfired Pizza, Strip
  House, In-N-Out, Roscoe's, Pizzana, etc.) were kept.
- **Two real ingest-blocking bugs caught before the real ingest ran** (dry-run
  parsed cleanly, but the semantics were wrong): (1) the CSV files were
  named `tasteatlas-<state>.csv`, missing the `-geocoded.csv` suffix the
  ingester globs for — would have silently ingested zero rows, no error;
  (2) `geocode_matched` is read by the ingester as the literal
  `master_place.address` string, not a match-confidence flag — every row
  had `"true"` in that column all session. Backfilled real addresses from
  the already-cached Mapbox geocode results for 492/497 rows; reverse-geocoded
  the remaining 5 hand-override rows from their stored coordinates. Also
  found and fixed one within-state slug collision (`Lolita's Mexican Food`
  — two real, distinct locations in San Diego and Chula Vista colliding on
  the same `external_id`; disambiguated by appending city to the slug).
- **TEST: ingest 497/497, 0 errors.** `materialize --only-categories
  restaurant --skip-sync`: 478 `new_master_place` + 19 `manual_review`, 0
  errors (478+19=497 exactly). `search:sync` against `places_test`: 33,287
  indexed, 0 failed. Verified via direct Supabase/Typesense queries, not
  just exit codes — the 19 manual-review matches are legitimate
  entity-resolution catches (sub-50m from an existing `atlas_oddities` or
  `family_destinations` master_place, high name similarity, below the 0.85
  auto-link threshold), not a bug. Two flagged as probably-wrong matches
  worth a second look, not resolved this session: `Tivoli Bar and Grill` →
  `Mick Jagger's Urinal`, `Rockwell Ice Cream` → `The Tiny Gallery` (both
  AO curiosity-object names at the same coordinates — plausibly a
  different thing at the same address, not the restaurant).
- **PROD promotion — `editorial_food`/`tasteatlas`, Adam's explicit
  authorization, mirroring the AO promotion runbook (PR #314).** All 6
  pending migrations applied together via `db:push-verify` (3
  `family_destinations` + 3 `editorial_food` — ledger ordering required
  applying them in one pass; the `family_destinations` ones are
  schema-only and inert without a matching ingest, which was deliberately
  NOT run in this step). Ingest: 497/497, 0 errors. Materialize: 481
  `new_master_place` + 16 `manual_review`, 0 errors (481+16=497). Typesense
  sync to `places_prod`: 21,315 indexed, 0 failed. Verified with 6 live
  spot-check probes against PROD (not just script exit codes) before
  declaring done.
- **PROD promotion — `family_destinations`, its own separate authorization
  (deliberately not bundled with the above).** The 14-row TEST dataset at
  `.context/family-destinations-guide/` (built in PR #316's original
  session) didn't exist in this workspace — `.context/` is gitignored and
  per-Conductor-workspace. Reconstructed the exact CSV from TEST's
  `source_record.raw_payload.row` for all 14 rows (safer than re-scraping:
  uses the exact data already verified on TEST, not a fresh re-extraction
  that could drift). Ingest: 14/14, 0 errors. Materialize: 11
  `new_master_place` + 3 `manual_review`, 0 errors (11+3=14). Typesense
  sync: 21,326 indexed, 0 failed. Verified with 3 live spot-check probes.
- **Found during PROD verification, not resolved this session: a likely
  duplicate.** `Hodad's` now exists as two separate `master_place` rows —
  one from `family_destinations_guide`, one from `tasteatlas` — not caught
  by entity resolution since the two promotions ran as independent
  passes. Filed for whoever triages the manual-review queues.
- **Every PROD write went through the same discipline:** back up the
  current TEST `data/.env` to `~/.config/overlander/env-backups/`, re-link
  the Supabase CLI to PROD, swap `data/.env` to PROD creds, do the write,
  restore `data/.env` + re-link the CLI back to TEST. Confirmed restored
  after every one of the three PROD operations (migrations, tasteatlas
  promote, family_destinations promote) before moving on.
- **Explicitly deferred, Adam's call:** promoting `family_destinations`
  content had originally been left as "stays TEST-forever, or promote?" —
  answered this session (promote, own pass). The photo-credit gap
  (`familydestinationsguide.com`/`tasteatlas` aggregator-slug, not the
  actual photographer) was raised again before the PROD write and
  accepted as-is by explicit decision, same open question it was before
  for any future source of this shape.

## 2026-08-28 — Family Destinations Guide: test-only editorial source (TEST end-to-end)

- **Task:** test run of "Option A" (full AO parity) using
  `https://familydestinationsguide.com/foodie-road-trip-california/` —
  build a new editorial source with the same pipeline shape AO had, land
  on TEST end-to-end, don't touch PROD. Precursor conversation asked
  about Visit California's food article; that dataset had 0 per-stop
  photos and terse blurbs, so we swapped to a longer-form Family
  Destinations Guide article with rich descriptions + 2 per-stop images.
- **Deliverables in `.context/family-destinations-guide/`** (dataset
  prep, not in the ingest itself):
  - `foodie-road-trip-california.csv` — 14 rows: name, city, slug,
    signature_dish, description, photo_url, article_url, article_author,
    article_date. Extracted verbatim from the article body.
  - `geocode.ts` — Mapbox two-phase geocoder (city geocode →
    proximity-biased Search Box POI lookup → 2-row manual override for
    "Hodad's Ocean Beach" and "Burger Hut Forest Ave"). Adds
    `lng, lat, geocode_relevance, geocode_matched` columns.
  - `foodie-road-trip-california-geocoded.csv` — the resulting enriched
    CSV the ingester reads.
- **Ingester:**
  `data/ingestion/sources/family-destinations.ts`. Structured like
  `atlas-oddities.ts`. `source_id = 'family_destinations'`,
  `source_quality_score = 0.4`, `inferred_category = 'restaurant'`.
  `external_id` includes the article slug so future articles can't
  collide. Registered in `manual.ts` as `--source family_destinations`.
- **Migrations, applied to TEST:**
  - `20260828110000_family_destinations_description_photo_precedence.sql`
    — `field_precedence` row `('description', 'family_destinations', 7)`
    (below atlas_oddities' 6). Extends
    `backfill_master_place_photo_url()` to include family_destinations
    at position 7.
  - `20260828110100_pois_along_corridor_family_destinations_photo.sql`
    — extends the corridor RPC photo lateral chain to include
    family_destinations at position 4 (nps > ridb > wikipedia >
    atlas_oddities > family_destinations).
  - `20260828110200_master_place_search_export_family_destinations_photo.sql`
    — extends the search-export view photo lateral to match.
- **Deviation from the plan I first sketched:** the initial `db:push-verify --test`
  command hung on the interactive `[Y/n]` prompt because the shell
  didn't pipe stdin. Killed the stuck process, re-ran with `echo y |` in
  front, and it landed cleanly. Not a code issue — just a runbook note
  for future migration applies on this workflow.
- **Ingest, materialize, backfill:**
  - `npm run -w data ingest:manual -- --source family_destinations`:
    14 fetched / 14 inserted / 0 errors, ~2s.
  - `ER_APPLY_BATCH_SIZE=25 npm run -w data materialize -- --only-categories
    restaurant --skip-sync`: 20 new master_places, 1 manual_review, 0
    errors. **The 20 count exceeds the 14 family_destinations rows** —
    the materialize sweep also picked up ~6 previously-unresolved
    restaurant records from other sources (google_resolved, google) that
    had been sitting in the ER queue. This is a byproduct of scoping by
    `inferred_category = 'restaurant'`, not a bug. 13 of my 14 rows
    linked; Nepenthe went to manual_review (a common name — likely
    collided with an existing entity).
  - `backfill_master_place_photo_url()` on the 13 linked mp_ids:
    reported 13 rows changed.
- **Live-verify PASSED on TEST via corridor RPC** across 5 corridors
  (San Diego, Central Coast, LA metro, Napa, Chico → Sacramento). Each
  corridor returned family_destinations rows with clean descriptions
  and non-null nps_photo_url (returning the family_destinations photo).
- **Live-verify PASSED on TEST via Typesense `places_test`** across
  10 name probes: 9 of 10 return a `restaurant` document with correct
  description and photo_url. Nepenthe was the miss (still in
  manual_review, not yet linked to a mp → not in the view → not indexed).
- **This pass touched:** 1 new source module, 1 manual.ts edit, 3 TEST
  migrations, 1 new decision doc
  (`docs/decisions/2026-08-28-family-destinations-test-only-editorial-source.md`),
  the CSV dataset in `.context/`. No PROD reads, no PROD writes.
- **Flagged for follow-up (in BACKLOG):**
  - Nepenthe (1 row) sits in manual_review; needs a triage decision
    (auto-link to the existing entity, or `resolve_place_match_to_new_master_place`).
  - Photo credits: currently set to `"familydestinationsguide.com"` (the
    aggregator, not the original photographer). If we ever promote,
    revisit — original credits are user-profile URLs.
  - Not scoped for PROD promotion this session; test-only per Adam's
    directive. If a PROD promotion is later decided, the runbook is
    identical to the AO runbook (PR #314 §Part 2).

## 2026-08-28 — Atlas Obscura: PROD /search gap closed (Typesense sync + view extension)

- **Task:** Part 3 of the multi-part AO promotion — investigate `/search`
  before assuming Typesense, then close whatever gap exists so AO surfaces
  on `/search` post-PR-#314. Adam's premise (that `/search` might be running
  on live Google Text Search) explicitly needed confirming from code, not
  inferring.
- **Investigation, cited from code:**
  - `web/src/app/search/page.tsx` renders `<PlaceSearch>` (line 20).
  - `web/src/components/trip/place-search.tsx` calls `search()` from
    `@/lib/search`.
  - `web/src/lib/search.ts` imports `SearchClient` from `typesense`. No
    Google Text Search fallback on this surface. `/search` is Typesense-only.
- **Sync mechanism confirmed:** `data/search/sync-typesense.ts`, corpus-wide
  (reads from `master_place_search_export`, no per-source scoping),
  idempotent (upsert by id), prunes docs not in the current view result.
  Registered as `npm run -w data search:sync`. Shared cluster + separate
  collection per env per `docs/decisions/2026-07-23-typesense-collection-per-env.md`.
- **PROD baseline** (queried this session, read-only via admin key on the
  places_prod collection): **16,516 documents** (matches `docs/DATA_INVENTORY.md`
  §PROD's 2026-08-11 figure exactly), **0 oddity documents**, 30 distinct
  primary_category values, none oddity. Eight direct AO-name queries
  (Voodoo Doughnut, Ethel M Botanical Cactus Garden, Berlin Wall Urinal,
  Willamette Stone, Tovrea Castle, Summum Pyramid, Boontling Language of
  Boonville, Temporary Port Chicago) returned zero real AO hits — confirming
  the gap.
- **First sync pass, corpus-wide against PROD** (env swap: PROD Supabase +
  shared Typesense host/key + `TYPESENSE_COLLECTION=places_prod` per the
  2026-07-23 ADR): fetched 20,834 rows, indexed 20,834, 0 failed, 0
  pruned. The sync auto-added two missing schema fields to `places_prod`
  (`photo_url`, `description_source`) that had drifted since the schema
  was last updated. Duration ~89s. Post-sync: 2,804 oddity docs indexed.
  All 8 AO-name probes now returned the exact expected AO document; all
  descriptions rendered clean (0 markdown leaks — PR #314's converter
  output propagated correctly).
- **Real gap surfaced by the first sync's verify:** every AO doc returned
  `photo_url = null` in Typesense, even though PR #314 had populated
  `master_place.photo_url` for 2,784 AO-linked mps on PROD. Root cause:
  `master_place_search_export`'s `photo_url` lateral filters on
  `source_id in ('nps', 'ridb')` (from migration 20260810180400) — the
  same class of source-list-carried-forward gap the corridor RPC had for
  Wikipedia and atlas_oddities before PRs #299 + #314 extended it. The
  view was never updated in parallel. **This affected `/search` cards for
  wikipedia-photoed AND atlas_oddities-photoed places uniformly** — Wikipedia's
  gap was pre-existing (since 2026-08-26), AO's was new.
- **Deviation from the task's literal "sync step" scope, flagged in the
  PR:** authored migration
  **`20260828100000_master_place_search_export_wikipedia_atlas_oddities_photo.sql`**
  to extend the view's photo lateral's `source_id in` list to
  `('nps', 'ridb', 'wikipedia', 'atlas_oddities')` with precedence order
  `nps > ridb > wikipedia > atlas_oddities` — the same order PR #299 + PR
  #314 wrote into the corridor RPC. Applied to TEST first,
  `db:push-verify -- --test`; direct view query on TEST confirmed AO photo
  URLs surface via the view. Applied to PROD via `db:push-verify`
  (currently-linked project pattern per the runbook), 0 errors.
- **Second sync pass, PROD** (post-migration): fetched 20,834, indexed
  20,834, 0 failed, 0 pruned. Duration ~88s. Post-sync re-verify: **every
  AO probe now returns `photo=y`** — 8/8 known AO names surface with the
  expected oddity doc, its converted description, `description_source =
  'source'`, and a non-null `photo_url` field.
- **Also synced TEST** for parity (`places_test` collection now matches
  the extended view on the TEST project).
- **Env + CLI restored to TEST** at the end (`data/.env` from
  `~/.config/overlander/env-backups/.env.test-backup`, CLI relinked to
  `znldzjdatkogdktymtvi`).
- **Numbers this session** (all queried, this-session-computed):
  - `places_prod` baseline: 16,516 docs / 0 oddity docs / 30 categories.
  - `places_prod` post-sync: **20,834 docs / 2,804 oddity docs**. Delta
    +4,318 — of which ~2,806 are AO; the other ~1,500 are drift from
    prior source updates that never got synced (photo_url backfills for
    NPS/RIDB, Wikipedia photo landings, etc.). Both sync passes upserted
    all 20,834 docs; the second re-imported after the schema change to
    fill `photo_url` on the newly-widened source set.
- **What this closes:** the search-index gap flagged in PR #314's LOG entry
  ("Typesense sync deferred — the `/search` surface will remain AO-free
  until a sync runs"), plus the same-shape pre-existing Wikipedia gap that
  had been silent since 2026-08-26.
- **Flagged, not done this pass:**
  - The `master_place_search_export` view rewrite is
    IMPLIED PROD deployment via this session's migration + sync (view now
    surfaces Wikipedia + AO photos); Vercel's `NEXT_PUBLIC_TYPESENSE_COLLECTION`
    envvar didn't change so no rebuild is required.
  - Triage of the 60 manual_review AO rows from PR #314 — still open.
  - NPS/RIDB literal-HTML-in-descriptions rendering — still open (same
    class as AO markdown was, adjacent scope).
- **This pass touched:** 1 SQL migration (applied TEST + PROD), 2 new
  read-only scripts (`typesense-places-prod-baseline.ts`,
  `typesense-places-prod-verify.ts`), docs. No web/UI change.

## 2026-08-27 — Atlas Obscura oddities LIVE ON PROD (markdown converter + full six-state promotion)

- **Task:** two parts. Part 1 — build a markdown → plain-text converter
  for AO descriptions (the one remaining product-shape concern from PR
  #312's density-cascade measurement); apply to TEST. Part 2 — promote
  the enriched six-state atlas_oddities corpus from TEST to PROD, per
  the runbook in PR #310's scoping doc §1. Adam signed off on all three
  product-shape questions raised by PR #312 in this same session's task
  message.
- **This closes the oddity-POI PROD-promotion thread open since PR
  #306** (2026-08-27 status check).

### Part 1 — Markdown converter

- **Corpus sample** (`data/scripts/atlas-oddities-markdown-sample.ts`,
  read-only, TEST): 2,858 AO descriptions on TEST. Pattern counts:
  inline_link 1,424 · italic_underscore 527 · bold 14 · blockquote 2 ·
  unordered_list 1 · horizontal_rule 1 · image 1. Not observed:
  heading, ordered_list, asterisk-italic, code, autolink,
  strikethrough, footnote, HTML tag, escaped.
- **Rendering pattern confirmed:** the web client renders descriptions
  as JSX text nodes (`{description}` in `day-detail-overview.tsx` etc.
  — no `dangerouslySetInnerHTML`, no `ReactMarkdown`, no `remark`).
  NPS/RIDB descriptions today ship raw HTML fragments (`<p>`, `<em>`,
  `<br>`) that also render literally as text — the same class of issue
  on a different corpus. Not fixed here (see §Consequences in the ADR).
- **Decision: strip AO markdown to plain text.**
  `data/ingestion/sources/atlas-oddities-markdown.ts` — pure function,
  22 unit tests, no dep added, idempotent. Full ADR:
  `docs/decisions/2026-08-27-ao-description-plain-text.md`.
- **Applied on TEST** via
  `data/scripts/atlas-oddities-apply-markdown-convert.ts`. First pass:
  1,701 source_records updated, 1,699 master_places recomputed, 0
  failed, 1 remaining row (a `****quoted text****` quadruple-asterisk
  variant on the Lola Montez description). Added a `**{2,}` cleanup
  rule + test, re-ran: 4 more rows updated (Lola Montez + 3 similar),
  final AFTER: **zero descriptions carrying markdown syntax**.
- **Live-verify PASSED on TEST** via multi-corridor `pois_along_corridor`
  (`data/scripts/atlas-oddities-manual-verify.ts` re-run — same 5
  corridors PR #311 used, all pass).

### Part 2 — PROD promotion (this is a real PROD write)

- **Explicit checkpoint recorded** in the PR body before touching PROD —
  restated scope, row counts, and Adam's sign-off documented in the
  task message.
- **Runbook executed** per PR #310 §1:
  1. Backed TEST `data/.env` to
     `~/.config/overlander/env-backups/.env.test-preop-ao-prod-promote-20260827-203653`.
  2. `supabase link --project-ref nqzeywzcowujzyegxbsr` (re-linked CLI
     to PROD).
  3. Copied PROD creds to `data/.env` from
     `~/.config/overlander/env-backups/.env.production-backup`.
  4. `npm run -w data db:push-verify` — applied migrations
     **`20260827180000`** (field_precedence + backfill_master_place_photo_url
     extension) and **`20260827180100`**
     (pois_along_corridor photo lateral extension) to PROD. Both applied
     cleanly; verifier confirmed 1 INSERT row for the field_precedence
     row.
  5. **Anchor CSV ingest**:
     `ATLAS_CSV_DIR=/Users/adamwagner/conductor/archived-contexts/overlander/normalizeoddites`
     `npm run -w data ingest:manual -- --source atlas_oddities`. The
     six anchor CSVs live in an archived Conductor workspace, not on
     `main`'s `.context/` — sourced them there; row totals matched the
     PR #241 baseline exactly. Result on PROD: 2,866 source_records
     inserted across 6 states (CA 1,568, AZ 313, WA 302, NV 295, OR
     229, UT 159), 0 errors.
  6. **Materialize** with `ER_APPLY_BATCH_SIZE=25 npm run -w data
     materialize -- --only-categories oddity --skip-sync` — scoped to
     `oddity` inferred_category so only the newly-ingested AO rows
     reached ER. Result: 2,806 `new_master_place` outcomes, 60
     `manual_review_queued`, 0 auto_link, 0 amenity_rollup, 0 errors.
     Skipped Typesense sync (search index) — flagged as a follow-up;
     the RPC-based browse tiles do not depend on it.
  7. **Manual content ingest** on PROD via
     `atlas-oddities-manual-content-ingest.ts --allow-prod` (updated
     the script to accept the flag; earlier PROD-guard rejected any
     non-TEST URL). Result: 2,854 SR updated with description + photo,
     2,794 recomputed, 2,784 photo_url deltas, 0 failed.
  8. **Markdown convert** on PROD via
     `atlas-oddities-apply-markdown-convert.ts --allow-prod`. Result:
     1,697 SR updated, 1,659 recomputed, 0 failed, 0 remaining
     descriptions with markdown syntax.
  9. Restored `data/.env` from
     `~/.config/overlander/env-backups/.env.test-backup` and re-linked
     CLI to TEST (`znldzjdatkogdktymtvi`).
- **Final PROD state** (queried this session, read-only, post-restore):
  - `atlas_oddities` **source_record: 2,866** total (up from 0).
    - with `normalized_payload.description` non-null: **2,854**.
    - with `normalized_payload.photo.url` non-null: **2,844**.
    - linked to a `master_place`: **2,806**.
    - unlinked (in manual_review queue): **60**.
  - **Distinct AO-linked `master_place` ids on PROD: 2,806.**
    - with `attribution.description = 'atlas_oddities'`: **2,794** —
      the 12-row gap corresponds to mps that ER linked AO to alongside
      a higher-priority source whose description wins precedence.
    - with `photo_url` non-null: **2,784**.
- **Live-verify PASSED on PROD** via
  `data/scripts/atlas-oddities-prod-verify.ts` (read-only). Five
  corridors — Portland OR, Seattle WA, Phoenix AZ, SLC UT, Las Vegas
  NV — all return AO descriptions + AO photos on
  `pois_along_corridor`; zero markdown leaks; representative names
  surfaced include Mt. Baker Ridge Sunset Stones (Seattle), Hanny's
  (Phoenix), Snelgrove Ice Cream Cone (SLC), Ethel M Botanical Cactus
  Garden + Berlin Wall Urinal (Vegas).
- **Frozen-baked-trip lesson holds — confirmed, not assumed.** Both
  existing PROD reference trips inspected via the same verify script:
  `la-to-portland` (10 days, 0 baked segmentSuggestion tiles — likely
  a spec-shaped legacy trip) and `la-to-deadhorse` (66 days, **1,977**
  baked segmentSuggestion tiles). **Zero AO-attributed tiles in either
  baked snapshot** — new AO content did not retroactively appear.
  Existing user trips (not enumerated here — would need a
  `public.trips` scan Adam has not authorized) will behave the same:
  next generation surfaces AO; existing snapshots stay frozen unless
  `refreshCorpusTiles()` from PR #302 runs.
- **Flagged, not done:** Typesense search-index sync. The corridor
  browse tiles work without it (RPC reads from `master_place`, not
  Typesense); search results — the `/search` surface — will remain
  AO-free on PROD until a search-sync is scheduled. Filed in BACKLOG.
- **Also flagged:** the 60 manual_review-queued AO rows on PROD. These
  need review before they become linked; noted in BACKLOG for a later
  triage session. Analogous to the 4-row TEST tail from PR #241's
  original ingest.
- **All gates green** (`npm run -w data typecheck`, `npm run -w web
  typecheck`, `cd web && npx next build` — all exit 0).
- **New files this PR:**
  - `data/ingestion/sources/atlas-oddities-markdown.ts` (+ tests)
  - `data/scripts/atlas-oddities-apply-markdown-convert.ts` (idempotent,
    TEST + PROD via `--allow-prod`)
  - `data/scripts/atlas-oddities-markdown-sample.ts` (read-only sampler)
  - `data/scripts/atlas-oddities-prod-verify.ts` (read-only PROD verify)
  - `docs/decisions/2026-08-27-ao-description-plain-text.md`
  - Modified: `data/scripts/atlas-oddities-manual-content-ingest.ts`
    (accepts `--allow-prod`).

## 2026-08-27 (later) — manual GPS coordinate entry: post-merge verification hit a wrong premise, then a real infra limit

- **The verification ask's own premise was wrong, and finding that came
  first.** Asked to verify the merged feature "on TEST" via the deployed
  `main`. Merging to `main` deploys Vercel Production
  (`overlander-one.vercel.app`), which points at PROD Supabase, not TEST —
  proved by injecting a real TEST-signed session JWT into the live URL and
  watching it bounce to sign-in (a PROD-configured site can't validate a
  TEST-signed token). No write was attempted against that URL — confirmed
  the mismatch first, then stopped and asked before switching to local dev.
- **The UI-level behavior (toggle, region-exemption, inline validation)
  verified clean against the actual merged code**, with zero drift from
  the pre-merge branch check — same real headless-Chrome technique, this
  time against `origin/main`'s tip.
- **A shared-environment race made the full submit-to-DB check genuinely
  inconclusive, not just inconvenient.** The local dev server this session
  used was also showing signs (circumstantial, not proven) of independent
  activity from another browser on the same machine — a real trip appeared
  in TEST `public.trips` with data this session never entered. Rather than
  assume it was this session's own doing, checked `lsof` (one listener on
  :3210) and this session's own browser tab's DOM state directly before
  concluding — the tab was still on `/plan/expedition`, idle, meaning this
  session's own click genuinely hadn't registered yet at that point.
- **Found a real browser-automation gotcha along the way:** plain
  `.click()` on the submit button silently did nothing in this app's React
  tree under CDP; `dispatchEvent(new MouseEvent('click', {bubbles: true,
  cancelable: true, view: window}))` worked. 150+ seconds of polling had
  produced no signal because the click had never actually registered —
  worth remembering before concluding a submit handler is broken.
- **The actual blocker for finishing the full check was the shared
  Anthropic key running out of credits mid-session**, not a code defect —
  the error surfaced cleanly via the app's own error banner. No trip was
  persisted from this session's own attempt (confirmed by re-querying TEST
  immediately after), so no cleanup was needed. The equivalent pipeline
  check (real Mapbox + real Claude + real TEST insert) had already passed
  9/9 twice pre-merge, when the key still had credit.

## 2026-08-27 — manual GPS coordinate entry for expedition start/end

- **Started from a read-only investigation, not a code change.** Before
  touching anything, traced whether `/plan/expedition`'s start/end path had
  any hard `place_id` dependency. It didn't: the wizard's city search is
  Mapbox Geocoding v6 (not Google Places, which only appears once, in the
  LLM-audit path for key-stop names — a disjoint mechanism), and `coords`
  was already the preferred signal downstream everywhere it's consumed.
- **The one real design call was made explicit up front, not discovered
  mid-build.** Adding raw coordinate entry means the planning-region gate
  has no `region_code` to check for that row. The decision (bypass, not
  reverse-geocode) was stated as an assumption in the build prompt and
  recorded as its own ADR rather than folded silently into the code —
  `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`.
- **The exemption is scoped to a new explicit flag, not inferred from
  `coords` + null `region`.** `manualCoords: boolean` on
  `ExpeditionDestination`, read narrowly in `validateExpeditionForm`
  (`!d.manualCoords && !isInPlanningRegion(...)`), so a future bug in the
  autocomplete path that somehow drops the region code still fails closed
  instead of silently riding this exemption.
- **Verification ran the real pipeline twice, in two different ways, on
  purpose.** A script (`verify-manual-coordinate-anchor.ts`) mirrors
  `generateExpeditionTripAction` function-for-function — real Mapbox
  routing (212.6 mi resolved from the manual point), real Claude
  generation (3 days), a real signed-in TEST `public.trips`
  insert/read-back/delete. Separately, a real headless-Chrome session
  confirmed the actual rendered control — reachability
  (`elementFromPoint`, not just a fired handler), the mode swap, the inline
  range-validation error, and a clean revert on toggle-back. Neither
  substitutes for the other: the script proves the pipeline handles
  coordinate-only anchors; the browser check proves the UI wiring that
  produces them actually works and is reachable.
- **This Conductor workspace needed `npm install` and a Chrome
  headless launch from scratch** — no dependencies and no preview-MCP
  tooling were present at session start, unlike a warm dev environment.
  Standard `npm install` + `Google Chrome.app --headless=new
  --remote-debugging-port` + a CDP driver script over Node's global
  `WebSocket` were sufficient; no new dependency was added to the repo.
- **No surprises in the pipeline itself** — every real-pipeline check
  passed on the first run, consistent with the investigation's prediction
  that coordinates were already ground truth throughout.

## 2026-08-27 — Atlas Obscura oddities: PROD-promotion scoping (no go/no-go decision made)

- **Task:** scope-only pass on how the AO corpus (now enriched on TEST via
  PR #309) would promote to PROD, which currently has zero atlas_oddities
  rows. Explicit no-op on the promotion itself — plan and open questions
  only, no PROD writes, no PROD reads this session (all analysis TEST-side
  or from `docs/DATA_INVENTORY.md` snapshots).
- **Deliverable:**
  `docs/proposals/2026-08-27-atlas-oddities-prod-promotion-scoping.md`.
- **Key findings (full detail in the proposal):**
  - **No general TEST→PROD sync exists.** `data/entity-resolution/promote.ts`
    is ER match application, not project sync. Every prior PROD ingest
    (OSM six-state, NPS six-state, state parks) followed the same
    supabase-CLI-relink + `data/.env`-swap runbook, ran the source's own
    ingester against PROD, and reverted. AO's promotion is that same
    runbook applied twice — once for the PR #241 anchor CSVs (Step A),
    once for the PR #309 manual-content script (Step B) — plus PR #309's
    two migrations landing on PROD in between.
  - **Density-cascade risk characterized in SHAPE but NOT MEASURED.**
    Corridor-city selection is geometric (3mi to polyline per PR #296)
    and doesn't change with POI density. What DOES change: pool
    composition inside each corridor city, and whether
    `filterVisibleSpineItems()` (PR #300–#303) drops a city or not
    with AO content added. Two viable read-only measurement paths
    identified (TEST-corpus RPC diff; PROD read-only shape query),
    neither run this pass — explicit deferral.
  - **Enriched AO POIs by state on TEST (real, this-session-computed):**
    CA 1,537 (86%), OR 227 (13%), state-NULL 23. AZ/WA/NV/UT all zero —
    no manual dataset yet. Full breakdown incl. the 2,868 all-AO figure
    in the proposal §2.2 and in
    `data/scripts/atlas-oddities-prod-scoping-density.ts`.
  - **Baked-trip impact:** existing PROD trips (`la-to-portland`, user
    trips, the standing PROD instrument) will NOT retroactively surface
    AO content — `segmentSuggestions` are frozen snapshots per PR #302's
    lesson. Two paths flagged (do-nothing default; bulk-refresh via a
    not-yet-built wrapper around `refreshCorpusTiles`). Adam's decision.
  - **Rollback is clean.** `UPDATE source_record SET is_active = false
    WHERE source_id = 'atlas_oddities'` + recompute affected mps + rerun
    `backfill_master_place_photo_url` on those mps. No cross-source
    entanglement. The two migrations can stay applied on PROD (additive)
    or be `CREATE OR REPLACE`'d back to their prior forms if desired.
  - **AZ/WA/NV/UT gap:** three sequencing options (§5) — promote OR/CA/LA
    now, wait for six-state, or promote only-enriched-subset. Doc
    recommends A, flags it's Adam's call.
- **Doc's own recommendation: NO-GO this session at any timing.** Three
  prerequisites listed: Adam decides §5 A/B/C; run the TEST-side RPC
  measurement (Path A in §2.4); decide baked-trip strategy in §3.
- **What I could NOT investigate safely without touching PROD** (explicit
  list in the proposal): exact PROD OR/CA-region density today, PROD
  user-trip count in scope, `master_place_search_export` row-count
  reshape, and pending-migration ledger drift. All reachable with safe
  read-only PROD queries whenever Adam authorizes.
- **This pass touched only `docs/` and `data/scripts/atlas-oddities-prod-scoping-density.ts`
  (new, read-only).** No schemas, no PROD reads, no PROD writes.

## 2026-08-27 — Atlas Obscura manual content ingest (OR + CA + LA → TEST)

- **Task:** ingest manually-supplied Atlas Obscura editorial content
  (descriptions + hero photos) for the existing atlas_oddities corpus on
  TEST. Sources: `/Users/adamwagner/atlas-obscura-{or,ca}/data/*.csv`.
  Adam's directive was Flow C — content flows all the way to master_place
  so it appears in trip generation, not just source_record.
- **Provenance gate.** The OR/CA READMEs describe scraping via `r.jina.ai`
  (an atlasobscura.com bot-detection bypass); the 2026-08-20 no-fetch ADR
  (on `odd-food` branch, not on `main`) names exactly this technique. I
  stopped and flagged before touching the CSV. Adam superseded the ADR
  for this ingest ("test content, not live commercial") and directed me
  NOT to modify/reference the ADR in this PR — it stays scoped to
  live-site scraping on the `odd-food` branch. No decision doc touched
  in this PR.
- **Match strategy: exact join on `atlasobscura:<slug>` external_id**
  (slug parsed from AO URL). Preferred over name matching — the existing
  atlas_oddities ingester (PR #241) uses the same slug-based external_id,
  so it's the natural join key. Not fuzzy.
- **Sources resolved with priority CA > OR > LA.** CA has 1,564 rows +
  photos; OR has 230 independent rows + photos; LA has 245 rows but no
  photo columns — after dedup against CA (near-subset), LA contributed
  exactly 2 slugs. Union: **1,796 unique slugs**.
- **Match rate: 1,789 / 1,796 CSV slugs → existing TEST source_records.**
  All 1,789 linked to a master_place (100% link rate — no unlinked
  source_records in the matched set). 7 unmatched slugs skipped (all
  simply absent from TEST, none ambiguous): the-dorn-pyramid,
  mojave-phone-booth, rosicrucian-park, museum-of-western-film-history,
  salton-sea-duck-blinds, top-gun-piano (CA), tin-pan-theater (OR).
- **Landing schema.** `source_record.normalized_payload.description ←
  about`, `source_record.normalized_payload.photo ← {url:
  photo_source_url, credit: "Atlas Obscura"}`. Matches the existing
  NPS/RIDB/Wikipedia shape. `blurb`, `know_before_you_go`, `tags`,
  local `photo_file` JPEGs — not touched (scope was description + photo).
- **Flow C mechanism (three DB pieces).**
  - Migration **`20260827180000`** adds `field_precedence` row
    `('description', 'atlas_oddities', 6)` (below the existing 5-source
    chain, so AO only fills gaps) AND `CREATE OR REPLACE`s
    `backfill_master_place_photo_url()` to add atlas_oddities at
    precedence position 6 (below nps/ridb/wikipedia/blm/state_parks).
  - Migration **`20260827180100`** extends `pois_along_corridor()`'s
    photo lateral join to include atlas_oddities (position 3, below
    nps/ridb/wikipedia — same shape as the 2026-08-26 wikipedia
    extension). Without this, the browse-facing RPC would return
    `nps_photo_url` from the old 3-source lateral and AO photos would
    stay latent. Search-export view NOT extended — Wikipedia PR #299
    didn't either, so this mirrors that.
  - Ingest script
    **`data/scripts/atlas-oddities-manual-content-ingest.ts`** updates
    normalized_payload, calls `recompute_master_place(id)` per unique
    linked mp_id, and calls `backfill_master_place_photo_url(ids[])` on
    the same set. 1,789 SR updates + 1,787 recomputes + one chunked
    photo backfill; 0 failures throughout. ~7 min end-to-end.
- **Result — source_record** (queried TEST 2026-08-27): 1,789 carry an
  AO `normalized_payload.description`; 1,779 carry an AO
  `normalized_payload.photo.url` (baseline: 0 / 0). The 10 gap between
  description and photo counts is the LA-only rows + the CA rows the
  README flags as photo-less — description written, photo left null.
- **Result — master_place** (queried TEST 2026-08-27, scoped to the
  1,787 unique mp_ids the ingest touched): 1,751 now carry an
  AO-attributed description; 36 kept a description from a higher-priority
  source (nps/ridb/google/ioverlander/osm) — correct, by design of the
  priority-6 posture. Photo_url populated on 1,777 (up from 32);
  `backfill_master_place_photo_url()` reported 1,745 mp rows whose
  photo_url actually changed. Across ALL 2,868 distinct atlas_oddities-
  linked master_place rows (a superset of the 1,787 scope), 1,792 carry
  a photo_url — the extra 15 outside my touched set are AO-linked mps
  with a pre-existing higher-priority-source photo.
- **Live-verify PASSED via `pois_along_corridor` on a Portland-area
  corridor** (2-point line through downtown + NE, 16km buffer). RPC
  returned 263 rows; 67 carry BOTH `attribution.description =
  'atlas_oddities'` AND `photo_credit = 'Atlas Obscura'`, with real AO
  editorial text (Voodoo Doughnut, Willamette Stone, Wilhelm's Portland
  Memorial) in `description_source = 'source'`. This is the actual read
  path trip generation uses for browse tiles (via `fetchFederatedPois`
  → `mapMasterPlaceRow` in `web/src/lib/trip-browse/federated.ts`), so
  the verify is end-to-end, not just DB shape. Test in
  `data/scripts/atlas-oddities-manual-verify.ts`, idempotent.
- **Closes** the "data quality/readiness" open thread from the
  2026-08-27 status check (PR #306). The remaining thread from that
  status check is **TEST → PROD promotion** — orthogonal to this ingest
  and unchanged; PROD still has zero atlas_oddities rows. BACKLOG
  updated to reflect the new state.
- **Format gotcha to note for future AO reads.** The `about` field
  contains raw markdown (inline `[link](url)` syntax, real newlines,
  literal `[Portland](https://...)`-style links). Landed as-is in
  `normalized_payload.description` and thence in `master_place.description`.
  Downstream tile rendering treats descriptions as text; markdown links
  will render literally, not as hyperlinks. Acceptable for TEST content
  per Adam's directive; if AO content ever moves to a production-facing
  surface, a markdown → plain-or-rendered conversion is a separate
  question.


## 2026-08-27 — Atlas Obscura manual content ingest wave 2 (WA + AZ + UT + NV → TEST)

- **Task:** extend PR #309's AO content ingest to the four remaining
  six-state manual datasets Adam supplied later the same day at
  `/Users/adamwagner/atlas-obscura-{wa,az,ut,nv}/`. Closes the
  §5 gap flagged in
  `docs/proposals/2026-08-27-atlas-oddities-prod-promotion-scoping.md`
  (AZ/WA/NV/UT enrichment coverage was zero after wave 1).
- **Same shape as PR #309.** All four state CSVs follow CA's column
  layout (`n, name, city, lat, lon, url, blurb, tags,
  know_before_you_go, photo_file, photo_source_url, about`), each row
  carries a write-up + a hero photo, per-README counts: WA 341, AZ
  313, UT 170, NV 293.
- **Same script, extended `CSV_SOURCES` array.** No new migrations —
  the two from PR #309 (`20260827180000` field_precedence +
  photo-RPC extension; `20260827180100` `pois_along_corridor` photo
  lateral) already carry atlas_oddities in their precedence chains
  and cover this pass unchanged.
- **Two script hardenings this pass.**
  - **Idempotence short-circuit** in `updateOneSourceRecord`:
    returns `false` when the incoming description + photo already
    match the source_record's stored values; only actually-changed
    rows fire an UPDATE. Confirmed live — the 1,789 rows PR #309
    landed came back as `unchanged` on this pass at
    ~300k-rows/sec (no DB write). Without this, a full seven-CSV
    re-run would have re-issued 1,789 no-op writes and 1,787
    no-op recomputes.
  - **`changedMpIds` set** feeds recompute + photo backfill only
    for source_records that actually changed. 1,069 recomputes this
    pass instead of the full 2,858 that would otherwise fire.
- **Match rate: 2,858 / 2,913 CSV rows.** Broken down: CA 1,564, OR
  230, LA 2 (post-dedup vs CA), WA 341, AZ 313, UT 170, NV 293 =
  2,913 unique slugs; 55 unmatched (all just absent from TEST — none
  ambiguous). Unmatched distribution: 6 CA + 1 OR (already-known from
  PR #309), and ~48 across WA/AZ/UT/NV (largely UT-heavy in the
  visible list — likely AO pages added post the PR #241 anchor-CSV
  scoping).
- **Result — source_record** (queried TEST 2026-08-27, this pass):
  1,789 were `unchanged` (PR #309's set); **1,069 were freshly
  written** (WA/AZ/UT/NV). After-count: 2,858 atlas_oddities rows
  carry a `normalized_payload.description`; 2,858 carry a
  `normalized_payload.photo` object. All new photos have
  `photo.url` non-null — no CSV-photo-less rows this pass, unlike
  wave 1's LA + 8-CA case.
- **Result — master_place** (scoped to the 1,069 mp_ids whose
  source_records actually changed this pass): 1,069 recomputes fired,
  0 failures; `backfill_master_place_photo_url()` reported 1,054 rows
  whose `photo_url` actually changed. After-count across ALL 2,858
  distinct matched mp_ids: **2,804 carry an AO-attributed description
  (up from 1,751); 2,846 carry a `photo_url` (up from 1,792)**.
  Deltas from this pass alone: +1,053 mp AO-description and +1,054
  mp photo_url.
- **Live-verify PASSED via `pois_along_corridor` on FIVE corridors,
  one per state batch** (Portland OR from wave 1; Seattle WA, Phoenix
  AZ, Salt Lake City UT, Las Vegas NV from this pass). Every corridor
  returned rows with both `attribution.description = 'atlas_oddities'`
  AND `photo_credit = 'Atlas Obscura'` — Tovrea Castle in Phoenix,
  Summum Pyramid in SLC, The Last Remaining Sigma Derby Machine in
  Vegas, Hiram M. Chittenden Locks in Seattle, all with real AO
  editorial prose. `data/scripts/atlas-oddities-manual-verify.ts`
  extended to the multi-corridor shape.
- **This pass touched only `docs/`, extended
  `data/scripts/atlas-oddities-manual-content-ingest.ts` (added four
  CSV entries + idempotence + changed-mp tracking), and extended
  `data/scripts/atlas-oddities-manual-verify.ts` (multi-corridor).**
  Zero PROD reads. Zero PROD writes.
- **Downstream note for the PROD-promotion scoping (PR #310).** The
  §5 "sequencing" question in the scoping doc now takes a different
  shape: TEST content coverage is uniform across all six states,
  not asymmetric. If Adam picks Option A (promote now), PROD's first
  AO tiles would render with description + photo across the whole
  six-state scope — no in-region content gap. Option C (enriched-
  subset-only) is now essentially the same as Option A because
  enrichment coverage on TEST is effectively total (2,858 of
  2,870 total atlas_oddities carry a description; the 12-row
  residual is the wave-1 CA-photo-less + LA-only tail from PR #309
  and 4 mismatched-state slugs). Option B (wait for six-state) is
  moot — the six-state manual dataset has now arrived. Scoping doc
  not edited in this PR; the update belongs there if Adam wants it
  and doesn't affect any actual PROD action.

## 2026-08-27 — day-detail spine: density-cascade cleanup + prominence-ranked featured picks (#300–#305)

- **Started from a screenshot, not a hunch:** strict-proximity corridor selection (#296) was surfacing 21–29 bare corridor-city headers/day with nothing under them (no card, no photo, no "Explore more"). #300 (`ca46f57`) added `filterVisibleSpineItems()` to drop a city from the RENDERED spine (not the data — `Day.corridorCities` is untouched) when its pool is genuinely empty and it has no featured card. Start/end anchors always render regardless.
- **The same single check kept generalizing cleanly instead of forking into parallel filters:** #301 (`71b815c`) extended it to fuel/EV-charging-only pools; #303 (`a4da5af`) extended it again to "non-fuel but undescribed" pools (the empty-pool and fuel-only cases both fell out as special cases of one `hasRealContent` rule, confirmed by re-running all prior tests unchanged).
- **Two real wiring gaps found and fixed along the way, not hypothetical:** `CorridorPlace` had no `description` field at all — `placePool()` silently dropped it even though `BrowsePlace`/`Waypoint` both carry one (#303). `master_place.prominence_score` is selected by the `pois_along_corridor` RPC and already used to `ORDER BY` its own results, but `mapMasterPlaceRow()` silently dropped it before it reached `BrowsePlace` (#305).
- **#305** (`84306e3`) is the capstone: every rendered city, not just an LLM-curated anchor, now shows an inline featured pick — anchor+curated priority preserved, everything else falls back to the pool's own highest-`prominence_score` tile that clears `hasRealContent` (tiebreak: photo presence, then stable id).
- **#302** (`aa12d8f`) was a detour that resolved a real mystery: the "Refresh trip data" action had genuinely already been built, but on a *different* Conductor workspace (`cayenne`, branch `nps-injest`, commit `84e5a147`) — never merged to `main`. That branch was not clean; only 1 of 7 commits was the real unmerged work (the rest were already-merged-elsewhere duplicates or docs commits making unverified PROD claims — deliberately left behind, filed to BACKLOG rather than dropped silently). Cherry-picked the one isolated commit onto a fresh `main`-based branch.
- **#304** (`22ed1df`) is the one LLM-prompt change: `master-prompt.ts` now explicitly invites a key stop located WITHIN a day's own anchor city, not only along the route out of it. Verified with one real, approved-spend LLM generation — an anchor that previously got zero in-city picks got 4.
- **Recurring lesson, worth remembering before the next round on this component:** several points mid-session that looked like "the fix isn't working" turned out to be `localhost:3210` serving a stale, different Conductor workspace's branch (`cayenne`/`nps-injest`, which never had any of this arc's code) — not a code regression. `lsof -p $(pgrep -f 'next dev') | grep cwd` (already in `web/AGENTS.md`) is the fast check.
- **Verification discipline shifted mid-arc:** #300–#301 leaned on unit tests; from #303 onward, every PR was also verified live against real TEST data — minted `seed-owner` sessions, headless-Chrome CDP screenshots at `localhost:3211`, and for #302/#305, real DB snapshot→mutate→render→restore cycles using existing real corpus tile ids (never fabricated) to reproduce the exact reported pattern before proving the fix.
- **Known limitation, flagged not glossed over:** `description`/`prominenceScore` are absent on any trip baked before 2026-08-27 (existing `segmentSuggestions` are snapshots) — a pre-existing trip needs `refreshCorpusTiles()` (#302) or a regeneration before the new filter/feature logic has real values to work with.
- All six PRs merged; `origin/main` tip is `6d008c0` (#306 — a separate, unrelated status-check session, not this arc). Full gate green throughout (final: 646 web tests, `next build` + `web typecheck` exit 0). No PROD reads/writes, no schema changes. No ADR written for this arc — flagged as a gap in STATE.md, not resolved here.

## 2026-08-27 — status check: "why did oddities never reach PROD?" investigation

- **Task:** confirm whether a previously-dispatched investigation into oddity
  POIs on TEST but zero on PROD had produced findings anywhere (branch, PR,
  committed docs, uncommitted local work, or another workspace's `.context/`).
  Explicit no-op on the investigation itself — status check only.
- **Finding: no such investigation exists in this workspace.** Current branch
  `oddity-promotion-status-check` was created for this task and is 0 commits
  ahead of `origin/main`. `.context/todos.md` is empty. No LOG.md entry, no
  measurement doc under `docs/measurements/`, no decision under `docs/decisions/`,
  no BACKLOG.md item on TEST→PROD atlas_oddities promotion. Two other local
  branches (`normalize-oddities-adapter`, `odd-food`) exist but hold only the
  original 2026-08-20 work already merged as PR #241 and the `odd-food` docs
  commit — no promotion-oriented follow-up. No open PR mentions oddity promotion.
- **Prior context that IS in the repo** (not this session's work, cited for
  Adam's reference before deciding whether to formally re-dispatch):
  - PR #241 (merged 2026-08-20, `f39e497`) shipped the CSV-driven Atlas Obscura
    ingester as source `atlas_oddities` — **TEST-only ingest**. `docs/DATA_INVENTORY.md`
    §TEST records atlas_oddities at 2,870 active / 2,870 total source_records as
    of 2026-08-21; §PROD's 2026-08-11 breakdown does not list `atlas_oddities`
    at all (0 rows) — consistent with a source that was only ever ingested to
    TEST. The 2,747 figure in the task prompt is close to but distinct from the
    2,870 in the docs; I did not query TEST to reconcile.
  - `docs/decisions/2026-08-20-no-ao-fetch-rule.md` (on branch `odd-food`, not
    on `main`) codifies the standing rule against fetching `atlasobscura.com`.
    Scope of that rule: **the live site is off-limits (Cloudflare + licensing
    risk); the CSV data already ingested via the one-time authorized channel is
    NOT covered by the rule.** Task prompt frames "NOT Atlas Obscura — no
    official API, under a standing no-scrape rule" — the standing rule applies
    to future scrapes, not to the existing corpus, and the existing TEST corpus
    is Atlas Obscura. Flagging so Adam can confirm whether the legitimacy
    question in the task scope is about the existing atlas_oddities rows or
    about a hypothetical different source.
  - The existing atlas_oddities TEST corpus HAS shown up in real trip generation
    on TEST — STATE.md's 2026-08-25 masthead names "Mick Jagger's Urinal", "Space
    Farms Zoo", etc. among machine picks on trip `ab146c1d` under a `scenic`
    guarantee. So the source is wired end-to-end on the code path; the missing
    piece is data on PROD, not code.
- **Decision by Adam pending:** re-dispatch the investigation formally (I did
  not begin it, per instructions), or close the question. A BACKLOG entry
  filed to keep the open question visible.
- **This pass touched only `docs/LOG.md` and `docs/BACKLOG.md`** — no code, no
  schema, no PROD reads, no TEST reads. Committed on branch
  `oddity-promotion-status-check`, PR opened against `main` for Adam to review.
.

## 2026-08-26 — NPS campground + park photo extraction

- **Finding:** NPS photo pipeline was already 90% built — places (`nps:place:*`)
  had photos extracted, stored, and flowing through the corridor RPC to card
  rendering. But campgrounds (`nps:campground:*`) and parks (`nps:park:*`) were
  excluded: their schemas didn't parse `images`, their normalizers didn't set
  `photo`, and the backfill script only looked at `raw_payload.place.images`.
- **Fix:** Added `images` to `CampgroundSchema` + `ParkSchema`, `photo` to
  `normalizeCampground()` + `persistParkBoundary()`, `fields=images` to
  `fetchPark()`. Widened backfill script to cover all three record types.
- **Backfill (TEST):** 305 source_records updated (campgrounds + parks gained
  `normalized_payload.photo`), 192 master_place rows gained `photo_url`. Total
  corpus photo coverage: 7,443 master_place rows (was 7,360). Idempotent on
  re-run (0 changed).
- **Verified:** corridor RPC returns `nps_photo_url` for campgrounds (Jumbo Rocks,
  Hidden Valley, Sheep Pass in Joshua Tree corridor). Non-NPS POIs unaffected.
- **NPS API terms:** content is public domain per nps.gov/aboutus/disclaimer.htm.
  Some photos carry third-party credits; the existing `NpsPhoto.credit` field
  handles this. The codebase already cached NPS photos — this extends, not
  introduces, the pattern.
- **Stale comment fixed:** `bake-corridors.ts` said "no ratings/photos" when
  corpus photos ARE supported via the corridor RPC lateral join.
- **PROD requires:** merge → `backfill:nps-photo -- --confirm` →
  `backfill:mp-enrichment -- --confirm`.

## 2026-08-26 (redesign) — corridor-city selection: strict 3mi proximity

- **Design change (Adam's decision, delivered as an attachment):** replace the
  prominence + 50mi-`minSpacing` selection in `deriveCorridorCities` with a
  strict rule — a city is a corridor node iff its offset from the day polyline
  is ≤ 3mi. No prominence, no spacing suppression, no gap-fill fallback. This
  is one redesign that fixes BOTH prior symptoms: SF/Sacramento false-positives
  (now excluded by the tight gate) AND the Concord/Fairfield/Vacaville/Davis
  false-negatives (no longer suppressed).
- **Scoped `bufferMi` correctly.** `bufferMi` (15mi) is SHARED — bucket.ts,
  bake.ts, stretches.ts, seeds.ts read it as the on-corridor tolerance. Changing
  it globally would have side effects the task forbade. Added a NEW `corridorMi`
  (3mi) used ONLY by the city-inclusion gate; `bufferMi` untouched.
- **maxNodes 4 → 40** (pathology backstop, along-route truncation, never
  prominence). Forced by data: strict inclusion surfaces many real cities on a
  dense day (measured 21 Palo Alto→Colusa, 29 San Jose→Reno), and Davis was
  ~18th along its route — a low cap would re-drop the named cities.
- **Dedup:** added a tight 0.5mi same-point dedup (keep more prominent). Flagged
  it was a NO-OP on the measured trips (closest real pair 0.77mi); it guards
  true duplicate rows only. Same tight radius replaced the old 50mi
  seed-vs-gazetteer dedup.
- **Removed** `minSpacingMi` + `maxGapMi` params (no non-test consumers) and the
  greedy/gap-fill selection. Rewrote ~9 derive.test.ts tests built on the old
  model; added the two NAMED regression tests (Concord/Fairfield/Vacaville and
  Davis/Sacramento). Rewrote the #295 day-corridor test (its whole-route-vs-
  per-day contrast relied on the now-removed suppression) to test per-day
  geometric scoping directly.
- **Verified on real geometry** (TEST `trips` table was reset mid-task by a
  parallel workspace, so I routed the same endpoints rather than reading the
  now-deleted rows): Concord/Fairfield/Vacaville IN, Woodland (9.63mi) + SF
  (11.56mi) OUT; Davis IN, **Sacramento OUT at its real 3.09mi offset**; a rural
  US-395 day yields ZERO corridor cities (valid). 119 corridor + 182 itinerary
  tests pass; gate exits 0 on both workspaces.
- **Woodland drop** documented as a real, accepted tradeoff (previously-validated
  legit city, +9mi detour) — NOT recast as "off the road."
- **Top flag:** density cascade — 21–29 corridor cities/day on dense suburban
  routes, which multiplies backfill anchors (#295 shares the derivation). Filed
  in BACKLOG + the ADR as the key product/density follow-up. Did NOT generate a
  trip end-to-end (Adam will).
- **Preceded by a chain of read-only investigations this session, folded into
  #296 rather than shipped as separate PRs:** the SF false-positive, the
  Concord/Fairfield/Vacaville false-negative, and the Sacramento/Davis
  generalization. The redesign's "fixes both symptoms" framing and the two named
  regression tests (`derive.test.ts`) are the committed record of these; the
  ADR's "subsumes the SF water-detection idea" line records that a water-aware
  approach was considered and dropped in favour of the 3mi gate. (I did NOT
  re-state the specific live detour/offset measurements from those
  investigations here — they were reproducible probes, not committed to any
  repo file, so per the verifiable-only rule they stay out of the diary.)
- **Note:** the TEST `trips` table was reset to 0 rows by a parallel workspace
  mid-session (also recorded in the #296 STATE masthead), so verification
  re-routed the same endpoints — pure geometry + bundled gazetteer, equivalent
  to reading the now-deleted rows.

## 2026-08-26 (fix) — audit/bake corridor-anchor granularity mismatch

- **Investigation → fix.** After the per-city cap fix (#294) merged, a fresh
  trip `b2078e6d` (San Diego → Fort Bragg, all 6 categories) still showed two
  mid-corridor cities with zero backfill: Oceanside and Arvin.
- **Root cause:** the audit drew backfill anchors from `facts.corridorCities`,
  derived by `deriveCorridorCities` over the WHOLE route (coarse —
  `maxNodes`/`minSpacingMi` thin a long route hard). The itinerary RENDERS a
  finer per-day spine that `bake.ts` derives per-day over each day's shorter
  segment. Cities on the day spine but dropped from the route spine (Oceanside
  ~38mi from SD; Arvin ~16mi from Bakersfield) were visible nodes the backfill
  never considered — `pickBackfillStops` never called for them. Not the cap, not
  a pool gap (Oceanside's real pick is "Top Gun House"). Confirmed by re-running
  `preComputeFacts`: `facts.corridorCities` had 9 cities, neither of them.
- **Fix (Adam's chosen direction — align the audit's derivation with bake's, not
  feed bake's output in):** new shared helper `deriveDayCorridor` /
  `dayCorridorAnchors` in `web/src/lib/corridor/day-corridor.ts`. Both `bake.ts`
  and `audit.ts` now call it — the SAME `deriveCorridorCities` over the same day
  segment, so the two spines can't drift apart again. Used in BOTH audit backfill
  blocks (interest-guarantee AND fuel — the fuel block had the same coarse
  derivation; flagged, fixed for consistency).
- **Endpoint rule preserved** (Arvin's second disqualifier). Verified on real
  day-1 data: the per-day spine now yields San Diego(start), Oceanside, LA,
  Arvin, Bakersfield(end); backfill anchors = San Diego, **Oceanside**, LA;
  **Arvin present in the raw spine but excluded because it's 15.7mi from the
  Bakersfield endpoint (< 25mi)** — excluded for the right reason, not absence.
  Oceanside now gets a pick.
- **Tests:** new `day-corridor.test.ts` (3, synthetic-gazetteer, equator harness)
  — a city dropped from the whole-route spine is still a per-day anchor; the
  Arvin-class endpoint exclusion still fires; empty/short polyline → start only.
  119 corridor + 182 itinerary tests pass; gate exits 0 on both workspaces.
- **Accepted tradeoff flagged (ADR + BACKLOG):** finer spine ⇒ more anchors/day
  × 2 picks each ⇒ denser trips. Levers noted if density becomes a problem.
- Did NOT regenerate a trip end-to-end — Adam will.

## 2026-08-25 (fix) — guarantee cap was per-DAY, should be per-CITY (scope bug)

- **Investigation → fix in one arc.** Traced why 4 of 8 anchors on trip
  `ab146c1d` (San Diego → Reno, `guaranteedCategories = [camping, scenic, food,
  oddity]`) got no guarantee pick. Root cause: `MAX_BACKFILLS_PER_DAY` capped
  `pickBackfillStops` phase 1 at 2 picks **per day, total**. The loop is
  anchor-major and broke on the shared cap, so the day-START anchor (San Diego)
  consumed both slots (scenic + camping) and Oceanside / Riverside / Silver
  Lakes were never reached — despite real candidates at each (confirmed via the
  real `pickGuaranteedStop`: Top Gun House, Trujillo Adobe, El Mirage OHV).
- **This was NOT the category-monopoly tradeoff PR #292's ADR flagged.** It was
  a scope bug: D-B is specified as per-CITY density, the cap was implemented at
  day scope. Correctness bug, not tuning.
- **Fix:** renamed `MAX_BACKFILLS_PER_DAY` → `MAX_BACKFILLS_PER_CITY` and
  rescoped both phases — each anchor tracks its own `cityPicks` budget; removed
  the day-level `picks.length >= max` breaks from phase 1 AND phase 2 (the
  opener break starved later anchors too). Cross-anchor dedupe (`taken`) kept.
- **Verified on real data** (read-only, preComputeFacts + real pickBackfillStops
  on the actual pool): day-1 now yields 8 guarantee picks across 4 cities (2
  each) — San Diego, **Oceanside, Riverside, Silver Lakes** all covered, vs 2
  total (San Diego only) pre-fix. Caveat: ran with `onCorridor` open + all
  categories missing to isolate per-city distribution; the real audit also
  subtracts LLM-covered categories, so exact picks vary — the structural result
  (each city its own budget) is the point.
- **Tests:** 39 anchor-backfill (2 new locking per-city scope: "each city gets
  its OWN budget of 2 — an early anchor does not starve a later one" + a
  single-city per-city-cap test) + 182 itinerary all pass. Rewrote the two
  day-scope tests that encoded the bug. Gate exits 0 on both workspaces.
- **Flagged consequences** (ADR + BACKLOG): category-monopoly still applies
  WITHIN a city's 2 slots; and removing the per-day ceiling means a multi-city
  day can now surface more machine picks than before (the old "list of towns"
  concern is now bounded per-city, a deliberate consequence of the spec).
- **Did NOT** regenerate a trip end-to-end (Adam will, manually).

## 2026-08-25 (build) — interest-category chip UI (blocker F resolved)

- **Task: build the wizard chip UI for the interest-category guarantee** that
  #292 wired end-to-end but left dark (only the fuel checkbox existed).
- **Flagged ambiguity RESOLVED before building.** The task asked whether
  "overnight" in #292's exclusion meant `camping`+`hotel` combined, and whether
  `camping`/`hotel` should get chips. Finding: `guaranteedCategories` is typed
  `SlideCategoryKey[]`, and in that taxonomy **`overnight` IS the display
  category `hotel`** — isomorphic via `palette.ts` (`overnight ↔ hotel`, the
  data-fetch vs display split). So "overnight" is NOT camping+hotel; it is
  exactly hotel. The backend gate `GUARANTEE_CATEGORIES` (anchor-backfill.ts)
  acts on **6** categories: `scenic, food, oddity, attraction, camping, urban`.
  **`camping` DOES act** (the task's worry was unfounded); only `hotel`
  (=`overnight`, blocker B.2) and `interest` (junk drawer) are backend no-ops.
- **Decision: render 6 chips, not the task's 8.** Showing `hotel`/`interest`
  chips would silently no-op — the same "misleading row" the fuel PR avoided,
  and consistent with every doc's "6 pool-side categories" framing. Deviation
  from the task's "8 categories" flagged in the PR, BACKLOG, and the ADR.
- **Built:** `web/src/lib/plan/guarantee-categories.ts`
  (`GUARANTEE_CHIP_CATEGORIES`, 6 entries) + `guarantee-categories.test.ts`
  (3 tests, TDD-first — drift-locks the chip set to the backend
  `GUARANTEE_CATEGORIES` gate). Wizard "Interest categories" section now renders
  a `SelectableChip` row (per-category `--cat-{key}-title` accent, multi-select)
  above the existing fuel checkbox. `fuel` stays a checkbox (distinct
  live-resolve semantics + cost caption). Layout fit 6 chips on one row cleanly —
  no redesign.
- **Live-verified on TEST via headless-Chrome CDP** (dev server 3210, minted
  seed-owner session): all 6 chips render with labels (Scenic/Food/Camping/
  Attraction/Oddity/Towns), all `onScreen` + **reachable** (`elementFromPoint` at
  each chip center lands inside it, not occluded — the reachability lesson).
  Real pixel-clicks toggled `guaranteedCategories`: scenic+camping → both
  checked, others false (multi-select); toggling scenic off left camping checked
  (independent). Screenshot captured. Gates: web typecheck + `next build` +
  data typecheck all exit 0; 14 plan tests (incl. 3 new) + 37 anchor-backfill
  pass.

## 2026-08-25 (build) — interest-category guarantee at D-B (per-city)

- **Task: convert the D-decision brief to an ADR, then build spec §11 steps
  5–7 at granularity D-B (per-city), against the EXISTING pool source — NOT
  `resolvePlaces()`.** Adam had already made the D pick (per-city over the
  brief's D-A recommendation) for density around the actual corridor cities a
  traveller passes.
- **Recon first paid off.** The spec files aren't in the working tree: the
  `-D.md` brief lives only in historical commits (deleted from all branch
  HEADs), the full `interest-category-chips.md` (with §11) only on branch
  `scope-interest-category-chips`. `feat/guarantee-selector` existed but was
  **empty** (no diff vs main) — so no prior code scaffolding; built from
  scratch. `guaranteedCategories` plumbing (wizard→`GenerationInput`) already
  landed in #288 for the fuel path, so steps 2–3 were done.
- **`urban` gate resolved by the selector's OWN gate**, not by widening the
  opener's `OPENER_CATEGORIES`. The opener excludes `urban` (a town under its
  own node is a tautology for an unrequested pick); an explicit user guarantee
  is not that, so `pickGuaranteedStop` gets a wider `GUARANTEE_CATEGORIES` (the
  5 openers + `urban`). Widening the opener gate would have regressed the
  opener path. This is also the path spec §9-B implicitly picked.
- **Two-phase `pickBackfillStops` kept backward-compatible.** Phase 1
  (guarantee, Option A) runs first, phase 2 is the existing opener loop. Moved
  the opener's bare-anchor filter from the audit caller INTO the function
  (via a new `keptCoords` param defaulting to `[]`), so all 25 pre-existing
  unit tests pass unchanged and the guarantee phase can see anchors the opener
  would have skipped (an anchor with a kept food stop isn't bare but can still
  miss a guaranteed `scenic`).
- **Flagged, not silently built around:** `fuel`/`overnight` stay OUT of the
  guarantee gate per spec §11 step 6 (B.1/B.2 unresolved — fuel is path A +
  inert here, overnight duplicates the dedicated slot); rank order is the
  spec's recommended default; cross-category cap saturation is real (a
  `[scenic, food]` guarantee gave 2 scenic / 0 food live — the 2-slot cap +
  per-city + selection order); coverage attribution is pool-hit-first
  (`restaurant`→`food` the only live-resolve overlap).
- **Live TEST verify, read-only, no LLM.** Wrote
  `verify-guarantee-percity.ts` driving real `preComputeFacts` +
  `auditItinerary` (Mapbox token borrowed per the RUNBOOK, TEST Supabase
  untouched, no writes → no cleanup). San Diego→SF and Sacramento→Reno both
  showed two `guaranteed` scenic picks at two distinct corridor cities
  (per-city density), control run = openers only. The TEST corpus is
  scenic-heavy (one corridor had 2 `food` rows, another 0) — a `food` guarantee
  is data-limited there, a corpus-coverage fact, not a defect.
- **Deferred item logged first (task Step 0):** the
  `preComputeFacts`→`resolvePlaces()` corpus-fetch duplication (two wrappers,
  same RPC, different args), blocked on polyline scope + suppression-filter
  parity. In BACKLOG (the more detailed entry #291 filed the same day stands;
  my duplicate was dropped in the rebase).
- ADR: `docs/decisions/2026-08-25-interest-category-guarantee-granularity.md`.
  Gate green on both workspaces; 180 itinerary tests pass. Branch
  `feat/guarantee-selector`, PR #292.
- **Supersedes #291's "not committed, not written this session" note** below:
  that wrap paused the build before code; this session completed it.

## 2026-08-25 (wrap) — interest-category-chips arc: D-brief filed, migration finding logged; no code shipped this session

- **What landed this session** = one working file staged into main + one
  BACKLOG entry. No code changes. Fresh branch `feat/guarantee-selector`
  was cut off `origin/main` for the guarantee-selector build (spec §11
  steps 5/6/7), then paused before any code was written.
- **`docs/specs/interest-category-chips-D.md`** — new. A three-option
  analysis (D-A per-day / D-B per-city / D-C trip-wide) of the
  granularity decision blocking spec §11 steps 5/6/7. Written as a
  review-first brief, not an ADR — its own header carries `Status:
  AWAITING PICK. Not committed to any branch.` Recommendation in §6 is
  D-A (per-day) with confidence flagged as medium-high on the reasoning,
  low on the calibration (no measurement of how often trips already
  cover user-selected categories via LLM output).
- **BACKLOG addition: `preComputeFacts` → `resolvePlaces()` migration.**
  Investigation this session confirmed the trip-generation pool-fetch
  (`fetchCorpusForSegment`/`fetchCorpusForPolyline` in
  `web/src/lib/trips/bake-corridors.ts`) runs a parallel corpus-fetch
  path to `resolvePlaces()`'s corpus half (`fetchFederatedPois`) — both
  hitting the same `pois_along_corridor` RPC with different args and
  downstream composition. Migration blocked on (i) `resolvePlaces()`
  day-corridor scope taking only `{start, end}` 2-point coords, not the
  arbitrary-polyline route-following geometry `preComputeFacts` uses to
  catch POIs that curve >16km off the chord (Cassiar case, per
  `facts.ts:213-218` comment); (ii) suppression-filter parity unverified
  between the two paths.
- **Small correction to spec §11's phrasing, discovered while re-reading
  the loop for the D-brief:** §11 step 5 says "the loop shape differs
  meaningfully per option" (per D-A / D-B / D-C). Actually reading
  `pickBackfillStops` at `anchor-backfill.ts:241-267`, all three options
  keep the per-day iteration — what differs is where the missing-set
  lives (day-scoped vs anchor-scoped vs trip-scoped). §11's conclusion
  still stands (the Set shape diverges enough that prototyping one
  wouldn't cleanly transfer), but the phrasing overstates the code diff.
  Noted in the D-brief's appendix.
- **Not committed, not written this session** — the guarantee-selector
  ADR, the `pickGuaranteedStop` implementation, the audit-loop changes
  for spec §11 steps 5/6/7. All named in a task that was interrupted
  before any code was written.
- **Dropped from this wrap** — three investigation reports (fuel-note
  gap near Truckee; six non-fuel categories chip→generation wiring;
  `pickAnchorStop` data source vs `resolvePlaces()`). Session-
  conversation only, no repo artifact backs them beyond the BACKLOG
  entry above and the D-brief. Findings are recoverable from the code
  they cite if needed.

## 2026-08-25 (build) — TEST-only sign-in bypass to unblock dev workflows

- **Started with investigation-first per Adam's Step 1.** STATE.md had
  been carrying an open thread for weeks: "uncommitted dev-only
  email+password sign-in ... sitting in the working tree, no PR opened."
  I expected to find it on some branch (I'd seen `dev-password-signin`
  in the branch list earlier) and either land it or refine it. Reality:
  that branch is stale (tip `dce1a72` = #271, before all recent work),
  and the auth files STATE.md described (`web/src/lib/auth/dev-signin.ts`
  + two `app/auth` extras) don't exist on it or in the current working
  tree. The uncommitted work is on another Conductor workspace's disk
  or was discarded. Built fresh.
- **The gate isn't middleware — it's per-page.** `web/src/proxy.ts`
  (Next 16 renamed middleware → proxy) doesn't force sign-in; it just
  refreshes cookies and sends onboarding-incomplete users to `/welcome`.
  Sign-in is enforced individually by pages that need it
  (`/welcome`, `/plan/expedition`), all redirecting to
  `/auth/sign-in?next=…`. That means the bypass didn't need any
  middleware changes — just adding a second sign-in method on the
  sign-in page.
- **Picked (b) — additive button, not auto-sign-in.** Adam offered
  (a) auto-sign-in on TEST or (b) additive button. Went with (b):
  explicit click is less surprising, keeps signout+resignin testable,
  and doesn't put a hidden auth mechanism behind an env check. Additive
  keeps the Google path byte-for-byte untouched (Adam's explicit
  constraint).
- **Structural fail-closed gates, no runtime flag.** Adam's language
  was precise: "not just 'off by default' but something that fails
  closed if the environment check is wrong or missing." Two structural
  gates: (a) `NEXT_PUBLIC_SUPABASE_URL` exactly matches the TEST
  project URL (rejects wrong scheme, prefix/suffix/subdomain attacks,
  PROD ref, undefined, empty); (b) `NODE_ENV` is `"development"` or
  `"test"` (rejects `"production"`, undefined, empty, anything else).
  Both must be true, at both render time AND server-action submit time.
  Considered adding a third env-flag gate — decided against because it
  would make the button opt-in on every dev workspace (defeating "no
  10-minute detours") without meaningfully increasing safety beyond
  what URL+NODE_ENV already give.
- **Third gate is data-shaped, not code:** the fixture user
  `seed-owner@overlander.test` doesn't exist on PROD Supabase. Even if
  both structural gates were somehow bypassed, GoTrue would reject the
  credential. Belt + suspenders + backup.
- **TDD first.** 16 unit tests written before the env helper existed,
  enumerating every URL-attack shape and every `NODE_ENV` failure mode
  I could think of (undefined, empty, `"staging"`, `"prod"`, `"dev"`
  — the last is a common typo, must be `"development"`). All pass.
- **PROD-safety live-verified, not just unit-tested.** Beyond the
  unit tests, restarted `next dev` on a fresh port with
  `NEXT_PUBLIC_SUPABASE_URL` overridden to the PROD ref (TEST anon key
  kept, so no PROD data access happened). `/auth/sign-in` HTML
  contained ONLY "Continue with Google" — the bypass button and its
  TEST-only caption were absent. This is the "verify explicitly, don't
  just assume the environment check works" check Adam asked for.
- **Live TEST verification of the happy path:** `POST /auth/v1/token`
  against TEST with the fixture creds returned an `access_token` for
  user `a2f74eb2…` — the same user `mint-dev-session.ts` produces via
  the same `signInWithPassword` call.
- **Duplicated the fixture password on purpose.** Now referenced from
  two places: `seed-test-user.ts:15` (source of truth) and
  `auth/actions.ts` (the bypass). The seed script is a dev tool and
  the app shouldn't import from `scripts/`; comment in both files
  names the pair so they change together if the password ever moves.

## 2026-08-25 (build) — Mapbox Search Box replaces Google for fuel on the browse surfaces

- **Framing: compliance-driven scope, not a general Google → Mapbox rewrite.**
  Google Places on a non-Google map requires the Places UI Kit as a
  compliant display path; Mapbox Search Box on a Mapbox map doesn't. Fuel is
  moved to Mapbox on the web-client browse surfaces (`/api/trip-browse`,
  `/api/search-area`) for that reason. Other 8 slide categories untouched.
- **The pre-work sniff test paid off.** Grepped every existing source for
  `"fuel"` / `gas_station` / `truck_stop`: only Google's
  `TYPES_BY_CATEGORY.fuel = ["gas_station"]` matched (`[grep 2026-08-25]`).
  Foursquare, rec-gov, USFS, BLM don't handle fuel. So emptying Google's
  fuel entry cleanly removes fuel from Google's fanout — no other source is
  a shadow provider.
- **Sidestepped a flag-scope trap.** `TRIP_BROWSE_USE_RESOLVER` /
  `SEARCH_AREA_USE_RESOLVER` are per-surface, not per-category. Flipping
  them ON would move 8 other categories to the resolver path as a side
  effect. Inventing per-category routing was explicitly forbidden in Step 3.
  Answer: add `mapboxSearchBoxSource` to BOTH legacy `LIVE_SOURCES` AND
  `DEFAULT_*_LIVE_SOURCES`, so fuel-via-Mapbox is identical on both paths
  and the flag state doesn't matter for fuel. No per-category mechanism
  invented.
- **D7 resolution — kept `BrowsePlace.source` binary.** Adam's task
  suggested "mapbox-live" as a possible new value on `BrowsePlace.source`.
  I kept `BrowsePlace.source` at `"live" | "master_place"` (its existing
  binary) and added `"mapbox"` to `SourceId` on `SourceResult.sourceId`
  only. Rationale: `BrowsePlace.source` drives hydration eligibility and
  cache-key behavior (coarse binary is load-bearing); per-source
  attribution belongs on `sourceId`, where `SOURCE_LABEL` already reads it
  for the "Sourced from Mapbox" tile mention. Documented in the SourceId
  union comment so a future reader doesn't re-derive.
- **NO npm dep added.** Considered `@mapbox/search-js-core`; rejected
  because its abstractions (session tokens, suggest+retrieve two-step
  flow, autocomplete) target a different flow than the category endpoint
  I'm calling. Hand-rolled fetch is ~40 lines and clears
  `web/CLAUDE.md`'s ask-before-dep bar without proportional benefit.
  Flagged in the decision doc as the chosen tradeoff.
- **Two residual Google-fuel paths flagged, not touched.** Free-text
  search still assigns `"fuel"` to gas_station-typed results via
  `categoryForGoogleTypes` — different UX (user typed a query). Corpus
  ingester still writes Google `gas_station` to `master_place` — warehousing
  is a separate compliance category. Both scoped separately.
- **Path A (PR #288, `04e9855` fuel-live-resolve) still on Google.**
  Explicit out-of-scope per Adam. Migration needs either a new
  `resolvePlaces()` scope or a Mapbox resolver + tile-id-scheme rename.
  Tracked in BACKLOG + STATE.md open-thread note.
- **Handler-test regression caught + fixed.** Existing
  `search-area/handler.test.ts:159` asserted 5 sources in the fanout;
  now 6 (Mapbox added). One-line assertion update. No other test needed
  a change — the handler tests DI at the `discover` seam and don't
  introspect source-list contents beyond count.
- **Local gate exit 0 on both workspaces.** 66 tests pass across
  mapbox-search-box, resolve-places, and both handler test files. First
  live invocation waits on someone hitting the browse surfaces with
  `NEXT_PUBLIC_MAPBOX_TOKEN` set — not done this session.

## 2026-08-25 (build) — fuel-live-resolve: first BUILD out of the Interest-Category-Chips arc

- **The scoping doc (PR #287) had already found this gap; Adam's decision
  was to skip the corpus entirely for fuel.** §5.2 B.1 in the spec:
  backfill is `facts.poolPOIs`-only (`anchor-backfill.ts:11-13` explicit),
  never reaches Google. Fuel-POI corpus coverage is thin where it matters
  (far-north / off-corridor); the fuel-POI layer per
  `expedition-planner.md §8.5` hasn't shipped. Adam's call: always call
  Google live for fuel, no fallback. Standalone step, not a modification
  to `pickAnchorStop`.
- **Tests-first, per TDD skill.** Wrote 9 tests for `pickFuelAtAnchor`
  before the module existed — RED confirmed, then implemented, GREEN. All
  9 pass in ~150ms. Covers pool-hit dedupe (no Google call), all four
  `PlaceResolver` failure modes (not-found / capped / no-key / off-corridor),
  happy-path shape, bias-coord wiring, `fuelType` passthrough, and the
  `ANCHOR_NEAR_MI` dedupe threshold.
- **Extended `PlaceResolver` with `resolveNearby(includedType, biasCoords)`.**
  Mirrors `resolve()`'s auth / cap / cache / abort posture. Distinct cache
  key namespace (`nearby:<type>:<lng>:<lat>`), so no collision with the
  existing text-search cache. Shared per-generation cap + `liveCalls`
  counter — a fuel guarantee competes for the same budget as LLM keystop
  live-resolves. The impl (real fetch to Google `places:searchNearby`) is
  NOT test-driven because there's no local mock harness for `fetch` in this
  codebase; the DI-seam tests cover the module contract, and the real fetch
  follows `resolve()`'s pattern byte-for-byte.
- **Adam's assumption that fuel type is "already known from the vehicle
  profile" turned out FALSE `[grep 2026-08-25]`** — no `fuelType` field on
  either `RigProfile` (`facts.ts:68-77` or `web/src/lib/vehicles/types.ts:23-35`);
  both carry `fuelRangeMi: number` only. Wizard has no fuel-type input.
  Shipped with `FUEL_LIVE_INCLUDED_TYPE = "gas_station"` hardcoded at the
  audit callsite; EV rigs get gas picks today. `pickFuelAtAnchor` itself
  takes `fuelType` as a parameter — the fix is a rig-field addition, not
  a module change. Flagged in the decision doc.
- **Feature flag posture flipped from the sibling backfill.**
  `KEYSTOP_ANCHOR_BACKFILL` is ON by default (in-memory, no external cost).
  `FUEL_LIVE_RESOLVE` is OFF by default because it issues Google
  `searchNearby` per anchor — new external cost source. Adam asked me to
  flag whether a flag was needed at all; answer yes and default OFF. Both
  flagged in the decision doc.
- **Chose a single fuel checkbox in the wizard over an 8-chip row.** The
  §11 spec sketches an 8-chip row for the guarantee section; that row is
  F+D-blocked (F: chip UI shape; D: audit-loop granularity for the other
  6 categories). Shipping 1-of-8-working chips would set false
  expectations. A single purpose-built checkbox with explicit copy ("Calls
  Google Places live for a gas station near each day-start and mid-corridor
  city that doesn't already have one in range") is honest about the
  mechanism and replaces in place when D+F resolve.
- **Audit-hook integration coverage is thin.** The pure module has 9 unit
  tests; the audit wiring (~50 lines) is verified only by typecheck +
  `next build`. `auditItinerary` constructs its `PlaceResolver` internally
  (`audit.ts:352`) — an integration test needs either a DI-seam refactor
  or an env-var setup. Considered extracting a `collectFuelPicksForDay`
  helper but landed on ship-as-is + feature-flag-OFF containment for now;
  flagged in the decision doc as a follow-up.
- **Cost bound is analytical, not measured.** Cap is
  `Math.max(80, days × 8)` per `audit.ts:352` — shared between fuel picks
  and LLM keystop resolves. Analytical worst case for a 10-day trip fits
  under 80 comfortably (~40 fuel + ~15 keystop). Realistic dedupe rate not
  measured; no live TEST run this session (no Google key in this
  workspace). First real invocation lands when Adam flips
  `FUEL_LIVE_RESOLVE=true` in a dev env.
- **Sibling PR to #287, not a stack.** Branched off `origin/main` for
  independence — the scoping doc iterates on its own branch, this build
  ships on its own. Two-way merge conflict on STATE.md / LOG.md /
  BACKLOG.md is expected but small.

## 2026-08-24 — notes-to-spine, then the overnight-marking chain (#278–#285)

- **The notes-to-spine ask was two problems, not one (#278, merged).** Places
  named in a day's Overnight/Logistics/Fuel/Reserve notes render only as prose.
  Traced it: only the OVERNIGHT is structured + grounded — and already on the
  spine as a tile/node on **96 of 104** overnight-bearing days in a TEST sample
  `[computed]`; Logistics/Fuel/Reserve are free-text with no place slot, and most
  places they name are ALREADY spine nodes, so naive extraction mostly
  duplicates. Overnight slice = cheap labeling; service stops parked.
- **Shipped the overnight→spine-tile link (#279, merged).** Audit records the
  overnight's canonical tile id (identity, not substring); bake marks that tile
  `isOvernight`+`curated`; the Camping block derives from it; the redundant
  "Overnight —" prose line drops. Desc-only/off-corridor → prose fallback.
- **A "tile missing" report was NOT a bug — deploy lag (#280, #281).** Every
  generated TEST trip lacked `isOvernight` because they predate #279's deploy; an
  integration test proved the wiring, and a live gen (#281, approved spend)
  confirmed it end-to-end (San Elijo/San Onofre marked). The badge is a subtle
  "Overnight ·" status prefix — flagged as a UX call, not decided.
- **"New Shady Rest missing" = timing again (#282) — but it surfaced a REAL
  gap.** A pool-hit overnight is grounded to a trip-wide pool id, but bake only
  marks tiles in the PER-DAY corpus fold; when the fold misses the campground, no
  tile carries the ref → unmarked even on #279 code.
- **Reproduced the gap live (#283, approved spend):** Bishop→Mammoth(dwell)→
  Tahoe, all 5 overnights pool-hits, **2 marked / 3 not** `[computed]`, incl. the
  predicted LAYOVER trigger. Root cause broadened: the overnight ref (`mp:`) and
  the tile that represents the place (fold `mp:`, or a live-resolve `google:`
  endpoint) can differ or be absent — independent paths, different id schemes.
- **id-reconciliation built but INERT (#284, merged).** `markOvernightTile` falls
  back to the pool row's `google_place_id` to bridge `mp:`↔`google:`. But that id
  is RPC-join-sourced from a linked Google source_record, and **0 of 351** rows
  on the #283 TEST corridor carry one (backcountry has no Google link)
  `[computed]` — correct, but changes nothing on today's data. Flagged, not
  smoothed over.
- **Fuzzy name+proximity tier (#285, OPEN).** Adam's call: fuzzy match over a
  Google backfill, to avoid a Google-coverage dependency on off-grid places.
  Third tier after exact id + google_place_id: strict name subset (≥2 tokens) AND
  ≤0.5 mi, closest wins, no-match→prose. Confirmed on real corpus+Google coords
  (no LLM): Hope Valley now marks (**0.067 mi** apart) `[computed]`. Convict Lake
  (layover) still can't — no tile exists at all; that last slice needs tile
  synthesis, still parked.
- **Learned:** the corpus deliberately lacks Google ids for backcountry — that is
  WHY the id bridge is inert and fuzzy was needed. The overnight is usually the
  day's endpoint, so its tile is duplicated in the payload but the render dedups
  by id. And pool-grounding's own name match is EXACT-only (fuzzy was removed
  there earlier for mis-binding "Cedar City"→"Cedar City Field Office"), so #285's
  fuzzy is scoped narrowly to overnight-only + name AND distance to avoid that
  class. Two flagged product calls remain open: the badge prominence, and #285's
  chosen thresholds.

## 2026-08-25 (later) — extending the backfill to corridor cities, and the three ways it embarrassed itself first

- **Reused rather than rebuilt.** `pickBackfillStops` is a loop over #275's
  `pickAnchorStop`, adding only ordering, a cap and dedupe — so the gates and
  the null-rather-than-pad contract could not drift between the two cases.
- **Capped machine picks at two per day, and said why.** Covering every bare
  corridor city was the obvious move and the wrong one: the model supplies 2–4
  real key stops, so unbounded backfill turns "key stops" into a list of towns.
  When the cap bites it keeps the earliest anchors — an empty morning is felt
  more than an empty afternoon.
- **Three defects only live runs would have found.** A corpus row literally
  named "Carson City, Nevada" got featured as the stop for Carson City — the
  `urban` exclusion misses it because the row is `park_feature`. The same
  wilderness got featured on two consecutive days, because dedupe was per-day.
  And Carson City got attributed to a Mammoth→Mammoth dwell day, because
  mid-corridor selection reused `onCorridor`, which on a dwell day is a wide
  straight-line radius rather than a route test. All three are now gated,
  trip-wide-deduped, and polyline-based respectively.
- **The target gap is closed:** Oceanside went from `(EMPTY)` to Top Gun House
  in every post-change run, Riverside to Trujillo Adobe. Silver Lakes and Carson
  City stayed bare — correctly, nothing qualified.
- **The honest ceiling is the corpus, not the logic.** Top Gun House has no
  photo and no description, so its card renders blank. Richness is a preference,
  not a gate, precisely so a bare node isn't preferred to a real-but-thin place.
- Stacked on #275, which is still unmerged — noted in the PR rather than
  silently rebasing.
- Decision doc: `docs/decisions/2026-08-25-corridor-city-keystop-backfill.md`.

## 2026-08-25 — the prompt nudge wasn't enough, so the backfill became a mechanism — and its first picks were junk

- **#274 shipped a preference; this shipped the mechanism.** Start-of-day stayed
  empty after the prompt change, so the audit now backfills one opener from the
  corpus pool when the model kept nothing near a day's start. Deterministic, no
  re-ask, no network call — chosen over a re-ask loop (latency + spend + it
  invites the padding we're trying to avoid) and over a live Google lookup
  (crosses the deliberate `resolve.ts` / `discovery/google-places.ts` split).
- **The bar is the feature, and it is all hard gates.** Category, proximity, the
  caller's own corridor guard, no duplicates — and `null` when nothing clears
  it. Twelve of the seventeen tests are about what it must REFUSE, because the
  failure that matters is a padded stop, not a missing one.
- **Its first live picks were embarrassing, and that was the useful part.**
  Three of four were `atlas_oddities` rows — "Mick Jagger's Urinal", "Space
  Whale", "Kesey Square" — with no photo, no description, no rating: cards that
  render blank. Proximity-only ranking systematically surfaces the THINNEST rows
  in the corpus, and rating can't counter it because `master_place.rating` is
  NULL corpus-wide. Fixed by teaching `PoolPOI` whether a row will actually
  render and ranking on it — as a preference, not a gate, or the fix would empty
  the starts the feature exists to fill.
- **The originally-reported case now passes for the boring reason.** The Bishop
  run logged zero backfills — the model covered Bishop itself that time. Correct
  non-firing. A single run still can't be read as evidence either way; run-to-run
  variance on the same route remains large.
- **A limit I could not close:** one backfilled pick didn't show under its day's
  first spine node. It may have bucketed under a neighbour — not verified. Same
  shape as the Victorville pool-hit from 2026-08-24, so pre-existing rather than
  introduced. Parked in BACKLOG rather than guessed at.
- Decision doc: `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md`.

## 2026-08-24 — key stops cluster at the end of a day; the fix was one prompt paragraph, and it half-worked

- **Chased a clustering complaint to the wrong root cause first, and the
  correction is the useful part.** A generated day put every curated stop in its
  back half, leaving San Diego / Oceanside / Riverside / Silver Lakes as bare
  "Explore N more" nodes. The natural hypothesis — the model can't spread across
  cities it never sees — is **false**. `buildFactsMessage` has always sent
  `corridorCities` with `milesFromStart`, built by `deriveCorridorCities` inside
  `preComputeFacts`. Checking that *before* designing a fix turned a plumbing
  change into a prompt edit.
- **Ruled out a silent-drop bug first, with temporary instrumentation.** Two
  generations logged the raw LLM `keyStops` per day plus every grounding
  outcome: **zero dropped** in both, every stop accounted for as pool-hit or
  live-resolve. So "no curated stop at this city" is the LLM not naming one, not
  the corridor guard eating it. Instrumentation was added and fully reverted
  twice; it is not in the tree.
- **Which cities get a card varies run to run on the SAME route.** One run put a
  curated card on San Diego (Lucha Libre Taco Shop, ~2 mi); another put nothing
  before Ridgecrest. Worth remembering before reading a single generation as
  evidence of anything structural.
- **The change is a preference, not a mechanism.** `SYSTEM_PROMPT` now asks for
  a progression across the day's corridor cities and names the start-of-day gap;
  `buildFactsMessage` repeats it next to the list. Both say explicitly: do not
  pad, skipping a city is fine, coverage is only a tie-breaker. Nothing
  downstream counts cities.
- **Measured honestly: partially effective, and the headline gap is unfixed.**
  Three post-change runs on the same route all covered **Riverside** and the end
  city — an improvement. All three still left **San Diego and Oceanside empty**,
  which is precisely what the new text calls out, and one *pre*-change run had
  covered San Diego. Confound stated rather than smoothed: day-1 shape shifted
  (post-change runs all ran San Diego → Bishop), so it is not a clean A/B, and
  the sample is small.
- **A side finding that unblocked all of this:** Google is not an enabled
  provider on TEST (`/auth/v1/settings` → email only), so the single "Continue
  with Google" button cannot complete there — the standing "no dev sign-in path"
  gap is real. A dev-only password sign-in was built to work around it and is
  **uncommitted**, deliberately out of this PR.
- Decision doc: `docs/decisions/2026-08-24-keystop-corridor-spread.md`.

## 2026-08-23 — all four place-data surface cutovers landed (flag-gated, off), + the enrichByGoogleId capability

- **Completed the read-surface half of the resolver-consolidation ADR: all four
  originally-planned surfaces are cut over or resolved-as-not-needed.** Each was
  plan-doc-first then a thin route wrapper behind an env flag, default OFF, client
  untouched. `origin/main` tip is now `b227e65`. Search #260 (`d62f660`), Date
  Detail #266 (`a086cb8`), Day Column #267 (`4757067`, no cutover), Day-scoped
  browse #269 (`b227e65`). Plans: #258/#261/#262/#264/#265/#267/#268.
- **Search's blocker was the tier bug; Date Detail's was a different, deeper gap —
  worth not conflating.** Search: the Verified/Unverified tier was dead on the
  bbox/hydrate path because `hydratePlacesByIds` never selected `description_source`,
  so `mapMasterPlaceRow` stamped every hydrated place `unverified`. Fixed by
  threading the field through hydrate (#259 `9c212a6`). Date Detail: `resolvePlaces()`
  returns `BrowsePlace[]` and, in `ids` scope, returns **nothing** for bare Google
  `place_id`s — it has no mode that yields the `place_id → PlaceRich` map the endpoint
  is. So a new capability was built, `enrichByGoogleId()` (#263 `bc2c9c2`), and
  `enrichPlaces()` refactored to consume it. Same fetch, cache-less (the route keeps
  its own 15-min cache — this is ADR option 1, NOT step 4's shared cache).
- **Day Column turned out to be no cutover at all** — verified against code, it's a
  passive `Trip.days` renderer (`placePool`) with zero live calls of its own; the only
  fetches in that component are Date Detail's. There is no endpoint to wrap. Its real
  work is a write-path/baking consolidation (`bake-corridors.ts` corpus fold, behind
  `USE_FEDERATED_CORRIDOR`), deferred to BACKLOG. The four-surface framing over-counted
  Day Column.
- **Day-scoped browse was the cleanest** — `resolvePlaces()` day-corridor scope was
  literally designed from this endpoint (byte-identical radii/sources/buffer, measured).
  The wrinkle: it already had `USE_FEDERATED_POIS`, so the new `TRIP_BROWSE_USE_RESOLVER`
  is **orthogonal** — the wrapper maps `include: { federated: USE_FEDERATED_POIS }`,
  preserving all four flag combinations. The one new behaviour, Verified-before-Unverified
  sort, only reorders when `USE_FEDERATED_POIS` is on and is never displayed
  (`LocationBrowseCard` drops the tier).
- **A naming collision worth remembering:** Date Detail / Day Column / Day-scoped browse
  cards render `verified={!!p.placeId}` — a "Google-backed" boolean — which is NOT
  `BrowsePlace.verified` (the #255/#256 tier). The tier is computed but dropped before
  the card everywhere except where `resolvePlaces()` uses it for *sorting*.
- **Verification lesson repeated from prior sessions:** unit tests prove routing (dep-seam
  spies) but can't prove the wired route end-to-end; each cutover added a live TEST script
  driving the wired path with a non-vacuous contrast (Search: live results source-stamped
  under the resolver vs untagged legacy; Date Detail: real Google enrichment + a garbage id
  omitted; Day-scoped browse: 0-federated/all-untagged vs many-federated/all-stamped). For
  the two Google-passthrough routes (Date Detail, and the trip-browse full GET) the live
  driver had to call the delegate, not the full route, because the route's client helpers
  need a request-scoped `cookies()`/Next context `tsx` can't provide — flagged in each PR.
- **ADR step 4 (shared client cache) is now ready to build** (three read surfaces cut over,
  each with its own cache) — recorded in BACKLOG. Note: there was no pre-written "build once
  a second surface needs it" trigger in the docs; the readiness is simply that the surfaces
  now exist. **Nothing from this arc is live in production — all three flags default OFF.**

## 2026-08-22 (later) — `resolvePlaces()` built as an additive service (ADR step 2), branch `feat/resolve-places-service`

- **Built `resolvePlaces()` and wired it to nothing.** One signature over three
  scopes (`ids` | `bbox` | `day-corridor`), LIVE + FEDERATED concurrently,
  merge on canonical id, `BrowsePlace[]` out. The three endpoints it will
  eventually replace show **zero diff**, and a repo-wide grep confirms **no
  importer** outside `web/src/lib/places/`. Verified, not asserted — that was
  the whole constraint of the session.
- **Re-reading the three handlers found nine divergences that a resolver
  cannot silently reconcile**, all written up in
  `docs/architecture/resolve-places-design.md` §2 rather than resolved. The
  three that actually block cutover: the two endpoints speak **different
  category vocabularies** whose translation maps are not inverses
  (`LIVE_SLIDE_FOR_PRIMARY` is a deliberate subset, `SLIDE_TO_PRIMARY_CATEGORY`
  is the full map); there are **three doors into `master_place` with different
  membership** — the corridor RPC excludes template-only descriptions and
  `needs_review` rows, the search-hydrate service-role path does not, so a
  place can be corridor-invisible and search-visible; and **`POST
  /api/places/details` does not return places** — it returns `PlaceRich`
  fragments keyed by Google place_id, for grafting onto tiles the client
  already has. Folding that in means the resolver decides when to hydrate
  instead of the caller, so enrichment shipped opt-in and off.
- **The id problem is bigger than the ADR's "add a normalization step".** Not
  three forms but **eight, in two schemes** — federated `mp:` + colon, live
  `<prefix>/` + slash. And **the live prefix is not the `SourceId`**: `gpl`≠
  `google`, `fsq`≠`foursquare`, `ridb`≠`rec-gov`, `node`≠`osm`. Four of six
  would be wrong if the map were derived instead of written out.
- **A typo in a test fixture found a real parser bug.** A stray colon in an
  `fsq/…` fixture failed, and the failure was correct: checking `:` before `/`
  reads `fsq/abc:def` as prefix `fsq/abc`, fails the `mp` test, and returns
  `opaque` — an unresolvable id with no error. External ids are opaque
  third-party tokens and nothing promises they avoid `:`. Fixed to pick the
  scheme by whichever separator comes first; kept as a regression test. Worth
  recording because the bug was invisible to every hand-written fixture — it
  took an accident.
- **Deliberately not built:** no cache (ADR step 4 puts one on the client; a
  server cache here would be a second, competing one, and the three endpoints'
  cache grains don't reconcile anyway), no env reads (`USE_FEDERATED_POIS`-style
  gating is the caller's via `include`), no trip/day lookup (`day-corridor`
  takes coordinates, not a `tripId` — a place service shouldn't couple to the
  trip repository or its RLS).
- **Two gaps that limit what "verified by tests" means here.** Web tests **do
  not run in CI** — the `test` job is `npm run -w data test` only and
  `web/package.json` has no `test` script, so the 47 tests are not enforced on
  merge (pre-existing, not introduced). And the service has **never run against
  live infrastructure** — it is verified through a dependency seam with fakes,
  because nothing imports it and standing it up would require the cutover this
  session was told not to do.
- **No DB, network, or API calls at all this session** — not TEST, not PROD,
  not the management API.

## 2026-08-22 — #247 merged; doc-currency pass

- **PR #247 (the 2026-08-21 master_place enrichment-columns work) merged to
  `main` as `4f2a6af`**, now the `origin/main` tip. The section below still
  framed it as committed-locally-not-pushed; corrected in place, not
  rewritten, per this file's convention.
- **The squash means the branch SHA `7110a6e` is NOT an ancestor of `main`.**
  Worth stating because `git merge-base --is-ancestor` answers "no" and that
  reads as unmerged. It isn't — `git diff 7110a6e 4f2a6af` is empty, so the
  trees are identical. Same squash-into-a-new-SHA pattern as #237 and #244;
  check the tree, not the ancestry, when a branch here looks unmerged.
- **Merging changed nothing about the database.** Both migrations
  (`20260821060000`, `20260821070000`) are still applied to **TEST only** and
  PROD has neither. Every follow-up that PR flagged as deliberately-not-done
  is still open, and is now tracked in `BACKLOG.md` rather than only inside
  the merged section's OPEN list: `photo_url` not wired into
  `recompute_master_place()`, the BLM/state_parks photo fields unmapped in
  their normalizers, and the export view still reading its own lateral rather
  than the new column.

## 2026-08-21 (later) — master_place enrichment columns (ADR step 1), branch `master-place-enrichment-columns` (**MERGED as `4f2a6af`, #247**)

- **Added four nullable columns to `master_place` — `rating`, `review_count`,
  `price_tier`, `photo_url` — not five.** The ADR names five fields but
  `description` has existed since the Phase 1 migration and is owned by
  `recompute_master_place()`; re-adding or writing it directly would have
  violated the schema invariant and been erased on the next recompute. Applied
  to TEST only. `price_tier` is `smallint` 1–4 to match the existing web
  convention (`priceTier?: 1 | 2 | 3 | 4`), not a text enum — nothing in the
  codebase uses a textual price representation.
- **Investigated all six ingested sources by full-scan census of every
  source_record payload rather than by reading the normalizers**, and that
  choice paid: two photo fields are sitting in `raw_payload` completely
  unmapped by their ingesters — BLM `props.PHOTO_LINK` (102 rows) and state
  parks `props.Imagelink` (138 rows, **all Washington** — see the correction
  bullet below). Same shape as the BLM `WEB_LINK` miss from 2026-08-20. The
  backfill reads them from raw_payload so the 221 photos aren't dropped;
  fixing the normalizers is a flagged follow-up.
- **rating / reviewCount / priceTier are measured zero across the entire
  corpus, not "we couldn't find a good one."** Four near-misses were examined
  and rejected by name rather than waved off: OSM `stars` (8 rows, hotel
  classification), OSM/USFS fee booleans, NPS `fees[].cost` (dollar amounts),
  RIDB fee *descriptions*. Inferring a 1–4 tier from any of them would be
  fabrication. One instructive false positive: RIDB `IsPreview` matched a
  review-count regex on the substring `review` — the census reports candidates
  for judgement instead of auto-mapping, which is why that didn't ship.
- **The columns were still added despite three of them being empty
  corpus-wide** — that is the ADR's actual point (the renderer stops branching
  on provenance). But flagged hard in the migration header: the only source
  carrying all three is Google Place Details, whose `rating`/`userRatingCount`
  are explicitly non-cacheable, so these columns are **not** a destination for
  Google data.
- **7,360 master_place rows backfilled with `photo_url`** (nps 4,690 · ridb
  2,449 · blm 88 · state_parks 133). Cross-checked against the export view's
  existing photo lateral rather than trusted: 6,430 identical, and the 23 that
  differ were *explained* not assumed — 23/23 link more than one
  photo-carrying nps/ridb source_record, and the view's lateral has no
  tie-breaker within a source, so its pick is arbitrary while the column's is
  a total order.
- **A same-day self-audit caught four claims in the above that were wrong or
  under-scoped. Corrected in the report and STATE.md; recording them here
  because the mistakes are more instructive than the fixes.**
  - **"0 view-only, the column is a strict superset as designed" — the
    measurement was right, the reason was invented.** The export view's photo
    lateral does **not** filter `is_active`; the RPC does. Nothing structural
    makes the column a superset. It held only because TEST currently has 0
    inactive nps and 0 inactive ridb rows carrying a photo — the first
    deactivation of a photo-carrying NPS/RIDB record breaks it. Classic
    green-for-the-wrong-reason: the check couldn't distinguish "superset by
    construction" from "superset by today's data".
  - **"The 907 column-only rows are excluded by the view's filters" was an
    asserted attribution, and 214 of them contradict it.** Measured split:
    693 absent from the view (filters), 214 *present in it with a NULL
    photo_url* because their photo is blm/state_parks and the lateral reads
    only nps/ridb. That 214 is the actual argument for repointing the view.
  - **The state_parks findings are Washington-only and were reported as
    "state parks".** `props.Imagelink` 138/138 WA, `props.Description` 97/97
    WA, across all 1,736 rows of a six-state source. No BLM state breakdown
    was determined, so none is claimed.
  - **The rating/reviewCount/priceTier absence rested on a regex census,
    which is a discovery instrument, not an absence proof — and it leaked.**
    `price` is not a substring of `pricing`, so OSM's `pricing`/
    `pricing:display`/`pricing:check_method`/`pricing:check_required` tags
    were never reported (1 row; checkout metadata, not a tier). Re-established
    by enumerating the full key space per source — nps 156 leaf names, ridb
    84, state_parks 119, blm 36, usfs 112, atlas_oddities 19, osm 950. **The
    conclusion survived**; two more near-misses surfaced and were rejected
    (NPS `relevanceScore` = API search relevance; USFS `development_scale` /
    `usage_level` = site classifications).
- **Found a broader gap while measuring description: `blm` and
  `atlas_oddities` have NO `field_precedence` rows for ANY field.** Because
  `resolve_field()` INNER JOINs that table, both sources contribute zero
  resolved fields to `master_place` — 138 BLM-linked and 95 state_parks-linked
  master_places carry a real source description while
  `master_place.description` is NULL. Not fixed: seeding precedence is a
  product decision, and the state-parks spec §10a excluded description on
  purpose. Reported, not reversed.
- **The LLM description pilot has already gone to bulk on TEST — STATE.md is
  stale on this.** `master_place_generated_content` now holds 7,433
  `generation_method='llm'` rows (`claude-sonnet-4-5`, prompt
  `2026-08-20b-antifab`, generated today 19:23–19:37 UTC, almost certainly a
  parallel workspace) against STATE.md's "0 llm". Untouched by this branch.
  **Verdict on the overlap question: the description column should NOT draw
  from that output** — the generated-content table's own migration header
  records that a `master_place` column was considered and rejected for exactly
  this, and `description_source` derives `'source'` from
  `master_place.description IS NOT NULL`, so LLM text there would be
  mislabeled on both the export view and Typesense. Also corrected the
  framing: the pilot targets the STRONG/WEAK bucket with no real description
  (7,154), **not** the NONE bucket — the NONE bucket was the template pass.
- **`photo_url` is a snapshot, not resolver-owned** — same staleness class as
  `master_place.state`, and deliberately so: wiring it into
  `recompute_master_place()` needs `field_precedence` seeding (Adam's call)
  and a dedicated step, since `resolve_field()` reads
  `normalized_payload->><field>` while the photo lives at
  `normalized_payload.photo.url`. The backfill is idempotent and
  self-clearing, so re-running it after a materialize is the interim
  mitigation. Full report:
  `docs/measurements/2026-08-21-master-place-enrichment-columns.md`.

## 2026-08-21 — state-boundary rebuild, NONE-bucket templates, eligibility + provenance + review

- **A manual spot-check (Astoria Column, WA/OR border, labeled Oregon
  when it reads as Washington) escalated from a Nevada-only bbox patch to
  a full six-state rebuild on real geometry.** During the narrower fix's
  own testing, Las Vegas and Reno — unambiguously Nevada — resolved to
  "ambiguous" under a naive multi-box-vote design, because California's
  existing box independently also overreaches into real Nevada. That
  regression was the concrete signal to stop patching one box in
  isolation. Rebuilt on US Census TIGER/Line 2023 point-in-polygon for
  all six states in one pass; the Nevada-only module was deleted once
  fully redundant. Corpus-wide backfill corrected 2,964 of 32,734
  in-scope rows (9.05%) — NV→CA was the large majority, but two smaller
  patterns (AZ overreach, a near-even OR↔WA Columbia River split) only
  surfaced by doing all six states properly.
- **10,292 zero-fabrication template descriptions generated for the
  NONE bucket, then two follow-up passes corrected them as the state fix
  landed underneath.** 158 rows had already-generated text naming the
  now-wrong state (confirmed via literal text inspection, not the
  transition matrix alone); 1,211 rows had never named any state at all
  and gained a correct one once real geometry made it resolvable — kept
  as a separate pass since it's an addition, not a stale-fact fix.
- **Decided template descriptions count as STRONG for eligibility, but
  conditioned that decision on building provenance and exclusion in the
  same pass, not deferring them.** `has_template_description` folded into
  `isStrong()`; NONE bucket 10,527 → 235 corpus-wide. In the same pass:
  `description_source` ('source'/'template'/'llm'/null) added to the
  export view and the Typesense index, and `pois_along_corridor` now
  excludes template-only rows by default — verified a "dual" row (real
  description plus an unused template backup) is NOT wrongly excluded.
- **A review/re-queue mechanism was built and immediately exercised on a
  real case, not just designed.** Four flat columns on
  `master_place_generated_content` (chose against a companion table —
  the real need is one current flag, not a history log). The Astoria
  Column's template row is flagged for real, confirmed excluded from
  trip generation via the flag, confirmed still browsable.
- **Wiring `description_source` into Typesense surfaced a real,
  independent gap: the collection already existed, so a schema addition
  in code never reached the live index.** Fixed with a
  schema-reconciliation step that PATCHes missing fields into an
  existing collection before re-import — which incidentally caught a
  SECOND, pre-existing instance of the same bug on `photo_url` (added to
  the schema in an earlier migration, never reconciled either) and fixed
  it in the same pass. One self-caught bug along the way: the first
  reconciliation attempt tried to alter Typesense's implicit `id` field
  and was cleanly rejected before being corrected.
- **This entire session ran without a single write to PROD**, and — like
  2026-08-20 — ~~the code from this session is uncommitted as of this docs
  pass, sitting directly on local `main`, not a branch, not pushed~~
  **[CORRECTED below — since merged as #244]**. This docs pass is a separate
  commit from that code, on purpose.
- **PR #243 (the 2026-08-20 session's own work) merged to `main` since
  that session's doc pass** — `5a822ab`. The "open PR" framing throughout
  the 2026-08-20 `STATE.md` section is now corrected in place, not
  rewritten.
- **PR #244 — THIS session's corpus-quality work — has since merged to
  `main`** as `d6c55ac`. The state-boundary rebuild, NONE-bucket template
  descriptions, eligibility/provenance/review mechanism, and placeholder
  deactivations described above are on `main`; the "uncommitted / not pushed"
  framing in the first bullet is corrected here in place, not rewritten.
- **PR #245 — place-data resolver consolidation ADR** (a follow-up added
  after this session's original work; decided in a design-review
  conversation, implementation pending) merged to `main` as `4fbd051`, now
  the `origin/main` tip. Doc:
  `docs/decisions/2026-08-21-place-data-resolver-consolidation.md`.

## 2026-08-20 — state_parks LIVE ON PROD

- **state_parks ingester built, TEST ingest + materialize complete.** 1,736
  source_records across 6 states (CA 914, WA 280, OR 342, NV 105, AZ 48, UT 47).
  881 new master_places, 58 auto_linked, 797 manual_review, 0 errors.
- **Campsite aggregation implemented** — AZ's 1,346 individual sites → 14
  park-level campground records (per `PARK_ABBR4`); WA's 6,124 sites → 73
  park-level campground records (per `ParkName`, Filter=active only). Per-site
  records are NOT emitted as individual source_records — they're aggregated to
  avoid flooding corridor-ranking density scoring.
- **Three defects caught by self-audit and fixed before TEST ingest:** (1) AZ
  campground names were raw PARK_ABBR4 codes ("LDSP Campground") — no shared
  join key between the AZ campsites and parks layers; resolved via nearest-point
  matching against State_Park_Points, all 14 matches verified unambiguous with
  ≥1.17km margin to second-nearest. (2) NV facility category mapping was broken
  — all 362 records got `park_feature` because the code checked for a `Campground`
  field that doesn't exist on TP_SCORP_Master; fixed to use the `type` coded-
  domain field (31 Campground, 20 Trailhead, 311 park_feature). (3) AZ/WA
  aggregated rows missing `park_id` in normalized_payload.
- **Two polygon-geometry routing bugs caught during dry-run:** WA and NV parks
  endpoints return polygon geometry but the code routed them through
  `buildPointParkRow` (point-only), skipping all records. Fixed by adding
  `groupBy` to route through the dissolve path.
- **NV facilities data-quality finding:** `guid` is whitespace on ALL 362
  state-park-filtered records — the earlier verification checked the unfiltered
  7,412-record layer. `objectid` is the only populated unique field; accepted
  as key with same risk class as NV parks name-key. Also, 284 of 362 NV
  facilities have blank `poiname` (toilets, parking, kiosks) — correctly
  skipped.
- **Manual-review queue analysis:** 797 pending, 83% blended_residual. The
  dominant pattern is state_parks park-boundary records matching PAD-US
  land-status polygons (608/663 = 92% of blended_residual). Matches are
  typically same name + ≤50m distance + name_sim ≥0.9, but cat_compat=0.0
  (recreation_area vs land_status) blocks auto-confirm. These are real
  same-place matches; the category mismatch is what holds them.
- **Multi place_match check:** 0 state_parks SRs with >1 place_match row.
  26 all-sources duplicates found — all `atlas_oddities`, pre-existing.
- **Field precedence verified:** state_parks (priority 4) correctly wins over
  OSM (priority 5) for canonical_name; RIDB (priority 3) correctly wins over
  state_parks. Checked 4 specific multi-source master_places.

## 2026-08-18 — State Parks Enumeration

- **State parks source enumeration — six states, investigation-only, no code.**
  Branch `state-park-systems-enumeration`. All six OSM target states (CA, AZ, NV,
  UT, WA, OR) have public, unauthenticated ArcGIS endpoints for their state park
  systems. Every endpoint URL verified live. Data depth splits three ways: AZ has
  per-campsite amenity data (from 2016), WA/CA/NV have campground/facility-level
  points, OR/UT are boundaries-only. No state publishes fees or seasonal closures
  via GIS.
- **Architecture spec written and reviewed through four verification rounds**
  (`docs/specs/state-parks-source-architecture.md`, v4, READY FOR BUILD). Covers
  source_id, external_id keys, dissolve logic, category mapping, quality scores,
  field_precedence, per-state adapter config. All open questions resolved; only
  the description placeholder is blocked on a separate visitor-website investigation.
- **Key findings worth carrying forward:** (1) ArcGIS OBJECTID is NOT stable on
  at least 4 of 10 endpoints — GlobalID or agency codes preferred wherever
  available. (2) NV's `id` field is broken (753/759 records = 0); NV boundaries
  have no GlobalID; `name` is the only viable key, risk accepted at 27-record
  scope. (3) WA `ParkCode` has 3 collisions (different parks sharing a code:
  Brooks Memorial ≠ Satus Pass, Conconully ≠ Conconully Lake, Deception Pass ≠
  Hope Island); `ParkName` (207/207 distinct) used instead. (4) AZ `SITE_ID`
  collides across parks (site 44 appears in 10 different parks); GlobalID used.
  (5) CA has 461 boundary polygons → 394 UNITNBR groups → CSP official 280 "park
  units" — the gap is non-classified holdings. (6) OR `NAME` has 2 edge cases
  (false merge + false split); `FULL_NAME` (342 distinct, 0 nulls) resolves both.
  (7) OSM operator-tag coverage is too sparse for primary use: 3 (UT) to 122 (WA)
  features with correct state-parks operator tags.
- **Self-audit methodology proved valuable.** Three rounds of "re-analyze for
  hallucinations, scope creep, failures, and incorrect logic" caught: the NV id=0
  problem, AZ SITE_ID collisions, WA ParkCode collisions, CA's unsourced "~280"
  figure, the OR dissolve edge cases, the iOverlander rationale referencing a
  banned source, and imprecise description-coverage counts. Each was then closed
  with a targeted verification query against the live endpoint.
- **Decisions made by Adam this session:** scope = six states; depth =
  campground-level where available; fee/seasonal = omitted; NV key risk =
  accepted; CA SUBTYPE = ingest all, filter downstream; description = from
  visitor websites, not GIS (separate investigation underway); OSM = fallback
  only.

## 2026-08-20 — corpus quality: BLM/RIDB eligibility fixes, LLM description prompt, placeholder deactivations (PR #243)

- **Google Places content warehousing ruled out on compliance grounds
  before any code was written.** Checked Google's Places API (New) caching
  policy directly: only `place_id` and coordinates (30-day) are cacheable;
  `editorialSummary` and every other Place Details field has no caching
  exception, field-based not display-based. The only compliant path is
  live-fetch-at-render, never persist — a different architecture than what
  was scoped. Parked in `BACKLOG.md`, sequenced after the LLM-enrichment
  pass below. ADR: `docs/decisions/2026-08-20-corpus-enrichment-and-cleanup-decisions.md` §1.
- **LLM description generation: prompt redesign fixed real fabrication,
  41% → 4% any-fabrication on the same 27 rows** (severe: 15% → 0%). Target
  population scoped to STRONG/WEAK-bucket-no-description (8,782 rows),
  `atlas_oddities` excluded (0 of 2,866 active rows have any description
  text, despite many being STRONG via tags/hours). One residual fabrication
  case remains, reported not papered over; the 4% figure is explicitly a
  small-sample result, not certified at scale. ADR §3.
- **Two real missed-field gaps found and fixed in `eligibility.ts`** — RIDB
  `FacilityDirections` was never parsed into `normalized_payload`, and BLM's
  `WEB_LINK` was mapped to `web_link` but never `contact.website` (a
  deliberate original design choice, reversed here on explicit instruction
  and flagged in the code). New source-agnostic `has_real_directions`
  signal. Backfilled + verified on TEST: 273 rows flipped out of NONE
  (265 BLM + 8 RIDB). **Code is uncommitted as of this doc pass.**
- **OSM's NONE bucket investigated and found genuinely sparse, not a hidden
  win like BLM/RIDB.** Every OSM row on a NONE-bucket place structurally has
  <5 raw tags and zero of the 10 recognized meaningful keys — verified with
  zero exceptions across 14,105 rows. Checked all 195 distinct tag keys down
  to frequency 1; none carried prose. No fix applied — there's nothing to
  fix.
- **Self-audited the session's own work (`sg` skill) and found three real
  errors, none yet corrected:** a false "RecAreaSchema has no directions
  field" claim (it does, 90.5% populated), a 1,157-vs-1,144
  atlas_oddities count mismatch between two same-session docs never
  cross-checked, and a "severe cases cluster on WEAK bucket" claim
  contradicted by the report's own cited example. Presented to the user;
  changing nothing until there's a decision, per the skill's own rule.
- **Deactivated two placeholder-name populations on TEST** — 3,427
  picnic_area + 748 ev_charging rows, both NONE-bucket AND carrying the
  exact literal placeholder name (`"Unnamed picnic area"` /
  `"Unnamed ev charging"`), same mechanism as the 2026-08-11 peak/spring
  deactivation. **ev_charging's placeholder pattern was investigated fresh
  rather than assumed to mirror picnic_area's — it does share the
  single-exact-string shape, but covers only 26% of the category (real
  brand names dominate), not ~75% like picnic_area.** Verified both:
  0 deactivated rows in the search-export view, 0/5 spot-checked still
  surface via live `pois_along_corridor` generation calls.
- **This entire session ran without a single write to PROD.** Every DB
  write (LLM sample, BLM/RIDB backfill, both deactivations) targeted TEST
  (`znldzjdatkogdktymtvi`) only, each script asserting the project ref
  before writing.

## 2026-08-18 — Amenities & Category Curation

- **Amenities reconnected end to end, then a session of category curation.**
  Source-layer normalization (OSM + NPS, NPS extended to 9 further categories),
  the boolean-map → display-label translator for the slideup, the
  capacity/amenities/priceTier merge-layer reconnect, OSM added to `amenities`
  `field_precedence` as gap-fill only, and the OSM/parks_canada priority
  collision resolved 5 → 8. All on `fix/amenities-render-shape`, **pushed to origin
  at end of session; no PR opened**.
- **Two categories deactivated as product scope, not as a data bug.** peak +
  spring, **65,389 rows measured 2026-08-18** (earlier notes said ~64,300 — the
  measured figure supersedes). Confirmed real via a live Overpass cross-check
  before flipping anything: these exist and are correctly tagged, they are simply
  not POIs this product curates.
- **A measurement bug was fixed BEFORE trusting the sparseness verdict it fed.**
  The STRONG/WEAK/NONE eligibility bucketing never read
  `normalized_payload.description` directly, which wrongly scored RIDB/USFS-heavy
  categories (facility, visitor_center, recreation_area) as sparse. After the fix
  those categories moved and the seven genuinely-sparse ones did **not** — that
  non-movement is what justified the sparse-batch deactivation. Worth keeping:
  the deactivation decision was re-derived after the instrument was repaired,
  rather than inherited from the broken run.
- **`pois_along_corridor` never checked `source_count` in any of its 6
  revisions.** A place deactivated via the established pattern
  (`is_active=false` → recompute → `source_count = 0`) was correctly hidden from
  browse/search by the export view's filter, but the generation RPC reads
  `master_place.geometry` directly, bypassing the view — so a deactivated place
  was still offered as a trip stop. Fixed (migration `20260818160000`, TEST-only).
  **This is why the reactivation was later verified on both surfaces and not
  just one.**
- **dump_station was 83% mislabeled.** 123 of 149 rows carried pre-#202
  `amenity=waste_disposal` — municipal trash bins. Reclassified to null first,
  then hard-deleted on Adam's call (matching BACKLOG's original preference).
  **The premise was verified only AFTER the deletion, and it held**: a full scan
  of all 123 backed-up rows found 100% `waste_disposal`, zero content-bearing
  tags, and the only 2 named rows literally named `"Dumpster"`. Real population
  is **26**. Recorded as a sequencing lesson — the check should have preceded the
  destructive step, and the conclusion was inherited from a 20-row PROD sample
  taken on a different date until then.
- **Templated descriptions built for toilet / water / dump_station**, then those
  three **reactivated** (`b794a23`). Gap-fill only — a real OSM
  `description`/`note` always wins, and all 29 pre-existing real descriptions
  survived verbatim. Bare rows get no description rather than a fabricated one.
  Safety rule: explicit `drinking_water=no` outranks a generic "drinking water"
  lead, because 38 water rows are explicitly non-potable and that is the one
  error here with real-world consequences.
- **Typesense synced clean** — 36,175 indexed, 0 failed, 81,086 stale pruned;
  `places_test` now equals the export view exactly. **The 3 OOM failures the
  handoff reported did not recur — but were also never observed in this
  session**, so they remain a reported constraint, not a reproduced one.
- **Seven self-audits, and the pattern they exposed is the durable finding.**
  In order: a vacuous timezone-based date filter that manufactured a false
  before/after contrast; an unpaginated query that was right by luck; two
  invented numbers (a false "byte-identical" claim and a wrong distance) that
  were chat-only and never committed; one correctly-measured number misapplied
  to an inflated claim (173 where the real figure was 59); one arithmetic error
  in a commit message (4 new tests vs 2); and an inherited claim about a prior
  session's OOM failures presented as this session's own observation.
  **Every single failure was in summarizing prose — a commit message or a chat
  report. Not one was in the underlying measurement.** The data work held up
  under every audit. The rule this produced: a number that appears only in a
  summary and not in a tool output is unverified by construction, and must be
  recomputed before it is written. Now a standing instruction in Adam's memory
  system.
- **Docs gap closed.** This branch had made multiple corpus mutations without a
  single `STATE.md` or `LOG.md` entry; this pass is the first. Every figure was
  re-queried against TEST in one pass rather than transcribed, because counts
  drifted between reports during the session.

## 2026-08-17

- **All four USFS categories materialized live on TEST.** Picnic (570 SR) +
  dispersed (401 SR) ran, then campground (2,312 SR): **715 new_master_place +
  655 auto_link + 942 manual_review** `[handoff, unverified — split not isolated
  this session; the three sum to the measured 2,312]`. Corpus **150,844
  master_place** (+1,459), queue **5,745** (blended_residual 4,979 · close_nameless
  325 · **name_dominant_low_conf 0 → 441**) `[queried TEST 2026-08-17]`. The floor's
  low-conf cluster is now visible in the queue for the first time.
- **LLM place-pair adjudication calibration — not usable unsupervised** `[handoff,
  unverified — measured this session, not re-run]`. 60 pairs, 3 groups. **No-web run
  ($0.26):** the model abstained just **1 of 60** and treated copied federal
  descriptions (USFS text mirrored into a ridb record) as **identity evidence** —
  a same-text ≠ same-place failure. **Web-enabled re-run** confirmed the
  FS↔recreation.gov link is real but cost **$0.40/pair** and **exhausted API
  credits after 17 pairs** — infeasible at queue scale.
- **The deterministic finding that replaced the LLM: the recreation.gov facility
  id is already embedded in the USFS INFRA payload text.** No fetch, no model —
  a regex over stored data. **$0, ~40s for the full queue.** The fetch path the
  earlier design assumed is a dead end (below).
- **`resolve_place_match` / `unresolve_place_match` RPCs** (migration
  `20260817120000`, **TEST only**). The confirm path **did not exist**:
  `apply_match_outcomes` is INSERT-only and its `manual_review` branch leaves the
  source_record unlinked, so confirming an existing pending row had no path
  (re-insert collides with `unique(source_record_id, master_place_id)`).
  `resolve_place_match` links the SR + flips to `confirmed` + tags `resolved_by` +
  recomputes; `unresolve_place_match` is the exact inverse for snapshot-based undo.
  Neither deletes. ADR `2026-08-17-resolve-place-match-and-recgov-id-rule.md`.
- **Recgov-id rule applied as tag `full0817`: 370 campground rows confirmed on
  exact facility-id match. 0 failures, 0 renames, 0 recategorizations, max
  source_count 6** `[queried TEST 2026-08-17]`. **The 0 renames was PROVABLE from
  `field_precedence` before it was measured** — usfs ties ridb at `canonical_name`
  priority 3 / quality 0.9 and loses the tie on `source_id ASC`; usfs has no
  `primary_category` precedence row at all. Undo verified **exact** on a 2-row round
  trip before the full run. Chunked 25 with health checks (73–181 ms, flat).
- **Surfaced and untouched:** **58** rows where the payload id resolves to a
  *different* master_place (mis-pairings); **28** naming recreation.gov facilities
  not in the corpus. PR **#230** open, commit `45e6ede`, not merged.
- **Findings worth keeping (not just events):** (1) **The recgov bridge is a
  developed-campground feature.** Payload-embedded ids: campground **921/2,312
  (40%)**, but trailhead 5/3,041 · picnic 21/570 · dispersed **0/407** — only **26
  of 4,018** non-campground SRs carry any id `[queried TEST 2026-08-17]`. Those rows
  have no identity evidence at any price. (2) **The stored `usda_portal_url` is a
  dead legacy link** — 301s to a generic forest index and drops the recid; any
  future design assuming it resolves is wrong `[measured this session]`. (3)
  **`fs.usda.gov` 403-blocks non-browser user agents** `[measured this session]`.
  (4) **Duplicate master_places exist that the matcher never proposed as pairs** —
  the recgov-id rule is a *high-precision* duplicate detector (same facility id →
  two MPs = one place split in two); confirmed cases Smiling River Campground,
  Allingham, South Shore, East Kachess Group Site `[queried TEST 2026-08-17]`. A
  corpus-wide count is **not** cleanly obtainable by name (brands + geographically
  distinct same-named campgrounds confound it); a real count later would come from
  the recgov-id path itself. Distinct from the queue — a corpus problem.
- **Merge note:** the 2026-08-16 code PRs #223 (usfs + scripts) and #224 (matcher
  floor + dry-run tooling) **merged to `main`** since that entry was written (the
  entry's "still OPEN" line is historical, not edited).

### — later session (NPS six-state) —

- **NPS was a stale demo: 83 rows, all Joshua Tree, one 13-second run in May** —
  against 91 units + ~223 campgrounds in the six states (~1% coverage). The
  ingester is parkCode-driven and won't enumerate; codes come from
  `/parks?stateCode=` as a manual pre-step. Ingested all 91 → **5,283
  `source_record`** `[queried TEST 2026-08-17]`.
- **Two matcher/ingester fixes merged.** #234 bars `nps:park_feature` from
  linking: **all 103 bad auto_links came through `fed_exact`** — the within-10m
  federal coordinate shortcut, which is category-blind AND name-blind, so 11
  fossil labels collapsed onto Quarry Exhibit Hall and NPS priority-1 precedence
  renamed it. The guard forces `new_master_place` (also bars `amenity_rollup` +
  `manual_review`). #235 wired `/parks`: park rows were getting a synthetic
  `"NPS park boundary: <code>"` name that would have renamed Alcatraz Island + 8
  others on materialize. ADR: `docs/decisions/2026-08-17-bar-nps-park-feature-linking.md`.
- **Also merged earlier this session: #233** parametrized the recgov rule's
  sources (usfs → +nps) and fixed a latent hardcode that modeled every added SR
  as `usfs`/0.9 — that would have under-reported NPS rename risk as zero.
- **Live materialize — 7 category chunks, 5,200 rows, 0 errors, 0 5xx, no halt.**
  4,651 `new_master_place` · 262 `auto_link` · 279 `manual_review` · 8
  `amenity_rollup`. **Zero `park_feature` linked to anything** (measured: max
  `source_count` 1, 0 with `source_count>1`, max 1 SR/MP) `[queried TEST
  2026-08-17]`.
- **Renames: 103 canonical, 0 category.** Re-measured against the actual 272
  shared target MPs, not the dry run's predicted 261 — the count held. **Category
  = 0 is a real finding about the dry-run report:** it predicted 56, but it
  compares NPS `inferred_category` to `primary_category`, while `recompute`
  resolves from `normalized_payload.primary_category`, which the NPS ingester
  never populates (0 MPs carry `attribution.primary_category=='nps'`). That 56 is
  a report artifact and will mislead again.
- **The 121→103 canonical gap, worth writing down because the shape recurs:** the
  dry run predicts renames **per prediction row** (SR→MP); the corpus renames
  **per master_place**. The 18 not-landed = 9 `park` (synthetic in the dry run,
  now real `/parks` names → no-op) + 9 non-park (~5 *sibling* renames where a
  different NPS SR on the same MP won, so the row "didn't land" but the MP did
  rename — counted once under the winner; ~4 genuine no-ops). **Not order effects.**
- **NPS `/places` is an editorial CMS, not a POI catalog.** Every record is a
  content card with `bodyText` + `images`; a picnic area and a fossil label share
  one schema. No field cleanly separates physical sites from interpretive content
  — the two best signals disagree on ~250 of 900 sampled rows; a 50-row read
  showed roughly half are real destinations.
- **Typesense was stale by ~102k, not the 4,651 NPS delta.** `places_test`
  **14,911 → 117,261** — the 14,911 was the 2026-08-10 state; the index was **not
  synced since 2026-08-10**, so OSM/PAD-US/BLM never reached search. One
  `materialize --skip-er` (collection `places_test`, 0 failed) caught it up.
- **Cleanup:** the last synthetic-named MP (jotr, already-resolved from May) →
  targeted `recompute_master_place` → `"Joshua Tree National Park"`, one call. 0
  synthetic names remain. 10 jotr `park_feature` rows still pending from May (the
  guard would have made them new MPs; they predate it) — reported, not touched.
- **Process:** two self-audits this session caught the sampled-as-total habit
  again ("renames mostly casing" → 21/216 cosmetic; "category changes all
  facility→campground" → 28/159) and one over-clean "order effects" gloss on the
  121→103 gap — corrected before drafting by re-measuring against actual targets.

## 2026-08-16

- **PAD-US six-state campaign COMPLETE on TEST.** Fee_Managers endpoint, all six
  states; padus active `source_record` → **37,701**. Corpus **149,385 master_place**
  `[queried TEST]`. Polygon centroids are structurally disjoint from the point corpus
  under the current matcher (0 auto_link, 0 amenity_rollup across all six
  `[per #225, not re-measured this turn]`) — the carried-forward "over-merge"
  fear did **not** reproduce. **~96% of the land-status
  family is `land_status`** (35,966 vs 1,314 `public_land`), all search-excluded; the
  corpus-weight question is open (`BACKLOG.md`).
- **USFS ingester rewritten** `EDW_RecreationOpportunities_01` → `EDW_RecInfraRecreationSites_02`
  (PR #226 → OPEN #223). **6,324 active SRs** (trailhead 3,041 · campground 2,312 ·
  picnic 570 · dispersed 401) `[queried TEST]`; 6 legacy `usfs:recarea:*`
  deactivated. **Trailhead materialized live** — 2,601 linked `[queried TEST]`
  (the 630 auto_link / 1,971 new_MP split is `[handoff, unverified]`); 440 manual_review.
  Campground PARKED, picnic + dispersed dry-ran clean, not run.
- **Matcher Bug 2 fixed** — `name_dominant` now gates on `combined_confidence ≥ 0.70`,
  below-floor → `manual_review` (`name_dominant_low_conf`), no fall-through (PR #227 →
  OPEN #224; ADR `2026-08-16-name-dominant-confidence-floor.md`). Campground preview
  1,427 auto → 657, `low_confidence` flags 771 → 0; picnic byte-identical (382/0/138/50).
  **0.70 vs 0.65:** the choice moved only 59 campground rows; 0.70 kept because it zeroes
  the report's own low-conf flag and keeps the 40–75 m band `name_dominant` exists for.
  Distance clip deliberately left alone (it's the Step-5 gate corpus-wide; wrong blast
  radius + wrong sign to touch it). Guarded by a mocked-DB routing test (the only CI
  guard — `phase3a` is excluded); apply path exercised end-to-end + cleaned up. Also
  shipped: `materialize --dry-run-report` (per-match JSONL; matcher untouched, counts
  byte-identical) in OPEN #224.
- **Manual-review queue measured 5,089** (95% osm `blended_residual`). No processing
  framework; the floor adds ~803 more from campground. **Triage framework scoped, not
  built** (`BACKLOG.md`) — it is now the blocker on a live campground materialize, not
  the matcher.
- **Incident `[handoff, unverified — not observed by this agent]`:** TEST (Micro
  `t4g.micro`) went Unhealthy ~2h during a WA PAD-US materialize — `materialize`
  has no `pLimit`, back-to-back runs exhausted the tier.
  Recovered; runs since chunked with health checks. **No PROD writes all session.**
- **Claims that did NOT survive measurement earlier this session** — all from the
  handoff / prior turns and **not re-verified by this agent** (`[handoff, unverified]`
  throughout; recorded so the next agent doesn't re-inherit them as open): MVUM encodes
  **no** dispersed-camping corridor data (vehicle
  class + seasonal only; corridor rules live in per-forest PDFs); `EDW_RecreationAreaActivities_01`
  **is** the real multi-value activity roster (52,482 rows, ~3× RecOpp's dispersed
  coverage) — not the dead end it was twice dismissed as; `EDW_InfraRecreationSites_01`
  has more fields (137 vs 70) than `_02` but they're ~90% empty, so `_02` was still the
  right layer; `EDW_Wilderness_02` (629 subparcels, 253 six-state) is the source to wire
  for the still-unbuilt PAD-US Designation gap; and an earlier "6–10% of campground merges
  are wrong" figure was fabricated from an 8-row eyeball — wrongness is unknown and
  unknowable from corpus data (USFS↔RIDB share no identifier).
- **Merge/docs note:** docs-only #225 (padus) + #228 (matcher/CI notes) merged to `main`;
  the *code* PRs #223 (usfs + scripts) and #224 (matcher floor + dry-run tooling) are still
  OPEN — the matcher floor and USFS ingester are **not on `main`** yet.

## 2026-08-11

- **bbq/fire_pit deactivated on PROD.** 223 osm `inferred_category = fire_pit`
  source_records set `is_active = false` (one batch of ≤500, fire_pit-only
  compound filter); their **138** solo master_places recomputed to
  `source_count = 0`; the **85** dangling pending `place_match` rows on the
  unlinked source_records cleared; `search:sync` pruned **138** stale docs from
  `places_prod`. View **16,654 → 16,516**; `places_prod` = view exactly;
  active source_record 20,750 → 20,527. All re-verified `[queried PROD]`.
- **Why they were noise.** `amenity=fire_pit` has **zero** nodes across all six
  states (CA/NV/UT/AZ/WA/OR, ISO-area Overpass) — every "fire_pit"-category row
  was actually `amenity=bbq`. And bbq is picnic-area grills: **83%** (184/223)
  sit within 100m of another bbq node, all nameless, no `operator`. Ingested,
  they rendered as standalone "Unnamed fire pit" pins. `amenity_rollup` could
  **not** absorb them because `AMENITY_PARENT_CATEGORIES`
  (campground/recreation_area/facility/lodging) excludes `picnic_area` and
  `park` — measured **0/223** within 100m of a rollup parent.
- **The 138 were recomputed, not deleted.** They stay in `master_place` at
  `source_count = 0` (still `is_searchable`); the view's `source_count > 0`
  filter is what drops them. `master_place source_count = 0` went 0 → exactly
  138, boundary-checked against `updated_at` (zero unexpected rows touched).
- **gas_station (261) + ev_charging (184) deliberately left active** — their
  mappings were dropped in #214, but the rows remain (gas covered live by
  Google; ev_charging is the only corpus EV source until Google's
  `electric_vehicle_charging_station` type is verified in prod). See BACKLOG.
- **Operation hygiene.** `data/.env` swapped to PROD for the op (fail-closed
  PROD assertion + fire_pit-only filter on every write), then restored to TEST
  byte-identical; CLI link never touched (unlinked, not PROD). No schema change,
  no migration — pure data.

## 2026-08-10

- **Three PRs merged: #200 matcher placeholder-name fix; #201 diagnostics
  + apply/undo scripts; #202 OSM tag correction + `--iso`/`--families`
  flags.** Each squash-merged, remote branch deleted. Full description of
  what each shipped: `STATE.md` §2026-08-10. All landed within ~10
  minutes end-to-end (04:49–04:56 UTC).
- **OSM tag defect quantified before the fix landed.** `waste_disposal`
  had been mapped to `dump_station` — but `waste_disposal` is
  OSM-semantics for a municipal trash bin. **1,723 PROD rows
  misclassified as `dump_station`** `[queried PROD 2026-08-09]`; sample
  of 20 returned **0 real dump stations** (every one a trash bin at a
  park entrance / gas station / urban corner). The actual RV tag
  `amenity=sanitary_dump_station` was **never requested** by any
  Overpass query in the adapter's history. Similarly
  `tourism=camp_site + backcountry=yes` was **never a fetch predicate**;
  the adapter fetched bare camp_site and depended on category-mapping
  refinement to split dispersed. Both fixed in #202.
- **Placeholder-name matcher defect quantified: 43% → 3.6%.** Fabricated
  `"Unnamed <category>"` strings from OSM's `inferName` fallback collide
  at `jaroWinkler = 1.0`, and combined with same-category = 1.0 the
  blended formula **clamps at exactly 0.600** — the `manual_review`
  floor — for any pair >100m apart. Measured on UT camping ingest
  (2,176 rows): 945 queued for review = **43%**; 22 of 30 samples pinned
  at conf 0.600; 27 of 30 identical placeholder names. Fix (#200): force
  `name_similarity = 0` when either side is a placeholder. Re-measured
  after fix on WA/OR/NV ingest: **3.6%** review rate — a 12× reduction.
- **PROD Part 1 of the six-state trim: done by the parallel havana
  session, NOT this one.** Between STOP #1 and 02:00 UTC 2026-08-10, the
  `work/six-state-trim` branch in the `havana` worktree applied
  `20260810120000_reference_trips_is_active.sql` to PROD and flipped
  `la-to-deadhorse` + `dawson-vancouver-cassiar` inactive. Both target
  rows updated at the same microsecond timestamp
  `2026-08-10T01:52:40.76769+00:00` (single-statement UPDATE signature).
  Cassiar payload byte-integrity verified via SHA
  (`46a17cbb421208f7…` matches the frozen-Cassiar SHA in
  `docs/decisions/2026-07-25-reference-trips-db-first.md`). Discovered
  by this session in a read-only preflight query and reported at STOP;
  attribution recorded to prevent future sessions attributing the write
  to this session.
- **521-row placeholder rewrite applied to TEST; 424 legitimate reviews
  preserved BYTE-IDENTICAL.** Targeted script
  (`apply-placeholder-rewrite.ts` in #201) consumed
  `/tmp/dryrun-classification.json`, applied 521 `new_master_place`
  outcomes via the standard `apply_match_outcomes` RPC (0 skipped by the
  idempotency guard, 0 errors). Post-condition verifier proved all 424
  keeps identical across all 8 place_match fields vs a pre-flight
  snapshot. Reversal instrument
  (`undo-placeholder-rewrite.ts`) preserved; mapping durable at
  `~/.config/overlander/backups/rewrite-mapping-20260810-052514.json`.
- **4-state TEST OSM camping pattern proven.** WA/OR/NV serial ingest
  after UT under `--iso $ISO --families camping`: predicted 1,224 /
  1,504 / 168 · fetched **exactly the same on every state** · zero
  errors · zero non-camping spillover. UT (2,176) rounded the set out to
  **5,072 total across 4 states, 0 rows lost or gained** vs the
  area-scoped Overpass predictions. `materialize --skip-sync` produced
  95.8% new_master_place + 3.6% review + 0.6% auto_link with the
  matcher fix active. Full breakdown: `STATE.md` §2026-08-10.
- **Cross-category `amenity_rollup` defect surfaced but NOT fixed by the
  placeholder work** (recorded in BACKLOG). 5-8 collapsed MPs on TEST
  hold different amenity types under one placeholder name (e.g.
  `"Unnamed water"` MP holding 3 water_taps + 1 toilet, another holding
  4 water_taps + 2 dump_stations). Placeholder fix stops NEW such
  collisions from auto-linking; already-confirmed merges remain.
  Orthogonal to the placeholder fix — a real-named `"Belle Toilets"`
  auto-linked to `"Belle Water"` at 20m has the same shape.
- **~28 RIDB `/media` errors from the 2026-08-09 backfill are asserted
  not-auth but the error shape remains UNVERIFIED** (BACKLOG). Prior
  session's `docs/state-ridb-route-a` wrap asserted they're not
  `web/.env.local` 401 (that key is unused; every RIDB consumer runs off
  `data/.env`'s working key), but the run's stderr wasn't captured and
  no log file exists. A `--dry-run` backfill would surface the shape.
- **LESSON — `docs/state-ridb-route-a` sibling branch existed
  independently.** A prior session had opened it with the accurate #198
  wrap + PREFLIGHT diagnosis; my STOP #1 branch (#199, closed today)
  duplicated the ground and got DRIFT #1 partly wrong. Rule: check for
  `docs/state-*` branches before writing a new refresh.
- **CI shape correction.** `#201`'s first CI failed on typecheck —
  `scripts/test-manual-review-dryrun.ts` imported `isPlaceholderName`
  which only existed on #200's branch. Merging #200 first + rebasing
  #201 resolved the import; a second bug (arithmetic on a non-numeric
  compound in `verify-rewrite-postconditions.ts`) was fixed inline. Rule
  worth naming for later: **when two PRs are dependent, merge the
  dependency FIRST, then rebase the dependent to pick up the exported
  symbols — CI failure is the natural gate**.
- **Two more PRs merged: #203 (end-of-day doc snapshot) and #206
  (`materialize`: split `matchAll` from `apply` for the incremental
  path).** #206 is what made the batch-25 recovery run below possible —
  `--apply-from-cache` re-applies saved outcomes without re-paying matchAll.
- **PROD's `statement_timeout` is 60 s — discovered the hard way.** The
  first PROD `apply_match_outcomes` runs failed with SQLSTATE **`57014`
  "canceling statement due to statement timeout"** at **batch 500 (60,107
  ms)** and **batch 100 (60,129 ms)** — the RPC is one statement, so the
  whole batch is bounded by the role `statement_timeout`. **Batch 25 runs
  ~33 s** and clears it. The error is emitted by Postgres, relayed through
  PostgREST/supabase-js unchanged — NOT a client `AbortError`, PostgREST
  504, or pooler cut. `promote.ts`'s in-code calibration comment still
  cites a "~10 s" ceiling from a different project — stale, now backlogged.
  `data/.env` has **no client-side timeout** (`db.ts` `createClient` sets
  none), so this is purely server-side and adjustable via
  `ALTER ROLE service_role SET statement_timeout` (not changed).
- **Six-state OSM camping ingest COMPLETE on PROD, per-state, predicted =
  actual on every state.** `--source osm --iso US-<st> --families camping`,
  each pinned to `overpass-api.de` with a `timestamp_osm_base` ≤7-day
  freshness assert first (a bare/unpinned run earlier had silently drawn a
  **70-day-stale** snapshot from `kumi.systems` — always pin + assert):

  | state | predicted | fetched | inserted | updated | recats | manual_review |
  |---|--:|--:|--:|--:|--:|--:|
  | AZ | 893 | 893 | 887 | 6 | 0 | 4.40% |
  | CA | 2,721 | 2,721 | 2,474 | 247 | **23** (= predicted) | 8.33% |

  (WA/OR/NV/UT landed earlier in the day per the 4-state block above.)
  Every ingest matched its area-scoped Overpass prediction exactly. The
  adapter reports `updated: 0` always — a counting artifact
  (`persistElement` returns `"inserted"` for every upsert); the real
  insert/update split is measured from the DB via `created_at`. **CA's 23
  campground→dispersed recats matched the prediction exactly** (23
  pre-existing camp_site rows carrying `backcountry`/`informal` re-scored
  by `inferCategory`; the upsert overwrites `inferred_category` but never
  touches `master_place_id` — all 247 CA updates kept their link).
- **manual_review rate climbs with camping density: TEST 3.6% → AZ 4.4% →
  CA 8.33%.** All post-#200 (placeholder noise gone); the residual is
  genuine named-site ambiguity, and CA's 8.33% is unexplained — backlogged.
- **`search:sync` → `places_prod` on the shared Typesense cluster.** The
  PROD env backup carries only Supabase URL+key, so the collection had to
  be resolved by hand: `TYPESENSE_COLLECTION=places_prod` (what Vercel's
  `NEXT_PUBLIC_TYPESENSE_COLLECTION` reads), same host+admin key as
  `places_test`. Indexed **16,661**, pruned 0, failed 0 — exactly the
  `master_place_search_export` row count, dispersed 2,855 and campground
  5,369 matching the corpus per category. `places_prod` 13,708 → 16,661.
- **CORRECTION — per-state dispersed camping is 3,125, not the ~1,885 a
  radius spot-check suggested.** A `location:(lat,lng,150 km)` interior
  sample undercounts large states badly. ISO-area Overpass counts
  (`camp_site` + `backcountry`|`informal`, distinct) **sum to exactly the
  PROD `osm dispersed_camping` source_record total of 3,125**: CA 757, UT
  893, WA 682, AZ 270, OR 508, NV 15. The radius sample had read UT 373 /
  WA 327 / OR 156 / NV 2. **Lesson: a radius sample is not a state total —
  scope the query to the subject (ISO area), and cross-check the sum
  against the DB.**
- **RIDB Route A photo count could not be reconciled to a stated 5,256.**
  Measured on PROD: **1,622** `ridb` source_records carry a promoted
  `normalized_payload.photo.url` (nps 4,451; all sources 6,073). None of
  these is 5,256 — flagged UNVERIFIED rather than asserted. Separately,
  `master_place_search_export` has **no photo column** at all, so no photo
  reaches search yet (the "Artboard C" lateral is still open).
- **#209 — export view repointed from `six_state_scope()` to
  `six_state_footprint()`.** Analysis found the coarse scope's WA-east edge
  (−116.90) leaked **9 Idaho panhandle rows** (Priest Lake, Moscow/Lewiston,
  all ridb/nps) into search. Repointed to the tighter footprint. **Net was
  −9 +2, not −9**: footprint is NOT a strict subset of scope — its accurate
  WA-northwest edge (Haro Strait) correctly re-includes **2 San Juan Islands
  WA** campgrounds (Jones Island S/N) that scope's flat 48.40 step wrongly
  dropped. View **16,661 → 16,654**; `search:sync` pruned exactly the 9,
  `places_prod` = 16,654 `[measured PROD 2026-08-10]`.
- **#210 — `promote.ts` `DEFAULT_BATCH_SIZE` 500 → 25.** Replaced the stale
  "~10 s from a different project" calibration comment with the measured
  reality: PROD `statement_timeout` is **60 s**, `apply_match_outcomes` is a
  single statement, batch 500/100 fail `57014`, batch 25 ran min 66 ms /
  max 34.5 s / avg 8.0 s over 99 batches. No other code assumed 500; no test
  asserted it (the `500` in `phase3a.test.ts` is the 500 m candidate radius).
- **#211 — Artboard C: corpus photo in search + hydrate.** Added the same
  nps/ridb photo lateral `20260809130000` uses to `master_place_search_export`
  (`photo_url`, NPS preferred), plumbed through `sync-typesense.ts`
  (`PlaceDocument`) and `hydratePlacesByIds` (via the existing
  `nps_photo_url → photoUrl` map — no UI change). **TEST then PROD:** PROD
  view 16,654 unchanged, **3,526 rows carry a photo (~21%)**, `places_prod`
  16,654 = view; a `places_prod` doc carries `photo_url` and hydrate returns
  `photoUrl` against PROD `[measured 2026-08-10]`.
- **TEST brought to the PROD view baseline.** TEST was missing the four
  six-state view migrations (`180000–180300`); applied via
  `db:push-verify --test`, view **16,410 → 14,911** (dropped **exactly** the
  1,499 out-of-footprint rows: Idaho 1,141, MT/WY 124, CO/NM 40, Baja 10,
  other 184; osm 1,460 / google_resolved 40). TEST view now matches PROD's
  predicate structure.
- **CORRECTION — the objects-without-ledger drift was PROD-only, not TEST.**
  An earlier report this session claimed `six_state_footprint()` /
  `source_record_scope` existed on TEST as objects without a ledger row (the
  #204 pattern). The full TEST `migration list` disproved it: `20260810120000`
  and `130000` were **already in TEST's ledger** (applied via a normal
  `db push`). The direct-SQL-no-ledger drift happened only on PROD; TEST had
  **nothing to repair** — the 4 missing migrations had neither ledger rows nor
  objects and were genuinely pending.

## 2026-08-06

- **NPS corpus imagery (#196) went live end-to-end on PROD.** Migration applied to
  TEST **and** PROD; backfill run on PROD (4,451 of 4,837 nps rows carry
  `normalized_payload.photo.url`); `pois_along_corridor` returns `nps_photo_url`
  verified by query on both DBs; the Portland corridor returns "Voices" / "Honoring
  our Salmon" with `nps.gov` URLs. Position + the chain: `STATE.md` §2026-08-06.
- **DIAGNOSED: existing trips don't benefit — the second `milesFromStart`-shaped
  baked-stale debt.** Rest-day `segmentSuggestions` are baked at insert (`insertRestDay`)
  and rendered from storage with no live re-query, so `b97d06bf` day 4 (created 08-03)
  has 10 tiles with NO `photoUrl` key at all, though 9 of 10 have a corpus photo on PROD
  today. "Needs regeneration," NOT "the mapping is missing" — established by reading the
  insert path and querying the stored payload, not by guessing. `BACKLOG.md` §Refreshing
  stored suggestions.
- **The backfill's `scan()` had a pagination-while-mutate defect.** Unordered `.range()`
  paging while issuing UPDATEs in the same loop shifted heap tuples out from under the
  cursor: the PROD run left **738** rows unwritten, then **47**, converging only over
  **three** apply→dry-run passes (mid-apply `withPhoto` even read 4507 vs a stable 4451,
  double-counting). Fixed two-phase — Phase 1 reads every row in `.order("id")` and
  collects writes, Phase 2 updates by id — proven RED→GREEN with a vitest fake that
  relocates a row on each UPDATE, `pageSize=2` over 6 rows (old scanned 4, fix scans 6).
  Full writeup + the "same footgun bites any paginate-while-write backfill → shared
  helper" note: `BACKLOG.md` §NPS photo backfill.
- **CI stalled: GitHub Actions budget was $0 with stop-usage enabled, so jobs QUEUED
  indefinitely rather than failing.** Diagnosed by noticing typecheck AND build were
  queued alongside test — which rules out the repo's own test-serialization as the
  cause (all three independent jobs were stuck, not one waiting on another).
- **The #196 merge required an admin bypass — recorded WHY it was legitimate.** A
  `workflow_dispatch` run executed the identical typecheck/test/build jobs on the exact
  head SHA and all passed; the `pull_request`-event run never received a runner (the
  budget stall). So **verification was present — only the run↔PR bookkeeping link was
  missing**, not the checks. Branch enforcement stayed active; a Repository-admin bypass
  entry existed for the few seconds of the merge and was removed, confirmed by re-read.

## 2026-08-05

- **Plot-day-detail places SHIPPED across four PRs.** #187 (scoping doc +
  relocated the two measurement harnesses out of gitignored `.context/` into
  `web/scripts/`), #188 (the GeoJSON circle layer `active-day-places-circles`,
  keyed on active day, coords-guarded), #189 (marker click → `trip:placeFocus` →
  card scroll + highlight), #190 (docs wrap). All verified on `main` by grep, not
  banner. Position: `STATE.md`.
- **Established a map DOES render in dev** — the token comes from `.env.local`,
  which `next dev` loads alongside `.env.development.local`; the "token absent"
  gotcha is scoped to `--env-file` verify scripts. Runbook corrected in `CLAUDE.md`
  (#188). This unblocked real browser verification via headless Chrome + a CDP
  query of the live map object (fiber-walk to the map instance — a throwaway
  diagnostic, nothing committed).
- **The curated finding — three measurements converged.** Max curated on any day
  of any trip is **4** (`4534add5` day 1 = 263-tile pool, 4 curated); the scroll
  shows curated inline and collapses the rest. `curatedMode = false` is LIVE via
  **rest days** (PROD `b97d06bf`, current pipeline, 8/15 days), not legacy-only.
  The 386-tile blowup is legacy-only (`generationInput = n`). **This is the THIRD
  independent measurement to land on the current-pipeline-good / legacy-patchy
  boundary**, after coords and category coverage — a pattern now named in
  `STATE.md`. Open direction (layer + category filtering + `addImage` icons vs a
  DOM-marker revert) and the UNANSWERED Google Places licensing question:
  `BACKLOG.md` §Open direction.
- **Noted (did not write): the map rendering model is undocumented.** Every point
  is a DOM marker, the polyline was the only GeoJSON layer until #188 added the
  first point layer, and four category vocabularies exist (`CategoryIconV2` 9,
  `CAT_SVG` 9, `DOT_BADGE_BY_CATEGORY` 6, `category-icons.tsx` 7).
  `place-render-model.md` covers the CARD, not the map. It warrants a doc — but
  NOT while the layer's future is unsettled; documenting mid-flux would need
  rewriting.
- **CORRECTION — "the 263-degradation check is PROD-gated" was false.** Disproved
  by loading **386 features on an anonymous TEST trip** (`yotrippin-demo` day-19)
  in dev. The claim came from the build handoff and was inherited rather than
  checked; the dense case was reachable all along.
- **CORRECTION — a grep near-miss read as MISSING.** Checking whether the runbook
  correction was on `main`, the grep used `"a map DOES render"` but the text says
  `"a REAL map DOES render"` → false MISSING. Re-grepping with the exact string
  found it. Same shape as every near-miss this week: a check that could not confirm
  what it was looking for. (Also caught by the `[verified 2026-08-04]` tag.)
- **LEARNED — the #189 scroll guard was unnecessary, established by measurement.**
  Markers plot the active day only, so centering an in-day card leaves the centered
  day unchanged and `?day=` stayed `day-1` across a marker-driven scroll — so
  `continuous-day-stack.tsx` was left untouched, not modified to expose its guard.
- **Two-layer category map SHIPPED — #192 (merged, squash `bd39db4`).** Replaces #188's
  circle layer with two symbol layers (POOL/PROMINENT) over the one source, split by
  `prominent = curated OR fromWaypoints`, 9 category toggles, an `addImage` icon
  pipeline (the first SVG-rasterizing machinery in the repo). Discriminator computed
  at render — no schema change, `lib/trips/types.ts` untouched. Reuses both existing
  icon sets (stroke `CAT_SVG` lifted to a shared module for pins + prominent; filled
  `CategoryIconV2` for pool); invents no third set.
- **FOUND: not all `day.waypoints` are user-added** — the discriminator question.
  Traced every writer: add-to-day (user), generation (`waypoints: []`), fork (copies
  the source verbatim), reference trips (`alaska.ts` hand-authors them). PROD measured:
  `la-to-deadhorse` = 93 editorial waypoints (`wp-eggslut`…), `la-to-portland` = 14.
  So `fromWaypoints` means "user-added" on generated trips but "reference author wrote
  it" on forks — recorded as an accepted KNOWN LIMITATION in the PR (editorial
  waypoints promote to prominent on legacy forks).
- **Collision DECIDED by looking, not reasoning** (per the spec). Rendered a dense
  263-tile synthetic day under both `icon-allow-overlap` binaries: `true` = all 267
  paint into an unreadable mass; `false` = clean but Mapbox picks winners. Chose
  **per-layer** (pool declutters, prominent always renders) — better than either
  binary, which the two-layer split makes free. Screenshots in `.context/`.
- **APPARATUS LESSON — a DOM-driven interaction test verifies WIRING, not
  REACHABILITY.** The category-toggle "works" check clicked the checkbox via
  `querySelector(...).click()` and passed — but the panel was rendering BEHIND the
  itinerary overlay (`elementFromPoint` at its centre returned the itinerary, not the
  panel), so no human could reach it. Same shape as this week's other apparatus
  misses: the check couldn't distinguish "works" from "works but invisible." Fix:
  probe `elementFromPoint`/visibility for a control a HUMAN must use, not just fire
  its handler. Moved the harness to centre-top; runbook note added to `CLAUDE.md`.
- **APPARATUS LESSON (repeat, cost a retraction mid-session) — synthetic
  `trip:browseResults`/`trip:flyTo` RESET the active-day place source.** A feature
  count taken right after firing them read **0 features** and looked like a broken
  layer; a clean reload showed 13. Reload and pan via `map.jumpTo` (direct, no app
  events) when measuring the layer. Already in the build spec; re-confirmed live.
- **NO DENSE TEST INSTRUMENT** — the dense verification used a synthetic
  `reference_trips` row, inserted and deleted (TEST restored). Standing TEST trips are
  sparse. One committed synthetic fixture (dense + `curatedMode=false` in one
  anon-readable trip) is wanted → `docs/BACKLOG.md`.
- **Browser-verification harness recorded to memory** — no `node_modules`/puppeteer
  by default in a fresh Conductor workspace; drive headless Chrome via raw CDP over
  Node's global `WebSocket`, reach the live `map` via a React-fiber walk, stage a
  dense trip as a temp TEST reference row.
- **This doc pass was STRANDED by the squash-merge and re-PR'd.** #192 merged as a
  squash (`bd39db4`), so the branch commits are not ancestors of `main` — checked by
  grepping origin/main for the actual symbols, not the PR banner. The panel-fix
  commit made the squash cut; this end-of-session doc commit did not, so it went out
  as its own docs-only PR. Lesson: after a squash-merge, verify late branch commits
  by CONTENT on `main` (`git diff origin/main HEAD`, two-dot), not SHA-ancestry.
- **DIAGNOSED then FIXED: day-detail places "not plotting" on PROD — a visibility
  interaction, not a broken layer (#194).** The symptom read as a dead layer. It was
  not: the source was populated, both symbol layers were in the style, and the
  filters passed — established by MEASURING **in-viewport vs rendered** feature counts
  (a Portland rest day: **8 pool in the viewport, 2 rendered** at zoom 8), not by
  inspecting code. Cause: fixed ~30px icons × a fixed zoom-8 fly-to too far out for a
  ~66px cluster × the pool's `icon-allow-overlap: false` declutter × DOM-marker
  occlusion. That in-viewport-vs-rendered measurement is what distinguished a
  visibility interaction from a data/filter failure — worth repeating whenever a
  layer "isn't showing."
- **Corrected the premise mid-diagnosis:** the handoff called b97d06bf day 3 a rest
  day; the exact `isRestDay` predicate (`start==end && miles==0 && corridorCities==0`)
  says day 3 is a round-trip (it drove); the real rest days are 4–11 `[queried PROD]`.
- **SHIPPED the fix (#194): day-bounds camera.** Fit the day's plottable PLACES
  (`placeBounds` sharing the one `isPlottableCoord` guard with
  `placesToFeatureCollection`), not endpoints (they degenerate to a point on rest/
  round-trip days) nor union (re-introduces the zoom-out). Rest day now z10.37 /
  10-of-10; dense day 2→124 (helps, doesn't solve — clustering is the follow-up).
  Guards + reasoning in `docs/architecture/map-day-render.md`.
- **Third synthetic-fixture insert+delete of the day** (`fit-test-tmp`) — the
  committed multi-shape fixture is now clearly wanted (`docs/BACKLOG.md`). Gotcha:
  synthetic `corridorCities` need `placeIds: []` or `classifyCuratedPicks` throws and
  the map never mounts.

## 2026-08-03

- **#184 shipped the day-insert UX** on top of #182's `splitDay` (which merged
  2026-08-01 wired to nothing). Kebab (Split this day / Add a rest day),
  BottomSheet split-point picker, `insertRestDay` layover, both actions behind
  `checkNotFrozen`, and an `isRestDay` "Nearby" render home. Position in
  `STATE.md`; mechanics in `architecture/itinerary-model.md` §6; follow-ups in
  `BACKLOG.md` §Day-insert. Adam merged it same day.
- **The priority finding, caught before ship: a rest day rendered nothing.** The
  suggestions were fetched, ranked, and stored, but the corridor view had no
  render home for a layover's non-curated tiles (no curated key stops, no spine to
  bucket under) — and "Explore more of Day N" does NOT surface them either (that
  endpoint runs a fresh live-discovery query and never reads `segmentSuggestions`
  `[grep: 0 refs in the trip-browse route]`). Verified by `renderToString`, not
  reasoning: **0/4 tiles → 4/4** after the Nearby block, against an unchanged 2/7
  normal-day control. This was exactly the artifact ("a rest day that shows
  nothing to do") we'd decided against.
- **CORRECTION — two checkpoints of render analysis were reasoned against
  `day-sidebar.tsx`, which is DEAD CODE.** I fixated on its `"0 mi | 0 hrs"`
  render as the rest-day surface problem across checkpoints 2–3; only on the UI
  checkpoint did I grep the mount and find `DaySidebar` (and `DayHeader`) are
  orphaned. **Lesson: confirm a component is mounted before reasoning about its
  render.** The live per-day miles stat is edit-only; view mode carries the
  semantic in the label.
- **CORRECTION — I reported a "blocker" that was a build step.** "No day-level
  kebab exists" is not a halt — creating one is implementation. The genuinely
  decision-worthy fork was narrow (revive the orphaned `DayHeader`, which drags
  rename/delete/reset + a `console.log` stub, vs. a new minimal kebab). I
  over-escalated a normal build decision into an A/B/C question.
- **CORRECTION — the overlay-rescope sequencing test was framed as guarding a
  live #182 hazard; for the rest-day op it guards a PRECONDITION.** `insertRestDay`
  never recomputes or clears existing days' `corridorCities`, so the "rescope over
  node-less days drops overlays" hazard cannot fire on that path. Re-labelled the
  test as a precondition guard so a future reader doesn't delete it as guarding a
  phantom.
- **`NEXT_PUBLIC_MAPBOX_TOKEN` is absent from `.env.development.local`** — split
  routing falls back to Haversine on every leg and reads as a code defect (a split
  whose halves carry null `driveHours` / no spine). Recorded in `CLAUDE.md`
  §RUNBOOK with the workaround (inject only the token from `.env.local`, keep TEST
  Supabase from `--env-file`) — cross-reference, not duplicated here.
- **Verified the four ageing BACKLOG items are still accurate** (MAX_IDS, the
  #176 request-size cap, the `placeId` badge gate, `USE_FEDERATED_POIS`): this
  session touched none of those paths, and the `USE_FEDERATED_POIS` gate in the
  trip-browse route reads exactly as recorded `[read source, 2026-08-03]`. No
  correction needed; not re-written.
- **TEST writes: temp UUID rows cloned from `expedition-ms28y793` by the two
  verify scripts, all self-cleaned — 0 leftover** `[queried TEST, 2026-08-03]`.
  See `DATA_INVENTORY.md`.

## 2026-07-31

- **Three PRs merged: #176 (chunking), #177 (de-link), #178 (planning region).**
  Verified on `origin/main` by grepping for the actual symbols, not by trusting
  the merge banner — #172 merged mid-correction on 07-28 and stranded a fix on
  its branch, so "merged" is checked, not assumed. Nothing stranded this time;
  #178's second, corrective commit is on `main`. Also merged **#175** on 07-30
  (the `mi off route` relabel), which no LOG entry covers.
- **The planning region is a constraint in code now, not a policy sentence**
  (#178). Codes from Mapbox's `context.region.region_code`, one constant module,
  no bounding box and no geo dependency. The region is checked in
  `validateExpeditionForm` and **dropped at `expeditionToGenerationInput`** — it
  never reaches the pipeline. Detail in `docs/STATE.md`.
- **CORRECTION — the Four Corners bbox error was MINE, not Claude Code's.** I
  asserted a six-state bounding box would leak into "western Colorado, most of
  New Mexico." That is wrong, and it is wrong in an embarrassing direction:
  **Utah's and Arizona's eastern border IS Colorado's and New Mexico's western
  border** (the Four Corners meridian, −109.045°), so a box over the six states
  contains essentially **none** of either. The real leakage is **Idaho
  entirely**, western Montana, western Wyoming, and a strip of Baja/Sonora — and
  Idaho alone is the stronger argument against a box, since it is exactly the
  neighbour a US-West trip planner would most plausibly be asked for. The
  argument survived; the evidence for it was fabricated. Recorded because the
  *conclusion* being right is what let a false premise stand unexamined.
- **CORRECTION — two of #178's verifications were vacuous, and I reported both
  as evidence.** Neither was a wrong measurement; both were measurements of
  nothing.
  - The **listbox-presence check** used a document-wide
    `querySelector('ul[role="listbox"]')` while destination **row 2 still had an
    open listbox** from a prior probe run. It would have read "present" even if
    row 1's listbox never rendered. The filtered-not-broken finding actually
    rests on `offered[0]` being row 1's option in DOM order — which held, so the
    conclusion stood on evidence other than the one I cited for it.
  - The **"no out-of-region error shown"** check ran against a form that was
    **never submitted**, and the error renders only behind `submitted &&
    validationError`. It was guaranteed to pass. In-region acceptance is covered
    by unit test; no browser observation established it.
- **CORRECTION — #177 shipped a UI change without anyone looking at it**,
  including an unrequested restyle of the `/trips` empty state that no brief
  asked for. Both surfaces were rendered and checked afterwards. A de-link is a
  content change, and a content change is a UI change.
- **The pattern under all three: an instrument scoped wider than the thing under
  test.** Distinct from the 07-28 lesson (validate the apparatus) — here the
  apparatus worked fine and the *query* pointed at the wrong element. Written up
  as a runbook line in `CLAUDE.md`.
- **CORRECTION — enumeration claims described a wider search than was run.**
  Several statements of the form "X has zero consumers" / "nothing else does Y"
  were made from a search narrower than the claim implied. Where re-run properly
  they held (the orphaned `${name}Lat`/`${name}Lng` inputs really do have zero
  consumers across both workspaces), but they were true by luck of scope, not by
  the search actually performed. **State the search that was run, then the
  conclusion — not the conclusion in language that implies a bigger search.**
- **`next build` is NOT a sufficient gate, and this cost a nearly-red CI.** A
  real type error in `planning-region.test.ts` (`RigProfile.groupSize` is a
  string; the fixture passed a number and forced it with `as`) sat behind a green
  `next build`. **CI runs `typecheck` as its own job** and would have failed.
  Corrected in `docs/STATE.md` §INVARIANTS. The same insufficient claim is still
  in `CLAUDE.md` §STANDING RULES — flagged, not edited.
- **A type predicate alone enforced nothing.** Making `isInPlanningRegion` a
  predicate to drop an `as string` looked like it moved an invariant into the
  type system. Mutation-checking it — delete the guard, expect a compile error —
  produced **no error**: the `.filter((s): s is Suggestion => …)` predicate
  launders the `.map()` callback's inferred return type. Annotating the callback
  is the load-bearing part. Without the mutation check I would have replaced a
  prose claim with a *more confident* prose claim.

## 2026-07-28

- **`MAX_IDS = 40` scoped and measured.** `alaska-south-final` scrolled end to
  end in a live browser with instrumented `fetch`: **19 requests, max 28 ids,
  zero windows over 40** (`yotrippin-demo` was sampled + simulated, not
  instrumented — it also stays under). The failures are single-day, not
  windowing: PROD
  `la-to-deadhorse` days 1/2/3/9 (**91**/57/57/42 distinct eligible) and
  `dawson-vancouver-cassiar` day 1 (42). Any window containing day 1 requests
  ≥91 cold, and a first request is always cold, so accumulation cannot rescue it.
  On day 1 all **51 dropped ids render as visible cards** — the day has zero
  curated tiles, so `curatedMode` is false and nothing collapses behind "Explore
  more". Recommendation: chunk server-side; do not raise the cap until someone
  establishes what 40 protected. Detail in `place-render-model.md` §4.4.1 and
  `BACKLOG.md`.

- **THREE CORRECTIONS from that pass — the more useful half of the session.**
  - **"The first hydration request on `la-to-deadhorse` drops 51 of 91" was
    WRONG.** Overview issues **zero** requests (`selectedDayId` is null without
    `?day=` → `hydrateDayIds` is `[]`); the 91 requires selecting day 1 first.
    Common, but not automatic, and it was stated as automatic. Caught by
    instrumenting `fetch` and watching 0 calls at Overview.
  - **The first pass simulated where measurement was available.** That part
    stands: with a browser open, the first attempt replayed sampled windows
    offline instead of instrumenting `fetch`.
  - **RETRACTED — the correction to that, written the same day, was itself
    wrong, and it reached the docs before being caught.** It read: *"the model
    was wrong — observed sum 203 against 142 distinct ids, an excess the model
    could not produce, because it treated accumulation as binary; reality is
    partial, ids resolving to `null` are re-requested every window, ≈43%
    overhead."* Re-measured at a realistic scroll speed (820–1200 ms per step
    rather than ~200 ms): **19 requests totalling exactly 142 ids against 142
    distinct, 0 aborted, 0 failed.** Every id resolved. **The simulation had been
    right** (it predicted 19 requests / 142) and the fast-scroll *measurement*
    was the artifact. The 203 came from the effect's `() => ctrl.abort()`
    cleanup cancelling in-flight requests during a scripted scroll faster than
    the network, so their ids were re-asked — a real behavior under flick-scroll,
    but nothing to do with null resolution.
  - **The lesson is not "measure instead of model."** It is that a measurement
    has an apparatus, and the apparatus can be the thing you are measuring. I
    distrusted a model because it disagreed with an instrument, without asking
    what the instrument was doing — and then wrote the instrument's artifact into
    three docs as a finding.
  - **Sampling at 0.5-viewport steps can skip transient mounted states.** The
    bias is conservative — a skipped window makes the next simulated request
    larger, not smaller — so "zero over 40" survives it. It went unstated.
  - Same shape as the near-miss inside the audit itself: inferring "dev has no
    `GOOGLE_PLACES_API_KEY`" from its absence in `.env.development.local`, when
    `next dev` also loads `.env.local` where the key lives. Probing the endpoint
    returned live Google data. An inference-shaped claim nearly shipped **while
    auditing inference-shaped claims**.

- **THREE MORE CORRECTIONS, found by re-reading the MAX_IDS work rather than by
  new investigation.** Two of them had already reached `main`; the third reached
  a PR body.
  - **"Two 19-day TEST trips scrolled end to end with instrumented `fetch`" was
    WRONG — one was.** `alaska-south-final` was instrumented;
    `yotrippin-demo` was window-sampled from the DOM and replayed offline. Both
    stay under the cap, so the conclusion held, but the headline figure came from
    one trip while being attributed to two — in a commit message, a PR body, and
    three docs. Fixed in #173.
  - **"React double-invokes effects in dev, which can add a mount-time
    request/abort pair" was WRONG for this repo.** `web/next.config.ts` sets no
    `reactStrictMode`, there is no `StrictMode` wrapper anywhere in `web/src`,
    and selecting a day issues exactly **one** hydration request
    `[measured 2026-07-28]`. The guess was written **inside the runbook entry
    about naming mechanisms without checking for them** — the lesson and its
    violation in the same commit. Replaced with the negative finding, since
    double-invoke is the obvious hypothesis and re-checking costs a measurement.
  - **"A dropped id is never in the cache to begin with" was WRONG.**
    `cacheStore` is keyed by `place_id` globally, so a dropped id may well be
    cached from an earlier window in which it survived the cut. The accurate
    statement is that it is never **looked up**: `parsePlaceIds` truncates before
    the handler consults the cache. (`place-render-model.md` had it right; only
    `BACKLOG.md` was wrong.)
  - **"Verified the remount empirically" — the conclusion held, the evidence did
    not.** The test called `history.back()` **in the same script** as the close
    click, so the resulting `/` could not be attributed to the close; it was
    marked `(observed)` in two docs anyway. Re-run with the close click alone,
    then the full cycle: open → select day 1 → **28 ids**; Close, nothing else →
    lands on `/` with a fresh document; reopen → select day 1 → **28 ids again**.
    `hydrated` does reset per open. Galling detail: that claim was written in the
    sentence *"verified rather than assumed, after last round's lesson."**
  - **#172 merged mid-correction**, taking `44c7f42` and stranding the fix on the
    branch, so `main` briefly carried two known-false statements. Recovered by
    cherry-picking onto a fresh branch (**#173**). Worth remembering that an open
    PR is not a safe place to park a known error — land the correction or say so
    in the PR before it can be merged out from under you.

- **WHAT THE DAY ACTUALLY DEMONSTRATED — the sharper finding.** Across three
  re-analysis passes over the MAX_IDS work, **every payload count held** — 91 /
  57 / 57 / 42 distinct eligible ids, `24f14ecc` at exactly 40, 51 dropped,
  zero-windows-over-40, 0 of 51 carrying a stored rating. Not one number moved
  under repeated scrutiny.
  **Every single error was a claim about MECHANISM or PROVENANCE:** "ids resolve
  to null" (it was request abort), "React double-invokes" (not in this repo),
  "never cached" (it may be — it is never looked up), "two trips instrumented"
  (one was), "observed" (confounded by my own `history.back()`).
  That is a more useful diagnosis than "we made mistakes": the counting
  discipline this project has built is working, and the failure has moved
  entirely to *why* and *how we know*. Both new `CLAUDE.md` runbook lines exist
  for that — validate the apparatus before trusting the instrument, and don't
  name a mechanism you haven't checked for.

- **The stale example this replaced had propagated to two docs**, both corrected
  in place: `BACKLOG.md`'s entry and `place-render-model.md` §4.4 both claimed
  *"`24f14ecc` carries 41 tiles on day-1 alone, so a ~3-day window exceeds 40."*
  `24f14ecc` has **2 days** — a ~3-day window cannot exist on it — and 41 is its
  `placePool` count, not the hydration-eligible set. Its true figure is **exactly
  40 distinct trip-wide against a cap of 40**: nothing dropped, but a boundary
  rather than a margin.

- **`GOOGLE_PLACES_API_KEY` confirmed set in Vercel Production**
  `[confirmed via Vercel dashboard, 2026-07-28]`, so the accumulating path is
  production behavior and the TEST measurements are representative.

- **CORRECTION, superseding the 2026-07-26 bullet "No PROD trip is affected —
  zero stored miles anywhere on PROD".** That is false as of today.
  `[queried PROD 2026-07-28, read-only]` **Three generated trips now live in PROD
  `public.trips`, all created today**, all carrying stored `milesFromStart`:
  `a54c5c65-…` (774 tiles), `cefc94e0-…` (552), `7e3e088a-…` (776). **18 curated
  tiles sit beyond their own day's `miles`, up to ×2.3** — day 1 of `a54c5c65-…`
  is a 268-mile day whose spine reached **626mi**. The mile defect is therefore a
  live production defect, not a TEST curiosity.
  - **The earlier bullet was not wrong when written** — it quantified over a table
    that held no generated rows at the time. Nothing re-checked it when generation
    began writing to `public.trips`. A bare row count is the claim that goes stale
    silently, which is the second time this shape has bitten (cf. the corpus-ADR
    `enqueueResolvedPlaces` "zero callers" correction, 2026-07-27).
  - **It had propagated to two other places**, both corrected in place rather than
    overwritten: `lib/corridor/stretches.ts`'s deletion-precondition block and
    `docs/architecture/generation-pipeline.md` §7.4. The `stretches.ts` copy was
    the dangerous one — it was the stated basis for deleting
    `positionPlacesOnDay`, and [#170](https://github.com/honkinsickle/overlander/pull/170)
    has just made that function load-bearing, so acting on it would have deleted
    the thing that fixes the bug.
  - **What still holds:** `dawson-vancouver-cassiar` (FROZEN) remains unaffected —
    417 tiles, 0 stored miles. The frozen-trip risk still does not exist.

- **CORRECTION to [#166](https://github.com/honkinsickle/overlander/pull/166) —
  "identical, including the per-day distribution" was FALSE.** The PR body and the
  commit message both claimed the pre- and post-deletion generations were
  identical. **The totals matched at 20; the distributions did not**
  `[re-measured 2026-07-28]`:
  - `ea1f51f7` (pre-4b baseline): 20 tiles, per-day **4 / 4 / 4 / 4 / 4**
  - `b67680c0` (post-4b): 20 tiles, per-day **4 / 3 / 5 / 4 / 4**

  **How it happened:** the verification script printed the per-day breakdown for
  the NEW trip only. There was **no per-day data for the baseline at all**, and
  the match was asserted anyway. Same failure mode this project keeps hitting — a
  conclusion stated with more confidence than the evidence carried — committed, in
  this instance, inside a PR whose stated purpose was rigor about that very
  number.

  **What survives:** the CONCLUSION of #166 still holds. Totals matched exactly,
  group 4 demonstrably did not thin the trip, and the deleted suggestion modules
  were never in the expedition path (`buildDaySuggestions` had one caller,
  `lib/plan/actions.ts`, itself deleted). It is the CHARACTERIZATION of the
  evidence that was false, not the finding.

  **[#167](https://github.com/honkinsickle/overlander/pull/167) contradicts #166
  on this point, and #167 is the correct one.** It argues run-to-run variance from
  the fact that "the two baselines already differ in shape from each other" —
  which is true, and which is precisely what makes #166's sentence wrong. Read
  #167.

  Recorded rather than rewritten: #166 is merged, and this repo's convention (see
  `docs/decisions/2026-07-23-corpus-writeback-dormant.md`) is a dated correction
  over an edited history. The PR body and commit message are left as they are.

- **The runbook lesson written in #166 was itself under-generalized, and is
  widened here.** It told the next person to "search the whole of `web/`" — one
  rung up from the "search `web/src`" mistake that caused the break, and still
  wrong for the same reason. **This is a multi-workspace repo and the gates are
  per-workspace:** `cd web && npx next build` does not run `data/`'s
  `tsc --noEmit`, so a deletion that breaks `data/` passes the gate the runbook
  names and fails elsewhere. Verified `data/` references none of the modules 4b
  deleted `[grep]`, so nothing was actually broken — the lesson simply would not
  have prevented the next instance. `CLAUDE.md` §RUNBOOK now enumerates the
  workspaces and their gates.

- **Swept `STATE.md` and `BACKLOG.md` for other counts that drift the same way.
  Nothing is currently stale**, so nothing was changed. Both checkable claims
  re-verified: `ensureAlaskaUpgraded` still has exactly **4** call sites
  (`repository.ts` 103/117/129/190) `[grep]`, and the auth-method sweep
  (`signInWithPassword`, `signInWithOtp`, `signUp`, `verifyOtp`,
  `resetPasswordForEmail`, `signInAnonymously`) still returns **zero hits** in
  `web/src` `[grep]`. `BACKLOG.md`'s ratios are pinned to named, frozen artifacts
  (`expedition-ms28y793`, PROD `24f14ecc…`), which is what makes them safe — the
  denominator can't move. The one genuinely drift-prone figure is **"PROD has 7
  such draft rows"**: it is a live DB count, it is now MORE fragile because 4c
  established drafts are still creatable (`duplicateTrip`, `setTripState`, the DB
  default), and it **cannot currently be re-measured** — the Supabase access token
  is revoked and no PROD credentials exist locally. Treat it as last-known, not
  current.

- **The wizard swap finished: [#167](https://github.com/honkinsickle/overlander/pull/167)
  and [#168](https://github.com/honkinsickle/overlander/pull/168) merged.** 4a
  de-linked, 4b deleted the routes and legacy-only modules, 4c unwound the
  trips-domain residue (`createUserWizardTrip`, `writeWizardSlice`,
  `UserTripSummary.wizardStep`, `Trip.wizard`). The expedition wizard is now the
  only creation path in the codebase. `main` at `86e3acf`.

- **Repo hygiene: 52 merged local branches deleted, 2 stale remote-tracking refs
  pruned.** Done with `git branch -d` rather than `-D` on purpose — that makes git
  itself the guard, so a branch that isn't fully merged cannot be removed by a
  filtering mistake. One branch (`feat/manual-trip-edit`) was refused because its
  *upstream* sat a commit behind it; confirmed an ancestor of `main` before
  forcing, so nothing was lost. **`fix/generated-day-miles` was excluded
  deliberately** and still has no PR — parked on a real decision (fix `bake.ts` vs
  project on the read path), not forgotten.
  - Worth keeping: the first pass computed merged-status against a `main` that was
    **six commits stale**, because #167 and #168 merged mid-task. Acting on that
    list would have spared two branches that were in fact merged. Fetch before you
    classify — "merged" is a claim about a moving target.

- **A premise I asserted was wrong, and the code said so.** I recorded that
  `createUserWizardTrip` was *likely the only writer* of `state='draft'`, implying
  drafts might become uncreatable once 4b deleted it. **Three live paths remain** —
  `duplicateTrip`, `setTripState`, and the DB default `[read source]`. Now in
  `docs/BACKLOG.md` §"Draft trips after the wizard swap", with the consequence:
  nothing branches on `state === "draft"` any more, so drafts stay creatable while
  nothing consumes them *as* drafts. A loose end to decide, not a bug to fix.

- **The #166 false claim was caught by re-audit, not by review.** Nobody
  challenged the "identical, including the per-day distribution" sentence — it
  surfaced only on a second pass re-reading this session's own output against the
  measurements. Two things follow. **The correction convention held:** a dated
  entry (above) plus a superseding section in `generation-pipeline.md` §9, with
  #166's body and commit message left intact — same posture as the
  corpus-writeback ADR. **And the failure mode is the durable lesson:** a
  verification script that prints one side of a comparison invites you to assert
  the other. Print both sides, or claim only what was measured.

- **The run-to-run variance baseline now has a home:**
  `docs/architecture/generation-pipeline.md` §9. Three generations of the
  byte-identical form — 20 tiles at `4/4/4/4/4`, 20 at `4/3/5/4/4`, 21 at
  `4/5/4/5/3`. Two agree on the total and disagree on the shape, which is what
  makes it evidence: **identical input does not produce an identical trip**, so a
  future shape difference is not prima facie a regression. It went in the pipeline
  doc rather than `place-render-model.md` because that file's tile-count caveat is
  about *disjoint instruments*, whereas this is the *same instrument regenerated*
  — a different question about the same numbers.

## 2026-07-27

- **The wizard swap went from "decided, not started" to fully merged in one
  session — five PRs
  ([#159](https://github.com/honkinsickle/overlander/pull/159),
  [#160](https://github.com/honkinsickle/overlander/pull/160),
  [#161](https://github.com/honkinsickle/overlander/pull/161),
  [#162](https://github.com/honkinsickle/overlander/pull/162),
  [#163](https://github.com/honkinsickle/overlander/pull/163)).** Auth gate →
  owned-row write target → root CTA → de-link legacy → remove the TEST-only rail.
  Deliberately sequenced so nothing was deleted while the replacement was
  unproven: #162 removed the *links* to the legacy wizard while leaving the route
  working, which is what makes the eventual teardown reversible-by-inaction.

- **#163's real finding: the TEST-only rail was doing two jobs, and only one of
  them had expired.** The brief's premise — that #159/#160 made the rail obsolete
  because the trip write is now session-scoped and RLS-enforced — was verified
  correct *for the trip write*. But `enqueueResolvedPlaces` is still a
  **service-role write to a shared curated table** (`upsert_source_record` →
  `source_record`, SECURITY INVOKER, RLS on with **zero policies**), and its blast
  radius was unchanged. Deleting the rail wholesale would have silently converted
  every prod generation into an unreviewed write to prod curated data —
  contradicting `ingest.ts`'s own docstring (*"a PROD corpus write would need a
  SEPARATE deliberate gate"*). **The gate moved to that call site instead of being
  deleted.** Lesson worth keeping: *"this guard is obsolete"* is a claim about a
  specific code path, not about the guard — enumerate every path it covers before
  removing it.

- **Verified the PROD env rather than accepting the report — and one worry turned
  out to be unfounded.** `[vercel env ls production]`: `ANTHROPIC_API_KEY` is
  **missing** (the one real blocker to a first PROD generation), but
  `GOOGLE_PLACES_API_KEY` **is set** (49d, Preview+Production). So the feared
  interaction with the silent-degradation defect **does not apply** to the first
  PROD generation. Also confirmed the flag positively rather than by assertion:
  `/plan/expedition` on the public alias returns **307 → sign-in**, and with the
  flag off that path 404s (`notFound()` runs first) — so the redirect proves both
  the flag and the auth gate. `/plan` still mints a draft on PROD, by design.

- **A dev-facing error string is reaching production users.** `generate.ts:60`
  throws *"ANTHROPIC_API_KEY is not set — add it to `web/.env.local` to run
  generation."* The action returns that verbatim as `{ ok: false, error }` and the
  wizard renders it, so the first PROD user to hit generate is told to edit a file
  that does not exist in their browser. Three sibling throws produce three
  different strings for the same condition. Filed, not fixed — this pass was
  docs-only.

- **`mvum_roads` brought into line with the other reference tables — RLS enforced
  on TEST and PROD ([#154](https://github.com/honkinsickle/overlander/pull/154)).**
  It was created by `20260603010000_phase2_mvum_corridor.sql` without
  `enable row level security`, while `master_place`, `source_record`,
  `place_match`, `legality_overlay` and `field_precedence` all enable it, and no
  later migration picked it up. Migration `20260727120000_mvum_roads_rls.sql`:
  RLS on, **zero policies**, plus explicit revokes on the table and on
  `upsert_mvum_road`.
- **Zero policies is correct because every consumer is service-role.**
  `data/ingestion/lib/db.ts` (`getDb()` → service-role key), `mvum:load`, and
  `recompute_master_place` — which reads `mvum_roads` and is SECURITY INVOKER,
  but is only ever called from that same service-role path. Nothing in `web/src`
  reads the table (`mvumCorridor` there is a derived `master_place` column). Same
  posture as `reference_trips`' write side.
- **Migration-authoring lesson: revoking function EXECUTE needs BOTH forms.**
  Two mechanisms can grant it and a revoke only clears the one it names —
  Postgres' default grant to `PUBLIC`, and explicit per-role grants visible in
  `pg_proc.proacl`. `revoke … from anon, authenticated` misses the first;
  `revoke … from public` misses the second. Our two projects differed in exactly
  that way, so each form alone was a silent no-op on one of them — a revoke
  against a grant a role never individually held succeeds and changes nothing,
  with no error. Do both, grant back to the one role that needs it, and **verify
  against `pg_proc.proacl` rather than trusting the DDL**. Two successive drafts
  of this migration read as correct and were not; post-apply catalog checks are
  the only reason that was caught.
- **Proofs on TEST, both green.** `mvum:load --dry-run` → 371 features / 308
  routes / 0 errors. `recompute_master_place` smoke → `mvum_corridor` stayed
  `true` on a dispersed-camping place. That is the sharp assertion: the value is
  *derived from the `mvum_roads` read*, so it would have flipped to `false` had
  RLS blocked it. Proving the value survived beats asserting "no error raised".
  Not run against PROD by design.
- **`mvum:load` with no `--bbox` fails on TEST for an unrelated pre-existing
  reason** — `ingestion_corridor` is empty, so `resolveCorridorFilter` aborts
  before reaching `mvum_roads`. Not an RLS regression; the code comment
  anticipates it ("e.g. fresh database"). The documented `--bbox` form runs fine.
- **Applied via the Supabase Management API, not `supabase db push`** — Docker is
  not installed on this machine and both `db push` and `pg_dump` require it. The
  `supabase_migrations.schema_migrations` row was written by hand on both
  projects so the migration history is not left out of sync with the file.
- **Noticed in passing, not investigated: PROD's migration history is missing
  `20260723120000_google_resolved_field_precedence`, which TEST has.** Recorded
  because a history gap between the two projects goes unnoticed until it bites.
- **End-of-day doc pass — STATE reconciled from five PRs of staleness.** The
  previous STATE carried a "stale below this line" marker covering #146–#150; that
  is now discharged and the file rewritten to actual position from `gh pr view` +
  `git log` rather than carried forward. **#153 turned out to still be open** — I
  had assumed it merged with the rest, which is exactly the kind of thing the
  marker existed to prevent. (It landed later the same session, rebased onto main
  after #155; the cross-links marked provisional at the time are now live. The
  assumption is recorded because it was wrong when made, not because it stayed
  wrong.)
- **Decision: generation will require sign-in, and the legacy wizard is replaced
  rather than migrated** —
  `docs/decisions/2026-07-27-generation-requires-sign-in.md`. **Blocked, not
  started.** Google OAuth is the only wired sign-in method; TEST has no Google
  provider and PROD's is disabled, so gating generation on sign-in makes the
  primary creation path unreachable in dev without a hand-minted cookie and
  unreachable in prod outright. Note `app/trips/layout.tsx` already carries its
  user gate commented out for the same reason — the two gates should move
  together. Sequence + ordering constraint in `docs/BACKLOG.md` §Wizard swap.
- **Swept `docs/decisions/` for stale factual claims: 7 of 12 records carry at
  least one.** Only the corpus-writeback ADR was corrected; the rest are recorded
  in `docs/BACKLOG.md`, not fixed. The pattern worth naming: **a record that says
  "verified, still true on `main` <sha>" is the one most likely to be trusted
  without re-checking, and therefore the most dangerous when it ages.** The worst
  offender asserts there is no windowing anywhere in the trip components; Design A
  shipped the next day as #146.

### Retractions — three claims that did not survive checking

Recorded because each cost real time, and the record is more useful with them
than without.

- **The "population of dead placeIds" did not exist.** Inferred from a cache that
  stores `null` on failure for 15 minutes, so one transient upstream blip replays
  as a permanent dead id for the rest of the window. Measured properly:
  **103 of 104 resolved.** The lesson is already in CLAUDE.md — re-measure after
  the TTL before calling an id dead.
- **The RLS drift did not exist.** A previous session reported that live policies
  diverged from migrations on three tables, on the strength of `anon` reading rows
  that `authenticated` could not. The live catalog says otherwise: **policies match
  migrations exactly on both projects, grants are identical across roles, and there
  is no structural drift.** The entire anomaly was **one misconfigured env var** —
  the "anon" probe client was built from a key that was actually a secret key, so
  it ran as service-role and bypassed RLS, while the "authenticated" client used a
  real JWT and was correctly denied. `SET ROLE anon` / `SET ROLE authenticated`
  settles it in one query and returns identical results. **The durable lesson: a
  probe is only as trustworthy as the identity it ran under** — role-differentiated
  behaviour was reported across four turns without once checking `current_user`.
  Full retraction: `docs/architecture/trip-resolution.md` §"The RLS drift that
  wasn't"; it is now also a STATE invariant.
- **The day-mile fix's magnitude was overstated by roughly 16×.** It was scoped as
  though the `where === "keyStop"` via filter would remove most of the geometry
  inflation. Measured, it removes **~6%** (2.25× → 2.18× vs the direct line) — the
  dominant term is key-stop vias being genuine off-route excursions in LLM emission
  order, which the filter does not touch. The branch is parked on that measurement
  rather than on a guess, which is the right outcome; the cost was scoping it first
  and measuring second.

All three share one shape: **a conclusion reached by inference from a partial
signal, stated with more confidence than the evidence carried.** The corrective in
each case was cheap and available up front — re-measure after a TTL, check
`current_user`, compute the delta before scoping the fix.

## 2026-07-26

- **Generation (the WRITE path) traced end to end for the first time
  ([#151](https://github.com/honkinsickle/overlander/pull/151), open).** New
  `docs/architecture/generation-pipeline.md` rather than a third section of
  `place-render-model.md` — that doc is scoped to the READ path and generation
  shares almost no code with it. Cross-linked both ways; trip-shape facts stay
  in `itinerary-model.md` §7, not duplicated. Read-only: no trip generated, no
  LLM called, no failure induced, nothing written.
- **`day.weather` is a fabricated field in user-visible UI.** It is a `required`
  property of the LLM's output `json_schema`, the prompt payload carries no
  weather input, `auditItinerary` spreads it through untouched, and an
  exhaustive sweep found **no weather or climate source anywhere in the repo**
  (source, 3 × package.json, 15 × .env*, 38 migrations, every external hostname
  literal, every local dataset). It renders under a WEATHER heading carrying
  specific Fahrenheit ranges — observed in-browser on TEST: *"Arrive · Hot
  desert, 95–105°F"*. The schema docstring, the prompt, and the `FactConfidence`
  union all call weather "advisory", but that tag is only ever attached to
  `distanceConfidence` — nothing marks weather advisory in the payload or the UI.
  Parked in `docs/BACKLOG.md`.
- **The temp pill is a DIFFERENT origin, and is dead code.** Nobody had checked
  whether the two shared a source; they don't. `weatherHiF`/`weatherLoF` are
  hardcoded `70`/`45` literals in `itineraryToTrip` — identical on every
  generated trip regardless of route, season, or latitude — but the only
  component that renders the pill, `TripDetailHeader`, has **no call site**
  (superseded by `DayDetailOverview`). Confirmed in-browser: no hi/lo pill on
  any live surface. So the handoff's premise that a pill "appears in the
  day-detail header" did not survive checking.
- **Generation never asks Google for rating/photo/price/hours.** `RESOLVE_FIELD_MASK`
  (searchText, by name) and the render-time `DETAILS_FIELD_MASK` (details, by id)
  are both server-fixed constants but disjoint in exactly those fields. That is
  the *upstream* cause of essentials-only tiles — not a stripping step later, as
  the shape record alone might suggest.
- **Corpus fold ∪ tier-2 is a true union with no cross-source dedup.** Precedence
  lives one stage earlier as the audit's pool-first grounding. Consequence in
  stored data: day 6 of `expedition-ms28y793` persists the same `placeId` twice
  (endpoint-resolved + keyStop-resolved), and that id appears twice in a node's
  `placeIds` — the "renders twice" failure mode `node-identity.ts` documents as
  its intended-safe outcome, occurring for real.
- **Nothing about the audit survives persistence.** `AuditReport` and per-day
  `DayAudit` are both transient, so a dropped key stop leaves **no trace in the
  payload at all** (`SILENT_FLAG_KINDS` also hides it from `notes`). Six
  generated `ItineraryOutput` sections (`routeSummary`, `phases`, `variants`,
  `permits`, `borders`, `anchorsHonored`) are generated, paid for, and dropped.
- **Audit failure is advisory, not blocking** — after `REGEN_BUDGET = 2` the trip
  persists with structural violations and a soft note. The largest silent
  degradation found: a missing `GOOGLE_PLACES_API_KEY` makes every tier-2 name
  drop while the action still returns `ok: true` (44 of 48 tiles on the
  instrument came from tier-2).
- **The day-mile fix was built, measured, and PARKED — the measurement is why.**
  Branch `fix/generated-day-miles` (pushed, unmerged, no PR). Rebuilding all
  three per-day lines with `routeBetween` on `expedition-ms28y793`: direct
  **899 mi**, corrected (keyStop vias only) **1,960 mi**, old (all resolved
  vias) **2,019 mi**. So filtering vias to `where === "keyStop"` removes
  **~6%** of the inflation, not most of it — day 6 is the only day it
  materially changes. The dominant term is key-stop vias being genuine
  off-route excursions threaded in LLM emission order. A backfill would have
  written miles measured against a still-2.18×-inflated line, so it was not
  run and nothing was written.
- **The map was never affected — checked because it would have changed the
  priority of everything.** `routePolyline` is the audit's DIRECT geometry;
  `BakedDay` has no polyline field and the re-routed line is a discarded local.
  Stored polyline measures 899 mi, matching direct exactly. The zigzag is
  transient.
- **Two separate defects fell out and are now in BACKLOG.** (a) `routePolyline`
  omits ~25% of the trip — 899 mi drawn vs 1,200 mi claimed, because
  `isOutAndBack` never routes a start==end day (6 of 15 days, 300 mi). This one
  IS visible on the map. (b) 30/48 tiles belong to no node; re-bucketing on a
  corrected line only reaches 17/48, because `maxAttachMi = 25` against node
  gaps up to 148 mi, and round-trip days derive both nodes at mile 0. The
  remaining 17 are structural — no mile fix reaches them. The 63% figure had
  sat in a baseline for two sessions unexamined.
- **The read path already does it right.** `positionPlacesOnDay` projects onto
  the correct 899-mi polyline with a round-trip-aware offset. Three consumers
  use it and are correct; four trust stored miles and are wrong. Pointing the
  four at what the three do needs **no write** and fixes existing trips — an
  option that was never priced, now recorded rather than skipped by default.
- **No PROD trip is affected** — zero stored miles anywhere on PROD, including
  the FROZEN `dawson-vancouver-cassiar` (417 tiles, 0 miles). The frozen-trip
  risk that shaped the earlier scoping does not exist.
- **Three unmeasured claims of mine were caught this session, all the same
  shape** — stating a magnitude without computing it: "A3/A4 will pass" (they
  failed, and A4 failing is the zigzag's own signature, which my own report had
  already measured two sections earlier); "A6 will flip after the bake fix" (it
  reads stored data, so it cannot); "residual inflation is much smaller" (it is
  2.18× vs 2.25×). Recorded because the pattern, not any one instance, is the
  thing to watch.
- **Recorded fragments checked against source.** Four verified correct (bake.ts
  union + uncapped, the 30-cap's real owner, the corpus mapper's
  `placeId`/`source`, `resolvedToTile`'s `google:` prefix). Two corrections: the
  recorded pipeline omits `attachHeroPhotos` (a network call that mutates the
  payload before persist) and `enqueueResolvedPlaces` (after persist); and the
  tier-2 cap is **not** `RESOLVE_CAP = 15` — the audit constructs
  `PlaceResolver(Math.max(80, days * 8))` = 120 for a 15-day trip.
- **Trip creation's CLIENT half traced — new
  `docs/architecture/trip-creation-surfaces.md`.** Companion to
  `generation-pipeline.md` (#151, now merged), which covers only the server. Read-only,
  and deliberately never submitted the form: every claim about in-flight state,
  errors, and the landing is static code analysis, with no duration estimated
  anywhere.
- **The headline: no degradation signal reaches any component.** The action
  returns `{ ok, tripId, days, note? }`; `ExpeditionWizard.submit` destructures
  `ok`/`error`/`tripId` only, so `note` and `days` are computed, returned across
  the server-action boundary, and dropped. Worse, `note` keys off `unresolved`
  (surviving structural violations) — so the **no-`GOOGLE_PLACES_API_KEY` case
  sets no signal at all**, not merely an unread one. And there is no toast /
  banner / alert system anywhere in the repo (no library, four `components/ui/`
  primitives, root layout mounts no provider), so there is no host component to
  hang one on.
- **The expectation was inverted: the LEGACY 5-step wizard is the live one.** It
  is behind **no** feature flag and is fronted by the root page's primary CTA
  ("Create a Trip" → `/plan`), plus the `/trips` empty state and draft-card
  deep-links. The newer expedition wizard is flag-gated (404s without
  `ENABLE_PLANNER_WIZARD`) and has **zero** links anywhere — URL-only. Also: the
  anon `TRIPS` path is **not** a third surface, it is the anonymous branch of the
  legacy wizard's `finalizeTripAction`.
- **A generated trip is neither editable nor findable.** `canEdit` is
  `isUserTrip(id)`, a UUID regex; the minted id is `expedition-<base36>`, a slug
  → `canEdit === false` on both serving routes. And it is written to
  `reference_trips` while `listUserTrips` queries `trips` and `listAnonTrips`
  filters `trip-` — so it appears in **no listing on any surface**. The redirect
  URL is the only route back to it.
- **One timeout exists in the whole generation call chain, and it is not on the
  LLM.** `AbortSignal.timeout(8000)` on the Google Places fetch in `resolve.ts`
  is the only hit; the Anthropic call, `preComputeFacts`, and the upsert have
  none, and there is no `maxDuration` export. `REGEN_BUDGET = 2` is a quality
  re-prompt loop, not an error retry.
- **Recorded fragments checked: 5 held, 3 were wrong.** Wrong: the in-flight
  label is "Generating your expedition…" — `Rendering` has **zero** occurrences
  repo-wide; the date-field claim is half wrong (the hidden inputs are *dead* on
  this path and the wizard *does* contain a native `<input type="date">` for
  per-destination FIXED dates); and "prod never sets `ENABLE_PLANNER_WIZARD`" is
  stronger than the evidence — no `vercel.json` exists and dashboard env vars
  aren't in source, so prod's value is UNVERIFIED.
- **A subagent's "there is no Next.js middleware" was caught wrong by the build
  gate.** Next 16 renamed `middleware.ts` → `proxy.ts`; `web/src/proxy.ts` exists
  and runs on every navigation (the build prints `ƒ Proxy (Middleware)`). Its
  body is only `updateSupabaseSession` — no gating — so the conclusion held but
  the evidence didn't. Recorded in the doc so the same grep doesn't mislead
  again.
- **Dead code + misleading copy found in passing (not fixed).** `OffCacheBanner`
  is rendered nowhere — the identifier appears only in its own definition and two
  doc-comments. And the wizard's "Saved on the vehicle — reused across trips."
  overstates an in-memory garage that resets on restart; there is **no**
  user-facing copy anywhere warning that anon trips are ephemeral (every hit for
  "temporary/unsaved/will be lost" is a developer comment).

## 2026-07-25

- **Reference trips now serve DB-first — the fixture no longer shadows the DB
  ([#143](https://github.com/honkinsickle/overlander/pull/143), open).** Fixed the
  docs-say-DB-first / code-was-fixture-first contradiction. Phase 1: migrated
  `la-to-portland` (a demo trip that lived only in the in-code fixture) into
  `reference_trips` as a raw pre-derivation payload via an idempotent script,
  seeded on TEST **and PROD**. Phase 3: `getTrip` is DB-first + reader-aware —
  `la-to-deadhorse` keeps `getReferenceTrip` (snapshot fallback + memo, so the
  live PROD trip doesn't regress); other reference slugs use
  `getPersistedReferenceTrip`; anon trips resolve last.
- **The find that stopped Phase 4: `TRIPS` has TWO roles.** Beyond the reference
  fixtures it is the LIVE anon-wizard trip store (`createTrip` at
  `plan/actions.ts:786`, `listAnonTrips`, the slug-write paths). Deleting the
  module would break the anon wizard — so fixture *deletion* was deferred to
  backlog, not executed as the spec literally said. Ship Phase 1+3; residual
  state documented in the PR.
- **(e) proof discharged before touching anything deletable** — the DB payload
  for la-to-deadhorse is baked and carries every `LA_TO_DEADHORSE_RAW` day
  override (heroImage/label), 0 mismatches on TEST and PROD. `getReferenceTrip`
  and `getPersistedReferenceTrip` apply the identical `withCorridors(fold(...))`
  pipeline, so the reader-aware split adds zero derivation divergence.
- **PROD write, proven not asserted:** reference_trips 2 → 3 rows (exactly one
  added), `dawson-vancouver-cassiar` payload sha256 `46a17cbb421208f7` byte-
  unchanged before/after (frozen trip untouched), la-to-portland deep-equals the
  fixture literal.
- **Corrections caught by reading source (not assumed):** (1) "la-to-portland
  leaves the anon /trips list" is FALSE — `listAnonTrips` filters
  `id.startsWith("trip-")`, so reference fixtures were never in that list. (2)
  `ensureAlaskaUpgraded` has 4 *other* callers (waypoint helpers) besides
  getTrip — deleting it is not a one-liner; backlogged with the removal.
- **Federated fold on la-to-portland (TEST): runs but adds 0 tiles** — the TEST
  corpus footprint (LA→Deadhorse corridor) doesn't overlap the LA→Portland route.
  Convergence is structural (same pipeline now); visible payoff is corpus-
  coverage-dependent. Accepted trade-offs: fold-as-convergence, 404-on-DB-failure.
- **Design-A continuous day-scroll: scoped hard, then put on hold.** A full
  read-only scoping + self-falsification pass ran (windowing primitive =
  IntersectionObserver, map stays one shared instance, hydration re-key,
  scroll↔`?day=` settle-debounce with max-wait, dead-zone hysteresis). Not built
  — the fixture-shadow cleanup preempted it. No code; findings live in the
  session transcript for when it resumes.
- **#143 and #144 both merged.** (Corrects the "open" on the first bullet —
  append-only, so noted here rather than rewritten.)
- **Process lesson — a doc commit pushed AFTER the merge was in flight got
  orphaned.** `trip-resolution.md` was committed one commit *after* #143's merge
  point, so it never landed on `main`; merging #143 auto-deleted the branch, and
  the later push *re-created* it as a stray branch stranding the doc there.
  Recovered via #144 (cherry-picked the doc onto a fresh branch + synced STATE's
  now-stale "OPEN" → "MERGED"). Takeaway: once a PR is merging, don't push more
  commits to its branch — open a follow-up.
- **Doc placement corrected to the taxonomy (#144 + the session doc-pass).**
  Premise-checked first (no existing architecture doc overlaps
  `trip-resolution.md`, so it earns its own file). Then split single-homed: the
  `reference_trips` RLS + per-DB row inventory → `DATA_INVENTORY.md`; the three
  payload shapes → `itinerary-model.md` §7 (where the scroll work gets bitten);
  cross-linked all three both ways; recorded the bidirectional dependency so the
  fixture-removal backlog item knows it must update `trip-resolution.md`.
- **Cleanup:** landed the long-floating "plotting-on-map architecture" BACKLOG
  edit (stashed across the whole migration) as #145; deleted the merged
  `docs/trip-resolution-and-state-sync` and the stray
  `refactor/reference-trips-db-first` branches (local + remote).
- **Tooling:** installed the Superpowers plugin (`superpowers@claude-plugins-official`
  v5.1.0, user scope). The CLI install was blocked by the permission classifier;
  ran from the terminal instead. Plugin skills load at session start, so it's
  active next session, not this one.
- **Built the continuous day-detail scroll (Design A, view mode) —
  [#146](https://github.com/honkinsickle/overlander/pull/146).** The day-detail
  center is now a continuous river of days when NOT editing, not a one-at-a-time
  swap. New `ContinuousDayStack` IO-windows the near-viewport days; scroll writes
  `?day=` settle-debounced (140ms) with a 400ms max-wait; the one shared map
  follows on settle (settle-only `?day=` write ⇒ settle-only flyTo, for free).
  Hysteresis (±15% vp) + measured-height cache make unmount height-neutral.
  Re-verified the handoff's `[RECHECK]` claims against `main` first (all held).
  **Falsification catch that shaped it:** `placeOverrides`/`ranks` drive pin +
  cluster order in VIEW mode (no editMode guard), so every mounted day gets
  server-truth values while the optimistic drag machinery stays out —
  "values cross the bridge, machinery does not." `editMode` + Overview keep the
  VERBATIM single-day swap (the bridge; PR2 deletes it). Presentation-only fence
  held (zero model-file diff). Verified in the slideup on `la-to-deadhorse` (66d)
  + `yotrippin-demo` (19d): windowing, cached-height no-jump, rail-click
  programmatic guard, Overview flush-guard (the guard stops the unmount flush from
  resurrecting a day when you leave to Overview — a bug I hit and fixed).
  Edit-mode + saved-pins-in-view were NOT exercised end-to-end (needs an authed
  UUID trip / a trip carrying overrides) — verbatim render + server-truth wiring
  cover them by construction. Decision:
  `docs/decisions/2026-07-25-continuous-day-detail-scroll.md`; §4 of
  `docs/architecture/itinerary-model.md` updated.
- **#146 review round: the "by construction" shortcut above was called, correctly.**
  Review demanded the authed verifications. Ran them on a fresh editable 66-day
  TEST fork (`05b346df…`, forked in-app as seed-owner; the handoff's `762577ca…`
  fork is PROD — substituted, flagged). Results: edit-mode bridge PASS (mid-scroll
  toggle lands the swap on the centered day, not the stale `?day=`); freeze PASS
  byte-level (only `["day-2"]` of 66 days changed on a real add); authored order
  PASS in the view stack. **Upward-scroll jump FOUND+FIXED**: first-mount
  estimate→measured deltas were uncompensated (cache had no prior entry) — 366px
  jumps scrolling UP through never-mounted days; fixed by seeding the height cache
  with the rendered estimate + above-fold-clamped compensation; re-measured 0px
  both directions. **Pre-existing finding (BACKLOGGED, not this PR):** cross-node
  drag-pins write seed-id overrides that the read spine can't resolve (baked cc =
  plain slugs; `nodeSeeds` never consumed at view render) → pins render un-homed
  in view mode on main AND branch identically (proven via the shared
  `applyPlaceOverrides` on live state). Also learned the hard way: synthetic
  pointer-drags leak dnd-kit auto-scroll (`scrollBy`) — two "self-scrolling
  stack" scares were tooling contamination, proven by a spied fresh context
  (50s idle, zero writes, pinned scroll); and this machine's clock is ~1h ahead
  of TEST's auth server, so minted sessions must patch `expires_at`
  (`web/scripts/mint-dev-session.ts`, now committed).

- **#146 second review round — the A/B overturned my own "pre-existing" verdict.**
  Review rejected function-level equivalence as proof and demanded a direct A/B.
  Ran it (checkout `main`, same fork, same drag, editMode asserted by the
  toggle's label — the first attempt was invalid because `stackPresent:false` is
  trivially true on main and proved nothing about edit state). Result: the seed-id
  pin gap IS pre-existing on a fresh serve (both revert), **but** `main` keeps the
  pin looking re-homed after exiting edit mode via its OPTIMISTIC `localOverrides`,
  and the windowed stack — passing server truth per the build spec — snaps it
  back. That is a real post-edit regression I had reported as "identical". Left
  for Adam's call (accept / pass the optimistic trip-level values / fix the
  seed-id resolution). **Lesson: "same function, same inputs" is not "same
  rendered outcome" — the component receives served + optimistic state, not the
  row I queried.**
- **Two loose ends from the previous round closed, both tooling not product:**
  the "day renders 6 nodes, ZERO cards" scare was a probe querying `span` only
  (card titles are `<h3>`; correct selector finds all 3), and the two dev-server
  deaths were not windowing memory churn — both happened during route/auth work
  with no stack mounted, and a 60-transition sweep of the 66-day trip holds DOM
  nodes flat (2393 → 2393) with sawtooth heap and the server alive. Also fixed
  the rail-click-then-Edit edge I had wrongly deferred (the flush now prefers the
  click target while the programmatic guard is open) and corrected CLAUDE.md:
  **`762577ca…` is a PROD trip**, unusable from dev — TEST replacement
  `05b346df…` recorded.

- **#146 round 3 — behaviour-neutrality chosen over spec-literalism.** Adam's
  call on the post-edit divergence: **option (b)** (stack passes the optimistic
  trip-level values), with the seed-id pin fix as its own PR since the tripwire
  forbids the read spine consuming `nodeSeeds` inside this one. Rationale worth
  keeping: a presentation-only refactor matching `main` IS neutrality even when
  what `main` shows is known-false — otherwise the refactor becomes blameable for
  a pre-existing defect. Re-ran the three-point A/B after the change; `main` and
  the branch now match at all three (`original` / `re-homed` / `re-homed`).
  Dependency recorded on BOTH ends: the seed-id fix dissolves the divergence and
  its PR must revert `renderViewDay` to server truth.
- **Debugging lesson that cost the most time this session: a stale auth session
  looks exactly like broken drag tooling.** Four consecutive "synthetic drags
  stopped working" failures were the minted session expiring — the drags fired,
  the server action refused (*"Couldn't move: Sign in to edit this trip."*), and
  the optimistic overlay reverted, so the DOM read as "drag did nothing". Only a
  screenshot showed the error banner; every JS probe I had written looked at
  placement, not at errors. **Read the screen before re-engineering the tool** —
  and probe for error banners, not just expected state.

- **Credential decision: ACCEPT, do not rotate (Adam).** The seeded TEST password
  in 4 tracked scripts of a public repo stays. Measured blast radius is one TEST
  account's own trips — RLS blocks the corpus (enabled, no policies) and PROD is a
  different ref, and `reference_trips` is anon-readable regardless, so the
  credential buys an attacker nothing there. Weighed against a cascade-risky
  rotation (`trips.owner_id` is ON DELETE CASCADE — delete-and-recreate would
  destroy the seed harness trip and the `05b346df…` fork) plus four script edits.
  Recorded in BACKLOG as a considered accept with the cascade hazard and a
  binding forward rule: new scripts read seed creds from env; the four existing
  ones are grandfathered.
- **#146 closed out and merged.** Final shape: continuous view-mode scroll,
  optimistic trip-level values crossing the bridge (with a scheduled revert), the
  seed-id pin fix queued as its own PR. Three review rounds, and each one caught
  something the previous round's summary had smoothed over — the unauthenticated
  verification, then the equivalence-by-inference, then the deferred edge that was
  actually a small fix. The durable lesson from all three: **an untested claim
  dressed as a verified one is worse than an admitted gap**, because it spends the
  reviewer's trust to hide exactly the work that still needed doing.

## 2026-07-24

- **`rescopeOverlays` landed (#130)** — a pure keep/drop core for overlays across
  a day change: given the trip-level `placeRanks`/`placeOverrides` and a NEW day
  layout, drop overlays whose stop lost its home, keep the rest, never rewrite a
  `nodeId`. Function + 8 tests, no wiring.
- **Curated-POI cross-day move + delete kebab shipped (#131, merged).** A curated
  POI is a `Day.segmentSuggestions` OVERLAY entry, not a routed `Day.waypoints`
  point — so moving/removing one changes NO drive geometry (routing runs over
  waypoints only). The move is a geometry-free `segmentSuggestions` array-splice +
  `rescopeOverlays`, one guarded `updateUserTripPayload` write. ⋮ kebab: Move-to-day
  + Delete on curated tiles, Delete-only on route-waypoint tiles, gated on `canEdit`.
- **Verified before writing STATE (checked, not assumed):**
  - **Move-to-day is FUNCTIONAL, not a stub** — `moveCuratedPlace` actually splices
    the array and persists; it does NOT depend on `dayAssignment`. CAVEAT: array-splice
    STICKS on serve but is LOST on regenerate — day membership is geographically
    re-derived at bake/regen (the corpus fold populates each day's `segmentSuggestions`
    from a per-day-segment query).
  - **The `dayAssignment` anchor-seed-uuid key is DEAD.** `nodeSeed` ids are coord-
    deduped (`SEED_DEDUPE_MI=0.25`, `node-edits.ts:24,77,150`) → a revisited city
    (Cassiar return leg) collides to ONE uuid: per-CITY, not per-instance. And
    `nodeSeeds` is trip-level, never stamped per day (empty on fresh trips). So there
    is no unique-per-day anchor uuid to key on. Recommendation: mint a genuine per-day
    uuid; **regen-survival stays open** (days are regenerated content, not a carried
    coords-projected overlay — no key survives regen without a re-attach rule).
- **BACKLOG honesty items (#129, open)** — recorded three carried detail-panel items
  after re-verifying each against current code; a fourth candidate (the "Adds ~22h28m"
  card-face detour) was verified ALREADY RESOLVED (its owner `suggested-section.tsx`
  was deleted in the 2026-07-12 one-day-renderer refactor) and skipped rather than
  recorded.
- **Doc-consolidation churn (#133, merged)** — added an architecture doc then dropped
  it ("canonical version supersedes it") and rewrote CLAUDE.md POINTERS → an
  END-OF-DAY DOC PASS section (+ `/wrap`). This is why several open doc PRs conflict on
  CLAUDE.md.
- **Merge-cascade correction (dead end to record):** while merging the PR cluster,
  **#134 was merged into the wrong base** — its base was the orphan branch
  `docs/itinerary-model-architecture`, not `main` (I failed to check `baseRefName`
  before merging). #131 landed on main correctly (`f3a8651`); #134's cross-day decision
  doc is on the orphan branch (`a370926`), NOT on main, and needs a fresh PR to main.
  Lesson: verify each PR's base branch before `gh pr merge`, not just its mergeable
  state (which is computed against the base, not necessarily main).
- **Started this LOG** (`docs/LOG.md`); the append rule lives in CLAUDE.md's
  END-OF-DAY DOC PASS section. (Supersedes the LOG.md drafted in #132, whose 2026-07-23
  entry is carried below and whose CLAUDE.md hunks are redundant post-#133 — #132 closed.)
- **#134 misroute RESOLVED** (corrects the bullet above): the cross-day decision doc,
  merged into the orphan branch instead of main, was re-PR'd onto main via **#136**. The
  rest of the cluster landed too — **#129** (BACKLOG honesty items), **#114** (place-search
  decision docs, CLAUDE.md hunk dropped as redundant post-#133), **#135** (STATE.md +
  LOG.md); **#132 closed** with its 2026-07-23 entry carried into this LOG.
- **Architecture doc restored to main (#138).** #133 had dropped `itinerary-model.md`
  deferring to a canonical branch that never merged — leaving the architecture layer
  absent while STATE.md + the decision doc still referenced it (dangling). Restored the
  266-line version; corrected §4 (windowing NOT built) and §5 (`rescopeOverlays` IS wired
  via `moveCuratedPlace`) against code, resynced line refs drifted by #131.
- **Doc-consistency corrections (verified from code, provenance preserved):**
  **#137** fixed the decision doc's false "scroll/windowing layer built and working" §4
  claim (no `IntersectionObserver`/virtualization exists — center is a single-day swap).
  **#141** corrected the "Chosen design" `dayAssignment` key from the anchor-SEED uuid
  (DEAD — coord-deduped, revisited-city collision) to a **newly-minted per-day uuid**,
  inverting two backwards rejected-alternatives items; decision doc, STATE.md, LOG.md now
  AGREE on the key. **#139** fixed a stale note (the itinerary-model ref no longer dangles).
- **Stale-PR triage** — closed 6 superseded/obsolete PRs (#79, #49, #35, #34, #19, #6; all
  300-424 commits behind, work reworked or landed elsewhere). **Kept #24 open** (live
  weather — OpenMeteo + climatology fallback, `src/lib/weather/` + `resolve-weather.ts`,
  ABSENT from main): a genuine unmerged feature, rescue is a SALVAGE not a rebase (its
  hook `suggested-section.tsx` was deleted 7/12). Recorded in BACKLOG (#140) so it isn't
  lost as a dead-looking stale PR. Open-PR list is now #24 only.
- **Verified the kebab is live on prod** — the Vercel Production deployment on the #131
  SHA completed successfully; the ⋮ kebab is reachable now on user-owned UUID trips (not
  reference slugs, not flag-gated — gated on `canEdit` only). Also confirmed `/wrap` is a
  Claude Code command (`.claude/commands/wrap.md`), NOT a web route — no `/wrap` URL exists.

## 2026-07-23
- **Corpus outage root-caused and fixed — the corpus was on PROD all along.**
  `/api/search-area` had silently returned nothing because the **2026-06-01 prod
  Supabase service-role key rotation never reached Vercel**; hydrate failed with
  `master_place read failed: Invalid API key` from June 1 until the fix today
  (Vercel key updated + redeploy). PROD's full 13,629-place LA→Deadhorse corpus
  (Typesense `places_prod`) was intact the whole time — the earlier framing that
  the corpus still needed building was wrong. (`docs/DATA_INVENTORY.md`)
- **Second, independent fault: the shared Typesense `places` collection.** Prod
  and test shared one cluster AND one collection; `search:sync`'s prune pass
  deletes every doc whose id isn't in the syncing env's `master_place`, and the
  two envs' uuid id-sets are disjoint — so each env's sync clobbered the other's
  docs, taking the federated half fully down (`failedSources: ["corpus"]`), not
  merely returning fewer results. Fixed with **one collection per environment**
  (`places_prod` / `places_test`), name read from env with NO default (fails
  loud), orphan `places` deleted. (#120, #123;
  `docs/decisions/2026-07-23-typesense-collection-per-env.md`)
- **The tools that made these silent faults findable:** `failedSources` (#119)
  distinguishes a down source from a genuine no-match, and a `?debug=1` /
  `SEARCH_DEBUG_ERRORS=1` gate (#121) surfaces the per-source error text (off by
  default so internal DB error strings never leak).
- **`credential-drift` check** (`npm run -w data drift:check`, #124) — probes
  deployed prod + every stored service key by SHA-10 fingerprint. It is the
  check that would have caught 2026-06-01: every local/backup key was valid the
  whole time; only Vercel's runtime key was stale, so a local file scan couldn't
  have found it.
- **Flag split (#126):** `NEXT_PUBLIC_LIVING_PLAN_EDIT` gated BOTH manual drag
  editing and NL "Change this trip"; split so manual stays live and NL goes
  behind its own dark flag `NEXT_PUBLIC_NL_EDIT` (unset = off — do NOT set it in
  Vercel). Takes effect on the next deploy.
- **`DATA_INVENTORY.md` written as the measured source of truth** for what data
  lives where (PROD/TEST/Typesense/backups) + STATE refresh (#122); pinned ER
  fixture replacing the copy-prod-into-test seed (#128).
