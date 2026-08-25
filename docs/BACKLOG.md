# Backlog — open work

Durable and deferred work. This is the long list; the **active cut** — what is
queued or in-flight right now — lives in `docs/STATE.md` (§Queued, §In-flight)
and is authoritative for the current branch. When an item here becomes the next
thing worked, it moves into STATE.md §Queued.

> **Six-state trim Part 2 (the `is_active` UPDATE), `reference_trips.is_active`,
> and `search:sync` all executed on PROD 2026-08-10 — removed from this list.**
> Verified `[queried PROD]`: 8,067 `source_record` rows `is_active = false`
> (the estimate was 8,064); `la-to-deadhorse` + `dawson-vancouver-cassiar`
> retired; `places_prod` reindexed to 16,661. **The ONE step that did NOT run is
> the view migration (step 5) — carried below as its own item.**

> **SHIPPED, removed from this list:** the footprint-filter repoint (view now on
> `six_state_footprint()`, −9 Idaho +2 San Juan, 16,661→16,654) landed as **#209**;
> the `promote.ts` `DEFAULT_BATCH_SIZE 500 → 25` + calibration fix landed as **#210**.

## Notes-to-spine — overnight slice DONE; service stops remain (2026-08-24)

Investigation (PR #278, `docs/decisions/notes-to-spine-gap.md`) found the gap is
**two problems, not one**: the **overnight** is already grounded and already on
the spine (node or tile) on **96 of 104** overnight-bearing days `[measured
2026-08-24, TEST; lenient substring match]` — its gap was *labeling*, not
resolution; **Logistics / Fuel / Reserve** are genuinely prose-only, but most
places they name are *also* already spine nodes/tiles, so naive extraction would
mostly duplicate.

The overnight slice shipped as **#279** (decision doc
`docs/decisions/2026-08-24-overnight-spine-tile-link.md`): the grounded overnight
is linked to its spine tile by identity, marked/featured, the Camping block
derives from it, and the redundant prose line is dropped.

**A "tile missing on some days" report was traced to pre-#279-deploy trips (not a
code defect, #280), then CONFIRMED working by a live generation (2026-08-24) —
both overnights linked/marked/featured, Camping block derives, prose line
dropped, one card per place.** See the decision doc's Follow-up + Follow-up 2.
Remaining and still open:

- **REAL pool-hit coverage gap — CONFIRMED, not fixed (2026-08-24).** A pool-hit
  overnight is grounded to a trip-wide pool POI (`overnightRef = mp:…`), but
  `markOvernightTile` only marks tiles in the **per-day corpus fold**
  (`fetchCorpusForSegment`). When the overnight campground is in the pool but the
  day's fold doesn't surface it, no tile carries the ref → it stays unmarked
  (prose fallback) even under #279. Confirmed live: `c64ebc1c` Day 2/3 (William
  Kent, Kaspian) — in the pool, absent from the day's fold, unmarked; while Big
  Reservoir (pool-hit, in fold) marked `[queried TEST]`. Live-resolve overnights
  are immune (they synthesize a tile). **Reproduced live again (Follow-up 4):**
  Bishop→Mammoth(dwell)→Tahoe, all 5 overnights pool-hits, 2 marked / 3 not,
  including the predicted **layover-day** trigger (Convict Lake) `[computed]`.
  **Root cause broadened:** the ref id (pool-first `mp:`) and the id of the tile
  that represents the place (fold `mp:`, or endpoint/keyStop live-resolve
  `google:`) can differ or be absent — one day (Hope Valley) had the place on the
  spine as a `google:` endpoint tile while the overnight ref was the `mp:` id, so
  it stayed unmarked. **PARTIAL FIX built (Follow-up 5):** `markOvernightTile`
  now falls back to the pool POI's `google_place_id` (matching a `google:<id>`
  or `placeId`-carrying tile) when the exact `mp:` ref misses. **But inert on
  today's backcountry data** — `google_place_id` is RPC-join-sourced and **0 of
  351** #283-corridor rows carry one `[queried TEST]`, so Hope Valley et al.
  still don't mark. **FUZZY TIER built (Follow-up 6) — closes the tile-present
  case:** when both id tiers miss, `markOvernightTile` fuzzy-matches the
  overnight's pool name + coords against the day's tiles (strict name subset +
  ≥2 tokens, AND ≤ 0.5 mi). Confirmed: Hope Valley (Day 4) now marks — corpus
  "Hope Valley Campground" vs Google "Hope Valley", 0.067 mi apart `[queried TEST
  + Google details]`. Tiers 1/2 still win conflicts. **Two chosen thresholds
  (0.5 mi, subset+≥2-token) flagged as tunable product calls.** Decision doc
  Follow-up 3–6.
  **STILL OPEN — the no-tile / layover case (Convict Lake):** when the overnight
  has NO tile at all on the day (dwell day's empty fold, or off-corridor), there
  is nothing to fuzzy-match. Closing it needs **tile synthesis** from the
  overnight's grounded coords — deliberately out of scope so far. This is the
  last remaining slice of the gap.
  (The earlier name-collision hypothesis — 7 "Silver Strand" rows — does NOT
  bite: pool and fold agree on the single eligible `mp:54182e9b`.)
- **Badge prominence (Q3)** — the "Overnight ·" affordance renders but is a
  subtle status-line text prefix, visually identical to a key-stop note
  (screenshot-confirmed). Whether to strengthen it is a UX call. Not decided.
- **Overnight duplicate tiles (minor)** — overnight == day endpoint ⇒ 2–3
  same-id `isOvernight` tiles in stored `segmentSuggestions`; the render dedupes
  by id so one card shows. A `bake.ts` dedupe would tidy the persisted data.
- **Logistics / Fuel / Reserve service stops** — prose-only, never grounded.
  Per `docs/decisions/notes-to-spine-gap.md`, a separate, product-gated
  decision, preferring structured emission at generation time over post-hoc
  prose parsing. Not started.
- **Flagged UX calls on the overnight slice** (from its decision doc): whether
  the Camping briefing block should remain once the overnight is a labeled spine

- **Logistics / Fuel / Reserve service stops** — prose-only, never grounded.
  Per `docs/decisions/notes-to-spine-gap.md`, a separate, product-gated
  decision, preferring structured emission at generation time over post-hoc
  prose parsing. Not started.
- **Flagged UX calls on the overnight slice** (from its decision doc): whether
  the Camping briefing block should remain once the overnight is a labeled spine
  node; the exact overnight affordance (status prefix vs. distinct badge/node);
  and labeling the end **node** as the overnight when the overnight IS the end
  town (its tile is stripped as node-identical, so no separate tile is marked).
- **Not verified via a live generation** — the overnight link is unit-tested +
  gate-verified only; a real wizard+LLM run has not exercised the audit→bake
  path end to end.

## Shared client cache (ADR decision 4 / step 4) — READY TO BUILD (2026-08-23)

ADR `2026-08-21-place-data-resolver-consolidation.md` decision 4: **one shared
client-side cache (React Query, keyed by canonical id)** that all place surfaces
read/write through, so a rating fetched during Search stays warm when Date Detail
opens the same place. Deferred at ADR time ("sequenced after step 1 … not yet
started").

**Now ready.** The three READ surfaces are cut over to `resolvePlaces()` and each
still runs its **own per-route in-process cache** — Search's 15-min LRU, Date
Detail's 15-min per-id cache (kept deliberately, since `enrichByGoogleId()` is
cache-less), and Day-scoped browse's 15-min LRU. That per-route duplication is
exactly what the shared client cache removes; the enrich-by-id and Date Detail
plans both call the route's local cache "the seam where step 4 replaces it."

- **Scope:** a client-side React-Query (or equivalent) layer keyed by the
  canonical id from `place-id.ts`, shared across the find-nearby panel, Date
  Detail hydration, and the browse panel. The server routes can keep their caches
  or shed them once the client layer is authoritative.
- **⚠ Honesty note:** there is **no pre-written "build once a second surface needs
  it" trigger** in the docs — the deferral was framed only as "after step 1, not
  yet started." The readiness here is that the surfaces now *exist*, not that a
  named condition was tripped.
- Prereq met: canonical id (`place-id.ts`) exists and every cutover stamps it.
  Not blocked by anything; it is the last ADR step.

## Day Column write-path / baking consolidation — DEFERRED (from #267, 2026-08-23)

Day Column is a passive renderer of baked `Trip.days`; it has no endpoint, so it
was **not** a route cutover (#267 `4757067`). For it to ever reflect
`resolvePlaces()` output, the **write path** that bakes `segmentSuggestions` would
have to source via the resolver:

- `bake-corridors.ts::foldFederatedCorridorSupply` (behind `USE_FEDERATED_CORRIDOR`,
  default off) already reads corpus via `fetchCorpusForPolyline` →
  `pois_along_corridor` + `mapMasterPlaceRow` — the **same RPC + mapper**
  `resolvePlaces()`'s day-corridor federated half uses. So routing it through the
  resolver is largely redundant for Day Column today.
- **Why it's genuinely different from the read cutovers:** it *bakes into persisted
  `Trip.days`*, so tier/category/enrichment become a frozen snapshot (stale until
  re-bake), and **rollback is a re-bake, not a flag-flip** (and `dawson-vancouver-cassiar`
  is FROZEN — could not be re-baked). Persisting live Google fields would also hit
  the 30-day cache-limit compliance issue.
- **Recommendation (from the Day Column plan):** decide this as generation-pipeline
  work on its own terms, or fold it into ADR step 4 — not as a standalone "Day
  Column" change.

## RIDB `facility` rows that are actually campgrounds — small data correction (flagged 2026-08-23)

A set of RIDB `source_record` rows are typed `facility` (RIDB's residual
catch-all) but their names contain "camp"/"campground" — real campgrounds
miscategorized at ingest. Separate from #254's category *mapping* fix (which moved
`facility` OUT of the Camping slide bucket); this is a *data* correction of the
underlying `primary_category` on those specific rows. Small, self-contained.
**Count NOT re-measured this session** — size it before acting; do not carry a
remembered number as fact. Flagged in the session-start handoff; not previously in
this list.

## RIDB `FACILITYADDRESS` — fetch-layer gap, fix designed and NOT applied (#251, `4bfd183`, 2026-08-21)

Investigation: `docs/measurements/2026-08-21-ridb-facilityaddress-investigation.md`.
Recorded here because that doc's proposed fix is explicitly **not applied**, and
a proposal living only inside a measurement doc is easy to lose.

**What it found.** `FACILITYADDRESS` is empty on 100% of ingested RIDB facility
rows, and the cause is **the fetch layer, not the normalizer**: `fetchPaginated`
(`data/ingestion/sources/ridb.ts`) never sends RIDB's `full=true`, and the
`/facilities` search endpoint returns entity sub-arrays empty without it.
`normalizeFacility` also never maps the field, but the doc notes that is moot —
nothing was captured to map. Confirmed against the live API: the same facility
returns `FACILITYADDRESS: []` without `full=true` and populated with it.

**⚠ The upside is smaller than the raw presence rate suggests** — on the doc's
80-facility check, **68/80 (85.0%)** carry at least one address record but only
**32/80 (40.0%)** have a real street line; the rest are largely state-only,
which the corpus already knows from `master_place.state`. Some populated
addresses are **administrative-office addresses, not the POI's physical
location** — so a naive backfill would introduce wrong locations, not just thin
ones. Read the doc before implementing.

**Not done:** the `full=true` fetch change, the normalizer mapping, and any
re-ingest or backfill. All are proposed in §4 of that doc and none is applied.

## Human-readable address / reverse-geocoding — sized, schema proposed, NOT applied (#251, `4bfd183`, 2026-08-21)

Survey: `docs/measurements/2026-08-21-address-coverage-survey.md`. Read-only
sizing done **before** picking a geocoding provider, with no external geocoding
API calls.

**The gap, measured against TEST:** of **32,734** in-scope master_places
(`master_place_search_export`), **4,994 (15.3%)** carry any address token from
any source and **3,478 (10.6%)** have a street+city. **27,740 (84.7%) have
nothing address-like at all.** Concentrated in osm-only (11,901), ridb-only
(4,033), nps-only (4,008) and usfs-only (3,428) rows.

Also recorded: `normalized_payload.contact.address` is populated on **no**
source; Google's `formatted_address` exists but is **non-compliant to persist**
(same caching rule as rating/userRatingCount); and RIDB's empty
`FACILITYADDRESS` is the item above.

**Not done:** the proposed schema (§6 of that doc), any provider choice, and any
geocoding run. The survey deliberately stops at sizing.

## master_place enrichment columns — SHIPPED TO TEST (#247, `4f2a6af`, 2026-08-22); four follow-ups open

Step 1 of `docs/decisions/2026-08-21-place-data-resolver-consolidation.md`.
Full measured report: `docs/measurements/2026-08-21-master-place-enrichment-columns.md`.

**Shipped — TEST ONLY. PROD has neither migration.** `master_place` now
carries `rating numeric(2,1)`, `review_count integer`, `price_tier smallint`
(1–4, matching the web `priceTier?: 1|2|3|4` convention) and `photo_url text`,
all nullable. **`description` was NOT added — it already existed** since the
Phase 1 migration and is owned by `recompute_master_place()` via
`field_precedence`, so the ADR's five fields became four columns.

`photo_url` backfilled on **7,360** rows (nps 4,690 · ridb 2,449 · blm 88 ·
state_parks 133, the last all Washington). **`rating` / `review_count` /
`price_tier` are 0 corpus-wide** — no ingested source carries any of them,
established by enumerating the full key space per source, not a regex census.
They ship empty on purpose: the point is that the card layer stops branching
on provenance. ⚠ **They are not a destination for Google data** —
`rating`/`userRatingCount` are explicitly non-cacheable.

### Open follow-ups

1. **`photo_url` is a SNAPSHOT, not `recompute_master_place()`-owned.** It
   will go stale on the next deactivation/materialize. Same class as
   `master_place.state`. Wiring it in needs a `field_precedence` row per
   contributing source (**a product decision, Adam's call**) *and* a dedicated
   resolver step — `resolve_field()` reads `normalized_payload->><field>`
   while the photo lives at `normalized_payload.photo.url`, so it needs the
   `geometry_polygon` treatment (Step 5), not a plain precedence entry.
   **Interim mitigation: `npm run -w data backfill:mp-enrichment` is
   idempotent and self-clearing — re-run it after any materialize.**
2. **BLM `props.PHOTO_LINK` (102 rows) and state_parks `props.Imagelink` (138
   rows) are unmapped in their normalizers.** Both sit in `raw_payload` and
   never reach `normalized_payload` — same class as the BLM `WEB_LINK` miss of
   2026-08-20. The backfill reads them straight from `raw_payload` so the 221
   photos aren't dropped, but the durable fix is a normalizer change plus a
   re-normalization backfill (exactly like `backfill-blm-website.ts`), which
   would also feed the export view's lateral. **Ceiling note: the state_parks
   half is Washington-only** — the other five states publish no such field, so
   this widens coverage within WA, not across six states.
3. **`master_place_search_export.photo_url` still comes from its own lateral,
   not the new column.** They already differ on 221 blm/state_parks rows plus
   23 rows where the lateral's pick is arbitrary. Repointing the view is ADR
   step 2. ⚠ **Settle `is_active` first:** the lateral does **not** filter it
   and the RPC does, so the two resolve over different row sets. "0 view-only"
   was measured, not structural — it holds only while no *inactive* nps/ridb
   record carries a photo url, and the first deactivation of one breaks it.
4. **PROD apply, if it ever happens.** The three CHECK constraints take an
   ACCESS EXCLUSIVE lock and full-scan to validate. Cheap at TEST's size;
   **PROD's `master_place` row count has not been measured and no claim is
   made.** Use `NOT VALID` + a later `VALIDATE CONSTRAINT` there.

Adjacent, not caused by this work: **`blm` and `atlas_oddities` have NO
`field_precedence` rows for ANY field**, so they contribute zero resolved
fields to `master_place` — 138 BLM-linked and 95 state_parks-linked places
carry a real source description while `master_place.description` is NULL.
Seeding those rows is a product decision; the state-parks spec §10a excluded
`description` deliberately.

## `fed_exact` is category-blind AND name-blind within 10m (2026-08-17)

`matchOne` Step 1 (`findFederalAnchor`, `data/entity-resolution/matcher.ts`)
auto-links an NPS or RIDB record to any federal-partner master_place within 10m
**by coordinate alone** — it never checks the name or the category. Usually
correct (it is the NPS↔RIDB campground bridge). But it is the mechanism behind a
whole class of corruption: **all 103 bad `nps:park_feature` auto-links this
session came through `fed_exact`** `[measured 2026-08-17]` — editorial content
cards collapsing onto real federal places by proximity, then NPS priority-1
precedence renaming them (11 fossil labels → Quarry Exhibit Hall). #234 scoped
the fix to **one source+category pair** (`nps:park_feature`, forced to
`new_master_place`) rather than touching `fed_exact`, because `fed_exact` is
correct for campgrounds and a global change has the wrong blast radius. **Open:**
whether `fed_exact` should ever consider category compatibility (e.g., refuse to
link across incompatible categories even within 10m), or whether the
source+category allowlist is the durable shape. See ADR
`docs/decisions/2026-08-17-bar-nps-park-feature-linking.md`.

## The dry-run report's `primary_category` column is a proxy artifact (2026-08-17)

`materialize --dry-run-report` computes a "category change" whenever an NPS SR's
`inferred_category` differs from the target MP's `primary_category` — it predicted
**56** for the NPS materialize. **Zero landed, correctly:** `recompute_master_place`
resolves `primary_category` from `normalized_payload.primary_category` via
`field_precedence`, but the **NPS ingester never populates that field**, so NPS
cannot recategorize an existing MP (confirmed: **0** master_places carry
`attribution.primary_category == 'nps'` `[queried TEST 2026-08-17]`). The report's
column measures a *possible* precedence winner, not an *actual* one. **This will
mislead again** — any source whose `normalized_payload` omits `primary_category`
(NPS, and check others) shows phantom category changes in the report that never
materialize. Fix options: have the report resolve against `normalized_payload`
like recompute does, or label the column "inferred_category mismatch (not a
recompute prediction)."

## NPS `park_feature` — editorial CMS content, no clean physical/interpretive filter (2026-08-17)

The 4,235 `nps:park_feature` rows are now standalone master_places (guard #234).
But NPS `/places` is an **editorial content system**: every record is a card with
`bodyText` + `images`, and a picnic area and a fossil label share one schema. A
50-row read showed **roughly half are real destinations**; the other half are
interpretive stops, wayside signs, audio-tour panels, fossil labels, and webpage-
like content ("Current Conditions at…"). **No field cleanly separates them** —
`isMapPinHidden` and title patterns (the two best signals) disagree on ~250 of 900
sampled rows `[queried TEST 2026-08-17]`; `isOpenToPublic` is 96% true,
`associatedIcon` 97% empty. **Open:** whether to keep all 4,235 in the searchable
corpus, exclude `park_feature` from search, or build a downstream classifier. No
field filter is trustworthy; a curated allowlist or a classifier is the only
clean path, and neither is obviously worth it for ~2,500 marginal POIs.

## 10 jotr `park_feature` rows pending from May, predating the guard (2026-08-17)

10 `nps:park_feature` rows sit in `manual_review` (all `blended_residual`) from the
original May jotr materialize — each queued against a *nearby* jotr feature MP
(e.g. "Cholla Cactus (Cholla Cactus Garden)" → "Cholla Cactus Garden") `[queried
TEST 2026-08-17]`. **Under the guard (#234) each would be a `new_master_place`**,
not a queued review; they predate it, and an incremental materialize skips them
(they already carry a `place_match`). Harmless (pending, not confirmed). To
regularize: clear their pending `place_match` and re-materialize the 10, or leave
them until a queue-processing pass.

## Typesense TEST index was stale by ~102k — caught up, keep it synced (2026-08-17)

`places_test` was **14,911** (the 2026-08-10 state) while the export view held
**117,261**; the OSM / PAD-US / BLM six-state campaigns had **not been synced to
TEST Typesense since 2026-08-10**. Caught up this session (`materialize --skip-er`
→ 117,261, 0 failed) `[queried TEST 2026-08-17]`. **Standing reminder:** a TEST
`materialize` chunked with `--skip-sync` (as the NPS run was, to isolate ER)
leaves the search index stale — a `--skip-er` sync (or an unskipped materialize)
has to follow, or TEST search silently drifts from the corpus. PROD `places_prod`
is unaffected by this (separate collection, separate cadence).

## Pending ingest — USFS, PAD-US, BLM (2026-08-13)

Scoped read-only this session (`data/ingestion/sources/usfs.ts`,
`padus.ts`; no BLM ingester exists). Not run — RIDB + OSM six-state
campaigns took priority. None have an `--iso` flag; six-state coverage
means six `--bbox` runs (or a corridor polygon) for either.

- **~~USFS six-state ingest — small, cheap. Scoped to
  `markeractivity='Dispersed Camping'` only … national ceiling 367 …
  Current TEST corpus: 6 rows.~~** **SUPERSEDED / DONE 2026-08-16 (TEST) —
  ingester rewritten to `EDW_RecInfraRecreationSites_02`.** The
  dispersed-only / 367-ceiling scoping above is obsolete: the source moved
  from `EDW_RecreationOpportunities_01` (367 dispersed-only national rows)
  to `EDW_RecInfraRecreationSites_02` layer 0 (~31k developed sites
  `[handoff, unverified]`), with RecOpp kept as a light enrichment join.
  Six-state ingest DONE on TEST: **6,324 active `source_record`**
  `[queried TEST 2026-08-16]` — trailhead 3,041 · campground 2,312 ·
  picnic_area 570 · dispersed_camping 401; 6 legacy `usfs:recarea:*`
  deactivated (`is_active=false`; **5 need `recompute_master_place`** on a
  future run `[handoff, unverified]`). **Trailhead materialized live** —
  2,601 linked `[queried TEST]` (the 630 auto_link / 1,971 new_master_place
  split is `[handoff, unverified]`); 440 manual_review. ~~**Campground
  PARKED** behind the matcher `name_dominant` floor + review-queue
  capacity; **picnic (570) + dispersed (401) dry-ran clean, not yet
  materialized.**~~ **SUPERSEDED / DONE 2026-08-17 — all four categories
  materialized live on TEST.** picnic + dispersed ran, then campground
  (2,312 SR: **715 new_master_place + 655 auto_link + 942 manual_review**
  `[handoff, unverified — the three sum to the measured 2,312]`). usfs
  linked/unlinked now **5,228 / 1,096** `[queried TEST 2026-08-17]`. Code
  in PR #223 (via #226) **merged to `main`**. BLM still has no ingester.
- **~~PAD-US six-state ingest — massive, product decision pending.~~**
  **DONE 2026-08-14 (TEST)** — Fee_Managers endpoint, all six states
  ingested + materialized on TEST. **35,859 padus source_records** written
  across WA/OR/AZ/NV/CA (UT ran a day earlier). Reconciliation produced
  **30,152 new master_places** on top of UT's 7,016. Corpus grew
  117,262 → 147,414 MPs; padus active SRs 7,162 → 37,701. The
  ~400k–480k lower-48 estimate proved right in shape: ~42k written
  for the six-state Fee-only slice. Zero auto_link, zero amenity_rollup,
  zero errors across all six states. Cumulative wall time ~4h 10m
  (matchAll ~3h 48m). Follow-ups filed as separate items below
  (`land_status` corpus weight, materialize serialization, Wilderness
  Designation endpoint, residual unlinked). See `LOG.md` /
  `STATE.md` for the run details. The product-decision framing above
  is superseded by the completed characterization run — outstanding
  land-status product question now lives in the "PAD-US `land_status`
  corpus weight" entry below.
- ~~**BLM investigation — deferred.** No standalone BLM ingester exists.~~
  **SUPERSEDED / DONE — `blm-rec.ts` landed on `main` as PR #232**
  (`a501744`). `source_id="blm"`, 876-row six-state primitive-campsite
  ingest scoped. Spec: `docs/specs/blm-primitive-campsite-ingest.md`.
  The PAD-US + BLM SMA "combined source" framing above is orthogonal —
  #232 is a *recreation-points* ingester (`BLM_Natl_Recs_pts` layer 23),
  not a land-status source.

## State parks source — LIVE ON PROD, 156 pending triage (updated 2026-08-20)

Spec: `docs/specs/state-parks-source-architecture.md` (v4).
Branch: `state-park-systems-enumeration` (not yet on `main`).

~~**BUILD COMPLETE.**~~ **LIVE ON PROD.** 1,736 source_records ingested,
1,584 confirmed, 156 pending manual_review, 0 rejected. Category-compatibility
fix (`recreation_area ↔ public_land/land_status`) applied — ADR
`2026-08-20-recreation-area-land-status-compatibility.md`.

**PROD manual_review triage (156 records):** NOT yet triaged. TEST triage
decisions (two rounds: 100 + 177 records) were made against TEST-specific
candidates. PROD pending breakdown: name_dominant_low_conf 59, close_nameless
53, blended_residual 44.

**Code not yet on `main`:** Branch `state-park-systems-enumeration` needs PR +
merge. Migrations are already applied to both TEST and PROD.

**Still blocked (separate investigation):** description field_precedence —
visitor-website investigation underway. Source_id `state_parks_web` not
finalized.

## PAD-US polygon-source ER — investigated across all six states, no over-merge (2026-08-14, resolved history)

Kept for the record so a future session does not re-litigate this from an
older handoff. **A prior handoff had documented a PAD-US "polygon
over-merging" concern citing a UT `master_place` with `source_count=134`
and a WA `master_place` with `source_count=8,410` from an earlier
failed/partial batch attempt. Investigated across all six states
(UT/WA/OR/AZ/NV/CA) after a clean full ingest + materialize sequence,
2026-08-14. Does not reproduce.**

**Measured on the clean run, per state:**

| state | padus SRs | MPs referenced | source_count histogram | max source_count | auto_link | amenity_rollup |
|---|--:|--:|---|--:|--:|--:|
| UT | 7,015 | 7,128 | {"1":7128} | **1** (Rothschild House, coincidentally same-name) | 0 | 0 |
| WA | 6,742 | 6,716 | {"1":6716} | **1** | 0 | 0 |
| OR | 6,026 | 5,943 | {"1":5943} | **1** | 0 | 0 |
| AZ | 2,242 | 2,227 | {"1":2227} | **1** | 0 | 0 |
| NV | 2,575 | 2,523 | {"1":2523} | **1** | 0 | 0 |
| CA | 18,038 | 17,764 | {"1":17764} | **1** | 0 | 0 |
| **six-state total** | **42,638** | **~37,168 distinct new** | all solo | **1 everywhere** | **0** | **0** |

**37,168 padus SRs (99.4% of the fresh writes) landed as their own new
`master_place`.** Zero auto-links into existing point-based
(OSM/RIDB/NPS) MPs. Zero amenity-rollups. The polygon-source and
point-source corpora are **structurally disjoint under the current
matcher** — polygon centroids don't align to point coords, and the
category-compatibility function returns 0 for `land_status`/`public_land`
vs any point category (peak, park, trailhead, etc.), preventing spurious
merges in either direction. This is behaving as documented in the
land-status ADR, not as a matcher defect. **Resolved. Do not re-open
without a fresh reproducing case.**

## PAD-US `land_status` corpus weight — product decision open (2026-08-14)

Of the ~37,168 new padus master_places, **47,633 padus-linked MPs
(~97% of the aggregate padus-sourced footprint) are
`primary_category = 'land_status'`** — jurisdiction parcels
(SITLA/SLB blocks, city/county parks, LP/LREC/SCA units) that are
`is_searchable = false` and excluded from browse/search. Only **1,586
(~3%) are `public_land`** — named federal/state units that appear
in search.

Open question: **do the 47k land_status rows earn their place as
first-class `master_place` rows** (serving attribution and enrichment
paths that already know how to read a `master_place`), or should
land-status live in a separate table per the three-tier geospatial
model? Two shapes worth considering:

- **Keep as-is:** every polygon is a `master_place`, `is_searchable=false`
  hides them from search, geometry-lookup queries (`is this point on
  BLM land?`) work through existing `geometry_polygon` joins.
- **Split out:** promote `land_status` rows into their own table
  (`land_status_polygon` or similar), simplifying `master_place` to
  the ~1.5k named-unit set + the point-based POIs it already carries.
  Cost: every consumer of `master_place` that expects `land_status`
  to be reachable there has to be rewritten.

**No decision made — flagging for evaluation** before any further
land-status-family ingest (BLM SMA, Wilderness Designation, USFS
Special Interest Areas). The choice affects table shape, RLS, and
whether the point-lookup queries are joins across two tables or one.

## `materialize` lacks request serialization — TEST hit an Unhealthy state after back-to-back matchAll runs (2026-08-14)

`data/ingestion/lib/rate-limit.ts` sets per-source `pLimit` values —
RIDB was pinned to `pLimit(1)` in commit `9a06f39` after `pLimit(4)`
sustained-429'd twice on UT. **`materialize` has no equivalent
throttle.** Its matchAll issues per-record RPC calls sequentially but
without an explicit rate limit; on a big-corpus run it can generate
sustained load the target project cannot absorb.

**Concrete failure, 2026-08-14 TEST:** back-to-back UT + WA materialize
runs (~13,000 RPC calls total, spanning ~55 min) knocked TEST
(`znldzjdatkogdktymtvi`, Micro tier / `t4g.micro`) into an Unhealthy
state. Cloudflare returned **522 (origin timeout)** on all
origin-touching requests for ~2 hours; the gateway itself stayed
healthy (unauthenticated `/rest/v1/` continued returning `HTTP 401` in
~200 ms with valid `sb-project-ref` headers, while any query that
needed PostgREST → Postgres 522'd for 20 s). WA matchAll's circuit
breaker tripped after 15 consecutive `AbortError`s (568/6,692
processed), no writes landed, materialize was rerun cleanly after the
project recovered. Sequence completed after recovery.

**Two follow-ups worth considering:**
- **Serialize matchAll RPCs** — a `pLimit(1)` (or a small pool with
  backoff) around the per-record candidate lookup would smooth the
  burst that pushed TEST into the failure state. Mirrors the fix
  applied to RIDB.
- **Raise TEST off Micro compute before the next large campaign.**
  The current tier can handle bursts up to a few thousand RPCs, but a
  50k+ MP corpus scan pattern (as would happen if BLM/Wilderness gets
  wired) is likely to hit the same wall regardless of serialization.
  Small dashboard change; no code change.

## PAD-US Wilderness (Designation endpoint) not ingested (2026-08-14)

**No `des_tp='WA'` rows landed in any of the six states** — the
Fee_Managers endpoint the ingester currently uses **deliberately
excludes Wilderness**, per the pre-prod gate documented at the top of
`data/ingestion/sources/padus.ts` (`§ HARD PRE-PROD GATE: Wilderness
(Designation class)`). Wilderness lives on PAD-US's separate
Designation feature class, which is **unwired** — the ingester's
`ENDPOINTS.fee` constant has no `ENDPOINTS.designation` sibling.

Consequence today: a point inside a Wilderness inherits the enclosing
forest's `dispersed_camping = 'likely_allowed'` — a wrong "camp here"
signal. `deriveDispersedCamping` already returns `'likely_restricted'`
for `des_tp='WA'`, but no `WA` records ever reach it under Fee-only.

**Needs a decision:**
- **Wire it** — implement the Designation endpoint fetch + the
  multi-parent resolution rule (`restricted-beats-allowed` when a
  Wilderness overlaps a Forest). This is the documented pre-prod gate
  before any prod ship of the dispersed-camping signal.
- **Formally drop it** — accept the signal is TEST-only and never
  surfaces to users, and rip the pre-prod-gate machinery. Only
  reasonable if the dispersed-camping feature itself is deprioritized.

Not merely a config toggle — the endpoint is unwritten and the
multi-parent resolution has no code path.

## PAD-US 421 residual unlinked source_records after six-state run (2026-08-14)

The six-state materialize sequence left **421 padus source_records
still `master_place_id = null`** after all runs completed. Per-state
matchAll slippage (unresolved-count query vs matchAll's own fetch
race): UT ~34 · WA ~60 · OR ~137 · AZ ~152 · NV ~152 · CA ~202 sums to
~585; the applyMatches phase closed ~160 of these gaps, leaving ~421.
Not investigated — most likely just needs one more `materialize
--skip-sync` pass. Small enough to file as-is. If it survives a rerun
untouched, the matchAll → applyMatches boundary needs a closer read.

## Matcher bugs — coord-dominant merges and the `name_dominant` confidence bypass (2026-08-13)

Found during a read-only merge-quality audit of the (then) 623 corpus-wide
`master_place` rows with `source_count > 1`. Both confirmed via direct
`place_match` score reads, not inferred. **Neither is fixed.**

- **Bug 1 — coordinate-dominant merges at 0m.** `scoreMatch`'s blended
  formula (`0.4·distance_score + 0.4·name_similarity + 0.2·category_compat`)
  lets `distance_score = 1.0` (two source_records sharing an exact
  coordinate) alone contribute enough that even mediocre name similarity
  crosses the 0.85 auto-link threshold. Seed example: **Castle Rock Trail +
  Badger Trail** (AZ, RIDB) — two genuinely distinct, adjoining BLM trails
  sharing one trailhead coordinate; the BLM description text itself says
  Castle Rock Trail "connects the Badger Trail" — `distance_meters=0,
  name_similarity=0.630, combined_confidence=0.852`, crossing 0.85 by
  0.002. **6 confirmed instances in the RIDB corpus** (of ~16 total
  "visibly unrelated names" merges found; the rest were borderline/
  plausible parent-child, not confirmed bugs). **Also confirmed
  source-agnostic** — the same shape appeared in OSM data after the
  six-state OSM ingest: **Liberty Glen #72/#73/#74**, three distinctly-
  numbered dispersed camping sites collapsed into one `master_place`.
  Prevalence scales with corpus size, not with source. Fix requires
  threshold/formula work — not scoped. **Still OPEN as of 2026-08-16** — the
  campground dry-run reported **0 coord-dominant flags** `[measured 2026-08-16]`;
  the trailhead pass was **already materialized**, so its outcomes were read from
  persisted `place_match` rows (not dry-run this session), where the handoff
  reports it also did not clearly fire `[handoff, unverified]`. Lower-priority
  than it looked, but unaddressed.
- **Bug 2 — `name_dominant` bypasses `combined_confidence` entirely.**
  Waterfall Step 3 in `matcher.ts` (`matchOne`) auto-links whenever
  `distance ≤ 500m AND name_similarity ≥ 0.85 AND category_compat ≥ 0.8` —
  it never checks the resulting `combined_confidence` at all. Example:
  **Buckhorn Draw Campsite 10 + Buckhorn Dino Track** (UT, osm+ridb
  cross-source) — a campsite merged with an unrelated dinosaur-track
  attraction 229m away, `combined_confidence=0.544` (below even the 0.6
  `manual_review` floor), `match_method=name_dominant`. Root cause is
  Jaro-Winkler's prefix-weighting: "Buckhorn " as a shared 9-character
  prefix alone pushed name_similarity to 0.859 regardless of what
  followed. ~~**One-line fix** (add a confidence floor check to the
  `name_dominant` branch) — not yet applied.~~ **FIXED 2026-08-16 via
  [#227](https://github.com/honkinsickle/overlander/pull/227)** (merged into
  the stacked, still-OPEN #224 — not yet on `main`). `name_dominant` now
  gates on `combined_confidence ≥ NAME_DOMINANT_CONFIDENCE_FLOOR (0.70)`;
  below-floor matches route to `manual_review` with
  `match_method='name_dominant_low_conf'` (no fall-through). Buckhorn Draw at
  0.544 would now queue for review. Reasoning (0.70 vs 0.65; leave the 100 m
  clip) in `docs/decisions/2026-08-16-name-dominant-confidence-floor.md`.
- **Testing follow-up (Bug 2 fix, PR #227) — extract the post-gate
  `name_dominant` decision to a pure function.** The fix routes weak
  `name_dominant` matches to `manual_review` (method
  `name_dominant_low_conf`); its ONLY guard in the default/CI suite is a
  mocked-DB unit test in `matcher.test.ts`
  (`matchOne — name_dominant floor routing`). The `phase3a` integration
  path can't guard it — that suite is excluded from the default run
  because `reset_phase3a_test_state()` would wipe the shared working
  corpus (`SUPABASE_TEST_URL` == the working ref in local
  `data/.env.test`). The mock mirrors the exact query shapes of
  `fetchSourceRecord` (`.from().select().eq().single()`) and
  `findCandidates` (`.rpc().abortSignal()`) and **will break on a refactor
  of either** — a false failure unrelated to the routing. Next time
  someone is in `matcher.ts`: extract the post-gate decision (a scored
  candidate + the floor → `{kind, method}`) into a pure function and test
  that directly — zero mock coupling, non-brittle. Deferred deliberately
  to avoid restructuring `matcher.ts` while the fix sits in an unmerged PR.

## Doc hygiene — check CLAUDE.md's CI description against `.github/workflows/ci.yml` (2026-08-16)

CLAUDE.md describes the CI gates in prose ("CI runs `typecheck`, `test`,
and `build` as three separate jobs"). A full session worked from that
prose without ever reading `ci.yml`; it happened to be accurate. As of
2026-08-16 `ci.yml` is exactly: **`typecheck`** (`npm run -w web
typecheck` + `npm run -w data typecheck`), **`test`** (`npm run -w data
test` — pointed at `secrets.SUPABASE_TEST_URL`, which `ci.yml`'s own
comment calls an "isolated test project"; the secret's value isn't
readable from here, so that it is genuinely distinct from the working
corpus is the workflow's stated intent, not something confirmed — and it
EXCLUDES the `phase3a`/`phase3b` destructive suites per
`vitest.config.ts`), and **`build`** (`cd web && npx next build`, web
only). Worth a periodic re-check that the prose still matches the
workflow: a drift (CI stops running the data suite, or adds a gate)
silently invalidates the "run the same gates locally as CI" assumption
the STANDING RULES lean on. Cheap to confirm; expensive to assume.

## Manual-review queue — first bulk-clearing mechanism shipped; framework still not built (updated 2026-08-17)

**5,745 pending `place_match` rows** `[queried TEST 2026-08-17]` — by method
`blended_residual` 4,979 (87%) · `close_nameless` 325 · `name_dominant_low_conf`
441 (the floor's cluster, 0 → 441 after the three USFS materializes); osm is
~67% of the pending mass. ~~It is now the blocker on a live campground
materialize~~ **SUPERSEDED 2026-08-17 — campground materialized anyway, and the
first deterministic bulk-clearing mechanism shipped: the recreation.gov-id rule
(below) confirmed 370 campground rows.** A general filter-and-bulk-act framework
is **still not built.**

**Two claims from the 2026-08-16 scoping are now CORRECTED (both measured false
this session):**

- ~~**Write-back already exists** — `apply_match_outcomes` handles
  confirm→auto_link.~~ **WRONG.** `apply_match_outcomes` is **INSERT-only**; its
  `manual_review` branch leaves the source_record unlinked, so **confirming an
  existing pending row had no path at all** (re-insert collides with
  `unique(source_record_id, master_place_id)`). This session **built** that path —
  `resolve_place_match` / `unresolve_place_match` (migration `20260817120000`, TEST
  only; ADR `2026-08-17-…`). Any framework builds on those, not on
  `apply_match_outcomes`.
- ~~**USFS↔RIDB share no identifier, so external lookup is the only ground
  truth.**~~ **PARTIALLY REFUTED for developed campgrounds.** The USFS INFRA
  payload text embeds the `recreation.gov/camping/campgrounds/<id>` facility id for
  **921 / 2,312 campground SRs (40%)** `[queried TEST 2026-08-17]` — a deterministic
  identifier bridge, no external fetch. It does **not** generalize: trailhead
  5/3,041 · picnic 21/570 · dispersed 0/407 (only **26 / 4,018** non-campground SRs
  carry any id), so those rows still have no evidence at any price.

**Shipped — the recreation.gov-id rule (`data/scripts/resolve-recgov-rule.ts`,
PR #230).** Auto-confirms a pending usfs campground row when the payload's
recreation.gov id resolves to a `ridb` record (`external_id ridb:facility:<id>`)
on the **same** master_place the pending row proposes. Applied as tag `full0817`:
**370 confirmed, 0 failures, 0 renames, 0 recategorizations, max source_count 6.**
Snapshot-based undo verified exact. This is the model for the queue: not a one-row
approver — a deterministic rule that bulk-clears an evidence-backed slice.

**Surfaced by the same rule, NOT acted on — needs handling design:**
- **58 different-mp rows** — the payload id resolves to a *different* master_place
  than the matcher proposed. These are likely mis-pairings or duplicate MPs (see
  the duplicate-master_place item below); a rule to *re-point* the SR (or merge the
  two MPs) is a separate design from confirm-in-place.
- **28 not-in-corpus rows** — the id names a recreation.gov facility we have not
  ingested. A RIDB-coverage gap, not a match decision.

**Still-valid framework findings from the 2026-08-16 scoping** (carried forward):
- **Partition by `match_method` first** — method ≈ decision-shape; the osm
  `blended_residual` mass and the federal `name_dominant_low_conf` cluster need
  different playbooks.
- **The `name_dominant_low_conf` cluster is largely bulk-decidable** — on the
  campground preview, 66% identical normalized name, 52% at conf exactly 0.60
  (≥100 m clip), 7% cross-category. ~65–75% clearable by filtered bulk actions.
- **Per-row, a reviewer needs the pair + scores + a map** (both pins + the MP's
  other-source pins). The framework links out; it doesn't resolve.

## Duplicate master_places the matcher never paired (2026-08-17)

Distinct from the review queue — a **corpus** problem. The recreation.gov-id rule
surfaced master_places that are the **same physical place split into two MPs**,
which the matcher never proposed as a candidate pair (so they never entered the
queue). Confirmed cases `[queried TEST 2026-08-17]`: **Smiling River Campground,
Allingham Campground, South Shore Campground, East Kachess Group Site** — each a
pending usfs row proposing one MP while the payload's recreation.gov id resolves to
a *different* MP carrying the exact same canonical_name.

**How widespread is unmeasured, and cannot be cleanly counted by name.** A
name-collision count is badly confounded: it is dominated by legitimate
multi-location brands (Chevron, Tesla Supercharger, Shell) and by geographically
**distinct** same-named campgrounds across different forests (e.g. several real
"Riverside Campground"s). Same-name ≠ same-place. **No number is recorded here on
purpose** — a name-based figure would misrepresent the problem.

**The one path to a real count later:** the recgov-id mechanism is itself a
*high-precision* duplicate detector — a shared external facility id resolving to
two MPs is strong evidence they are one place, independent of name. A future pass
could enumerate true duplicates by walking shared external identifiers (recreation.gov
facility id; and, where they exist, other cross-source ids), optionally confirmed by
co-location. That is the honest way to size and then resolve this — not a
`GROUP BY canonical_name`.

## Corpus quality — open questions from the merge-quality audit (2026-08-13)

- **`amenity_rollup` individual correctness never audited.** Distinct from
  the "Cross-category `amenity_rollup` collapse" item above (which is
  about DIFFERENT amenity types colliding under one parent) — this is
  about whether each rollup picked the *geometrically/logically correct*
  parent at all, e.g. a dump station 95m from Campground A when
  Campground B is actually closer. ~100 `amenity_rollup` pairs exist in
  the (pre-OSM-campaign) corpus; none individually verified. Not audited
  at corpus scale.
- **`canonical_name` resolution bug — rolled-up amenity names beating
  real site names.** `recompute_master_place`'s field_precedence
  sometimes picks a rolled-up amenity's fabricated name over the parent
  site's real name. Confirmed twice: two "Unnamed toilet"
  `master_place.canonical_name` values in the Santa Rosa Yellow Post
  cluster (CA, osm), each really a numbered yellow-post campsite with a
  toilet amenity rolled up into it. The mechanism (field_precedence
  ordering, not a one-off) suggests more exist; not audited at corpus
  scale.
- **Manual review queue has no process.** **4,649 rows** corpus-wide
  sitting in `place_match.status='pending'` `[queried TEST, 2026-08-15]` —
  no review UI, script, or workflow exists to work through this queue.
  **Grew by 386 during the PAD-US six-state campaign** (UT 33 · WA 26 ·
  OR 77 · AZ 15 · NV 49 · CA 219 · plus small cross-border residual);
  the rest is the standing pre-PAD-US backlog (osm 3,848 · ridb 362 ·
  other 20 from earlier). Grows with every ingest.

## Grounding infrastructure — complete, not yet run (2026-08-13)

Three PRs (#218, #219, #220 — see `STATE.md`) shipped the machinery for a
Google Places grounding dry-run against the six-state corpus:
`--skip-enrichment-persist` (preview without write), the `isPlaceholderName`
gate on `fetchEnrichmentCandidates` (placeholder-named source_records never
reach the resolver), and the `EnrichmentAggregate` three-way split
(`enriched_new` / `enriched_existing` / `enriched_unknown`) so a dry-run
report is decision-quality. **Next step: run the dry-run against the
six-state corpus, review output, decide whether to spend for real.**
**Blocked on the Google Places strategy decision** — see the new ADR
`docs/decisions/2026-08-13-google-places-strategy-open-question.md`. Do not
run the dry-run as a "why not, it's free" step; the ADR exists specifically
because the follow-on hydration cost is not free and the strategic direction
isn't chosen yet.

## Artboard C — photo in search + hydrate — SHIPPED (#211, live on PROD 2026-08-10)

The photo lateral landed: `photo_url` on `master_place_search_export` (nps/ridb, NPS
preferred) + the Typesense sync (`PlaceDocument`) + `hydratePlacesByIds`. PROD view
**16,654 unchanged**, **3,526** rows carry a photo (~21%), `places_prod` = view.
(The asserted "5,256 photo-emitting tiles" RIDB figure was discarded — matched no
measured count.) Only the schema-field note below remains open.

**Follow-up (post-#211):** `photo_url` is **stored and retrievable** on both `places_test` and `places_prod` (returned in search hits + via hydrate) but is **not a declared Typesense schema field** — the sync only sets the schema on collection *creation* — so `filter_by`/`facet_by` on it will **400**. Rendering is unaffected. Declaring it later is an in-place `collections.update` to add the field (background-indexes the already-stored values — no reindex/recreate).

## OSM fuel family retired (#214) — gas/ev rows still on PROD (2026-08-11)

#214 dropped the whole `fuel` family from the OSM adapter (`fuel` /
`charging_station` / `bbq` / `fire_pit` removed from `FAMILY_PREDICATES` and
`TAG_TO_CATEGORY`). The `bbq`/`fire_pit` rows were deactivated on PROD 2026-08-11
(view 16,654 → 16,516 — see `STATE.md` + `LOG.md`). Two things remain open:

- **261 `gas_station` + 184 `ev_charging` osm source_records remain active in the
  corpus** even though their mappings were dropped in #214 (code-only; existing
  rows keep their persisted `inferred_category`). Deliberately kept:
  - **gas_station** is covered **live** by Google Places (`gas_station` in the
    `/api/search-area` fanout), so the OSM copy is redundant — a candidate for a
    later deactivation pass, low urgency.
  - **ev_charging** is the **only corpus EV source** until Google's
    `electric_vehicle_charging_station` type (added to the live fanout in #214)
    **proves itself in production**. Do NOT deactivate it before that is verified —
    revisit both after the Google EV type has real prod coverage confirmed.
- **`evChargeOptions` was declined (#214).** Requesting connector type / max kW
  from Google would add `places.evChargeOptions` to the Nearby Search field mask,
  which moves **every** search-area call into the Places API **Enterprise** tier
  (a per-call SKU bump, same class as the existing rating/price Pro-tier fields).
  Not worth it for a chip label; revisit only if EV connector detail becomes a
  product requirement.

## CA OSM camping — 8.33% `manual_review` rate unexplained (2026-08-10)

CA's materialize produced **206 / 2,474 = 8.33% `manual_review`**, against AZ 4.4%
and TEST/WA-OR-NV 3.6% `[measured PROD 2026-08-10]`. All are **post-#200**, so this
is not placeholder-collision noise — it is genuine named-site ambiguity, but why CA
runs ~2× the others is not established. Candidate: denser real-named camping with
more sub-threshold near-duplicate pairs. Worth a sampling pass before assuming it is
benign.

## TEST corpus is not representative of PROD (standing caveat, re-flagged 2026-08-10)

TEST (`znldzjdatkogdktymtvi`) holds ~1,749 searchable master_places over a LA/Joshua-Tree
reseed; PROD holds **20,904 master_places / 16,654 view-visible** over the full
six-state-plus corridor. A conclusion measured on TEST — coverage, ER outcome rates,
density, enrichment behaviour — **does not transfer to PROD**. Several past
"corpus is SoCal-only" errors trace to treating TEST as the corpus. Every corpus-scale
claim must name which project it was measured on. (See also the disjoint-instruments
caveat in `CLAUDE.md` §RUNBOOK.)

## TEST fixture composition — Path B, non-destructive, targeted (decided 2026-08-10)

**Decision.** Improve TEST as an ER/enrichment instrument by adding **non-OSM density
co-located with the existing OSM camping in CA and AZ** — realistic cross-source
overlap where matches actually fire. The target is **that co-location, NOT a
corpus-wide source ratio**. **Path B: non-destructive — do NOT clear TEST** (its
18,967 source_records / 16,521 master_places / 14,911-row view baseline stay).
**Blocked on Overpass and RIDB availability** — both were intermittently down this
session (RIDB 401, Overpass 504/429), and the targeted fetch depends on them.

## Open PRs — resolved (updated 2026-08-10)

~~#204, #205 open~~ — **#204 merged** (committed the 5 six-state migrations to `main`;
PROD ledger reconciled via `migration repair`). **#205 closed as superseded** by #207
(its STATE numbers were the stale post-trim snapshot; its checkpoint-migration
standing-check idea was salvaged into `bin/preflight`). The one long-standing open PR
remains **#24** (May, live-weather salvage).

## PROD OSM `waste_disposal` reclassify — 1,723 rows miscategorized (2026-08-10)

The fix is on `main` via #202 (`b8dcabd`) — the adapter now maps
`amenity=sanitary_dump_station → dump_station` (the actual RV tag) and
the old `amenity=waste_disposal` mapping is gone. **But PROD data
predates the fix.** 1,723 PROD rows are still stored with
`inferred_category='dump_station'` under the old mis-mapping
`[queried PROD 2026-08-09]`.

Sample of 20 of those 1,723 rows: **0 were real dump stations.** Every
one is a municipal trash bin at a park entrance, gas station, or urban
street corner. Under the corrected mapping in `inferCategory` they
would return `null` (unmapped) and not ingest — so a mechanical fix is
either:

- **Delete** the 1,723 rows outright (DELETE FROM source_record WHERE
  source_id='osm' AND inferred_category='dump_station' AND
  raw_payload->'element'->'tags'->>'amenity' = 'waste_disposal'). Also
  removes their master_place links (ON DELETE CASCADE from the
  place_match table takes care of that side). Recompute affected MPs.
- OR **reclassify** by setting `inferred_category = NULL` and letting
  the next materialize decide. But since the row shouldn't have been
  ingested at all under the new mapping, delete is cleaner.

A small script mirroring the `apply-placeholder-rewrite.ts` pattern
(idempotent, paired undo, verify post-conditions) is the shape. ~~Not
run today.~~ **DONE ON TEST 2026-08-18 — see below. PROD still open.**

**Small blast radius.** No user-facing surface shows `dump_station`
prominently; the mis-classification is data-quality debt, not a
render defect. Can wait behind the six-state trim.

### RESOLVED ON TEST 2026-08-18 by DELETION — `data/scripts/delete-osm-waste-disposal.ts`

**Final state. Supersedes the reclassify-to-NULL step recorded below.** Adam's
decision reversed that intermediate approach in favour of the **delete this
entry preferred from the start** ("since the row shouldn't have been ingested at
all, delete is cleaner"). The 123 stale rows are **hard-deleted from TEST**.
**PROD's 1,723 rows are UNTOUCHED and still need Adam's explicit go-ahead as a
separate operation.**

**TEST before → after `[queried TEST 2026-08-18]`:**

| metric | before | after | Δ |
|---|--:|--:|--:|
| `source_record` total | 165,945 | **165,822** | −123 |
| — `is_active=false` | 84,911 | 84,788 | −123 |
| — `is_active=true` | 81,034 | 81,034 | **0** |
| osm `source_record` | 109,615 | **109,492** | −123 |
| `place_match` total | 163,248 | **163,151** | −97 (cascade) |
| `master_place` total | 155,495 | 155,495 | **0** |

Zero `amenity=waste_disposal` rows remain on TEST; the **26** genuine
`sanitary_dump_station` rows are untouched and still deactivated. The
corpus-wide diff was exactly the five lines above — no other category or source
moved. `place_match` cascades via `on delete cascade` on
`place_match.source_record_id` (the only FK referencing `source_record`).

**The set was NOT taken from the prior snapshot — that snapshot had been
destroyed.** `reclassify-osm-waste-disposal.ts` wrote its snapshot on every run
including dry runs, so a post-apply dry run found 0 rows and overwrote it with
an empty file. Defect fixed in that script (timestamped snapshots, never write
an empty one). The set was instead re-derived and proven identical: **zero** osm
rows had a NULL `inferred_category` before the reclassify step, and it set
exactly 123 to NULL, so `source_id='osm' AND inferred_category IS NULL` selects
precisely those rows. Four independent guards enforced it at delete time (NULL
category + raw tag + expected count 123 + all-inactive). A full-row backup
(every column + the 97 cascading `place_match` rows) is at
`~/.config/overlander/deletion-backups/`; `raw_payload` carries the original OSM
element with coordinates, so rows are reconstructible via
`upsert_source_record`.

**Post-hoc content verification — the premise HOLDS `[read backup 2026-08-18]`.**
The "these are municipal trash bins, not RV dump stations" judgement was
originally **inherited** from tag semantics plus the 20-row **PROD** sample
above, and was never checked against these specific TEST rows before they were
deleted. It has now been verified read-only against the backup, across **all
123 rows — a full scan, not a sample** (a sample cannot answer "are there
exceptions?"):

- **100%** carry `amenity=waste_disposal`; no other amenity value appears.
- **112 of 123 (91.1%)** carry the bare category tag and nothing else. Only six
  distinct tag-set shapes exist across the whole population.
- **Zero** rows carry `description`, `operator`, `website`, `brand`, `phone`,
  `opening_hours`, `capacity`, `fee`, `charge`, or any `addr:*` tag.
- **Only 2 rows carry an OSM `name` tag at all — and both are literally named
  `"Dumpster"`**, with `waste=trash`. They are the strongest confirmation of the
  characterization, not counter-examples.
- **6 more** carry `waste=trash`; **3** carry an access restriction
  (`access=private` ×2, `access=customers` ×1) — all consistent with bins.
  Remaining keys (`source`, `source_ref`, `source_date`) are provenance noise.
- `normalized_payload` held **0** non-empty descriptions. All 123 carried
  `amenities: {"dump_station": true}` — a false amenity flag derived from the
  bad category, so the deletion also removed 123 bogus `dump_station` amenity
  assertions from the corpus.

**Verdict: no row in the deleted set resembles an RV sanitary dump station.
Nothing is flagged for restoration and the deletion stands as correct.** The
backup remains on disk regardless.

**Deletion did NOT fix the `recompute_master_place` clear-bug `[queried TEST
2026-08-18]`.** The recompute demonstrably **ran and wrote**: all 89 affected
master_places carry `updated_at` in the **03:16:22–03:16:33 UTC** window, which
matches the delete operation exactly (its backup file is stamped 03:16:22) and
matches no other operation this session. Yet **78 of them still read
`primary_category='dump_station'`** and `canonical_name='Unnamed dump station'`.
A recompute that provably wrote still left those columns stale — which is the
clear-bug demonstrated directly, on the `IF v_value IS NOT NULL` guard: with no
*active* source_record left, `resolve_field()` returns no candidate, the UPDATE
is skipped, and the old value stays stranded. Deleting the source_record is
therefore **not** a workaround for the clear-bug; it needs its own scoped pass.

**Observed inconsistency, mechanism NOT established.** Post-delete, the 78 rows
carry `attribution = {}` and `secondary_categories = []` while
`primary_category`/`canonical_name` still hold values with no backing source.
These aggregate columns were **not measured pre-delete**, so it is not known
whether the delete changed them or they were already empty — and no causal link
between them and the `updated_at` bump has been established. Recorded as an
observation, not a mechanism.

> **CORRECTION 2026-08-18 (same day, before push).** ~~An earlier revision of
> this entry and of this deletion commit's message claimed `updated_at` bumped
> "89 of 89, vs 0 of 89 for the NULL case," and that the recompute "genuinely
> wrote this time" while the NULL-case recompute was a verified no-op.~~ **That
> contrast was never established and has been struck.** The "0 of 89" came from a
> **vacuous check**: the filter tested `updated_at` for the prefix
> `2026-08-18` while the machine runs PDT and the operation executed at
> **03:02 UTC on 2026-08-19**, so it was guaranteed to return 0 whether or not
> the recompute wrote. The NULL-case write behaviour was therefore **never
> measured**, and the evidence is now **unrecoverable** — the 03:16 delete
> recompute overwrote those `updated_at` values. Only the delete-case
> measurement above stands. Same failure class as the apparatus lessons in
> `CLAUDE.md`: a check that cannot fail is not evidence.

**NEW residual introduced by the deletion: 78 completely sourceless
`master_place` rows** (zero `source_record` rows now reference them; before,
they at least had an inactive one). Still **render-harmless** — all 94
corpus-wide `dump_station` master_places sit at `source_count = 0` and
`master_place_search_export` returns **0** of them `[queried TEST 2026-08-18]`.
Cleaning them up is a separate authorized decision (deleting `master_place` rows
was not in scope here) and is the natural companion to the clear-bug pass.

### Intermediate step, 2026-08-18 — reclassify to NULL (`reclassify-osm-waste-disposal.ts`)

~~Final.~~ **Superseded by the deletion above; kept for the record.**

Surfaced by this session's tag-richness investigation, which first reported
dump_station at 93.3% tag-rich — an **apparatus artifact**: the richness
probe's defining-tag predicate was `amenity=sanitary_dump_station`, so on a
mis-mapped row the `amenity` key itself counted as an "extra" tag. Re-measured
split by the tag that actually produced the category.

**TEST before → after `[queried TEST 2026-08-18]`:** osm
`inferred_category='dump_station'` **149 → 26**; the **123**
`amenity=waste_disposal` rows re-derived to `inferred_category = NULL`. All 149
were already `is_active=false` (deactivated in `47e00e4`); the 26 genuine rows
stay deactivated — the parent decision stands, templates are a separate stage.

**Chose reclassify-to-NULL over the delete this entry prefers**, on explicit
instruction. NULL is what the current normalizer actually derives
(`osm.test.ts` asserts `inferCategory({amenity:'waste_disposal'})` is `null`),
`inferred_category` is nullable, and `recompute_aggregated_fields` already skips
nulls — so it is a state the schema and recompute path both expect, and it is
reversible. Delete remains the cleaner end state if the rows are ever confirmed
worthless; nothing here forecloses it.

Corpus-wide before/after diff was **exactly two lines** (osm `(null)` +123,
`dump_station` 149→26) — no other category, source, or master_place count moved.
Reversibility proven by a full undo → re-apply round trip (149 → 123 restored →
26). Snapshot:
`~/.config/overlander/reclassify-snapshots/osm-waste-disposal-dump-station.json`.

**RESIDUAL — a second confirmed instance of the `recompute_master_place`
clear-bug** (its own entry above predicted exactly this: "any field whose
sources might stop resolving … should check for the same class of stale-data
risk"). The 89 affected master_places were recomputed with zero errors, and
**78 still read `primary_category='dump_station'`** `[queried TEST 2026-08-18]`.
~~`updated_at` bumped on 0 of 89.~~ **STRUCK — that check was vacuous** (a
`2026-08-18` prefix filter against a run that executed at 03:02 UTC on
**2026-08-19** on a PDT machine; it returned 0 regardless of outcome). Whether
this NULL-case recompute wrote was **never measured** and can no longer be
recovered — see the CORRECTION note in the deletion section above. Cause: with no
*active* source_record left, `resolve_field()` returns no candidate, so the
`IF v_value IS NOT NULL` guard skips the UPDATE and the old value stays
stranded. **Render-harmless here** — all 94 corpus-wide `dump_station`
master_places sit at `source_count = 0`, which the export view's
`source_count > 0` filter excludes, so none reach search. Fixing it belongs to
the clear-bug's own scoped pass, not here.

## Cross-category `amenity_rollup` collapse — separate from placeholder fix (2026-08-10)

Surfaced by the placeholder-name matcher fix audit
(`audit-placeholder-collapses.ts`, in #201). While counting confirmed
place_match rows where both sides are placeholders, 5-8 of TEST's 48
collapsed MPs turned out to be **cross-category merges** the placeholder
fix does NOT address:

- `"Unnamed water"` MP holding 3 water_taps + 1 toilet
- `"Unnamed water"` MP holding 4 water_taps + 2 dump_stations
  (`amenity=waste_disposal`)
- `"Unnamed water"` MP holding 3 camp_sites + 1 water + 1 toilet
- `"Unnamed picnic area"` MP holding 3 picnic_sites + 1 water
- etc.

These are `amenity_rollup` outcomes (Step 2 in `matcher.ts`) or
`auto_link` blended-scoring outcomes where the placeholder-name
inflation combined with a permissive amenity → parent category
compatibility let DIFFERENT amenity types collapse under one "parent"
MP. The placeholder fix (#200, 2026-08-10) zeros name_similarity when
either side is a placeholder, which stops future collisions of this
shape from being auto-linked — but the ALREADY-CONFIRMED merges on
TEST + PROD are not touched by that fix.

**PROD footprint measured (partial):** the audit-placeholder-autolinks
script counted **9 collapsed MPs / 10 non-seed auto-links** on PROD
OSM-only 2026-08-10. The collapse-detail script hasn't been run on
PROD yet; small population, easy to eyeball once run.

**Likely fix (not yet scoped):** in `matcher.matchOne` Step 2 amenity
rollup and Step 5 blended, block auto-merge when the source's
`inferred_category` and the candidate's `primary_category` are
DIFFERENT AMENITY types (e.g. `toilet` + `water`, `dump_station` +
`water`), even if names match. This is orthogonal to the placeholder
fix — a real-named `"Belle Toilets"` auto-linked to a real-named
`"Belle Water"` at 20m has the same defect shape today.

**Remediation for the ~10-15 existing wrong MPs:** hand-audit
sufficient at this scale; a targeted split script mirroring
`apply-placeholder-rewrite.ts` if needed.

**Not addressed by the placeholder fix.** Recording as its own item so
the next session doesn't mistake the placeholder fix's completion for
end-to-end amenity-rollup cleanliness.

## RIDB backfill — 28 `/media` errors unretried, error shape UNVERIFIED (2026-08-10)

The PROD RIDB backfill run (2026-08-09, in #198) wrote 1,622 of 3,961
rows scanned and left **28 `/media` fetch errors unretried**. Prior
session's `docs/state-ridb-route-a` wrap (never merged) asserted these
are **not** the `web/.env.local` 401 (that key is unused; every RIDB
consumer runs off `data/.env`'s working key). **The actual error shape
is still UNVERIFIED** — the run's stderr wasn't captured, no log file
exists `[searched repo-root, 2026-08-09]`.

- **Recovery is idempotent:** `backfill:ridb-photo` is re-runnable; a
  fresh run recovers any that were transient.
- **A `--dry-run` backfill would surface their shape** without writing
  anything, and confirm or refute the "not-auth" assertion. Small,
  cheap, read-only.
- Not urgent — 28 rows out of 3,961 is 0.7%.

## NPS photo backfill — `scan()` pagination-while-mutate defect — RESOLVED (fix in #196, 2026-08-06)

**Fixed** in `feat/nps-corpus-imagery` (`a670dfe`): `scan()` is now two-phase —
Phase 1 reads every nps row in a stable `.order("id")` pass and collects the
writes; Phase 2 updates by id. The write phase can no longer perturb the
enumeration, so one apply reaches `changed: 0`. A vitest fake that relocates a
row on UPDATE proves it: at `pageSize=2` the old code scanned 4 of 6 rows, the
fix scans all 6 (RED→GREEN, ms, no volume). Original defect kept below for the
record.

`data/scripts/backfill-nps-photo.ts` `scan()` paginated `.range(from, from+999)`
(filtered `source_id='nps'`) with **no `.order()`**, and issues row UPDATEs inside
the same loop it pages over. Each UPDATE rewrites a heap tuple, shifting the
physical order of the unordered scan, so later OFFSET windows **silently skip (or
double-count) rows** — a single apply under-writes.

Measured on the PROD run (2026-08-06): one `--confirm` left **738** of 4451 photo
rows unwritten, the next left **47**; convergence to `changed: 0` needed **three
apply→dry-run passes**. Mid-apply counts are also unreliable — `withPhoto` read
**4507** during a write pass vs a stable **4451** in every read-only dry-run
(double-counted rows). The final state is correct and idempotent; only *reaching*
it took a loop.

**Fix:** either (a) collect all ids in one read-only pass, then update by id; or
(b) keyset-paginate (`.order("id")` + `WHERE id > lastId` + `LIMIT`), which is
immune to mid-scan tuple movement. **The same footgun will bite any future corpus
backfill that paginates-while-writing** — worth a shared helper, not a per-script
fix.

**Operator workaround until fixed:** loop `--confirm` → `--dry-run` until the
dry-run reports `changed: 0`; never trust a single pass. And prefer the
no-`.env`-swap prod-run method: `npx tsx --env-file=$HOME/.config/overlander/env-backups/.env.production-backup scripts/backfill-nps-photo.ts …`
from `data/`, which points only that process at prod (`data/.env` stays TEST) while
the `--confirm` guard still fires.

## NPS corpus imagery (Route A) — SHIPPED + live on PROD; follow-ups (2026-08-06)

Route A is live end to end (`STATE.md` §2026-08-06; architecture
`place-render-model.md` §4a). Parked follow-ups:

- **REFRESHING STORED SUGGESTIONS — the question, not the answer.** A rest day's
  `segmentSuggestions` are baked at insert and stored; **no backfill path exists for
  baked payload tiles**, so only newly-inserted days benefit from corpus improvements
  (a new photo, a corrected mile, a better name). `b97d06bf` day 4 is the live example
  — 9 of 10 tiles now have a corpus photo that the stored payload can't reach `[queried
  PROD 2026-08-06]`. **Should stored suggestions ever be re-queried, and on what
  trigger** (day open? trip open? an explicit "refresh"? a migration-triggered sweep)?
  Re-querying live loses the insert-time snapshot semantics; a sweep is a payload
  rewrite across every trip. Open — the same shape as the `milesFromStart` baked-stale
  debt (§below), now the second instance of the pattern.

- **NPS image licensing — measured, deferred.** NPS `images` carry per-image credits
  that DIFFER: one Portland record was **CC BY-SA 2.0 from a third-party photographer**
  (`"River Spirits" by brx0`), another (Joshua Tree) was **NPS public domain**
  (`NPS/Hannah Schwalbe`) `[queried NPS API + PROD, 2026-08-05/06]`. `credit` and
  `altText` are carried through the ingest onto `normalized_payload.photo` so
  *displaying* them later is a render change, not another backfill. **Not a blocker
  today — Adam is the only user; richness over licensing** was the deliberate call.
  Revisit before any public launch that surfaces NPS imagery.

- **NPS-specific — does NOT generalize.** ridb `raw_payload` has a `MEDIA` field that
  `.passthrough()` preserved, but **0 of 3,961** carry a URL; `parks_canada` and `osm`
  have no image field at all `[queried PROD, 2026-08-05]`. So Route A helps nps only;
  a "corpus imagery" generalization would need per-source work, and the other sources
  have nothing to promote.

- **River Guardian on the Willamette stays a placeholder — correct, not a failure.**
  One of the six Lillian Pitt records has **no NPS image**, so its tile keeps the
  category block. Expected: Route A surfaces imagery that exists, it does not invent
  it (grounding rule holds).

## Plot day-detail places on the map — SHIPPED; follow-ups (2026-08-05)

The feature shipped in #187 (scoping + harnesses), #188 (tile layer + runbook
correction), #189 (marker→card). Position + PR breakdown: `STATE.md`
§2026-08-04 → 08-05. Full scoping: `docs/proposals/2026-08-04-plot-day-detail-places-research.md`.
The two decisions that held: GeoJSON circle layer (not DOM markers — a day
carries up to 263 tiles), map follows the active day (`?day=`), not the mounted
set. Two follow-ups below.

### EXPAND-ON-FOCUS — the #189 gap (needs its own scoping)

On **curated** trips, `CityNode` collapses non-key-stop pool tiles behind
"Explore N more", so **those cards are not in the DOM**. The marker layer plots
the FULL pool, so clicking a collapsed tile's marker is a **graceful no-op** — no
scroll, no error, `?day=` unchanged (measured, not inferred).

- **The measured ratio and the LIMIT of that number:** on `expedition-ms28y793`
  day 1, **3 of 7 markers have a card** `[browser, 2026-08-05]`. That is the
  clean, **SPARSE** instrument — do NOT read 3-of-7 as a general figure. On a
  **dense curated day the ratio is far worse**: `4534add5` day 1 is **263 tiles**
  with only a handful of curated key stops, so the large majority of its markers
  would be no-ops there.
- **Cause is IN-DAY COLLAPSE, not continuous-stack windowing.** The active day is
  ALWAYS mounted, so the stack's IO windowing is NOT the issue — the missing cards
  are the collapsed pool *inside* the mounted day (`day-detail-corridor.tsx`,
  `CityNode`'s `showRest` / `expanded`). These would be fixed in different files;
  conflating them would send someone to the wrong place.
- **Candidate fix:** expand the containing cluster before scrolling (open the
  collapsed `CityNode`, then `scrollIntoView`). Needs scoping — where the expand
  state lives and how the `trip:placeFocus` listener reaches it without new
  cross-component coupling.

### Reverse direction (card → marker highlight) — UNWIRED, by design

Highlighting a MARKER from a CARD is not built, deliberately. The mechanism would
be `feature-state` + `promoteId` on the GeoJSON source + a data-driven paint
property (the layer analog of find-nearby's `dataset` pulse). It is unwired
because there is **no in-scope card trigger** — hover is out of scope, and a
card-body click opens the slideup (out of scope to change). Not "too expensive":
there is simply nothing to hang it on until a card-side interaction is decided.

### ~~OPEN DIRECTION~~ RESOLVED + BUILT — two-layer category map (PR #192, 2026-08-05)

**Decided, built, and MERGED** (#192): keep the layer, add category filtering. Two symbol layers over the one `active-day-places` source (POOL below,
PROMINENT above), `prominent = curated OR fromWaypoints`, 9 category toggles, the
`addImage` icon pipeline. Discriminator computed at render, no schema change. See
`STATE.md` §2026-08-05 for the full record. The four threads below, resolved:

- **Category filtering + the `addImage` pipeline — BUILT.** `place-layer-icons.ts`
  registers 18 icons at load; `place-layer.ts` adds `prominent` to feature props.
- **Collision — DECIDED by on-screen comparison** (a dense 263-tile synthetic day,
  both binaries): **per-layer**, not one flag. Pool `icon-allow-overlap: false`
  (declutters); prominent `true` + `ignore-placement` (always renders — the
  important, always-small set is never the icon Mapbox culls). No longer UNVERIFIED.
- **Three-treatment coherence — answered.** Prominent layer matches the waypoint-pin
  language (stroke `CAT_SVG` in a tailed disc); pool matches the browse-dot language
  (filled `CategoryIconV2` in a rounded square). Reuses both existing sets, invents
  no third. The new layer sits alongside the DOM pins whenever a day is active.
- **Plots POOL (both layers), not curated-only** — filtering's value is the long
  tail, so the whole pool plots; prominent/pool is the render split, not a cull.

**STILL GATED — Google Places licensing (UNANSWERED).** Unchanged and still the real
gate before this is user-facing: Google Places terms restrict displaying Places
content on a non-Google map. Corpus rows (NPS/OSM/RIDB/BLM/USFS) carry their own
coords — probably unaffected — but `google:`-prefixed tier-2 tiles came from a Google
lookup. Needs a real read of the CURRENT Places terms, not a recollection.
`[UNANSWERED]`

### COMMITTED MULTI-SHAPE TEST FIXTURE — a synthetic map instrument (2026-08-05)

**A synthetic TEST `reference_trips` row has now been inserted and deleted THREE
times** to verify map behaviour (#192 collision `dense-collision-tmp`; #194's
day-fit `fit-test-tmp`, twice). The standing TEST trips don't exercise the shapes:
the `la-to-deadhorse` fork was de-linked (#177); `expedition-ms28y793` = 2/3/7 pool
per day; the reference slug `la-to-deadhorse` = ≤5 prominent + ~8 pool on day 1. So
every map render check re-stages a throwaway row.

**Shape wanted:** ONE committed fixture — a `web/scripts/` seed or a TEST
`reference_trips` row from a checked-in script — with **five days, one per shape**,
covering every map-render path in one trip:
1. **dense day** — ≥250 tiles, mixed categories, a handful `curated` (collision /
   clustering / prominent-above-pool at scale).
2. **rest day** — `start==end`, `miles==0`, ~10 all-pool tiles ringing one point
   (`curatedMode = false`; the camera-fit spread case).
3. **round-trip day** — `start==end`, `miles>0`, tiles spread ~50km, some `curated`.
4. **driving day** — `start≠end` hundreds of mi apart, tiles strung along.
5. **coordless day** — a waypoint with no `coords`, zero plottable (the camera
   fallback + coords-guard path).

**Anon-readability matters** — it must be a **reference slug** so browser
verification runs without a session (b97d06bf and other UUID trips are RLS-scoped,
unrenderable in dev). ⚠️ Gotcha found building `fit-test-tmp`: synthetic
`corridorCities` MUST carry `placeIds: []` or `classifyCuratedPicks` throws
`c.placeIds is not iterable` and the map never mounts — set `corridorCities: []`.
Not yet built.

### CLUSTERING / EXPANSION FOR DENSE DAYS — the day-fit floor (2026-08-05)

The #194 day-bounds camera **helps but does not solve** a genuinely dense day: 263
tiles tight in downtown LA render **124 after the fit, up from 2** at the old zoom 8
`[measured 2026-08-05]`. That 124 is the measured floor — the cluster is tight at any
zoom, so fitting just zooms into the same blob and the pool `icon-allow-overlap:
false` declutter still hides ~half. A real fix is **clustering or expand-on-focus**,
separate scope.

**Two levers were priced and NOT taken (neither is exclusive with clustering):**
- **Scale `icon-size` with zoom** (as browse dots do, `max(12, 30·z/13)`) — smaller
  icons collide less when zoomed out, but coincident/tight tiles still overlap and
  the icons go illegibly small; a partial mid-density relief, not a dense-day fix.
- **Flip `icon-allow-overlap: true` on the pool** — renders all tiles (nothing
  hidden) but re-breaks the dense day into the overlapping mess #192's collision
  decision deliberately decluttered. A straight trade, not a fix.

**Driving-day note (one day is not a general result):** places-only fit was accepted
knowing the **start pin might leave frame** on a driving day whose stops cluster at
the destination. On the one driving day tested (`fit-test-tmp` day 1) the start
stayed in frame because its stops reached the start — `[UNVERIFIED as a general
claim]`. The route line was accepted as the continuity fallback.

- **Category filtering + the `addImage` icon pipeline.** Icon scoping already done
  today (chat + `LOG.md` 2026-08-05, not a standalone doc): the vocabulary EXISTS
  (`CategoryIconV2`, 9, gap-covered), the layer source already carries `category`
  in feature properties, and the ONLY new machinery is the SVG→`addImage`
  registration pipeline (nothing in-repo rasterizes SVG or registers a map image
  `[grep, 2026-08-05]`). **Collision decision is UNVERIFIED on-screen:**
  `icon-allow-overlap: true` renders all 386 but they overlap badly; `false` lets
  Mapbox declutter but *it* picks the winners, not the day's logic.
- **Three-treatment coherence — a design call.** The map would then show three
  category-icon treatments at once: waypoint pins (stroke icon in a tailed circle),
  browse/suggested dots (filled `CategoryIconV2` in a rounded square), and a new
  symbol layer (a third). Whether they read as one language or three competing
  systems is a design decision.
- **Google Places licensing — UNANSWERED, and it GATES filtering.** Google Places
  terms restrict displaying Places content on non-Google maps. Most plotted tiles
  are corpus rows (NPS/OSM/RIDB/BLM/USFS) with their own coordinates — probably
  unaffected — but `google:`-prefixed tier-2 tiles originated from a Google lookup,
  which is a different question. Needs a real read of the CURRENT Places terms, not
  a recollection. `[UNANSWERED]`
- **Whether #188's layer plots pool or curated** — now contingent on the filtering
  decision above. Curated-only plotting would DEFEAT filtering (the value is the
  long tail behind "Explore more"), which makes #189's collapsed-card gap
  (§EXPAND-ON-FOCUS) *more* visible, not less.

## Day-insert (#184) — follow-ups (2026-08-03)

Shipped feature in `STATE.md` §2026-08-03; mechanics in
`architecture/itinerary-model.md` §6 and `architecture/place-render-model.md`.

- **FOUR BROWSER-ONLY CHECKS — UNVERIFIED (no browser/preview reachable this
  session).** Server-side + `renderToString` was the ceiling. All need the running
  app + map canvas:
  1. Map **draws** the rebuilt split `routePolyline` and shows **no phantom
     segment** for a layover; per-day highlighting still correct.
  2. **Slideup re-renders the renumbered tail** after `router.refresh()`. This is
     **structural, not cosmetic** — a split/insert shifts day ids, numbers and
     dates across the whole tail. **`deleteDayAction` is also structural on the
     same `/trip/{id}` revalidate path**, so a gap here may be two things, not one.
  3. Kebab ↔ `Day.heroTag` (compass tag, top-right) **overlap**.
  4. **Edit-mode drive connector** on a layover (`DayDetailNodeBlocks`) would show
     `0 mi` / `0 hrs` from `dayMiles`/`dayDriveHours`.
- **`DayHeader` and `DaySidebar` are ORPHANED — imported nowhere** `[git grep on
  all of `src`: only their own definitions + stale comments, 2026-08-03]`.
  Independent of this work. The old day-level rename/delete/reset kebab
  (`day-header.tsx`, incl. a `console.log`-stubbed "Add" item) and the
  `"95 mi | 2.3 hrs"` sidebar stat (`day-sidebar.tsx`) are **not in the live UI** —
  the live day view is `DayDetailCorridor` via `day-detail-corridor-column.tsx`.
  This is why #184 added a *new* kebab host. Decide: mount or delete; do not leave
  two dead day components implying a surface that isn't there. **Cost this session:
  two checkpoints of render analysis reasoned against dead `day-sidebar.tsx` before
  the mount was grepped** (LOG 2026-08-03).
- **`fallbackCorridor` produces a corridor node literally named "Rest day"** for a
  layover — it parses the label `"Rest day — X"` on `" — "` and takes the first
  half as the start-node name `[observed in the renderToString probe, 2026-08-03]`.
  The checkpoint-1 label caveat, now observed. **Harmless today** because a layover
  renders the `isRestDay` "Nearby" block, not that degenerate spine. Becomes visible
  only if a layover ever renders its spine, or if a waypoint is added to a rest day
  (turning it into an excursion `recomputeDay` would name from the label).
- **`pois_along_corridor` has no `LIMIT` and orders by `prominence_score`, not
  distance** `[read source: `supabase/migrations/…pois_along_corridor…`]`. Affects
  **every corpus fold**, not just rest days. At Moab all 12 returned rows tie at
  `prominence = 5`, so their order is arbitrary `[queried PROD, 2026-08-03]`. The
  rest-day path works around it client-side (`rankNearbySuggestions` re-ranks by
  `haversineMi` and caps at 10); other folds do not. A distance-order + limit in the
  RPC would fix it at the source — a migration, deliberately **not** done in #184.
- **Overlay survival on split / rest-day insert is UNIT-ONLY.** The live TEST
  instrument (`expedition-ms28y793`) has **empty `placeOverrides` / `placeRanks`**
  `[queried TEST, 2026-08-03]`, so the renumber's overlay-survival is exercised only
  by the `rest-day` / `split-day` unit tests, never against real overlays on TEST.
  Needs a trip carrying real overlays (or a synthetic fixture).
- **APPEND — extend a trip past its end. Not built.** Cheap now the machinery
  exists: one route call, no renumber (unlike a mid-trip insert). Deliberately out
  of #184's scope (it belongs at the end of the itinerary, not in a day's kebab).
- **Stale `overnight` on half A after a split.** `splitDay` leaves half A's
  `overnight` naming what is now half B's endpoint (authored content stays with A;
  the endpoint moved to M). Kept literal and flagged in #182; still open.

## Geometry defects (measured by the day-mile pass, 2026-07-26)

Both surfaced while scoping the generated-day mile defect; neither IS that
defect. Measurements and context:
[`docs/architecture/generation-pipeline.md`](architecture/generation-pipeline.md) §7.

- **`routePolyline` omits ~25% of a generated trip — the drawn route is
  incomplete.** On `expedition-ms28y793` the stored polyline decodes to
  **899 mi** against **1,200 mi** of claimed `day.miles` `[measured 2026-07-26]`.
  The 301-mile shortfall resolves exactly: `auditItinerary`'s `isOutAndBack`
  branch (`day.startPlace === day.endPlace`) sets `measuredMi = null` and
  **never routes the day**, so `dayPolyline` stays null and
  `concatDayRouteCoords` skips it `[read source: audit.ts, to-trip.ts]`. Six of
  fifteen days are start==end and their miles sum to **300** (1 mi rounding).
  Includes a 110-mile day-2 loop that contributes no geometry at all.
  **This one is genuinely visible on the map** — the line jumps between the days
  that do have geometry — unlike the mile-label problem, which is invisible
  there (§7.2). How the map renders that discontinuity was not checked
  `[UNVERIFIED]`. Note `day.miles` on those days is the LLM's *stated* value,
  never measured, so the 1,200 figure is itself ungrounded on 6 of 15 days.

- **63% of tiles belong to no node — three causes, only one mile-driven.**
  30 of 48 tiles on `expedition-ms28y793` appear in no `corridorCities[].placeIds`
  `[queried TEST]`. Every tile carries a mile, so all passed gate 1
  (`offsetMi <= bufferMi`); every orphan failed **gate 2**,
  `bestDist > maxAttachMi = 25` `[read source: corridor/bucket.ts]`. Measured
  gaps to the nearest node run **26.1 mi to 310.8 mi**. Re-deriving the spine and
  re-bucketing on a corrected line takes it to **17/48** `[measured]` — so:
  1. **mile inflation** — 13 tiles, fixable by correcting the line;
  2. **node sparsity vs `maxAttachMi = 25`** — measured max node gaps of
     148/119/106/104/103 mi (days 1/3/8/11/14). A tile at the midpoint of a
     148-mile gap sits 74 mi from both nodes and **cannot attach at any mile
     value**. 9 of 15 days have a gap whose midpoint exceeds 25;
  3. **round-trip degenerate spines** — days 7, 10 and 15 derive *both* nodes at
     mile 0, so any tile past mile 25 orphans unconditionally (5 of the 17).

  **The remaining 17 are structural and no mile fix reaches them.** Comparable
  in size to the defect that was being fixed, and previously unexamined — the
  63% figure sat in a baseline for two sessions without analysis. Needs a
  decision on `maxAttachMi` / spine density, not a mile correction.

## Grounding defects (found by the generation trace, #151)

- **`day.weather` is LLM-authored prose presented as measurement — a fabricated
  field in user-visible UI.** It is a `required` property of the LLM's output
  `json_schema`; the prompt payload contains no weather input; `auditItinerary`
  never reads or writes it; and there is **no weather or climate source anywhere
  in the repo**. It renders under a **WEATHER** heading carrying specific
  Fahrenheit ranges (observed on TEST: *"Arrive · Hot desert, 95–105°F"*), with
  no advisory marker and no provenance tag. This violates the standing grounding
  rule (*every field real or absent, never invented*). Three exits, not yet
  chosen: (a) drop the field from the schema and the render; (b) mark it
  advisory in the UI so it reads as a model estimate, not a reading; (c) back it
  with a real source — see the live-weather rescue item below, which would make
  the field honest rather than removing it. **A product call, not a code fix.**
  Full trace: `docs/architecture/generation-pipeline.md` §4.
- **`trip.weatherHiF`/`weatherLoF` are hardcoded `70`/`45` on every generated
  trip**, and `overnight.selected.detourMiles` is a hardcoded `0` — both numeric
  fields that read as measurements. Currently harmless *only because* their
  renderer is dead code (below); they are in the persisted payload and would
  become visible the moment anything mounted it.
- **`TripDetailHeader` is dead code.** `web/src/components/trip/trip-detail-header.tsx`
  is the only component rendering the `{weatherHiF}° / {weatherLoF}°F` pill and
  has **no call site** — superseded by `DayDetailOverview`. Two stale comments
  still reference it (`day-detail-corridor-column.tsx`,
  `imagery/mapbox-static.ts`). Deleting it also deletes the only consumer of the
  hardcoded pill values. Low risk, not done here (trace was read-only).
- **Tier-2 tiles are not deduped by `placeId` before `resolvedToTile`.** A place
  the LLM names as both a day endpoint and a key stop persists as two identical
  `segmentSuggestions` entries and appears twice in a node's `placeIds`
  (verified on `expedition-ms28y793` day 6). `stripNodeIdentical` does not catch
  it when the spine node's name differs from the place's Google `displayName`
  ("Bryce Canyon, UT" vs "Bryce Canyon National Park"). This is the documented
  "renders twice" outcome, so it is cosmetic, not a wrong-place bug.
- **A missing `GOOGLE_PLACES_API_KEY` degrades every generated trip invisibly.**
  `PlaceResolver.resolve` returns and caches `no-key`; every name that is not an
  exact pool match is dropped with a per-day flag, but the action still returns
  `ok: true`. No distinct error separates "no key" from "genuinely not found" at
  the action boundary. Worth a fail-fast check before the (paid) LLM call.

## Draft trips after the wizard swap — a loose end, not a bug (2026-07-28)

### Correction: `createUserWizardTrip` was NOT the only writer of `state='draft'`

Recorded because the premise was asserted during 4c scoping and disproved against
source. **Three live paths remain**, all `[read source, re-verified 2026-07-28
against post-4b/4c `main`]`:

| # | Writer | Trigger |
|---|---|---|
| 1 | `app/trips/actions.ts:80` `duplicateTrip` — inserts `state: "draft"` at :110 | `components/trips/trip-card.tsx:76` `submitDuplicate()` — the card's **Duplicate** control |
| 2 | `app/trips/actions.ts:16` `setTripState` — `.update({ state })` at :23 | `trip-card.tsx:358` `choose(next)` — the **StatePill** dropdown; `"draft"` is one of three user-selectable states |
| 3 | DB default `state text not null default 'draft'` (`20260513000000_init_identity.sql:63`) | **any** insert omitting `state` |

Writer 3 is currently unreachable in app code: the only other two inserts into
`public.trips` both set `state` explicitly — `app/api/trips/fork/route.ts`
(`"active"`) and `lib/plan/expedition-actions.ts:127` (`"active"`). It is a
latent default, not a live path.

### The loose end

**Nothing branches on `state === "draft"` anymore.** A repo-wide grep finds the
type union in two places and one comment — no behaviour keys off it `[grep]`.
Since #162 every card links to `/trips/{id}`, so a draft renders as an ordinary
trip carrying a "Draft" pill.

That is **coherent**, and it is deliberately recorded as a loose end rather than
a defect: drafts remain **creatable** while nothing consumes them **as drafts**.
The state is now a label the user can set and nothing acts on. Either give it
meaning or retire it — but decide, rather than letting it drift.

### The `NaN` header is narrower than it looks

The `NaN/NaN-NaN/NaN • 0 Days • 0 mi` slideup header affects only **dateless,
0-day** drafts. **No surviving path creates that shape**: `duplicateTrip` copies
a real `source.payload` (real days and dates), and `setTripState` only relabels
an existing trip. The instances are PROD's legacy rows — **7, LAST-KNOWN and NOT
currently measurable** (the Supabase access token is revoked and no PROD
credentials exist locally). Treat that 7 as last-known, not current.

## Orphans created by PR 4b — noted, not acted on (2026-07-28)

Both dropped to **zero importers across all of `web/`** when 4b deleted the
legacy components, and neither was in 4b's or 4c's scope
`[grep, re-verified 2026-07-28]`:

- `web/src/components/ui/checkbox.tsx`
- `web/src/lib/imagery/mapbox-static.ts`

Left deliberately. An unimported module is cheap, and deleting one is the kind of
decision that deserves a human check that no out-of-repo consumer depends on it —
the same posture taken for the vestigial `GooglePlaces` env var above.

**A third orphan, found 2026-07-31 — it is not a module, which is why the 4b
sweep missed it.** The hidden `<input type="hidden" name={`${name}Lng`}>` /
`` `${name}Lat` `` pair emitted by
`web/src/components/plan/location-autocomplete.tsx` has **zero consumers**.

- They fed the legacy 5-step wizard's finalize action, which **#166 deleted**.
  The component's docstring claimed they were still live until it was corrected
  in #178; the inputs themselves were deliberately left in place as unrelated
  cleanup.
- The sole remaining call site (`expedition-wizard.tsx`) is fully controlled — it
  reads the `onSelect` callback into React state and **never submits an HTML
  form**, so the emitted `dest-<uuid>Lat` / `dest-<uuid>Lng` keys go nowhere.
- `[grep across `web/src`, `web/scripts`, `data/`, `supabase/` for the form-data
  keys, for `FormData`/`formData.get`, and for both `@/…` and `../src/…`
  specifier forms, 2026-07-31]` — the only three `FormData` consumers in the repo
  are `app/auth/actions.ts`, `app/welcome/actions.ts`, and a comment in
  `selectable-chip.tsx`; none touch a `*Lat`/`*Lng` key.
- **Why it evaded the module-level sweep:** an orphaned *DOM attribute* has no
  import to count. The 4b lesson ("resolve both specifier forms, sweep every
  workspace") is about modules; this is a category the technique cannot reach.
- `docs/architecture/trip-creation-surfaces.md` justified these inputs as
  existing "for the legacy `GoingForm`" — corrected 2026-07-31, since that form
  no longer exists.

## Vercel Production env — measured 2026-07-27

All `[vercel env ls production]`. Names only; no values were read or printed.

- **`ANTHROPIC_API_KEY` is NOT set in Production — the only thing blocking a first
  PROD generation.** `ENABLE_PLANNER_WIZARD` is already set (and the wizard
  verifiably renders: `/plan/expedition` → 307 → sign-in on the public alias),
  so the code path is reachable and stops at `generate.ts`'s key check. It
  throws before the SDK import, so the failure is free — no Anthropic spend, no
  partial trip, no DB row. **Fix is one env var + a redeploy.**

- **`GOOGLE_PLACES_API_KEY` IS set in Production** (49d old, Preview+Production).
  Recorded because the obvious worry does **not** apply: the silent-degradation
  defect above (a missing key drops every tier-2 name while the action still
  returns `ok: true`) **will not bite the first PROD generation.** Tier-2
  resolution has a key to work with. The defect remains real; it is simply not
  armed on Production today. Re-check if that var is ever rotated or scoped away
  — nothing would tell you.

- **The `missing_key` error tells a PROD user to edit a file they do not have.**
  `generate.ts:60` throws *"ANTHROPIC_API_KEY is not set — add it to
  `web/.env.local` to run generation."* That string is developer-facing advice
  written for a local checkout, and it reaches the browser: the action returns
  `{ ok: false, error }` and the wizard renders `error` verbatim. On Production
  the fix is a Vercel env var and a redeploy — `web/.env.local` does not exist
  and could not help. Two sibling throws differ again (`edit.ts`: "required to
  parse edit requests"; `interpret.ts`: bare "is not set."), so the same
  condition surfaces three different messages. Worth one shared, deploy-aware
  string — and worth deciding whether raw internal env-var names should reach an
  end user at all.

- **`GooglePlaces` (70d, Production+Preview) appears vestigial.** It sits
  alongside the real `GOOGLE_PLACES_API_KEY`, and **nothing in `web/src` or
  `data/` reads `process.env.GooglePlaces`** `[grep]`. Likely a first-attempt
  name left behind. Not urgent and NOT auto-removable — an unread env var is
  cheap, and deleting a credential-bearing var deserves a human check that no
  out-of-repo consumer (a Vercel function, a cron, a script) depends on it.

## Schema & infra hygiene (found 2026-07-27)

- **Migration review gap — a table shipped without RLS and nothing caught it.**
  `public.mvum_roads` was created by `20260603010000_phase2_mvum_corridor.sql`
  with no `enable row level security`, while `master_place`, `source_record`,
  `place_match`, `legality_overlay` and `field_precedence` all enable it in their
  own creating migrations. No later migration picked it up, so it stood from
  creation until #154. **Treat this as a review gap, not a one-off:** nothing in
  CI or the migration workflow compares a new table against the RLS posture of
  its siblings, so the next one would land the same way.
  - **Cheap standing check:** sweep `pg_class.relrowsecurity = false` over the
    `public` schema and diff against an expected allowlist. Both projects are
    currently clean (`spatial_ref_sys` is PostGIS-owned and expected)
    `[queried catalog, TEST + PROD, 2026-07-27]`. This is one query; it belongs
    either in `drift:check` or in the `db:push-verify` wrapper, which already
    exists to catch migrations that report success without doing their work.
  - Related lesson already carried into the migration itself: **revoking function
    `EXECUTE` needs both the `from public` and the `from anon, authenticated`
    forms**, because a revoke against a grant a role never individually held is a
    silent no-op. See `supabase/migrations/20260727120000_mvum_roads_rls.sql`.

- **Migration history gap — PROD is missing `20260723120000_google_resolved_field_precedence`.**
  TEST has it; PROD does not, in both the ledger and the effect — the three
  `field_precedence` rows for `source_id = 'google_resolved'` are absent from PROD
  `[queried catalog, TEST + PROD, 2026-07-27]`. Note PROD's ledger and PROD's
  actual state **agree with each other**; the divergence is between PROD and the
  repo, so there is no phantom record to reconcile and no double-insert risk.
  - **No current operational impact:** PROD has zero `google_resolved`
    `source_record` rows and cannot accumulate them under current code, since both
    callers of `enqueueResolvedPlaces` refuse unless the project resolves to TEST.
  - **The risk is latent.** `web/src/lib/itinerary/ingest.ts` states that enabling
    PROD write-back needs "its own flag + a PROD `field_precedence` apply" — this
    migration *is* that second prerequisite, and it must be in place **before** the
    first such record lands, or a solo-resolved place promotes with attribution
    `{}` and violates the "never display a field without its attribution"
    invariant. Noticed, not investigated further, not applied.

- **Vercel env audit — UNCHECKED and not visible from source.** On TEST,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the local dev env file held a **secret** key
  rather than the publishable one. Fixed locally and the key rotated. `NEXT_PUBLIC_*`
  is inlined into the client bundle by Next, so the same swap in a deployed
  environment would ship a secret key to browsers.
  - **Whether Vercel's preview/dev environment has the same swap is `[UNVERIFIED]`** —
    dashboard environment variables are not in the repo and cannot be read from
    source. PROD's local env file was correctly configured (publishable anon key,
    separate secret service key), which is evidence about the local file only, not
    about Vercel.
  - Worth a one-time audit of every `NEXT_PUBLIC_*` value in every Vercel
    environment, checking the key **prefix** (`sb_publishable_` vs `sb_secret_`)
    rather than assuming the variable name implies the value.

## Wizard swap — ALL FIVE CODE STEPS MERGED (2026-07-27); 4b/4c gated on PROD

> **STATUS UPDATE 2026-07-27 — this section is no longer forward-looking.**
> #159, #160, #161, #162 and #163 are all merged
> `[gh pr list --state all]`. The scoping below is kept because it is the record
> of *why* the sequence was ordered as it was, and because 4b/4c have not run.
> Current position and the two remaining gates live in
> [`STATE.md`](STATE.md); the one blocker is `ANTHROPIC_API_KEY` missing from
> Vercel Production (see §"Vercel Production env" above).

### Corpus capture on PROD — deliberately still gated

#163 removed the TEST-only rail from the trip write but **kept it on the
`enqueueResolvedPlaces` call site**, so the first PROD generation will produce a
trip and **zero `google_resolved` rows**. That is intended, not a bug.

The two writes have different shapes and only one of them changed:

| | Trip write | Corpus write-back |
|---|---|---|
| Client | session (`authClient`) | **service-role** |
| Target | `public.trips`, owner's own row | `source_record` — **shared, curated** |
| Enforced by | `trips_insert_owner` (`auth.uid() = owner_id`) | nothing — RLS on, **zero policies**; `upsert_source_record` is SECURITY INVOKER |

`ingest.ts`'s own docstring sets the bar for opening it: *"a PROD corpus write
would need a SEPARATE deliberate gate (its own flag + a PROD `field_precedence`
apply)"*. Neither exists, and PROD carries zero `google_resolved` rows. Promotion
to `master_place` would still be a manual `materialize` either way — this gates
**capture**, not promotion. To open it later, decide the flag and apply
`field_precedence` on PROD first; see
[`decisions/2026-07-23-corpus-writeback-dormant.md`](decisions/2026-07-23-corpus-writeback-dormant.md).

### Original scoping (retained)

The legacy 5-step wizard is to be **replaced** by the expedition (LLM) wizard.
Generation will **require sign-in**, so a generated trip is an owned, editable,
findable `public.trips` row — the same shape a fork already produces. Trips created
by the legacy wizard can be discarded; the anon `TRIPS` store is deleted, not
replaced. Client-side surface trace:
[`architecture/trip-creation-surfaces.md`](architecture/trip-creation-surfaces.md).

**NOT BLOCKED ON AUTH — corrected 2026-07-27.** This section previously read
*"THE BLOCKER — nothing below can move until this is resolved … TEST has no Google
provider configured and PROD's provider is disabled."* The first half of that
claim holds; **the second is false**, and it was recorded from a verbal report
without an evidence tag or a check.

Actual provider state `[queried Management API config/auth, 2026-07-27]`:
**TEST has no Google provider configured. PROD has Google enabled, with a client
id and secret set. Email is enabled on both projects.** So **sign-in works on PROD
today** and the sequence below is not gated on standing up auth infrastructure.

**What remains is a UI gap.** Google OAuth is the only wired method
(`web/src/app/auth/actions.ts` exports only `signInWithGoogle` and `signOut`; the
sign-in page reads "Google · only sign-in method for v1"), and a repo-wide grep
for `signInWithPassword`, `signInWithOtp`, `signUp`, `verifyOtp`,
`resetPasswordForEmail` and `signInAnonymously` returns **zero hits in `web/src`**
`[grep]`. Whether to ship Google-only or build a second sign-in form is a
**product decision**, not a prerequisite. Note `app/trips/layout.tsx` still
carries its user gate **commented out** ("Re-enable the user gate when OAuth is
back") `[read source]` — that comment is now stale on the same grounds, and the
two gates should move together.

**Scriptable dev login already works — confirmed, not inferred.**
`external_email_enabled` is `true` on TEST `[queried Management API config/auth,
2026-07-27]`, which is what the committed `signInWithPassword` scripts depend on
(`mint-dev-session.ts`, `seed-test-user.ts`, the three `verify-trip-*.ts`
harnesses). Account *creation* in those scripts uses `admin.createUser`, which
bypasses provider config and therefore proved nothing on its own; the sign-in call
is the part that needed the API to confirm it. Only friction is the ~1h session
expiry already in CLAUDE.md §RUNBOOK.

Sequence, smallest first, each independently mergeable:
1. **Auth gate on `/plan/expedition`** — page-level `getUser()` → redirect to
   `/auth/sign-in?next=…` (the repo's existing `next=` convention), plus a
   `getUser()` check in `generateExpeditionTripAction` returning a clean error
   (the `node-actions.ts` `guard` pattern). Purely additive.
2. **Move the write target** — service client → session-scoped client for the trip
   write, `reference_trips` upsert → `trips` insert using the fork route's exact
   column set (`owner_id`, `reference_id: null`, `title`, `state: "active"`,
   `payload`), id from the DB default. **No migration or RLS change is needed** —
   `public.trips` already has the id default, the `state` check and all four
   owner-scoped policies `[queried catalog]`. The generated payload already carries
   baked `corridorCities`, so no bake step is required `[queried TEST]`.
3. **Entry point + landing** — repoint the root CTA from `/plan` to
   `/plan/expedition`; flip `ENABLE_PLANNER_WIZARD` where it should be live.
4. **Legacy removal** — routes, legacy-only components, `buildDaySuggestions` (and
   transitively `suggestions-for-segment.ts`), and the anon `TRIPS` store.

**Ordering constraint — partially discharged 2026-07-27.** As written, this said
*"legacy must survive until the expedition path is both flag-on and linked."*
**Both of those now hold**: `ENABLE_PLANNER_WIZARD` is set in Vercel Production
and `/plan/expedition` returns 307 → sign-in there (flag-on, verified), and #161 +
#162 made it the only linked path (linked, `[grep]`).

**The constraint still binds anyway**, on a condition the original wording did not
name: flag-on and linked prove the wizard *renders*, not that it *generates*. With
`ANTHROPIC_API_KEY` unset in Production, no PROD generation has ever succeeded —
so legacy is still the only creation path demonstrated to work there. **4b's real
gate is a successful PROD generation plus a verified post-sign-in return**, not
reachability. Step 4b remains strictly last. It also overlaps the
reference-fixture removal residual (both delete the `TRIPS` store); do not start
them independently.

Two known defects ship with the first PROD generation, accepted knowingly (see
#163's PR body): **no degradation signal reaches any component**, and generated
trips carry **inflated `milesFromStart`** (~2.18×; fix parked unmerged on
`fix/generated-day-miles`). Note the degradation defect's worst case — a missing
`GOOGLE_PLACES_API_KEY` — is **not** armed on Production: that var is set
(§"Vercel Production env").

## Client boundary — which operations need service-role (settled 2026-07-27)

Scoping input for the wizard swap's step 2. All `[queried catalog, TEST]` unless
noted.

- **The corpus write-back question is SETTLED: `upsert_source_record` fails at
  RLS, not at grants.** The function is SECURITY INVOKER, so under a user JWT it
  executes as `authenticated`. `EXECUTE` *is* granted to that role, and
  `authenticated` holds full table privileges on `source_record` — but
  `source_record` has **RLS enabled with zero policies**, so every statement is
  denied. **A `GRANT` therefore changes nothing;** only a policy (or service-role)
  would. Consequence for step 2: **the action needs a service client for corpus
  feedback regardless of what the trip write uses.**
- **`preComputeFacts` creates its own service client internally** and does not
  receive one from the action (`web/src/lib/itinerary/facts.ts`,
  `const supabase = createSupabaseServiceClient()`) `[read source]`. It is
  therefore **unreachable by any change to the action's client** — changing the
  action does not change how the two corpus folds in Stage 1 authenticate.
- **The corpus READ works session-scoped.** `pois_along_corridor` is SECURITY
  DEFINER owned by `postgres`, with `EXECUTE` granted to `anon` and
  `authenticated`, so it bypasses RLS on `master_place` by design — its own
  comment calls it "the only consumer door into master_place". Verified returning
  rows under a real `authenticated` JWT.
- **`fetchCorpusForPolyline` swallows every failure into `[]`** — see
  `docs/architecture/generation-pipeline.md` §8 for why that matters.

## Auth configuration — measured, and what's left (2026-07-27)

All `[queried Management API config/auth, 2026-07-27]`.

- **Provider state.** TEST has no Google provider configured; **PROD has Google
  enabled** with a client id and secret set. **Email is enabled on both.** This
  corrects a claim carried in three docs that PROD's provider was disabled — see
  §Wizard swap.
- **TEST `site_url` is `http://localhost:3000`, but the dev server runs on 3210.**
  Left alone deliberately — only `uri_allow_list` was in scope for the authorized
  write. Recorded as a remaining mismatch: anything that redirects via `site_url`
  rather than an explicit `redirectTo` will land on the wrong port in dev.
- **TEST `uri_allow_list` was empty and is now `http://localhost:3210`** (authorized
  write, TEST only). PROD's list already contained `localhost:3210`, `localhost:3000`,
  the prod origin and the preview glob — the reverse of what you'd expect.
- **A minimal PATCH had a side effect.** Sending a body of exactly
  `{"uri_allow_list": …}` to TEST also flipped **`custom_oauth_max_providers`
  from `3` to `32767`** — a field that was not in the request. Not reverted (that
  would be a second unauthorized write). Recorded because it means
  **`PATCH /config/auth` cannot be assumed to change only what you send**; diff
  before/after on any future config write.
- **Both projects run built-in SMTP** — every `smtp_*` field is null (no host,
  user, sender or credentials). **`rate_limit_email_sent` is `2` on both; the unit
  is not present in the payload** and is deliberately not supplied here. Measured
  behaviour: two sends inside ~10 minutes tripped the limiter, and the window had
  reset ~81 minutes later `[tested on TEST]` — bounds, not the actual window.
  `mailer_autoconfirm` is `false` on both, so email confirmation is required — but
  **the magic link itself satisfies it**: verifying flips the user to confirmed and
  creates the `email` identity in one step `[tested on TEST]`.
- **Built-in SMTP delivery on TEST — state this precisely, the distinction decides
  what PR 4 must prove.** It delivered to **at least one address**
  (`acwcreative@gmail.com`, arrived, link read, `?code=` confirmed) and **failed
  for one** (`adam@acwcreative.com` — accepted, quota spent, never arrived).
  - So built-in SMTP is **not systemically broken** on TEST, and it is **not**
    restricted to the account-owner address — `adam@acwcreative.com` *is* the
    Supabase account owner address, which makes its failure stranger rather than
    more explicable.
  - **Why one address fails is `[UNVERIFIED]`.** Do not round this up to "built-in
    SMTP delivers to external addresses"; that is stronger than the evidence and
    would let PR 4 ship without proving the case that actually failed.

Two operational gotchas found while testing the magic-link path
`[tested on TEST, 2026-07-27]`:

- **GoTrue rejects undeliverable domains at the API boundary, before any user
  lookup happens.** Both `@overlander.test` and `@example.com` were refused with
  `400 email_address_invalid` from `POST /auth/v1/otp`. The seeded
  `@overlander.test` accounts exist only because the **Admin API bypasses that
  validation** — `admin/users` accepts what `/otp` will not. **Consequence: no
  future email or magic-link path can be smoke-tested against a fake domain.**
  Exercising it end to end needs a real deliverable address, which on built-in
  SMTP means a real inbox. Budget for that when the work is scoped; do not assume
  a throwaway address will do.
- **`admin/generate_link` + `/verify` exercises the VERIFICATION path only — NOT
  the redirect path. CORRECTED 2026-07-27; the original claim here was mine and it
  was wrong.** It previously read "exercises the identical path", which is false in
  the way that matters: **admin-generated links carry no PKCE `code_challenge`**,
  because the challenge is produced by the *client* calling `signInWithOtp`. So
  GoTrue falls back to the **implicit** flow and redirects with a `#fragment` a
  server route cannot read — while a real client-initiated link redirects with
  `?code=` `[tested on TEST]`. Using `generate_link` to design a callback would
  have produced the wrong architecture.
  - **Still true and still useful:** it sends no mail, spends none of the
    `rate_limit_email_sent` budget, and correctly exercises verification, user
    creation and identity behaviour. It is the right tool for those.
  - **Not usable for:** redirect shape, `?code=` vs `#fragment`, or anything that
    depends on the PKCE handshake. Use the real client path
    (`web/scripts/test-magic-link-pkce.ts`) for those.
  - `generate_link` alone changes no state — the user record only moves at
    `verify`.

- **`signInWithOtp` fails SILENTLY when mail is not delivered — must be handled in
  PR 3, not discovered in production.** Measured `[tested on TEST]`: a send to
  `adam@acwcreative.com` returned **no error**, the rate limiter **counted it**
  (the next send was refused with `email rate limit exceeded`), and **nothing ever
  arrived**. Nothing anywhere in the call surfaces the failure.
  - A magic-link UI built naively on this tells the user "check your inbox" and is
    lying, with no signal available to the app to know better. That is the same
    class of defect as the generation path's dropped `note` — a failure the code
    cannot see.
  - There is no delivery receipt available at the API boundary, so the UI cannot
    truthfully promise arrival. Copy and retry affordance should be designed for
    that, and a real SMTP provider's own delivery logs become the only place a
    failure is visible.
  - Cause of that one address's failure is **`[UNVERIFIED]`** — see §Auth
    configuration.

## Decision records carrying stale factual claims (swept 2026-07-27)

`docs/decisions/` is append-only by convention, which is right for *reasoning* but
means **factual assertions inside a record silently outlive their accuracy**. A
sweep of all 12 records for claim-shaped statements — call counts, named callers,
flag values, existence/absence of a code path — found **7 with at least one stale
claim**. Only the most damaging was corrected this session; the rest are recorded
here, **not fixed**.

The failure mode is specific and worth naming: a record that says *"verified,
still true on `main` <sha>"* is the one most likely to be trusted without
re-checking, and is therefore the most dangerous when it ages.

Ranked by how misleading, most first:

- **`2026-07-24-cross-day-stop-movement.md`** — asserts, emphatically and with a
  re-verification stamp, that there is **no windowing/virtualization**, "no
  `IntersectionObserver` mount/unmount, no scroll-driven mounting anywhere", and
  that Design A is "scoped but NEVER BUILT — you are building it from scratch".
  Design A shipped the next day (#146). `continuous-day-stack.tsx` exists and uses
  `IntersectionObserver` `[grep: 3 references]`. The cited line anchors have also
  drifted.
- **`2026-07-23-search-architecture-resolved.md`** — states the corpus holds
  "1,749 searchable rows … zero rows above 34.5°N" as a claim about *the* corpus.
  Those are **TEST** numbers; PROD is the real corpus and spans the full corridor.
  Two of the file's own "revisit when…" trigger conditions have therefore
  **already fired**, so a reader trusting it concludes the question is still
  parked when it is not.
- **`2026-07-20-place-card-order-is-route-derived.md`** — its *correction* block
  is now itself wrong: it says the drop index "does not" exist and is only
  *derivable*. `computeInsertIndex` was subsequently built and is wired into both
  the drag preview and the authored drop `[grep: `lib/corridor/insert-index`,
  imported by `day-detail-node-blocks.tsx`]`.
- **`2026-07-18-living-plan-productionization-scope.md`** — `checkRails` no longer
  exists as a symbol (split into `checkManualRails`/`checkNlRails` over a shared
  `checkRailsWithFlag` in `lib/itinerary/rails.ts`) `[grep: no `checkRails`
  export]`, and the flag claim is wrong for the paid surface: the NL path this
  document is *about* is now gated by `NEXT_PUBLIC_NL_EDIT`, not
  `NEXT_PUBLIC_LIVING_PLAN_EDIT`. Its §4 ungating plan is written against a flag
  that no longer governs that path. **Its substantive risk claims all still hold**
  — `usage` still discarded, `REGEN_BUDGET = 2`, no spend/quota infrastructure
  anywhere.
- **`2026-06-02-land-status-and-dispersed-camping-sources.md`** — Status says "no
  code, ingestion, or schema has been written against it yet". All three now
  exist (`padus.ts`, `usfs.ts`, three migrations, `lib/esri.ts`).
- **`2026-05-21-offline-tile-caching-architecture.md`** — Context says "no
  existing service worker … or PWA scaffold" in the present tense; both exist.
  One downstream item is half-done: the `web/CLAUDE.md` non-goals cleanup removed
  the offline entry but left "Active turn-by-turn navigation".
- **`2026-07-23-typesense-collection-per-env.md`** — minor: describes the old
  `places` collection as retained-and-safe-to-delete; it was deleted 2026-07-23.

**Verified clean:** `2026-07-23-corridor-rollback-by-id-snapshot.md`,
`2026-07-23-pinned-er-fixture.md`, `2026-07-23-place-identity-and-ordering.md`,
`2026-07-25-continuous-day-detail-scroll.md`,
`2026-07-25-reference-trips-db-first.md` (the most accurate in the set — every
count and line anchor checked out; one cosmetic nit, it says `FIXTURE_TRIPS` where
`fixtures.ts` exports `TRIPS`).

**Corrected this session:** `2026-07-23-corpus-writeback-dormant.md` — see its
superseded block. It asserted zero callers; there are two, and it was cited as
authoritative during the client-boundary investigation and produced a wrong
conclusion.

**Two candidate conventions, neither adopted:**
1. Scope factual claims at write time — "as of `<date>`/`<sha>`" — so an aged
   claim reads as a snapshot rather than a standing fact. Cheap; the records that
   already do this (`corridor-rollback`, which writes *"Measured on TEST before
   Slice-1"*) are the ones that did not go stale.
2. Prefer linking to the architecture doc over restating the fact, so there is one
   home to update.

## Deferred / parked
- **dnd-kit `SortableContext`** — parked. Pointer-vs-rect (`computeInsertIndex`)
  was chosen instead, no model change. Revisit only if pointer-vs-rect proves
  insufficient. (See STATE.md §Parked.)

## Someday / unscheduled
- **`reorderWaypoints` was dead — deleted in STEP 2; id-based only if a consumer
  returns.** The index-based `reorderWaypoints` (repo) + `reorderWaypointsAction`
  pair had NO consumer (live drag-reorder goes through `node-actions`/`localRanks`
  fractional `placeRanks`, not waypoint-index splice). Both were deleted rather
  than converted, removing a conflict-class (b) `refuse` path entirely instead of
  fixing it. IF a waypoint-reorder consumer is ever added: implement it id-based
  ("move waypoint X before waypoint Y"), NEVER index-based — position-splice
  corrupts against any changed list (a stale client view reorders the wrong pair),
  and id-based lands in class (a) so its write can `retry`/compose. Same lesson as
  `placeRanks` being keyed by placeId, not position.
- **Wizard form-actions can't surface `TRIP_CONFLICT`** — the four void
  `writeWizardSlice` callers in `plan/actions.ts` (`addStopAction`,
  `removeStopAction`, `saveStopsAction`, `toggleSuggestionAction`) are consumed as
  `<form action={…}>` server actions returning `void`, so a `refuse` conflict has
  no return channel. `addStop`/`removeStop`/`toggleSuggestion` stay on-page and the
  trailing `revalidatePath` re-reads fresh state, so a dropped edit shows as absent
  and the user retries.
- **KNOWN LOSSY PATH — `saveStopsAction` silently drops the `avoidHighways`
  toggle on a `refuse` conflict.** Unlike its stay-on-page siblings, it `redirect`s
  to the loader after the write, so a conflict advances the wizard having dropped
  the toggle with no signal. Do NOT call this benign: it only looks harmless at
  today's 9 single-owner trips — exactly the light-usage reasoning the `version`
  column exists to stop relying on. Fix: convert the stops page to `useActionState`
  so the `refuse` conflict has a return channel and surfaces `TRIP_CHANGED_ERROR`
  (same treatment the three `FormState` wizard steps already got).
- **Reference trips render a remove ✕ that always fails** — the read spine shows
  the ✕ on waypoint tiles for reference trips too, but `removeWaypointAction` on a
  slug hits the in-memory `TRIPS` fixture (`repository.ts:184`), misses a DB-only
  reference trip, and returns *"Could not remove stop."* A visible control that
  cannot work. Reference trips are read-only templates (fork-to-edit), so the ✕
  should not render on them. Fix: pass `isReference` from `trip-slideup-body.tsx`
  into `DayDetailCorridorColumn` (`:337` currently omits it) and gate the remove
  control on `!isReference`. (Separate from the frozen-trip *server* guard, which
  is now `checkNotFrozen`.)
- **`applyPlaceOverrides`: insert by mile, not append** — today a re-homed place is
  appended to its node's `placeIds` (`bucket.ts:112-122`), so "server order" is mile
  order for auto-bucketed picks but pin order for overridden ones. That makes an
  unranked cluster's display order depend on pin sequence. Inserting the override at
  its along-route mile instead would make server order == mile order everywhere, so
  unranked display order stops depending on how you pinned. Touches verified
  attachment code (`bucketPlacesIntoCorridor`/`applyPlaceOverrides`) — needs the
  Phase-1 bucketing re-verification, not a drive-by.

- **`CATEGORY_COMPATIBILITY` has no keys for `restaurant`, `grocery`,
  `car_repair`** (`data/entity-resolution/matcher.ts:162-201`). With the
  google_resolved category fix landed, food/grocery resolutions now carry a
  correct *stored* `primary_category`, but `lookupCompatibility` returns 0 for
  those categories, so they can never `name_dominant`/auto-link and accumulate
  as isolated `master_place` rows (one per resolution, no dedup). Given how much
  itinerary content is food, extending the matrix (add restaurant/grocery/
  car_repair rows + cross-compat to any OSM/pipeline equivalents) is worth
  scoping. Not in the google_resolved-category PR.

- **`materialize`'s final Typesense-sync stage fails (DNS `ENOTFOUND`) from a
  network-restricted context** — the DB stages (entity resolution + promotion)
  run and commit FIRST, then the last stage syncs `*.typesense.net`. From a
  sandboxed/egress-restricted environment that host doesn't resolve, so the run
  exits non-zero AFTER the corpus writes have landed: `master_place` is updated
  but the search index is NOT. Net effect — a `materialize` run from a
  restricted context leaves **Typesense stale** (DB and index diverge) while
  reporting failure. Mitigations today: run `materialize` from a machine that
  can reach `*.typesense.net`, or run `npm run -w data search:sync` separately
  afterward to reconcile the index. Worth scoping: make the sync stage a
  distinct, separately-resumable step (or a preflight reachability check) so a
  DB-successful run isn't reported as a total failure and the index gap is
  explicit. Surfaced 2026-07-23 during the google_resolved end-to-end proof.

- **No dev sign-in path — verifying any authed browser surface needs a hand-minted
  cookie every time.** The UI offers Google OAuth only, and TEST has no Google
  provider configured, so exercising a `canEdit`/RLS surface in a real browser means
  minting a Supabase SSR session server-side and injecting the cookie by hand — a
  throwaway script each session (done again during the NL flag-split verify, PR #126).
  Options: a dev-only `/auth/dev-login` route, or a committed helper script that mints
  and prints the cookie. The route is cleaner. Its guard MUST be the TEST-ref check
  (the same `ref !== znldzjdatkogdktymtvi` gate `checkRails` uses), NOT a flag — so it
  is structurally incapable of existing in prod, flag misconfiguration notwithstanding.
  **PARTIAL (2026-07-25):** the helper-script half now exists —
  `web/scripts/mint-dev-session.ts` (TEST-ref-guarded, prints the cookie JSON;
  used for the continuous-scroll authed verify, #146). CAVEAT it documents: this
  machine and the TEST auth server disagree by ~1h, so the printed session's
  `expires_at` must be patched to local-now before injecting or `@supabase/ssr`
  force-refreshes (and 401s once the refresh chain goes stale). The
  `/auth/dev-login` route remains the cleaner endgame.

- **SEED-ID PINS ARE INVISIBLE TO THE READ SPINE (view mode)** — surfaced during
  the #146 authed verify. **Pre-existing, NOT introduced by the continuous
  scroll — established by direct A/B on `main` vs the branch, same trip, same
  drag** (an earlier "proof" by running `applyPlaceOverrides` on raw stored state
  was BAD METHODOLOGY and is retracted: it tested the function, not what the
  component receives). Observed: on a FRESH SERVE both `main` and the branch
  render the pinned place under its ORIGINAL node — the durable behaviour is
  identical and wrong on both. (What DOES differ post-edit is recorded as its own
  item below.) A cross-node
  drag-pin in the edit spine mints a `nodeSeed` ("promoted") and writes
  `placeOverrides[].nodeId` as the **seed id** (`seed-<city>-<suffix>`), but the
  baked `Day.corridorCities` carry **plain slug ids** and the read spine
  (`DayDetailCorridor` / `applyPlaceOverrides`) never consumes `trip.nodeSeeds` —
  so the override dangles (inert per the documented semantics) and the pin
  renders in its ORIGINAL bucket in view mode, while the edit spine (seed-aware
  projection) shows it re-homed. Same-node rank writes use the plain cc id and
  DO render in view. Fix directions: teach the view spine to resolve seed ids
  (inject promoted seeds into the render spine, as the edit spine does), or bake
  seed nodes into `corridorCities` at write time. Touches verified bucketing
  code — needs its own pass, not a drive-by. **Scoped as its own PR** (Adam,
  2026-07-25): it cannot ride inside #146, whose tripwire forbids the read spine
  consuming `nodeSeeds`.
  **↔ DEPENDENCY (both ends):** landing this **dissolves** the post-edit
  divergence recorded below, because server truth and the optimistic list then
  agree. When it lands, **revert the continuous stack to server truth** —
  `placeOverrides={trip.placeOverrides}` / `ranks` from `trip.placeRanks` in
  `renderViewDay` (`day-detail-corridor-column.tsx`), which is the build spec's
  original rule and drops the optimistic coupling from the view path.

- **Seeded TEST password hardcoded in 4 tracked scripts of a PUBLIC repo —
  DECIDED: ACCEPT, DO NOT ROTATE (Adam, 2026-07-25).** Not an oversight; a
  considered accept. Do not re-litigate without new facts.

  **The credential:** `const PW = "…"` in `web/scripts/seed-test-user.ts`,
  `verify-trip-collapse.ts`, `verify-trip-step4.ts`, `verify-trip-version.ts`
  (both seeded users share it). Surfaced by the #146 hygiene sweep. Permanent in
  git history, so stripping HEAD would not undo the exposure — only rotation
  would.

  **Why accept — measured blast radius** (read from
  `supabase/migrations/20260513000000_init_identity.sql` + the Phase-1 corpus
  migration, not assumed):
  - `public.trips` — owner-scoped RLS, so **only that account's own trips**.
  - `public.users` — its own row only.
  - `public.reference_trips` — read only, and the policy is `using (true)`:
    **anon can already read it without any credential**, so the password adds
    nothing.
  - `public.master_place` / corpus — **nothing**. RLS enabled with *no policies*;
    service-role only.
  - PROD — **nothing**. Scoped to the TEST ref `znldzjdatkogdktymtvi`.

  TEST holds no real user data. Weighed against that: rotation costs four script
  edits plus a cascade-risky user update (below). Not worth it.

  **⚠️ CASCADE HAZARD — read this before ever rotating.** `trips.owner_id` is
  `references public.users(id) **on delete cascade**`. Rotating by
  delete-and-recreate the seeded users **destroys the seed harness trip AND the
  66-day TEST fork `05b346df-3bb5-4c46-8ff1-e0c5cfe26301`**. Any real rotation
  must add an `admin.auth.admin.updateUserById(id, { password })` path to
  `seed-test-user.ts` — its current existing-user branch only *looks the user up*
  and never updates the password — and switch all four scripts to
  `process.env.SEED_PASSWORD`. CI is unaffected either way (it runs the data
  suite + web typecheck + build; never the seed or verify scripts).

  **FORWARD RULE (binding on new code):** TEST seed credentials come from **env**,
  never committed literals. The four scripts above are **grandfathered**; new
  scripts are not. `web/scripts/mint-dev-session.ts` is the pattern to copy — it
  reads `SEED_PASSWORD` and refuses to run against a non-TEST project ref.

- **POST-EDIT VIEW DIVERGENCE — RESOLVED in #146 by passing the optimistic
  trip-level values; REVISIT when the seed-id fix above lands.** Recorded because
  the resolution is a deliberate spec deviation with a scheduled undo, not a
  finished story. Original divergence (measured A/B, same trip + same drag,
  editMode asserted by the toggle's own label):
  | | fresh serve | in edit, after drag | after Done (view) |
  |---|---|---|---|
  | `main` | original node | re-homed | **re-homed** |
  | #146 branch | original node | re-homed | **original node** |

  Cause: `main`'s view render passes the OPTIMISTIC `localOverrides`, which
  survive the editMode toggle because `DayDetailCorridorColumn` stays mounted;
  the windowed stack passes server-truth `trip.placeOverrides` per the build
  spec ("values cross the bridge, machinery does not" — optimistic machinery
  deferred to PR2). Where the two disagree is exactly the seed-id case above:
  the persisted override cannot resolve, so server truth renders the pre-pin
  position. **Neither is durable** — `main`'s re-homing is a transient illusion
  that also reverts on reload; the branch was arguably more honest but showed the
  revert one step earlier, which reads as "my edit was lost".

  **RESOLUTION (Adam, 2026-07-25): option (b)** — the stack passes the optimistic
  trip-level values (`localOverrides` / `ranksMap`), handlers still undefined.
  Reasoning: this PR is presentation-only, so matching `main` IS
  behaviour-neutrality; a pin that snaps back on Done makes the refactor
  blameable for a defect it did not cause, and `main`'s falseness is the
  pre-existing pin bug, already tracked above. Re-verified after the change —
  all three points match (`original` / `re-homed` / `re-homed` on both).
  **↔ UNDO CONDITION:** when the seed-id fix above lands, revert
  `renderViewDay` to `trip.placeOverrides` / `trip.placeRanks` (the build spec's
  original rule). This item closes at that point.

- **`find_master_place_candidates` is not exercised end-to-end by the ER corpus
  run** — the phase3a D4 `beforeAll` calls `reset_phase3a_test_state`, leaving
  `master_place` empty, so `matchAll` runs in `skipRpcs` rematerialize mode
  (`matcher.ts` — RPC skipped, candidates come from in-memory
  `plannedMasterPlaces`). The populated-`master_place` PostGIS candidate lookup
  is therefore covered only by `matcher.test.ts` mocks and the 3b synthetic
  `recompute` (a different RPC), never by a real populated-corpus `matchAll`.
  **Pre-existing** — true of the old prod-derived seed too, NOT introduced by the
  pinned-fixture change (docs/decisions/2026-07-23-pinned-er-fixture.md). Worth a
  dedicated test that seeds a small resolved corpus (non-empty `master_place`)
  and runs an incremental `matchAll(delta)` so the RPC path runs for real.

- **`enrich.ts` HONESTY PASS — the trip-waypoint detail panel still fabricates**
  (`web/src/lib/trips/enrich.ts`). The detail-honesty pass (#85) made the
  browse/search path into the slide-up panel honest — `browsePlaceToWaypoint`
  surfaces every field real or absent. The OTHER path into the SAME panel — a
  trip waypoint already added to a day, enriched via `enrichWaypoint` — was
  deliberately left untouched and still invents, per the "Guisados"-card
  comparison: the reliability score ("81 GOOD RELIABILITY / computed from 2
  sources" is `75 + hash(slug,…)` / `2 + hash(slug,…)`, not computed); the "IF
  YOU STOP HERE" stop time (heuristic 45m); a ~$15–25 entrée (canned per
  category via `ENTRY_BY_CATEGORY`); planned/with-stop ETAs and "arrive at St.
  George at 1:20 PM" (hardcoded/derived); "DAY 2 UNAFFECTED" (asserted); and
  Local Eats / Sit-down / Cash-OK tags + the DATA SOURCES trio (the slug-hashed
  `*_BY_CATEGORY` maps — which even list `iOverlander`, a banned source). This
  violates the grounding invariant (every field real or absent) on a surface
  users see, so it ranks HIGHER than its age suggests. **THE FORK — record
  both, do not pick:** (a) strip the fabrication so trip-waypoint cards match
  the honest browse cards — consistent and honest, but thinner; (b) keep the
  rich "if you stop here" impact layout and rebuild it on REAL routing data —
  real detour and arrival impact, now feasible with Mapbox routing (the same
  routing the directions panel uses). Under (b) the reliability score and canned
  tags would still need real backing or stay out.

- **FED-MERGE LIVE-PROVENANCE GAP — merged live rows lose their DATA SOURCES
  section** (`web/src/lib/trip-browse/merge-corpus.ts`). `mergeCorpusIntoPool`
  folds the federated corpus into a day's live-discovered pool via a coord+name
  `sameSpot` match; on a match CORPUS WINS and only `photoUrl`/`photoAlt` are
  backfilled from the live twin — NOT `mention.secondary`. When the winning
  corpus row (`mapMasterPlaceRow`) has null/empty `attribution`, its `secondary`
  is `""` (`federated.ts:176`), so `realDataSources` (`card-stats.ts:191`)
  returns `[]` and the panel's DATA SOURCES section is omitted entirely — even
  though the matched live row carried real provenance ("Google ·
  OpenStreetMap"). Honest (absent provenance → no section, not fabrication) but
  a real gap, and the most prod-visible of these: the corpus fold feeds
  `day.segmentSuggestions`. Fix: on a corpus-wins match, backfill `mention`
  (and/or `attribution`/`overlanderTags`) from the live twin the same way the
  photo already is. Note: the note that surfaced this filed it under
  `USE_FEDERATED_POIS`; the verified provenance-drop is in the
  `USE_FEDERATED_CORRIDOR` corpus fold (`plan/actions.ts:216-233`) — the
  browse-route `USE_FEDERATED_POIS` merge is purely additive
  (`[...liveTagged, ...federated]`) and does NOT drop live provenance.

- **GPS-ORIGIN LABEL on the no-GPS directions fallback**
  (`web/src/components/trip/directions-panel.tsx:126`). For a route-to-place
  search result (`dayRelative === false`), the route origin is
  `routeTo ? position ?? legStart : legStart` — with no GPS fix it silently
  falls back to the day-start (`legStart`), yet the panel presents a live "from
  now" arrival ETA (`:49`, `:230-233`) that frames the route as departing from
  the user's current position. Nothing labels the origin as the day-start
  rather than "here," so the no-GPS case (the common web-planning case — noted
  as such at `:195`) mislabels where the route starts. Small, cosmetic,
  honest-labelling issue. Fix: label the origin when it's the day-start fallback
  (i.e. when `position` is null), so the route/ETA don't imply a live-location
  departure that isn't happening.

- **Live-weather integration — RESCUABLE from PR #24 (salvage, not rebase).** OpenMeteo
  forecast + climatology fallback (`src/lib/weather/` + `src/lib/trips/resolve-weather.ts`)
  is a genuine unmerged feature: **ABSENT from main** — only the `Day.weather` placeholder
  field exists, not the live fetch. PR #24 sits ~400 commits behind; **do NOT rebase it**
  (it would fight 400 commits of drift). Rescue by SALVAGE: lift the weather lib and
  re-wire it into `DayBriefingCard` — its original hook `suggested-section.tsx` was
  deleted in the 2026-07-12 one-day-renderer refactor. Kept open as PR #24 with the same
  note; this entry is what keeps it from reading as a dead stale PR. (Triage 2026-07-24.)

- **Finish reference-fixture removal** (follow-up to the getTrip DB-first flip,
  branch `refactor/reference-trips-db-first`). The flip made reference trips
  serve from `reference_trips`; the `TRIPS` fixture no longer shadows the DB but
  the reference literals still sit in the module. To fully remove them: empty
  `seed()` of the reference literals, reroute `ensureAlaskaUpgraded`'s 4
  waypoint-helper callers (`repository.ts:94,108,120,181`, which read
  `TRIPS["la-to-deadhorse"]`) to the DB reader, then delete `ensureAlaskaUpgraded`,
  and drop `la-to-portland` from `FIXTURE_TRIPS` in
  `api/trip-browse/[tripId]/[dayId]/route.ts` (so it goes live/federated instead
  of the curated `BROWSE_PLACES` catalog — verify the browse path still resolves).
  **Open question that decides its size (investigate before scoping):** are those
  4 helpers pure lookups, or does any back a WRITE? A DB reader returns a fresh
  object, so rerouting a write path silently no-ops. **Likely wants to land with
  or after the remove-✕ affordance gating** — same in-memory write paths. Do NOT
  bundle on tired assumptions; every dig this session found another coupling.
  Note: `TRIPS` must SURVIVE this — it is also the anon-wizard store (below).
  **DOC:** this removes the "4 residual `ensureAlaskaUpgraded` reads" and the
  "literals still sit in `TRIPS`" claims — update
  `docs/architecture/trip-resolution.md` (§ `TRIPS`' current role) in the same PR.
- **`TRIPS` is the anon-wizard persistence layer** (not just reference fixtures).
  `createTrip` (`plan/actions.ts:786`, anon finalize, gated `ENABLE_PLANNER_WIZARD`)
  writes `trip-<8char>` drafts into the `globalThis`-pinned `TRIPS` store;
  `listAnonTrips` lists them (`id.startsWith("trip-")`); the repository slug-write
  paths edit them; `getTrip` resolves them (last, after the DB reference readers).
  Ephemeral — lost on server restart, never persisted to Supabase. Not part of the
  reference-trip migration; recorded so the next person doesn't mistake it for
  dead fixture code. Deleting the `TRIPS` module would remove this feature.
- **Plotting-on-map architecture (deep dive)** — an ARCHITECTURE REVIEW that
  intra-day map plotting waits on, NOT a feature ticket. Today the map plots only
  day start/end pins and user waypoints; day-detail items (corridor cities, curated
  picks) are never plotted. Before building intra-day plotting, the map's plotting
  architecture needs a dedicated design pass.
  - **Already measured (verified from source 2026-07-25 — carry forward, do not
    re-derive):**
    - Every PIN is a `mapboxgl.Marker` DOM instance in `map-column.tsx` — day-end
      pins (default color) plus waypoint pins built as hand-rolled category-colored
      DOM elements (`CAT_SVG` icon map). The route line is a GL layer (`map.on("load")`
      source+line); there is NO GeoJSON source+layer for POINTS anywhere.
    - Open call: DOM markers vs GeoJSON source + symbol/circle layer. Not settled.
      The argument is CHURN (markers created/destroyed per `?day=` transition), NOT
      raw volume.
    - Volume/day: corridor cities ~2–6 (`CorridorCity`, soft cap `max_nodes=4`
      intermediate per corridor-cities-spec); `Day.segmentSuggestions` capped at
      `MAX_SEGMENT_SUGGESTIONS` (`routing/day-suggestions.ts`); legacy `Day.suggestions`
      ~5–8. Fuel/camp/food are CATEGORY values (`category` on waypoints/picks), NOT
      distinct item kinds; fuel additionally lazy-fetches per day via
      `FuelStopCard` → `/api/trip-browse/{tripId}/{dayId}?category=fuel` and is NOT in
      the Trip payload.
    - Coordinates: `CorridorCity.coords` and `BrowsePlace.coords` are REQUIRED, real,
      sourced (gazetteer / corpus / Google). `Waypoint.coords` is OPTIONAL and the map
      already skips the coordless ones (`if (!wp.coords) continue`). `NodeSeed`
      "re-projection" computes an along-route MILE scalar from a real pin — it does NOT
      synthesize map coordinates. So there is no approximated-onto-route case; grounding
      holds by construction (omit, never approximate).
    - Test-data caveat: reference-derived trips populate `Day.suggestions` but NOT
      `Day.segmentSuggestions` (`placePool` in `day-detail-corridor-column.tsx`), so the
      66-day fork likely shows ~5–8 items/day. A regenerated trip is needed to exercise
      the `MAX_SEGMENT_SUGGESTIONS` cap.
  - **Questions the deep dive must answer:**
    - DOM markers vs GL source+layer, and what the migration costs if it changes.
    - WHICH day's items are plotted. Prior lean was CENTERED-DAY-ONLY driven by the
      `?day=` param — the same channel that drives `flyTo` — so the map never learns the
      scroll window. Confirm or revisit, but preserve the constraint that the map does
      NOT know which days are mounted.
    - Marker ↔ detail-list highlight linkage. A design was described to this session
      as living in `OVERLANDER_STYLE_GUIDE.md` (per-type marker colors + an Active POI
      State, 22px → 35px, double-ring glow) — but NO such file exists in the repo, and
      that spec text is in NO tracked file (verified 2026-07-25). What DOES exist:
      `DESIGN.md` carries the marker tokens (`--pin`/`--marker`/`--pin-border`) and the
      per-category color roles the current DOM markers already use — but no Active-POI-
      State / marker-highlight spec. The deep dive's FIRST step is to locate the real
      source (likely a Paper artboard, where this project's designs live) before treating
      the 22px→35px/double-ring detail as settled.
    - Interaction with the continuous-scroll settle-debounce (the scroll→`?day=` sync in
      the Design-A continuous day-detail scroll).

- **DEFINE "yoTrippin Verified" — what it means and what earns it.** Needs a
  **product decision before it can be scoped.** The label currently on place
  cards is a **PLACEHOLDER**: it presents Google Places data under a yoTrippin
  name. That is a deliberate interim choice, **not a bug**. What is missing is a
  definition — what does yoTrippin actually verify, and what earns the badge?
  - **Current mechanical state** `[verified this session — see
    docs/architecture/place-render-model.md §5]`: the `verified` prop **defaults
    to `true`**; **no call site on the day-detail card surface passes it**; **no
    `verified` field exists** in `BrowsePlace`, `Waypoint`, or `CorridorPlace`;
    therefore **no code path can set it false**. Distribution: **0 true / 0 false
    / 100% undefined in data; 100% true at render.**
  - **The concrete defect, independent of how the definition lands.** Because the
    gate never closes, the label renders on tiles carrying NO Google data at all:
    - **Klondike River** — no `placeId` field whatsoever; a corpus tile whose row
      has no `google_place_id`, so it can never enrich.
    - **Fixture waypoints** — the displayed rating is a stored constant, not a
      fetched value.
    So even under the "Google Places renamed" reading, the label is applied to
    things that are not that. True regardless of what "Verified" ends up meaning.
  - **Open question — the parameters.** Candidate inputs, **none decided**:
    source tier (corpus-materialized `mp:` vs live-resolved `google:` vs
    LLM-suggested); presence of required fields vs inferred/defaulted ones;
    coordinate confirmation against a second source; freshness / last-checked
    date of the underlying record; human ground-truthing — someone has actually
    been there.
  - **Binding design constraint.** "Verified" is a provenance assertion, and the
    project rule is **every field real or absent**. Whatever the definition,
    **it must be capable of being false** — otherwise the badge carries no
    information and is decoration wearing the costume of a claim.
  - **Known dependency.** There is currently **no field in the tile types to hang
    this on**. Any real definition likely requires a **new field on the tile
    schema** — which per prior decisions sits at the grammar ceiling and needs
    deliberate planning, not casual addition. Scope this only **after** the
    definition exists.

- **Empty-pool trip on PROD — is it user-reachable?** Two PROD `public.trips`
  rows share the title "Tok, AK to Dawson, YT":
  `24f14ecc-a209-45e7-a414-16ecc816bab0` is populated (63 tiles, 2 days) and
  `81865432-7a18-4f18-beaa-d6d95e6da249` has an **EMPTY pool** (0 tiles).
  `[queried PROD, 2026-07-26]` Open question: **is that row user-reachable, and
  if so what does it render?** Nobody has looked. Not investigated — recorded.
  When picked up: **read-only; PROD writes are not authorized.** Row facts live
  in `docs/DATA_INVENTORY.md`.

- **TEST fork vs PROD `segmentSuggestions` discrepancy — the fork may not
  represent the shape it stands in for.** TEST fork `05b346df…` carries **0**
  `segmentSuggestions` (its pool is 43 `day.suggestions` + 92 `waypoints`), while
  the PROD equivalent carries **63**. **Reason UNVERIFIED.** Consequence: the
  TEST fork may not represent the reference-derived shape *as actually served on
  PROD*, which affects its value as a test instrument — see the instrument
  caveat in `CLAUDE.md` §RUNBOOK gotchas and
  `docs/architecture/place-render-model.md` §2.

- **PLACES ENRICHMENT: EMPTY vs MISSING IS INDISTINGUISHABLE — LARGELY RESOLVED
  BY [#149](https://github.com/honkinsickle/overlander/pull/149) (merged
  2026-07-26).** Status first so this stops reading as open: the route now emits
  resolved-but-empty `{}` instead of dropping it (`if (rich)`), which **closes
  the retry leak described below** on both paths and gives the client a
  distinguishable signal. Google's not-found shape was verified in the process
  (invalid id → HTTP 400 → `null`), so failures remain separable. Mechanics and
  the accepted trade now live in
  `docs/architecture/place-render-model.md` §4.3. **Still open from this item:**
  the UX copy decision (next item), and the retry-ceasing leg is `[UNVERIFIED]`
  by observation. The body below is retained as the original analysis.
  The original
  premise was **WRONG** and is corrected here. *(No prior BACKLOG item existed to
  replace — the diagnostic was only ever referenced in session prompts and in
  `place-render-model.md` §7.)*
  - **Original premise (RETRACTED).** An earlier session found day-2 of
    `expedition-ms28y793` returning **0 of 3** from `/api/places/details` while
    day-13 returned 3 of 3, and inferred a population of dead or never-verified
    `placeId`s.
  - **What measurement found** `[swept 2026-07-26, both trips, 2 batched calls]`:
    - `expedition-ms28y793` (TEST): **43 of 44** id-bearing tiles resolved
      (97.7%); 4 tiles carry no `placeId`.
    - `24f14ecc-a209-45e7-a414-16ecc816bab0` (PROD): **60 of 60** (100%); 3 tiles
      carry no `placeId`.
    - **Day-2's three ids ALL RESOLVED on re-measurement.** The earlier 0/3 was
      **TRANSIENT**. Cause **UNVERIFIED**.
    - **No cluster, no scatter** — one failure across 104 id-bearing tiles is an
      absence of the phenomenon, not a distribution.
    - **No differential** between the corpus path (`mp:`) and the live-resolution
      path (`google:`). Nothing localizes to one path.
  - **Why a transient blip looked permanent.** On FAILURE `placeDetails` returns
    `null` and the route calls `cacheSet(id, null)`, cached **15 minutes**
    (`CACHE_TTL_MS`). One momentary upstream error is replayed as failure for the
    rest of that window. `[read source: app/api/places/details/route.ts:20,84-86]`
    Worth remembering as a general property of this endpoint.
  - **SETTLED — empty results ARE cached, as `{}`.** `placeDetails` returns an
    object built entirely of conditional spreads, so a 200 with no rich fields
    yields **`{}`, not `null`** (`google-places.ts:333-347`). The route then runs
    `if (!cached) cacheSet(id, rich)` — unconditional on the *value*, and
    `cacheSet(id, value: PlaceRich | null)` accepts either — so `{}` is stored
    under the same 15-minute TTL. A subsequent request inside the window hits
    `cacheGet`, re-drops it from `details`, and **does not call Google**.
    `[read source: app/api/places/details/route.ts:35-53, 84-89]`
  - **The actual finding — a MEASUREMENT defect, not a data defect.** The single
    failure, `ChIJJeKtgR9ySYcRa30K1fgPrTw` ("Chimney Rock", day-10, `curated`,
    `google:` prefix), is a **REAL LIVE PLACE**. Queried Google directly: HTTP
    200, id matches exactly, coordinates match the stored tile exactly,
    `displayName` "Chimney Rock". It carries no `rating`, no `userRatingCount`,
    no `photos`, no `priceLevel`, no hours, and `types: ["route"]` maps to no
    category. So `placeDetails` builds `{}` and the route drops it via
    `if (rich && Object.keys(rich).length > 0)`. **Therefore the endpoint reports
    "this id is dead" and "this place exists and has nothing to add" IDENTICALLY
    — both as a missing key.** Neither ordinary staleness nor a grounding
    violation: a third thing nobody had named.
  - **Why it matters disproportionately for this product.** Field-poor places —
    routes, natural features, trailheads, river access, dispersed sites — are
    exactly what an overlanding product drives past. Google has nothing to say
    about them and never will. The ambiguous case is not an edge case here; it is
    a substantial share of the corpus.
  - **THE THREE STATES** (the basis for any UI decision):
    1. **No `placeId` at all** — can never enrich, correctly. TEST's 4 are `mp:`
       corpus rows with `mention.secondary` `"osm"`; PROD's 3 are water features.
       **Klondike River** is the canonical example.
    2. **Resolves, nothing to add** — **Chimney Rock**. Real place, empty response.
    3. **Genuinely fails** — measured at effectively zero.

    States 1 and 2 are **honest thinness**. Only 3 warrants error treatment, and
    it barely occurs. An "Offline / Limited Data" indicator would have fired
    wrongly nearly every time.
  - **~~LIVE BUG~~ — retry leak (client-side only; billing is capped). FIXED by
    #149** — kept for the analysis; the guard behaviour described here is what
    the fix exploits. Failures
    never enter the client cache: `setHydrated` merges only RETURNED keys, so a
    failed id leaves `hydrated[id]` `undefined`. The guard is
    `t.placeId && !t.photoUrl && !hydrated[t.placeId]`, so the id **re-fires on
    every mounted-set change, indefinitely**.
    `[read source: day-detail-corridor-column.tsx:306-345]`
    - **CLIENT-SIDE: real regardless.** The browser issues a POST containing
      those ids on every windowing change — network, battery and latency cost on
      a device used in the field.
    - **BILLING: capped, NOT recurring-billable.** Because `{}` and `null` are
      both cached (above), the server absorbs the retries: at most **one upstream
      Google call per id per 15-minute TTL window, per server instance**. Caveat:
      the cache is in-process (`globalThis.__placeDetailsCache`, LRU
      `CACHE_MAX_ENTRIES = 1000`), so cold starts and evictions re-fetch — the cap
      is per instance per window, not a global guarantee.
    - **Scope.** `hydrated` is React state on the parent column, **ephemeral per
      session**, persisted nowhere — so there is nothing to clean up
      retroactively and a reload clears it. That is also why this **recurs rather
      than accumulates**.
  - **Nothing distinguishes "not yet fetched" from "fetched and returned
    nothing"** — both are `hydrated[id] === undefined`. No negative cache, no
    error state, and per `place-render-model.md` Part 2 no loading or error state
    in the slideup either.
  - **~~Proposed fix (NOT authorized here — separate PR)~~ — SHIPPED as #149**,
    in the minimal form: the endpoint stops dropping `{}`. The "stop
    re-requesting for a long interval" half was deliberately NOT taken — TTL was
    left at 15 minutes because the client-side repeat was the actual cost and
    this removes it (reasoning in the #149 PR description). Original text: Have the endpoint
    distinguish resolved-but-empty from not-found, and let the client stop
    re-requesting the former for a long interval — **not permanently**: a
    dispersed site or small business can gain a Google listing later, and a
    permanent cache would leave the app silently wrong with nothing to flag it.
    Kills the retry leak, caps the spend, gives the UI an honest signal.

- **UX: honest copy for thin places (supersedes any "Offline / Limited Data"
  framing).** No such entry previously existed; recorded now because the
  three-state taxonomy above changes what the question even is. The distinction
  is **not connectivity** — it is whether Google has anything to say about the
  place. For states 1 and 2 (no `placeId`; resolves-but-empty) the honest copy is
  something like *"Google has no listing for this place"* rather than a blank
  slot or an "Offline" indicator that misattributes the cause. For state 3
  (genuine failure, measured at effectively zero) show **no indicator** — it is
  too rare to design around and indistinguishable from state 2 until the endpoint
  separates them (see the proposed fix above). Depends on that fix landing first.

> **STATUS UPDATE 2026-07-31 — the truncation is FIXED; this entry is retained
> for its reasoning, not its status.** Shipped as **#176**: `parsePlaceIds` no
> longer slices, and the route chunks every id at `BATCH_SIZE = 40`
> (`web/src/app/api/places/details/batch.ts`, new file — the tripwire below did
> not anticipate it). The cap was **not** raised and nothing was reordered by
> proximity, as the scoping required. Everything below about *what 40 protected*
> and *why ordering is the wrong tool* still governs the next change to this
> route. **The fix introduced one new defect — see "Unbounded request size"
> below.** The three-batch case (91 ids) still has **no instrument**; see the
> synthetic-fixture entry.

- **`MAX_IDS = 40` truncation — MEASURED 2026-07-28, and it is narrower than this
  entry used to claim.** `parsePlaceIds` dedupes then `.slice(0, 40)` with **no
  error and no signal**, and the hydration effect re-fires only on mounted-set
  change (dep array `[hydrateKey]`; `hydrated` deliberately excluded with an
  `eslint-disable`) `[read source: app/api/places/details/route.ts` —
  `MAX_IDS`, `parsePlaceIds`; `day-detail-corridor-column.tsx` — `hydrateKey`
  and the hydration `useEffect]`.
  - **Scrolling windows do NOT exceed the cap.** `alaska-south-final` (19d)
    scrolled end to end in a live browser with instrumented `fetch` and a live
    API key — **directly measured**: **19 requests, max 28 ids, zero over 40**,
    totalling 142 ids against 142 distinct on the trip (perfect accumulation,
    zero aborts). `yotrippin-demo` (19d) was window-sampled and replayed offline
    — **simulated**: 11 requests, max 23. Only the first is a measurement.
    Fast-scrolling the same trip (~200 ms/step) inflates this to 27 requests /
    203 ids because the effect's `() => ctrl.abort()` cleanup cancels in-flight
    requests and their ids are re-asked — larger requests, still peaking at 28.
  - **The real failures are single-day and windowing-independent.** Four days on
    PROD `la-to-deadhorse` (**91** / 57 / 57 / 42 distinct eligible ids) and one
    on `dawson-vancouver-cassiar` (42) exceed 40 on their own. Any window
    containing day 1 requests ≥ 91 cold, because supersets only add — and a first
    request is always cold, so accumulation cannot help it. On day 1 that is
    **51 dropped ids, all of which render as visible cards** (day 1 has zero
    curated tiles → `curatedMode` false → nothing collapses behind "Explore
    more"), and none of the 51 carries a stored `rating` or `reviewCount`, so
    they render with no photo *and* no rating.
  - **It recurs on every fresh open, not once per user.** `hydrated` is plain
    `useState({})` inside `DayDetailCorridorColumn`; closing the slideup tears
    the component down (the close control lands on `/` with a fresh document), so
    reopening starts cold and re-drops the same ids `[measured 2026-07-28: open
    → select day 1 → 28 ids; close → reopen → select day 1 → 28 ids again]`. The
    15-min server `cacheStore` does not help — it sits *behind* `parsePlaceIds`,
    so a dropped id is **never looked up**, whether or not it happens to be
    cached from an earlier window in which it survived the cut.
  - **The trips this entry used to name cannot trip it.** `24f14ecc` is exactly
    **40 distinct** against a cap of 40 — a boundary, not a margin; one more
    corpus row on either day truncates it. `expedition-ms28y793`'s whole-trip
    union is **39**. The prior "41 tiles on day-1, so a ~3-day window exceeds 40"
    was wrong on both counts (41 is the pool, not the eligible set; `24f14ecc`
    has only 2 days).
  - **`MAX_IDS = 40` is unexplained.** No comment; introduced in `79c8cb2`, whose
    message never mentions it; never modified since; the two sibling routes use
    50. It is **not** an upstream batch limit — `placeDetails` issues one Google
    `GET` per id and the route runs `Promise.all`, so 40 bounds *this route's own
    fan-out and per-request cost*, nothing external.
  - **Recommendation: chunk server-side** — batch the ids 40 at a time inside the
    route. It removes the drop, holds fan-out at today's ceiling, leaves the
    response shape unchanged, and **does not touch the hydration effect's
    dependency array** (the guarded thing). Do **not** raise the cap until
    someone establishes what 40 protected. Ordering by proximity to the centered
    day is the wrong tool: the measured failures are single-day, so ordering does
    nothing for the only case that breaks.
  - **Tripwire for the fix:** touches `app/api/places/details/route.ts` only
    (`POST` and `parsePlaceIds`), plus a test. Zero diff required in
    `day-detail-corridor-column.tsx`, `continuous-day-stack.tsx`,
    `lib/trips/continuous-scroll.ts`, `lib/discovery/google-places.ts`, the two
    sibling hydrate routes, and anything under `lib/itinerary/`. Any shape that
    needs the effect's dep array raises the risk class of the whole change.
  - **Signalling truncation needs no response field** and nothing would consume
    one: the client builds `placeIds` and the cap is a deterministic prefix, so
    `placeIds.length > 40` is the signal locally. Diffing sent ids against
    returned `details` keys would be worse — `details` also omits ids that
    resolved `null`, reintroducing exactly the ambiguity #149 removed.
    **Caveat on the local check:** it requires the client to hardcode `40`, which
    lives server-side in `route.ts` and is not exported. That is a duplicated
    constant with no link between the copies — move the cap and the client's
    inference goes silently wrong rather than failing. If a client-side check is
    ever wanted, export the constant rather than retyping it; if chunking lands
    server-side the client never needs to know, which is one more reason to
    prefer it.
  - Measurement detail: `docs/architecture/place-render-model.md` §4.4.1.

- **Option (a) — fix the bake (`fix/generated-day-miles`). PARKED, and LOWER
  urgency after [#170](https://github.com/honkinsickle/overlander/pull/170), but
  not closed.** The branch carries a `where === "keyStop"` via filter +
  `placeId`-keyed role merge in `bake.ts` (12 unit tests, mutation-checked) and
  `check-payload-invariants.ts`. Remote tip `37faabb`, **still no PR**.
  - **Why urgency dropped:** #170 pointed the read spine at coordinate
    projection, so **nothing renders the bad miles any more**. The stored field
    is inert at every surface that used to trust it.
  - **Why it is not closed:** **new generations still write the inflated field.**
    Every trip created from now on accumulates a payload column that is wrong and
    that nothing validates. That is a data-quality debt, not a render bug.
  - **What it would and would not buy:** the via filter removes ~6% of the
    inflation (2.25× → 2.18× against the direct line) — the dominant term is
    key-stop vias being genuine off-route excursions in LLM emission order, which
    the filter does not touch. So (a) makes stored miles *less wrong*, never
    trustworthy. Anything that re-trusts them after (a) is still wrong.
  - **Do not pair it with a backfill.** A backfill after (a) writes miles measured
    on the 1,960-mi corrected line while the read path projects the 899-mi direct
    one — trading a loud disagreement for a silent one. Detail:
    `generation-pipeline.md` §7.
  - Merge check `[2026-07-28]`: `37faabb` merges onto `main` with **one
    comment-only conflict** in `stretches.ts` (the known divergence — take main's
    paragraph); its 12 tests pass on the merged tree.

- **Day 9's backtrack stop renders ABOVE the "Start" node — a design question,
  not a bug.** On `expedition-ms28y793` day 9 (Richfield → Torrey, *not* a
  round-trip day) Fremont Indian State Park projects to `-23mi`: its nearest point
  on the trip line falls before the day begins. Post-#170 it keeps that true
  position — so it sorts ahead of the Start node — and claims no mile
  `[measured 2026-07-28, rendered DOM]`.
  - That is geometrically honest: the stop **is** behind you. But nothing else in
    the product puts content above a Start node, so it reads as novel.
  - The alternatives are both worse on their own terms: clamping to `0mi` asserts
    it sits at the day's start (false by 23 miles), and dropping it to the
    fallback block hides a real stop. Left as-is deliberately; decide the
    treatment, don't "fix" the position.

- **Harness output is not literal DOM — `verify-projection-delta.ts` does not
  model the anchor split.** The harness feeds every curated pick to
  `buildSpineItems` as a key stop. The app first routes picks matching
  `coincidesWithAnchor` into a **featured card under the start/end city node**,
  so they never reach the spine as separate entries.
  - Observed divergence: on `expedition-ms28y793` day 6 the harness prints
    `80mi Bryce Canyon National Park` as its own spine row, while the app renders
    it as a featured card under the `Bryce Canyon, UT` end node at 81mi
    `[measured 2026-07-28, rendered DOM]`. Same user-visible outcome (destination
    last), different structure.
  - Consequence for whoever next reads harness output: treat it as a projection
    check, not a render snapshot. If the anchor behaviour ever needs asserting,
    that is a browser check, not a harness change.

## Surfaced 2026-07-31 (the planning-region / chunking session)

- **Badge gate on `placeId` — SHIPPED as #216 (2026-08-13, merged to `main`).**
  Gates the "yoTrippin Verified" badge on whether the tile carries a
  `placeId` at all. This was the *mechanical* half only; it does **not**
  answer what the label means — that question is still open. Kept below
  struck-in-spirit (not deleted) since the reasoning that motivated the
  narrower gate over the fuller enrichment-gated version still documents a
  real decision, not just a shipped fact.
- ~~Badge gate on `placeId` — DECIDED and SCOPED, unbuilt.~~ Gate the "yoTrippin
  Verified" badge on whether the tile carries a `placeId` at all. This is the
  *mechanical* half only; it does **not** answer what the label means.
  - **Tension to resolve first, deliberately flagged rather than buried:** the
    older `DEFINE "yoTrippin Verified"` entry above closes with "Scope this only
    **after** the definition exists." This entry scopes a gate before that
    decision. The justification is that the gate is **strictly a narrowing** — it
    can only *remove* the badge from tiles that demonstrably carry no Google
    data, which is true under every candidate definition. If that reasoning does
    not hold for a reader, the older entry wins and this one waits.
  - **Why NOT the fuller, enrichment-gated version** — rejected on two
    independent grounds, both worth keeping because each alone is sufficient:
    1. **Measured ~506 ms of flicker** `[measured in an earlier session — NOT
       re-verified 2026-07-31]`. Gating on *enrichment* means the badge cannot
       resolve until `/api/places/details` returns, so it pops in after paint.
       Gating on `placeId` resolves synchronously from data already in hand.
    2. **Provenance is already destroyed one component above the render.**
       `hydratePlaces` grafts with `rich.rating ?? t.rating`, so by the time a
       tile reaches the badge there is **no way to tell a fetched rating from a
       stored constant** — the enrichment gate would be reading a field that has
       already lost the distinction it depends on. Documented mechanically as
       "the merge is explicit and lossy" in
       `docs/architecture/place-render-model.md` §4.1; the *provenance*
       consequence is the part that is new here.
  - Do **not** implement this by adding a `verified` field to the tile schema —
    per the older entry, the schema sits at the grammar ceiling.

- **Unbounded request size at `/api/places/details` — introduced by #176.**
  Removing `.slice(0, MAX_IDS)` removed the **only** bound on how many ids a
  caller may send. `[read source, 2026-07-31]` `parsePlaceIds` rejects non-object
  bodies, rejects a non-array `placeIds`, type-checks every element is a
  non-empty string, and dedupes — but does **not** bound array length, validate
  id *format*, or bound body size. `BATCH_SIZE = 40` is fan-out only; the loop
  iterates all ids, so N ids still mean N upstream `GET`s, just 40 at a time.
  - **Not currently exploitable, and the distinction matters:** the only caller
    is the app's own hydration effect, whose id set is bounded by what a day
    holds. **That is a property of the client, not of the endpoint.** The route
    is a public `POST` and nothing about it enforces the bound.
  - Deliberate, not an oversight — the fix's brief was "do not raise the cap,"
    and adding a *different* cap was out of scope. Recorded so the next person
    sees it as a known edge rather than rediscovering it.
  - If bounded later, it should **413/400 explicitly**, not silently truncate —
    the silent drop is exactly what #176 removed.

- **`USE_FEDERATED_POIS` is unset, so the browse route's corpus merge never
  runs.** `[read source, 2026-07-31]` Read once, at
  `web/src/app/api/trip-browse/[tripId]/[dayId]/route.ts`, as
  `process.env.USE_FEDERATED_POIS === "true"` — no default, so unset is `false`.
  It gates two things: the Supabase client is never constructed, and the
  per-category fan-out early-returns before `fetchFederatedPois`
  (`lib/trip-browse/federated.ts`). Consequence: the `pois_along_corridor` RPC is
  never issued from this route and no `master_place` row enters the merge.
  - **Whether it is set in Vercel Production is `[UNVERIFIED]`.** No committed
    file records it — there is no `vercel.json`, `web/.env.local.example` does
    not mention it, and the "Vercel Production env — measured 2026-07-27" section
    above enumerates other vars but not this one. **Check the dashboard before
    concluding anything about production behaviour.**
  - **Do not confuse it with `USE_FEDERATED_CORRIDOR`** — a *separate* flag
    (`lib/trips/reference.ts`, `lib/trips/bake-corridors.ts`) gating the corpus
    fold into `segmentSuggestions`. The source is explicit that flipping one
    cannot affect the other's surfaces. "The corpus half of trip-browse" means
    the **browse-day route's** merge specifically; the corpus reaches day-detail
    by the other lever.
  - This narrows the FED-MERGE entry above, which reasons about the browse-route
    merge being "purely additive" — a merge that never executes is not additive,
    it is absent.

- **`yotrippin-demo` — its `corridorCities` describe a different route than its
  day labels. CAUSE UNESTABLISHED.** Recorded as an observation, not a diagnosis.
  - **Not checkable from this repo** `[grep, 2026-07-31]`. The trip exists only
    as a DB row: the sole source reference is `DEMO_TRIP_ID` in
    `web/scripts/generate-itinerary.ts`, whose `DEMO` input holds **four anchors**
    (Chicken AK → Dawson City → Watson Lake → Vancouver BC) and no days — days
    and `corridorCities` are pipeline *outputs*. There is no committed fixture or
    snapshot for it (`.alaska-snapshot.json` is a different trip). **Diagnosing
    this requires a DB query.**
  - **Discount it as an instrument until this is understood.** It is already
    known to be a July 12–13 generation that ran **without `dayRoutes`** (no
    polyline, `coords` on 1 of 19 days), and it was **de-linked 2026-07-31**.
    Measurements taken against it may be measuring that breakage.

- **Synthetic fixture to replace the de-linked instruments — RECORDED, not
  built.** `docs/DATA_INVENTORY.md` states the cost of de-linking and says the
  replacement is "separate work"; this is that entry. Counts live there — do not
  restate them here.
  - **One fixture covers both lost cases.** A day carrying **~90
    `placeId`-bearing tiles** and **no curated flags** is simultaneously the
    three-batch chunking case (90 ids → three `BATCH_SIZE = 40` batches, the case
    `4534add5` cannot reach at 45) and the **`curatedMode = false`** render mode
    (zero curated tiles → nothing collapses behind "Explore more", everything
    renders inline). They were only ever separate because they happened to live
    on the same real trip's day 1.
  - **Synthetic, not a live trip, and that is the point.** Both properties are
    incidental to any real itinerary, so a live trip can lose them to a reseed.
    A fixture makes them **stated invariants** of the instrument.
  - Ids need not resolve — the chunking path is exercised by id *count*. A
    fixture of non-resolving ids also exercises the `null`-cache path, but see
    the 15-minute negative cache in `CLAUDE.md` before drawing conclusions from
    it.

- **land_manager / manager_type / designation / gap_status — SCOPED, NOT
  BUILT. LOW PRIORITY.** PAD-US's normalizer (`data/ingestion/sources/padus.ts`)
  already extracts these four fields into `source_record.normalized_payload`,
  but neither a `master_place` column nor a `field_precedence` row exists for
  any of them — confirmed directly against the migrations, not inherited from
  an earlier report. Full proposal from a 2026-08-18 investigation pass (not
  written to a `docs/` file — this entry is the durable record):
  - Four new TEXT columns on `master_place`. `field_precedence` at **priority 1
    (PAD-US authoritative)**, deliberately NOT the amenities-style
    lowest-priority gap-fill pattern — PAD-US has no competing validated source
    for land ownership (RIDB's agency signal only covers 5 federal agencies and
    is already consumed elsewhere as an `overlander_tags` tag), and PAD-US is
    already the documented primary source for this data per the 2026-06-02
    land-status/dispersed-camping ADR. If anyone considers changing this to a
    low-priority gap-fill row later, re-read that reasoning first — it's not an
    oversight.
  - Touches `recompute_master_place`, the `pois_along_corridor` RPC (new
    migration), and both `federated.ts`/`mapMasterPlaceRow` and `hydrate.ts` —
    no existing UI slot, this is new render work, not a reconnect like
    `capacity`/`amenities` were.
  - Open, unresolved: `gap_status` (GAP 1-4 protection-tier codes) needs
    plain-language display copy before it can be shown to a user (e.g.
    "Permanently protected" vs. raw code) — a product decision, not yet made.

- **`recompute_master_place` never clears a field back to null — only
  overwrites when a new value exists. LOW-TO-MEDIUM PRIORITY, currently
  render-harmless but real.** Found during NPS amenities normalization
  (commit `b03450d`): the function's `IF v_value IS NOT NULL` guard skips
  the UPDATE entirely when `resolve_field()` finds no winning source for a
  field — so if a place's field previously had a real value and every
  source's value for it changes/disappears (e.g. a source gets
  renormalized and no longer maps to any recognized category), the OLD
  value stays stranded in `master_place` instead of being cleared.
  - **Confirmed harmless today, not confirmed harmless generally.** 14
    `master_place` rows hit this exact case for `amenities`
    post-NPS-renormalization — `attribution.amenities` correctly cleared to
    reflect "no source resolves this anymore," but `master_place.amenities`
    itself still holds the old raw blob. Verified render-harmless
    specifically because the stale blob's keys have zero overlap with the
    current `AMENITY_LABELS` set, so the render translator produces `[]`
    regardless — but this was a coincidence of the specific data involved,
    not a property of the fix.
  - **Deliberately not patched as part of the NPS work** — fixing
    `recompute_master_place` itself is higher blast radius than a
    normalizer change (it's shared across every field/source, per the
    master_place invariant restricting writes to that column to only go
    through this function). Needs its own scoped pass: likely an explicit
    clear (`SET field = NULL`) branch when `resolve_field()` returns no
    candidate, not just skipping the UPDATE.
  - Any future work that touches this function, or any field whose sources
    might stop resolving (a source renormalization, a source deactivation,
    precedence changes), should check for the same class of stale-data risk
    this pass happened to catch by coincidence.
  - **THIRD OBSERVATION, 2026-08-18 — reinforcing evidence, and the clearest
    demonstration yet.** The dump_station cleanup hit it twice more. After the
    123 stale rows were reclassified to `inferred_category = null`, and again
    after they were hard-deleted, **78 `master_place` rows still read
    `primary_category='dump_station'` and `canonical_name='Unnamed dump
    station'`** `[queried TEST 2026-08-18]`. The delete case is the sharpest
    evidence available: the recompute **provably ran and wrote** — all 89
    affected master_places carry `updated_at` inside the delete operation's own
    03:16:22–03:16:33 UTC window — and the guarded columns *still* went
    unchanged. So this is not "recompute didn't run"; it is the `IF v_value IS
    NOT NULL` guard skipping the UPDATE exactly as described above.
    - Note the split: the **unconditionally-written** aggregates did clear
      (`attribution` → `{}`, `secondary_categories` → `[]`), while the
      **precedence-resolved** columns stranded — leaving rows that are
      internally inconsistent, asserting a category and name with no backing
      source. Those aggregates were not measured pre-delete, so whether the
      delete changed them is unknown; recorded as an observation, not a
      mechanism.
    - **Render-harmless again, for the same accidental reason:** all 94
      corpus-wide `dump_station` master_places sit at `source_count = 0` except
      the 16 live ones, and the export view's `source_count > 0` filter excludes
      the rest. Harmless by filter, not by design.
    - **New companion residual:** those 78 rows are now **completely sourceless**
      — zero `source_record` rows reference them at all, where before they at
      least had an inactive one. Deleting them is a separate authorized decision
      and the natural companion to this fix's own scoped pass.

  - **RESOLVED 2026-08-19 — real fix applied and backfilled on TEST, commit
    `bf73f97`'s scoped pass. NOT pushed to origin — local commit only, flagged
    for Adam's review before it reaches shared infrastructure.** Migration
    `20260819180000_recompute_master_place_clear_bug_fix.sql`.
    - **Live function pulled via `pg_get_functiondef` from TEST
      (`znldzjdatkogdktymtvi`), not from a migration file** `[queried TEST
      2026-08-19]` — confirmed current before touching anything. One handoff
      claim did NOT hold up: the function is described elsewhere as
      "security-definer" — measured `pg_proc.prosecdef = false`. The migration
      matches the measured live definition, not the claim; flagging the
      discrepancy here rather than silently going either way.
    - **Full scan, not just the 3 known instances.** 13 guarded write sites
      total in `recompute_master_place`: the Step 3 11-field loop
      (`canonical_name`, `primary_category`, `description`, `amenities`,
      `hours`, `contact`, `access`, `services`, `capacity`, `seasonality`,
      `cell_signal`), Step 4 (`geometry`), Step 5 (`geometry_polygon`).
      `recompute_aggregated_fields` (Step 1) was checked too — already
      unconditional (`coalesce(..., '{}'::text[])`), not part of the bug.
    - **Fix scope is 10 of the 13 sites, not all 13 — a real constraint the
      original bug writeup didn't anticipate.** `canonical_name`,
      `primary_category`, and `geometry` are **NOT NULL** columns on
      `master_place` `[queried TEST 2026-08-19, information_schema.columns]`
      — there is no NULL to clear them to without relaxing the constraint,
      which this migration deliberately does NOT do (higher blast radius,
      Adam's call). Their guarded-skip behavior is **unchanged**. The other 10
      (`description`, `amenities`, `hours`, `contact`, `access`, `services`,
      `capacity`, `seasonality`, `cell_signal`, `geometry_polygon`) are
      nullable and now get an explicit `set field = null` when no active
      source resolves them, each guarded on `where ... is not null` so an
      already-empty row costs no extra write. Plain SQL `NULL`, not `'{}'`/
      `'[]'` — verified 0 of 156,002 rows store either in these columns today
      across all 10 (only 6 checked at write-time; `contact`/`access`/
      `seasonality`/`cell_signal` were closed in a follow-up pass), so NULL is
      the existing "no data" convention, not a new state.
    - **Applied to TEST only**, via `db:push-verify -- --test`. Re-pulled
      `pg_get_functiondef` after apply and diffed byte-for-byte against the
      intended migration body — identical (only `pg_get_functiondef`'s own
      case/whitespace normalization differed). `prosecdef` and all 5 grants
      (`postgres`/`anon`/`authenticated`/`service_role`/`PUBLIC`) confirmed
      unchanged.
    - **Backfill: 7,346 distinct `master_place` rows**, identified by a
      per-field SQL scan mirroring `resolve_field()`'s own WHERE clause (not
      a guess) across the 6 non-empty clearable fields — `description` 336,
      `amenities` 4,066, `hours` 492, `contact` 1,230, `access` 919,
      `geometry_polygon` 1,314 (`capacity`/`seasonality`/`cell_signal`/
      `services` were 0 — nothing has ever populated them corpus-wide yet).
      Candidate ID list snapshotted to
      `~/.config/overlander/clear-bug-backfill-snapshots/candidates-pre-fix-20260819.json`
      before backfill. Re-ran `recompute_master_place` (new function) on all
      7,346 in 8 batches of ~1,000; the same stale-scan re-run afterward
      returned **0** remaining candidates.
    - **Fourth confirmed instance, larger than the first three combined:**
      1,314 `public_land` rows (100% of the category, all padus-sourced) held
      a stale `geometry_polygon` after `public_land` was deactivated this
      session. Timestamps prove this is the guard bug, not "recompute never
      ran": `last_resolved_at` postdates the source's deactivation
      `updated_at` for all 1,314 `[queried TEST 2026-08-19]` — recompute
      genuinely ran and still left the polygon stranded, same shape as the
      dump_station evidence above.
    - **Regression check:** 300 rows sampled from `source_count > 0` places
      (deterministic seed, real resolved values), full column snapshot
      before/after re-running `recompute_master_place`. 296/300 byte-identical
      across all 17 checked columns including `prominence_score`. The other
      4 changed on `geometry_polygon` only, to a *different real polygon*, not
      a clear — traced to a `padus` source whose stored payload had never been
      re-resolved since that master_place's single confirmed `place_match`
      (2026-08-15), unrelated to this fix: the "has a candidate" code branch
      is byte-for-byte unchanged by this migration, so the old function would
      have produced the identical correction. Not a regression; flagged as a
      separate, pre-existing "some rows haven't seen a recompute since their
      match changed" observation, out of scope here.
    - **Guard check:** `master_place`/`source_record`/`place_match` row counts
      unchanged (156,002 / 165,822 / 163,803, matching the session-start
      snapshot exactly — no inserts or deletes). 148,354 of 156,002 rows carry
      a `last_resolved_at` older than session start, confirming only the
      backfill + regression sample (~7,646 rows) were touched.
    - **User-visible impact — not all 7,346 were render-harmless like the
      original 3 instances.** Only 60 of the 7,346 backfilled rows have
      `source_count > 0`; of those, **59 are currently live in
      `master_place_search_export`** (the 60th fails on an unrelated,
      pre-existing geographic exclusion — outside `six_state_footprint()`,
      confirmed via the view's own `pg_get_functiondef`, which filters only on
      `is_searchable`/`source_count`/geometry, none of the 10 cleared fields).
      Category split: **44 campground, 14 facility, 1 recreation_area**. These
      59 real, search-visible places had a field visibly change (most likely
      emptied) as a direct, intended effect of this fix — this is the correct
      behavior (removing unsupported stale data), but it is a real content
      change on live cards, not a no-op, and Adam should know that before
      approving.
    - **View-count drift (36,192 → 36,188) during this session is confirmed
      NOT caused by this fix**, not merely assumed: the view's WHERE clause
      (`is_searchable`, `source_count > 0`, footprint intersection) never
      references any of the 10 cleared fields, and a direct membership check
      against all 7,346 backfilled ids found only the one pre-existing
      geographic exclusion above — zero rows dropped from the view because of
      this migration.

- **`canonical_name` / `primary_category` / `geometry` — same clear-bug shape
  as bf73f97, NOT fixed. DECISION: leave as-is for now, documented rather than
  resolved.** The `recompute_master_place` fix (`a41e0f8`/`14add86`) added an
  explicit clear for 10 fields when `resolve_field()` finds no candidate
  source. These 3 fields could NOT get the same fix — they're NOT NULL
  columns in the schema, so there's no null to clear them to without relaxing
  that constraint, which is a schema decision, not a code fix, and wasn't made
  unilaterally.
  - Three real options were considered: (1) relax the constraint, allow null,
    same fix as the other 10 — simplest but has real downstream risk, since
    `title`/`coords` (canonical_name and geometry are effectively these) were
    identified elsewhere this session as the two truly hard-required fields
    for a place card to render at all; a null name or null coordinates could
    break rendering rather than just showing stale data. (2) keep NOT NULL,
    fall back to some default value instead of clearing — untried, needs its
    own design. (3) leave alone, accept the risk as lower-probability than the
    other 10 fields (a place losing literally every source for its
    name/category/geometry simultaneously is a bigger, rarer event than
    losing e.g. its description).
  - **Decision: option 3.** Not measured how often this could actually occur
    in the real corpus — if picked up again, checking that first (has any
    place ever actually lost every source for name/category/geometry) would
    tell you whether this is a real, live risk or a hypothetical one worth
    deprioritizing further.
  - Same standing risk noted in bf73f97: any future work touching
    `resolve_field()`/precedence for these 3 fields specifically should be
    aware this gap exists.

- **Amenity chip density — no cap or overflow handling. UNBUILT, flagged
  2026-08-18.** The slideup renders one chip per truthy amenity key via
  `amenitiesToLabels` (`web/src/lib/trip-browse/card-stats.ts`), and
  `AMENITY_LABELS` currently defines **15** keys — 6 shared with `normalizeOsm`
  plus 9 NPS-introduced ones `[read source 2026-08-18]`. A fully-populated NPS
  campground can therefore emit up to 15 chips onto a single card with **no cap,
  no "+N more", and no overflow treatment** anywhere in the render path. Not
  observed breaking a real card yet — flagged when the NPS normalization landed
  (`95fdeb7`) because it materially raised the achievable chip count, and this
  entry exists because a prior session flagged it mid-work and it was never
  written down. Needs a product/design call on cap and overflow affordance
  before it is an engineering task.

- ~~**`land_manager` / `designation` / `gap_status` proposal is STRANDED ON AN
  UNMERGED BRANCH — 2026-08-18.**~~ **RESOLVED 2026-08-19 — the branch was
  merged and the proposal now lives in this file.** It had existed only in
  `land-manager-precedence-design` (`30c231a`), unreachable from `main`, which is
  what this entry recorded. The full scoped proposal is above; this pointer is
  kept because it is still the stated blocker for `public_land` (1,343 padus
  rows, deactivated).

- **Two approved commit-message corrections — APPLIED 2026-08-18, then pushed.**
  Both were applied at end of session. Neither commit was the branch tip, so this
  was a history rewrite (cherry-pick reword), not a plain `--amend`: `159ac2b` →
  **`0e8906f`** and `db6e64b` → **`b794a23`**, with their descendants renumbered.
  Content verified byte-identical to the pre-rewrite tree — messages only. Every
  hash reference in STATE.md / LOG.md / BACKLOG.md / the Diary was repointed to
  the new SHAs in the same pass.
  - `0e8906f` — its message says "4 new tests (29 → 33 in this file)". The real
    figure is **2 new tests, 29 → 31** `[measured 2026-08-18: vitest reports 31,
    and the file contains 31 `it(` blocks]`. The suite moved 482 → 484, which is
    +2 and contradicts the claim in the same sentence.
  - `b794a23` — its message says "The OOM that failed three times earlier in the
    session did NOT recur." Wrong twice: the 3 failures were **never observed in
    this session** (one sync run, which succeeded) and they **predate this
    session**, coming from the handoff document. Correct framing: the handoff
    reports 3 consecutive OOM failures; this run succeeded.

- ~~**Description-less remainder in the reactivated categories — OPEN DECISION,
  NOT RESOLVED, 2026-08-18.**~~ **RESOLVED 2026-08-19 — decided and implemented.**
  Adam's call: within toilet / water / dump_station, only rows that actually carry
  a description stay live. "Has a description" counts a real original OSM
  `description`/`note` tag and a generated template sentence equally.
  Implemented in commit **`478e8d0`**.
  **1,008 description-less rows deactivated** — 362 toilet, 635 water, 11
  dump_station. Live now: **toilet 308 / 670, water 370 / 1,005, dump_station
  15 / 26**, and every active row in all three carries a description
  `[queried TEST 2026-08-19]`.
  - Targeted partial deactivation, not a category toggle — no described row was
    touched, and all **519** master_places holding a described active row remain
    in the export view.
  - `source_record` active 82,735 → **81,727** (−1,008 exactly); view 36,175 →
    **35,398** (−777). The view falls by less than 1,008 because a master_place
    holding both a described and an undescribed row keeps its described source
    and stays live.
  - Verified on BOTH surfaces in BOTH directions, 18/18: deactivated places absent
    from `master_place_search_export` **and** from a live `pois_along_corridor`
    call; described controls present on both.
  - ⚠ **Typesense is stale as a result** — the follow-up sync failed on cluster
    OOM, so search still returns the 777 removed places. See `STATE.md`. The
    database-backed surfaces are correct.

- ~~**NPS-sourced viewpoint reactivation — SCOPED, NEVER RAN, 2026-08-18.**~~
  **RESOLVED 2026-08-19 — both viewpoint slices reactivated.** See `STATE.md`
  §"Viewpoint — both slices reactivated".
  - **NPS (`16738b6`)**: all **231** source_records active, 148 linked → **146
    distinct master_places**, **120 in the export view**. The 26 absent are
    outside `six_state_footprint()` (Los Alamos NM / Oak Ridge TN Manhattan
    Project NHP sites), correctly excluded on geography, not a defect.
  - **OSM (`6a03720`)**: **175** active under filter C → **170 master_places, all
    170 in the view**. Junk **27** and undescribed **6,268** stay off; the
    partition closes on 6,470. Filter C keeps `note`-tag content deliberately —
    the presumed mapper-junk did not materialise (**0** rows with mapper
    vocabulary), and the note rows carry trail directions and safety warnings.
  - Classifier is a checked-in pure function
    (`data/ingestion/lib/osm-viewpoint-content-filter.ts`) with 9 tests, so the
    reactivation and its verification cannot drift apart. **Known limitation
    recorded there:** filter C is structural, not a truth check — a 48-char
    dispute entry passes every structural test and was admitted.
  - **City Hall Observation Deck is NOT in either slice** — OSM-sourced,
    description null. Used as a negative control; correctly absent from both
    surfaces.

- **Never-processed ER backlog — BLM slice CLEARED 2026-08-19, remainder OPEN.**
  Corpus-wide, source_records existed that were active and unlinked with **no
  `place_match` row at all** — never seen by entity resolution, distinct from the
  `manual_review` queue. Cause established by exclusion (timing, data shape,
  category allowlist, run truncation all refuted): they were never in any
  materialize invocation's id set.
  - **Done:** the 652 blm `dispersed_camping` rows materialized — **507
    new_master_place · 44 auto_link · 101 manual_review**; 551 linked, 101 still
    in review; 529 distinct master_places (507 new + 22 pre-existing). Scoping
    verified clean beforehand (0 inactive rows swept in). Cost, measured: **471 s
    wall clock**, `matchall_ms` **381,093**, apply **59,594 ms** / 27 calls.
  - **Remaining:** never-processed **2,671 → 2,019**, and never-processed *and
    active* **912 → 260** `[queried TEST 2026-08-19]`.
  - **Viewpoint deliberately excluded** — its dry run put 82 of 88 active rows
    (93%) into `manual_review`, which leaves them unlinked and still invisible,
    so materializing would not achieve the goal. Needs its own decision on why
    NPS viewpoint scores so poorly (96% review) vs BLM (15%).
  - **The durable gap:** nothing reconciles "did every source_record receive an
    outcome?" A post-materialize completeness assertion — unresolved-with-no-
    place_match must be 0, or explain the remainder — would have caught all
    2,671 at the time.

- **88 active-but-unreachable viewpoint source_records — OPEN, 2026-08-19.**
  Rows with no `master_place_id` were reactivated with their slice but reach
  **neither** the export view nor `pois_along_corridor`; they need
  materialization. **83 nps + 5 osm = 88** `[queried TEST 2026-08-19]`. The five
  OSM ones are among the better content in the set:
  `osm:node:358804431` (Zabriskie Point, 254 chars) · `osm:node:11370405017`
  (Badwater Basin hiking warning) · `osm:node:9287425516` and
  `osm:node:9287425501` (note-tag trail/gate directions) ·
  `osm:node:9401761579` (Roosevelt Dam view). Same issue class in both slices,
  unresolved in both — and the reason 175 OSM rows resolve to 170 master_places
  and 231 NPS rows to 146.

## Surfaced 2026-08-25 (start-of-day key-stop backfill)

- **A kept/backfilled pool-hit can fail to materialize as a tile under its
  spine node — pre-existing, not introduced by the backfill.** Observed twice:
  `Victorville Supercharger` (2026-08-24) and one backfilled pick
  (2026-08-25) that did not appear under its day's first node. In the second
  case it may have bucketed under a neighbouring node — **not verified either
  way**. Suspected mechanism, UNVERIFIED: the audit's `poolByName` spans the
  whole route while `bakeGeneratedDays` folds corpus per day
  (`fetchCorpusForSegment`), so a name the audit can ground may sit outside
  that day's fold. Until this is settled, "the audit kept it" does not
  guarantee "a card renders for it".

## Surfaced 2026-08-20 (Google Places compliance check)

- **Live-fetch-at-render Google data (ratings/hours/testimonials) — PARKED,
  sequenced after the LLM-enrichment-of-existing-corpus pass.** Investigated
  in `docs/measurements/2026-08-20-google-places-details-compliance-check.md`.
  Google's Places API (New) caching policy permits storing only two things:
  `place_id` (indefinite) and coordinates (30 days). `editorialSummary`,
  `websiteUri`, `internationalPhoneNumber`, `regularOpeningHours`, `rating`,
  and `userRatingCount` all have no caching exception — confirmed this is a
  **field-based restriction, not a display-based one**: it applies the same
  whether the content is plotted on a map or rendered as our own UI text, and
  Places UI Kit carries the same terms as the raw API. Closing this gap
  needs a **live-fetch-at-render architecture instead** — call Place Details
  at view time keyed on a stored `place_id`, never persist the result — which
  is a different shape (cost-per-render instead of cost-per-place, plus
  latency) than the storage-based design that was originally scoped.
  Deliberately sequenced **after** the LLM-enrichment pass so the enrichment
  ceiling on existing corpus data is established before Google integration
  work starts.
  - **Related, not part of this item:** the existing `google_resolved`/`google`
    source_records (127 rows total) already store non-exempt fields
    (`displayName`/`canonical_name`, `formattedAddress`) indefinitely with no
    refresh policy — a live compliance gap in current data, surfaced in
    passing during the same investigation, not yet triaged.

- **New source ingestion: gas stations + medical/hospital/urgent-care POIs —
  PARKED, sequenced after both threads above.** Not enrichment work — these
  categories don't exist in the corpus as a source at all yet, so this needs
  a source-selection decision before any ingestion design. Google Places is
  likely reliable for gas stations, but Google's medical-facility data does
  not reliably distinguish urgent care from a full ER from a general clinic —
  a wrong ER location is a safety issue, not a UX gap, so this category may
  need a dedicated source (e.g. state licensing databases, HealthCare.gov
  provider data) rather than Google as primary.

## Surfaced 2026-08-20 (session self-audit — three unresolved corrections)

Found by running the `sg` (second-guess) skill against this session's own
earlier work. All three were presented to the user; **no response yet as of
this docs pass — none applied.**

- **RIDB `RecAreaSchema` DOES have a directions-equivalent field — the
  BLM/RIDB eligibility fix report's claim that it doesn't is wrong.**
  `docs/measurements/2026-08-20-blm-ridb-eligibility-fixes.md` states
  `RecAreaSchema` has no directions-equivalent field, "matching what the
  characterization pass actually found." Live-verified false:
  `raw_payload.recarea.RecAreaDirections` exists and is populated on
  1,104/1,220 (90.5%) of RIDB recarea rows `[queried TEST 2026-08-20]`.
  Measured impact if the fix were extended to recarea rows: **1** additional
  recarea-linked master_place would flip out of NONE (recareas are usually
  already STRONG via other signals, so the practical impact is small even
  though the claim itself is wrong). Fix: add `RecAreaDirections` to
  `RecAreaSchema`/`normalizeRecArea` in `data/ingestion/sources/ridb.ts`,
  same pattern as the existing `FacilityDirections` fix, and extend the
  backfill script to cover recarea rows.
- **atlas_oddities-in-NONE-bucket count disagrees between two docs from the
  same session, never reconciled.** `docs/measurements/2026-08-20-corpus-gap-scan.md`
  states **1,157**; `docs/measurements/2026-08-20-none-bucket-characterization.md`
  states **1,144**. Same conceptual measurement (atlas_oddities rows landing
  in the NONE bucket), taken at two different points in the same session, no
  cross-reference or explanation in either doc for the 13-row gap. Needs a
  fresh recount against current TEST state and a correction note in whichever
  doc is stale (per the decisions/ append-only convention — flag, don't
  silently edit).
- **LLM pilot report's "clusters on WEAK-bucket rows" claim is contradicted
  by its own cited example.** `docs/measurements/2026-08-20-llm-description-generation-pilot.md`
  claims severe fabrication cases cluster on WEAK-bucket rows, but lists the
  Bainbridge Island memorial example as explicitly STRONG bucket in the same
  document. Needs a corrected characterization of what the severe cases
  actually have in common (thin sourcing generally, not the WEAK bucket
  specifically) — see the doc's §5 examples for the raw material.

## Surfaced 2026-08-20 (deactivation pass follow-ups)

- **picnic_area real-named remainder — not enrichment-eligible via the
  placeholder mechanism, not otherwise investigated.** After deactivating the
  3,427 NONE-bucket rows with the exact placeholder `canonical_name`
  `"Unnamed picnic area"`, **1,187** picnic_area rows carry a real (non-
  placeholder) name and remain untouched `[queried TEST 2026-08-20]` — this
  corrects an earlier informal estimate of "~653" that was never actually
  computed. Whether any of these 1,187 are themselves thin/low-value
  (real-named but otherwise sparse) has not been characterized — a smaller,
  separate question from the placeholder-name cleanup this session did.
- **campground / dispersed_camping — a mixed-bucket naming pattern observed
  but not investigated.** Surfaced in passing during this session's
  placeholder-pattern work (the ev_charging investigation, and BLM's 22
  `"Unnamed picnic area"`-named `campground` rows found during the
  picnic_area scope check): these two categories appear to mix real
  site-specific names, blank/placeholder stubs, and source-generated
  junk-code-shaped names (e.g. numbered or ID-like strings) in a way that
  hasn't been characterized the way picnic_area/ev_charging now have been.
  No count taken — this is a flag for a future investigation pass to define
  and measure the pattern properly, not a pre-judged finding.

## Surfaced 2026-08-21 (template descriptions / eligibility / provenance session)

- **235-row junk-code manual review — list delivered, not yet actioned.**
  The placeholder-deactivation pass deliberately did NOT auto-deactivate
  junk-code-named rows (e.g. `"42"`, `"D10.62L"`) after confirming false
  positives among real brand names (`"7-Eleven"`, `"Good2Go"` — genuinely
  alphanumeric/short). Review list already delivered:
  `docs/measurements/2026-08-21-junkcode-review-list.csv`. Needs Adam's
  manual pass before any deactivation.
- **Boilerplate/near-empty descriptions likely exist inside the STRONG
  bucket too — not yet investigated at that scope.** The dual
  description/template investigation found **1,757** rows where
  `master_place.description` is technically non-null but substantively
  empty — **1,404 of the 1,757** fall into two junk patterns
  (`"NAME (Category)"` name-repeat boilerplate, or empty HTML like
  `<p>.</p>`). These correctly did NOT block template generation
  (eligibility logic already treats them as insufficient), but the same
  low-quality pattern likely exists among STRONG-bucket rows where a
  technically-real description masks near-zero actual content —
  `has_real_description` only gates the NONE/WEAK/STRONG boundary, it
  says nothing about quality once a row is already STRONG via some other
  signal. Worth a dedicated audit of STRONG-bucket description quality,
  distinct from NONE-bucket completeness. Not yet investigated at that
  scope.
- **Map filter toggle UI + review worklist UI — backend fully built and
  verified, frontend not started.** `description_source`
  (`'source'`/`'template'`/`'llm'`) is live and queryable in the
  `places_test` Typesense index (confirmed via a live facet query and a
  live filter query), and the `needs_review` flag + worklist query on
  `master_place_generated_content` is confirmed working end to end (the
  Astoria Column flag/exclude round-trip). Both are pure reads against
  schema that already exists — no further backend work needed. What's
  missing is the actual frontend: a map/browse filter toggle on
  `description_source`, and a worklist screen for whoever handles
  review-flagged rows (worklist query already given in
  `docs/measurements/2026-08-21-eligibility-provenance-review.md` §6).
- **state_parks `WEB_LINK` → `contact.website` mapping gap — same shape
  as the already-shipped BLM fix, found but not fixed.**
  `normalized_payload.web_link` carries a real URL on **177 of 1,448**
  in-scope state_parks source_records, not mapped into `contact.website`,
  so `has_website` never sees them. Measured impact: **71** rows would
  flip NONE→STRONG if fixed. Small, cheap — same normalizer-mapping
  mechanism as the BLM WEB_LINK fix (see
  `docs/measurements/2026-08-20-blm-ridb-eligibility-fixes.md` for the
  pattern this would mirror).

_(add items here as they surface; keep one line each, promote to STATE.md
§Queued when scheduled)_
