# STATE — branch `editorial-food-session-handoff` · 2026-08-29 (TasteAtlas six-state promotion — BOTH editorial_food/tasteatlas and family_destinations now LIVE on PROD) (**newest truth: PR #317's landing bug is fixed, a new `tasteatlas` publisher covering all six trip-planning states is built and promoted, and `family_destinations` — previously test-only — is promoted alongside it.** First, a corrective: PR #317 (`editorial_food` multi-publisher) showed "MERGED" on GitHub but never reached `main` — it was based on PR #316's branch, and #316 squash-merged to `main` *before* #317 landed on that branch, orphaning its commit. Diagnosed via direct diff (`editorial-food.ts` absent from `origin/main`), fixed by opening PR #318 (`feat/editorial-food-multi-source` → `main`, #317's exact content, no new code) and resolving conflicts in `manual.ts` (kept the `editorial_food` case) and the doc set (took `main`'s current versions over the branch's stale ones). Merged as `2dd8e66`. **Then: built `tasteatlas` as a new publisher under `editorial_food`, all six states (AZ/NV/CA/UT/WA/OR).** TasteAtlas's site is a confirmed Cloudflare hard-block (verified via curl, not a soft bot-check), so Adam manually screenshotted each state's page; a repeatable pipeline (parallel-agent extraction → dedupe → two-phase Mapbox geocode → real WebSearch verification on every wrong-state/no-match/large-distance result, not just discarded → chain-restaurant judgment calls → sourced descriptions, never invented → every photo URL `curl`-verified 200+real-image before trust → no-photo rows dropped) produced **497 restaurants** (AZ 34, NV 15, CA 323, UT 36, WA 60, OR 29) after excluding confirmed closures, renamed entities, national chains, and fixed-address-less vendors. Two real ingest-blocking bugs caught pre-ingest (CSV filenames missing the `-geocoded.csv` suffix the ingester globs for; `geocode_matched` is read as the literal address string, not a confidence flag — had held `"true"` all session, backfilled from cached geocode data) plus one slug collision (`Lolita's Mexican Food`, two real SD/Chula Vista locations). **TEST: ingest 497/497 0-errors; materialize 478 new_master_place + 19 manual_review (=497); search:sync 33,287 indexed 0-failed.** Live-verified via direct DB/Typesense queries, not just exit codes — the 19 manual-review matches are legitimate sub-threshold near-duplicate detections against existing `atlas_oddities`/`family_destinations` entries (correct behavior), though 2 look like probable false matches worth a second look (`Tivoli Bar and Grill`→`Mick Jagger's Urinal`, `Rockwell Ice Cream`→`The Tiny Gallery`). **PROD promotion, Adam's explicit per-source authorization (two separate checkpoints, not bundled):** all 6 pending migrations applied together (ledger ordering forced it; `family_destinations`'s 3 are schema-only/inert without a matching ingest). `tasteatlas`: ingest 497/497, materialize 481 new + 16 review (=497), sync 21,315 indexed — verified live. `family_destinations`: its TEST CSV didn't exist in this workspace (`.context/` is gitignored/per-workspace), so the 14 rows were reconstructed exactly from TEST's `source_record.raw_payload` rather than re-scraped; ingest 14/14, materialize 11 new + 3 review (=14), sync 21,326 indexed — verified live. Every PROD write followed the same env-swap-and-restore discipline, confirmed restored to TEST after each. **Found, not resolved this session: `Hodad's` now exists as two separate `master_place` rows** (one per source), missed by entity resolution since the two promotions ran independently. Photo-credit gap (aggregator-slug, not photographer) was raised again before the PROD write and accepted as-is by explicit decision. Full narrative: `docs/LOG.md` §2026-08-29. The masthead immediately below (2026-08-28, Family Destinations Guide TEST build) is preserved verbatim per this file's convention — note its "PROD promotion NOT scoped this session" line is now superseded by this one.)

# STATE — branch `feat/family-destinations-food-test-run` · 2026-08-28 (Family Destinations Guide test source on TEST) (**newest truth: a new editorial source `family_destinations` landed end-to-end on TEST as a test run of Option A (full AO parity).** Content: 14 restaurants from `https://familydestinationsguide.com/foodie-road-trip-california/` (Lyam Lavigne, 2025-01-22). Pipeline built: fetch + extract + Mapbox-two-phase geocode (city geocode → proximity-biased Search Box POI lookup + 2-row manual override) in `.context/family-destinations-guide/`; new ingester at `data/ingestion/sources/family-destinations.ts` (mirrors atlas-oddities.ts shape, single-article-per-CSV, globbing multiple CSVs so future articles drop in); registered in `manual.ts` as `--source family_destinations`; 3 TEST migrations (`20260828110000` field_precedence + backfill_master_place_photo_url extension at priority 7, `20260828110100` pois_along_corridor photo lateral extension, `20260828110200` search-export view extension) all applied cleanly. **TEST results:** ingest 14/14 fetched-inserted 0-errors; materialize `--only-categories restaurant --skip-sync` at `ER_APPLY_BATCH_SIZE=25` yielded 20 new_master_places + 1 manual_review + 0 errors (the +6 vs 14 is a byproduct of scoping — pre-existing unresolved restaurant records from google_resolved/google in the ER queue got picked up too, correct behavior); `backfill_master_place_photo_url` on the 13 linked mp_ids reported 13 changed; `search:sync` corpus-wide against `places_test`. **Live-verify PASSED on TEST via corridor RPC across 5 corridors** (San Diego, Central Coast, LA, Napa, Chico → Sacramento) — every family_destinations tile returned with clean description + non-null photo URL. **Live-verify PASSED on Typesense `places_test` across 10 name probes** (9/10 return a restaurant document with description + photo; Nepenthe is the miss, still in manual_review). **Test-only per Adam's 2026-08-28 directive; PROD not touched, PROD promotion NOT scoped this session** — if ever authorized, the runbook mirrors AO's from PR #314 §Part 2 verbatim. New decision doc: `docs/decisions/2026-08-28-family-destinations-test-only-editorial-source.md`. Photo credit is aggregator-not-photographer (flagged for the possible-future PROD conversation). Nepenthe triage filed. Full narrative: `docs/LOG.md` §2026-08-28 (Family Destinations Guide). PR #315's masthead below is preserved verbatim per this file's convention.)

# STATE — branch `feat/ao-typesense-sync` · 2026-08-28 (Atlas Obscura on PROD /search) (**newest truth: the AO /search gap flagged in PR #314 is CLOSED.** Ran Part 3 of the AO thread: confirmed from code that `/search` uses Typesense (not Google Text Search, as Adam's premise wondered) — `web/src/lib/search.ts` imports `SearchClient` from typesense package. Corpus-wide sync ran twice against `places_prod`: first pass indexed 2,804 oddity docs (baseline 0), second pass after a view-migration extension picked up photo_url too. Real numbers this session: `places_prod` went from **16,516 → 20,834 documents** (+2,806 AO + ~1,500 drift from prior source updates never synced); AO-name probes (Voodoo Doughnut, Ethel M Botanical Cactus Garden, Berlin Wall Urinal, Willamette Stone, Tovrea Castle, Summum Pyramid, Boontling Language of Boonville, Temporary Port Chicago) all return the expected oddity doc with clean description AND non-null photo_url. **New migration this session** (applied TEST + PROD): `20260828100000_master_place_search_export_wikipedia_atlas_oddities_photo` extends the view's photo lateral's `source_id in` list from `('nps','ridb')` to `('nps','ridb','wikipedia','atlas_oddities')` — same shape PRs #299 + #314 wrote into the corridor RPC, closes a pre-existing Wikipedia gap too. Env + CLI restored to TEST at the end. **This deviates from the task's literal "sync step" scope (added a schema migration to fix a discovered view gap); flagged prominently in the PR.** Full narrative: `docs/LOG.md` §2026-08-28 (Atlas Obscura: PROD /search gap closed). PR #314's masthead (2026-08-27 promotion) is preserved verbatim below per this file's convention.)

# STATE — branch `feat/ao-md-converter-and-prod-promote` · 2026-08-27 (Atlas Obscura LIVE ON PROD) (**newest truth: the six-state atlas_oddities corpus is now LIVE on PROD.** Ran both parts of the PR #310 scoping runbook in one session: (Part 1) built + applied a markdown→plain-text converter for AO descriptions to close the one remaining product-shape concern from PR #312's density-cascade measurement, on both TEST and PROD; (Part 2) executed the full standard TEST→PROD promotion runbook — migrations `20260827180000`+`20260827180100`, PR #241 anchor CSV ingester (2,866 rows, 6 states, 0 errors), `materialize --only-categories oddity --skip-sync` at `ER_APPLY_BATCH_SIZE=25` (2,806 new master_places, 60 manual_review, 0 errors), PR #309/#311 manual content ingest with `--allow-prod` (2,854 desc/photo writes), markdown converter with `--allow-prod` (1,697 SR updates), restore TEST env + link. **Post-promotion PROD counts** (queried this session): 2,866 atlas_oddities source_records (up from 0), 2,854 with description, 2,844 with photo url, 2,806 linked to a master_place; 2,794 mps carry an AO-attributed description, 2,784 carry a photo_url. **Live-verify PASSED on PROD** via `pois_along_corridor` across 5 corridors (Portland, Seattle, Phoenix, SLC, Vegas) — zero markdown leaks; representative AO names surface (Mt. Baker Ridge Sunset Stones, Hanny's, Snelgrove Ice Cream Cone, Ethel M Botanical Cactus Garden, Berlin Wall Urinal). **Frozen-baked-trip lesson holds — confirmed:** both existing PROD reference trips (la-to-portland 10 days / 0 tiles, la-to-deadhorse 66 days / 1,977 tiles) show ZERO AO-attributed tiles in their baked snapshots. Existing user trips will pick up AO only via new generations or `refreshCorpusTiles()` (PR #302). **Flagged, not done in this pass** (BACKLOG): Typesense sync (`/search` will show AO once run; corridor browse works without it), triage of the 60 manual_review AO rows, NPS/RIDB HTML-in-descriptions rendering (same class of issue as AO markdown, adjacent scope). **This closes the oddity-POI PROD-promotion thread open since PR #306** (2026-08-27 status check). Full narrative: `docs/LOG.md` §2026-08-27 (Atlas Obscura oddities LIVE ON PROD); ADR: `docs/decisions/2026-08-27-ao-description-plain-text.md`; updated PROD counts: `docs/DATA_INVENTORY.md` §PROD. The masthead immediately below (2026-08-27 docs wrap / PR #308) is preserved verbatim per this file's convention.)

# STATE — branch `docs-wrap-2026-08-28` · 2026-08-27 (later) (**newest
truth: PR #308 (manual GPS coordinate entry) is MERGED** — squash-merged to
`main` as `e7f4767` `[gh pr view 308]`. Post-merge verification (asked for,
this session) found the task's own premise needed correcting first:
merging to `main` deploys Vercel **Production** (`overlander-one.vercel.app`),
which points at **PROD Supabase, not TEST** — proved by injecting a real
TEST-signed session JWT into that live URL and watching it bounce to
sign-in, corroborated by the sign-in page's real Google-only production
flow. **No hosted deployment of `main` talks to TEST.** No write was
attempted against Production. Switched to a local dev server on
`origin/main`'s tip instead, per direction. **UI-level check PASSED clean,
no drift from pre-merge:** the coordinate-entry toggle works on both START
and END rows, an out-of-region point (NYC) is accepted per the ADR's
exemption (submit stays enabled), and the out-of-range validation still
shows its inline error. **The full submit-to-persisted-trip check was
INCONCLUSIVE, for reasons external to this feature's code:** the shared
local dev server shows circumstantial (not confirmed) signs of a second,
independent browser session running concurrently, and this session's own
submission failed at the LLM call because the shared `ANTHROPIC_API_KEY`
had run out of credits — a real external resource constraint, not a code
defect; no trip was persisted from this session's own test. The
pipeline-level equivalent of this exact check already passed 9/9 twice
pre-merge, when the key had credit. See `## 2026-08-27 (later)` below for
the full account.)

# STATE — branch `gps-coordinate` · 2026-08-27 (**newest truth: manual GPS
coordinate entry for `/plan/expedition` start/end/stops, built on a prior
read-only investigation confirming no `place_id` dependency exists anywhere
in that path.** Per-row toggle (`coordinate-input.tsx`) swaps
`LocationAutocomplete` for a plain lat/lng text entry; `ExpeditionDestination`
gained `manualCoords: boolean`, which narrowly exempts that one destination
from the planning-region gate (`validateExpeditionForm`) — a deliberate,
ADR-recorded testing-scope choice to bypass rather than reverse-geocode
(`docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`).
Verified against the REAL pipeline: `web/scripts/verify-manual-coordinate-anchor.ts`
drives real Mapbox routing (212.6 mi resolved) + real Claude generation (3
days) + a real signed-in `public.trips` insert/read-back/delete on TEST, all
9 checks passing, mirroring `generateExpeditionTripAction`
function-for-function. A real headless-Chrome DOM check separately confirmed
the toggle renders on-screen and reachable (not occluded), switches the
input, shows the inline range error on an out-of-range latitude, and reverts
cleanly. ~~**PR #308**, open against `main`, not merged — awaiting
review.~~ **CORRECTED 2026-08-27 (later) — MERGED** as `e7f4767`; see the
masthead above and `## 2026-08-27 (later)` below for post-merge
verification.
See `## 2026-08-27` below for the full session account.)

# STATE — branch `corridor-prominence-featured-pick` · 2026-08-27 (day-detail spine: density-cascade cleanup + featured picks, #300–#305) (**newest truth: a six-PR arc on the read-spine (`day-detail-corridor.tsx` / `day-detail-corridor-column.tsx`), all MERGED, `origin/main` tip now `6d008c0` (#306 — an unrelated status-check session, not this arc's work).** Started from a real screenshot: strict-proximity corridor selection (#296) was surfacing 21–29 bare corridor-city headers/day with nothing under them. **#300** (`ca46f57`) added `filterVisibleSpineItems()` — a city with an empty pool and no featured card is dropped from the RENDERED spine only (`Day.corridorCities`/`buildSpineItems`'s data output is untouched, so fuel-gap/day-split/plan-diff logic is unaffected by construction). Start/end anchor nodes always render regardless of content. **#301** (`71b815c`) generalized the same single check (`hasRealContent`, formerly `hasNonFuelContent`) to also hide a city whose entire pool is gas/EV-charging infrastructure (`category === "fuel"`, the corpus's own resolved bucket — not a duplicated source-value list). **#303** (`a4da5af`) generalized it again: a place counts as real content only if it's BOTH non-fuel AND has a real (non-whitespace) description — closes a real wiring gap found while implementing it, `CorridorPlace` had no `description` field at all and `placePool()` dropped it even though the source types (`BrowsePlace`, `Waypoint`) carry one. **#305** (`84306e3`) extends `featuredFor()` so EVERY rendered city — not just an anchor the LLM happened to curate — gets an inline featured card: anchor+curated-match priority is preserved, everything else falls back to `pickProminenceFeature()`, the pool's own highest-`prominence_score` tile that also clears `hasRealContent` (tiebreak: photo presence, then stable id order). Found and fixed a second real wiring gap doing this: `master_place.prominence_score` is selected by the `pois_along_corridor` RPC and already used to `ORDER BY` its own results, but `mapMasterPlaceRow()` silently dropped it before it reached `BrowsePlace` — added `BrowsePlace.prominenceScore` + `CorridorPlace.prominenceScore`, wired through both corpus-backed `placePool()` branches (waypoints have no corpus prominence signal, left unset). **#302** (`aa12d8f`) is a detour that explains a "why does this look unfixed" mystery hit partway through: the corpus-tile "Refresh trip data" action (`refreshCorpusTiles`) had genuinely been BUILT already, but on a *different* Conductor workspace (`cayenne`, branch `nps-injest`, commit `84e5a147`) — never merged. That branch was NOT clean (7 commits; only 1 was the real unmerged work, the rest were either already-merged-elsewhere duplicates of #298/#299 or docs commits making PROD-deployment claims never independently verified in this session — deliberately left behind, see BACKLOG). Cherry-picked just the isolated commit onto a fresh `main`-based branch and landed it. **#304** (`22ed1df`) is the one prompt-engineering change in the arc: `master-prompt.ts` now explicitly invites the LLM to key-stop a genuine highlight located WITHIN a day's own start/end anchor city, not only along the route out of it — soft nudge (reuses the file's own existing "preference, not a quota" framing), verified with one real LLM generation (approved spend) that produced 4 in-city SF key stops on a trip where the anchor previously got zero. **Recurring finding across the arc, worth carrying forward:** several rounds mid-session that looked like "the fix isn't working" turned out to be a stale dev server on a DIFFERENT Conductor workspace/branch (`localhost:3210` was serving `cayenne`'s `nps-injest` tree, which never had any of #300–#305's code) — not a code regression. `lsof -p $(pgrep -f 'next dev') | grep cwd` is the fast diagnostic (already documented in `web/AGENTS.md`); this session re-confirmed it's the first thing to check before assuming a merged fix is broken. **Every PR in the arc was verified live against real TEST data** (not unit tests alone from #303 onward) — minted `seed-owner` sessions, headless-Chrome CDP screenshots at `localhost:3211`, and for #302/#305 specifically, real DB snapshot→mutate→render→restore cycles using real existing corpus tile ids (never fabricated data) to reproduce exact reported patterns before/after the fix. **`description`/`prominenceScore` are absent on any trip baked before 2026-08-27** — existing stored `segmentSuggestions` are snapshots; a pre-existing trip needs `refreshCorpusTiles()` (#302) or a regeneration before the new filter/feature logic has real values to rank on. Full test/build gate green at every PR (final count 646 web tests, `next build` + `web typecheck` exit 0 throughout). No PROD reads or writes anywhere in this arc; no schema/migration changes. `docs/architecture/place-render-model.md` §2's `CorridorPlace` field table updated to add the two new fields. No ADR written for this arc — flagging that as a gap, not a decision: the arc's shape (soft-vs-hard prompt nudges, prominence-as-imperfect-signal, the branch-archaeology recovery pattern) may be worth one; not made here.)

# STATE — branch `nps-api-photo-integration` · 2026-08-26 (NPS campground + park photo extraction) (**newest truth: NPS photo extraction extended to CAMPGROUNDS and PARKS — the two NPS record types that were excluded from the existing photo pipeline. Places (`nps:place:*`) already had photos; campgrounds (`nps:campground:*`) and parks (`nps:park:*`) now do too.** Branch `nps-api-photo-integration` off `origin/main` (`f7faa19`, #297). The existing pipeline (source_record `normalized_payload.photo.url` → corridor RPC `nps_photo_url` lateral → `BrowsePlace.photoUrl` → card `backgroundImage`) was already fully wired for NPS places — this closes the campground/park gap without any architectural change. **Changes:** `CampgroundSchema` + `ParkSchema` gained `images` parsing; `normalizeCampground()` + `persistParkBoundary()` gained `photo: npsPhotoFromImages(...)`. `fetchPark()` now explicitly requests `fields=images`. Backfill script widened to cover `raw_payload.campground.images` and `raw_payload.park.images`. `normalizeCampground` exported for testing; 2 new tests. Stale "no photos" comment in `bake-corridors.ts` corrected. **Backfill applied to TEST:** 305 NPS source_records updated (campgrounds + parks), 192 master_place rows gained `photo_url`. Total NPS photo coverage: 5,181 source_records (was 4,876). Total corpus photo coverage: 7,443 master_place rows (was 7,360). **Verified on TEST:** corridor RPC returns `nps_photo_url` for campgrounds (Jumbo Rocks, Hidden Valley, Sheep Pass in Joshua Tree corridor confirmed). Non-NPS POIs unaffected. All gates pass: 60 NPS tests, 583 data tests, web typecheck + build exit 0. **NPS API terms confirmed**: content is public domain per nps.gov/aboutus/disclaimer.htm; some photos carry third-party credits (already handled via the `NpsPhoto.credit` field). ADR: `docs/decisions/2026-08-26-nps-campground-park-photo-extraction.md`. **PROD requires:** (1) merge this PR; (2) `backfill:nps-photo -- --confirm`; (3) `backfill:mp-enrichment -- --confirm`. **⚠ PROD backfill is currently BLOCKED: GitHub Actions has a major outage (database primary failover, started 2026-08-26 ~15:11 UTC) — CI checks are stuck at "Waiting for status to be reported" and the PR cannot merge until Actions recovers.** Once CI passes and the PR merges, the two backfill commands still need to run against PROD under the normal sign-off rule. Did NOT generate a trip — Adam will. **Flagged:** existing trips with baked tiles will NOT retroactively gain campground/park photos (stored `segmentSuggestions` are snapshots); only newly-generated trips or re-bakes will show them.)

# STATE — branch `fix/corridor-strict-proximity` · 2026-08-26 (corridor-city selection redesign) (**newest truth: corridor-city selection is REDESIGNED — the prominence + 50mi-`minSpacing` greedy model in `deriveCorridorCities` is REPLACED by a strict rule: a city is a corridor node iff its straight-line offset from the day polyline is ≤ 3mi (`corridorMi`), no prominence, no spacing suppression, no gap-fill fallback.** Branch `fix/corridor-strict-proximity` off `origin/main` (`58cfcf0`, #295). One redesign fixes BOTH prior symptoms: the SF/Sacramento false-POSITIVES (11.56 / 3.09mi → excluded by the tight gate — this SUBSUMES the earlier "SF water-detection" idea) AND the Concord/Fairfield/Vacaville/Davis false-NEGATIVES (no longer suppressed). Scoping: `bufferMi` (15mi) is SHARED by bucket/bake/stretches/seeds and is UNTOUCHED — the 3mi rule is a NEW `corridorMi` used only by the city-inclusion gate. `maxNodes` raised 4→40 (pathology backstop, along-route truncation never prominence — forced because strict inclusion surfaces many real cities on dense days). Removed `minSpacingMi`/`maxGapMi` + the greedy/gap-fill selection; added a tight 0.5mi same-point dedup (no-op on measured trips, flagged). **Verified on real route geometry** (TEST `trips` was reset mid-task by a parallel workspace, so I re-routed the same endpoints): Concord(1.59)/Fairfield(1.35)/Vacaville(0.41) IN, Woodland(9.63)+SF(11.56) OUT; Davis(0.43) IN, **Sacramento OUT at its real 3.09mi**; a rural US-395 day = ZERO corridor cities (valid — no fallback). **Tests:** rewrote ~9 old-model derive.test.ts tests + the #295 day-corridor test; added the two NAMED regressions (Concord/Fairfield/Vacaville, Davis/Sacramento); 119 corridor + 182 itinerary pass; gate exits 0 on both workspaces. **Woodland drop is a real, ACCEPTED tradeoff** (previously-validated legit +9mi-detour city), not a correction. **⚠ TOP FOLLOW-UP: density cascade** — dense suburban corridors now yield 21–29 corridor cities/day (measured), which multiplies backfill anchors since #295 shares this derivation; filed in BACKLOG + the ADR as a product/density decision, NOT made here. ADR: `docs/decisions/2026-08-26-corridor-city-strict-proximity.md`. Did NOT generate a trip end-to-end — Adam will. **MERGED as `3c5cdf8` (#296)** — now the `origin/main` tip; the whole 2026-08-25→26 arc (#292 guarantee → #293 chip UI → #294 per-city cap → #295 audit/bake alignment → #296 this redesign) is on `main`. The masthead below (audit/bake alignment, #295) is the shared per-day derivation this redesign now flows through.)

# STATE — branch `fix/audit-anchor-granularity` · 2026-08-26 (audit/bake corridor-anchor alignment) (**newest truth: the backfill audit drew its anchors from the COARSE whole-route `facts.corridorCities`, while the itinerary RENDERS a finer per-day spine (bake) — so cities on the day spine but dropped from the route spine (Oceanside ~38mi from San Diego; Arvin ~16mi from Bakersfield) were visible nodes the backfill never considered. FIXED by aligning the audit's anchor derivation with bake's via a shared helper.** Branch `fix/audit-anchor-granularity` off `origin/main` (`ddd5494`, #294 — the per-city cap fix, already merged). Root cause found on trip `b2078e6d` (San Diego → Fort Bragg, all 6 categories): `facts.corridorCities` = 9 whole-route cities, excluding Oceanside/Arvin; `pickBackfillStops` was never called for them despite real candidates (Oceanside → "Top Gun House"). Fix: new shared `deriveDayCorridor` + `dayCorridorAnchors` in `web/src/lib/corridor/day-corridor.ts`; BOTH `bake.ts` and `audit.ts` now call the SAME `deriveCorridorCities` over the same day segment, so the render spine and the audit anchor set can't drift apart again. Applied to BOTH audit backfill blocks (interest-guarantee AND fuel — the fuel block had the same coarse derivation; flagged, fixed for consistency). The endpoint rule (drop cities within `ANCHOR_NEAR_MI` of a day endpoint) lives inside the helper and is preserved. **Verified read-only on TEST real day-1 data:** the per-day spine now yields San Diego(start), Oceanside, LA, Arvin, Bakersfield(end); backfill anchors = San Diego, Oceanside, LA; **Arvin present in the raw spine but correctly excluded (15.7mi < 25mi from the Bakersfield end) — for the endpoint reason, not absence**; Oceanside now gets a pick. **Tests:** new `day-corridor.test.ts` (3, synthetic gazetteer) locks "per-day-only city is still an anchor" + the Arvin-class endpoint exclusion; 119 corridor + 182 itinerary pass; gate exits 0 on both workspaces. **Accepted tradeoff flagged (ADR + BACKLOG):** finer spine ⇒ more anchors/day × 2 picks each ⇒ denser trips; levers noted. Did NOT regenerate a trip end-to-end — Adam will. `origin/main` tip **`ddd5494` (#294)**; this PR open, not merged. The masthead below (guarantee-cap-per-city-fix) is the fix this builds on.)

# STATE — branch `chips-check` · 2026-08-25 (guarantee-cap-per-city-fix) (**newest truth: the interest-category guarantee cap was enforced per-DAY when the D-B spec calls for per-CITY — a correctness bug — and is now FIXED. `MAX_BACKFILLS_PER_DAY` → `MAX_BACKFILLS_PER_CITY`; every anchor a day passes (start, mid-corridor, end) gets its own budget of 2, no day-level break in either phase of `pickBackfillStops`.** Diagnosed on trip `ab146c1d` (San Diego → Reno, `guaranteedCategories = [camping, scenic, food, oddity]`): the day-START anchor (San Diego) consumed the whole per-day budget of 2 (scenic + camping), so Oceanside / Riverside / Silver Lakes got ZERO guarantee picks despite real candidates at each (confirmed via the real `pickGuaranteedStop`). This was NOT the category-monopoly tradeoff PR #292's ADR flagged — it was a scope bug (day vs city). Fix in `web/src/lib/itinerary/anchor-backfill.ts`: renamed+rescoped the constant, phase 1 now tracks a per-anchor `cityPicks` budget, and the day-level `picks.length >= max` breaks were removed from BOTH phase 1 and phase 2 (the opener break starved later anchors too); cross-anchor dedupe (`taken`) retained. **Verified read-only on TEST real data** (preComputeFacts + real `pickBackfillStops` on the actual pool): day-1 now yields 8 guarantee picks across 4 cities (2 each) — San Diego, Oceanside, Riverside, Silver Lakes all covered — vs 2 total (San Diego only) pre-fix. **Tests:** 39 anchor-backfill (2 new locking per-city scope; 2 day-scope tests that encoded the bug rewritten) + 182 itinerary all pass; local gate exits 0 on both workspaces. **Flagged:** category-monopoly still applies WITHIN a city's 2 slots, and removing the per-day ceiling lets a multi-city day surface more machine picks than before (the old "list of towns" concern is now bounded per-city — a deliberate consequence of the D-B density spec). ADR (`2026-08-25-interest-category-guarantee-granularity.md`), BACKLOG, and `architecture/generation-pipeline.md` updated. Did NOT regenerate a trip end-to-end — Adam will. `origin/main` tip **`88f3d83` (#292)**; this stacks on the chip-UI work on branch `chips-check`, PR open, not merged. The masthead immediately below (interest-category-chip-UI) is the UI that surfaces this mechanism.)

# STATE — branch `chips-check` · 2026-08-25 (interest-category-chip-UI) (**newest truth: the interest-category GUARANTEE is now REACHABLE from the wizard — blocker F is resolved. The "Interest categories" wizard section renders a multi-select chip row for the 6 backend-serviceable categories (`scenic, food, camping, attraction, oddity, urban`) alongside the existing `fuel` checkbox; #292's mechanism was wired end-to-end but dark until this.** Branch `chips-check` off `origin/main` (`88f3d83`, #292 — already merged, so this builds ON the guarantee, not beside it). Ships: (1) `web/src/lib/plan/guarantee-categories.ts` — `GUARANTEE_CHIP_CATEGORIES` (6 `{key,label}` entries, wizard display order), the UI face of the backend gate `GUARANTEE_CATEGORIES` in `anchor-backfill.ts`; (2) `guarantee-categories.test.ts` — 3 TDD-first tests **drift-locking the chip set to the backend gate** (a category added/removed backend-side fails the test); (3) wizard "Interest categories" `<Section>` now renders a `SelectableChip` row (per-category `var(--cat-{key}-title)` accent, controlled multi-select toggling `guaranteedCategories`) above the fuel checkbox — `fuel` stays a checkbox for its distinct live-resolve semantics + cost caption. **FLAGGED DEVIATION from the task's "8 categories besides fuel":** the driving task's premise was that "overnight" isn't in the 9-category taxonomy — but it IS. `guaranteedCategories` is typed `SlideCategoryKey[]`, and there **`overnight` is the data-taxonomy name for the display category `hotel`** (isomorphic via `palette.ts`). So `overnight`/`hotel` is ONE category, excluded from the backend gate (B.2 — duplicates the per-day overnight slot), and `interest` is also excluded (junk drawer). A chip for either would silently no-op, so neither is offered — the honest, backend-serviceable set is **6, not 8** (matches every prior doc's "6 pool-side categories"). `camping` DOES act (it's in the gate), correcting the task's worry that it might not. **Live-verified on TEST** via headless-Chrome CDP (minted seed-owner session, dev 3210): 6 chips render + are on-screen and **reachable** (`elementFromPoint`-inside, not occluded); real pixel-clicks toggle `guaranteedCategories` (multi-select + independent deselect confirmed). **Local gate PASSES** on both workspaces (web typecheck + `next build` + data typecheck all exit 0); 14 plan tests (incl. 3 new) + 37 anchor-backfill tests pass. `origin/main` tip **`88f3d83` (#292)**; this PR open, not merged. The masthead immediately below (interest-category-guarantee) is the backend this UI now surfaces.)

# STATE — branch `main` · 2026-08-25 (interest-category-guarantee) (**newest truth: the interest-category GUARANTEE shipped at decision D-B (per-city) — a user-selected pool-side category is now featured at EACH corridor city the day passes that lacks it, from the corpus pool, within the existing per-day backfill cap.** Branch `feat/guarantee-selector` off `origin/main` (`3e48dda`, #290). Resolves blocker **D** of `docs/specs/interest-category-chips.md`; ADR `docs/decisions/2026-08-25-interest-category-guarantee-granularity.md` (formalizes the report-only brief `interest-category-chips-D.md`, left in place). Ships spec §11 steps 5–7: (1) **step 5** — per-anchor missing-category computation in `audit.ts` (`missingAt(coords)`, per-city D-B), coverage attributed from pool-hit `SlideCategoryKey`s (+ `restaurant`→`food` for live-resolves via `RESOLVED_TO_GUARANTEE`); (2) **step 6** — NEW pure selector `pickGuaranteedStop` in `anchor-backfill.ts` ALONGSIDE `pickAnchorStop`, own broader gate `GUARANTEE_CATEGORIES` = the 5 openers **+ `urban`** (the urban-gate call — spec §5/§9-B — resolved by giving the selector its own gate, NOT widening the opener's), takes `pool` as input, **NOT** routed through `resolvePlaces()` (deferred BACKLOG item); (3) **step 7** — two-phase `pickBackfillStops` (Option A: guarantee wins the shared cap first, openers fill remainder). Flag `INTEREST_CATEGORY_GUARANTEE` (ON by default, same posture as `KEYSTOP_ANCHOR_BACKFILL`). `fuel`/`overnight` **excluded** from the gate per spec §11 step 6 (B.1/B.2 unresolved) — flagged, not silently built around. **Local gate PASSES** on both workspaces (web typecheck + `next build` + data typecheck all exit 0); 180 itinerary tests pass (37 in `anchor-backfill.test.ts`: 25 pre-existing unchanged + 12 new). **Live-verified read-only on TEST** via `web/scripts/verify-guarantee-percity.ts` (real `preComputeFacts` + `auditItinerary`, no LLM, no writes): on San Diego→SF and Sacramento→Reno a `scenic` guarantee produced two `guaranteed` scenic picks at two DISTINCT corridor cities (per-city density), control run = openers only. **Chip UI still dark** (blocker F — wizard has only the fuel checkbox; the 6 categories reach the audit only via `guaranteedCategories`) and **cross-category cap saturation** flagged — both in BACKLOG + the ADR. `origin/main` tip unchanged at **`3e48dda` (#290)** until this PR merges. The masthead immediately below (test-only-signin) remains authoritative on that path.)

# STATE — branch `main` · 2026-08-25 (test-only-signin) (**newest truth: added a TEST-only "Continue as seed test user" button to `/auth/sign-in` so Adam can sign in on TEST without going through Google OAuth — Google is not an enabled provider on TEST (`/auth/v1/settings` returns email-only [measured 2026-08-24]), so the production sign-in button cannot complete there and was blocking dev workflows.** Branch `feat/test-only-signin` off `origin/main` (`04e9855`, since merged with `864b752` (#289) below). Ships: (1) `isTestSupabaseUrl()` + `isNonProductionRuntime()` + `isTestOnlyBypassAllowed()` in `web/src/lib/supabase/env.ts` — 16 TDD-first unit tests locking every URL-attack and NODE_ENV failure mode; (2) new server action `signInAsSeedTestUser` in `web/src/app/auth/actions.ts` — gated on `isTestOnlyBypassAllowed()`, calls `supabase.auth.signInWithPassword` for the fixture creds `seed-owner@overlander.test` / `seed-pw-manual-edit-8471` (the same TEST-only pair seeded by `web/scripts/seed-test-user.ts`); (3) additive button on `/auth/sign-in` — outline styling, subdued, below the primary Google button, with a distinct amber "TEST only · seed-owner@overlander.test" caption. **Google sign-in path is NOT modified** — the existing action + button + OAuth callback are byte-for-byte unchanged; this is purely additive. **⚠ MUST NEVER RUN AGAINST PROD — three independent gates prevent it:** (a) `NEXT_PUBLIC_SUPABASE_URL` must equal `https://znldzjdatkogdktymtvi.supabase.co` exactly (fails on undefined, empty, wrong scheme, PROD ref, prefix/suffix/subdomain attacks); (b) `process.env.NODE_ENV` must be `"development"` or `"test"` (production builds always fail this); (c) `seed-owner@overlander.test` doesn't exist on PROD Supabase, so even if both gates were somehow bypassed GoTrue would refuse the credential. Gate runs at BOTH render time AND server-action submit time — a hand-crafted POST that skips the render check still hits the gate inside the action. **Live verification (2026-08-25):** TEST env → button renders + `signInWithPassword` returns `access_token` for user `a2f74eb2…`; PROD-URL simulation (env override, no PROD data access) → button hidden, only "Continue with Google" visible. Local gate PASSES on both workspaces. Full decision + reversal instructions: `docs/decisions/2026-08-25-test-only-signin-bypass.md`. `origin/main` tip now **`864b752` (#289)** (Mapbox fuel-source merged after this branch was cut; merged in cleanly, only STATE/LOG/BACKLOG conflicts — additive both sides, both entries kept). The masthead immediately below (2026-08-25 mapbox-fuel-source) remains authoritative on that path's position.)

# STATE — branch `main` · 2026-08-25 (mapbox-fuel-source) (**newest truth: fuel discovery on the web-client browse surfaces (`/api/trip-browse`, `/api/search-area`) moved from Google Places to Mapbox Search Box. Compliance-driven — Google Places rendered on a non-Google map requires the UI Kit; Mapbox Search Box on Mapbox GL JS doesn't.** Branch `feat/mapbox-fuel-source` off `origin/main` (`04e9855`, which now includes PR #288's fuel-live-resolve merge). New module `web/src/lib/discovery/mapbox-search-box.ts` — a `WaypointSource` implementing the Mapbox Search Box category endpoint for `gas_station`, 13 TDD-first unit tests. `SourceId` union gains `"mapbox"`; `SOURCE_LABEL` in `to-browse-place.ts` gains `mapbox: "Mapbox"`. Google's `TYPES_BY_CATEGORY.fuel` emptied (was `["gas_station"]`) — Google no longer emits fuel from the category fanout. Mapbox source added at head of BOTH `LIVE_SOURCES` (legacy) AND `DEFAULT_BBOX_LIVE_SOURCES` / `DEFAULT_CORRIDOR_LIVE_SOURCES` (resolver defaults), so fuel-via-Mapbox works identically regardless of `SEARCH_AREA_USE_RESOLVER` / `TRIP_BROWSE_USE_RESOLVER` state (both still OFF). **NO npm dep added** (hand-rolled fetch — flagged over `@mapbox/search-js-core`, which is autocomplete+session-token+retrieve machinery for a flow this source doesn't use). **D7 (BrowsePlace.source per-source tagging) resolved:** kept `BrowsePlace.source` at its binary `"live" | "master_place"` distinction; per-source id lives on `SourceResult.sourceId` (already the case), which is what `SOURCE_LABEL` reads for the tile's "Sourced from Mapbox" mention. **⚠ Path A (fuel-live-resolve, PR #288 `04e9855`) remains on Google** — audit-time `pickFuelAtAnchor` calls `PlaceResolver.resolveNearby("gas_station", ...)`, still hits Google, still persists `google:<placeId>` tiles into `trips.payload`. Explicitly out of scope this session per Adam's direction; separate follow-up. See `docs/decisions/2026-08-25-mapbox-fuel-source.md`. **Local gate PASSES** on both workspaces (typecheck + `next build` + data typecheck all exit 0); 66 tests pass across mapbox-search-box, resolve-places, and both handler test files (one existing assertion updated: fanout size 5→6). **No live TEST run this session** — no `NEXT_PUBLIC_MAPBOX_TOKEN` exercised, no state-by-state coverage comparison computed. Merged as **`864b752` (#289)**.)

# STATE — branch `main` · 2026-08-25 (fuel-live-resolve) (**newest truth: first BUILD landed off the Interest-Category-Chips scoping arc — a `fuel`-category guarantee via live Google Places, corpus-independent, feature-flagged OFF by default.** Branch `feat/fuel-live-resolve` off `origin/main` (`1fda7de`, #286). Ships: (1) new module `web/src/lib/itinerary/fuel-live-resolve.ts` with `pickFuelAtAnchor()` + 9 unit tests (all pass, TDD-first); (2) `PlaceResolver.resolveNearby(includedType, biasCoords)` extension in `resolve.ts` — hits Google `places:searchNearby`, shares the per-generation cap with existing `resolve()`; (3) `GenerationInput.guaranteedCategories?: string[]` + `ExpeditionForm.guaranteedCategories?: SlideCategoryKey[]` payload wiring (§11 steps 2-3 unblocked); (4) audit-loop hook in `audit.ts` gated on `FUEL_LIVE_RESOLVE=true` env var + `guaranteedCategories.includes("fuel")` — runs AFTER `pickBackfillStops` per anchor, dedupes against kept fuel-family stops within `ANCHOR_NEAR_MI`; (5) single fuel checkbox in the wizard (deliberate — the 8-chip row is F+D-blocked; a 1-of-8-working row would be misleading, replace-in-place when D+F resolve). **Adam's assumption "electric vs. gas already known from the vehicle profile" is FALSE** — no `fuelType` field exists on `RigProfile`, so `includedTypes` is hardcoded `"gas_station"` today; EV rigs get gas picks. Flagged in the decision doc, fix scope = rig field addition. **Feature flag is OFF by default** — opposite posture from `KEYSTOP_ANCHOR_BACKFILL` because this issues external Google calls (new cost source), unlike the in-memory backfill. **Local gate PASSES:** `npm run -w web typecheck` + `cd web && npx next build` + `npm run -w data typecheck` all exit 0. **Audit-hook integration coverage is thin** — the pure module is unit-tested, the audit wiring is typecheck-only (resolver is constructed inside `auditItinerary` so injection needs a refactor); flagged. Full decision doc: `docs/decisions/2026-08-25-fuel-live-resolve.md`. This PR is a SIBLING to PR #287 (scoping), not a stack — branch off origin/main. `origin/main` tip unchanged at **`1fda7de` (#286)**; PR #287 still open on separate branch. The masthead immediately below (2026-08-24, notes-to-spine chain) remains authoritative on last shipped-to-main code position.)

# STATE — branch `main` · 2026-08-24 (**newest truth: the notes-to-spine OVERNIGHT slice shipped and was then hardened across a chain of follow-ups; the overnight is now linked to its spine tile through THREE matching tiers, with one slice still parked.** `#279` (`1cb200e`) links a grounded overnight to its spine tile by IDENTITY (not a substring) — marks it `isOvernight`+`curated`, the Camping block derives from it, the redundant "Overnight —" prose line drops; desc-only/off-corridor → prose fallback. Follow-ups: a "tile missing" report was diagnosed as pre-deploy trips, **not a bug** (#280 `3a42746`), and #279 confirmed working live (#281 `060af08`); a real gap was found and reproduced live (#282 `8679a21`, #283 `783fe51`) — a pool-hit overnight whose place is on the spine under a DIFFERENT id (`google:` live-resolve) or missing from the per-day corpus fold entirely, so the `mp:` ref matches no tile; id-reconciliation via `google_place_id` was built but is **INERT on backcountry data** (0/351 #283-corridor rows carry one — those rows have no linked Google source) (#284 `53f551d`); and a **fuzzy name+proximity tier is OPEN as #285** (strict name subset ≥2 tokens AND ≤0.5 mi, closest wins, no-match→prose) — it closes the tile-present case (Hope Valley confirmed on real coords, 0.067 mi) but NOT the no-tile / layover case (Convict Lake — needs tile synthesis, parked). **The Logistics/Fuel/Reserve service-stop half of notes-to-spine is untouched** — prose-only, a separate product-gated decision (`docs/decisions/notes-to-spine-gap.md`). Two flagged product/UX calls stay open: the overnight badge is a subtle "Overnight ·" status prefix, and #285's 0.5 mi / name thresholds are chosen. `origin/main` tip **`53f551d` (#284)**; **#285 open**. Detail in the `## 2026-08-24` dated sections below and `docs/decisions/2026-08-24-overnight-spine-tile-link.md` (Follow-ups 1–6). The masthead immediately below (2026-08-23, resolver cutover) is STALE on position but preserved per this file's convention; the earlier key-stop backfill arc (#274–#276) has its own dated sections further down.)

# STATE — branch `main` · 2026-08-23 (later) (**newest truth: ALL FOUR originally-planned place-data surface cutovers are COMPLETE or resolved-as-not-needed; `origin/main` tip is `b227e65` (#269).** The read-surface half of the resolver-consolidation ADR is done: **Search** cut over behind `SEARCH_AREA_USE_RESOLVER` (#260 `d62f660`; a real tier blocker on the bbox path was found + fixed first — #259 `9c212a6`); **Date Detail** behind `DATE_DETAIL_USE_RESOLVER` (#266 `a086cb8`), which needed a NEW resolver capability `enrichByGoogleId()` (#263 `bc2c9c2`) because `resolvePlaces()` couldn't serve bare Google ids — a different gap from the tier bug; **Day-scoped browse** behind `TRIP_BROWSE_USE_RESOLVER` (#269 `b227e65`), wired alongside the existing `USE_FEDERATED_POIS` (orthogonal, both stay); and **Day Column** needs NO cutover — it's a passive `Trip.days` renderer with no endpoint (#267 `4757067`), its real work deferred to a write-path/baking consolidation. **All three new flags default OFF — nothing from this arc is live in production.** Also today: Camping narrowed (#254 `f70dbd0`), Verified/Unverified tiers + corridor-RPC `description_source` (#255/#256 `476f052`/`d7faf5e`), auto-hydration decision (#257 `af97048`), plus a plan doc per surface (#258/#261/#262/#264/#265/#267/#268). **ADR step 4 (shared client cache) is now READY TO BUILD** — three read surfaces are cut over and each still runs its own per-route cache, the redundancy step 4 removes; tracked in BACKLOG. See `## 2026-08-23` below. **⚠ The masthead immediately below is STALE only on its "Next work is the Search cutover — planned, not started" line** — that whole arc is now done; its technical description of the #254–#257 state is preserved verbatim.)

# STATE — working branch `sucre` · 2026-08-23 (**newest truth: `resolvePlaces()` is fully LANDED on `main`, and so are the three step-2 blocker resolutions.** The `resolvePlaces()` service file landed on `main` via **#255** (`476f052`, "resolvePlaces() rebase") `[git log --follow, 2026-08-23]`; the three step-2 blocker resolutions merged as **#254** (category narrowing — a separate branch), **#255/#256** (Verified/Unverified tiers), and **#257** (auto-hydration doc). `origin/main` tip is **`af97048` (#257)**. This workspace's branch `sucre` sits exactly at `origin/main` (0 ahead / 0 behind, clean tree) `[git, 2026-08-23]`. Still **nothing is cut over**: `/api/search-area`, `/api/trip-browse/:tripId/:dayId` and `POST /api/places/details` remain the live paths, and `resolvePlaces()` still has **zero importers** in `src/app`/`src/components`. Next work is the **Search cutover** — planned, not started; see `docs/architecture/resolve-places-search-cutover-plan.md`, which flags one real blocker (the #255/#256 tier path is non-functional on the `bbox`/Search path as built). **The masthead immediately below is STALE on branch + merge status only** — its "committed locally, NOT pushed, no PR" framing described the pre-merge state of `feat/resolve-places-service` and no longer holds; its technical description of the service is preserved verbatim.)

# ~~STATE — branch `feat/resolve-places-service` · 2026-08-22~~ (**⚠ SUPERSEDED 2026-08-23 — MERGED as #254–#257, see masthead above.** Historical: **newest truth: `resolvePlaces()` built as an ADDITIVE service — ADR step 2. ~~Committed locally, rebased onto `origin/main` at `d185d0d`, NOT pushed, no PR.~~** Nothing is cut over: `/api/search-area`, `/api/trip-browse/:tripId/:dayId` and `POST /api/places/details` are byte-for-byte untouched and remain the live paths, and the new code has **zero importers** outside its own directory. **No database, network, or API calls of any kind in that session** — no TEST reads, no PROD reads, no management-API calls; the work is static source reading plus local tests. See `## 2026-08-22 (later)` right below. ✅ **The merge-order note this masthead used to carry is DISCHARGED:** `docs/reflect-247-merge` landed as **`d185d0d` (#248)**, and this branch has been rebased on top of it. Both #247's merge-status corrections and this branch's additions are present — neither was dropped in the rebase. The `main`-branch masthead immediately below is #248's and is preserved verbatim.)

# STATE — branch `main` · 2026-08-22 (⚠ **PR #247 is now MERGED** — squash-merged to `main` as **`4f2a6af`**, now the `origin/main` tip `[git log, 2026-08-22]`. The "committed locally / NOT pushed / no PR" framing in the masthead below and throughout §2026-08-21 (later) is **STALE**; corrected in place per this file's convention. **The migrations remain applied to TEST ONLY — merging the PR did not apply anything to PROD**, and every OPEN item in that section except the push/PR one still stands. Note the squash means the branch's own SHA `7110a6e` is NOT an ancestor of `main` — the trees are identical, which is the usual pattern here, not a discrepancy. This docs pass commits only `docs/`.)

# ~~STATE — branch `master-place-enrichment-columns` · 2026-08-21~~ (**superseded by the masthead above — MERGED as `4f2a6af` (#247).** Historical text preserved: **newest truth: the `master_place` enrichment-columns branch — ADR step 1.** ~~Committed locally on `master-place-enrichment-columns`, sitting at `origin/main`'s tip `c370115`, NOT pushed, no PR.~~ ⚠ **The branch was NOT created by this work** — Conductor had already created it from `c370115` and renamed the workspace's original `andorra` branch onto that name; the reflog shows `branch: Created from c3701154…` then `Branch: renamed refs/heads/andorra to …`. This work **verified** HEAD was at `origin/main`'s tip before committing; it did not perform the fork. Two migrations applied to **TEST only**; **no PROD *database* reads or writes** — one `supabase projects list` call did read PROD project metadata via the Supabase **management API**, disclosed for accuracy; it touches no table. See `## 2026-08-21 (later)` immediately below. ⚠ **One STATE.md claim below is now measured-false:** §2026-08-21's "10,292 generated_content rows, all `generation_method='template'`, 0 `llm`" — TEST now holds **7,433 `llm` rows** as well, generated later the same day by a different workspace. Corrected in the section below and in `docs/LOG.md`; the original line is left in place per this file's convention. Older masthead text preserved below, now historical — it describes `main` at `c370115`, which is still this branch's fork point.)

# STATE — branch `main` · 2026-08-21 (⚠ **PR #243 is now MERGED** — squash-merged to `main` as `5a822ab` `[git log, 2026-08-21]`, corrected below; the "open, not yet merged" framing further down this file is now STALE. **Newest truth: a template-description / eligibility / provenance / review session, done directly on local `main`** — see `## 2026-08-21` right below. ~~**This session's work (code + migrations + scripts) is UNCOMMITTED as of this docs pass, sitting directly on local `main`, not yet on a branch, not pushed.**~~ **CORRECTED 2026-08-21 — NOW MERGED:** the corpus-quality work squash-merged to `main` as **`d6c55ac` (#244)**, and the place-data resolver ADR added afterward squash-merged as **`4fbd051` (#245)**; current `origin/main` tip is **`4fbd051`**. The "uncommitted / not yet on a branch / not pushed" framing here and throughout §2026-08-21 is now STALE. ~~Per CLAUDE.md's own standing rule (`main` is protected, every change goes branch → PR → Adam merges), that code needs to move to a branch before it can reach `origin`.~~ This docs pass commits only `docs/` — see the section below for the exact uncommitted-file inventory. `fix/amenities-render-shape` (2026-08-18 section further below) remains a SEPARATE, still-unmerged, unpushed-since branch, status unchanged from before. Older masthead text preserved below, now historical.)

Position, not changelog. `git log` is the changelog. Overwrite in place at every
review gate; update in the SAME commit as the work. No SHAs — deliberately.

## COLD START (read this first, in this order)

Written 2026-07-31 for an agent arriving in a **different environment** — work is
moving off Claude Code on Adam's desktop. Do not assume your harness loads
anything automatically.

1. **Read `CLAUDE.md` at the repo root FIRST — load it by hand if your
   environment does not.** It is not background reading; it carries the standing
   instructions you will otherwise violate: `main` is protected and every change
   goes branch → PR → **Adam merges** (never merge your own); the git hygiene
   rule (`git add` explicit paths only — no `add .`, no `-A`, no `commit -a`);
   the tripwire discipline (state the paths that must show ZERO diff, then verify
   it); PROD/TEST separation (`dawson-vancouver-cassiar` is **FROZEN**);
   iOverlander is a **banned data source**; and the RUNBOOK, whose gotchas are
   measured, expensive, and not re-derivable from source — which test trip to
   reach for, the ~1h dev-session expiry that masquerades as broken drag
   tooling, the 15-minute negative cache on `/api/places/details`, and the
   apparatus-validation lessons.
   - `web/CLAUDE.md` and `web/AGENTS.md` carry the web-specific conventions
     (slideup-not-full-page, design tokens, the repository layer).
2. **Then this file** for position — what is live, what merged, what is decided
   but unbuilt, what is parked.
3. **Then the architecture doc for your task.** There are five and the filenames
   do **not** make the split obvious:

| Doc | Read it when you are working on |
|---|---|
| `docs/architecture/trip-resolution.md` | **How an id becomes a payload** — `getTrip`'s resolution order, the two reference readers, fork, caching. Also the source of the **evidence-tag convention** every doc here uses. |
| `docs/architecture/itinerary-model.md` | **The data model as it stands** — `Day`/waypoint/corridor-spine shape, the route-vs-overlay two-layer model, nodeId keying, guarded single-write persistence. §7 is the single home for the five trip payload shapes. |
| `docs/architecture/generation-pipeline.md` | **The WRITE path** — the server-side generation run (gates → `preComputeFacts` → LLM → `bakeGeneratedDays` → persist), LLM field provenance, failure modes. |
| `docs/architecture/trip-creation-surfaces.md` | **The client/UI half of creation** — which surfaces create a trip, every expedition-wizard input, the destination autocomplete, what `expeditionToGenerationInput` forwards. |
| `docs/architecture/place-render-model.md` | **The READ/render path for one place** — what a stored tile carries vs what the day-detail card and the detail slideup each show, enrichment via `/api/places/details`. |
| `docs/architecture/map-day-render.md` | **How the active day draws on the MAP** — the two-layer place symbol map (#192, one source + pool/prominent split), and the day-bounds camera (#194, fit places-not-endpoints, guards, settle inheritance). Distinct from place-render-model (that is a place's *data*; this is the *map*). |

4. **`docs/BACKLOG.md`** for parked work, **`docs/LOG.md`** for why things are the
   way they are (append-only, newest at top), **`docs/DATA_INVENTORY.md`** for
   which data lives in which database.

**Conventions that are easy to miss.** Every factual claim in `docs/` carries an
inline evidence tag — `` `[read source]` ``, `` `[grep]` ``, `` `[queried TEST]` ``,
`` `[queried PROD]` ``, `` `[script]` ``, `` `[measured YYYY-MM-DD]` ``, or
`` `[UNVERIFIED]` ``. The convention exists because a confident doc once recreated
a false belief (`trip-resolution.md` §"Why this doc states its evidence"). **Add a
claim only with its evidence, and mark what you could not verify.** Superseded
text is struck through with `~~` and annotated **in place**, never deleted — a
later entry corrects an earlier one and the earlier one stays.

## LIVE ON PROD (what a user can do today)
- **Manual drag editing on user-owned trips.** `NEXT_PUBLIC_LIVING_PLAN_EDIT=1`
  set in Vercel Production. Verified by Adam on a real user trip. The flag split has
  DEPLOYED, so this flag now gates manual editing ONLY.
- Reference slugs (`la-to-deadhorse`, `dawson-vancouver-cassiar`) never show the
  edit toggle — `canEdit = !isReference && isUserTrip(trip.id)`. Cassiar FROZEN.
- **"Change this trip" (NL editing) is now DARK on prod.** The flag split (#126)
  deployed, moving it behind its OWN flag `NEXT_PUBLIC_NL_EDIT` — **unset in Vercel =
  off, the prod end state; DO NOT set it.** (It had been per-interaction Opus spend with
  no quota/rate-limit infra, which is why it's dark until that infra exists.)
- **Corpus search works over the full LA→Deadhorse corridor.** Federated
  `/api/search-area` returns PROD's corpus (US + Canada sources) via Typesense
  `places_prod`. Restored 2026-07-23 after a rotated prod service key Vercel never
  received had silently broken hydrate. Counts and the full picture live in
  `docs/DATA_INVENTORY.md`.
- **Curated-POI kebab (Move to day / Delete)** — live on user-owned UUID trips
  (#131). See the caveat under RESIDUALS.

## DEV GATES
- `main` is protected — direct pushes rejected (deletion, non_fast_forward,
  pull_request, required_status_checks). Every change goes through a PR.
- CI gates every merge: `typecheck`, `test`, and `build`
  (`cd web && npx next build`) must pass before merge.

## 2026-08-27 (later) — manual GPS coordinate entry: post-merge verification

PR #308 MERGED — squash-merged to `main` as `e7f4767` `[gh pr view 308]`.
This section is the post-merge verification pass, run against the merged
code, that produced the masthead correction above.

**Premise correction, found before any write was attempted:** the ask was
to verify "on TEST" against the deployed `main`. Merging to `main` deploys
Vercel **Production** (`overlander-one.vercel.app`) — confirmed against
PROD Supabase, not TEST: a real TEST-signed session JWT (minted via
`mint-dev-session.ts`) was injected into that live URL and bounced straight
to `/auth/sign-in` `[measured 2026-08-28]` — a TEST-signed session is only
rejected if the site validates against a different Supabase project. The
sign-in page itself corroborates this independently: it shows the real
"Continue with Google — GOOGLE · ONLY SIGN-IN METHOD FOR V1" production
flow, not TEST's password-based seed accounts. **There is no hosted
deployment of `main` that talks to TEST** — no `vercel.json`, no
staging/test branch alias, nothing else in the repo pointing at a second
hosted URL `[grep, 2026-08-28]`. No write was attempted against the
Production URL. Switched to a local dev server on `origin/main`'s tip
(`e7f4767`) against TEST instead, per direction.

**UI-level verification — PASS, no drift from the pre-merge branch check:**
checked out `origin/main` as detached HEAD, fresh `next dev` on :3210
against TEST, minted a real `seed-owner` session, drove a real
headless-Chrome browser to `/plan/expedition`. Toggled BOTH the START and
END rows into coordinate mode (2/2 toggle buttons worked); filled START
with an in-region point (Barstow, CA) and END with a coordinate
**deliberately outside the six-state region** (New York City) — both
resolved (`"resolved"` badge, no error), and the submit button stayed
enabled (`submitDisabled: false`). **Confirms the ADR's exemption
end-to-end on the actual merged UI: an out-of-region manually-entered
destination does not block submission.** Re-verified the out-of-range
check: latitude 95 correctly showed the inline "Latitude must be between
-90 and 90." error and cleared the resolved state — identical to pre-merge
behavior.

**Full submit → generation → persisted-TEST-row check: INCONCLUSIVE, for
reasons external to this feature's code — not glossed over:**
- While debugging why a first click silently produced no state change, found
  that plain `.click()` on the submit `<button>` did not reliably fire
  React's `onClick` in this CDP-driven headless-browser harness, while
  `el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}))`
  did `[observed, this session]`. Worth remembering for future
  browser-verification sessions — not recorded elsewhere yet.
- The shared local dev server (one process; `lsof -i :3210` confirmed only
  one listener) showed what circumstantial evidence points to as a second,
  independent browser session at the same time — **not directly confirmed,
  flagged as inferred, not proven:** a `com.apple…WebKit.Networking`
  process held a connection to `localhost:3210` that wasn't this session's
  headless Chrome, and TEST `public.trips` gained a real trip —
  `"Los Angeles, CA → Custom Point (36.0680, -118.5320)"`, id
  `3646c30b-ab0e-4ee1-93a3-07035c95de4f`, created `2026-08-28T03:08:47Z` —
  whose anchors, dates, rig, and `guaranteedCategories` this session never
  entered `[queried TEST, 2026-08-28]`. That row was left untouched — it
  wasn't this session's test debris to delete.
- When this session's own submission (Barstow → NYC, confirmed intact in
  the DOM right up to the click) finally reached the LLM call, the shared
  `ANTHROPIC_API_KEY` had run out of credits: `"Your credit balance is too
  low to access the Anthropic API"` `[observed error banner, this
  session]` — a real external resource constraint, not a code defect.
  `preComputeFacts`/real Mapbox routing had already succeeded by that point
  (the failure was inside `generateAndAudit`). The action failed before the
  insert step, so **no trip was persisted from this session's own test** —
  confirmed by re-querying TEST `public.trips` immediately after.
- The pipeline-level equivalent of this exact check (real Mapbox routing +
  real Claude generation + real signed-in TEST insert/read-back/delete, via
  the standalone `verify-manual-coordinate-anchor.ts` script) had already
  passed 9/9 twice pre-merge, when the API key still had credit — see the
  `## 2026-08-27` section below.

**Cleanup:** dev server and headless Chrome stopped; no temp files left in
`web/scripts/`; working tree clean (`git status`); no `public.trips` row
was written or needed deleting by this session.

**Open, not decided here:** whether to re-run the full submit check once
the shared Anthropic key is topped up.

## 2026-08-27 — manual GPS coordinate entry for expedition start/end

Newest truth. Branch `gps-coordinate` off `origin/main`. Followed a prior
read-only investigation (same session) into whether `/plan/expedition`'s
start/end path had any hard `place_id`/Google-Places dependency — it found
none: the wizard's city search is Mapbox Geocoding v6, not Google Places,
and `coords` was already the preferred signal everywhere downstream
(`preComputeFacts`, `routeBetween`, `itineraryToTrip`).

**What was built:**
- `web/src/lib/plan/parse-coordinates.ts` — pure `parseCoordinateEntry`/
  `formatCustomPointLabel`, range-validated (-90/90 lat, -180/180 lng), 8
  passing unit tests.
- `web/src/components/plan/coordinate-input.tsx` — the lat/lng entry
  control, thin wrapper over the pure parser.
- `ExpeditionDestination.manualCoords: boolean` (`lib/plan/expedition.ts`) —
  set only by the new control; narrowly exempts that one destination from
  `validateExpeditionForm`'s planning-region check
  (`!d.manualCoords && !isInPlanningRegion(d.region)`), rather than
  loosening the check generally. `planning-region.test.ts` gained a test
  for the exemption and kept the existing "hand-crafted POST" rejection
  test intact (still rejects when `manualCoords` is false).
- A per-destination-row toggle in `expedition-wizard.tsx` ("coords" /
  "search") swapping `LocationAutocomplete` for `CoordinateInput`.

**The one real design decision, recorded as an ADR
(`docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`):**
hand-entered coordinates bypass the planning-region gate entirely rather
than reverse-geocoding to recover a `region_code` and gating them the same
way as autocomplete picks. Deliberate testing-scope shortcut, not a claim
the gate stopped mattering — an out-of-region hand-entered coordinate now
reaches generation unaudited against every downstream six-state assumption.
Tracked as a BACKLOG item to revisit if this input mode is ever promoted
beyond dev-only testing.

**Verification, both real (no mocks):**
1. `web/scripts/verify-manual-coordinate-anchor.ts` — mirrors
   `generateExpeditionTripAction` function-for-function (minus the corpus
   write-back, out of scope). Real Mapbox routing resolved 212.6 mi from the
   manual start coordinate; real Claude generation returned a 3-day
   itinerary; a real signed-in insert into TEST `public.trips` succeeded,
   the row read back matching, then was deleted. **9/9 checks passed.**
   Needs `NEXT_PUBLIC_MAPBOX_TOKEN` and `ANTHROPIC_API_KEY` borrowed from
   `.env.local` (same gap/shape as the existing Mapbox-token RUNBOOK
   gotcha — neither is in `.env.development.local`).
2. A real headless-Chrome session (CDP, dev server on :3210, a minted
   `seed-owner` session cookie) drove the actual rendered wizard: the
   "coords" toggle button is on-screen AND reachable
   (`elementFromPoint` hits the button itself, not an overlay); clicking it
   swaps in the two lat/lng inputs; a valid pair shows the existing
   "resolved" badge; an out-of-range latitude (95) shows the inline
   "Latitude must be between -90 and 90." error and clears the resolved
   state; toggling back to search mode reverts cleanly to an empty
   `LocationAutocomplete`.

**Gate:** `npm run -w web typecheck` and `cd web && npx next build` both
exit 0.

**Docs touched this pass:** this file, `LOG.md`, `BACKLOG.md`, the new ADR,
`docs/architecture/trip-creation-surfaces.md` (two in-place corrections —
the destinations table row, and the "no freeform escape hatch" claim, which
is no longer true), `CLAUDE.md` RUNBOOK (extended the Mapbox-token gotcha to
cover `ANTHROPIC_API_KEY`). `docs/DATA_INVENTORY.md` untouched — no schema
or data-source change.

## 2026-08-26 (redesign) — corridor-city selection: strict 3mi proximity

Newest truth. Branch `fix/corridor-strict-proximity` off `origin/main`
(`58cfcf0`, #295). Test-suite rewrite + 2 named regressions; local gate exits 0
on both workspaces. Verified on real route geometry.

**What changed (`web/src/lib/corridor/derive.ts`):** `deriveCorridorCities`'
prominence + 50mi-`minSpacing` greedy selection (+ gap-fill + 4-cap) is REPLACED
by strict proximity: a city is a corridor node iff its offset ≤ `corridorMi`
(3mi) and it clears the population floor. No prominence, no spacing suppression,
no reach-further fallback (a day may have zero corridor cities). `bufferMi`
(15mi) stays as the SHARED on-corridor tolerance for bucket/bake/stretches/seeds
— the 3mi rule is a new, scoped param. `maxNodes` 4→40 (backstop, along-route
truncation). `minSpacingMi`/`maxGapMi` removed; tight 0.5mi same-point dedup
added (no-op on measured trips).

**Why:** the greedy model let one prominent city suppress its 50mi
neighbourhood — SF hid Concord/Fairfield/Vacaville, Sacramento hid Davis, all
genuinely on-route. Buffer distance and any single spacing value can't fix it
while prominence-greedy remains. This one redesign also subsumes the SF
"water-detection" fix (SF is now out purely by the 3mi gate).

**Verified (real geometry; TEST trips were reset mid-task, so endpoints
re-routed):** Concord(1.59)/Fairfield(1.35)/Vacaville(0.41) IN; Woodland(9.63) +
SF(11.56) OUT; Davis(0.43) IN; Sacramento OUT at its real 3.09mi; rural US-395
day = ZERO cities.

**Flagged:** (1) Woodland drop = accepted tradeoff, not a correction; (2)
Sacramento excluded while suburbs included (boundary artifact); (3) **density
cascade** — 21–29 corridor cities/day on dense suburban routes → many backfill
anchors (#295 shares the derivation). (3) is the top product/density follow-up
(BACKLOG + ADR), deliberately not decided here.

## 2026-08-26 (fix) — audit/bake corridor-anchor granularity mismatch

Newest truth. Branch `fix/audit-anchor-granularity` off `origin/main`
(`ddd5494`, #294). Shared-helper refactor + 3 new tests; local gate exits 0 on
both workspaces. Verified read-only on TEST real data.

**Bug:** the backfill audit selected anchors from `facts.corridorCities`
(derived by `deriveCorridorCities` over the WHOLE route — coarse). The itinerary
renders a finer per-day spine (`bake.ts`, `deriveCorridorCities` per day). Cities
on the day spine but dropped from the route spine — Oceanside, Arvin — were
visible nodes the backfill never considered. Distinct from the per-city cap bug;
a granularity mismatch between two independent corridor derivations.

**Fix:** new `web/src/lib/corridor/day-corridor.ts` — `deriveDayCorridor`
(wraps `deriveCorridorCities` + bundled gazetteer, gazetteer injectable for
tests) and `dayCorridorAnchors` (start + per-day corridor cities minus those
within `nearMi` of an endpoint, in travel order). `bake.ts` and `audit.ts` BOTH
call it now — one derivation, no drift. Applied to both audit backfill blocks
(interest-guarantee + fuel). `facts.corridorCities` is no longer used for
anchors (still present on the type).

**Verified (read-only, real day-1):** routed San Diego → Bakersfield, ran the
shared helper. Per-day spine: San Diego(start), Oceanside, LA, Arvin,
Bakersfield(end). Backfill anchors: San Diego, **Oceanside**, LA. **Arvin is in
the raw spine but excluded — 15.7mi from the Bakersfield end (< 25mi) — the
endpoint rule, not absence.** `pickGuaranteedStop` at Oceanside → "Top Gun
House". So Oceanside now gets backfill; Arvin correctly stays out.

**Tests:** `day-corridor.test.ts` (synthetic gazetteer, equator harness): a city
dropped from the whole-route spine is still a per-day anchor; the Arvin-class
endpoint exclusion still fires (present in raw spine, filtered); short/absent
polyline → start anchor only. 119 corridor + 182 itinerary pass.

**Flagged tradeoff:** finer spine ⇒ more anchors/day × 2 picks each ⇒ denser
trips (accepted; compounds with the per-city change). Levers: `MAX_BACKFILLS_
PER_CITY`, corridor `maxNodes`/`minSpacingMi`, or a per-day ceiling.

## 2026-08-25 (fix) — guarantee cap was per-DAY, rescoped to per-CITY

Newest truth. Branch `chips-check` (stacked on the chip-UI work). TDD-first
(2 new tests + 2 rewritten); local gate exits 0 on both workspaces.
Verified read-only on TEST real data.

**Bug:** `MAX_BACKFILLS_PER_DAY` capped `pickBackfillStops` phase 1 at 2 picks
per DAY. The loop is anchor-major and broke on the shared cap, so the day-START
anchor consumed the whole budget and mid-corridor cities got zero — defeating
D-B's per-city density. Diagnosed on trip `ab146c1d` (San Diego → Reno):
San Diego took both slots (scenic + camping), Oceanside/Riverside/Silver Lakes
starved despite real candidates. A **correctness bug against the spec**, not the
category-monopoly tuning tradeoff PR #292 flagged.

**Fix (`anchor-backfill.ts`):** `MAX_BACKFILLS_PER_DAY` → `MAX_BACKFILLS_PER_CITY`
(2). Phase 1 tracks a per-anchor `cityPicks` counter; the day-level
`picks.length >= max` breaks were removed from BOTH phase 1 and phase 2 (the
opener break starved later anchors too). Cross-anchor dedupe (`taken`) kept, so
one POI is still never featured twice on a day. `audit.ts` + wizard hint +
`generation-pipeline.md` comments updated off the rename.

**Verified (read-only, real pool):** preComputeFacts(San Diego → Reno) + real
`pickBackfillStops` on day-1 anchors → 8 guarantee picks across 4 cities (2
each), where pre-fix only San Diego got 2. Oceanside (camping+scenic),
Riverside (camping+scenic), Silver Lakes (scenic+oddity) all now covered.
Caveat: isolated with `onCorridor` open + all-categories-missing to show
per-city distribution; the real audit subtracts LLM coverage so exact picks
vary — the per-city structure is the point.

**Flagged consequences (ADR + BACKLOG):** (1) category-monopoly still applies
WITHIN a city's 2 slots; (2) no per-day ceiling means a multi-city day can
surface more machine picks than before — the old "list of towns" concern is now
bounded per-city, a deliberate consequence of the density spec.

## 2026-08-25 (build) — interest-category chip UI (blocker F resolved)

Newest truth. Branch `chips-check` off `origin/main` (`88f3d83`, #292). TDD-first
(3 new tests); local gate exits 0 on both workspaces. Live-verified on TEST via
headless-Chrome CDP.

**What shipped:**
- `web/src/lib/plan/guarantee-categories.ts` — `GUARANTEE_CHIP_CATEGORIES`, the
  6 `{key,label}` chip descriptors in wizard order (`scenic, food, camping,
  attraction, oddity, urban`). The presentation-layer face of the backend gate
  `GUARANTEE_CATEGORIES` (`anchor-backfill.ts:73`).
- `web/src/lib/plan/guarantee-categories.test.ts` — 3 tests. The key one asserts
  the chip key set === `GUARANTEE_CATEGORIES` (imported), so the UI can't drift
  out of sync with what the backend honors.
- `web/src/components/plan/expedition-wizard.tsx` — the "Interest categories"
  `<Section>` now renders a `SelectableChip` row (per-category
  `var(--cat-{key}-title)` accent, controlled multi-select on
  `guaranteedCategories`) above the pre-existing fuel checkbox. Stale scaffold
  comment on the `guaranteedCategories` state hook updated.

**The flagged "overnight" ambiguity — RESOLVED (see the masthead + the ADR).**
`overnight` (`SlideCategoryKey`) = display `hotel` (isomorphic, `palette.ts`);
it is NOT "camping+hotel combined". Backend acts on **6** categories; `camping`
DOES act; `hotel`(=overnight) and `interest` are the only excluded interest
categories, so they get no chip (would silently no-op). **6 chips, not the
task's 8** — deviation flagged in PR/BACKLOG/ADR.

**Live TEST verification (read-only, no generation run):** headless Chrome via
CDP against `next dev` (3210, minted seed-owner session). All 6 chips render
with correct labels; all `onScreen` + `reachable` (`elementFromPoint` at each
chip center is inside the chip — genuine reachability, not just handler wiring).
Real pixel-clicks: scenic+camping → both `checked`, others false (multi-select);
scenic toggled off → camping stays (independent). No trip generated, no DB write.

## 2026-08-25 (build) — interest-category guarantee at decision D-B (per-city)

Newest truth. Branch `feat/guarantee-selector` off `origin/main` (`3e48dda`).
TDD-first; 37 `anchor-backfill` tests (25 pre-existing unchanged + 12 new) +
180 itinerary tests pass; local gate exits 0 on both workspaces. Live-verified
read-only on TEST. ADR + BACKLOG updated.

**Decision:** D-B (per-city) resolves blocker **D** of
`docs/specs/interest-category-chips.md`. Adam chose D-B over the brief's D-A
recommendation for **density around the actual cities passed** rather than an
even one-per-day spread. Full rationale + the flagged consequences:
`docs/decisions/2026-08-25-interest-category-guarantee-granularity.md`.

**What shipped (spec §11 steps 5–7):**
- **Step 5** — `audit.ts` backfill block computes per-anchor missing
  categories (`missingAt(coords)`): the user's pool-side guaranteed categories
  minus those covered by a kept stop within `ANCHOR_NEAR_MI`. Per-city, so the
  same category can be outstanding (and picked) at more than one city on a day.
  Coverage attributed from pool-hit `SlideCategoryKey`s; only `restaurant`→
  `food` maps a live-resolved keyStop (`RESOLVED_TO_GUARANTEE`).
- **Step 6** — NEW pure selector `pickGuaranteedStop` in `anchor-backfill.ts`,
  ALONGSIDE `pickAnchorStop` (not a replacement). Own gate
  `GUARANTEE_CATEGORIES` = `scenic, food, oddity, attraction, camping` **+
  `urban`**. Same shared gates + `rank`. Takes `pool` as input — **NOT**
  `resolvePlaces()` (deferred).
- **Step 7** — two-phase `pickBackfillStops`: phase 1 guarantee (Option A —
  wins the shared `MAX_BACKFILLS_PER_DAY` cap first, per-city, per-category in
  selection order), phase 2 the existing opener loop for remaining slots.
  Backward-compatible: no `missingCategories` ⇒ phase 1 no-op, byte-identical
  to before.

**`urban` gate (spec §5 / task Step 5) — RESOLVED by the selector's own gate.**
`urban` stays out of `OPENER_CATEGORIES` (unrequested opener = tautology) but is
IN `GUARANTEE_CATEGORIES` (an explicit user guarantee is not a tautology). Still
passes `isCityTautology`, so it surfaces a distinct urban POI, never the anchor
town. Chosen over widening the opener gate (which would regress the opener path).

**Flag:** `INTEREST_CATEGORY_GUARANTEE` — ON by default (kill switch), same
posture/rationale as `KEYSTOP_ANCHOR_BACKFILL`. Pool-only, no network.

**Flagged deviations (per the ask, not dropped):** (1) `fuel`/`overnight`
EXCLUDED from the gate — spec §11 step 6 says don't merge until B.1/B.2 resolve;
(2) rank order is the spec's recommended default, not an Adam pick; (3)
cross-category cap saturation (a `[scenic, food]` guarantee can yield 2 scenic /
0 food under the 2-slot cap — observed live); (4) coverage attribution is
pool-hit-first. All in the ADR + BACKLOG.

**NOT touched:** the chip UI (blocker F — wizard still has only the fuel
checkbox; the 6 categories reach the audit only via `guaranteedCategories`, so
the feature is wired end-to-end but dark from the wizard), path A / Mapbox swap,
`preComputeFacts`/`fetchCorpusForSegment/Polyline` (deferred BACKLOG item).

**Live TEST verification (read-only, no LLM, no writes):**
`web/scripts/verify-guarantee-percity.ts` drives real `preComputeFacts` +
`auditItinerary` with a synthetic empty-keyStops itinerary. San Diego→SF
(1266 pool POIs, 9 corridor cities) and Sacramento→Reno (434 POIs, 4 cities):
a `scenic` guarantee produced two `guaranteed` scenic picks at two DISTINCT
corridor cities (per-city density confirmed); control = openers only; guarantee
won the cap over the opener (Option A). TEST corpus is scenic-heavy (one
corridor had 2 `food` rows, another 0), so a `food`/`oddity` guarantee is
data-limited there — a corpus-coverage reality, not a mechanism defect.

## 2026-08-25 (build) — TEST-only "Continue as seed test user" sign-in bypass

Newest truth. Branch `feat/test-only-signin` off `origin/main` (`04e9855`).
TDD-first; 16 unit tests pass; local gate exits 0 on both workspaces.
Live-verified on TEST and PROD-simulation this session.

**Why:** Google OAuth is not an enabled provider on TEST Supabase
(`/auth/v1/settings` returns email-only `[measured 2026-08-24]`), so the
"Continue with Google" button — the ONLY sign-in method in the UI — cannot
complete against TEST. Dev workflows needing an authenticated session
required cookie injection via `mint-dev-session.ts`. This adds a second
button on `/auth/sign-in` (TEST-only, structural gates) that signs in as
the pre-existing seed user `seed-owner@overlander.test` via
`signInWithPassword`.

**What shipped:**
- `web/src/lib/supabase/env.ts` — `TEST_SUPABASE_PROJECT_REF` +
  `TEST_SUPABASE_URL` constants; `isTestSupabaseUrl()` (rejects
  undefined, empty, wrong-scheme, prefix/suffix/subdomain attacks, PROD);
  `isNonProductionRuntime()` (fails closed on undefined/empty/unexpected);
  `isTestOnlyBypassAllowed()` combining both. 16 unit tests locking every
  failure mode.
- `web/src/app/auth/actions.ts` — new `signInAsSeedTestUser` server
  action. Gates on `isTestOnlyBypassAllowed()` FIRST, then
  `isConfigured()`, then calls
  `supabase.auth.signInWithPassword({email: "seed-owner@overlander.test",
  password: "seed-pw-manual-edit-8471"})`. Hardcoded TEST fixture
  credentials — same pair used by `mint-dev-session.ts` and seeded by
  `seed-test-user.ts:15`. On gate failure redirects to
  `/auth/sign-in?error=test_bypass_not_allowed`.
- `web/src/app/auth/sign-in/page.tsx` — additive `<form>` block below
  the Google button, visible only when `isTestOnlyBypassAllowed()`
  returns true. Subdued outline styling, distinct amber "TEST only ·
  seed-owner@overlander.test" caption. Error toast recognises the new
  `test_bypass_not_allowed` code with a friendly message.
- **Google sign-in path unchanged.** `signInWithGoogle` + the OAuth
  callback route + the "Continue with Google" button + the "Google · only
  sign-in method for v1" caption are all byte-for-byte the same. This is
  purely additive.

**⚠ Structural PROD-safety — three independent gates, all fail closed:**

1. **URL match** — `NEXT_PUBLIC_SUPABASE_URL` must equal
   `https://znldzjdatkogdktymtvi.supabase.co` exactly (with an optional
   trailing slash). Rejects undefined, empty, `http://` scheme, PROD ref
   (`nqzeywzcowujzyegxbsr`), prefix attacks
   (`znldzjdatkogdktymtvi-evil.supabase.co`), suffix attacks
   (`znldzjdatkogdktymtvi.supabase.co.evil.com`), subdomain attacks
   (`evil.znldzjdatkogdktymtvi.supabase.co`). All these cases have named
   unit tests.
2. **Runtime match** — `process.env.NODE_ENV` must be `"development"` or
   `"test"`. Production builds (Next.js sets `NODE_ENV="production"`),
   undefined, empty string, and unexpected values (`"staging"`,
   `"prod"`, `"dev"`) all fail closed.
3. **Data-shaped backup** — `seed-owner@overlander.test` does not exist
   on PROD Supabase; even if both structural gates were bypassed, GoTrue
   would reject with `invalid_credentials`.

Both structural gates run at BOTH render time AND server-action submit
time — a hand-crafted POST that skips the render check still hits the
gate inside the action.

**Live verification (this session):**
- **TEST env** — `next dev` on `.env.development.local` (TEST URL).
  `/auth/sign-in` HTML contained "Continue as seed test user" + "TEST
  only · seed-owner@overlander.test" alongside the Google button.
  `POST /auth/v1/token?grant_type=password` against TEST auth server
  with fixture creds returned an `access_token` for user id
  `a2f74eb2…` — the same user `mint-dev-session.ts` produces.
- **PROD-URL simulation** — restarted `next dev` on port 3211 with
  `NEXT_PUBLIC_SUPABASE_URL="https://nqzeywzcowujzyegxbsr.supabase.co"`
  overridden. TEST anon key kept, so no PROD data access happened.
  `/auth/sign-in` HTML contained ONLY "Continue with Google" — the
  bypass button and TEST-only caption were absent. Render-side gate
  confirmed working.

**Full decision + reversal instructions:**
`docs/decisions/2026-08-25-test-only-signin-bypass.md`.

## 2026-08-25 (build) — Mapbox Search Box as the `fuel` source (web-client browse surfaces)

Newest truth. Branch `feat/mapbox-fuel-source` off `origin/main` (`04e9855`,
now includes PR #288). TDD-first; 13 tests pass; local gate exits 0 on both
workspaces. No live TEST run this session — no `NEXT_PUBLIC_MAPBOX_TOKEN`
exercised.

**Feature framing:** Google Places on a non-Google map requires the Places UI
Kit as a compliant display path. This app renders on Mapbox GL JS. Mapbox
Search Box results are display-permitted on a Mapbox map without an equivalent
UI Kit constraint. Fuel-station discovery on the web-client browse surfaces
(`/api/trip-browse`, `/api/search-area`) moves from Google to Mapbox for that
compliance reason; 8 other slide categories stay on Google.

**What shipped:**
- **New source: `web/src/lib/discovery/mapbox-search-box.ts`** — a
  `WaypointSource` calling the Mapbox Search Box category endpoint
  (`https://api.mapbox.com/search/searchbox/v1/category/gas_station`) with
  `bbox`, `limit=25`, `access_token=NEXT_PUBLIC_MAPBOX_TOKEN`. Fuel-only
  today (returns `[]` for non-fuel category requests). Testable via
  `createMapboxSearchBoxSource({fetchImpl, tokenFn})` DI seam; 13 unit
  tests lock URL, parser, category filter, no-token guard, HTTP failure
  modes, happy path, bbox/token passthrough.
- **`SourceId` union gains `"mapbox"`** (`web/src/lib/discovery/types.ts:6-31`)
  + `SOURCE_LABEL.mapbox = "Mapbox"` (`to-browse-place.ts:12`) — the
  per-source id surfaces as the "Sourced from Mapbox" mention on the tile.
- **Google fuel disabled at source:** `TYPES_BY_CATEGORY.fuel = []`
  (was `["gas_station"]`) in `web/src/lib/discovery/google-places.ts:53`.
  Google's category-fanout returns [] for fuel-only requests (via the
  `includedTypes.length === 0` early-return at `:114`); no HTTP call to
  Google for fuel.
- **Source-list wiring across FOUR call sites** — Mapbox at head of:
  - `LIVE_SOURCES` in `web/src/app/api/trip-browse/[tripId]/[dayId]/handler.ts:57`
  - the inline sources array in `web/src/app/api/search-area/handler.ts:164`
  - `DEFAULT_BBOX_LIVE_SOURCES` in `web/src/lib/places/resolve-places.ts`
  - `DEFAULT_CORRIDOR_LIVE_SOURCES` in `web/src/lib/places/resolve-places.ts`

  Head position is for `discover()`'s dedupe canonicalization, not fanout
  order (Mapbox and Google are disjoint by category after the change).
- **D7 resolved** — kept `BrowsePlace.source` at its binary `"live" |
  "master_place"` distinction; added per-source id `"mapbox"` on
  `SourceResult.sourceId` only. Mapbox-sourced tiles project to `source:
  "live"` (same as any other live source). Reasoning: `BrowsePlace.source`
  drives hydration eligibility and cache-key behavior (coarse binary);
  per-source attribution belongs on `sourceId` where `SOURCE_LABEL` already
  reads it. Documented in the `SourceId` union comment for the next
  reader.

**Wiring choice — why fuel-via-Mapbox works on BOTH legacy AND resolver
paths, without inventing a per-category flag mechanism:**
- `TRIP_BROWSE_USE_RESOLVER` / `SEARCH_AREA_USE_RESOLVER` are per-surface,
  not per-category. Flipping them globally would move 8 other categories
  through the resolver as a side effect — explicitly out of scope.
- Solution: add Mapbox to BOTH legacy source lists AND resolver defaults.
  Fuel-via-Mapbox is now identical on both paths; the flag state
  literally doesn't matter for fuel. No per-category flag mechanism
  invented (per Adam's Step 3 explicit constraint).
- Both flags remain OFF by default (unchanged).

**Adam-flagged deviations, called out per Step 5:**
- **NO npm dep added** — `@mapbox/search-js-*` would carry autocomplete +
  session-token + retrieve-by-id machinery for the /suggest+/retrieve
  two-step flow that this source doesn't use. The category endpoint is one
  URL + one JSON parse; hand-rolled fetch is ~40 lines vs pulling the SDK.
  Ask-before-dep bar in `web/CLAUDE.md` cleared by hand-rolling. Flagged.
- **Free-text search remains a residual Google-fuel path.**
  `categoryForGoogleTypes` (`google-places.ts:410`) still assigns
  `"fuel"` to a `gas_station`-typed text-search result via
  `googleTextSearchSource`. Adam's task scoped the swap to category
  discovery (categoryical fanout); free-text is distinct UX. Not touched;
  flagged as a residual for possible follow-up.
- **Mapbox Search Box category endpoint returns fewer rich fields than
  Google.** No rating, no price tier, no photos, no hours. Fuel tiles
  will render without those. Not a regression per se — Google fuel tiles
  rarely carried photos either — but a UX consequence to name.

**⚠ Path A (audit-time fuel-live-resolve, PR #288 `04e9855`) remains on
Google.** `pickFuelAtAnchor` + `PlaceResolver.resolveNearby("gas_station",
...)` in `web/src/lib/itinerary/fuel-live-resolve.ts` +
`web/src/lib/itinerary/resolve.ts:176-253` + `audit.ts:634-652` — all
untouched this session per Adam's direction. Path A persists
`google:<placeId>` tiles into `trips.payload.days[].segmentSuggestions` via
the audit-time bake. Migrating it to Mapbox needs either a new scope in
`resolvePlaces()` or a separate Mapbox resolver + tile-id-scheme rename;
tracked in BACKLOG.

**Not verified this session:**
- **No live TEST run.** `NEXT_PUBLIC_MAPBOX_TOKEN` not exercised in this
  workspace. First real invocation lands when the browse surfaces are
  hit against TEST with the token set.
- **No state-by-state coverage comparison.** Adam asked for a possible
  spot-check across CA/AZ/NV/UT/WA/OR versus Google's prior results;
  the comparison would need a live Mapbox response, which this session
  didn't produce.

**Full decision doc:** `docs/decisions/2026-08-25-mapbox-fuel-source.md`.

## 2026-08-25 (build) — fuel-category guarantee via live Google Places (feature-flagged OFF)

Newest truth. Branch `feat/fuel-live-resolve` off `origin/main` (`1fda7de`,
#286). First BUILD from the Interest-Category-Chips scoping arc (PR #287,
still open on a sibling branch — the two are independent PRs). TDD-first;
9 unit tests pass; local gate exits 0 on both workspaces (`typecheck`,
`next build`, `data typecheck`). No PROD reads, no DB writes, no live LLM
run.

**What shipped:**
- `web/src/lib/itinerary/fuel-live-resolve.ts` — new module. Pure(ish);
  `pickFuelAtAnchor({anchor, keptFuelCoords, fuelType, resolver, onCorridor})
  → Promise<FuelPick | null>`. 9 tests locked (dedupe below `ANCHOR_NEAR_MI`,
  no-Google-call on hit; resolver not-found/capped/no-key all return null;
  off-corridor rejected; happy-path shape; bias-coord wiring; fuelType
  passthrough).
- `PlaceResolver.resolveNearby(includedType, biasCoords)` extension in
  `web/src/lib/itinerary/resolve.ts` — hits `places:searchNearby` for one
  `includedType`, 5 km circle, `rankPreference: DISTANCE`,
  `maxResultCount: 1`. Cache key namespaced `nearby:<type>:<lng>:<lat>` (no
  collision with existing text-search cache). Shares `RESOLVE_CAP` +
  `liveCalls` counter with `resolve()`.
- `GenerationInput.guaranteedCategories?: string[]` +
  `ExpeditionForm.guaranteedCategories?: SlideCategoryKey[]` payload wiring
  (§11 steps 2 + 3 from the scoping doc, unblocked). `expeditionToGenerationInput`
  copies through; wizard has a `useState<string[]>([])` alongside the other
  eleven state hooks.
- Wizard: **single fuel checkbox** in a new "Interest categories" `<Section>`
  between "Trip details" and "Your rig" (spec §1 placement). Deliberately
  NOT the full 8-chip row — that's F+D-blocked per §11, and a 1-of-8-working
  row is misleading; replace-in-place when D+F resolve.
- Audit-loop hook in `web/src/lib/itinerary/audit.ts` (~50 lines) —
  runs AFTER `pickBackfillStops` per day, gated on
  `FUEL_LIVE_RESOLVE=true` env var + `input.guaranteedCategories?.includes("fuel")`
  + `dayStartCoord`. Computes `keptFuelCoords` from pool-hits
  (`category === "fuel"`) + live-resolves (raw type in
  `FUEL_LIVE_CATEGORIES = {gas_station, truck_stop,
  electric_vehicle_charging_station}`). Iterates the same anchor list the
  general backfill uses (day-start + mid-corridor cities on the day's
  polyline). Each successful pick appends to `keptStops` +
  `resolvedPlaces` + local `keptFuelCoords` dedupe.
- Decision doc: `docs/decisions/2026-08-25-fuel-live-resolve.md`.

**Two flags Adam explicitly asked me to check + surface, not silently
build around** (already reported in PR #287; recapped here since this is
where they resolve):
- **Rig fuel-type — the ask's premise was FALSE `[grep 2026-08-25]`.**
  Adam wrote "per the rig profile's fuel type (electric vs. gas, already
  known from the vehicle profile)" — no `fuelType`/`powertrain`/`electric`
  field exists on either `RigProfile` shape (`facts.ts:68-77`,
  `web/src/lib/vehicles/types.ts:23-35`); both carry `fuelRangeMi: number`
  only. Wizard has no fuel-type input. **How this ships today:**
  `FUEL_LIVE_INCLUDED_TYPE = "gas_station"` hardcoded at the audit callsite;
  EV rigs get gas picks. `pickFuelAtAnchor` itself takes `fuelType` as a
  parameter — the fix is a rig-field addition, not a module change.
- **Feature-flag posture flipped from `KEYSTOP_ANCHOR_BACKFILL`.**
  `KEYSTOP_ANCHOR_BACKFILL` is ON by default because it's in-memory
  (pool-only). `FUEL_LIVE_RESOLVE` is OFF by default because it issues
  live Google `searchNearby` calls — new external cost source. Flagged
  as a decision in the doc; Adam asked me to flag whether a flag was
  needed at all (answer: yes, and default OFF).

**Cost bound (analytical, not measured):** shared per-generation cap is
`Math.max(80, days × 8)` (`audit.ts:352`). Worst case for a 10-day trip
= 40 fuel anchors + ~15 LLM keystop resolves = 55 calls; fits under 80.
Worst case for a 20-day trip = 80 fuel + 30 keystop = 110; fits under
`max(80, 160)`. Cost per call is 2.5-3.2¢ per `resolve.ts:15-16`
docstring (stated range, not measured this session). Analytical worst
case ≈ $1.20–$2.60 per trip for the fuel branch, assuming zero pool
dedupe. Realistic case not measured — dedupe rate depends on how often
the LLM already picks fuel.

**Verification gaps to flag:**
- **Audit-hook integration coverage is thin.** The pure `pickFuelAtAnchor`
  module is unit-tested (9 tests); the audit wiring is verified only by
  typecheck + `next build` + feature-flag-OFF containment. `auditItinerary`
  constructs its `PlaceResolver` internally (`audit.ts:352`) — an
  integration test would need either a DI-seam refactor or an env-var
  setup. Not added; flagged in the decision doc.
- **No live TEST run.** Nothing actually called Google this session (no
  key set in this workspace). First real invocation lands when Adam
  turns `FUEL_LIVE_RESOLVE=true` in a dev env.

**Not touched:** the general backfill (`anchor-backfill.ts` /
`pickAnchorStop` / `pickBackfillStops`) is unmodified — the fuel path is
deliberately a separate mechanism per Adam's direction. The other 6
guarantee-eligible categories (`camping, scenic, food, oddity, attraction,
urban`) remain D-blocked in the scoping doc §11 (need the audit-loop
granularity call before their integration lands).

## 2026-08-24 (fix) — fuzzy name+proximity tier closes the tile-present overnight gap

Newest truth. Branch `fix/overnight-fuzzy-match` off `origin/main` (#282–#284 all
merged — no open stack). Code + tests. Decision doc Follow-up 6.

Adds **tier 3** to overnight tile-marking: when the exact id (#279) and the
`google_place_id` bridge (#284) both miss, fuzzy-match the overnight's pool POI
(name + coords, carried on `DayAudit.overnightName`/`overnightCoords`) against
**the day's own tiles**. Both bars must clear: **name** strict (every token of
the shorter name in the longer, ≥2 tokens; "Convict Lake" ≈ "Convict Lake
Campground", not "Convict Creek Trailhead") **and** **distance** `≤ 0.5 mi`
(~805 m). Mark the single closest qualifier; none clears → nothing marked (prose
fallback). Tiers 1/2 always win a conflict (tier 3 runs only when they miss).

**Step-4 re-check (real corpus + Google coords, no LLM re-gen — offered, not
run):** **Hope Valley (Day 4) now MARKS** — corpus "Hope Valley Campground" vs
Google "Hope Valley", **0.067 mi** apart `[queried TEST + Google details]`.
**Convict Lake (layover) still correctly does NOT mark** — no tile exists at all
(the separate no-tile gap, untouched by design). Twin Lakes / Fallen Leaf still
mark via tier 1.

⚠ **Two CHOSEN thresholds flagged** (0.5 mi radius; strict subset + ≥2-token name
rule) — err strict per the brief, tunable if a looser confidence bar is wanted (a
product call). 158 itinerary tests pass; typecheck + build exit 0.

## 2026-08-24 (fix) — mp:/google: id reconciliation for overnight marking (correct, but inert on today's backcountry data)

Newest truth. Branch `fix/overnight-id-reconciliation`, **stacked on #283 →
#282 (both open)**. Code change + tests. Decision doc Follow-up 5.

**Built (Adam's scope: id-linking only, no tile synthesis):** `markOvernightTile`
takes a `googleId` — when the overnight's exact `mp:` ref matches no tile, it
falls back to the pool POI's `google_place_id`, marking a tile whose id is
`google:<gid>` or whose `placeId` is `<gid>`, in addition to and preferring the
exact match (no double-mark). Plumbing: `PoolPOI.placeId` (from the corpus tile's
`google_place_id`), `toPoolPOI` carries it, `DayAudit.overnightGoogleId`, `bake`
threads it. Fixes the Follow-up 4 Day-4 / Hope Valley shape (pool-hit overnight
whose place is on the spine as a live-resolve `google:` tile).

⚠ **Does NOT fix the reported backcountry cases yet — measured why.**
`master_place.google_place_id` is not a column; the corridor RPC joins it from a
linked google source_record, and **0 of 351 rows on the #283 corridor carry one**
(Hope Valley, Convict Lake, … all NULL) `[queried TEST]`. No bridge id → the fix
is correct but **inert** on backcountry data; it activates once a pool row has a
`google_place_id`. Reported, not shipped as a full fix. Does NOT paper over the
separate no-tile gap (Convict Lake / layover) — test-locked.

**Flagged, not built:** backfill `google_place_id` (re-introduces Google + a
coverage gap for the off-grid places the corpus exists for — data-quality call),
or name+proximity reconciliation (fuzzy — confidence threshold is a product
call). Tile synthesis stays out per instruction.

Gates: 149 itinerary tests pass; typecheck + build exit 0.

## 2026-08-24 (verify) — pool-hit overnight gap REPRODUCED live (dwell + backcountry); root cause broadened

Newest truth. Branch `verify/overnight-dwell-backcountry`, **stacked on
`verify/new-shady-rest-timing` (#282, not yet merged)**. Docs only, no
production code. Live generation on #279 code (LLM spend approved), TEST. Full
write-up: decision doc Follow-up 4.

Ran Bishop → Mammoth (dwell) → South Lake Tahoe with an off-highway-campground
objective to trigger #282's risk cases. **All 5 overnights were pool-hits;
2 marked, 3 not** (computed this run):
- **Marked:** Twin Lakes (day 3), Fallen Leaf (day 5) — pool-hit, tile in the
  day's fold.
- **Fold-miss (matches #282):** Convict Lake on day 1 AND the day-2 **layover** —
  the predicted dwell-day trigger, reproduced.
- **NEW sub-case (day 4, Hope Valley):** the place IS on the spine but as a
  live-resolve **`google:` tile** (the endpoint), while the overnight grounded
  pool-first to the **`mp:` id** → id-scheme mismatch → unmarked.

**Root cause broadened:** the overnight's ref id (pool-first `mp:`) and the id of
the tile that actually represents the place (per-day fold `mp:`, or endpoint/
keyStop live-resolve `google:`) can **differ or be absent** — independent paths,
different id schemes. #279 marks only when they coincide. A fix links by
canonical place / coords / `google_place_id` (not raw id) and/or synthesizes a
tile from the overnight's grounded coords — crosses the audit→bake seam.
**Flagged, not fixed.**

## 2026-08-24 (verify) — "New Shady Rest missing": timing for that trip, but a REAL pool-hit gap found

Newest truth. Branch `verify/new-shady-rest-timing` off `origin/main`. Docs only,
no production code. TEST reads + `preComputeFacts` probes (no LLM spend). Full
write-up: decision doc Follow-up 3.

- **The reported trip is TIMING, not a regression.** `2d014a87` "San Diego →
  Reno" (created 02:29 UTC) has **zero `isOvernight` anywhere** → generated by
  pre-#279 code. Its New Shady Rest tile (`mp:ec830a17`) is present in the fold
  AND in the route pool as the same id, so it *would* mark under #279.
- ⚠ **Deploy was not a clean cutover:** two #279-marked trips exist at 02:16/02:17
  UTC, *older* than the 02:29 unmarked one — the wizard is likely exercised
  across >1 environment. Infra question, not DB-determinable. Flagged.
- **A genuine #279 gap, found in a #279-generated trip (`c64ebc1c`, 02:16):**
  Day 1 Big Reservoir (pool-hit, tile in fold) MARKED; Day 2/3 William Kent +
  Kaspian have **no tile at all** → unmarked. Root cause: they're in the
  trip-wide pool (grounded as pool-hits) but the **per-day corpus fold didn't
  surface them**, so no tile carries `overnightRef` → `markOvernightTile`
  no-ops. **Live-resolve overnights synthesize a tile and always mark; pool-hit
  overnights rely on the fold and silently miss when it doesn't include them.**
  This is the ACTUAL residual (a coverage gap), not the name-collision earlier
  hypothesised. Fix scope (synthesize+bucket a tile from the pool POI) crosses
  the audit→bake seam — **flagged, not fixed.**

## 2026-08-24 (verify) — overnight link CONFIRMED live; badge subtle; Silver Strand collision doesn't bite

Newest truth. Branch `verify/overnight-live-generation` off `origin/main`. No
production code changed — docs only. Ran a **real generation** on #279 code (LLM
spend approved) against TEST to confirm the fix end-to-end. Full write-up:
`docs/decisions/2026-08-24-overnight-spine-tile-link.md` (Follow-up 2).

- **#279 works end-to-end — CONFIRMED.** SD→LA coastal gen: both overnights
  (San Elijo, San Onofre) got `overnightRef` (live-resolve), matched their baked
  tile by id, marked `isOvernight`+`curated`, featured on the spine; the Camping
  block derives from the tile, the "Overnight —" notes line is dropped, one card
  per place. The earlier "missing" was pre-#279-deploy trips (#280).
- **Silver Strand residual — does NOT manifest.** 7 `master_place` "Silver
  Strand" rows, but the pool and the Coronado fold both surface the single
  eligible `mp:54182e9b` — they agree `[queried TEST]`. Caveat: the LLM picked
  live-resolve overnights (immune), so a pool-hit overnight was not observed
  marked live; covered by id-agreement + the integration test. Still
  theoretically open; scope of a fix flagged in the doc.
- **Badge prominence (Q3) — renders but SUBTLE (screenshot-confirmed).** The
  overnight card is identical to a Key Stop card except the leading "Overnight ·"
  text in the same gray status line — no distinct colour/icon/badge. UX call,
  flagged not decided.
- **New minor:** overnight == day endpoint ⇒ 2–3 same-id tiles all flagged
  `isOvernight` in stored data; the render dedupes by id so one card shows.
  Harmless visually; a `bake.ts` dedupe would tidy it. Flagged.

## 2026-08-24 (diagnosis) — "overnight tile missing" reported → pre-#279-deploy trips, not a code bug

Newest truth. Branch `fix/overnight-tile-diagnosis` off `origin/main`. No
production code changed — adds a regression test + docs. TEST reads only.

**Report:** post-#279 the overnight link looked inconsistent (present some days,
absent others in one trip) with no visible "Overnight" badge anywhere.

**Root cause — NOT a #279 defect.** Measured every generated trip in TEST:
`isOvernight` is absent on **every** tile of **every** day — universal, not
day-specific `[queried TEST 2026-08-24]`. #279 landed on `main` at
**2026-08-25T01:23:46 UTC**; the newest TEST trip was created **01:26 UTC**
(pre-deploy) and the rest predate the merge — so none were generated by #279
code. The days that "worked" had the overnight tile featured only because the LLM
*also* made it a key stop (`curated`, `isOvernight` unset); no badge showed
because `isOvernight` was never set. **The #279 wiring is verified correct** by a
new integration test (`bake-overnight-integration.test.ts`) that drives the real
`bakeGeneratedDays` (fake RPC, no network) and confirms it sets `isOvernight`.
**Resolution: regenerate with #279-deployed code.**

**Residual risk (UNCONFIRMED, flagged):** a pool-hit overnight is linked by
`master_place` id, and TEST has duplicate rows per place (7 "Silver Strand"
rows) — if the audit's name-match picks a different row than the corridor fold,
the ref won't match a tile and the overnight stays unmarked even post-#279.
Needs a post-#279 generation to confirm (the ref is transient). A live-resolve
overnight is immune. Detail + the badge-prominence UX flag in
`docs/decisions/2026-08-24-overnight-spine-tile-link.md` (Follow-up section).

## 2026-08-24 (impl) — overnight linked to its spine tile (notes-to-spine, overnight slice)

Newest truth. Branch `overnight-spine-tile` off `origin/main`. Implements the
overnight slice from `docs/decisions/notes-to-spine-gap.md` (PR #278, merged as
`a744057`); decision doc `docs/decisions/2026-08-24-overnight-spine-tile-link.md`.
Web only; no schema, no migration, no DB access. Gates: `typecheck` + `next
build` both exit 0; 140 itinerary tests pass (2 new suites).

**What:** the overnight was already grounded but never marked on the spine and
was emitted three times (unlabeled tile + "Camping" block + "Overnight —" prose
line). Now: `audit.ts` records `DayAudit.overnightRef` (canonical tile id, by
IDENTITY — a corpus id on a pool-hit, `google:<placeId>` on a live-resolve —
via `overnightTileRef`); `bake.ts:markOvernightTile` flags that one tile
`isOvernight` + `curated` (featured, badged) with a no-op fallback when the ref
is null or matches no tile; the "Camping" briefing block derives from the tile;
and `to-trip.ts` drops the redundant "Overnight —" notes line when the overnight
is on the spine. `MAX_BACKFILLS_PER_DAY` and the #276 backfill are untouched —
this links an already-resolved place, it does not resolve or pick.

**Note — production had NO overnight→tile match before this;** the "substring
match" #278 mentioned was only in that investigation's throwaway script. This is
the first real match, and it is by id.

**Existing trips unaffected** (bake/notes run only at generation; on render, no
`isOvernight` tile ⇒ old behavior). **Not verified via a live generation**
(needs authed wizard + LLM); covered by unit tests + the type/build gate.
Flagged UX calls (keep the Camping block? exact badge? overnight-is-end-town) in
the decision doc — not decided.

⚠ **Doc-drift note (unchanged, flagged not fixed):** this file's top masthead is
dated 2026-08-23 (branch `main`/`sucre`, resolver cutover) and predates the
#274–#276 merges — same stale masthead PR #278 flagged. Left as-is.

## 2026-08-24 (investigation) — notes-to-spine gap: scoped, not implemented

Branch `dubai`. **Investigation only — no code changed** (PR #278, merged as
`a744057`); deliverable `docs/decisions/notes-to-spine-gap.md`. TEST reads only
(24 generated trips in `public.trips`); no PROD access.

**Question:** places named in a generated day's Overnight / Logistics / Fuel /
Reserve notes render only as prose — should they also be spine nodes?

**Finding — it is two problems, not one.** Traced the path `[read source]`:
note strings are LLM-authored structured output (`schema.ts`), composed into
`day.notes: string[]` by `to-trip.ts:dayNotes`, and rendered as pure prose by
`DayBriefingCard` (no tokenization). Only the **overnight** is grounded
(`audit.ts` `groundReference`); `logistics`/`obligations`/`fuelGaps` are passed
through untouched. So:
- **Overnight** is already grounded and already on the spine (node or tile) on
  **96 of 104** overnight-bearing days `[measured 2026-08-24, TEST; lenient
  substring match — an upper-ish bound, not exact]`; 4 days are desc-only. Its
  gap is **labeling**, not resolution.
- **Logistics/Fuel/Reserve** are genuinely prose-only, but most places they
  name are *also* already spine nodes/tiles — naive extraction would mostly
  duplicate.

**Recommended:** cheap overnight-labeling slice first (the 08-24 impl above);
service-stop spining is a separate product-gated decision, preferring structured
emission at generation time over lossy prose parsing. Cap/gating vs. #275/#276
and several visual-distinction/duplication calls are flagged as **open product
questions**, not decided.

## 2026-08-25 (later) — corridor-city backfill: #275 extended past the start anchor

Newest truth. Branch `corridor-city-backfill`. ~~**stacked on
`keystop-anchor-backfill` (#275) because #275 is still OPEN, not merged** —
`origin/main` is at `a61c381` (#274). This PR therefore carries #275's commit
as well.~~ **CORRECTED 2026-08-25 — #275 has since MERGED** as **`683890c`**,
now the `origin/main` tip, and this branch was **rebased onto it**. Git skipped
the branch's own copy of #275's commit as already-applied (the squash means its
SHA is not an ancestor of `main` while the trees are identical — the usual
pattern here), so the PR is now a **single commit** carrying only the
corridor-city work. TEST only.

**What:** `pickBackfillStops` — a thin ordered loop over the existing
`pickAnchorStop`, so every gate, the ranking and the null-rather-than-pad
contract are inherited unchanged. Anchors per day = start, then each
mid-corridor city in along-route order. No parallel mechanism.

**Cap — a stated call, `MAX_BACKFILLS_PER_DAY = 2`** across start + corridor
together. Covering every bare city would let machine picks outnumber the
model's 2–4 real ones and turn "key stops" into a list of towns. Two, not one,
because the start anchor routinely takes a slot. When the cap bites it keeps
the **earliest** anchors.

**Notes distinguish the kinds** — `"at the start of the day"` vs `"along the
way through"`. This matters because `KeyStop.note` is the only part of the
decision that survives generation.

**Three defects found live and fixed here:** a town featured as the thing to
see in that town ("Carson City, Nevada" under the Carson City node — cleared
the category gate honestly as `park_feature`, so `isCityTautology` was added,
exact-after-state-stripping so "Riverside Park" survives); the same place
featured on two days (dedupe was per-day, now trip-wide); and a city attributed
to a dwell day it never passes through (mid-corridor selection reused
`onCorridor`, which degrades to a wide straight-line radius on dwell days — now
uses the day's polyline).

**Measured, San Diego → Reno:** before, Oceanside and Riverside both `(EMPTY)`.
After, Oceanside → **Top Gun House** `[BF:corridor]` in every run; Riverside →
**Trujillo Adobe** `[BF:corridor]`. **Silver Lakes and Carson City correctly
stayed bare** rather than being padded.

**Limit worth knowing:** richness is a preference, so a thin row still wins when
it is the only candidate — Top Gun House carries no photo/description and its
card renders blank. A corpus ceiling, not a logic error.

24 unit tests pass; typecheck + build exit 0. Instrumentation added and fully
reverted.

## 2026-08-25 — start-of-day key-stop backfill: a MECHANISM, after #274's nudge fell short

Newest truth. Branch `keystop-anchor-backfill` off `origin/main` (`a61c381`,
#274). TEST only; no PROD access. **Gates: typecheck + build exit 0; 17 unit
tests pass** (`anchor-backfill.test.ts` + the existing `ground-keystop.test.ts`).

**Why:** #274 made spread a prompt *preference* and measured that start-of-day
stayed frequently empty. This adds the mechanism. Prior findings that shaped
it: nothing was being dropped, and which cities get a stop varies run to run.

**What:** `web/src/lib/itinerary/anchor-backfill.ts` (pure, unit-tested) called
from `audit.ts` after the key-stop loop. If nothing the model kept sits near a
day's START anchor, pick one opener from `facts.poolPOIs` — the palette the
model already had. **Deterministic; no LLM re-ask, no network call.** Options
weighed and rejected (re-ask loop = latency + spend + padding risk; live Google
searchNearby = crosses the deliberate resolve.ts / discovery separation) are in
the decision doc.

**The bar is all hard gates, never a score:** opener category only (`scenic`,
`food`, `oddity`, `attraction`, `camping` — excludes the `interest` junk
drawer, `urban`, `fuel`, `overnight`); within `ANCHOR_NEAR_MI` (a **chosen
constant**, far tighter than the audit's `GUARD_MI`); must clear the caller's
own `onCorridor` guard unchanged; must not duplicate a kept stop (by corpus id
AND by name). **Returns null and leaves the day bare when nothing qualifies** —
the explicit requirement. Note is strictly positional and asserts nothing about
the place; a test enforces that.

**Flag `KEYSTOP_ANCHOR_BACKFILL=false` kills it — ON by default**, inverting the
repo's usual default-OFF posture deliberately: that posture guards live prod
paths, and generation is already gated behind `ENABLE_PLANNER_WIZARD` which
prod never sets. Shipping OFF would ship a fix that does nothing.

**Measured across five live generations, start city varied (Bishop, San Diego,
Reno):**
- **Fires when it should, quiet when it shouldn't.** The Bishop run — the
  originally reported failure — logged **zero** backfills because the model
  covered Bishop itself that run. Correct non-firing, not a miss.
- ⚠ **A real defect surfaced live and was fixed mid-flight.** The first runs
  picked `atlas_oddities` rows three times out of four ("Mick Jagger's Urinal",
  "Space Whale", "Kesey Square") — NULL photo, NULL description, NULL rating,
  i.e. rows that render as an empty placeholder. Ranking on proximity alone
  systematically surfaces the THINNEST rows, and rating cannot counter it
  (`master_place.rating` is NULL corpus-wide `[measured 2026-08-21]`). Fix:
  `PoolPOI` gained `hasPhoto`/`hasDescription` (derived in `toPoolPOI`, **not**
  sent to the model) and `rank` prefers a renderable row — a **preference, not a
  gate**, or it would empty the very starts this exists to cover. After it,
  every materialized backfill carried both photo and description.

**Known limits, stated not smoothed:** materialization under the start node is
**not guaranteed** — one backfilled pick did not appear under its day's first
node; it may have bucketed under a neighbouring node, **not verified either
way**. Same pre-existing class as the 2026-08-24 Victorville pool-hit
observation, **not introduced here**; now tracked in BACKLOG. Also: the backfill
runs for every day's START anchor but **not** day-END (measured evidence showed
ends already covered, and the end node hosts the overnight) — a flagged
deviation from the "ideally end-of-day too" brief.

Decision doc: `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md`.
`generation-pipeline.md` gains a Tier-2b section.

⚠ **Still uncommitted and NOT in this PR:** the dev-only email+password sign-in
(`web/src/lib/auth/dev-signin.ts` + the two `app/auth` files). Unchanged status
from 2026-08-24.

## 2026-08-24 — key-stop corridor spread: prompt-only change, measured partially effective

Newest truth. Branch `prompt-keystop-spread` off `origin/main` (`dce1a72`).
**One product file changed — `web/src/lib/itinerary/master-prompt.ts` — plus
docs.** No code paths, no schema, no migrations. TEST only; no PROD access.

**The obvious hypothesis was wrong, and that is the main finding.** Clustered
key stops were assumed to come from the model not seeing the corridor cities.
**`corridorCities` has always been in the prompt** — `buildFactsMessage` sends
`{id, name, kind, milesFromStart}`, derived by `deriveCorridorCities` inside
`preComputeFacts` (`facts.ts:180-186`) `[read source]`. The model had the spine
and was simply never asked to use it for placement. No plumbing was needed.

**The change:** `SYSTEM_PROMPT`'s `keyStops[]` contract gains a SPREAD
paragraph (the day's stops should read as a progression across the cities
inside it; start-of-day called out as the easy-to-leave-empty part), and
`buildFactsMessage` repeats it beside the city list. **Explicitly not a quota**
— both say skipping a city is fine and coverage is a tie-breaker, never
padding. Nothing downstream enforces it.

**Measured, same route + dates (San Diego → South Lake Tahoe, 08-25→08-28),
three runs after vs two comparable before, read from persisted payloads:**
- **Improved:** all three post-change runs placed a curated stop at
  **Riverside** and at the day's end city. Neither before-run had both.
- **NOT improved:** **San Diego and Oceanside were empty in every post-change
  run** — the exact start-of-day gap the new text names. One *pre*-change run
  did cover San Diego, so on that city this is not an improvement.
- **Confound, stated not smoothed over:** day-1 shape shifted (all post-change
  runs planned San Diego → Bishop; before-runs ended day 1 at Alabama Hills /
  Fossil Falls). A longer day 1 plausibly suppresses early stops by itself.
  **Not a clean A/B; small sample — three runs after, two before, one route.**
- Run-to-run consistency rose sharply post-change (same Riverside stop and same
  end stop all three times). Whether that is the instruction working or reduced
  diversity is **not established** by this sample.

Full before/after + the confound: `docs/decisions/2026-08-24-keystop-corridor-spread.md`.
`docs/architecture/generation-pipeline.md` updated with the corridorCities fact
and the distribution preference.

**Unchanged and still open:** `day.audit` / `day.keyStops` are not persisted, so
key-stop behaviour stays unmeasurable after the fact without temporary
instrumentation (added and fully reverted twice this session). Guaranteeing
start-of-day coverage would need a different mechanism (post-generation
placement, or a re-ask loop) with its own padding risk — deliberately not
attempted.

⚠ **Uncommitted and NOT in this PR:** a dev-only email+password sign-in
(`web/src/lib/auth/dev-signin.ts`, `app/auth/actions.ts`,
`app/auth/sign-in/page.tsx`), built earlier today on branch
`dev-password-signin`. Reason it exists: **Google is not an enabled provider on
TEST** — `/auth/v1/settings` returns email-only `[measured 2026-08-24]` — so the
only sign-in button in the UI cannot complete there. Gated on dev build AND an
explicit flag AND the TEST project. Sitting in the working tree, no PR opened.

## 2026-08-23 — four-surface resolver cutover complete (all flag-gated OFF)

Newest truth. Branch work all merged to `main` (`origin/main` tip `b227e65`).
Every cutover was **plan-doc-first, then implement**, and each implementation is
a **thin route wrapper behind an env flag, default OFF** — the route stays
byte-for-byte itself when the flag is off, and the client is never touched.

**The four surfaces, as they actually resolved:**

- **Search** — `GET /api/search-area` → `resolvePlaces()` bbox scope, behind
  `SEARCH_AREA_USE_RESOLVER` (#260 `d62f660`). Plan #258 `1b7104b`. **A real
  blocker was found and fixed first (#259 `9c212a6`):** the Verified/Unverified
  tier was non-functional on the bbox/hydrate path because `hydratePlacesByIds`
  never selected `description_source` — `mapMasterPlaceRow` therefore stamped
  every search-hydrated place `unverified`. Fixed by threading `description_source`
  through hydrate and single-sourcing classification in `mapMasterPlaceRow`.
- **Date Detail** — `POST /api/places/details` → behind `DATE_DETAIL_USE_RESOLVER`
  (#266 `a086cb8`). Plan #261 `ab9b1dd`. **Its blocker was DIFFERENT from the
  tier bug:** `resolvePlaces()` returns `BrowsePlace[]` and, in `ids` scope,
  returns nothing for bare Google `place_id`s (they parse `opaque`) — it had no
  mode that produces the `place_id → PlaceRich` map this endpoint is. So a NEW
  capability was built: `enrichByGoogleId()` (#263 `bc2c9c2`, plan #262 `8486e89`),
  the standalone map-returning version of `enrichPlaces()`'s inner loop. The route
  ON-branch delegates cache-misses to it and keeps its own 15-min cache
  (cache-less by design — this is option 1, not ADR step 4).
- **Day Column** — **NO cutover** (#267 `4757067`). Verified against code: it is a
  passive renderer of baked `Trip.days` (`placePool`), with zero live calls of its
  own (the only fetches in that component are Date Detail's). No endpoint to wrap.
  For it to ever reflect `resolvePlaces()` output, the **write path** that bakes
  `segmentSuggestions` (`bake-corridors.ts` corpus fold, behind `USE_FEDERATED_CORRIDOR`)
  would source via `resolvePlaces()` — a generation-pipeline change with
  staleness/re-bake semantics, deferred (BACKLOG).
- **Day-scoped browse** — `GET /api/trip-browse/:tripId/:dayId` →
  `resolvePlaces()` day-corridor scope, behind `TRIP_BROWSE_USE_RESOLVER`
  (#269 `b227e65`, plan #268 `8a8cfe3`). The cleanest of the four: the day-corridor
  scope was designed to mirror this endpoint (byte-identical radii/sources/buffer).
  The one subtlety: it already had `USE_FEDERATED_POIS` — the two flags are
  **orthogonal** and both stay; the wrapper wires `include: { federated:
  USE_FEDERATED_POIS }`. The one new behaviour (Verified-before-Unverified sort)
  only reorders when `USE_FEDERATED_POIS` is on, and is never displayed.

**Flags now in the tree, ALL default OFF (nothing live in prod from this arc):**
`SEARCH_AREA_USE_RESOLVER`, `DATE_DETAIL_USE_RESOLVER`, `TRIP_BROWSE_USE_RESOLVER`
(+ the pre-existing `USE_FEDERATED_POIS`, still OFF).

**Verification posture (per cutover):** unit tests for every flag state (the
handler modules have a dependency seam), plus a live TEST end-to-end check
against the wired path with a non-vacuous contrast. Web tests still do NOT run
in CI (pre-existing gap) — the live scripts + review are the real gate.

**Two things now teed up (BACKLOG):**
1. **ADR step 4 — shared client cache: READY TO BUILD.** Three read surfaces are
   cut over, each keeping its own per-route cache; the shared React-Query cache
   keyed by canonical id is the consolidation that removes that redundancy. Not a
   pre-written "second surface" trigger — the readiness is that the surfaces now
   exist.
2. **Day Column write-path/baking consolidation** — deferred, newly tracked.

## 2026-08-22 (later) — `resolvePlaces()` built, ADR step 2 — ADDITIVE, nothing cut over

Newest truth. Branch `feat/resolve-places-service`, **rebased onto
`origin/main` at `d185d0d`** (originally forked at `4f2a6af`; `d185d0d` is
#248, the doc-currency pass for #247), **committed locally, not pushed, no
PR**. Implements step 2 of
`docs/decisions/2026-08-21-place-data-resolver-consolidation.md`.
**No DB/network/API calls this session at all** — not TEST, not PROD, not the
management API. Static source reading plus local tests.

### What exists now

- `docs/architecture/resolve-places-design.md` — the design, including a
  **nine-item list of divergences between the three endpoints that are NOT
  reconcilable by picking one** (§2, D1–D9). Read that before any cutover.
- `web/src/lib/places/place-id.ts` — canonical id normalization.
- `web/src/lib/places/resolve-places.ts` — the service. One signature over
  three scopes (`ids` | `bbox` | `day-corridor`), LIVE + FEDERATED concurrently,
  merge on canonical id, returns `BrowsePlace[]` **unchanged**.
- 47 tests (27 id + 20 resolver), all passing.

### The additive constraint — verified, not asserted

`/api/search-area`, `/api/trip-browse/:tripId/:dayId` and
`POST /api/places/details` show **zero diff**; the only changed paths this
session are the new design doc and the new `web/src/lib/places/` directory.
A repo-wide grep finds **no importer** of `resolvePlaces`/`place-id` outside
that directory. `Day.waypoints`, the client cache, and all four surface
components are untouched.

### The id problem was bigger than "add a normalization step"

The ADR describes normalizing between `master_place.id`, `mp:<uuid>` and
`google_place_id`. Re-reading the adapters found **eight** id forms in **two
schemes**: federated uses `mp:` + colon, live uses `<prefix>/` + slash
(`gpl/`, `fsq/`, `ridb/`, `usfs/`, `blm/`, `node/`). And **the live prefix is
not the `SourceId`** — `gpl`≠`google`, `fsq`≠`foursquare`, `ridb`≠`rec-gov`,
`node`≠`osm` — so the map is hand-written; deriving it would be wrong for four
of six sources.

**A real parser bug was found by an accidental typo in a test fixture.**
Checking `:` before `/` (the obvious implementation) misreads any live id whose
external id contains a colon — `fsq/abc:def` parses as prefix `fsq/abc`, fails
the `mp` test, and returns `opaque`: silently unresolvable, no error. Fixed to
decide the scheme by whichever separator comes **first**, and pinned by a
regression test.

### OPEN — not decided, do not treat as settled

1. **D1–D9 in the design doc are all unresolved by construction.** The two
   endpoints speak **different category vocabularies** whose maps are not
   inverses (D1); there are **three different doors into `master_place` with
   different membership rules** — the corridor RPC excludes template-only and
   `needs_review` rows, the search-hydrate path does not (D2); and
   **`POST /api/places/details` does not return places at all** — it returns
   enrichment fragments keyed by Google place_id, so folding it in is not a
   like-for-like substitution (D3). Each changes what a user sees.
2. **Web tests do not run in CI.** The `test` job runs `npm run -w data test`
   only and `web/package.json` has no `test` script. The 47 tests here run via
   `npx tsx --test` and are **not enforced on merge**. Pre-existing gap, not
   introduced here.
3. **No live end-to-end run.** Verified through a dependency seam with fakes;
   never executed against TEST Supabase, Typesense, or Google, because nothing
   imports it and standing it up would require the forbidden cutover.
4. **Step 1's new `master_place` columns are still unread.** Neither
   `hydratePlacesByIds` nor `pois_along_corridor` selects `rating` /
   `review_count` / `price_tier` / `photo_url`; widening either is a change to
   shared code other callers use.

## 2026-08-21 (later) — master_place enrichment columns (place-data resolver ADR, step 1) — **MERGED as `4f2a6af` (#247)**

> **⚠ CORRECTED 2026-08-22 — MERGED.** Everything this section describes
> squash-merged to `main` as **`4f2a6af` (#247)**, now the `origin/main` tip.
> The "committed locally, not pushed, no PR" framing below is STALE and struck
> through where it appears. **What did NOT change on merge: both migrations
> are still applied to TEST only** — `20260821060000` and `20260821070000` are
> in TEST's ledger and PROD has neither — **and every OPEN item below except
> the push/PR one is still open.** Merging a PR is not a PROD apply.

Newest truth. Branch `master-place-enrichment-columns` — pre-existing
(Conductor created it from `c370115` and renamed `andorra` onto it; **this
work did not create or fork it**, it verified HEAD sat at `origin/main`'s tip
first), ~~**committed locally, not pushed, no PR**~~ **MERGED as `4f2a6af`
(#247)**. Implements step 1 of
`docs/decisions/2026-08-21-place-data-resolver-consolidation.md`.
**TEST (`znldzjdatkogdktymtvi`) only — no PROD *database* reads or writes**
(one `supabase projects list` management-API call read PROD project metadata;
no table was touched). Every figure here was computed this session against
TEST; full methodology — including the four corrections a self-audit pass
applied to it — in
`docs/measurements/2026-08-21-master-place-enrichment-columns.md`.

### What shipped

Two migrations, both applied to TEST via `db:push-verify -- --test`:

- `20260821060000_master_place_enrichment_columns.sql` — **four** nullable
  columns on `master_place`: `rating numeric(2,1)`, `review_count integer`,
  `price_tier smallint` (1–4, matching the web `priceTier?: 1|2|3|4`
  convention — not a text enum), `photo_url text`, each with a null-permissive
  range check and a column comment.
- `20260821070000_backfill_master_place_photo_url.sql` —
  `backfill_master_place_photo_url(uuid[])`, set-based, same posture as
  `backfill_state_for_ids()`.

Plus four scripts (`data/scripts/`): the full-scan payload census, the scope
measurement, the backfill (`npm run -w data backfill:mp-enrichment`, with
`--dry-run` / `--report`), and the column-vs-export-view cross-check.

**The ADR names FIVE fields; four columns were added.** `description` already
exists on `master_place` (Phase 1 migration) and is owned by
`recompute_master_place()` — deliberately not re-added, not altered, not
written.

### Per-source finding — measured, not assumed

Full scan of **every** `source_record` row for all ten `source_id` values
(170,428 rows), walking `raw_payload` **and** `normalized_payload`:

| source | rating | reviewCount | priceTier | description | photoUrl |
|---|---|---|---|---|---|
| OSM | ✗ | ✗ | ✗ | ✓ 2,749 | ✗ |
| NPS | ✗ | ✗ | ✗ | ✓ 5,281 | ✓ 4,876 |
| RIDB | ✗ | ✗ | ✗ | ✓ 5,795 | ✓ 2,667 |
| state parks | ✗ | ✗ | ✗ | ✓ 97 — **WA only** | ⚠ 138 **unmapped** — **WA only** |
| Atlas Obscura | ✗ | ✗ | ✗ | ✗ 0 | ✗ |
| BLM | ✗ | ✗ | ✗ | ✓ 169 | ⚠ 102 **unmapped** |
| USFS | ✗ | ✗ | ✗ | ✓ 6,323 | ✗ |

**⚠ Two photo fields sit in `raw_payload` that their ingesters never map** —
BLM `props.PHOTO_LINK` and state_parks `props.Imagelink`. Same class as the
BLM `WEB_LINK` miss of 2026-08-20. The backfill reads them from `raw_payload`
so the 221 photos aren't dropped; the normalizer fix is a follow-up.

⚠ **SCOPE — the state_parks findings are WASHINGTON ONLY (corrected
2026-08-21).** `state_parks` covers six states (CA/AZ/NV/UT/WA/OR, 1,736
rows), but both fields credited to it are on its WA layer alone, measured
across all 1,736 active rows: `props.Imagelink` **138/138 WA**,
`props.Description` **97/97 WA**. An earlier version of this table reported
them as "state parks" with no state scope, which reads as six-state coverage.
It is not. **No BLM state breakdown was determined** — this section makes no
claim in either direction about how BLM's 102 photo / 169 description rows
distribute.

**rating / review_count / price_tier are 0 corpus-wide.** No ingested source
carries any of them. Four near-misses examined and rejected by name (OSM
`stars` 8 rows = hotel classification; OSM/USFS fee booleans; NPS
`fees[].cost` = dollar amounts; RIDB fee *descriptions*). The columns were
still added — that is the ADR's point.

**⚠ Do not populate those three from Google.** `rating`/`userRatingCount` are
explicitly non-cacheable under Google's Places policy
(`docs/measurements/2026-08-20-google-places-details-compliance-check.md`).
Recorded in the migration header.

### photo_url backfill — 7,360 rows

nps 4,690 · ridb 2,449 · blm 88 · state_parks 133 (**all 133 Washington** —
see the scope note above). Verified: re-run reports **0 changed**
(idempotent); 0 empty strings; rating/review_count/price_tier still 0/0/0
(script-asserted). Against the export view's existing photo lateral: 6,430
identical, 907 column-only, and the **23 that differ were explained, not
assumed** — 23/23 link more than one photo-carrying nps/ridb source_record,
where the view's lateral has no intra-source tie-breaker and the column does.

⚠ **"0 view-only" is MEASURED, NOT GUARANTEED — corrected 2026-08-21.** An
earlier version of this section called the column "a strict superset, as
designed." It is not. The export view's photo lateral
(`20260821040000:63-67`) does **not** filter `is_active`; the RPC does. So the
view can serve a photo from a deactivated source_record that the column
excludes. The reason 0 view-only held is simply that TEST currently has **0
inactive nps** and **0 inactive ridb** rows carrying a photo url `[queried
TEST 2026-08-21]`. **The first deactivation of a photo-carrying NPS/RIDB
source_record breaks it** — and deactivation passes are routine here. Whoever
repoints the view at the column must decide the `is_active` question first.

⚠ **The 907 column-only rows split 693 / 214 — corrected 2026-08-21.** An
earlier version said they were all excluded by the view's filters. Measured:
**693** are absent from the view (its `is_searchable` / `source_count > 0` /
`six_state_footprint()` filters), and **214** are *present in the view with a
NULL `photo_url`* — their photo comes from blm/state_parks, which the view's
nps/ridb-only lateral does not read. Repointing the view at the column would
fill those 214 in, not just deduplicate logic.

### description — the gap is `field_precedence`, not a missing column

`master_place.description` non-null: **16,490** of 160,703.
`resolve_field()` INNER JOINs `field_precedence`, so a source with no
`description` precedence row can never contribute one. **`blm` and
`atlas_oddities` have NO `field_precedence` rows for ANY field** — they
contribute zero resolved fields to `master_place`. Measured consequence:
**138** BLM-linked and **95** state_parks-linked master_places carry a real
source description while `master_place.description` is NULL (138/138 and
95/95). **Not fixed** — seeding precedence is a product decision, and the
state-parks spec §10a excluded `description` deliberately.

### LLM description pilot — overlap reported, nothing run

⚠ **Corrects §2026-08-21 below.** That section says "10,292 generated_content
rows, all `generation_method='template'`, 0 `llm`". `[queried TEST
2026-08-21]` the table now holds **17,725** rows: 10,292 `template` **and
7,433 `llm`** (`claude-sonnet-4-5`, prompt `2026-08-20b-antifab`, generated
19:23–19:37 UTC the same day — almost certainly a parallel Conductor
workspace). Model/prompt uniformity is from a **1,000-row sample**, not the
population. **Untouched by this branch.**

**Verdict: the `description` column backfill should NOT draw from that output,
and doesn't need to.** `master_place_generated_content`'s own migration header
records that a `master_place` column was **considered and rejected** for
generated content; and `description_source` derives `'source'` from
`master_place.description IS NOT NULL`, so LLM text there would be mislabeled
on both the export view and Typesense. The read path (real description →
generated fallback, with `description_source` live in Postgres and Typesense)
already exists. Separate follow-up, largely already-built infrastructure.

**Framing correction:** the pilot targets **STRONG/WEAK-bucket rows with no
real description** (8,782 → **7,154** after excluding `atlas_oddities`), *not*
the NONE bucket — the NONE bucket was the template pass.

### OPEN — not decided, do not treat as settled

1. **`photo_url` is a SNAPSHOT, not `recompute_master_place()`-owned** — it
   will go stale on the next deactivation/materialize. Same class as
   `master_place.state`. Wiring it in needs `field_precedence` seeding (Adam's
   call) *and* a dedicated resolver step, because `resolve_field()` reads
   `normalized_payload->><field>` while the photo lives at
   `normalized_payload.photo.url`. Interim mitigation: the backfill is
   idempotent and self-clearing — re-run it after a materialize.
2. **BLM `PHOTO_LINK` / state_parks `Imagelink` unmapped in their
   normalizers** — fixing that (plus re-normalization, like
   `backfill-blm-website.ts`) would also feed the export view's lateral, so
   search would gain those 221 photos.
3. **`master_place_search_export.photo_url` still comes from the lateral**, so
   it and the column differ on 221 blm/state_parks rows plus the 23
   arbitrary-pick rows. Repointing the view is ADR step 2, not step 1.
   **Decide the `is_active` divergence as part of it** — the lateral does not
   filter it, the column does (see the ⚠ note above).
4. **`blm` and `atlas_oddities` have no `field_precedence` rows at all.**
5. **state_parks / blm `description` precedence rows** — a product decision.
6. **No PROD apply.** ~~no push, no PR~~ **— RESOLVED 2026-08-22: pushed and
   merged as `4f2a6af` (#247). The PROD half is NOT resolved and is not
   affected by the merge.** Both migrations are still TEST-only. **If
   `20260821060000` is ever adapted for PROD: its three CHECK constraints take
   an ACCESS EXCLUSIVE lock and full-scan to validate. Cheap at TEST's current
   size; PROD's `master_place` row count has NOT been measured and no claim is
   made about it. Use `NOT VALID` + a later `VALIDATE CONSTRAINT` there.**
8. **The `rating` (0–5) and `price_tier` (1–4) CHECK ranges are Google's
   scales.** Foursquare — a live source per the ADR — rates 0–10. Nothing in
   the codebase produces a Foursquare rating today, so no live conflict; it is
   a deferred decision for whoever first populates these from Foursquare.
7. Adjacent, unchanged: **`master_place.state` is still a snapshot** not wired
   into `recompute_master_place` (item 2 of the section below). The ADR
   suggested checking whether it relates to the new columns — it does, but
   only in kind: `photo_url` now shares the same staleness class. No causal
   link found.

## 2026-08-21 — state-boundary rebuild (real TIGER/Line, all six states), NONE-bucket template pipeline, eligibility + provenance + review mechanism, Typesense sync fix

Newest truth. Long investigation-and-build session, done directly on local
`main` (see the masthead — not yet on a branch). **No PROD writes.** Every
figure below was computed this session against TEST
(`znldzjdatkogdktymtvi`) — see `docs/measurements/2026-08-21-*.md` for full
methodology on each.

### Branch / commit state — read this before touching anything here

> **⚠ CORRECTED 2026-08-21 — MERGED; do not act on the "uncommitted" framing
> below.** Everything this subsection lists (the tracked-file code changes, the
> six migrations, the scripts) squash-merged to `main` as **`d6c55ac` (#244)**.
> The place-data resolver ADR that followed merged as **`4fbd051` (#245)**, now
> the `origin/main` tip. The struck text below is preserved per this file's
> convention; the "Uncommitted, tracked-file changes" and "Uncommitted,
> untracked new files" inventories that follow it now describe MERGED content.

~~**Currently on local `main`, not a feature branch.** This session's code
(`data/scripts/lib/eligibility.ts` + `.test.ts`, `data/search/sync-typesense.ts`)
and every new migration/script are **uncommitted** as of this docs pass —
this docs-only commit is deliberately separate from them, matching this
session's own instruction. Before any of it can reach `origin/main` it
needs to move to a branch per CLAUDE.md's standing rule. Nothing has been
pushed.~~ **`docs/BACKLOG.md` was already updated and committed earlier in
this session** (`f3c4830`) — this pass added the remaining docs on top,
not a duplicate BACKLOG pass.

**Uncommitted, tracked-file changes:** `data/scripts/lib/eligibility.ts` +
`.test.ts` (new `has_template_description` signal), `data/search/sync-typesense.ts`
(`description_source` field + a schema-reconciliation fix, see below).

**Uncommitted, untracked new files:** six new migrations
(`20260821000000`–`20260821050000` — `master_place_generated_content` table,
`state_boundaries` + `resolve_state()`, `backfill_state_for_ids()`, the
`needs_review` columns, `description_source` on the export view, the
`pois_along_corridor` exclusion filter), ~10 new `data/scripts/*.ts` (state
boundary load/backfill, template generation/regeneration, placeholder
deactivation, measurement scripts), and the `docs/measurements/2026-08-21-*.md`
reports this section summarizes.

### 1. State assignment rebuilt on real geometry, all six states

A manual spot-check caught the Astoria Column (WA/OR border) labeled
Oregon when it reads as Washington. The mechanism behind every state
label in the corpus was a bbox classifier whose own source
(`six_state_footprint()`) explicitly documents interior-border overlap as
deliberately loose for scope membership, never designed to assert one
specific state as fact. **Scope grew from a Nevada-only patch to a
six-state rebuild once the corpus-wide numbers came in** — see
`docs/decisions/2026-08-21-template-eligibility-provenance-review-decisions.md`
§1 for why the narrower fix was abandoned mid-build.

**New mechanism:** `state_boundaries` (PostGIS table, real US Census
TIGER/Line 2023 geometry, public domain) + `resolve_state()` (real
`ST_Contains` point-in-polygon) + a backfilled `master_place.state`
column (snapshot, not live-recomputed — deliberately not wired into
`recompute_master_place`, a separate open question).

**Corpus-wide backfill: 2,964 of 32,734 in-scope rows corrected (9.05%)**
— NV→CA alone was 73.96% of the changes (confirms the root-cause finding
at full precision), plus two smaller patterns only visible at six-state
scope: AZ mildly overreaching into NV/CA, and a near-even OR↔WA
reclassification along the Columbia River border. **Fresh, corpus-wide
`master_place.state` distribution `[queried TEST 2026-08-21]`:** null
**128,210** (out-of-scope/land_status/unresolved rows) · CA **13,380** ·
OR **5,317** · WA **4,828** · UT **3,953** · AZ **3,863** · NV **1,152**.
Full report: `docs/measurements/2026-08-21-state-boundary-fix-all-six-states.md`.

### 2. NONE-bucket template descriptions — generated, then corrected twice as the state fix landed underneath them

**10,292** NONE-bucket rows got zero-fabrication template descriptions
(`"{name} is a {category} in {parent}, {state}."`, built only from
fields already in the corpus — `master_place_generated_content`, new
table this session). Because the state-boundary fix (§1) landed in the
same session, a slice of already-generated template text went stale or
incomplete partway through and needed two follow-up regeneration passes,
both UPDATE-in-place on the same rows (no duplicates):

- **158 rows** whose stored text named the OLD, now-wrong state —
  confirmed via literal text inspection, not assumed from the transition
  matrix. `docs/measurements/2026-08-21-stale-template-regeneration-fix.md`.
- **1,211 rows** that had never named any state (the old classifier called
  them ambiguous/outside) and could now gain a correct one — an addition,
  not a stale-fact correction, kept as a distinct pass.
  `docs/measurements/2026-08-21-three-part-cleanup.md` Part 1.

**Fresh count `[queried TEST 2026-08-21]`: 10,292 generated_content rows,
all `generation_method='template'`, 0 `llm`.**

### 3. Eligibility change — template descriptions count as STRONG

Decision (see the decisions/ doc §2 for the full reasoning): a template
description counts as "resolved" for eligibility purposes, same tier as
a real description, but explicitly conditioned on staying
distinguishable downstream (§4) and excluded from trip generation by
default (§5) — counting toward eligibility is not the same claim as
"good enough to hand a trip-planner."

`has_template_description` added to `lib/eligibility.ts`'s
`AggregatedSignals`, folded into `isStrong()`. **Fresh corpus-wide
before/after, in-scope population `[queried TEST 2026-08-21]`:**

| | STRONG | WEAK | NONE | total |
|---|--:|--:|--:|--:|
| Before (signal forced off) | 22,107 | 100 | 10,527 | 32,734 |
| After (current) | **32,399** | **100** | **235** | 32,734 |

WEAK is identical either way — confirms no WEAK-bucket row carried
template content. 37 unit tests pass (34 existing + 3 new).

### 4. Provenance — `description_source`, live in Postgres AND Typesense

`description_source` (`'source'`/`'template'`/`'llm'`/`null`) added to
`master_place_search_export` via a `LEFT JOIN LATERAL`, precedence
matching `master_place_generated_content`'s own documented read path
(real description wins even when an unused template also exists).
**Fresh distribution on the view `[queried TEST 2026-08-21]`: source
**15,582** · template **8,535** · null **8,617*** (sums exactly to
32,734). Cross-check: `10,292 − 8,535 = 1,757` matches the independently
measured "dual" row count (real description + unused template) exactly.

**Investigated before wiring further, and the premise needed correcting:**
`master_place_search_export` is not what the frontend queries live —
it's the sync source for Typesense (`data/search/sync-typesense.ts` →
`places_test`), which is what `web/src/lib/search.ts` actually queries.
Added `description_source` to the Typesense schema + `transformRow`, ran
`search:sync` — **32,734/32,734 indexed, 0 failed.**

**A real gap found and fixed, not just noted:** the Typesense collection
already existed, so the schema addition alone never reached the live
index — the field was written onto every document but uninspectable via
facet/filter (404). Fixed with a schema-reconciliation step
(`reconcileSchemaFields`) that PATCHes missing fields into an existing
collection before re-import. **This incidentally caught a second,
independent, PRE-EXISTING instance of the exact same bug on `photo_url`**
(added to the Typesense schema back in migration `20260810180400`,
apparently never reconciled either — see `BACKLOG.md`'s old note on this,
now closed) — fixed in the same pass. One self-caught bug along the way:
the first reconciliation attempt tried to alter Typesense's implicit `id`
field and was cleanly rejected (HTTP 400, no partial state) before being
corrected. Live-verified: facet query on `description_source` now
returns real counts instead of 404ing; a `description_source:=template`
filter query works end-to-end. Full report:
`docs/measurements/2026-08-21-typesense-description-source.md`.

### 5. Review/re-queue mechanism — Astoria Column flagged as the first real case

Four columns directly on `master_place_generated_content`
(`needs_review`, `review_reason`, `flagged_at`, `flagged_by`) — a flat
shape chosen over a companion table because the real requirement is one
current flag per row, not a history log (decisions/ doc §4). **The
Astoria Column's template row is flagged** (`needs_review=true`,
`review_reason` describing the WA/OR border mislabel) as a real exercise
of the mechanism, not a synthetic test — confirmed excluded from
`pois_along_corridor` on that basis, confirmed still browsable via
`master_place_search_export`. **Fresh count `[queried TEST 2026-08-21]`:
1** row corpus-wide carries `needs_review=true` — exactly the one flagged
this session, nothing else.

### 6. Trip-generation exclusion

`pois_along_corridor` now excludes (a) template-only rows — precisely
where `mp.description IS NULL` and a template row exists, matching
`description_source='template'` exactly, so a "dual" row with real
content plus an unused template backup is NOT excluded — and (b) any
row with `needs_review=true`, unconditionally. Verified: 8/8 sampled
template-only rows excluded from the RPC but still in the export view;
5/5 sampled dual rows correctly NOT excluded; the Astoria Column excluded
specifically via the flag.

### 7. Cleanup

Corpus-wide placeholder-name deactivation across ALL categories (not
just picnic_area/ev_charging from #243) — **3,516 rows**, same
`is_active=false` → `recompute_master_place()` mechanism as every prior
deactivation this repo has used. A 235-row junk-code-named slice was
deliberately NOT auto-deactivated after confirmed false positives
("7-Eleven", "Good2Go") — delivered as a manual review list instead
(`docs/measurements/2026-08-21-junkcode-review-list.csv`). A leftover
one-off script from an earlier ad-hoc pull was found and deleted.

### OPEN — not decided, do not treat as settled

1. ~~**This session's code is uncommitted, on local `main`, not pushed** —
   see the branch/commit state note above. Moving it to a branch and
   opening a PR is a separate, future step.~~ **RESOLVED 2026-08-21 — merged
   as `d6c55ac` (#244).** The place-data resolver ADR (a follow-up, not part
   of this session's original corpus work) merged separately as `4fbd051`
   (#245); `origin/main` tip is `4fbd051`.
2. **`master_place.state` is a snapshot, not wired into
   `recompute_master_place`** — an open architectural question, not
   resolved this session.
3. **STRONG-bucket description-quality audit** — the same boilerplate
   pattern found in the "dual" rows (name-repeat, empty HTML) likely
   exists among STRONG-bucket rows generally, not just the 1,757
   investigated. Flagged in `BACKLOG.md`, not investigated at that
   scope.
4. **Map filter toggle UI + review worklist UI** — backend fully built
   and verified (§4, §5); no frontend work has started.
5. **state_parks `WEB_LINK` → `contact.website` mapping gap** — same
   shape as the already-shipped BLM fix, found (177/1,448 rows, 71 would
   flip NONE→STRONG) but not fixed this session.
6. **`fix/amenities-render-shape`'s real status** — unchanged from the
   2026-08-20 open item below; still needs a file-tree diff against
   `main`.

## 2026-08-20 — state_parks LIVE ON PROD (1,736 SRs, 1,584 confirmed, 156 pending triage)

**BUILD + PROD session.** Ingester code, migration, tests, TEST ingest/triage,
and PROD ingest/materialize all complete. Branch `state-park-systems-enumeration`
carries code (not yet on `main` at authoring time; merged to `main` via #242 —
this section is preserved verbatim from that branch's own STATE.md, reconciled
here during the `corpus`/`main` merge); migrations applied to both TEST and PROD.

**What was built:**
- `data/ingestion/sources/state-parks.ts` — six-state ingester with padus-style
  boundary dissolve (CA/UT/OR/WA) and campsite aggregation (AZ 1,346 sites → 14
  park-level groups, WA 6,124 sites → 73 park-level groups)
- `data/ingestion/sources/state-parks.test.ts` — 30 unit tests (was 18, expanded
  to cover AZ name resolution, NV category mapping, park_id linkage, WA active-
  only centroid)
- `supabase/migrations/20260820120000_state_parks_field_precedence.sql` — 8 seed
  rows applied to TEST
- Registration in `manual.ts` (`--state` flag), `rate-limit.ts`, `_types.ts`

**TEST corpus position `[queried TEST 2026-08-20]`:**

| State | Parks | Campgrounds | Facilities | Skipped | Total written |
|---|---|---|---|---|---|
| CA | 394 | 509 | — | 11 | 914 |
| AZ | 34 | 14 | — | 0 | 48 |
| NV | 27 | 22 | 56 | 284 | 105 |
| UT | 47 | — | — | 0 | 47 |
| WA | 207 | 73 | — | 0 | 280 |
| OR | 342 | — | — | 0 | 342 |
| **Total** | **1,051** | **618** | **56** | **295** | **1,736** |

**TEST materialize results `[queried TEST 2026-08-20]`:**
- **881** new_master_place (deterministic — no match found)
- **58** auto_linked (name_dominant — merged into existing MP)
- **797** manual_review (663 blended_residual + 64 close_nameless + 70
  name_dominant_low_conf)
- **0** errors

**Manual-review queue (797 records) — dominant pattern `[queried TEST]`:**
blended_residual (663/797 = 83%) is overwhelmingly state_parks park-boundary
records matching PAD-US land-status polygons (608/663 = 92% of blended_residual
candidates are PAD-US). The match is typically: same name, distance ≤50m (96%
within 50m), name_sim ≥0.9, but **cat_compat=0.0** (recreation_area vs
land_status) — which is why they don't auto-link. These are real same-place
matches that the category mismatch correctly blocks from auto-confirm.

**Fixes applied during build (from self-audit):**
1. AZ campground names resolved via nearest-point matching against
   State_Park_Points (no shared join key exists between the two AZ layers;
   all 14 matches verified unambiguous with minimum 1.17km margin)
2. NV facility category mapping fixed (was: all → park_feature; now:
   Campground → campground, Trailhead → trailhead, rest → park_feature)
3. park_id linkage added to AZ and WA aggregated campground rows
4. WA/NV parks routed through dissolve path (polygon geometry, not points)
5. NV facilities stableKey changed from guid (whitespace on all 362
   state-park records) to objectid (accepted risk, same class as NV parks
   name-key)

**Category-compatibility fix applied (ADR `2026-08-20-recreation-area-land-status-compatibility.md`):**
Added `recreation_area ↔ public_land = 0.7` and `recreation_area ↔ land_status
= 0.5` to `CATEGORY_COMPATIBILITY` in matcher.ts. On TEST, this auto-confirmed
484 of the 608 PAD-US same-place matches. Applied to PROD via the materialize
run.

**PROD corpus position `[queried PROD 2026-08-20]`:**

| metric | value |
|---|--:|
| `source_record` (state_parks, active) | **1,736** |
| — by state | CA 914 · AZ 48 · NV 105 · UT 47 · WA 280 · OR 342 |
| `place_match` confirmed | **1,584** |
| `place_match` pending (manual_review) | **156** (name_dominant_low_conf 59 · close_nameless 53 · blended_residual 44) |
| `place_match` rejected | **0** |

**PROD manual_review (156 records) NOT triaged.** TEST triage decisions were
made against TEST-specific candidate records and should not be assumed to
transfer. PROD triage is a separate step.

**Migrations applied to PROD this session:**
- `20260817120000_resolve_place_match.sql` (from merged PR #230)
- `20260818140000–20260819190000` (5 ledger-alignment stubs, no-ops)
- `20260820120000_state_parks_field_precedence.sql` (8 seed rows)

## 2026-08-18 — state parks source enumeration complete; architecture spec READY FOR BUILD

~~**Investigation-only session.** No code written, no migration, no TEST/PROD
writes. Branch `state-park-systems-enumeration` carries one uncommitted file:
`docs/specs/state-parks-source-architecture.md` (v4, READY FOR BUILD).

**What this session produced:**

1. **Six-state data source enumeration** (CA, AZ, NV, UT, WA, OR): every
   state's parks agency publishes public, unauthenticated ArcGIS endpoints.
   All endpoint URLs verified live `[2026-08-18]`. Depth varies:
   - **AZ**: 1,346 individual campsites with per-site amenity fields (hookups,
     ADA, surface — but data from **2016**)
   - **WA**: 6,124 campsite location points (name/park/active only, no
     amenities) + 913 activity points
   - **CA**: 531 campground/camp-area points (per-campground, not per-site).
     CSP publishes 8 layers monthly.
   - **NV**: 362 state-park-specific facility points (filterable via
     `jurisdicti='NV State Parks'`)
   - **OR**: 422 boundary polygons (342 distinct parks by `FULL_NAME`),
     boundaries-only
   - **UT**: 77 boundary polygons (47 distinct parks by `parkabbid`),
     boundaries-only

2. **Architecture spec** (`docs/specs/state-parks-source-architecture.md`, v4):
   - Single `source_id = "state_parks"`, depth-varying `normalized_payload`
   - Per-endpoint stable keys verified (GlobalID where available; `name` for NV
     — accepted risk, 27-record scope; `ParkName` for WA boundaries — ParkCode
     has 3 collisions)
   - Dissolve keys verified per state: CA `UNITNBR` (461→394, CSP official=280),
     UT `parkabbid` (77→47), OR `FULL_NAME` (422→342)
   - `source_quality_score = 0.7` (0.5 for stale AZ campsites), calibrated
     against existing scale
   - 8 `field_precedence` seed rows designed (identity at priority 4, sparse
     operational appended last; description excluded — sourced from visitor
     websites, not GIS)
   - AZ campsite `data_vintage: "2016"` field for staleness marking
   - Expected ~9,414 total `source_record` rows
   - **All open questions resolved.** Only the `description` placeholder (§10a)
     is blocked, pending a separate visitor-website investigation.

3. **Decisions recorded** (Adam, 2026-08-18):
   - Scope: six states confirmed (same as OSM corridor scope)
   - Depth: campground/site-level where available; boundaries-only for OR/UT
   - Fee/seasonal-closure: omitted entirely — no state publishes via GIS
   - NV key: `name` accepted despite no GlobalID (27-record blast radius)
   - CA SUBTYPE: ingest all ~394 UNITNBR groups, filter downstream
   - Description: from visitor websites, not GIS — separate investigation underway
   - OSM: fallback-only (3–122 operator-tagged features per state, sparse)

**No database, corpus, or schema changes this session. No PROD/TEST writes.**

## 2026-08-20 — corpus gap-scan, Google Places compliance check, LLM description pilot + A/B, NONE-bucket characterization, BLM/RIDB/OSM eligibility investigation, placeholder-name deactivations (branch `corpus`, ~~PR #243, **open against `main`, not yet merged**~~)

> **CORRECTED 2026-08-21 — PR #243 has since MERGED**, squash-merged to
> `main` as `5a822ab` `[git log]`. The "open, not yet merged" framing
> below (and the "code is uncommitted" claims throughout this section)
> describe a state that no longer holds — see the masthead and the
> `## 2026-08-21` section above for current position. Left in place,
> per this file's own convention, rather than rewritten.

Newest truth (as of 2026-08-20 — see the correction above and the
`## 2026-08-21` section above for what supersedes it). Investigation-and-fix
session, largely read-only with two
authorized write passes (a small controlled LLM sample and two TEST
deactivation passes). **No PROD writes or reads beyond what's noted below.**
Every figure in this section was computed this session against TEST
(`znldzjdatkogdktymtvi`) — see `docs/measurements/2026-08-20-*.md` for full
methodology on each. This session also ran the `sg` self-audit skill against
its own earlier work; three findings from that pass are still open (see
below) — **nothing has been changed as a result yet**, per the skill's own
"change nothing before the user answers" rule.

### Branch reconciliation — `corpus` vs `fix/amenities-render-shape` `[git, 2026-08-20]`

`corpus` forks `origin/main` at `a501744` (BLM primitive campsite ingester,
#232) and carries one commit ahead, `4297486` (BACKLOG doc entry) — **not
pushed** (`origin/corpus` does not exist). It does **not** contain
`fix/amenities-render-shape` as an ancestor — they are sibling branches.

`fix/amenities-render-shape` itself: still exists, local SHA equals
`origin/fix/amenities-render-shape` (`31ea0fa`) — **fully pushed, still no
PR**, exactly as the superseded masthead above said. But its **code**
substantially already reached `main` by a different path: `git log --follow
origin/main -- data/ingestion/lib/osm-description-templates.ts` shows that
file (and the merge-layer reconnect it shipped alongside) landed via
`411bf9c` (#237) — a squash-merge under a different SHA than the branch's own
29 unique commits, matching this repo's established "parallel worktree,
squash into a fresh branch" pattern (see `CLAUDE.md` §RUNBOOK gotchas). What
this session did **not** re-verify: whether `fix/amenities-render-shape`'s
own TEST-database operations (toilet/water/dump_station reactivation,
viewpoint reactivation, its dump_station cleanup) are now fully redundant
with what shipped via #237–#241, or whether some data-level work from that
branch's session is still uniquely live only on the state that branch left
TEST in. **Flagged, not resolved** — a fresh session should diff
`fix/amenities-render-shape`'s file tree against current `main` before
deciding whether to open a PR, rebase, or abandon it.

### TEST corpus position `[queried TEST 2026-08-20]`

| metric | value |
|---|--:|
| `master_place` | **160,703** |
| `source_record` all / active / inactive | 170,428 / **82,564** / 87,864 |
| `place_match` total / pending | 170,454 / **5,065** |
| `master_place_search_export` (view) | **36,250** |
| `master_place` with `source_count = 0` | **86,299** |

**`source_record` by source (active / all):** osm 22,977 / 109,492 · padus
36,358 / 37,701 · usfs 6,324 / 6,330 · ridb 6,013 / 6,013 · nps 5,283 / 5,283 ·
blm 876 / 876 · atlas_oddities 2,870 / 2,870 · google_resolved 122 / 122 ·
google 5 / 5. osm's active/all gap widened further this session — today's two
deactivation passes (below) plus prior sessions' category curation.

### Committed vs uncommitted — what's actually on disk right now `[git status, 2026-08-20]`

**Committed** (in `4297486`): two BACKLOG entries (Google Places compliance
follow-ups).

**Uncommitted, tracked-file changes:** `data/scripts/lib/eligibility.ts` +
`.test.ts` (`has_real_directions` signal), `data/ingestion/sources/ridb.ts` +
`.test.ts` (`FacilityDirections` parsing), `data/ingestion/sources/blm-rec.ts`
+ `.test.ts` (`WEB_LINK` → `contact.website`), `data/package.json` (two new
backfill script entries).

**Untracked, uncommitted new files:** the BLM/RIDB backfill scripts
(`backfill-blm-website.ts`, `backfill-ridb-directions.ts`), the two
placeholder-name deactivation scripts (`deactivate-unnamed-picnic-area.ts`,
`deactivate-unnamed-ev-charging.ts`), and ~7 one-off measurement scripts
(`measure-*-2026-08-20.ts`, `eval-llm-descriptions-sample-2026-08-20*.ts`).
**This docs pass deliberately does NOT commit any of this** — the task was
docs-only; the code changes remain exactly as a future commit will find them.
`docs/measurements/` (new this session) is committed in this docs pass.

### What happened, in order

1. **Corpus gap-scan** (read-only) — refreshed STRONG/WEAK/NONE bucketing,
   source/state/category breakdowns, Google-linkage measurement. Report:
   `docs/measurements/2026-08-20-corpus-gap-scan.md`.
2. **Google-resolved provenance investigation** (read-only) — traced the 127
   `google_resolved`/`google` rows to the tier-2 live-resolve write-back
   mechanism (`web/src/lib/itinerary/ingest.ts`/`resolve.ts`), not a
   corpus-wide match attempt. Report:
   `docs/measurements/2026-08-20-google-resolved-provenance.md`.
3. **Google Places compliance check.** `editorialSummary` (and every Place
   Details field except `place_id` and coordinates) carries a **30-day cache
   limit** under Google's current ToS — storing it as a permanent
   `master_place.description` value is **not compliant**. The only compliant
   path for that content is live-fetch-at-render (fetch fresh each time,
   never persist) — parked as a BACKLOG item, not built. Report + sources:
   `docs/measurements/2026-08-20-google-places-details-compliance-check.md`.
4. **LLM description-generation pilot** (small controlled sample, real API
   spend, no bulk run). Target population defined precisely: STRONG/WEAK
   bucket, no existing real description = **8,782** rows; `atlas_oddities`
   recommended for exclusion (0 of 2,866 active rows have any description
   text — their STRONG bucketing comes from tags/hours, not narrative
   content) → corrected target **7,154**. 27-row stratified sample run
   against the original prompt: **11/27 (41%) any-fabrication, 4/27 (15%)
   severe.** Report: `docs/measurements/2026-08-20-llm-description-generation-pilot.md`.
5. **Prompt A/B** — redesigned the system prompt (explicit anti-fabrication
   grounding rules, hedging language, length matched to available fields),
   re-ran on the **exact same 27 rows**: any-fabrication **41% → 4%** (11/27
   → 1/27), severe **15% → 0%** (4/27 → 0/27). **One residual
   fabrication remains, reported honestly, not papered over** — flagged as a
   small-sample result (n=27), not certified at corpus scale. Report:
   `docs/measurements/2026-08-20-llm-description-prompt-iteration.md`.
6. **NONE-bucket deep characterization** (read-only + one 20-request live
   Wikipedia calibration). Precise NONE-bucket count and category/source/state
   breakdown; qualitative spot-checks; checked PAD-US/RIDB/NPS/BLM for a
   USFS-directions-style missed field — **found two**: RIDB
   `FacilityDirections` unparsed, BLM `WEB_LINK` mapped to `web_link` but not
   `contact.website`. Report: `docs/measurements/2026-08-20-none-bucket-characterization.md`.
7. **BLM/RIDB eligibility fixes** (TEST writes) — new `has_real_directions`
   signal in `eligibility.ts` (source-agnostic, works for USFS + RIDB);
   BLM's `WEB_LINK` now also populates `contact.website` (flagged: this
   reverses a deliberate "office-level URL, not per-POI" design choice — see
   the new decisions/ entry). Backfilled + verified on TEST: **273 rows
   flipped out of NONE corpus-wide** (265 BLM + 8 RIDB). Report:
   `docs/measurements/2026-08-20-blm-ridb-eligibility-fixes.md`. **Code is
   uncommitted** — see above.
8. **Self-audit (`sg` skill)** against this session's own work. Three
   findings, **none yet acted on**:
   - `RecAreaDirections` gap — the BLM/RIDB fix report's claim "RecAreaSchema
     has no directions-equivalent field" is **false**;
     `raw_payload.recarea.RecAreaDirections` exists, populated on 1,104/1,220
     (90.5%) of RIDB recarea rows. Measured impact if fixed: **1** additional
     recarea-linked MP would flip out of NONE (recareas are usually already
     STRONG via other signals).
   - `atlas_oddities`-in-NONE-bucket count mismatch: **1,157** in the gap-scan
     doc vs **1,144** in the characterization doc — same conceptual
     measurement, never cross-referenced or explained in either doc.
   - The LLM pilot report's claim that severe fabrication "clusters on
     WEAK-bucket rows" is contradicted by its own example list — the
     Bainbridge Island memorial case is explicitly STRONG bucket in the same
     document.
9. **OSM NONE-bucket investigation** (read-only). Mirrored the USFS/RIDB/BLM
   missed-field pattern, scoped to OSM. **Verdict: genuine sparsity, not a
   cheap win** — every OSM row attached to a NONE-bucket MP structurally has
   <5 raw tags and zero `MEANINGFUL_OSM_KEYS` hits (the pipeline's own
   ceiling, verified with zero exceptions across 14,105 rows); no candidate
   free-text field was found after checking all 195 distinct tag keys down to
   frequency 1. `wikipedia`/`wikidata` as raw tags on NONE-bucket nodes: **0**
   (confirms they're already caught upstream). Report:
   `docs/measurements/2026-08-20-osm-none-bucket-tag-investigation.md`.
10. **Two placeholder-name deactivation passes** (TEST writes, same mechanism
    as Phase 0 peak/spring — `source_record.is_active = false` →
    `recompute_master_place()` → dangling-`place_match` cleanup):
    - **picnic_area**: `canonical_name` exactly `"Unnamed picnic area"` AND
      NONE-bucket → **3,427 deactivated**, 0 recompute failures. 53 STRONG +
      1 WEAK placeholder-named rows and 1,187 real-named rows left active.
    - **ev_charging**: investigated fresh (not assumed to mirror picnic_area)
      — found a single literal placeholder `"Unnamed ev charging"` covering
      only 931/3,634 (25.6%) of the category (unlike picnic_area's ~75%); the
      rest are real network/brand names. NONE-bucket placeholder →
      **748 deactivated**, 0 failures. 177 STRONG + 6 WEAK placeholder rows
      and 2,703 real-named rows left active.
    - Both verified: 0 deactivated rows in `master_place_search_export`;
      spot-checked against the live `pois_along_corridor` RPC — 0/5 surfaced
      for each pass. Reports:
      `docs/measurements/2026-08-20-unnamed-picnic-area-deactivation.md`,
      `docs/measurements/2026-08-20-unnamed-ev-charging-deactivation.md`.

### OPEN — not decided, do not treat as settled

1. **The three self-audit findings above** — RecAreaDirections gap,
   atlas_oddities count mismatch, WEAK-clustering claim correction. Presented
   to the user; no response yet as of this doc pass.
2. **`fix/amenities-render-shape`'s real status** — see the branch
   reconciliation note above. Needs a file-tree diff against `main`, not
   inherited from this session's git-log archaeology alone.
3. **Google Places live-fetch-at-render** — parked in BACKLOG, not built.
4. **LLM description generation at corpus scale** — the prompt fix is
   promising (4% residual on n=27) but explicitly not certified beyond that
   sample size; no bulk run has been authorized or run.
5. **This session's code changes are uncommitted** — see above. Committing
   them (and deciding whether to open a PR for `corpus`) is a separate,
   future step.

## 2026-08-18 — amenities + category-curation session; toilet/water/dump_station reactivated with templated descriptions, then narrowed to the described subset (branch `fix/amenities-render-shape`, **PUSHED, no PR**)

Newest truth. **Every figure below was measured against TEST read-only on
2026-08-18 in a single pass** (`data/scripts/measure-session-closeout.ts`) —
none transcribed from a prior report, because counts drifted between reports
during this session (dump_station appeared as both 149 and 26, either side of a
deletion). **No PROD writes this session. Nothing pushed.**

### Where the work lives

**Branch `fix/amenities-render-shape`, 22 commits ahead of `origin/main`, working
tree clean — PUSHED to origin at end of session with upstream tracking set**
`[git, 2026-08-18]`. The reactivation commit is `b794a23`; the docs close-out sits
above it. Two commit messages were corrected before pushing (see BACKLOG), which
rewrote those two commits and their descendants — content byte-identical, messages
only.
Everything in this section is TEST-only and lives on that branch. Two sibling
branches from the same effort were pushed alongside it: `fix/phase0-corpus-field-reconnect`
(`c68ab5a`, an ancestor of this branch) and **`land-manager-precedence-design`
(`30c231a`), which is NOT merged into this branch or `main`** — its BACKLOG entry
is unreachable from here (verified by `git show` on all three refs).

### TEST corpus position `[queried TEST 2026-08-18]`

| metric | value |
|---|--:|
| `master_place` | **156,002** |
| `source_record` all / active / inactive | 165,822 / **82,133** / 83,689 |
| `place_match` total / pending | 163,803 / **4,159** |
| `master_place_search_export` (view) | **36,192** |
| Typesense `places_test` | **36,175** — ⚠ **NOT equal to the view; sync failing, drift 490, see below** |
| `master_place` with `source_count = 0` | **81,189** |

**`source_record` by source (active / all):** osm 27,985 / 109,492 · padus
36,358 / 37,701 · usfs 6,324 / 6,330 · ridb 6,013 / 6,013 · nps 5,052 / 5,283 ·
blm 876 / 876 · google_resolved 122 / 122 · google 5 / 5.

The large active/all gap on osm is this session's deliberate category curation,
not attrition — see the table below.

### Category curation — what is live and what is off `[queried TEST 2026-08-18]`

| category | rows | active | with description | status |
|---|--:|--:|--:|---|
| toilet | 670 | **308** | 308 (100% of active) | **REACTIVATED, then narrowed** — 362 description-less rows deactivated |
| water | 1,005 | **370** | 370 (100% of active) | **REACTIVATED, then narrowed** — 635 description-less rows deactivated |
| dump_station | 26 | **15** | 15 (100% of active) | **REACTIVATED, then narrowed** — 11 description-less rows deactivated |
| viewpoint (nps) | 231 | **231** | 231 (100%) | **REACTIVATED** — 146 master_places, 120 in the view |
| viewpoint (osm) | 6,470 | **175** | 175 (100% of active) | **REACTIVATED, filter C only** — 170 master_places, all 170 in the view; 27 junk + 6,268 undescribed stay off |
| fire_pit | 3,521 | 0 | — | deactivated — decided, not worth templating |
| gas_station | 6,127 | 0 | — | deactivated — **deliberate**, Google covers gas live |
| public_land | 1,343 | 0 | — | deactivated — blocked on parked land_manager work |
| peak | 33,924 | 0 | — | deactivated — product scope decision |
| spring | 31,465 | 0 | — | deactivated — product scope decision |

peak + spring = **65,389** rows measured now (earlier notes said "~64,300" — use
the measured figure). All three reactivated categories are **osm-only**; there is
no non-osm row in any of them, so "all osm rows" and "exactly what `47e00e4`
deactivated" are the same set here (measured, because `47e00e4` deactivated
across *any* source_id and the two definitions do not coincide in general).

**Reactivation verified on BOTH consumer surfaces** — 9 sampled places, 3 per
category, 9/9 present in `master_place_search_export` AND returned by a live
`pois_along_corridor` call with a real GeoJSON LineString through each place's
own coordinates. The RPC reads `master_place.geometry` directly and bypasses the
view, so a place can be in one and absent from the other; checking one surface
would not have been evidence. At full reactivation the view rows in the three
categories were toilet 503 + water 768 + dump_station 16 = **1,287**, exactly the
view's growth (34,888 → 36,175) — which also proved none of these categories had
any row in the view beforehand. **Those figures describe the reactivation step
only.** After the narrowing they are **toilet 215 + water 285 + dump_station 10 =
510** `[queried TEST 2026-08-19]`.

### Shipped this session (all on the branch, none merged)

- **Amenities end-to-end.** OSM + NPS source-layer normalization (NPS extended to
  9 further categories, `95fdeb7`/`b03450d`), the boolean-map → display-label
  translator for the slideup (`f85bbcb`), the capacity/amenities/priceTier
  merge-layer reconnect at the known drop points (`b64bb9e`), OSM added to
  `amenities` `field_precedence` as gap-fill only (`0c046ef`, **TEST-only
  migration**) and the OSM/parks_canada priority collision resolved 5 → 8
  (`c68ab5a`).
- **`pois_along_corridor` `source_count` filter** (`4c9d955`) — closes the gap
  where a deactivated place stayed hidden from browse/search but was still
  offered as a trip stop during generation. Migration `20260818160000`,
  **TEST-only**.
- **Eligibility-bucketing measurement fix** (`69fc612`) — the STRONG/WEAK/NONE
  bucketing never read `normalized_payload.description` directly, so
  RIDB/USFS-heavy categories (facility, visitor_center, recreation_area) were
  wrongly scored sparse. After the fix none of the seven genuinely-sparse
  categories moved, which is what justified deactivating them.
- **Templated descriptions** for toilet / water / dump_station (`9743e6e`,
  `0e8906f`) — built from real structured OSM tags, wired into `normalizeOsm` as
  a **gap-fill fallback only** so a real `description`/`note` tag always wins.
  Degrades gracefully: a bare row gets no description rather than a fabricated
  one. Carries a safety rule — an explicit `drinking_water=no` always outranks a
  generic "drinking water" lead. Suppresses any lead that merely restates the
  category label.
- **dump_station data-integrity fix** (`80bf0a1` → `e43de94`, verified `e1e7af4`).
- **Reactivation** (`b794a23`) + a clean Typesense sync.

### dump_station — the full arc

Of 149 rows, **123 were stale pre-#202 `amenity=waste_disposal`** — municipal
trash bins, not RV sanitary stations. First reclassified to
`inferred_category = null` (`80bf0a1`), then **hard-deleted** per Adam's decision
matching BACKLOG's original stated preference (`e43de94`). A full-row backup was
taken first; a later pass then read **all 123 backed-up rows** (a full scan, not a
sample) and confirmed the premise: 100% `amenity=waste_disposal`, zero carrying
`description`/`operator`/`website`/`brand`/`phone`/`opening_hours`/`fee`/`addr:*`,
and the only 2 rows with a `name` tag are literally named `"Dumpster"` with
`waste=trash`. Nothing was restored. **The real dump_station population is 26**,
all `amenity=sanitary_dump_station`. **15 of the 26 are active** — the 11
carrying no description were deactivated in the narrowing step
`[queried TEST 2026-08-19]`.

**Residual:** 94 `master_place` rows still read `primary_category='dump_station'`;
**78 sit at `source_count = 0`** and stay out of the view (only 16 are live). Those
78 are a third observed instance of the `recompute_master_place` clear-bug —
see `BACKLOG.md`.

### Typesense

**SUPERSEDED 2026-08-19 — a later sync FAILED; see the note below this block.**
The 2026-08-18 run against `places_test` **succeeded**: fetched 36,175, indexed 36,175,
**0 failed**, pruned 81,086 stale docs, 0 prune errors. The prune implies a
pre-sync index of 117,261, matching the figure recorded for `places_test` on
2026-08-17 — i.e. the index had not been synced since then and this run absorbed
the whole session's deactivations. **`places_test` now equals the view exactly.**
`[measured 2026-08-18]`

> The handoff reported 3 consecutive OOM failures on this shared TEST cluster.
> **That was not observed in this session** — one run, and it succeeded. The OOM
> remains a reported constraint, not a reproduced one, from this session's vantage.

> **2026-08-19 — the OOM is now REPRODUCED, and the index is stale.** A sync run
> after the narrowing **failed**. The cluster reports
> `{"ok":true,"resource_error":"OUT_OF_MEMORY"}` with system memory at
> **0.42 GB / 0.44 GB = 96.7%** `[queried 2026-08-19]`, and refuses writes with
> **HTTP 422 `ObjectUnprocessable`** rather than a 500 — which is why it does not
> look like OOM at first glance. Only 2 of the 100 docs in the rejected batch were
> in the three categories, so this is a cluster constraint, not a data defect. Not
> retried.
>
> **Consequence — a real split between surfaces.** `places_test` still holds
> **36,175** docs against a **36,192**-row view `[queried TEST 2026-08-19]`. The
> drift has since FLIPPED SIGN: it was +490 (index ahead) after the two viewpoint
> reactivations, and the BLM materialization then added 507 places to the view,
> leaving the index **17 BEHIND**. Search remains stale in both directions — it
> still returns the 777 narrowed-out places AND lacks the 287 restored viewpoint
> places plus the 507 new BLM ones. Confirmed by direct
> document lookup, not inferred from the count gap: sampled deactivated places
> return HTTP 200 from `places_test` while being absent from the view
> `[measured 2026-08-19]`. **The database-backed surfaces are correct** — the
> export view and `pois_along_corridor` (trip generation) both reflect the
> narrowing. **Search-backed surfaces are stale until the cluster can accept a
> sync.**

### Viewpoint — both slices reactivated 2026-08-19 `[queried TEST 2026-08-19]`

`47e00e4` deactivated viewpoint wholesale on a sparseness verdict that fits only
its OSM half. Re-measured: **nps viewpoint is 231/231 described (100%)** against
**osm viewpoint at 202/6,470 (3.1%)**. The category was reopened in two steps.

**NPS slice (`16738b6`) — all 231 reactivated.** 148 linked → **146 distinct
master_places**, of which **120 are in the export view**. The 26 absent are not a
defect: they pass `source_count` and `is_searchable` and are excluded by the
view's geographic filter, being outside `six_state_footprint()` — Los Alamos NM
and Oak Ridge TN Manhattan Project NHP sites.

**OSM slice (`6a03720`) — 175 reactivated under "filter C".** The described subset
was investigated before any reactivation rather than presumed good. Filter C keeps
real content and drops only structurally contentless rows; it deliberately keeps
BOTH `description`-tag and `note`-tag material, because the expected
mapper-to-mapper junk did not materialise — **0 rows** contained mapper vocabulary
and the note rows carry some of the best content (trail directions, snake
warnings, private-property access limits). Current OSM viewpoint state:

| slice | rows | status |
|---|--:|---|
| passes filter C | **175** | **ACTIVE** — 170 distinct master_places, **all 170 in the view** |
| junk, excluded | **27** | stays off — under-min-chars 16, single-word 8, name-restatement 2, url-only 1 |
| no description at all | **6,268** | stays off, untouched |
| **total** | **6,470** | partition closes exactly |

The view grew by **169**, not 170, because one place — *Father Crowley Vista
Point- Rainbow Canyon* — already carried an active NPS viewpoint source from
`16738b6` and was in the view already. Both slices together put **287** rows of
`primary_category='viewpoint'` in the view.

**City Hall Observation Deck is NOT part of either reactivation.** A prior brief
expected it in the NPS slice; it is **OSM-sourced** (`osm:node:5745696621`, its
only source_record) with a **null description**, so it qualifies under neither
slice and remains deactivated. The `la-to-portland` payload itself labels it
`"secondary":"osm"`. It was used as a negative control in both verifications and
correctly stayed absent from both surfaces.

**KNOWN LIMITATION — 88 active-but-unreachable rows, unresolved.** Rows with no
`master_place_id` were reactivated along with their slice but reach **neither**
surface; they need materialization. **83 nps + 5 osm = 88.** The five OSM ones are
listed because they are among the better content in the set:

- `osm:node:358804431` — Zabriskie Point, 254 chars of real prose
- `osm:node:11370405017` — "Lowest point in North America. HIKING NOT ADVISED AFTER 10AM IN THE SUMMER !!!" (Badwater Basin)
- `osm:node:9287425516` — note-tag: "Follow the dirt path up the hill … watch out for snakes"
- `osm:node:9287425501` — note-tag: "Follow the pathway behind the locked gate…"
- `osm:node:9401761579` — "View of the Roosevelt Dam"

Same issue class in both slices, unresolved in both. This is why 175 OSM rows
resolve to 170 master_places and 231 NPS rows to 146.

Propagation was verified on BOTH surfaces for each slice — 5/5 for NPS, 7/7 for
OSM including two note-tag positives and three negative controls.

### BLM dispersed_camping ER backlog materialized 2026-08-19 `[queried TEST 2026-08-19]`

A corpus-wide diagnosis found source_records that were **active and unlinked with
no `place_match` row at all** — never processed by entity resolution, distinct
from the `manual_review` queue. Root cause established by exclusion (timing,
data-shape, category allowlist and run-truncation all refuted): the rows were
simply never included in any materialize invocation's id set. The durable gap is
that **nothing reconciles "did every source_record receive an outcome?"** — the
fail-closed `--only-categories` allowlist plus per-chunk operator scoping makes
silent omission structurally possible.

The largest block, **652 blm `dispersed_camping` rows**, was materialized. Scoping
was verified clean first: the delta was exactly 652, **0 inactive rows** would be
swept in (unlike viewpoint, where 160 would).

| outcome | count |
|---|--:|
| `new_master_place` | **507** |
| `auto_link` | **44** |
| `amenity_rollup` | 0 |
| `manual_review` (still unlinked) | **101** |

**Result:** 551 of the 652 are now linked, 101 remain in review. All 652 received
a `place_match` row (551 confirmed, 101 pending). They resolve to **529 distinct
master_places — 507 newly created plus 22 pre-existing** ones the auto_links
attached to, confirmed by `created_at` rather than inferred.

`recompute_master_place` runs **inside** `apply_match_outcomes` — no separate pass
needed. Verified: of the 529, **0** sit at `source_count = 0` and all 529 are in
the export view, which requires `source_count > 0`. Propagation confirmed on both
surfaces, 4/4.

**Measured cost, because it is the real constraint:** wall clock **471 s** —
`matchall_ms` **381,093** for 652 input ids, plus `apply_match_outcomes`
**59,594 ms** across 27 calls at batch_size 25. This is the load the 2026-08-16
tier-exhaustion incident concerned; a per-category run of this size is ~8 minutes,
not seconds.

**Backlog remaining after this pass:** never-processed rows fell **2,671 → 2,019**,
and never-processed *and active* **912 → 260** `[queried TEST 2026-08-19]`.

**Viewpoint was deliberately NOT materialized.** Its dry run showed 82 of the 88
active rows (93%) would land in `manual_review`, which leaves them unlinked and
therefore still invisible — materialization would not achieve the goal. See
`BACKLOG.md`.

### OPEN — not decided, do not treat as settled

1. ~~**The description-less remainder.**~~ **RESOLVED 2026-08-19 — Adam decided
   to pull it back out, and it is implemented.** Within toilet / water /
   dump_station only rows carrying a description (real OSM original or generated
   template) stay live; **1,008 description-less rows were deactivated** — 362
   toilet, 635 water, 11 dump_station. Live now: **toilet 308, water 370,
   dump_station 15**, every one of them described `[queried TEST 2026-08-19]`.
   Verified on both consumer surfaces in both directions (18/18): deactivated
   places absent from the view AND from `pois_along_corridor`, described controls
   present on both. All 519 master_places holding a described active row remain
   in the view.

2. ~~**NPS viewpoint reactivation — still NOT done.**~~ **RESOLVED 2026-08-19 —
   both viewpoint reactivations have run.** See the dedicated section below.

3. **Two approved-but-unapplied one-line commit-message corrections** — see
   BACKLOG. Deliberately NOT applied in this docs pass.

## 2026-08-17 (later) — six-state NPS materialized live on TEST; park_feature-linking guard + `/parks` wiring merged; Typesense caught up

Newest truth. **All corpus counts re-measured against TEST read-only,
2026-08-17** `[queried TEST 2026-08-17]`. **No PROD writes this session.** Three
PRs merged to `main` this session — #233 (recgov rule widened to NPS), #234
(park_feature-linking guard), #235 (`/parks` wiring).

**NPS was a stale demo.** Before this session the corpus held **83** NPS rows —
all Joshua Tree, from a single 13-second run in May — against **91 units and
~223 campgrounds** in the six states (~1% coverage). The ingester is
**parkCode-driven and will not enumerate**; the 91 codes come from
`/parks?stateCode=WA,OR,CA,AZ,NV,UT` as a manual pre-step. Ingested all 91:
**5,283 `source_record`** `[queried TEST 2026-08-17]`.

**TEST corpus position `[queried TEST 2026-08-17]`:**

| metric | value |
|---|--:|
| `master_place` | **155,495** (150,844 → +4,651 from the NPS materialize) |
| `source_record` all / active | 165,945 / **165,939** |
| `place_match` total / confirmed / pending | 165,292 / 159,188 / **6,102** |
| `master_place_search_export` (view) | **117,261** |
| Typesense `places_test` | **117,261** (was 14,911) |
| synthetic `"NPS park boundary:"` master_places | **0** |

**`source_record` by source (active / all):** osm 109,615 · padus 37,701 ·
**usfs 6,324 / 6,330** (6 legacy `usfs:recarea` inactive) · ridb 6,013 · **nps
5,283** (was 83) · **blm 876** · google_resolved 122 · google 5. Active +6,076
over the prior 159,863 = NPS +5,200 + BLM +876, exactly.

**NPS `[queried TEST 2026-08-17]`:** 5,283 SRs — park 91 · picnic_area 56 ·
visitor_center 169 · viewpoint 231 · trailhead 243 · campground 258 ·
**park_feature 4,235**. **Resolved 4,987** = own-MP/`new_master_place` **4,705**
+ shared-MP/`auto_link`+`amenity` **282**; **unresolved/pending 296**
(blended_residual 122 · close_nameless 78 · name_dominant_low_conf 96).

**Live materialize — 7 category chunks, 5,200 rows, zero errors, zero 5xx, no
halt** `[measured during run 2026-08-17; each split re-derived from current
linkage]`. Order: park (90) → picnic_area → visitor_center → viewpoint →
trailhead → campground → **park_feature (4,182) last, alone**. Outcomes: **4,651
`new_master_place` · 262 `auto_link` · 8 `amenity_rollup` · 279 `manual_review`**.
Reconciles exactly against the 66-resolved/17-pending May-jotr baseline (own 4,705
= 4,651 + 54; shared 282 = 270 + 12; pending 296 = 279 + 17).

**Zero `park_feature` linked to anything — measured, not asserted `[queried TEST
2026-08-17]`:** among master_places holding an `nps:park_feature` source, **max
`source_count` = 1**, **0** have `source_count > 1`, **max 1 park_feature SR per
MP**, 4,225 distinct MPs == 4,225 rows. The guard (#234) forced every one to its
own place. ADR: `docs/decisions/2026-08-17-bar-nps-park-feature-linking.md`.

**Renames landed = 103 canonical, 0 category `[queried TEST 2026-08-17, measured
against the actual 272 shared target MPs]`.** Category = 0 is
attribution-confirmed — **0** MPs carry `attribution.primary_category == 'nps'`
(NPS never populates `normalized_payload.primary_category`, so it cannot win that
field; the dry run's predicted "56" is a report proxy artifact — `BACKLOG.md`).
The **121 → 103 canonical gap is worth writing down, because the shape recurs:**
the dry run predicts renames **per prediction row** (one SR → one MP); the corpus
renames **per master_place** (one winning name). The 18 predicted-but-not-landed
= **9 `park`** (synthetic in the dry run, now real names via `/parks` → no-op) +
**9 non-park**, and those 9 split into **~5 sibling renames** (multiple NPS SRs hit
one MP; a *different* SR's name won, so that prediction row "didn't land" but the
MP still renamed — counted once, under the winner, in the 103) and **~4 genuine
no-ops** (the predicted auto_link produced no name change). Not order effects.

**`/parks` wiring (#235) fixed the 9 `park`-category synthetic renames at the
data layer, not the matcher.** Park rows previously got `"NPS park boundary:
<code>"` because the ingester skipped `/parks`; on materialize NPS's priority-1
`canonical_name` would have overwritten `"Alcatraz Island"` and 8 others. #235
maps `fullName → canonical_name` (+ `description`, `contact`, `hours`;
`designation`/`entranceFees`/`addresses` stay in `raw_payload`), keeping the
polygon centroid as the point to avoid changing `fed_exact`. Re-ran all 91 codes
idempotently; **0 synthetic names remain**. The last one — jotr's already-resolved
MP from May — was fixed by a **targeted `recompute_master_place`** →
`"Joshua Tree National Park"` (single call; description/contact/hours populated;
`primary_category` unchanged).

**Typesense caught up — the finding, not a footnote.** The search index was stale
by **~102k**, not the 4,651 NPS delta. `places_test` went **14,911 → 117,261**
`[queried TEST 2026-08-17]`. The 14,911 is the **2026-08-10** state
(`DATA_INVENTORY.md`); the index **was not synced since 2026-08-10**, so the
OSM / PAD-US / BLM six-state searchable rows added since never reached
`places_test` until this `materialize --skip-er` run (fetched/indexed 117,261,
0 failed, 0 pruned, collection `places_test` — never `places_prod`).

**Still open (`BACKLOG.md`):** 10 jotr `park_feature` rows pending from May (the
guard would have made them `new_master_place`, but they predate it); the
`fed_exact` category-blind / name-blind class; the dry-run report's
`primary_category` proxy artifact; the NPS-park_feature physical-vs-interpretive
CMS question. Migration `20260817120000` (`resolve_place_match`) remains
**TEST-only**.

## 2026-08-17 — all four USFS categories materialized on TEST; `resolve_place_match` RPC + recreation.gov-id queue rule (~~OPEN PR #230~~ **MERGED to `main` since — 2026-08-17 (later)**)

Newest truth. **All counts re-measured against TEST read-only, 2026-08-17**
`[queried TEST]`, apples-to-apples on `is_active = true`. **No PROD writes this
session.** The migration `20260817120000` is applied to **TEST only** — PROD is a
separate authorized step. Code is in **OPEN** PR #230 (`45e6ede`), not merged.

**TEST corpus position `[queried TEST 2026-08-17]`:**

| metric | value |
|---|--:|
| `master_place` | **150,844** (149,385 → +1,459 from the three materializes) |
| `source_record` (active) | **159,863** |
| — osm / padus / usfs / ridb / google_resolved / nps / google | 109,615 / 37,701 / 6,324 / 6,013 / 122 / 83 / 5 |
| — usfs active by category | campground 2,312 · trailhead 3,041 · picnic 570 · dispersed 401 |
| — usfs SR linked / unlinked | **5,228 / 1,096** |
| `place_match` pending (`manual_review` queue) | ~~**5,745**~~ (blended_residual 4,979 · close_nameless 325 · name_dominant_low_conf 441) **— SUPERSEDED: was already 5,823 at NPS-run time (+78 blm-triage), now 6,102 (see the 2026-08-17 (later) section). The stated 5,745 baseline was wrong by 78 rows.** |
| — pending usfs by category | campground 572 · trailhead 440 · picnic 50 · dispersed 35 |

**All four USFS categories now materialized live on TEST.** Since 2026-08-16:
picnic (570 SR) + dispersed (401 SR) materialized, then **campground (2,312 SR):
715 new_master_place + 655 auto_link + 942 manual_review** `[handoff, unverified
— split not isolated this session; the three sum to the measured 2,312]`. The
floor's `name_dominant_low_conf` cluster went **0 → 441** as a result (the visible
half of what the floor converts from silent merges to review rows). The
"95% osm" queue framing is now stale: `blended_residual` is **87%** of the 5,745,
osm-specifically **67%**.

**`resolve_place_match` / `unresolve_place_match` RPCs (migration
`20260817120000`, TEST only).** `apply_match_outcomes` is INSERT-only and its
`manual_review` branch leaves the source_record unlinked, so **no path to CONFIRM
an existing pending row existed** (re-inserting collides with
`unique(source_record_id, master_place_id)`). `resolve_place_match` links the SR,
flips status to `confirmed`, tags `resolved_by`, recomputes the MP;
`unresolve_place_match` is the exact inverse for snapshot-based undo. Neither
deletes rows. ADR: `docs/decisions/2026-08-17-resolve-place-match-and-recgov-id-rule.md`.

**Deterministic recreation.gov-id queue rule — applied as tag `full0817`.** The
USFS INFRA payload text already embeds the `recreation.gov/camping/campgrounds/<id>`
facility id for developed campgrounds (no fetch needed). The rule auto-confirms a
pending usfs campground row when that id resolves to a `ridb` record
(`external_id ridb:facility:<id>`) on the **same** master_place the pending row
proposes. **370 confirmed, 0 failures, 0 renames, 0 recategorizations, max
source_count 6** `[queried TEST 2026-08-17]`. Undo verified **exact** on a 2-row
round trip (canonical_name, primary_category, source_count, pending status all
restored) before the full run. Snapshot on record:
`~/.config/overlander/queue-snapshots/recgov-full0817.jsonl`.

**Surfaced but NOT touched (in the queue, pending):** **58** rows where the
payload id resolves to a *different* master_place (mis-pairings — several are
duplicate master_places sharing a name); **28** rows naming recreation.gov
facilities not in the corpus. Handling design is in `BACKLOG.md`.

## 2026-08-16 — PAD-US + USFS six-state on TEST; `name_dominant` 0.70 floor (~~code in OPEN PRs~~ **PRs #223/#224 MERGED to `main` since this section was written — 2026-08-17**)

Newest truth. **All counts re-measured against TEST read-only, 2026-08-16**
`[queried TEST]`. **No PROD writes this session.** Two things to hold separately:
the **TEST corpus operations** (PAD-US + USFS ingest, trailhead materialize) are
**live on TEST**; the **code** (matcher floor, USFS ingester, dry-run tooling) is
**NOT on `main` yet** — it merged into the stacked PRs #223/#224, which are still
**OPEN** against `main`. Docs-only #225 (padus follow-ups) and #228 (matcher/CI
notes) *did* merge to `main`.

**TEST corpus position `[queried TEST 2026-08-16]`:**

| metric | value |
|---|--:|
| `master_place` | **149,385** |
| — `primary_category='land_status'` (search-excluded) | 35,966 |
| — `primary_category='public_land'` (searchable) | 1,314 |
| `source_record` (active) | **159,863** |
| — osm / padus / usfs / ridb / nps / google_resolved / google | 109,615 / 37,701 / 6,324 / 6,013 / 83 / 122 / 5 |
| `place_match` pending (`manual_review` queue) | **5,089** (blended_residual 4,856 · close_nameless 233 · name_dominant_low_conf 0) |

**PAD-US six-state COMPLETE on TEST.** Fee_Managers endpoint, all six states;
padus active `source_record` **37,701** `[queried TEST 2026-08-16]`. (The
handoff's "42,638 padus SRs" was a cumulative-written figure; the measured
**active** total is 37,701 — used here, same as 149,385 is used over the
handoff's 147,414.) Polygon centroids are structurally disjoint from the point
corpus under the current matcher — 0 auto_link, 0 amenity_rollup `[per #225,
not re-measured this session]` — so the earlier "over-merge" fear did not
reproduce. **~96% of the
land-status family is `land_status`** (35,966 vs 1,314 `public_land`), all
search-excluded — the corpus-weight product question is OPEN in `BACKLOG.md`.

**USFS ingester rewritten** `EDW_RecreationOpportunities_01` → `EDW_RecInfraRecreationSites_02`
(in OPEN PR #223, via #226). **6,324 active `source_record`** on TEST — trailhead
3,041 · campground 2,312 · picnic_area 570 · dispersed_camping 401; 6 legacy
`usfs:recarea:*` deactivated. **Trailhead MATERIALIZED live** — 2,601 linked
`[queried TEST 2026-08-16]` (the 630 auto_link / 1,971 new_master_place split is
`[handoff, unverified]` — only the 2,601 total and the 3,723/3,283 unlinked
figures were re-measured); the residual 440 = 3,723 unlinked − 3,283
unmaterialized. ~~**Campground PARKED**
(behind the matcher floor + queue capacity); **picnic (570) + dispersed (401)
dry-ran clean, not materialized.** usfs unlinked = 3,723 (440 trailhead reviews +
3,283 unmaterialized).~~ **SUPERSEDED 2026-08-17 — all four categories now
materialized; usfs unlinked = 1,096. See the 2026-08-17 section.**

**Matcher `name_dominant` now gated on `combined_confidence` at 0.70** (PR #227 →
stacked into OPEN #224; `a17bce8` + routing test `208bbae`). Below-floor →
`manual_review` (`name_dominant_low_conf`), no fall-through. Campground preview
went 1,427 auto → 657 (771 below-0.70 flags → 0); picnic byte-identical. Distance
clip deliberately untouched. ADR: `docs/decisions/2026-08-16-name-dominant-confidence-floor.md`.
Also in OPEN #224: `materialize --dry-run-report` (per-match JSONL; matcher
untouched, byte-identical counts). Measurement scripts in OPEN #223.

**Manual-review queue = 5,089, 95% osm `blended_residual`.** A triage framework was
**scoped, not built** (`BACKLOG.md`) — ~~it is now the blocker on a live campground
materialize, not the matcher.~~ **SUPERSEDED 2026-08-17 — campground materialized
anyway; queue now 5,745. The first deterministic bulk-clearing mechanism (the
recgov-id rule) shipped and cleared 370. See the 2026-08-17 section.**

**One incident `[handoff, unverified — not observed by this agent]`:** TEST
(Micro `t4g.micro`) went Unhealthy for ~2h during a WA PAD-US materialize —
`materialize` has no `pLimit` serialization and back-to-back runs exhausted the
tier. Recovered; subsequent runs chunked with health checks. Backlogged.

## 2026-08-13 — RIDB + OSM six-state campaigns COMPLETE on TEST; six PRs landed on `main`

Newest truth for TEST. Every number **re-verified against TEST read-only,
2026-08-14** `[queried TEST]`. **No PROD writes this session** — everything
below is TEST-only, live-write ingest work.

**RIDB six-state campaign (WA, UT, OR, AZ, NV, CA) — COMPLETE:**
`source_record` (ridb) **355 → 6,013**; **5,493** distinct `master_place`
carry a ridb source_record; **362** ridb rows sit in `manual_review`
(`place_match.status='pending'`). Ran at `pLimit(1)` after `pLimit(4)`
sustained-429'd twice on UT (see below). Two real incidents along the way,
both recovered: a UT run hit sustained rate-limiting mid-run (retried clean at
`pLimit(1)`); an NV run hit a ~14s local DNS blip that dropped 52 upserts
(46 distinct ids) — verified afterward that tile-overlap self-recovered 30 of
those within the same run and the remaining 16 landed on a clean backfill re-run,
**0 permanently lost**.

**OSM six-state campaign (same six states) — COMPLETE**, families `camping,
trailheads, natural, leisure, fuel, tourism_misc` (deliberately excludes
`water_san` — every category it produces is suppressed from browse per
`SLIDE_TO_PRIMARY_CATEGORY` — and `shops`, already off by `DEFAULT_FAMILIES`):
**+105,392** new `source_record` (osm), **+88,883** new `master_place`,
**+1,745** new `manual_review` rows. Zero ingest errors, zero reconciliation
errors, zero Overpass timeouts across all six states — every state ran clean
end to end (`--iso US-<XX>`, untiled area query, 900s Overpass internal
timeout, never hit).

**Corpus totals now (TEST, all sources):**

| metric | value |
|---|--:|
| `source_record` total | **115,957** |
| — osm | 109,615 |
| — ridb | 6,013 |
| `master_place` total | **110,246** |
| — solo (`source_count=1`) | 109,053 |
| — multi (`source_count>1`) | 1,193 |
| distinct `master_place` with any osm source_record | **105,121** |
| `place_match` pending (manual_review), corpus-wide | **4,230** (osm 3,848 · ridb 362 · other 20) |

**A real measurement-tooling bug was caught and fixed mid-campaign.** CA's
post-reconciliation analysis (the largest single ingest, ~110K osm rows)
initially showed an impossible result — the same `external_id` appearing
twice under one `master_place` — traced to client-side pagination
(`.range()`) with no `.order()` clause, letting the same row land in two
overlapping page windows at CA's table size. **This was the measurement
script, not the data** — confirmed via a direct single-row query. Fixed
(`.order("id")` + defensive dedup) and re-verified against materialize's own
server-side outcome counts, which matched exactly after the fix. The other
five states' numbers were cross-checked against their own outcome-count sums
at the time and all matched within the known small rectangle-vs-true-state-
polygon boundary margin (1–11 rows) — evidence, not proof, they weren't
affected by the same latent bug.

**pLimit(1) committed as the RIDB default** (`data/ingestion/lib/rate-limit.ts`,
was `pLimit(4)`) — measured: `pLimit(4)` reliably triggered sustained 429s
after ~3–4 minutes of concurrent RIDB traffic (twice, both on UT);
`pLimit(1)` ran every subsequent state through cleanly, ~4x slower per
fetched item but zero 429s. Comment on the line names the measurement and the
revisit condition (a documented higher RIDB tier, or a change in observed
throttle behavior).

**Six PRs landed on `main` `[gh pr list, 2026-08-14]`** — **#221
`fix/ridb-plimit-serialize`** is this session's own commit (the pLimit(1)
change above), pushed and merged independently. **#216–#220** (`badge-gate`,
`fold-union`, `enrichment-name-gate`, `enrichment-dry-run`,
`enrichment-aggregate-split`) landed via a **stacked PR chain** built in a
parallel workspace (`djibouti`, a sibling git worktree sharing this repo's
object database) from six already-implemented local commits that had never
been pushed — a "get existing work onto GitHub correctly" task, not new
development. All six merged 2026-08-13T23:43. Stack order mattered
(`#217→#216`, `#218→#217`, `#219→#218`, `#220→#219`) since the commits build
on each other; #221 was independent.

- **#216 — badge gate on `placeId` presence, shipped.** Closes the
  "DECIDED and SCOPED, unbuilt" `docs/BACKLOG.md` item from 2026-07-31 — see
  that file for the shipped annotation.
- **#217 — fold union: chord + polyline supply in corpus fold.**
- **#218 — enrichment name gate:** `fetchEnrichmentCandidates` now filters
  `isPlaceholderName` before feeding the Google resolver.
- **#219 — enrichment dry-run:** `--skip-enrichment-persist`, preview without
  write.
- **#220 — enrichment aggregate split:** `EnrichmentAggregate` now reports
  `enriched_new` / `enriched_existing` / `enriched_unknown` separately so a
  dry-run report is decision-quality, not just a single opaque count.
- **#218–#220 together are the grounding dry-run infrastructure** — built,
  merged, **not yet run against the six-state corpus**. See
  `docs/BACKLOG.md` and the new ADR
  `docs/decisions/2026-08-13-google-places-strategy-open-question.md` — the
  strategic question of whether/how to spend against Google Places is
  **OPEN**, and the dry-run should not proceed until it's answered.

**Matcher bugs found this session, unfixed — see `docs/BACKLOG.md`** for the
full writeup: coordinate-dominant merges at 0m distance (Castle Rock Trail +
Badger Trail; now also confirmed source-agnostic via OSM's Liberty Glen
#72/#73/#74), and the `name_dominant` waterfall step bypassing
`combined_confidence` entirely (Buckhorn Draw Campsite 10 + Buckhorn Dino
Track, confidence 0.544 — below even the `manual_review` floor — still
auto-linked).

**Gotcha worth carrying forward — stacked branches across worktrees.** This
repo uses git worktrees sharing one object database; a branch checked out in
a *different* worktree is still visible and pushable from any other one — a
"wrong workspace" mismatch doesn't block git operations, only affects working-
tree file state. `git push origin <sha>:refs/heads/<name>` creates a remote
branch with **no corresponding local branch ref** — a later plain
`git push origin <name>` or `git branch --contains` won't find it locally
even though it's live on origin. And stacked commits need stacked PR
**bases** (each PR's base = the previous PR's branch, not all four vs.
`main`) — otherwise a later PR in the chain shows the full cumulative diff of
everything beneath it, not just its own change.

## 2026-08-11 — bbq/fire_pit deactivated on PROD (view 16,654 → 16,516)

Newest truth; **supersedes the view / places_prod / active-source_record figures in
every section below.** Every number **re-verified against PROD read-only, 2026-08-11**
`[queried PROD]` (not taken from the operation report).

The 223 osm `inferred_category = fire_pit` source_records (all `amenity=bbq` — see
`docs/LOG.md` 2026-08-11 for why) were deactivated (`is_active = false`); their 138
solo master_places were recomputed to `source_count = 0`; the 85 dangling pending
`place_match` rows on the unlinked ones were cleared; `search:sync` pruned 138 stale
docs from `places_prod`.

| metric | before | **now** |
|---|--:|--:|
| `master_place_search_export` (view) | 16,654 | **16,516** |
| Typesense `places_prod` | 16,654 | **16,516** (= view exactly) |
| `source_record` `is_active = true` | 20,750 | **20,527** (−223) |
| `source_record` `is_active = false` | 8,067 | **8,290** (+223) |
| `master_place` total | 20,904 | **20,904** (unchanged) |

**The 138 fire_pit master_places were NOT deleted.** They persist at
`source_count = 0` and `is_searchable = true`, but the view's `source_count > 0`
filter now excludes them — so they drop from search without leaving the corpus.
`master_place source_count = 0` went from 0 → **exactly 138**, all
`primary_category = fire_pit` (recompute kept the category, only zeroed the count).
Boundary-checked: exactly the 138 expected MPs had `updated_at` bump, zero others.

**gas_station (261) and ev_charging (184) osm rows were deliberately left active** —
their category mappings were dropped in #214, but the rows stay (gas is covered live
by Google; ev_charging is the only corpus EV source until Google's EV type proves out).
See `docs/BACKLOG.md`. `data/.env` + CLI link left on TEST after the op.

## 2026-08-10 (later) — export view on `six_state_footprint()` + Artboard C photo LIVE on PROD

Newest truth; supersedes the view figures in the section below (which predate the
#209 footprint repoint). Every number **re-measured against PROD and TEST read-only,
2026-08-10** `[queried]`.

**Artboard C — corpus photo now flows into search (#211, live on PROD).** `photo_url`
was lateraled into `master_place_search_export` (the same nps/ridb lateral
`pois_along_corridor` uses, NPS preferred), then plumbed through the Typesense sync
(`PlaceDocument`) and `hydratePlacesByIds` (via the existing `nps_photo_url → photoUrl`
map — **no UI change**). So the same place now shows its image in search as it does in
corridor browse. On PROD:

| metric | value |
|---|--:|
| `master_place_search_export` (view) | **16,654** (unchanged — additive LEFT JOIN) |
| view rows carrying a non-null `photo_url` | **3,526** (~21%) |
| Typesense `places_prod` | **16,654** (= view exactly) |

A `places_prod` doc carries `photo_url` (retrievable) and hydrate returns `photoUrl`
against PROD — both verified. **Caveat (BACKLOG):** `photo_url` is stored/retrievable
but **not a declared Typesense schema field** on the existing collections, so
`filter_by`/`facet_by` on it 400s; rendering is unaffected.

**The export view now filters on `six_state_footprint()`, not `six_state_scope()`
(#209).** `six_state_scope()` (coarse) leaked **9 Idaho panhandle rows** into search;
the tighter footprint removed them. **Net was −9 +2, not −9:** footprint is **not a
strict subset** of scope — its accurate WA-northwest edge (Haro Strait) correctly
re-includes **2 San Juan Islands WA** campgrounds that scope's flat 48.40 step
dropped. View **16,661 → 16,654**. `six_state_scope()` is retained (marked superseded)
because the source_record trim's helpers still reference it.

**TEST was brought to the PROD view baseline.** TEST lacked the four six-state view
migrations (`180000–180300`); applied via `db:push-verify --test`, TEST view
**16,410 → 14,911**, dropping **exactly** the 1,499 out-of-footprint rows: Idaho
1,141, MT/WY 124, CO/NM 40, Baja 10, other 184 (osm 1,460 / google_resolved 40). TEST
view + `places_test` = **14,911**, matching PROD's predicate structure (counts differ
by data). **Correction:** the objects-without-ledger drift was PROD-only — `120000`
/`130000` were already properly in TEST's ledger, so TEST had nothing to repair.

**Also #210:** `promote.ts` `DEFAULT_BATCH_SIZE` **500 → 25** (the stale "~10 s"
calibration replaced with the measured 60 s PROD ceiling; 500/100 fail `57014`).

### DRIFT — what remains open

- **No schema drift** between TEST, PROD, and `main` on the export view — all three
  now carry `180000–180400` (TEST via this session, PROD via #204/#209/#211, `main`
  via merge). PROD's ledger was reconciled (#204 + `migration repair`); TEST's needed
  no repair.
- **`photo_url` undeclared on existing Typesense collections** — retrievable, not
  filterable/facetable. In-place `collections.update` when wanted. `BACKLOG.md`.
- **`waste_disposal` reclassify unrun on PROD** (1,723 rows); **CA 8.33% manual_review
  unexplained**; **28 RIDB `/media` backfill errors** unverified. All in `BACKLOG.md`.

## 2026-08-10 (late) — six-state OSM camping corpus COMPLETE on PROD + live in search

This is the current corpus truth. Every number below was **re-measured against
PROD read-only, 2026-08-10** `[queried PROD]`; the per-state dispersed figures are
ISO-area Overpass counts that sum exactly to the DB total.

**PROD corpus, now:**

| metric | value |
|---|--:|
| `source_record` total | **28,817** |
| — `is_active = true` | 20,750 |
| — `is_active = false` (six-state trim) | **8,067** |
| `master_place` total | **20,904** |
| `master_place_search_export` (view-visible) | **16,661** |
| Typesense `places_prod` docs | **16,661** |

`source_record` by source (all / active): osm 13,804 / 13,804 · nps 4,837 / 3,466 ·
ridb 3,961 / 2,519 · parks_canada 3,078 / **0** · google 1,863 / 948 · bc_parks 8 / **0**.
The six-state trim deactivated the two Canada sources entirely and the out-of-scope
tail of the US sources. `master_place_search_export == places_prod == 16,661` end to
end — the search index exactly mirrors the export view (dispersed 2,855, campground
5,369 match per category).

**Six-state OSM camping ingest COMPLETE (CA · UT · WA · AZ · OR · NV).** Every state
ingested via `--source osm --iso US-<st> --families camping`, `overpass-api.de`
pinned with a ≤7-day `timestamp_osm_base` assert, predicted = actual on every state,
materialized at `ER_APPLY_BATCH_SIZE=25` (PROD's 60 s `statement_timeout` kills 100
and 500), search-synced to `places_prod`. **Dispersed camping per state
(ISO-area, distinct) — these sum to the PROD `osm dispersed_camping` total of 3,125:**

| CA | UT | WA | AZ | OR | NV | **total** |
|--:|--:|--:|--:|--:|--:|--:|
| 757 | 893 | 682 | 270 | 508 | 15 | **3,125** |

> **A radius spot-check is NOT a state total.** An earlier `location:(lat,lng,150 km)`
> interior sample read UT 373 / WA 327 / OR 156 / NV 2 — large undercounts. The
> ISO-area counts above are authoritative (they close exactly on the DB total).

**Six-state trim applied on PROD** — 8,067 `source_record` rows `is_active = false`
(the item predicted 8,064). **`reference_trips.is_active` applied** — `la-to-deadhorse`
and `dawson-vancouver-cassiar` are `is_active = false` (retired from listings; both
still URL-reachable, Cassiar still FROZEN); `la-to-portland` stays active.

**RIDB Route A imagery — live, count UNVERIFIED.** 1,622 `ridb` source_records carry a
promoted `normalized_payload.photo.url` (nps 4,451; all sources 6,073) `[queried PROD]`.
A **"5,256 photo-emitting tiles"** figure was asserted but matches none of these — flagged,
not adopted. Note `master_place_search_export` has **no photo column**, so no photo
reaches search yet (the lateral is backlogged).

### DRIFT — what remains open (as of this writing)

- **No open schema drift** between TEST, PROD, and `main` from this session's work.
- **`waste_disposal` reclassify unrun on PROD** — the #202 code fix is on `main`, but
  the 1,723 pre-existing mis-mapped `dump_station` rows still carry the wrong category
  (data cleanup, not code). `BACKLOG.md`.
- **`promote.ts` calibration stale** — its comment cites a "~10 s" ceiling and
  `DEFAULT_BATCH_SIZE = 500`; PROD's real ceiling is 60 s and 500 fails there. Backlogged.
- **CA 8.33% manual_review rate unexplained** — higher than AZ (4.4%) / TEST (3.6%);
  post-placeholder-fix, so it is genuine ambiguity, cause not established. Backlogged.
- **28 RIDB `/media` backfill errors** still unretried, shape UNVERIFIED. Backlogged.

## 2026-08-10 — three PRs merged; TEST fully validated for the four-state pattern

Four merges today, one long TEST validation, one PROD write by a parallel
session. **No PROD data written by this session** — everything on PROD is
either from earlier (#196/#197/#198) or from the parallel havana session
that executed Part 1 of the six-state trim.

### The three PRs that landed on `main`

- **#200 — matcher placeholder-name fix.** `isPlaceholderName()` in
  `data/entity-resolution/matcher.ts` forces `name_similarity = 0` when
  EITHER side of `scoreMatch` is a fabricated placeholder (`"Unnamed <cat>"`
  from OSM's `inferName` fallback, plus a small allowlist for BLM
  designations `"Designated Campsite"`, `"Designated Walk-In Campsite"`,
  `"Campsite"`). Zero for both sides prevents the pathological
  `jaroWinkler("Unnamed dispersed camping","Unnamed dispersed camping") =
  1.0` from lifting the blended-confidence formula into `manual_review`
  at 200-400m separation. Regression guard on real-name pairs is
  identical to prior behaviour (measured — `Willow Flat ↔ Willow Flat` at
  60m still scores 0.70 exactly). 9 new tests; full data suite 275/3.

- **#201 — six-state trim + placeholder-fix TEST diagnostics.** Nine
  read-only TEST-guarded scripts + a paired apply/undo for the placeholder
  rewrite. Every script fails-closed on wrong project ref; every write is
  paired with an undo. Groups: Phase 3 PROD scope-narrowing (5 scripts),
  six-state trim baselines (4 scripts), TEST-side placeholder rewrite
  (7 scripts including `apply-placeholder-rewrite.ts` +
  `undo-placeholder-rewrite.ts` + `verify-rewrite-postconditions.ts`).

- **#202 — OSM tag corrections + `--iso` / `--families` flags.** Three
  commits: (a) `amenity=sanitary_dump_station → dump_station` correction
  (the actual RV-oriented tag), removing the previous `waste_disposal →
  dump_station` mis-mapping, plus two new fetch predicates
  (`tourism=camp_site + backcountry=yes` and `+ informal=yes`); (b)
  `--iso US-<state>` and `--families camping,water_san,...` CLI flags,
  wired through `manual.ts` into `osm.ts`, mutually exclusive with
  `--bbox`; (c) `DEFAULT_FAMILIES` drops `shops` (retail measured
  30-45% brand/hours completeness on UT+NV — sparse enough that Google
  Places is the correct source for retail; `shops` stays opt-in via
  `--families shops`). 22 osm tests + 9 new builder tests.

### PROD Part 1 (reference_trips.is_active): DONE by the parallel havana session

**Not by this session.** Between STOP #1 (2026-08-09 evening) and 2026-08-10
02:00 UTC, the `work/six-state-trim` branch in the `havana` worktree (a
parallel Claude session) executed Part 1 step 6 of the six-state trim on
PROD:

- Applied migration `20260810120000_reference_trips_is_active.sql` to
  `nqzeywzcowujzyegxbsr` — the `is_active boolean default true` column
  now exists on PROD.
- `UPDATE public.reference_trips SET is_active = false WHERE id IN
  ('la-to-deadhorse','dawson-vancouver-cassiar')` — both rows now
  `is_active=false`, both updated at the same microsecond timestamp
  `2026-08-10T01:52:40.76769+00:00` (single-statement UPDATE signature).
  `la-to-portland` untouched (`updated_at=2026-07-25`).
- **Payload byte-integrity preserved.** Cassiar's payload SHA
  `46a17cbb421208f7fceb3c49f2023492f0d54f54a6e95c5d9231c61bc8162b82` —
  matches the frozen-Cassiar SHA recorded in
  `docs/decisions/2026-07-25-reference-trips-db-first.md`. Freeze rule
  respected (the boolean flip is not a touch of the payload column).

**Part 2 (source_record trim + view migration + `search:sync`) has NOT
been executed on PROD.** `source_record.is_active = true` still returns
20,384 on PROD (all rows active), and `master_place.max(updated_at)` is
still `2026-07-12T19:57:09Z` — nothing recomputed since #196. See
BACKLOG.

### The OSM tag defect the correction addresses

Discovered 2026-08-09 during a read-only PROD audit; fixed on `main` via
#202. **The corrected mapping is on `main` but PROD's existing data
predates it — no cleanup was run today.** Details:

- `amenity=waste_disposal` was mapped to `dump_station` in
  `data/ingestion/sources/osm.ts` (pre-#202). In OSM's tag semantics,
  `waste_disposal` is a **municipal trash bin**, not an RV sanitary
  station. **1,723 PROD rows** were misclassified as `dump_station`
  under this mapping `[queried PROD 2026-08-09]`.
- Sample of 20 of those 1,723 rows: **0 were real dump stations.** Every
  sampled row was a trash bin at a park entrance, gas station, or urban
  street corner.
- The actual RV-dump-station tag `amenity=sanitary_dump_station` was
  **never requested by any Overpass query** in the adapter's history
  before #202 — the mapping table pointed at the wrong tag and the fetch
  predicate table left the right one out. Both fixed in a single
  commit (`b8dcabd`).
- `tourism=camp_site + backcountry=yes` (and `+ informal=yes`) were
  **never fetch predicates**; the adapter fetched only bare
  `tourism=camp_site` and lost the backcountry/informal split. #202 adds
  both as explicit fetch clauses so dispersed sites land on ingest
  without depending on the category-mapping refinement path
  (`inferCategory`'s existing `backcountry=yes` check now has predicates
  that actually cause those rows to be fetched).

### The placeholder-name matcher defect the fix addresses

Discovered 2026-08-10 during ER outcome analysis on the UT camping
ingest; fixed via #200. Root cause + measured impact:

- OSM's `inferName` at `data/ingestion/sources/osm.ts:112-118` fabricates
  `"Unnamed <category>"` when a source_record has no name tag. Two such
  fabricated strings collide at `jaroWinkler = 1.0`. Combined with same
  category (`dispersed_camping ↔ dispersed_camping = 1.0`), the blended
  formula `0.4·distance + 0.4·name + 0.2·cat` **clamps at exactly 0.600**
  for any pair >100m apart (distance_score = 0). That's the
  `manual_review` floor, so every placeholder-collision pair queued for
  human review even though the pins were 200-400m apart and clearly
  distinct BLM sites.
- **Measured 2026-08-10** on the UT camping ingest (2,176 fresh rows):
  945 queued for `manual_review` (**43%**). 22 of 30 sampled rows were
  pinned at conf = 0.600. 27 of 30 had identical
  `"Unnamed dispersed camping"` or `"Designated Campsite"` placeholder
  names on both sides.
- The fix (#200) forces `name_similarity = 0` when either side is a
  placeholder — same-source pairs fall below 0.6 → `new_master_place`
  (correct for distinct pins in a BLM loop); cross-source pairs with
  dist ≤ 100m + cat ≥ 0.8 now satisfy the pre-existing `close_nameless`
  guard.

### The 521-row placeholder rewrite applied to TEST

Applied via `data/scripts/apply-placeholder-rewrite.ts` (in #201). Consumes
`/tmp/dryrun-classification.json` (also durable-backed at
`~/.config/overlander/backups/dryrun-classification-20260810-052514.json`).
Idempotency guard: proceeds only when SR is unlinked AND matching pending
`place_match` still exists.

- Planned 521 / skipped 0 / master_places created **521** / errors 0.
- Delegates to the standard `apply_match_outcomes` RPC → the RPC creates
  each MP, updates each SR's `master_place_id`, inserts a confirmed
  `place_match` at 0/1.0/1.0/1.0, and calls `recompute_master_place`. No
  bespoke insert logic.
- **The 424 legitimate reviews were preserved BYTE-IDENTICAL.**
  Verified: all 8 fields (`source_record_id`, `master_place_id`,
  `distance_meters`, `name_similarity`, `category_compatibility`,
  `combined_confidence`, `match_method`, `status`) match a pre-flight
  snapshot on every one of the 424 rows. Zero field mismatches, zero
  missing.
- **Reversible.** `undo-placeholder-rewrite.ts` reads the rewrite mapping
  and reverses: unlink SR → delete new MP (cascades confirmed PM) →
  restore pending PM with recorded score components. Mapping durable at
  `~/.config/overlander/backups/rewrite-mapping-20260810-052514.json`.

### The 4-state TEST OSM camping ingest — pattern proven

Under both fixes (#200 matcher + #202 flags), a serial WA→OR→NV ingest
run + a UT ingest earlier the same day landed all four states:

| state | predicted | fetched | inserted | wall-clock |
|---|--:|--:|--:|--:|
| UT | 2,176 | **2,176** | 2,176 | 132s |
| WA | 1,224 | **1,224** | 1,224 | 101s |
| OR | 1,504 | **1,504** | 1,504 | 171s |
| NV | 168 | **168** | 168 | 14s |
| **Total** | **5,072** | **5,072** | **5,072** | ~7 min + gaps |

Predicted-to-actual match is **exact on every state**, zero errors, zero
spillover into non-camping categories (all 5,072 landed as `campground`
or `dispersed_camping`). Wall-clock is dominated by the Overpass area
query, not the Supabase upserts.

**Post-materialize ER outcomes on the 2,896 WA/OR/NV rows** (UT
materialized earlier under a rewrite, not directly comparable):
- new_master_place: 2,774 (**95.8%**)
- manual_review: 105 (**3.6%**) ← was 43% pre-fix on UT
- auto_link: 17 (0.6%)
- amenity_rollup: 0
- errors: 0

**Manual_review rate dropped 43% → 3.6% — 12× reduction.** The remaining
3.6% is real-named ambiguity that a human should look at, not
placeholder-collision noise.

### DRIFT — what remains open

**No open schema drift between TEST, PROD, and any staged branch as of
this writing.** Both prior drifts closed today:

- **~~RIDB widening (PROD ahead of `main`).~~** CLOSED — #198 merged
  2026-08-09; `main` and PROD RPC agree.
- **~~`reference_trips.is_active` (TEST ahead of PROD).~~** CLOSED — the
  parallel havana session applied the migration to PROD and flipped the
  two out-of-scope rows between STOP #1 and 2026-08-10 02:00 UTC.

**Two categories of open work, tracked in `BACKLOG.md`:**
1. **Six-state trim Part 2 unrun on PROD** — 8,064 out-of-scope
   source_records + view migration + `search:sync`. Independent of every
   code branch; can run when authorized.
2. **1,723 PROD `waste_disposal` rows still miscategorized** — the fix
   is on `main` (#202), but PROD data predates it. Needs a reclassify
   pass (small, mechanical UPDATE).

## 2026-08-06 — NPS corpus imagery LIVE end-to-end on PROD (#196 + migration + backfill)

#196 merged **and** the migration is applied to **both TEST and PROD** and the
backfill run on **PROD** — a materially different state from "merged." The Route A
chain is live end to end `[queried PROD 2026-08-06]`:

- the nps ingester promotes `source_record.normalized_payload.photo` (`url`,
  `altText`, `credit`) — Route A, no `master_place` column;
- backfill applied to PROD: **4,451 of 4,837** nps rows carry `photo.url`, converged
  and idempotent;
- `pois_along_corridor` returns `nps_photo_url` (migration on TEST **and** PROD,
  verified by query on both);
- `mapMasterPlaceRow` maps it → `photoUrl`; the card renders any `photoUrl`
  regardless of source — **no render change**;
- verified on PROD: the Portland corridor query returns the "Voices" and "Honoring
  our Salmon" artworks with `nps.gov` URLs (**9 of 10** tiles; River Guardian on the
  Willamette has no NPS image — correct, not a failure).

Architecture: `docs/architecture/place-render-model.md` §4a (Route A — corpus-native
photo, and why `normalized_payload` not a `master_place` column).

**THE GAP — existing trips do NOT benefit.** A rest day's `segmentSuggestions` are
BAKED at insert by `insertRestDay` and stored in the payload; the scroll renders them
from storage with **no live re-query** `[read: repository.ts insertRestDay →
fetchCorpusForSegment → mapMasterPlaceRow]`. So PROD `b97d06bf` day 4 (created
2026-08-03) has 10 tiles with **NO `photoUrl` key at all**, though **9 of the 10** are
nps master_places whose corpus photo is populated on PROD today `[queried PROD]`. A
fresh rest-day insert would carry them; the stored tiles need regeneration — not a code
fix (the mapping is correct and live). **This is the SECOND instance of the
`milesFromStart` pattern** — data baked into payloads, correct going forward, stale in
what already exists (see §`milesFromStart` below; `BACKLOG.md` §Refreshing stored
suggestions).

## 2026-08-05 — day-bounds camera fit SHIPPED (#194, on `main`)

The day-activation camera now **fits the day's plottable places** instead of a fixed
`zoom: 8`. Architecture: `docs/architecture/map-day-render.md` §2.

- **The bug (present-but-suppressed, not absent):** fixed ~30px icons + a zoom too
  far out for the spread + pool declutter combined so a Portland rest day's 10 tiles
  spanning ~66px at zoom 8 rendered **2 of 8 in-viewport** features — source
  populated, both layers in the style, filters passing `[measured 2026-08-05]`.
- **After:** the rest day frames at **zoom 10.37** and renders **10 of 10**; a
  round-trip day (13 tiles) fits z9.93, 13/13; a coordless day falls back to
  `flyTo(start, zoom 8)` `[measured, synthetic fixture]`.
- **Fits PLACES, not endpoints** (endpoints degenerate to a point on rest/round-trip
  days); fits on every day incl. day 1; same `[activeDay]` effect → same settle
  signal; `maxZoom 14` clamps the zero-extent box; padding measured intrinsically.
- **Does NOT solve dense days.** 263 tiles in downtown LA go **2 → 124** rendered —
  substantial, and the measured floor for the clustering gap (`docs/BACKLOG.md`).
- On `main`; **not yet confirmed deployed to Vercel Production**.

## 2026-08-05 — two-layer category map SHIPPED (#192, on `main`)

The OPEN direction below is now RESOLVED and built. **Keep the layer, add category
filtering** — the ≤10-DOM-marker revert is off the table. #192 (merged) replaces
#188's uniform `active-day-places-circles` with **two symbol layers over the one
`active-day-places` source**: POOL (browse-dot glyphs) below, PROMINENT (pin
glyphs) above, split by a complementary `prominent` filter, with 9 category toggles
narrowing both. On `main`; **not yet confirmed deployed to Vercel Production**, and
still behind the Google-licensing gate before it should be a user-facing surface.

- **Discriminator, no schema change:** `prominent = curated OR fromWaypoints`,
  computed in `placesToFeatureCollection` (`removable` is placePool's waypoint
  marker). `lib/trips/types.ts` untouched.
  - **KNOWN LIMITATION (accepted):** on forks of `la-to-deadhorse` the 93
    editorially-authored waypoints promote to prominent — nobody added them. Correct
    on every trip a user can create today (generation writes `waypoints: []`); wrong
    only on de-linked legacy trips, still URL-reachable.
- **Image pipeline (new machinery — nothing rasterized SVG before):**
  `place-layer-icons.ts` builds 18 icons (SVG→data-URI→`addImage`, pixelRatio 2) at
  map load. Reuses BOTH existing sets, no third invented: pin stroke set lifted to
  `category-map-icons.ts` (`PIN_STROKE_SVG`, shared with the DOM pins); pool = filled
  `CategoryIconV2` art; colors from `--cat-*` tokens (read at register time).
- **Collision — decided by looking** (dense 263-tile day, both binaries): per-layer,
  not one flag. Pool DECLUTTERS (`icon-allow-overlap: false`); prominent ALWAYS
  renders (`true` + `ignore-placement`) so the important, always-small set is never
  the icon Mapbox hides.
- **Toggle panel is a TEMPORARY TEST HARNESS** (`place-category-toggles.tsx`), 9
  checkboxes, center-top of the map, marked in-code. Ships so real trips can be
  tested; the real filter UX is a separate decision. Delete with that surface.
- **Verified in-browser** (headless Chrome + CDP): both layers, complementary split,
  toggle removes from both, #189 marker-click still fires `trip:placeFocus`, pins/
  dots/route unaffected. Gates green (`typecheck` + `next build`), 12/12 unit tests.
- **Still GATED by the UNANSWERED Google Places licensing question** (below /
  BACKLOG) before this can be a user-facing surface.
- **No dense TEST instrument exists** — the dense screenshot used a synthetic
  `reference_trips` row, since deleted; standing TEST trips are sparse. Recorded in
  `docs/BACKLOG.md`.

## 2026-08-05 (late) — curated finding reframes the map direction (~~OPEN~~ RESOLVED above)

Three measurements today, taken for different reasons, converged and change the
direction of the shipped map work (#188/#189). Position only; the open direction
and the four backlog items live in `docs/BACKLOG.md` §Plot-day-detail.

1. **Curated counts are TINY** — max curated on any day of any trip is **4**
   `[queried TEST+PROD, 2026-08-05]`. `4534add5` day 1 = a **263-tile pool with 4
   curated**. The scroll features curated inline and collapses the rest behind
   "Explore N more", so the map plots the whole pool while the scroll shows a
   handful — which is also why **#189's marker→card no-ops on most markers**.
2. **`curatedMode = false` is LIVE, via REST DAYS** — not legacy-only. A layover
   has no LLM key stops by construction, so every rest day is `curatedMode = false`;
   PROD **`b97d06bf`** (current pipeline, `generationInput` present) has **8 of 15
   days as rest days**, each pool ≤ `REST_DAY_SUGGESTION_CAP = 10`, rendered fully
   inline `[queried PROD, 2026-08-05]`.
3. **The 386-tile blowup is LEGACY-only** — every whole-trip zero-curated trip
   (`yotrippin-demo`, `alaska-south-*`, `dawson-vancouver-cassiar`) is
   `generationInput = n`, pre-current-pipeline.

**Pattern worth naming:** this is the THIRD independent measurement to land on the
**current-pipeline-good / legacy-patchy** boundary, after coords coverage
(`docs/proposals/2026-08-04…` §Coords) and category coverage. The current
generation produces well-formed tiles (coords, categories, curated key stops);
legacy fixtures are patchy on all three. **Scope map decisions to current-pipeline
shapes, not legacy fixtures.**

**~~OPEN~~ RESOLVED (PR #192, above):** keep the layer, add **category filtering**
(the two-layer symbol map + `addImage` pipeline). The ≤10-DOM-marker revert was
rejected. **Still gated by an UNANSWERED Google Places licensing question**
(displaying `google:`-sourced tier-2 tiles on a non-Google map) before it becomes a
user-facing surface — also in BACKLOG.

## 2026-08-04 → 08-05 — plot day-detail places on the map: SHIPPED (both halves)

Scoped then built in three PRs, all merged and **verified present on `main` by
grep, not by the merge banner** `[gh pr list + git grep of the symbols on
origin/main, 2026-08-05]`. The full scoping — the load-bearing four, the
per-source coords table, the find-nearby evidence, the tripwire, every
UNVERIFIED — lives in ONE place:
`docs/proposals/2026-08-04-plot-day-detail-places-research.md`. Not restated here.

- **#187** — the scoping doc (above) + both measurement harnesses relocated out of
  the gitignored, workspace-only `.context/` into `web/scripts/`
  (`scoping-daydetail-pool.mjs`, `scoping-daydetail-coords.mjs`) so they survive.
- **#188** — the tile **GeoJSON point layer** (`active-day-places-circles`), fed by
  the active day's `placePool`, keyed on `activeDay`, coords-guarded
  (`web/src/lib/trips/place-layer.ts`). Plot-only. Provisional uniform dot style;
  deliberately no category vocabulary. Also carried a **RUNBOOK correction** now on
  `main`: a real map DOES render under `next dev` — the token comes from
  `.env.local`, which `next dev` loads alongside `.env.development.local` (see
  `CLAUDE.md` §RUNBOOK; the old "token absent" gotcha is scoped to `--env-file`
  verify scripts).
- **#189** — the **interaction**: a marker click dispatches `trip:placeFocus`; the
  day column scrolls that card into view and highlights it (`data-place-id` on a
  `PlaceSlot` wrapper + `querySelector` + `scrollIntoView`, mirroring find-nearby).
  Details button unchanged. **No `continuous-day-stack` guard needed** — markers
  are active-day-only and the in-day scroll leaves `?day=` stable (browser-verified).

**SHIPPED ≠ complete.** Two things are recorded in `docs/BACKLOG.md`
§Plot-day-detail follow-ups, NOT here: the **EXPAND-ON-FOCUS** gap (collapsed-cluster
markers are a graceful no-op) and the deliberately-unwired **reverse direction**
(card→marker highlight).

## 2026-08-03 — day-insert UX shipped (#182 · #183 · #184)

Three PRs merged this week, all on `main`, nothing stranded `[gh pr list +
git grep for the symbols on origin/main, 2026-08-03]`. My branch's content is
fully in `main` (empty diff vs `origin/main`). The only open PR is **#24** (May,
live-weather salvage — unrelated).

- **#182** — `splitDay` (subdivide a leg A→B at an interior point M into A→M /
  M→B). Merged 2026-08-01; at merge it was **wired to nothing** — repo + routing
  machinery only, no action or UI. This session's STATE was four days stale and
  did not know #182 existed — the day-insert work built directly on it.
- **#183** — doc-only: softened the Paper MCP RUNBOOK gotcha to what was measured.
- **#184** — **the day-insert feature.** Wires #182 to an action + UI and builds
  "add a rest day" on the same machinery.

### SHIPPED on `main` (#184)
- **Two day-level kebab items** on each day in the live corridor view, gated on
  `canEdit` (user-owned editable UUID trips), **no feature flag**. The kebab is
  NEW — the old day-level `DayHeader` kebab (rename/delete/reset) is orphaned
  (§below), so there was no host to add to.
- **Split this day** → a `BottomSheet` split-point picker listing the day's own
  interior stops (`splitEligibility`), **disabled with a reason** when a day has
  no interior stop (layover / no route / no stop). Calls `splitDay` via
  `splitDayAction` behind the `checkNotFrozen` rail.
- **Add a rest day** → `insertRestDay`: a sparse `start === end` layover (miles 0
  / driveHours 0, no spine), nearby corpus suggestions distance-ranked + capped
  at 10, one guarded write, **zero route calls**. `insertRestDayAction`, same rail.
- **Render home** — a layover renders its suggestions inline (an `isRestDay`-gated
  "Nearby" block in `DayDetailCorridor`). Without it the tiles are stored and
  never seen — they are non-curated with no corridor spine to bucket under.
  Observed 0/4 → 4/4 against a 2/7 normal-day control `[renderToString probe,
  2026-08-03]`.
- Actions use **no `getUser()`** — RLS enforces ownership at the write (a
  non-owner reads null → not-found), matching `addWaypointAction`. The handoff's
  "getUser()" was intent, not the shipped pattern.
- Mechanics: `docs/architecture/itinerary-model.md` §6 (write) and
  `docs/architecture/place-render-model.md` (the Nearby render home). Follow-ups:
  `docs/BACKLOG.md` §Day-insert.

### NOT verified — four browser-only checks (carried to `docs/BACKLOG.md`)
No browser/preview was reachable this session; server-side + `renderToString` was
the ceiling. **Unobserved:** map draws the rebuilt split polyline / no phantom
layover segment / per-day highlighting; slideup re-render after `router.refresh()`
when day ids shift across the whole tail (**structural**, not cosmetic — and
`deleteDayAction` shares the same path, so a gap may be two things); kebab↔`heroTag`
overlap; edit-mode drive connector on a layover.

### Deploy status — `[UNVERIFIED]`
#184 is on `main`; whether Vercel Production has redeployed since is **not checked
from here**. The kebab carries no flag, so it is live on any `canEdit` trip
wherever #184 is deployed. Not added to §LIVE ON PROD until deploy is confirmed.

## 2026-07-31 — planning scope narrowed; out-of-region trips de-linked

**Three PRs merged, all on `main`, nothing stranded** `[gh pr list, verified
2026-07-31 — each confirmed present on origin/main by grep, not by the merge
banner]`. The only open PR in the repo is **#24** (May, unrelated).

- **#176** — `/api/places/details` **chunks instead of truncating**. No id is
  dropped. `BATCH_SIZE = 40` is now a fan-out chunk size, not an input cap.
- **#177** — the three out-of-region reference trips de-linked; `4534add5`
  adopted as the standing instrument (this section).
- **#178** — **trip creation restricted to the six-state planning region**, in
  code. Two commits: the constraint, then a correction making the invariant
  actually compiler-enforced (see §PLANNING REGION below).

**Scope is now CA, NV, UT, AZ, WA, OR.** Three reference trips sit outside it and
were test fixtures serving as product content. Their in-product pointers are gone.

- **DE-LINKED, not retired and not deleted.** No row removed, nothing made
  unreachable. `reference_trips` is still anon-readable, so
  `/trip/la-to-deadhorse` renders for anyone with the URL. Deleting rows is a
  separate decision and a separate authorization.
- **Pointers found and removed — two, not the one expected.** The `/trips` empty
  state (`app/trips/layout.tsx`) *and* the home browse link
  (`components/plan/entry-scene.tsx`). **`alaska-south-final` and `yotrippin-demo`
  had zero pointers** — de-linking them was doc-only.
- **Both surfaces already carried a wizard CTA**, so neither goes empty; the
  wizard link is simply now the only one. The `/trips` copy changed from "Start by
  forking the LA to Deadhorse reference itinerary" to "Plan your first trip."
- **`REFERENCE_TRIP_IDS` deliberately NOT changed** (duplicated in
  `app/trip/[id]/page.tsx` and `app/@modal/(.)trip/[id]/page.tsx`). It is not a
  link table — nothing navigates through it. It marks reference *behaviour*
  (`isReference` → fork CTA, forces `canEdit` false); reachability comes from
  `getTrip()`. Removing the id would strip the trip's reference treatment while
  leaving it reachable — a behaviour change dressed as a de-link.
- **`dawson-vancouver-cassiar` untouched.** Out of region, but FROZEN by an
  earlier deliberate decision; every guard stands.
- **NEW STANDING INSTRUMENT: `4534add5-3787-4b5f-ade6-584ce0fc27e7`** (PROD
  `public.trips`, San Diego → Portland, 11d). Healthy `dayRoutes` shape, 770
  tiles, day 2 over the MAX_IDS cap at 45, two round-trip days, `curatedMode`
  true. **RLS-scoped, so NOT anon-readable** — browser DOM measurement now needs a
  minted session. Density is lopsided; its mean is not representative. Shape
  re-verified in a second pass before recording: `docs/DATA_INVENTORY.md`.
- **Two cases lost their default instrument:** the 91-id / three-batch MAX_IDS
  case and the `curatedMode = false` render mode. Both probably want a synthetic
  fixture. Recorded, not built — fixture design in `docs/BACKLOG.md`.

### PLANNING REGION — the constraint is in code, not just policy (#178)

- **One constant, one place:** `web/src/lib/plan/planning-region.ts` holds
  `PLANNING_REGION_CODES` and the display string. Widening the region is a
  one-line diff there; nothing else hardcodes a state code `[grep, 2026-07-31]`.
- **Codes, not a bounding box** — deliberate. A box over the six states contains
  **Idaho entirely**, western Montana, western Wyoming, and a strip of
  Baja/Sonora. (It does **not** meaningfully contain Colorado or New Mexico —
  UT/AZ's eastern border *is* CO/NM's western border, the Four Corners meridian
  at −109.045°. An earlier claim that it leaked into those two states was wrong;
  see `docs/LOG.md` 2026-07-31.)
- **The region STOPS at `expeditionToGenerationInput`** `[read source]`. That
  mapper builds each `Anchor` field by field and does not copy `region`, so it
  never reaches `GenerationInput` or anything under `lib/itinerary/`. It exists
  to be *checked* before generation, not to be planned with.
- **The check lives in `validateExpeditionForm`, not in the action.** A
  deliberate deviation from "add a third guard in
  `generateExpeditionTripAction`": the action calls the validator, so one
  implementation covers both the client gate and the server backstop.
  `generateExpeditionTripAction`'s guards, in order, are **flag → sign-in →
  `validateExpeditionForm`** `[read source]`; there is no fourth guard before
  spend.
- **Strict by design:** a Mapbox suggestion with no `region_code` is dropped
  too — we admit only what we can positively prove is in region. The failure
  mode is **silent** (no error, no log), so if places start vanishing from the
  autocomplete, an absent `region_code` is the first thing to check.

### DECIDED BUT NOT BUILT (current, as of 2026-07-31)

Decided means the shape is settled and the next person can build it without
re-litigating. Full entries in `docs/BACKLOG.md`; one line each here.

- **Badge gate on `placeId`.** Gate the "yoTrippin Verified" badge on whether the
  tile carries a `placeId`. Scoped; the enrichment-gated alternative was
  **rejected on measurement** (506 ms flicker) and on provenance.
- **Synthetic fixture replacing the de-linked instruments.** One fixture — a
  ~90-tile `placeId`-bearing day with no curated flags — covers both the
  three-batch chunking case and `curatedMode = false`.
- **Remove the orphaned `${name}Lat` / `${name}Lng` hidden inputs** in
  `location-autocomplete.tsx`. Dead since #166; zero consumers `[grep across
  both workspaces incl. `web/scripts`, 2026-07-31]`. Deliberately left in #178 as
  unrelated cleanup.

### PARKED (current, as of 2026-07-31)

Parked means blocked, deferred, or waiting on a decision that is **not** made.

- **`fix/generated-day-miles`** — new generations still write bad
  `milesFromStart`; nothing renders them since #170. Data-quality debt.
- **`USE_FEDERATED_POIS` is unset**, so the browse route's corpus merge never
  runs. Whether it is set in **Vercel Production is `[UNVERIFIED]`** — no
  committed file records it.
- **Unbounded request size at `/api/places/details`** (introduced by #176).
  Nothing can currently send an absurd request, but that is a property of the
  client, not the endpoint.
- **`yotrippin-demo` spine/label divergence** — cause unestablished; not
  checkable from source.
- **"yoTrippin Verified" still has no definition.** The badge gate above is
  mechanical; what the label *means* remains an unmade product decision.

## 2026-07-28 — ONE CAUSAL CHAIN, plus one separate thread

`[gh pr view #153–#175, 2026-07-28]` — nine PRs merged today (**#165–#173**);
**#159–#164 were yesterday**; ~~#174/#175 do not exist~~ **— true when written;
#174/#175 merged later on 07-28 and 07-30 respectively, and #176–#178 on 07-31
`[gh pr list, 2026-07-31]`.** Nothing from today is open
or stranded. The only open PR in the repo is **#24** (May, unrelated). Verified
rather than assumed — #153 was once taken as merged a day early, and **#172
merged mid-correction today**, stranding a fix on its branch until it was
cherry-picked as #173.

**Read this as a chain, because it was one.** Each link caused the next:

1. **The wizard swap completed** (#166 4b, #167 4c) → the expedition wizard is
   the only creation path, and generation went live on PROD.
2. **Generated trips started landing in `public.trips`** — three of them, all
   created 2026-07-28 by the same owner.
3. **The `milesFromStart` pricing pass discovered them**, which **falsified the
   recorded claim that no PROD trip carried stored miles** (true when measured
   2026-07-26; the table held no generated rows then).
4. That turned a TEST curiosity into a **live production defect** and settled
   option (a) vs (b) **in favour of (b), the read-path fix**.
5. **(b) shipped as #170.**

**MAX_IDS ran separately** — measured, scoped, and deliberately not built *that
day*; **shipped 2026-07-31 as #176**.

### SHIPPED (live on `main`)
- **#165** — no date-pin toggle on start/end destinations.
- **#166 (4b) / #167 (4c)** — legacy 5-step wizard **deleted**, trips-domain
  residue unwound. `/plan` 404s.
- **#170 — the read spine projects coordinates, never stored miles.** Ordering
  and labels now come from `positionPlacesOnDay`; round-trip days claim **no**
  mile (their driving is absent from `routePolyline`); same-mile ties break on
  `offsetMi`, which at a polyline-end clamp is distance past the terminus.
  Ships with `web/scripts/verify-projection-delta.ts`. Mechanics:
  `docs/architecture/itinerary-model.md` §2c-i.
- **#168 / #169 / #171 / #172 / #173** — doc passes and corrections, including
  the three-site correction of the stale "no PROD trip stores `milesFromStart`"
  claim (#171) and two rounds of MAX_IDS corrections (#172, #173).

### DECIDED BUT NOT BUILT
- **~~MAX_IDS = 40 → chunk server-side. Measured, scoped, tripwired, unbuilt.~~
  BUILT AND MERGED as #176 on 2026-07-31.** `parsePlaceIds` no longer slices;
  the route chunks all ids at `BATCH_SIZE = 40`. The cap was **not** raised and
  nothing was reordered by proximity, as the scoping required. Kept here struck
  rather than deleted because the reasoning still governs the next change to
  this route. **One consequence to know about: removing the `.slice` removed the
  only bound on request size** — see `docs/BACKLOG.md`.

### PARKED
- **`fix/generated-day-miles` — LOWER urgency after #170, but not closed.**
  Both halves matter: **nothing renders the bad miles any more** (the read path
  stopped trusting them), **and new generations still write them**. That is
  data-quality debt rather than a render bug. See PARKED below and
  `docs/BACKLOG.md`.

## MERGED EARLIER (2026-07-26 → 07-27)

The previous STATE was stale by five PRs and carried a "stale below this line"
marker. That marker is now discharged — the entries below are reconciled from
`gh pr view` and `git log`, not carried forward.

- **#146 — continuous day-detail scroll (Design A, view mode).** The day-detail
  centre is a continuous river of days when NOT in edit mode; `ContinuousDayStack`
  IO-windows near-viewport days. Presentation layer only, zero diff to the
  day-partitioned model. `editMode` + Overview keep the single-day swap as a
  bridge, to be deleted in PR2.
- **#147 — `docs/architecture/place-render-model.md` Part 1.** What a place record
  carries vs what the day-detail card renders; §7 shape corrections; the
  disjoint-instruments caveat.
- **#148 — place-render-model Part 2.** The detail slideup is
  `map-detail-overlay.tsx` and renders directly from the dispatched payload — no
  fetch, no store, no loading state. Routing and Places are independent: a place
  that fails to enrich keeps its detour figures.
- **#149 — `fix(places/details)`: surface resolved-but-empty results.** One-line
  behaviour change: `if (rich)` instead of `if (rich && Object.keys(rich).length > 0)`,
  so a place that resolves with no rich fields is cached as hydrated rather than
  re-fetched forever.
- **#150 — corrected the "zero round-trips" claim.** Opening a detail costs zero
  round-trips when the tile is already hydrated (post-#149 that includes
  resolved-but-empty), one when it isn't. The original claim was scoped at the
  component; the fetch lives in the column.
- **#151 — `docs/architecture/generation-pipeline.md`.** First end-to-end trace of
  the expedition WRITE path: form → `preComputeFacts` → `generateAndAudit` →
  `bakeGeneratedDays` → `itineraryToTrip` → `attachHeroPhotos` → persist →
  `enqueueResolvedPlaces`.
- **#152 — `stretches.ts` stale-comment correction.** Comment-only, zero
  non-comment lines changed. Cherry-picked out of the parked `fix/generated-day-miles`
  because the hazard was live on `main` and shouldn't wait on a decision about the
  fix itself.
- **#153 — `docs/architecture/trip-creation-surfaces.md`.** The client half of
  trip creation, companion to `generation-pipeline.md` (#151, the server half):
  the wizard form and every input, what actually reaches the pipeline, the
  in-flight render, and the post-creation landing. Read-only — the form was
  **never submitted**, so every in-flight/error/landing claim is static code
  analysis and no duration is estimated anywhere. Three findings carried forward:
  - **No degradation signal reaches any component.** The action returns
    `{ ok, tripId, days, note? }`; the wizard reads `ok`/`error`/`tripId` only, so
    `note` and `days` are dropped on arrival. `note` keys off surviving structural
    violations, so the **missing-`GOOGLE_PLACES_API_KEY` case emits no signal at
    all**. There is no toast/banner/alert system anywhere in the repo to surface
    one.
  - **The live creation path is the LEGACY 5-step wizard, not this pipeline** — it
    has no feature flag and is the root page's primary CTA, while the expedition
    wizard is flag-gated with zero links. The anon `TRIPS` path is not a third
    surface; it is the legacy wizard's anonymous finalize branch. This is what the
    wizard-swap decision below acts on.
  - **A generated trip is neither editable nor findable** — `expedition-<base36>`
    is not a UUID so `canEdit === false`, and it is written to `reference_trips`
    while the listings query `trips` / filter `trip-`, so it appears in no listing
    on any surface.
  - Also recorded: the only timeout in the whole generation chain is
    `AbortSignal.timeout(8000)` on the Google fetch — nothing on the LLM call, no
    `maxDuration`, no error retry. `ENABLE_PLANNER_WIZARD`'s **production** value
    is `[UNVERIFIED]` (no `vercel.json`; dashboard env is not in source), which is
    weaker than the previously-recorded "prod never sets it."
- **#154 — `fix(db)`: enforce RLS and explicit grants on `mvum_roads`.** It was
  created by migration without `enable row level security` while every sibling
  reference table enables it. Migration `20260727120000_mvum_roads_rls.sql`: RLS
  on, zero policies, explicit revokes on the table and on `upsert_mvum_road`.
  Applied and catalog-verified on both projects.

## PARKED / BLOCKED

- **PARKED: `fix/generated-day-miles`** — pushed to remote, **unmerged, no PR**,
  remote tip `37faabb`.
  - **The decision it was awaiting has been made, and it went the other way.**
    Option (b) — fix the read path — shipped as **#170**. So this branch is no
    longer the pending choice; it is a separate, lower-urgency question.
  - **Nothing renders the bad miles now.** #170 pointed every read-path consumer
    at coordinate projection, so the stored field is inert at the surfaces that
    used to trust it.
  - **But new generations still write it.** Every trip created from here on
    accumulates an inflated `milesFromStart` that nothing validates. Data-quality
    debt, not a render defect — and the reason this stays open rather than closed.
  - Merge check `[2026-07-28]`: merges onto `main` with one **comment-only**
    conflict in `stretches.ts` (take main's paragraph); its 12 tests pass on the
    merged tree.
  - Carries (1) `web/scripts/check-payload-invariants.ts`, a
  read-only TEST-only measurement instrument, deliberately **not** in CI —
  baseline on `expedition-ms28y793` is 1/6 assertions passing; (2) a
  `where === "keyStop"` via filter + `placeId`-keyed role merge in `bake.ts`,
  12 unit tests, mutation-checked.
  - **Parked because the fix was measured and is small:** the via filter removes
    **~6%** of the geometry inflation (2.25× → 2.18× vs the direct line). The
    dominant term is key-stop vias being genuine off-route excursions in LLM
    emission order, which the filter does not touch. Numbers:
    `docs/architecture/generation-pipeline.md` §7.
  - **Its third component has already landed separately as #152** — the
    `stretches.ts` hazard-fix comment. The branch still contains that commit, so
    expect it to be a no-op on rebase. The `TODO(scope)` hazard it describes is
    now correctly documented on `main`.
  - No database was written. `expedition-ms28y793` is untouched and remains the
    only artifact of the unfixed pipeline.

- **The wizard swap — ALL FIVE code steps MERGED. Blocked on one missing PROD env
  var, not on code.** Every PR below is confirmed merged
  `[gh pr list --state all, 2026-07-27]` — not assumed; #153 was assumed merged a
  day early and was not.
  - **#159** — auth gate on `/plan/expedition`, both halves (page redirect +
    action `getUser()`). The flag check runs FIRST so a disabled wizard 404s
    rather than leaking its existence.
  - **#160** — write target moved from `reference_trips` to an owned
    `public.trips` row: `owner_id` from the session, `state: "active"`,
    `reference_id: null`, enforced by `trips_insert_owner`
    (`auth.uid() = owner_id`). Generated trips are now editable and findable.
  - **#161** — root CTA repointed to `/plan/expedition`.
  - **#162 (4a)** — de-linked the remaining legacy entry points (the `/trips`
    empty state and draft trip cards). **Deletes nothing.** Zero
    `<Link href="/plan">` remain in `web/src` `[grep]`.
  - **#163** — removed the TEST-only rail from the trip write, and **narrowed it
    to the `enqueueResolvedPlaces` call site** rather than deleting it. The trip
    insert is session-scoped and RLS-enforced, so the rail no longer described
    it; the corpus write is still service-role into a shared curated table, so
    the gate stays there. See BACKLOG §"Corpus capture on PROD".

- **PROD state — VERIFIED, not reported.** `[vercel env ls production +
  unauthenticated probe of the public alias, 2026-07-27]`
  - **`ENABLE_PLANNER_WIZARD` is set in Production** (1h before this pass) and the
    wizard is live: `GET /plan/expedition` returns **307 →
    `/auth/sign-in?next=/plan/expedition`**. With the flag off that path 404s
    (`notFound()` runs before the auth check), so the redirect is positive proof
    the flag is on AND the auth gate works on PROD.
  - **`ANTHROPIC_API_KEY` is NOT set in Production.** This is the ONE blocker to a
    first PROD generation — the action throws `missing_key` before any spend.
  - **`GOOGLE_PLACES_API_KEY` IS set in Production** (49d, Preview+Production).
    This matters: the feared interaction with the silent-degradation defect
    **does not apply** to the first PROD generation. Tier-2 resolution will work.
  - `NEXT_PUBLIC_NL_EDIT` remains unset — the intended prod end state, unchanged.
  - **`/plan` still mints on PROD**: `GET /plan` → 307 →
    `/plan/<id>/going`. The legacy route is fully live; #162 only removed the
    links to it, by design. Direct-URL entry still works — which is exactly what
    makes 4b safe to defer.

- **PR 4b MERGED (#166) — the legacy wizard is GONE.** Both gates cleared first:
  `ANTHROPIC_API_KEY` is set in Vercel Production, a PROD generation succeeded end
  to end, and the post-sign-in return was verified. 32 deletions — `app/plan/route.ts`
  + `app/plan/[id]/**`, 14 legacy-only components, `lib/plan/*` except `types.ts`,
  `lib/routing/day-suggestions.ts` + `suggestions-for-segment.ts`, and the smoke
  test for the last of those. `/plan` now 404s.
  - **Two orphans 4b created are still noted-not-acted-on:**
    `components/ui/checkbox` and `lib/imagery/mapbox-static` both dropped to
    **zero** importers across all of `web/`. Neither was in 4b's scope and
    neither is in 4c's. Decide them deliberately or leave them.
  - **Runbook lesson recorded in `CLAUDE.md` §RUNBOOK gotchas**, not just in the
    PR: a dependency sweep must walk `web/scripts`, not only `web/src` — the
    build gate type-checks both, and 4b's group 4 broke on exactly that.

- **THE WIZARD SWAP IS COMPLETE.** All of 4a–4c merged
  `[gh pr view, 2026-07-28]`: **4a (#162)** de-linked the last two in-app entry
  points; **4b (#166)** deleted the routes and legacy-only modules; **4c (#167)**
  unwound the trips-domain residue. **#168** recorded the #166 correction and
  widened the search-boundary runbook lesson. `main` is at `86e3acf`. The
  expedition wizard is now the **only** creation path in the codebase.

- **Repo hygiene, 2026-07-28.** **52 merged local branches deleted, 2 stale
  remote-tracking refs pruned** (`origin/feat/remove-legacy-wizard-4b`,
  `origin/fix/no-datepin-on-start-end`). Deleted with `git branch -d` so git
  itself refused anything not fully merged; the one branch that needed `-D`
  (`feat/manual-trip-edit`) was confirmed an ancestor of `main` first, so nothing
  was lost. 16 local branches remain — 15 unmerged plus `main`.
  - **`fix/generated-day-miles` SURVIVED THE CLEANUP DELIBERATELY.** Still
    pushed, still **no PR** `[gh pr list --head, 2026-07-28]`, remote tip
    `37faabb`. It is parked pending a decision between fixing `bake.ts` and
    projecting on the read path — see PARKED above and
    `generation-pipeline.md` §7.6. It was explicitly excluded from the prune;
    do not treat it as debris.

- **PR 4c — trips-domain residue unwound (MERGED, #167).** `createUserWizardTrip`,
  `writeWizardSlice`, `UserTripSummary.wizardStep`, and `Trip.wizard` all deleted;
  each verified dead against the post-4b graph first.
  - **`Trip.wizard` is gone from the TYPE but still in the DATA**, and that is
    fine by construction: reads are a bare `data.payload as Trip` cast (no zod,
    no allowlist) and writes spread (`{...rawPayload}` → mutate → `{...updated}`),
    so an unknown `wizard` key is **preserved on rewrite, never dropped**.
    Measured 2026-07-28 on TEST: the **only** row carrying it is the seed draft
    `7e6774b9`, `{"currentStep":"going"}`; no generated trip has ever written the
    key. (Named as which row rather than a ratio — a bare count goes stale the
    next time anyone generates.) **PROD NOT MEASURED** — the Supabase
    access token has been revoked and no PROD credentials exist locally. The 7
    PROD draft rows were previously reported as `wizardStep=going`, which implies
    they carry it; treat that as prior report, not a fresh measurement.
  - **CORRECTION — drafts can still be created.** The 4c scoping assumed
    `createUserWizardTrip` was the only writer of `state='draft'`. It was not.
    Three live paths remain `[read source]`: **duplicate-trip**
    (`app/trips/actions.ts:110` inserts `state:"draft"`), **`setTripState`**
    (`app/trips/actions.ts:16`, user-settable via the StatePill), and the **DB
    default** (`state text not null default 'draft'` — any insert omitting state).
    Draft is a live product concept independent of the wizard; do not treat it as
    vestigial.
  - **`lib/plan/types.ts` stays, and is now down to ONE consumer:**
    `components/plan/planning-topbar.tsx`, using 4 of its 17 exports
    (`PLAN_STEPS`, `STEP_DISPLAY_NUMBER`, `TOTAL_DISPLAY_STEPS`, `PlanStep`). The
    other 13 — `PlanWith`, `PlanLocation`, `Pace`, `PACE_BOUNDS`, `GoingData`,
    `VehicleData`, `InterestsData`, `PlannedStop`, `StopsData`, `DraftStatus`,
    `DraftTrip`, `WizardSlices`, `STEP_TITLE` — now have **zero** consumers
    `[re-verified 2026-07-28: 1 consumer, 17 exports, 4 used]`. Reported, not
    deleted. (`STEP_TITLE` was missing from this list as first written — the
    count said 13 while the enumeration held 12.) Note the topbar derives its step from the URL segment, so with
    `/plan/[id]/<step>` deleted **the STEP counter can no longer activate** on any
    surviving route; it renders its blank state on home. That whole file is a
    candidate for a later pass.
  - **Known cosmetic consequence of 4a**, measured on TEST against a
    deliberately-constructed 0-day draft: a dateless draft renders in the slideup
    as `NaN/NaN-NaN/NaN • 0 Days • 0 mi` (the `/trips` card already showed
    `Invalid Date` before this change). It renders — no crash, no dead link —
    but **PROD has 7 such draft rows**, so 7 users would see that header. A date
    guard is unscoped; decide it with 4b.

  The legacy
  5-step wizard is to be **replaced** by the expedition (LLM) wizard, and
  generation will **require sign-in** so a generated trip is an owned, editable,
  findable `trips` row. Trips created by the legacy wizard can be discarded; the
  anon `TRIPS` store is to be deleted rather than replaced.
  - **CORRECTION 2026-07-27 — the recorded blocker was wrong.** This was written
    as *"TEST has no Google provider configured, and PROD's provider is
    disabled."* The first half holds; **the second is false.** Actual state
    `[queried Management API config/auth, 2026-07-27]`: **TEST has no Google
    provider configured. PROD has Google enabled, with a client id and secret
    set. Email is enabled on both.** The original claim was recorded from a
    verbal report without an evidence tag and without being checked.
  - **What actually remains is a UI gap, not missing infrastructure.**
    **Sign-in works on PROD today.** No email, magic-link, OTP or password-reset
    form exists anywhere in `web/src` — a repo-wide grep for `signInWithPassword`,
    `signInWithOtp`, `signUp`, `verifyOtp`, `resetPasswordForEmail` and
    `signInAnonymously` returns **zero hits** in app code, and
    `web/src/app/auth/actions.ts` exports only `signInWithGoogle` and `signOut`
    `[grep]`. So *"should the product ship Google-only?"* is a **product
    decision**, not a prerequisite — the sequence can start whenever that is
    settled.
  - **Scriptable dev login already works — confirmed, not inferred.**
    `external_email_enabled` is `true` on TEST `[queried Management API
    config/auth, 2026-07-27]`, which is exactly what the committed
    `signInWithPassword` scripts rely on (`mint-dev-session.ts`,
    `seed-test-user.ts`, the three `verify-trip-*.ts` harnesses). The only
    friction is the ~1h session expiry already documented in CLAUDE.md §RUNBOOK.
  - **Magic-link callback shape RESOLVED 2026-07-27 — it is `?code=`.** A real
    client-initiated `signInWithOtp` redirects with a query param, not a fragment,
    so `exchangeCodeForSession` serves both flows and the callback change is
    **additive**. An earlier `#fragment` measurement was an artifact of using
    `admin/generate_link`, which carries no PKCE challenge. Two link types exist
    (`signup` first-time, `magiclink` returning) and the current route sees
    neither. Mechanics + instrument:
    `docs/decisions/2026-07-27-generation-requires-sign-in.md` §Magic-link
    mechanics.
  - Sequence and the full scoping live in `docs/BACKLOG.md` §Wizard swap. The
    client-side surface trace is `docs/architecture/trip-creation-surfaces.md` (#153).

## RESIDUALS (known, deliberate, not defects)

- **Reference-fixture removal (residual of #143).** The `TRIPS` module survives as
  the anon-wizard store only; reference literals still sit in it but no longer
  shadow the DB. `ensureAlaskaUpgraded` still has 4 waypoint-helper callers.
  Gated on lookup-vs-write of those helpers. **Note the interaction:** the wizard
  swap deletes the anon `TRIPS` store, so these two items are the same work and
  should not be started independently.
- **Curated kebab move-to-day is an array-splice** — sticks on serve but does NOT
  survive a regenerate, because day membership is geographically re-derived at
  bake/regen. Durable cross-day assignment needs `dayAssignment`, not yet built.
- **`dayAssignment` — DESIGN OPEN, NOT built.** The anchor-seed-uuid key is ruled
  out (coord-deduped, so a revisited city collides). Recommendation: mint a
  genuine per-day uuid; regen-survival remains a separate open problem. Scope and
  rejected alternatives:
  `docs/decisions/2026-07-24-cross-day-stop-movement.md`.
- **Seed-id pin resolution — queued, scoped, not built.** Cross-node drag-pins
  write a `nodeSeed`-keyed override the read spine can't resolve. Landing it also
  reverts the #146 view stack from optimistic values to server truth.
- **Pinned ER fixture (#128) corpus block is UNVERIFIED end-to-end** — `test:er`
  is inert while `SUPABASE_TEST_URL` and `SUPABASE_URL` share a ref. First real
  `test:er` run is the true gate.

## NEXT (ordered)
1. **The wizard swap is DONE through 4c.** 4a–4c merged or in review; the legacy
   wizard's routes, modules, and trips-domain residue are gone. What remains of
   the teardown is deliberately parked, not forgotten:
   - The **anon `TRIPS` store** — still out of scope, entangled with the
     reference-fixture removal, and inert now that legacy is gone.
   - **`lib/plan/types.ts`** — 13 of 17 exports have zero consumers (see above).
   - **4b's two orphans** — `components/ui/checkbox`, `lib/imagery/mapbox-static`.
   - The **dateless-draft header** (`NaN/NaN-NaN/NaN • 0 Days • 0 mi`) on PROD's
     7 draft rows. Still undecided, and drafts are still creatable via
     duplicate-trip, so this is not self-limiting.
2. **`dayAssignment` — decide the day-key, then build.** Mint a per-day uuid vs
   accept regen orphan-drop. Then apply at pool-assembly, extend `rescopeOverlays`,
   carry through regen, and re-wire the kebab's move-to-day to write it.
3. **DATA_INVENTORY maintenance** — keep `docs/DATA_INVENTORY.md` re-measured. It
   is the source of truth for what data lives where.
4. **Search architecture (reframed)** — the corridor corpus already EXISTS on PROD
   and works. The open question narrows to Google-primary vs corpus-first
   ranking/precedence, and whether audit-resolved Google records write back.
5. **Dwell-day reorder** — Day 6 POIs live in the drive:droppable. Scope decision.

## INVARIANTS (do not violate)
- A rank is meaningful only within a cluster. Key it to the node.
- Partial ranking is unrepresentable. Newcomers append, never demote.
- Display order is DOM order. Do not re-derive from miles.
- Phase guards (flag, TEST-ref) never on a shipped path. Property guards
  (`checkNotFrozen`) do.
- `retry` is correct ONLY if the mutate recomputes inside the closure. A
  precomputed full-structure overlay is refuse mislabeled as retry — it clobbers.
- Schema before the code that reads it. Always.
- Trip creation is restricted to **CA/NV/UT/AZ/WA/OR**, and the six-state list
  lives in exactly one module (`web/src/lib/plan/planning-region.ts`). Do not
  hardcode a state code anywhere else, and do not replace it with a bounding box.
- ~~The real gate is `cd web && npx next build`, exit 0. No tolerated errors.~~
  **CORRECTED 2026-07-31 — necessary but NOT sufficient.** `next build` does
  **not** type-check every file in the tsconfig scope; a real type error in
  `web/src/lib/plan/planning-region.test.ts` sat behind a green `next build`
  and would have failed CI `[measured 2026-07-31]`. **CI runs three separate
  jobs — `typecheck`, `test`, `build`.** Before pushing, run
  `npm run -w web typecheck` **as well as** `cd web && npx next build`. Note
  `data/` has its own gate that neither covers (`npm run -w data typecheck`).
- `data/.env` points at ONE project (TEST) and is NOT the whole picture. The
  corpus lives on PROD. Read `docs/DATA_INVENTORY.md` before drawing any
  conclusion about coverage or "what data exists."
- **A probe is only as trustworthy as the identity it ran under.** Before
  concluding anything from a client-side query, verify which role it actually
  authenticated as. See `docs/architecture/trip-resolution.md` §"The RLS drift
  that wasn't".
