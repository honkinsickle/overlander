# STATE — branch `fix/amenities-render-shape` · 2026-08-18 (⚠ newest section is the **amenities + category-curation session**: toilet/water/dump_station reactivated on TEST with templated descriptions, then **narrowed so only described rows stay live** (1,008 description-less rows pulled back out). 25 commits, **2 unpushed at time of writing**, no PR opened. **Both viewpoint reactivations have since RUN** — the NPS slice and the OSM described/filter-C subset. Open now: **88 unlinked viewpoint source_records** (83 nps + 5 osm) that are active but reach no surface without materialization. ⚠ Typesense is **stale** against the DB: sync still blocked by cluster OOM. The section below it is the last `main` state, 2026-08-17. TEST-only throughout; no PROD writes.)

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
