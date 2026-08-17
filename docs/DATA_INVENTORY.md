# DATA INVENTORY — what data exists where

**Measured 2026-07-23.** These are point-in-time counts; **re-measure before
relying on them** (`data/search/sync-typesense.ts` and the ad-hoc scripts in
this session read a project via `--env-file`). `data/.env` points at ONE project
(TEST) — it is not the whole picture. The corpus lives on **PROD**.

Three Supabase projects have existed; two remain (`supabase projects list`):
`nqzeywzcowujzyegxbsr` (PROD) and `znldzjdatkogdktymtvi` (TEST). Staging is
deleted.

---

## PROD — `nqzeywzcowujzyegxbsr` ("overlanding")

The full LA→Deadhorse corridor corpus. **This is the real corpus.**

> **⚠️ Re-verified 2026-08-11 `[queried PROD, read-only]` — the counts below
> this box (from 2026-07-23) are SUPERSEDED for totals; the corpus roughly
> doubled with the six-state OSM camping ingest, then the bbq/fire_pit
> deactivation (2026-08-11) took the view to 16,516.** Current PROD:
>
> | metric | 2026-07-23 | **2026-08-11** |
> |---|--:|--:|
> | `source_record` total | 20,384 | **28,817** |
> | — `is_active = true` | (all) | **20,527** |
> | — `is_active = false` (six-state trim + fire_pit) | 0 | **8,290** |
> | `master_place` total | 13,629 | **20,904** |
> | — of which `source_count = 0` (fire_pit, view-excluded) | 0 | **138** |
> | `master_place_search_export` (view-visible) | — | **16,516** (footprint #209, −138 fire_pit 2026-08-11) |
> | Typesense `places_prod` | 13,629 | **16,516** |
>
> **`source_record` by `source_id` (all / active):** osm 13,804 / **13,581** ·
> nps 4,837 / 3,466 · ridb 3,961 / 2,519 · parks_canada 3,078 / **0** ·
> google 1,863 / 948 · bc_parks 8 / **0**. The six-state trim deactivated
> the Canada sources entirely and the out-of-region US tail; the 2026-08-11
> pass deactivated the 223 osm `fire_pit` (all `amenity=bbq`) rows.
> `master_place_search_export == places_prod ==
> 16,516` — search index mirrors the export view exactly. **The view filters on
> `six_state_footprint()` (tight) as of #209** — not `six_state_scope()`; that
> repoint was −9 Idaho +2 San Juan Islands (16,661 → 16,654), footprint not being
> a strict subset of scope.
>
> **OSM dispersed camping per state (ISO-area Overpass, distinct; sums
> exactly to the PROD `osm dispersed_camping` source_record total, 3,125):**
>
> | CA | UT | WA | AZ | OR | NV | **total** |
> |--:|--:|--:|--:|--:|--:|--:|
> | 757 | 893 | 682 | 270 | 508 | 15 | **3,125** |
>
> An earlier `location:(lat,lng,150 km)` interior spot-check read UT 373 /
> WA 327 / OR 156 / NV 2 — those are radius undercounts, **not** state
> totals; use the ISO-area figures above.
>
> **Photo coverage (Artboard C LIVE, #211):** `photo_url` is now on the view
> (nps/ridb lateral, NPS preferred) + the Typesense sync + hydrate. **3,526 of
> 16,516** view rows carry a non-null `photo_url` (~21%; unchanged by the
> fire_pit deactivation — osm bbq nodes carry no photo); `places_prod` docs
> carry it (retrievable — *not* a declared schema field, see BACKLOG). Source
> photos: 1,622 `ridb` + 4,451 `nps` = 6,073 source_records carry
> `normalized_payload.photo.url`.

- **master_place:** 13,629 total · 13,629 searchable · 0 non-searchable.
- **Searchable latitude range:** −88.6 → 70.2 (13,629 rows). The corridor proper
  spans ~**30N → 70.2N** (LA → Deadhorse / Prudhoe Bay); the two rows below ~30N
  (one near lat −88.6, one far-east lng) are junk outliers worth a cleanup pass.
- **source_record:** 20,384 total, by `source_id`:
  | source | rows |
  |---|---:|
  | osm | 5,371 |
  | nps | 4,837 |
  | ridb | 3,961 |
  | parks_canada | 3,078 |
  | google | 1,863 |
  | bc_rec_sites_poly | 824 |
  | bc_rec_sites_points_highvalue | 334 |
  | bc_rest_areas | 66 |
  | usfs | 20 |
  | yk_parks_campgrounds | 19 |
  | bc_parks | 8 |
  | curated_fuel | 3 |

  US (osm/nps/ridb/usfs/google) **and** Canada (Parks Canada, BC Parks, DataBC
  rec-sites/rest-areas, GeoYukon campgrounds) — a federated corridor.
- **Active corridor:** `la_to_deadhorse_full` (active, status `complete`, buffer
  80 km), envelope **`[-156.5, 33.5] → [-110.8, 70.4]`**. (`segment_a_la_pnw`
  also present, inactive/complete — the old bootstrap.)

## TEST — `znldzjdatkogdktymtvi` ("overlander-test")

> **⚠️ Re-measured 2026-08-17 `[queried TEST, read-only]` — SUPERSEDES the
> 2026-08-16 box below for totals.** All four USFS categories materialized live
> this session; the recreation.gov-id queue rule confirmed 370 pending campground
> rows via the new `resolve_place_match` RPC (migration `20260817120000`, **TEST
> only**). No PROD touched. Current TEST:
>
> | metric | value |
> |---|--:|
> | `master_place` total | **150,844** (149,385 → +1,459 from the three materializes) |
> | `source_record` total (all / active) | **159,869 / 159,863** |
> | `place_match` pending (manual_review), corpus-wide | **5,745** (blended_residual 4,979 · close_nameless 325 · name_dominant_low_conf 441) |
>
> **`source_record` by `source_id` (active):** osm **109,615** · padus **37,701** ·
> usfs **6,324** · ridb **6,013** · google_resolved 122 · nps 83 · google 5.
> **usfs 6,324** = trailhead 3,041 · campground 2,312 · picnic_area 570 ·
> dispersed_camping 401, now **5,228 linked / 1,096 unlinked** (+6 legacy
> `is_active=false`). Pending usfs by category: campground 572 · trailhead 440 ·
> picnic 50 · dispersed 35.
>
> **Queue write provenance:** 370 rows carry `resolved_by='rule:recgov-id:full0817'`
> (confirmed by the recgov-id rule). Reversal snapshot on record outside the repo:
> `~/.config/overlander/queue-snapshots/recgov-full0817.jsonl`. The 2026-08-16 code
> (USFS ingester, matcher floor, dry-run tooling) has since **merged to `main`**
> (#223/#224); the recgov rule + RPC are in **OPEN PR #230**, TEST data live, code
> not yet on `main`.

> **⚠️ Re-measured 2026-08-16 `[queried TEST, read-only]` — SUPERSEDES the
> 2026-08-14 box below for totals.** The PAD-US six-state (Fee_Managers) and
> USFS `EDW_RecInfraRecreationSites_02` campaigns completed this session —
> live-write TEST ingest, no PROD touched. USFS trailhead materialized;
> campground/picnic/dispersed not. Current TEST:
>
> | metric | value |
> |---|--:|
> | `master_place` total | **149,385** |
> | — `primary_category='land_status'` (search-excluded) | 35,966 |
> | — `primary_category='public_land'` (searchable) | 1,314 |
> | `source_record` total (all / active) | **159,869 / 159,863** |
> | `place_match` pending (manual_review), corpus-wide | **5,089** (blended_residual 4,856 · close_nameless 233) |
>
> **`source_record` by `source_id` (active):** osm **109,615** · padus
> **37,701** · usfs **6,324** · ridb **6,013** · google_resolved 122 · nps 83 ·
> google 5 · parks_canada/bc_parks/alberta_parks **0**. **usfs 6,324** =
> trailhead 3,041 · campground 2,312 · picnic_area 570 · dispersed_camping 401
> (2,601 linked / 3,723 unlinked; +6 legacy `is_active=false`). padus grew via
> the Fee_Managers six-state campaign. **Note:** the USFS ingester, matcher
> `name_dominant` floor, and `--dry-run-report` are in OPEN PRs #223/#224 — the
> TEST *data* is live, the *code* is not yet on `main`.

> **⚠️ Re-measured 2026-08-14 `[queried TEST, read-only]` — SUPERSEDES the
> 2026-08-10 box below for totals.** The RIDB and OSM six-state (WA, UT, OR,
> AZ, NV, CA) campaigns both completed this session — live-write TEST ingest,
> no PROD touched. Current TEST:
>
> | metric | value |
> |---|--:|
> | `source_record` total | **115,957** |
> | `master_place` total | **110,246** |
> | — solo (`source_count=1`) | 109,053 |
> | — multi (`source_count>1`) | 1,193 |
> | `place_match` pending (manual_review), corpus-wide | **4,230** |
>
> **`source_record` by `source_id`:** osm **109,615** · ridb **6,013** ·
> google_resolved 122 · padus 113 · nps 83 · google 5 · usfs 6 ·
> parks_canada/bc_parks/alberta_parks **0**. RIDB grew from a 355-row
> SoCal-only smoke-test footprint to full six-state coverage
> (`pLimit(1)`, six ingest+reconcile passes — see `STATE.md`). OSM grew
> by ingesting six tag families (`camping, trailheads, natural, leisure,
> fuel, tourism_misc`) per state via `--iso US-<XX>` on top of the prior
> six-state `camping`-only baseline.
>
> **`manual_review` (pending) by source:** osm **3,848** · ridb **362** ·
> other **20**. No review process exists for this queue yet — see
> `docs/BACKLOG.md`.
>
> **State-level breakdown, osm and ridb** (six-state bboxes from this
> session's scoping work; bboxes deliberately overlap at shared borders,
> so state totals sum to MORE than the corpus total — do not add these
> columns to get a corpus figure):
>
> | | WA | UT | OR | AZ | NV | CA |
> |---|--:|--:|--:|--:|--:|--:|
> | osm | 13,492 | 12,733 | 12,502 | 20,902 | 25,502 | 52,175 |
> | ridb | 615 | 1,311 | 1,186 | 784 | 807 | 2,360 |
>
> osm's per-state figures grew past each state's own post-ingest count
> where a *later*-ingested neighboring state's fetch also produced nodes
> falling inside an *earlier* state's bbox rectangle near a shared border
> (e.g. WA's OSM count includes some OR-ingest nodes near the WA/OR
> line) — expected given the deliberately loose interior bbox edges, not
> a data error.

> **⚠️ Re-measured 2026-08-10 `[queried TEST, read-only]` — TEST has grown far past
> the old reseed via the six-state camping validation ingests, and its export view
> was brought to the PROD baseline this session (`180000–180400`).** Current TEST:
>
> | metric | value |
> |---|--:|
> | `source_record` total (all active — no `is_active` trim on TEST) | **18,967** |
> | `master_place` total | **16,521** |
> | `master_place_search_export` (view, `six_state_footprint()`) | **14,911** |
> | — carrying `photo_url` | **226** |
> | Typesense `places_test` | **14,911** (= view) |
>
> **`source_record` by `source_id`:** osm **18,250** · ridb 388 · nps 83 ·
> google_resolved 122 · google 5. TEST is **osm-heavy (96%)** and now larger than
> PROD's osm — still **not representative of PROD** (no `is_active` trim, no Canada
> sources, different source mix), just no longer tiny. The 2026-07-23 counts below
> are SUPERSEDED.

Small and **not representative of coverage.** It was **wiped 2026-06-03 by
`reset_phase3a_test_state`** — that is why it is tiny, not because the corpus is
SoCal-only. (Treating TEST as the corpus is what drove several wrong "corpus is
SoCal-only" conclusions this session; it isn't — PROD is.)

- **master_place:** 1,860 total · 1,749 searchable · 111 non-searchable
  (≈ the PADUS land-status polygons).
- **Searchable latitude range:** 33.8 → 34.4 (1,749 rows) — the LA/Joshua-Tree
  reseed only.
- **source_record:** 2,236 total, by `source_id`: `osm 2,021 · padus 113 ·
  nps 83 · ridb 8 · usfs 6 · google 5`.
- **Active corridor:** none (`ingestion_corridor` is empty).

(An aborted Slice-1 corridor run had left TEST with ~8,653 extra unresolved OSM
source_records and a leftover active `segment_a_la_pnw` corridor row; both were
rolled back 2026-07-23 via `npm run -w data slice:rollback --execute` against the
STEP-0 snapshot, and `places_test` re-synced. The numbers above are the restored
baseline.)

## `reference_trips` — RLS + rows per DB

App data (canonical seed trips), not corpus. **RLS:** exactly one policy,
`reference_trips_public_read … for select using (true)` — no role restriction, so
**anon can read**, and **no insert/update/delete policy exists**, making it
service-role-write-only by omission. Confirmed against the live catalog on both
projects `[queried catalog, TEST + PROD, 2026-07-27]`.

> **⚠️ Correction, 2026-07-27.** The earlier version of this line said the read was
> "confirmed empirically with the anon key (no session, RLS-subject)". **On TEST
> that was not RLS-subject** — `NEXT_PUBLIC_SUPABASE_ANON_KEY` held a `sb_secret_…`
> key, so the client authenticated as service-role and bypassed RLS. The PROD half
> was correct. The local env has been fixed and the key rotated. The policy claim
> itself stands, now on a catalog read rather than a client probe. Why this
> matters beyond one line: `architecture/trip-resolution.md` §"The RLS drift that
> wasn't".

**Rows present (point-in-time 2026-07-27) `[queried catalog]`:**
- **TEST — 9 rows** (was 7 on 2026-07-25): `alaska-south-final`,
  `alaska-south-regen`, `dawson-cassiar-livingplan-test`, `expedition-mri4puxo`,
  `expedition-mri5tv6g`, `expedition-ms28y793`, `la-to-deadhorse`,
  `la-to-portland`, `yotrippin-demo`. Three are `expedition-*` — wizard-generated,
  TEST-only by the action's project guard.
- **PROD — 3 rows:** `dawson-vancouver-cassiar`, `la-to-deadhorse`,
  `la-to-portland`. **Zero `expedition-*` rows** — generation cannot write to PROD.
  `[queried catalog; hash-reference-trips.ts before/after for the 2026-07-25 add]`

How `getTrip` serves these rows (reader split, derivation, caching):
[`docs/architecture/trip-resolution.md`](architecture/trip-resolution.md).

### DE-LINKED 2026-07-31 — out of region, still reachable

Planning scope narrowed to **CA, NV, UT, AZ, WA, OR**. Three reference trips sit
outside it and were test fixtures serving as product content. Their in-product
pointers are removed:

| trip | pointers removed | remaining references |
|---|---|---|
| `la-to-deadhorse` | **2** — the `/trips` empty state (`app/trips/layout.tsx`) and the home browse link (`components/plan/entry-scene.tsx`) | ~9 maintenance/seed scripts under `web/scripts`, and `repository.ts`'s fixture-serving path |
| `alaska-south-final` | **0 — none existed** | docs only |
| `yotrippin-demo` | **0 — none existed** | one script constant (`scripts/generate-itinerary.ts` `DEMO_TRIP_ID`) |

**De-linked, NOT retired and NOT deleted.** No row was removed, nothing was made
unreachable, and `reference_trips` is still anon-readable — `/trip/la-to-deadhorse`
renders for anyone with the URL. Only the in-product navigation is gone.

**`dawson-vancouver-cassiar` is deliberately untouched.** It is also out of region,
but it is FROZEN by an earlier decision, and every guard referencing it
(`rails.ts` `FORBIDDEN_IDS`, the verify scripts, `edit-actions.ts`) stands
unchanged. De-linking must not reverse a freeze by implication.

**`REFERENCE_TRIP_IDS` was deliberately NOT changed.** It is duplicated in
`app/trip/[id]/page.tsx` and `app/@modal/(.)trip/[id]/page.tsx`, and despite the
name it is not a link table — nothing navigates through it. It marks *reference
behaviour*: `isReference` drives the fork CTA and forces `canEdit` false.
Reachability comes from `getTrip()`, not from this Set. Removing the id would
leave the trip reachable but strip its reference treatment — a behaviour change
dressed as a de-link. Left intact.

## `public.trips` — notable rows

User trips (owner-scoped RLS). Not an exhaustive listing — only rows worth
knowing about are recorded here.

**PROD: two rows share the title "Tok, AK to Dawson, YT"** (point-in-time
2026-07-26, service-role read, **read-only**) `[queried PROD]`:
- **`24f14ecc-a209-45e7-a414-16ecc816bab0` — POPULATED.** 2 days, **63**
  `segmentSuggestions` (all `mp:` corpus tiles), 0 `day.suggestions`, 0
  `waypoints`. This is the row behind the place-card research; its shape is
  described in
  [`architecture/itinerary-model.md`](architecture/itinerary-model.md) §7.
- **`81865432-7a18-4f18-beaa-d6d95e6da249` — EMPTY POOL.** 2 days, same title,
  `routePolyline` present, but **0 tiles** across all three pool sources.
  Whether it is user-reachable and what it renders is **UNVERIFIED** — recorded
  in `docs/BACKLOG.md`, not investigated.

**TEST:** `05b346df-3bb5-4c46-8ff1-e0c5cfe26301` (66d fork of `la-to-deadhorse`,
owned by `seed-owner`) and the 1-day `7e6774b9…` seed harness row. The fork
carries **0** `segmentSuggestions` where the PROD equivalent carries 63 — reason
**UNVERIFIED**, consequences for its use as a test instrument in `CLAUDE.md`
§RUNBOOK gotchas. `[queried TEST]`

**TEST, added 2026-07-27 — the first trip produced by the NEW generation write
path (#160/#163):** `ea1f51f7-5e58-47cf-b430-b02d868988cc` — "Moab, UT → Durango,
CO", **owned** by `seed-owner`, `state: "active"`, `reference_id: null`, 5 days,
**20** `segmentSuggestions` (4.0/day, against 3.2/day for the older
`expedition-ms28y793`). Generated by invoking the real server action under a real
minted session. **This is now the reference instrument for the post-swap shape** —
unlike `expedition-ms28y793` (a `reference_trips` row from the old path), it is a
UUID-keyed owned row, so `canEdit` is true and it exercises the RLS write path.
Left in place deliberately. `[queried TEST]`

> Note the older `expedition-ms28y793` in `reference_trips` is **not** comparable
> for edit-path work — it predates the swap and is the last artifact of the
> `reference_trips` write target. `CLAUDE.md` §RUNBOOK's disjoint-instruments
> caveat still applies to it.

**TEST writes this session (#184 verification) — nothing left behind.**
`web/scripts/verify-split-day.ts` and `verify-rest-day.ts` each `INSERT` a temp
UUID `public.trips` row cloned from the `expedition-ms28y793` payload (owned by
`seed-owner`, titled `SPLIT VERIFY` / `REST-DAY VERIFY`), run the real
`splitDay` / `insertRestDay`, then `DELETE` the temp row in a `finally` — the
snapshot is "the row did not exist." **Confirmed 0 rows with those titles remain**
`[queried TEST, 2026-08-03]`, so nothing was stranded. These scripts are the
committed way to exercise the day-insert write path on TEST without a browser.

### STANDING INSTRUMENT for current pipeline output — `4534add5` (adopted 2026-07-31)

**`4534add5-3787-4b5f-ade6-584ce0fc27e7`** — PROD `public.trips`, San Diego, CA →
Portland, OR, **11 days**, 2026-08-01 → 08-11, `state: active`,
`reference_id: null`, generated via the wizard with `generationInput` present,
created 2026-07-31T14:23Z, owner `762639cf-…`.
Every figure below was **re-verified in a second independent pass** before being
recorded here `[queried PROD, read-only, 2026-07-31]`; all 11 checks matched.

**It is on the healthy side of the `dayRoutes` split** — the thing that killed the
old instruments:

| | `4534add5` | `alaska-south-final` / `yotrippin-demo` |
|---|---|---|
| `day.coords` | **11/11** | 1/19 |
| `day.startCoord` | **11/11** | 1/19 |
| `routePolyline` | **present, 126,045 chars** | absent |

**Shape:** 770 tiles · **104 distinct eligible ids** · 31 curated · 0 waypoints ·
0 legacy `day.suggestions`. **602 of 770 tiles (78%) carry no `placeId`** and can
never enrich.

**Its density is LOPSIDED — do not quote "70 tiles/day".** That is a mean over a
very uneven distribution and is representative of no day on the trip:

```
per-day tiles    : 263, 164, 61, 114, 31, 93, 4, 4, 7, 14, 15
per-day eligible :  33,  45, 18,  26,  3, 31, 2, 3, 3,  4,  0
```

**What it exercises.** Day 2 carries **45 distinct eligible ids** — over the
`MAX_IDS = 40` cap, so it reaches the chunking boundary (two batches). Two
**round-trip days** (d3 Big Bear Lake, d5 Lone Pine) exercise #170's
label-suppression. **`curatedMode` is TRUE** (31 curated tiles), so non-curated
tiles collapse behind "Explore more". Route is entirely CA/OR, where BLM, USFS
and Google all have coverage — unlike the Yukon dead zone.

**It is RLS-scoped and NOT anon-readable.** Verified: **0 rows via the anon key,
1 via service-role.** The de-linked reference trips are `reference_trips`, which
anon *can* read. Consequence for tooling: **service-role payload analysis is
unaffected; browser-rendered DOM measurement now needs a minted session** (~1h
expiry, and per CLAUDE.md §RUNBOOK expiry reads as broken tooling). Several
measurement passes this week ran anonymously in a browser precisely because a
public slug was available — that technique does not transfer to this trip.

**What de-linking costs — no surviving default instrument for either:**
- **The 91-id / three-batch case.** `la-to-deadhorse` day 1 is 91 distinct
  eligible ids; `4534add5` peaks at 45 (two batches). Nothing else in either
  database exceeds 45.
- **The `curatedMode = false` case.** `la-to-deadhorse` day 1 has *zero* curated
  tiles, so everything renders inline; `4534add5` has 31 and renders collapsed.
  These are different render modes and do not substitute.

Both probably want a **synthetic fixture** rather than a live trip. Not built —
recorded as separate work.

**PROD now holds GENERATED trips in `public.trips` — three as of 2026-07-28,**
all created that day, all owned by `762639cf-8e90-4648-b387-f73729ee2e18`
`[queried PROD, read-only]`. This is the first time PROD has carried any row
produced by the generation pipeline, and it is what falsified the previously
recorded "no PROD trip stores `milesFromStart`" claim.

| id | days | tiles carrying a stored mile | curated tiles beyond their own day's `miles` | worst |
|---|---|---|---|---|
| `a54c5c65-0120-4a3e-bd55-0756cdd506ae` | 3 | 774 | 3 | ×2.3 |
| `cefc94e0-9d2a-47ba-b90b-057f407cc41e` | 4 | 552 | 3 | ×1.5 |
| `7e3e088a-6b60-497f-b509-2dd19d8ee48f` | 4 | 776 | 4 | ×2.3 |

Day 1 of `a54c5c65…` is a **268-mile day whose spine reached 626mi** before #170.
Post-#170 nothing renders these values; they are still being written. Do not
delete these rows — they are the only PROD artifacts of the pre-#170 read path.

**TEST, generated 2026-07-28** (all `public.trips`, owned by `seed-owner`,
`state: "active"`) `[queried TEST]`:

| id | days | purpose |
|---|---|---|
| `b67680c0-03e1-456e-b9f4-00c1f8ede733` | 5 | post-4b generation, the #166 distribution check (20 tiles, per-day 4/3/5/4/4) |
| `ab7e8a73-3709-430d-9464-66953b9e8a2f` | 5 | post-4c confirmation the pipeline survived the residue unwind |
| `5bd75b52-a75d-4298-a238-cce8f61d76a4` | 15 | a long generated trip for windowing/hydration work |

`ea1f51f7…` (above) is the pre-4b baseline those compare against — 20 tiles,
per-day **4/4/4/4/4**. The #166 claim that the two were "identical, including the
per-day distribution" was false; totals matched, distributions did not. See
`LOG.md` 2026-07-28.

### The `MAX_IDS` instrument — per-day hydration-eligible id counts

A tile is hydration-eligible when it carries a `placeId` and no `photoUrl`
(**only** `day.segmentSuggestions` ever carries a `placeId` — `day.suggestions`
and `waypoints` never set one). These are the only trips in either database whose
**single-day** eligible count exceeds `MAX_IDS = 40`, so they are the instrument
for that defect `[queried PROD, read-only, 2026-07-28]`:

**The `dropped` column is HISTORICAL.** #176 (2026-07-31) replaced truncation
with chunking, so **nothing is dropped today** — the same counts now describe how
many `BATCH_SIZE = 40` batches a day costs. Retained because these are still the
only trips that cross the boundary, and the batch column is what an instrument is
now chosen for.

| trip | day | distinct eligible ids | ~~dropped by `.slice(0, 40)`~~ (pre-#176) | batches today |
|---|---|---|---|---|
| `la-to-deadhorse` (PROD `reference_trips`, 66d) | 1 | **91** | ~~51~~ | **3** |
| " | 2 | 57 | ~~17~~ | 2 |
| " | 3 | 57 | ~~17~~ | 2 |
| " | 9 | 42 | ~~2~~ | 2 |
| `dawson-vancouver-cassiar` (PROD, FROZEN, 14d) | 1 | 42 | ~~2~~ | 2 |

Whole-trip totals: `la-to-deadhorse` **907 eligible tiles / 423 distinct ids**;
`dawson-vancouver-cassiar` 182 / 115. For contrast, the two trips previously
assumed to be the problem cannot trigger it — `24f14ecc` is **exactly 40 distinct
trip-wide** against a cap of 40 (a boundary, not a margin), and
`expedition-ms28y793`'s whole-trip union is **39**. Analysis:
`architecture/place-render-model.md` §4.4.1; scoping and recommendation:
`BACKLOG.md`.

## `auth.users` vs `public.users` — PROD shape, and why the counts differ (2026-07-27)

All `[queried PROD]`, read-only, aggregates only — no addresses recorded here.

**PROD auth shape:**

| | count |
|---|---:|
| `auth.users` (all active, none soft-deleted) | **4** |
| `auth.identities` | 4 — **2 `google`, 2 `email`** |
| distinct users holding a `google` identity | 2 |
| `public.users` | **1** |
| `auth.users` with **no** `public.users` row | **3** |

Per user (id prefixes only):

| user | providers | `public.users` row | trips owned |
|---|---|---|---:|
| `37d4b860` | email | no | 0 |
| `fdec63b2` | email | no | 0 |
| **`762639cf`** | **google** | **yes** | **11** |
| `18f5e726` | google | no | 0 |

**Every trip on PROD belongs to one Google account.** No PROD user holds more
than one identity.

### `public.users` lags `auth.users` — this is application state, not a defect

**Do not "fix" this.** There is no broken trigger, no missing FK cascade, and no
failed backfill. The gap is by design:

- `auth.users` gains a row the moment someone completes sign-in with a provider.
- **`public.users` is written by the `/welcome` onboarding flow**
  (`web/src/app/welcome/actions.ts`), not by sign-up. So a row appears there only
  after a user finishes onboarding.
- `public.users` is therefore an **onboarding-completion proxy**, and
  `auth.users − public.users` is the count of accounts **pending `/welcome`** —
  currently 3.

The consequence is structural, and worth knowing before reading trip ownership:
`trips.owner_id` references **`public.users(id)`**, not `auth.users(id)`
`[read: supabase/migrations/20260513000000_init_identity.sql]`. So a signed-in
user with no `public.users` row **cannot own a trip at all** — the FK forbids it.
That is why 3 of 4 PROD accounts show 0 trips: not because they never made one,
but because they never could until onboarding completed.

The proxy also runs through the edge hook: `updateSupabaseSession`
(`web/src/lib/supabase/middleware.ts`) redirects a signed-in user **with no
profile row** to `/welcome`, exempting `/auth`, `/welcome`, `/api` and `/_next`
`[read source]`. So the lag is self-healing on next visit, by design.

---

## RLS posture per project — read from the catalog, not inferred (2026-07-27)

Previously every RLS claim in the doc set rested on reading migrations. These were
read from the live catalog on **both** projects `[queried catalog, TEST + PROD,
2026-07-27]`, and the two are **identical**.

**Policies: exactly 8, same on both projects, and they match the migrations
exactly** — no policy in either DB that is absent from migrations, none in
migrations absent from the DB, no logical differences beyond Postgres'
re-parenthesisation:

| table | policies |
|---|---|
| `trips` | 4 — `select`/`insert`/`update`/`delete`, all `auth.uid() = owner_id` |
| `users` | 3 — `select`/`insert`/`update`, all `auth.uid() = id` |
| `reference_trips` | 1 — `select using (true)`; **no write policy** |

**Grants are identical across `anon`, `authenticated` and `service_role`** on every
table checked — so role-differentiated behaviour, where it exists, comes from RLS
policies, never from a missing grant. (This mattered: a suspected grant asymmetry
turned out to be a misconfigured client. See
[`architecture/trip-resolution.md`](architecture/trip-resolution.md) §"The RLS
drift that wasn't".)

**Service-role-only by omission** — RLS enabled with **zero** policies, so no
non-service role can read or write: `master_place`, `source_record`, `place_match`,
`place_relationships`, `legality_overlay`, `ingestion_corridor`, `field_precedence`,
`test_marker`, and (since #154) `mvum_roads`.

**Tables with RLS disabled: none on either project** — `spatial_ref_sys` excluded
as PostGIS-owned. Before #154, `mvum_roads` was the sole exception on both.

**`mvum_roads` post-#154 state, both projects** `[queried catalog]`:

| | value |
|---|---|
| `relrowsecurity` | `true` |
| policies | 0 (deliberate — consumers are service-role only) |
| `anon` / `authenticated` table privileges | none |
| `anon` / `authenticated` EXECUTE on `upsert_mvum_road(text, jsonb)` | none |
| `service_role` | full DML, retains EXECUTE |
| `pg_proc.proacl` | `postgres=X/postgres \| service_role=X/postgres` |

Rows: TEST 308, PROD 8,585 — unchanged by the migration.

**Migration-history divergence:** PROD's ledger is missing
`20260723120000_google_resolved_field_precedence`, and the effect is absent too
(the three `field_precedence` rows for `google_resolved`). PROD's ledger and PROD's
actual state agree with each other; the divergence is between PROD and the repo.
Recorded in `docs/BACKLOG.md` §Schema & infra hygiene — noticed, not applied.

---

## STAGING — `gjzqlsyusmtrwbaluuho` ("overlander-staging") — DELETED

A pre-cutover prod clone (created 2026-06-04, master_place 12,242). **Deleted**
after the 2026-06-06 backup; not in `supabase projects list`. It survives **only
as a local NDJSON backup** (below).

---

## TYPESENSE — one cluster, one collection per environment

Cluster **`w3mlrqnfjube9i1gp-1.a2.typesense.net`** (the prior cluster
`bkai38…a1` was deleted; both prod and test always shared one cluster — Starter
tier = 1 cluster).

| collection | docs | used by |
|---|---:|---|
| `places_prod` | ~~13,629~~ ~~16,661~~ **16,516** (2026-08-11) | PROD (Vercel `NEXT_PUBLIC_TYPESENSE_COLLECTION=places_prod`) |
| `places_test` | ~~1,749~~ **14,911** (2026-08-11) | dev (`web/.env.local`) + `data/.env` |

(The old shared `places` collection — 1,749 docs — was **deleted 2026-07-23**
once both environments were confirmed on their own collections. Nothing read it:
`search.ts` and `sync-typesense.ts` both resolve the name from env with no
`"places"` default.)

**Why collection-per-environment (not one shared `places`):** a shared
collection means `search:sync` from one environment **prunes every doc not in
its source** — and because each project has independent `gen_random_uuid` ids,
*all* of the other environment's docs are "stale" and get deleted. Worse than
staleness: after such a clobber, an environment's Typesense hits are ids that
don't exist in *its* Supabase, so the federated **hydrate step throws entirely**
(cross-env id mismatch), not just returns fewer results. See
`docs/decisions/2026-07-23-typesense-collection-per-env.md`.

---

## LOCAL BACKUPS

- **`backups/gjzqlsyusmtrwbaluuho/20260606T145521Z/`** — the staging clone
  (2026-06-06, Management-API NDJSON export, EWKT geometry). Row counts:
  | table | rows |
  |---|---:|
  | master_place | 12,242 |
  | source_record | 18,751 |
  | place_match | 15,827 |
  | mvum_roads | 8,585 |
  | spatial_ref_sys | 8,500 |
  | field_precedence | 82 |
  | ingestion_corridor | 1 |
  | reference_trips / trips / users / place_relationships / test_marker | 0 |

  This is the **only remaining copy of the deleted staging project.**
- **`~/Dropbox/Overlander_Archive/prod-floor-20260604-113503/`** — a pre-cutover
  prod floor (2026-06-04): `master_place 12,230 · place_match 15,807` (partial —
  those two tables only).

---

## KNOWN HISTORY (short)

- **June corridor run** — the full LA→Deadhorse ingest landed on PROD (corridor
  extended lat 34 → 70.2, +967 searchable places), PR #83.
- **2026-06-03 TEST wipe** — `reset_phase3a_test_state` cleared TEST; it has only
  been partially reseeded (SoCal) since.
- **2026-06-01 service-key rotation Vercel never received** — the prod Supabase
  `service_role` key was rotated, but Vercel's `SUPABASE_SERVICE_ROLE_KEY` was
  not updated. Prod corpus **hydrate** (`hydratePlacesByIds`, service-role read)
  therefore failed with `master_place read failed: Invalid API key` — silently,
  because the federated half caught it and served live-only results. Diagnosed
  and fixed **2026-07-23** (Vercel key updated + redeploy; corpus search now
  returns over the full corridor). The `?debug=1` gate on `/api/search-area`
  surfaces such errors in-band going forward.

---

## CREDENTIAL DRIFT — it lives in the deployment, not the files

Every local and backup service key was **valid** throughout the 2026-06-01
incident; only **Vercel's runtime key** was stale. So a local file scan would
never have caught it — the check that matters probes the live deployment.
`npm run -w data drift:check` (run it **when something looks wrong**, not on a
schedule) does both:
- **(a) runtime probe** — hits the deployed prod `/api/search-area?debug=1` and
  asserts `failedSources` is empty (exercises the service-role hydrate path; this
  is the part that would have caught 2026-06-01);
- **(b) stored-key scan** — one live read per stored service key against its own
  project, reported valid/invalid by SHA-10 fingerprint (never prints a key).
