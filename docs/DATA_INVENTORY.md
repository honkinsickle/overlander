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

> **⚠️ Data changed 2026-09-01 `[authorized PROD write — regression repair]`.**
> 2,716 `master_place` rows recomputed (the Aug-31 regression batch of 2,732
> **minus 16** excluded to protect their `contact`/`access`). 0 failed.
> **Repaired:** `mvum_corridor` true **52 → 501** (+449), false **2,810 →
> 3,922** (+1,112) — together the 1,561 `dispersed_camping` rows that had been
> left NULL by the regressed function; `place_relationships` `contained_in`
> edges **6,217 → 6,287** (+70).
> **Unchanged, verified before/after:** `master_place` 28,348, `is_searchable`
> 28,348, `land_status AND searchable` 0, rows with a real description
> **13,955 → 13,955**. Within the recomputed set: description 2,626 → 2,626,
> contact 50 → 50, access 25 → 25, amenities 0 → 0, hours 0 → 0.
> **Scope proven:** rows touched 2,716, outside the target set **0**, missed
> **0**. The 16 excluded rows verified untouched on every field including
> `last_resolved_at`.
> **Still outstanding on PROD:** the legacy stale-description population and the
> 16 excluded rows' containment gap — see `docs/BACKLOG.md`.
> Report: `docs/measurements/2026-09-01-prod-recompute-fix-deployment.md`.

> **⚠️ Schema changed 2026-09-01 `[migrations applied to PROD; NO data changed]`.**
> The five `recompute_master_place()` restore + generated-description migrations
> (`20260901000100`–`000500`) are now applied to PROD, and PROD's function/view
> definitions are **byte-identical to TEST's** (verified by diffing
> `pg_get_functiondef`/`pg_get_viewdef` for all five objects).
> New on PROD: `is_generated_source(text)`, and `field_precedence` description
> rows for `generated_llm` (priority 20) and `generated_template` (21).
> **`master_place_generated_content` exists on PROD but holds 0 rows**, and there
> are **0** `generated_llm`/`generated_template` source_records — the description
> reroute is a no-op here, unlike TEST.
> **Zero data change:** all seventeen measured corpus metrics are identical
> pre- and post-apply — `master_place` 28,348 (all `is_searchable`), rows with a
> real description 13,955, `description = ''` 96, `mvum_corridor` true/false/null
> 52 / 2,810 / 25,486, `contained_in` edges 6,217, `source_record` 37,845 total /
> 29,555 active, `operational_status` set 50,
> `master_place_search_export` 21,965, avg prominence (searchable) 2.915338,
> `sum(source_count)` 30,379. Only 2 rows were recomputed (verification
> subjects, both restored).
> **Pending, not done:** the repair recompute — see `docs/BACKLOG.md` top entry.
> Until it runs, the 2,732-row regression batch keeps its NULL `mvum_corridor`
> and missing containment edges, and the 2,725 stale descriptions remain.
> Report: `docs/measurements/2026-09-01-prod-recompute-fix-deployment.md`.

> **⚠️ Re-verified 2026-08-31 `[queried PROD, read-only + USFS INFRA
> ingestion + backfill + Typesense sync]` — USFS INFRA site corpus
> ingested on PROD (3,168 rows, 0 errors), ER ran (2,629 new
> master_places + 136 auto-linked + 448 manual_review), operational_status
> backfill wrote 50 CLOSED + 1 TEMPORARILY CLOSED. Three new migrations
> applied (`20260831100000/100100/100200`): `master_place.operational_status`
> column, `pois_along_corridor` RPC + `master_place_search_export` view
> extended to surface and exclude CLOSED/DECOMMISSIONED.** Full narrative:
> `docs/LOG.md` §2026-08-31.
>
> | metric | before (2026-08-29) | **after (2026-08-31)** |
> |---|--:|--:|
> | `source_record` total | ~24,383 | **~27,551** |
> | — `source_id = 'usfs'` | 20 | **3,188** (20 recarea + 3,168 site) |
> | `master_place` total | 25,719 | **28,348** |
> | — `operational_status IS NOT NULL` | 0 | **50** (49 CLOSED + 1 TEMPORARILY CLOSED) |
> | `master_place_search_export` (view-visible) | ~21,326 | **21,965** |
> | Typesense `places_prod` | ~21,326 | **21,965** |
>
> **⚠️ Re-verified 2026-08-29 `[queried PROD, read-only, live spot-check
> probes not just script exit codes]` — two more editorial sources landed
> on PROD this session, both under Adam's explicit per-source
> authorization. Full narrative: `docs/LOG.md` §2026-08-29.** The
> `atlas_oddities` counts in the box below are unchanged by this pass.
>
> | metric | `editorial_food` (publisher `tasteatlas`, all 6 states) | `family_destinations` |
> |---|--:|--:|
> | `source_record` ingested | **497** (0 errors) | **14** (0 errors) |
> | ER: `new_master_place` | **481** | **11** |
> | ER: `manual_review` (pending) | **16** | **3** |
> | ER: errors | 0 | 0 |
> | Typesense `places_prod` post-sync total | **21,315** | **21,326** |
> | Typesense sync failures | 0 | 0 |
>
> **Migrations applied** (all 6 pending, in one `db:push-verify` pass —
> ledger ordering required it): `20260828110000/100/200` (family_destinations
> field_precedence + corridor + search-export photo laterals) and
> `20260828120000/100/200` (editorial_food, same shape). The
> family_destinations trio is schema-only and was inert on PROD until
> this session's ingest ran.
>
> **Known issue, not fixed this session:** `Hodad's` exists as two
> separate `master_place` rows — one attributed to `family_destinations`,
> one to `editorial_food`/`tasteatlas` — missed by entity resolution
> because the two promotions ran as independent passes. Also unresolved:
> 16 + 3 = 19 PROD `place_match` rows sitting `pending`, and (TEST-side)
> 19 + 1 = 20 more — see `docs/LOG.md` §2026-08-29 for the two matches
> flagged as probably-wrong (Tivoli Bar and Grill, Rockwell Ice Cream).
>
> **⚠️ Re-verified 2026-08-27 (later) `[queried PROD, read-only]` —
> atlas_oddities landed on PROD in a single session (migrations +
> anchor CSV ingest + materialize + manual content ingest + markdown
> converter). Full LOG narrative: `docs/LOG.md` §2026-08-27 (Atlas
> Obscura oddities LIVE ON PROD).** Post-promotion PROD state, atlas_oddities
> only (the other-source counts in the 2026-08-11 box below are
> unchanged by this pass):
>
> | metric | value |
> |---|--:|
> | `source_record` for `source_id = 'atlas_oddities'` | **2,866** |
> | — with `normalized_payload.description` non-null | **2,854** |
> | — with `normalized_payload.photo.url` non-null | **2,844** |
> | — linked to a `master_place` | **2,806** |
> | — in `manual_review` (unlinked, pending triage) | **60** |
> | distinct AO-linked `master_place` ids | **2,806** |
> | — with `attribution.description = 'atlas_oddities'` | **2,794** |
> | — with `photo_url` non-null | **2,784** |
>
> **Migrations applied:** `20260827180000_atlas_oddities_description_photo_precedence`
> (adds `field_precedence` row + extends `backfill_master_place_photo_url` chain)
> and `20260827180100_pois_along_corridor_atlas_oddities_photo` (extends
> `pois_along_corridor` photo lateral to include atlas_oddities).
>
> **Not touched this pass:** `master_place_search_export` view and Typesense
> `places_prod` sync. AO tiles surface on corridor browse (RPC) but NOT on
> `/search` results — flagged in BACKLOG for a follow-up Typesense sync.
>
> **⚠️ Update 2026-08-28:** the search-index gap is now closed. Migration
> `20260828100000_master_place_search_export_wikipedia_atlas_oddities_photo`
> extended the view's photo lateral to include wikipedia + atlas_oddities;
> `search:sync` ran twice against PROD. Post-sync `places_prod` state
> (queried this session): **20,834 documents / 2,804 oddity documents**
> (baseline 16,516 / 0 oddity). All 8 AO-name probes surface with a clean
> converted description AND a non-null `photo_url`. Full narrative:
> `docs/LOG.md` §2026-08-28.
>
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
>
> **⚠ NPS photo coverage expanded (PR #298, TEST-only as of 2026-08-26):**
> the NPS ingester now extracts photos from ALL three record types —
> `nps:place:*` (already had photos), `nps:campground:*`, and `nps:park:*`.
> On TEST, 305 additional source_records gained `normalized_payload.photo`
> (5,181 total NPS with photos), and 192 master_place rows gained
> `photo_url` (7,443 total across all sources). **PROD numbers above are
> stale — they will rise once PR #298 merges and the PROD backfill runs**
> (`backfill:nps-photo -- --confirm` then `backfill:mp-enrichment --
> --confirm`).

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
  | usfs | ~~20~~ **3,188** (2026-08-31: +3,168 INFRA sites) |
  | yk_parks_campgrounds | 19 |
  | bc_parks | 8 |
  | curated_fuel | 3 |

  US (osm/nps/ridb/usfs/google) **and** Canada (Parks Canada, BC Parks, DataBC
  rec-sites/rest-areas, GeoYukon campgrounds) — a federated corridor.
- **Active corridor:** `la_to_deadhorse_full` (active, status `complete`, buffer
  80 km), envelope **`[-156.5, 33.5] → [-110.8, 70.4]`**. (`segment_a_la_pnw`
  also present, inactive/complete — the old bootstrap.)

## TEST — `znldzjdatkogdktymtvi` ("overlander-test")

> **⚠️ Data added 2026-09-02 `[TEST only]` — `utah_state_parks` source ingested.**
> New `source_id = 'utah_state_parks'` — visitor-facing content from
> stateparks.utah.gov for all 46 UT state parks (all 46 ingested; zero
> skips). Complements the existing `state_parks` GIS source. Per-state
> source_id in the OR/NV/AZ state-prefixed family (no `_web` suffix).
> **Hours/contact separated** from a contaminated hours field (41/46 had
> phone/management mixed in). Fire-stage boilerplate stripped via
> pattern match; 13 park-specific advisories retained. Zero coordinates
> in source data — geometry borrowed from `state_parks:UT:park:*` GIS
> records.
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'utah_state_parks'`) | **46** |
> | — with `description` (long-form "about" text) | **45** |
> | — with `hours` (separated from contaminated field) | **45** |
> | — with `contact` (extracted from hours or explicit block) | **43** |
> | — with `photo` (stateparks.utah.gov hero) | **46** |
> | — with `advisories` (park-specific NOTICE/Closure alerts) | **13** |
> | `place_match` confirmed | **46** |
> | `place_match` pending | **0** |
> | new `master_place` created | **0** |
>
> **Entity resolution:** 37 auto-linked via Phase 1 (17 direct RIDB,
> 20 redirected from state_parks-only mp to RIDB mp). 9 → manual_review
> via Phase 2, all confirmed as LINK by Adam (resolver
> `adam:ut-triage-2026-09-02`). 0 new master_places — all 46 matched
> existing entries. **46/46 confirmed, 0 pending, 0 rejected.**
>
> **Field precedence:** description priority 1 (above RIDB's 2),
> hours priority 3, contact priority 4 (below RIDB as fallback).
>
> **Photo wiring:** slot 11 in both `pois_along_corridor` and
> `master_place_search_export` CASE/IN lists. Attribution: `credit =
> "Utah State Parks"`, `license = "Utah State Parks"` — risk-acceptance,
> same posture as NV/AZ.
>
> **Six-state visitor-content set complete.** CA (283), WA (141),
> OR (192), NV (28), AZ (33), UT (46) = **723 total parks** across all
> six target states, all linked on TEST. PROD promotion requires
> Adam's explicit per-state sign-off.

> **⚠️ Data added 2026-09-02 `[TEST only]` — `arizona_state_parks` source ingested.**
> New `source_id = 'arizona_state_parks'` — visitor-facing content from
> azstateparks.com for all 33 AZ state parks (all 33 ingested; zero
> skips). Complements the existing `state_parks` GIS source (34 park
> units + 14 aggregated campgrounds for AZ). Per-state source_id in the
> OR/NV state-prefixed family (no `_web` suffix), separate from
> `state_parks_web` (CA), `state_parks_web_wa` (WA), `oregon_state_parks`,
> and `nevada_state_parks`. **Triage applied 2026-09-02 (later 2)** —
> both remaining pending matches resolved as LINK against corpus-side
> alternate targets (not the matcher's original proposals). See the
> "Triage" block below for the corrections.
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'arizona_state_parks'`) | **33** |
> | — with `description` (long-form "about" text) | **33** |
> | — with `hours` (freeform blob) | **29** |
> | — with `contact` (raw blob + parsed phone) | **33** |
> | — with `photo` (azstateparks.com hero) | **33** |
> | — with `fees` (freeform, normalized_payload only) | **31** |
> | — with `summary` (short lead blurb, normalized_payload only) | **33** |
> | — with `advisories` (park-specific alerts) | **3** |
> | `master_place_id` linked | **33 / 33** (all resolved after triage) |
> | — via ingest-time name link (direct: matched GIS park already had a mp) | **31** |
> | — via Adam-approved manual triage | **2** (both LINK against corpus-side alternate targets) |
> | `place_match` pending | **0** |
> | `place_match` rejected | **0** |
> | new `master_place` rows created by AZ | **0** (both triage LINKs went to existing mps) |
>
> **Triage (2026-09-02 later 2, `adam:az-triage-2026-09-02`):** both
> pending items had a better target hiding elsewhere in the corpus than
> the matcher's coordinate-nearest pick.
>
> 1. **`arizona_state_parks:colorado-river` → mp `48785379-779d-47ad-9088-539377ba6ebc`**
>    ("Colorado River State Historic Park", NPS-anchored `park_feature`,
>    exact-name match at 87 m). Matcher had proposed mp
>    `7bf97c6b-a517-4fcb-a5da-7934b795a490` (Yuma Quartermaster Depot SHP,
>    PADUS-only `public_land`, 6 m distance) — same physical site (per
>    the AZ visitor page's own opening line about being on the historical
>    Quartermaster Depot grounds), but the wrong mp: the NPS-anchored
>    exact-name mp is the right home. Duplicate-mp cleanup for the two
>    same-park entries filed in BACKLOG.md.
> 2. **`arizona_state_parks:fool-hollow` → mp `478b95d7-24cd-421c-97b1-c99c0439a9a2`**
>    (canonical_name still "Fool Hollow Lake Recreation Area Campground"
>    but `alternative_names` already contained "Fool Hollow Lake
>    Recreation Area" exactly; source_count 3 → 4 after AZ). Matcher had
>    proposed mp `44f648c1-c4d9-4e8b-ac04-3fa877404671` (Fool Hollow West
>    Launch Boating Site — a RIDB sub-facility inside the park), which
>    was wrong. Adding AZ did NOT shift canonical_name away from the
>    "…Campground" suffix — the underlying `recompute_master_place` still
>    resolves the canonical to the RIDB-owned name; the AZ park-unit's
>    "Fool Hollow Lake Recreation Area" name stays in
>    `alternative_names` only. Behavior confirmed post-recompute, not
>    assumed.
>
> **Post-triage attribution flow:**
> - mp `48785379`: `attribution.description` remains `nps` (NPS's editorial
>   description outranks AZ's per field_precedence — description NPS = 1,
>   AZ = 2); `attribution.hours` = `arizona_state_parks` (new field flowed
>   through); `attribution.contact` remains `nps`.
> - mp `478b95d7`: `attribution.description` remains `ridb` (RIDB
>   description wins over AZ); `attribution.hours` and
>   `attribution.contact` both = `arizona_state_parks` (AZ brought both
>   new fields into this mp).
>
> **Also filed in BACKLOG (out of scope for triage, tracked separately):**
> the two AZ GIS boundary records `state_parks:AZ:park:89946526…` and
> `state_parks:AZ:park:dd4e655a…` still show `master_place_id = NULL` —
> the AZ visitor ingest borrowed their geometry but never linked the GIS
> records themselves; a future GIS-side ER pass needs to attach them to
> `48785379` and `478b95d7` respectively.
>
> **Migration applied:** `20260902003400_arizona_state_parks_field_precedence` —
> 3 `field_precedence` rows: description (2), hours (3), contact (3).
> No `amenities` or `operational_status` rows — AZ pages have neither
> (not a policy choice; the data doesn't exist in the source pages —
> the 3/33 alerts are freeform prose, not a status enum).
> `20260902003300_arizona_state_parks_gis_index` — RPC that returns
> `state_parks:AZ:park:*` records with EWKT geometry, so the ingester
> can borrow a park boundary's centroid coordinates (AZ scrape has
> **0/33 lat/lon**; `source_record.geometry` is NOT NULL).
>
> **Photos wired into rendering.** `arizona_state_parks` added to both
> the `pois_along_corridor` and `master_place_search_export` photo
> lateral joins at priority **10** (slot 9 held by `nevada_state_parks`
> from PR #349 — merged to main first; AZ's CREATE-OR-REPLACE preserves
> NV's slot in the CASE / IN list). Credit renders as
> `"Arizona State Parks"`; license label `"Arizona State Parks"` —
> **not a public-domain grant.** azstateparks.com's own /privacy states
> photographs are NOT public domain and require written consent for
> use; Adam accepted the risk of URL-referencing (no warehousing) with
> `© Arizona State Parks and Trails` attribution, same posture as NV.
> Migrations: `20260902003500` (RPC), `20260902003600` (search export).
> Copyright string stored in `normalized_payload.copyright` on each
> source_record — no UI surface yet.
>
> **Name normalization at ingest** handled two known variants without
> falling to manual review: `San Rafael State Natural Area` (web)
> matched `San Rafael Ranch Natural Area` (GIS), and
> `Sonoita Creek State Natural Area` (web) matched `Sonoita Creek Natural
> Area` (GIS). Normalization key strips `state`/`ranch` tokens.
> `Havasu Riviera State Park` exists in GIS but has no visitor page —
> not touched by this ingest, remains a solo master_place on the GIS side.
>
> **Trademark note (no operational impact this pass):**
> `Kartchner Caverns State Park®` and `Kubla Khan®` carry federal
> trademark registrations per azstateparks.com/privacy. No special
> handling for now; flag for consideration before any marketing/hero
> surfacing.
>
> **Category inference:** AZ has no `type` column, so category is derived
> from name suffix — `recreation_area` (24) + `historic` (9). Historic
> covers the 7 explicit "State Historic Park" units + Riordan Mansion +
> Granite Mountain Hotshots Memorial.
>
> **Verified enrichment flow:** sampled 5 master_places show
> `attribution.description = "arizona_state_parks"`,
> `attribution.hours = "arizona_state_parks"`,
> `attribution.contact = "arizona_state_parks"`, with the raw
> azstateparks.com "about" prose (~800 chars – 3 kB) flowing through
> `recompute_master_place()`. Photo lateral verified populating on
> `master_place_search_export.photo_url` for all 5 sampled.

> **⚠️ Data added 2026-09-02 `[TEST only]` — `nevada_state_parks` source ingested.**
> New `source_id = 'nevada_state_parks'` — visitor-facing content from
> parks.nv.gov for all 28 NV state parks (all ingested; zero coordinate
> skips). Complements the existing `state_parks` GIS source (ArcGIS boundaries).
> Per-state source_id, following the OR precedent — state-prefixed, no
> `_web` suffix. Distinct from CA (`state_parks_web`) and WA (`state_parks_web_wa`).
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'nevada_state_parks'`) | **28** |
> | — with `description` (long-form "about" text, 2–8 KB per park) | **28** |
> | — with `photo` (parks.nv.gov gallery hero) | **28** |
> | — with `advisories` (residual after statewide-banner strip) | **1** (Valley of Fire — winter maintenance closure) |
> | — with `provenance.fees_raw` (marker for future re-scrape; nav-menu garbage, NOT surfaced) | **28** |
> | `master_place_id` linked | **28 / 28** (all resolved after triage) |
> | — via spatial containment (point-in-polygon vs NV `state_parks` GIS polygons) | **21** |
> | — via standard ER (`deterministic` new-master-place) | **4** |
> | — via Adam-approved manual triage | **3** (all LINK verdicts — Cave Rock into the Lake Tahoe NV `state_parks:NV:park:Cave Rock…` polygon; Old LV Mormon Fort and Spring Mountain Ranch into existing PADUS-anchored master_places. All 3 blocked by `name_dominant_low_conf` 0.60 cap and/or category-compatibility gaps — same shape as OR's 13 LINKs) |
> | `place_match` pending | **0** |
> | `place_match` rejected | **0** |
> | new `master_place` rows created | **4** |
>
> **⚠️ Search-activation follow-up (not fixed here):** the Old LV Mormon
> Fort master_place (`d331abb7…`) remains `is_searchable = false` and
> `primary_category = land_status` after triage, despite receiving a
> 2.7 KB description and source_count reaching 2. `recompute_master_place`
> doesn't appear to re-evaluate these fields when a non-`land_status`
> source_record is added to a PADUS-anchored mp. Result: parks.nv.gov
> content for Old LV Mormon Fort won't reach corridor search or Typesense
> sync until this is addressed. Not blocking this PR; filed in BACKLOG.md.
>
> **Fields intentionally NOT ingested:**
> - `hours`, `contact` — columns present in the source JSON but 0/28
>   populated. Following OR precedent, no `field_precedence` rows written.
> - `fees` — 28/28 populated but with the site nav-menu string ("Annual
>   Permits Concessions Discounts, Special Fees & Refunds Group Use &
>   Special Use Photography Permits Learn Back"), not real fee amounts —
>   upstream scraper bug (`sp_extract.py`). Real amounts do exist on the
>   pages ($5, $10, $15, $20 tiers seen on beaver-dam) but weren't
>   captured. Raw text parked in `normalized_payload.provenance.fees_raw`
>   as a marker for the future re-scrape; never surfaced. Tracked in
>   BACKLOG.md.
> - `amenities`, `operational_status`, `type`/`designation` — no columns
>   in the source data.
>
> **Migration applied:** `20260902003000_nevada_state_parks_field_precedence` —
> exactly **1** `field_precedence` row: `('description', 'nevada_state_parks', 2)`.
> The thinnest set among CA/WA/OR/NV (CA 5, WA 4, OR 3, NV 1). Reflects
> NV's honest content — description is the only field the scrape delivers
> at all completely.
>
> **Photos wired into rendering.** `nevada_state_parks` added to both the
> `pois_along_corridor` and `master_place_search_export` photo lateral
> joins at priority **9** (after `oregon_state_parks` at 8). Migrations:
> `20260902003100` (RPC), `20260902003200` (search export). Credit and
> license both render as `"Nevada State Parks"` — **NOT** the "government
> publication" framing CA/WA/OR use. parks.nv.gov carries no reuse-grant
> text and nv.gov's site-wide notice is "All Rights Reserved"; this is
> Adam's explicit risk acceptance, not a resolved license-clear
> determination. Tracked in BACKLOG.md. Photo-lateral wiring verified on
> TEST: `master_place_search_export` returns the parks.nv.gov gallery URL
> for 5/5 sampled linked NV mps; `pois_along_corridor` RPC over a
> Beaver-Dam-area route returns the park with `photo_credit = "Nevada
> State Parks"` and the correct URL.
>
> **Attribution flow verified.** `master_place.attribution.description =
> "nevada_state_parks"` on sampled linked mps (Berlin-Ichthyosaur SP:
> 4033-char description now sourced from `nevada_state_parks`, geometry
> and canonical_name still from `state_parks`).
>
> **Baseline / delta.** Pre-ingest TEST snapshot: `source_record` 185,748,
> `master_place` 161,427, `place_match` 171,678. Post-ingest+ER: 185,776
> (+28), 161,431 (+4), 171,706 (+28) — perfectly clean deltas, no
> unrelated drift.
> **⚠️ Data added 2026-09-02 `[TEST only]` — `oregon_state_parks` source ingested.**
> New `source_id = 'oregon_state_parks'` — visitor-facing content from
> stateparks.oregon.gov for all 192 OR state parks (all ingested; zero coordinate
> skips). Complements the existing `state_parks` GIS source (ArcGIS boundaries).
> Per-state source_id, separate from CA (`state_parks_web`) and WA
> (`state_parks_web_wa` on the wa-state-parks branch).
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'oregon_state_parks'`) | **192** |
> | — with `description` (long-form "about" text) | **192** |
> | — with `history` (separate history text, normalized_payload only) | **188** |
> | — with `photo` (stateparks.oregon.gov hero) | **191** |
> | — with `amenities` | **189** |
> | — with `accessible` (ADA-flagged subset, normalized_payload only) | **94** |
> | — with `operational_status` (RESTRICTED / CLOSED — non-Open values only) | **20** |
> | — with `reservation_url` (external booking, normalized_payload only) | **57** |
> | — with `overnight = true` (normalized_payload only) | **55** |
> | `master_place_id` linked | **192** (all resolved after triage) |
> | — via spatial containment (point-in-polygon vs state_parks GIS) | **107** |
> | — via standard ER (deterministic + name_dominant + close_nameless etc.) | **71** |
> | — via Adam-approved manual triage | **13** (all name_sim ≥ 0.629 with a real match blocked by combined-confidence threshold; abbreviations, category variations, and OSM naming drift) |
> | `place_match` rejected (wrong ER match) | **1** (`oregon_state_parks:197` HCRHT Bridge of the Gods ≠ HCRHT Cascade Locks — same category, different trailheads; new master_place created, same treatment as CA's Leland Stanford / Ishxenta rejects) |
> | new `master_place` rows created | **71** (70 from initial ER + 1 from the triage reject) |
>
> **Migration applied:** `20260902000000_oregon_state_parks_field_precedence` —
> 3 `field_precedence` rows: description (2), amenities (5),
> operational_status (2). No `hours` or `contact` rows — OR's CSV lacks
> dedicated columns for either (not a policy choice; the data doesn't exist
> in the source pages).
>
> **Photos wired into rendering.** `oregon_state_parks` added to both the
> `pois_along_corridor` and `master_place_search_export` photo lateral
> joins at priority **8** (slot 7 held by `state_parks_web_wa` from the
> pending WA branch — the migrations include it in the IN list so the
> CREATE-OR-REPLACE preserves WA when both PRs land). Credit renders as
> "Oregon State Parks"; license label
> `"Oregon State Parks — government publication"` follows the CA precedent
> per explicit direction, despite the licensing ambiguity flagged during
> the OR investigation (Oregon.gov terms of use grant no explicit reuse
> rights; unlike US federal works, OR state works are not public-domain
> by default). Migrations: `20260902000100` (RPC), `20260902000200`
> (search export).
>
> **Entity resolution completed in three phases** (mirrors the CA precedent).
> (1) Spatial pre-link: 107 records matched by point-in-polygon against
> existing OR `state_parks` GIS park boundary polygons (`data/scripts/or-state-parks-er.ts`;
> point-in-polygon in JS against polygons read from
> `state_parks.normalized_payload.geometry_polygon` — avoids needing a
> custom PostGIS RPC for polygon projection through PostgREST).
> (2) Standard `matchAll` for the remaining 85: 1 auto-link, 14 manual
> review, 70 new master_places (parks/trailheads/viewpoints/heritage
> sites without nearby GIS records).
> (3) Adam-approved manual triage of the 14: **13 linked** (perfect/near-perfect
> names blocked by combined-confidence threshold; abbreviations like
> `HCRHT ↔ Historic Columbia River Highway State Trail`, OR-specific
> naming drift like `Wayside ↔ State Park` on OSM, `Recreation Site ↔ State Park`
> on OSM, and one park_feature category mismatch for Erratic Rock SNS
> that ER's cat_compat scored 0.00) and **1 rejected** (`oregon_state_parks:197`
> HCRHT Bridge of the Gods Trailhead — genuinely distinct from OSM's
> "HCRHT Cascade Locks Trailhead" within the same town; new master_place
> created via `apply_match_outcomes(new_master_place)`). All linked mps
> recomputed. Verified 178/178 pre-existing confirmed place_match rows
> untouched by the triage.
>
> **Category inference:** OR has no `type` column (unlike CA), so
> categories are derived from name-suffix patterns in the ingester's
> `inferCategory()`. Ingest tally: recreation_area 59, park 56, viewpoint
> 18, public_land 36, historic 13, trailhead 7, campground 2,
> visitor_center 1. **5 ambiguous names** defaulted to `park` (logged as
> warnings by the ingester): Beaver Creek, Fort Rock Cave,
> Mongold (Detroit Lake), Smith Creek Village, South Jetty.
>
> **Verified enrichment flow:** sampled master_places linked via both
> spatial and standard ER show `attribution.description = "oregon_state_parks"`
> and `attribution.amenities = "oregon_state_parks"`, with the parks.oregon.gov
> long-form text (~1.5–3.5 kB per park) flowing through
> `recompute_master_place()`. `operational_status = "RESTRICTED"` observed on
> a "Reduction in Services/Facilities" park.

> **⚠️ Data added 2026-09-01 `[TEST only]` — `state_parks_web` source ingested.**
> New `source_id = 'state_parks_web'` — visitor-facing content from parks.ca.gov
> for all 284 CA state park units (283 ingested; 1 skipped for missing coordinates).
> Complements the existing `state_parks` GIS source (ArcGIS boundaries/points).
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'state_parks_web'`) | **283** |
> | — with `description` | **282** |
> | — with `photo` (parks.ca.gov hero, not wired to rendering) | **275** |
> | — with `hours` | **276** |
> | — with `contact.phone` | **267** |
> | — with `contact.address` | **58** |
> | — with `amenities` | **277** |
> | — with `operational_status` (CLOSED/RESTRICTED) | **32** |
> | — with `dogs` (full policy text) | **276** |
> | — with `fees` | **162** |
> | — with `advisories` | **26** |
> | `master_place_id` linked | **283** (all resolved) |
> | — via spatial containment (point-in-polygon) | **181** |
> | — via standard ER (deterministic + name_dominant) | **79** |
> | — via manual triage (Adam-approved) | **23** |
> | `place_match` rejected (wrong ER match) | **4** (2 relinked to correct target, 2 → new mp) |
> | new `master_place` rows created | **79** total |
>
> **Migration applied:** `20260901001000_state_parks_web_field_precedence` —
> 5 `field_precedence` rows: description (2), hours (3), contact (3),
> amenities (5), operational_status (2).
>
> **Photos wired into rendering.** `state_parks_web` added to both the
> `pois_along_corridor` and `master_place_search_export` photo lateral
> joins at priority 6 (after editorial_food, before else). 273 linked
> master_places now get their photo from `state_parks_web` — none
> outranked by a higher-priority source (these parks generally have no
> NPS/RIDB/Wikipedia photos). Credit renders as "California State Parks"
> via the existing `photoCredit` pipeline — no web-layer changes needed.
> Migrations: `20260901001100` (RPC), `20260901001200` (search export).
>
> **PROD STATUS 2026-09-02: NOT PROMOTED. `state_parks_web` does not exist on
> PROD.** Measured read-only this session against `nqzeywzcowujzyegxbsr`
> (`data/scripts/ca-prod-promotion-preflight.ts`): `source_record` rows for
> `state_parks_web` = **0**; `field_precedence` rows for `state_parks_web` =
> **0**. The TEST↔PROD `field_precedence` delta is **119 rows / 23 source_ids
> (TEST) vs 99 / 17 (PROD)** — the 20-row gap is exactly the six state-park web
> sources (CA 5, WA 4, OR 3, NV 1, AZ 3, UT 4), i.e. **none of CA/WA/OR/NV/AZ/UT
> has landed on PROD.** PROD is otherwise current: `master_place` and
> `master_place_search_export` have identical column sets on both DBs, and
> `master_place_photo_candidate` exists on PROD — so PROD carries every
> migration through `20260901000800`, and exactly the **20 state-park migration
> files** are pending.
> *(Scope: inferred from schema+data probes, NOT from a direct read of
> `supabase_migrations.schema_migrations` — no PROD ledger credential exists
> locally; `~/.config/overlander/prod-db-url` is absent, so `bin/preflight`
> skips its LEDGER check.)*
>
> **Substrate is ready; the ER outcome is NOT transferable.** PROD carries the
> identical CA GIS slice — `state_parks:CA:%` = **914** (394 park + 520
> campground), same as TEST — so the spatial pre-link phase has its substrate.
> But the surrounding corpus differs sharply: `master_place` **28,348 (PROD) vs
> 161,431 (TEST)**; `osm` **13,804 vs 109,492**; `ridb` **3,961 vs 6,013**;
> `usfs` **3,188 vs 6,330**; `blm` **0 vs 876**. Phase-2 standard ER resolves
> against that corpus, so PROD will produce a **different** match set, a
> different `new_master_place` count, and a **fresh manual-review queue** —
> TEST's 283/283 is not reproducible by replay. Compounding this: **CA's
> spatial pre-link script was never committed** (commit `379c213` touched only
> `matcher.ts` + docs), and the 23 TEST triage decisions reference TEST-only
> `master_place` UUIDs.
>
> **Typesense is a required promotion step, not optional.** `search:sync`
> (`data/search/sync-typesense.ts`) reads `master_place_search_export` and
> upserts into the collection named by `TYPESENSE_COLLECTION`. Live counts
> measured this session: `places_prod` = **21,965** docs, exactly matching
> PROD's `master_place_search_export` row count (**21,965**) — PROD search is
> currently in sync, and newly-promoted CA parks would be **unsearchable until a
> `search:sync` against `places_prod` runs**. Migration `20260901001200`'s own
> header documents this apply-path. Precedent both ways: the `editorial_food`
> promotion ran the sync (21,315 indexed); the `atlas_oddities` promotion
> **skipped** it and left PROD search AO-free.
>
> **⚠️ Data added 2026-09-01 `[TEST only]` — `state_parks_web_wa` source ingested.**
> New `source_id = 'state_parks_web_wa'` — WA counterpart to CA's `state_parks_web`.
> Per-state source_ids going forward (diverges from the shared `state_parks` GIS pattern).
>
> | metric | count |
> |---|---|
> | `source_record` rows (`source_id = 'state_parks_web_wa'`) | **141** (6 trail parks skipped — no coords) |
> | — with `description` | **141** (all) |
> | — with `photo` | **141** (all, wired into rendering) |
> | — with `hours` | **141** (all) |
> | — with `contact` (phone + email + address) | **~140** (1 missing contact) |
> | — with `amenities` | **141** (all) |
> | — with `dogs` / `dogs_allowed` | **~139** (extracted from rules) |
> | `master_place_id` linked | **141** (all resolved) |
> | — via spatial containment | **117** |
> | — via standard ER (deterministic) | **14** |
> | — via manual triage | **10** (9 linked, 1 rejected → new mp) |
> | new `master_place` rows created | **15** |
>
> **Migrations:** `20260901001300` (4 field_precedence rows — no operational_status,
> WA has no clean status signal), `20260901001400/001500` (photo lateral joins, priority 7).
> **Photos wired directly** — same pipeline as CA, "Washington State Parks — government publication".

> **Entity resolution completed in three phases.** (1) Spatial pre-link: 181
> records matched by point-in-polygon against existing `state_parks` GIS park
> boundary polygons (the standard 500m ER radius is too small for large parks
> whose GIS polygon centroids are 1-11 km from website coordinates).
> (2) Standard ER for the remaining 102: 4 auto-linked, 23 manual_review,
> 75 new master_places. (3) Manual triage of the 23 pending items: 19 linked
> (GIS name abbreviations like SB/SHP just under the auto-link threshold),
> 2 relinked to correct targets (Caspar Headlands SNR, Kings Beach SRA), 2
> rejected as false matches and given new master_places (Leland Stanford
> Mansion, Ishxenta). `CATEGORY_COMPATIBILITY` in `matcher.ts` was extended
> with `park`, `historic`, and `interest` entries — previously absent, which
> caused cat_compat=0 and blocked matching even on perfect-name-similarity
> pairs.

> **⚠️ Mutated 2026-09-01 `[queried + written, TEST only]` — SUPERSEDES the
> 2026-08-31 box directly below, which has been REVERTED.** PR #327's direct
> writes into `master_place.description` were undone (6,548 rows restored; the
> corpus returned to 115 empty-string descriptions and 19,688 searchable rows
> with a description — its exact pre-backfill state). The same text is now
> delivered through `source_record`. **Two new `source_id` values exist on
> TEST: `generated_llm` and `generated_template`**, at `field_precedence`
> (description) priority **20** and **21** — below every real source.
> **13,942 `source_record` rows added** (6,548 llm + 7,394 template), all
> pre-linked to their `master_place_id` and invisible to entity resolution.
> `source_record` total **171,184 → 185,126**, active **79,739 → 93,681**.
> **13,829 master_place rows now carry a generated description** with
> `attribution.description` = `generated_llm` / `generated_template`
> (6,541 llm + 7,288 template); searchable rows with a non-empty description
> **19,688 → 33,517**. **113 rows deliberately did NOT take generated text** —
> a real RIDB/NPS record resolves `description` to an empty JSON string and
> correctly outranks precedence 20/21.
> **Behaviour-neutral by measurement, not assumption:** average prominence over
> searchable rows is **0.8606 before and after**, and
> `master_place_search_export` holds **33,047 rows before and after**, because
> `compute_prominence()` and `recompute_master_place()`'s `source_count` now
> exclude generated sources via `is_generated_source()`.
> Two corpus columns moved as a side effect of `recompute_master_place()` being
> restored and then run over 13,942 rows: `sum(source_count)` **75,189 →
> 75,172** (stale values corrected; 0 mismatches remain among the rerouted set,
> 30 corpus-wide, all outside it) and `contained_in` edges in
> `place_relationships` **110,519 → 106,335** (Step 7 rewriting stale edges —
> see `docs/BACKLOG.md` for the corpus-wide recompute this argues for).
> `operational_status` set on **246** rows, unchanged from baseline (one row was
> lost mid-session to a wrong deviation and restored — see the report).
> **`places_test` was NOT re-synced**, so it still carries the pre-reroute
> `description` / `description_source`. Full report:
> `docs/measurements/2026-09-01-recompute-restore-and-description-reroute.md`.
> ADR: `docs/decisions/2026-09-01-generated-descriptions-as-lowest-precedence-source.md`.
> Corpus-wide totals in the boxes below are NOT re-measured here.
>
> **⚠️ REVERTED 2026-09-01 — superseded by the box above.** ~~Mutated 2026-08-31 (later) `[queried + written, TEST only]` —
> `master_place.description` gained 6,548 rows.** The generated-content
> copy-in backfill wrote `master_place_generated_content.generated_text`
> (`generation_method = 'llm'` only) into `master_place.description` for
> Population A's LLM half. Scoped counts measured this session:
> `master_place_generated_content` where `field_name = 'description'` =
> **17,725** (llm 7,433 / template 10,292; `needs_review = true` on **1**,
> which is outside Population A). Population A (`is_searchable`, empty
> description, has a generated row) = **13,942**: **6,548 llm** (written)
> + **7,394 template** (HELD — see `docs/BACKLOG.md`). Another 3,783 are
> "dual" rows that already had a description and were skipped. Searchable
> rows with a **non-empty** description now measure **26,236** (queried after
> the run). Pre-backfill that set was **19,688**, and **115** of the 19,803
> not-NULL rows were empty strings — both figures *derived from this session's
> own measurements* (26,236 − 6,548 written = 19,688; 19,803 − 19,688 = 115),
> not read off the earlier scoping doc.
> `attribution` was NOT written — measured convention is that
> `attribution.description` is always a `source_id` and is present on
> 19,803/19,803 pre-backfill not-NULL-description rows. Of the 6,548 written
> rows, **6,541 now hold a description with no `description` key in
> `attribution`** — a state that did not previously exist in this corpus — and
> **7** (5 `ridb`, 2 `nps`) carry a *stale* key from the clear-bug era, so they
> now present LLM-generated text under a RIDB/NPS attribution.
> `description_source` on these rows flips `'llm'` → `'source'`
> in both `pois_along_corridor` and `master_place_search_export`.
> **Typesense `places_test` was NOT re-synced** — it still carries the
> pre-backfill `description`/`description_source` for these rows. Undo
> snapshot:
> `~/.config/overlander/generated-content-copyin-snapshots/copyin-znldzjdatkogdktymtvi-2026-09-01T03-41-03-057Z.json`.
> Full report: `docs/measurements/2026-08-31-generated-content-copyin-backfill.md`.
> Corpus-wide totals in the boxes below are NOT re-measured here.~~
>
> **⚠️ Re-measured 2026-08-29 `[queried TEST, read-only]` — adds a new
> `tasteatlas` publisher to `editorial_food`; does NOT re-measure the
> corpus-wide totals in the box below (those stand until someone
> re-measures them).** `docs/LOG.md` §2026-08-29 has the full build
> narrative (six states, screenshot-sourced, geocode/description/photo
> pipeline). `source_record` where `source_id = 'editorial_food'`:
> **568 total** — 497 `publisher_slug = 'tasteatlas'` (this session) + 71
> from the five publishers PR #317 originally landed
> (beyondthejourney/familyvacationsus/altaonline/provokelifestyle/everafterinthewoods).
> `family_destinations` unchanged at 14 (already counted in the box
> below). ER on the tasteatlas rows: 478 `new_master_place` + 19
> `manual_review`, 0 errors. Typesense `places_test` post-sync: 33,287
> documents.
>
> **⚠️ Re-measured 2026-08-21 `[queried TEST, read-only]` — SUPERSEDES every
> box below for totals.** Six-state state-boundary rebuild (real TIGER/Line
> point-in-polygon, replacing the old bbox classifier corpus-wide), the
> NONE-bucket template-description pipeline (10,292 rows, two backfill/fix
> rounds), the eligibility change folding template descriptions into
> STRONG, the `description_source` provenance field, the `needs_review`
> flag mechanism, and the Typesense sync fix. No PROD touched. Full
> session narrative: `docs/STATE.md` §2026-08-21. Current TEST:
>
> | metric | value |
> |---|--:|
> | `master_place` | **160,703** |
> | `source_record` total (all / active) | **170,428 / 78,983** |
> | `place_match` total / pending | 170,454 / **5,065** |
> | `master_place_search_export` (view) | **32,734** |
> | `master_place` with `source_count = 0` | **89,815** |
>
> **`source_record` by `source_id` (active / all):** osm **19,411 /
> 109,492** · padus **36,358 / 37,701** · usfs **6,324 / 6,330** · ridb
> **6,005 / 6,013** · nps **5,283 / 5,283** · atlas_oddities **2,870 /
> 2,870** · state_parks **1,736 / 1,736** · blm **869 / 876** ·
> google_resolved 122 / 122 · google 5 / 5. osm's active/all gap widened
> further from the prior 2026-08-20 box (22,977 → 19,411 active) — this
> session's corpus-wide placeholder-name deactivation pass (3,516 rows,
> all categories, NONE-bucket + exact-literal placeholder name) landed on
> top of the two 2026-08-20 category-scoped passes.
>
> **`master_place.state` — real TIGER/Line point-in-polygon, corpus-wide**
> (new column this session, backfilled once, NOT a live-recomputed field —
> see `docs/decisions/2026-08-21-template-eligibility-provenance-review-decisions.md`
> §1): **null 128,210** (out-of-scope / land_status / unresolvable-geometry
> rows — this is corpus-wide, not the in-scope 32,734) · **CA 13,380** ·
> **OR 5,317** · **WA 4,828** · **UT 3,953** · **AZ 3,863** · **NV 1,152**.
> Sums exactly to `master_place` total (128,210 + 32,493 = 160,703).
>
> **STRONG/WEAK/NONE, in-scope population, current `eligibility.ts`
> (including the new `has_template_description` signal):** **STRONG
> 32,399 · WEAK 100 · NONE 235**, total 32,734. Before the eligibility
> change (`has_template_description` forced off, computed in the same
> pass): STRONG 22,107 · WEAK 100 · NONE 10,527 — WEAK is unchanged either
> way, confirming no WEAK-bucket row carries template content.
>
> **`description_source` distribution on the view (fresh):** **source
> 15,582 · template 8,535 · null 8,617** (sums exactly to 32,734). No
> `llm` rows exist yet. Cross-check: `10,292 − 8,535 = 1,757` matches the
> independently-measured "dual" row count (real `master_place.description`
> non-null AND a template row present, `description_source` resolves to
> `'source'`) exactly.
>
> **`master_place_generated_content`:** **10,292** rows total, all
> `generation_method='template'` (0 `llm`). **`needs_review=true`: 1** —
> the Astoria Column, flagged this session as the first real exercise of
> the mechanism.
>
> Full detail: `docs/measurements/2026-08-21-state-boundary-fix-all-six-states.md`,
> `docs/measurements/2026-08-21-eligibility-provenance-review.md`,
> `docs/measurements/2026-08-21-typesense-description-source.md`, and the
> three-part / stale-template cleanup docs from the same date.

> **⚠️ Re-measured 2026-08-20 `[queried TEST, read-only]` —
> SUPERSEDED by the box above for totals; kept for the incremental
> history.** Every
> box below for totals.** Investigation-and-fix session: BLM/RIDB eligibility
> signal fixes + backfill, an OSM NONE-bucket investigation (no corpus
> writes), and two placeholder-name deactivation passes (picnic_area,
> ev_charging) using the same mechanism as Phase 0's peak/spring
> deactivation. No PROD touched. Full session narrative:
> `docs/STATE.md` §2026-08-20. Current TEST:
>
> | metric | value |
> |---|--:|
> | `master_place` | **160,703** |
> | `source_record` total (all / active) | **170,428 / 82,564** |
> | `place_match` total / pending | 170,454 / **5,065** |
> | `master_place_search_export` (view) | **36,250** |
> | `master_place` with `source_count = 0` | **86,299** |
>
> **`source_record` by `source_id` (active / all):** osm **22,977 / 109,492**
> · padus **36,358 / 37,701** · usfs **6,324 / 6,330** · ridb **6,013 /
> 6,013** · nps **5,283 / 5,283** · blm **876 / 876** · atlas_oddities
> **2,870 / 2,870** · google_resolved 122 / 122 · google 5 / 5.
>
> **Two placeholder-name deactivation passes this session** (TEST only, same
> mechanism as the 2026-08-18 peak/spring deactivation below —
> `source_record.is_active = false` → `recompute_master_place()` → dangling
> `place_match` cleanup, scoped to exact-literal `canonical_name` match AND
> NONE-bucket only):
>
> | category | total rows | `source_count = 0` after | deactivated this session |
> |---|--:|--:|--:|
> | picnic_area | 4,668 | 3,427 | **3,427** |
> | ev_charging | 3,634 | 748 | **748** |
>
> Full detail (placeholder-pattern investigation, before/after verification,
> generation-exclusion spot-checks):
> `docs/measurements/2026-08-20-unnamed-picnic-area-deactivation.md`,
> `docs/measurements/2026-08-20-unnamed-ev-charging-deactivation.md`.
>
> **BLM/RIDB eligibility fixes** (code uncommitted as of this doc pass — see
> `docs/STATE.md` §2026-08-20) flipped **273 rows out of the NONE bucket
> corpus-wide** (265 BLM `contact.website` + 8 RIDB `has_real_directions`) —
> this is a bucketing-signal change, not a row-count change, so it doesn't
> move any of the totals above.
>
> osm's active/all gap (22,977 / 109,492) is wider than any prior box in this
> doc — the cumulative effect of this session's two deactivation passes on
> top of prior sessions' category curation (peak/spring, fire_pit,
> toilet/water/dump_station narrowing, viewpoint filtering). Not a single
> clean number to attribute to one operation; see `docs/STATE.md`'s dated
> sections for the incremental history.

> **⚠️ Re-measured 2026-08-17 (later) `[queried TEST, read-only]` — SUPERSEDES
> every box below for totals.** Six-state NPS ingest (all 91 park codes) +
> live materialize of the seven NPS categories; park_feature-linking guard (#234)
> + `/parks` wiring (#235) merged. No PROD touched. Current TEST:
>
> | metric | value |
> |---|--:|
> | `master_place` total | **155,495** (150,844 → +4,651 from the NPS materialize) |
> | `source_record` total (all / active) | **165,945 / 165,939** |
> | `place_match` total / confirmed / pending | 165,292 / 159,188 / **6,102** |
> | `master_place_search_export` (view) | **117,261** |
> | Typesense `places_test` | **117,261** (was 14,911 — the 2026-08-10 state; **not synced since 2026-08-10**, so OSM/PAD-US/BLM never reached search until this run) |
> | synthetic `"NPS park boundary:"` master_places | **0** |
>
> **`source_record` by `source_id` (active / all):** osm **109,615** · padus
> **37,701** · usfs **6,324 / 6,330** (6 legacy `usfs:recarea` inactive) · ridb
> **6,013** · **nps 5,283** (was 83) · **blm 876** (new to this inventory) ·
> google_resolved 122 · google 5 · parks_canada 0 · bc_parks 0. Active +6,076
> over the 2026-08-16 box's 159,863 = NPS +5,200 + BLM +876, exactly.
>
> **NPS 5,283** by `inferred_category`: park 91 · picnic_area 56 · visitor_center
> 169 · viewpoint 231 · trailhead 243 · campground 258 · **park_feature 4,235**.
> Resolved **4,987** (own-MP/`new_master_place` 4,705 · shared-MP/`auto_link`+
> `amenity` 282); pending **296** (blended_residual 122 · close_nameless 78 ·
> name_dominant_low_conf 96), of which **10** are `park_feature` predating the
> guard. Migration `20260817120000` (`resolve_place_match`) remains **TEST-only**.

> **⚠️ Re-measured 2026-08-17 `[queried TEST, read-only]` — ~~SUPERSEDES the
> 2026-08-16 box below for totals~~ SUPERSEDED by the 2026-08-17 (later) box
> above.** All four USFS categories materialized live
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

### `master_place_photo_candidate` — NEW 2026-09-01; TEST staging + **now on PROD (7 rows, 3 wired)**

Created by migration `20260901000600_master_place_photo_candidate.sql` for the
CA-campground photo-backfill pilot. Staged, license-clear photo candidates with
full provenance (`source`, `image_url`, `license`/`license_class`, `attribution`,
`source_page_url`, plus match signals). RLS enabled, zero policies (service-role
only). **Deliberately NOT read by `recompute_master_place` /
`pois_along_corridor` / `master_place_search_export` / `field_precedence`** —
candidates are held for review, never auto-surfaced on cards. Promotion into a
live read path is a separate, explicitly authorized step.

**PROD promotion (2026-09-01, explicit sign-off — LOG later 10).** Migrations
`…000600/000700/000800` applied to PROD; the table now exists there too. The
Google-verified accepted set (`ca-campground-2026-09-01-fixed`, 10 rows / 7
places) was matched TEST→PROD by **stable source identity** (never raw uuid) and
**7 rows across 5 places** were copied into PROD `master_place_photo_candidate`
as provenance. Of the 7 places: 2 unresolved on PROD (Aikens Creek, Tolkan —
their TEST `ridb:facility:<int>` ids do not exist on PROD, whose RIDB
external_ids are UUIDs; neither is in PROD's searchable export), 2 already had a
`wikipedia` photo (Albion, Half Moon Bay), and **3 were wired live** by upserting
a `wikipedia` `source_record` with `normalized_payload.photo` (the proven
`backfill-wikipedia-photo.ts` path — the corridor RPC lateral join reads it; no
RPC change, no recompute): **Bunny Flat** (`Mount_Shasta_as_seen_from_Bunny_Flat.jpg`,
CC BY-SA 4.0), **Fort Miller** (1936 HABS crop, PD), **Sugarloaf** (`LaserSETIRFO.jpg`,
CC BY 4.0), external_ids `wikipedia:photo-pilot:<file>`. Verified via
`pois_along_corridor` on PROD. Fort Miller + Sugarloaf are weak heroes (see
`docs/BACKLOG.md`) and prunable by deleting their `wikipedia:photo-pilot:*` row.
Compliance: no Google image data persisted (candidates are Commons only).

Current run `ca-campground-2026-09-01-fixed` (after the six-issue self-audit
fixes; the prior flawed `ca-campground-2026-09-01` rows were deleted first).
Stratified deterministic sample (ordered by id, 40 target places per
mutually-exclusive source tag = 160 of 2,053 zero-coverage CA campgrounds):
**253 rows stored across 69 distinct places** — **4 `accepted`, 249
`manual_review`**. Source: 207 wikimedia_commons_geo, 46 wikimedia_commons_text,
0 nps (NPS produced no photo that passed the tightened bar in this sample).
License class: 189 attribution (CC-BY / CC-BY-SA), 64 public-domain (CC0 / PD /
PD-* templates). All 4 accepted images were visually inspected. See
`docs/decisions/2026-09-01-photo-backfill-pilot-staging-table.md` and
`docs/LOG.md`. All figures measured in-session; NOT re-run corpus-wide.

Prior flawed run (`ca-campground-2026-09-01`, non-deterministic sample) stored
277 rows / 6 accepted / 271 manual before deletion; its counts are NOT directly
comparable — a different set of 160 places was sampled (unordered pagination).

**Google-verified auto-adjudication (2026-09-01).** Migration `20260901000700`
added `google_verdict` / `google_confidence` / `google_reasoning` /
`google_ref_source` / `google_checked_at` and widened `match_status` to allow
`rejected`. All 253 rows were re-adjudicated by comparing each stored candidate
photo against a **live** Google reference photo (Places API New → vision model
`claude-opus-5`). Final state (measured in-session): **match_status** accepted
**10**, rejected **235**, manual_review **8**; **google_verdict** match 10,
no_match 193, ambiguous 42, no_google_result 5, unverified 3. `no_match` and
`ambiguous` → `rejected`; the 8 couldn't-verify rows (5 no_google_result +
3 error) were **left at their prior status**, not rejected. **Compliance
verified:** a scan of every text column of every row found **zero** Google
URLs / photo ids / image data — only verdict text + the generic
`google_ref_source='google_places_text_search'` label are stored; `image_url`
remains 100% Commons/NPS/RIDB. Google reference images were held in memory for
the comparison only and never persisted.

**NPS-direct pass (2026-09-01).** Migration `20260901000800` adds `no_candidate`
to the `match_status` CHECK and makes `image_url` NULLABLE (a no_candidate row
has no image). Targets NPS-sourced CA campgrounds with no baked photo, matched to
their NPS unit by the structured `nps:campground:<id>` from `external_id`. Target
set measured = **1** ("Prisoners Harbor Campground"); its NPS id no longer
resolves in the current NPS API (unit removed upstream), so it stored as
`pilot_run='nps-direct-2026-09-01'`, `source='nps'`, `match_status='no_candidate'`,
`image_url=NULL`. Zero accepted this pass.

**RIDB-direct pass (2026-09-01).** Same pattern for `source='ridb'` CA
campgrounds with no baked photo, matched by `ridb:facility:<FacilityID>` from
`external_id`, querying the live RIDB media endpoint. Target set measured =
**163** (of 724 CA campgrounds with a RIDB source_record). **All 163 →
`no_candidate`** (`pilot_run='ridb-direct-2026-09-01'`, `source='ridb'`,
`image_url=NULL`): every facility resolved but returned zero media — RIDB's live
API has no photos for these campgrounds. 0 accepted, 0 manual_review, 0 stale-id.
A rights classifier (federal-credit → accept; individual/empty credit →
manual_review) was built but never fired (no images). Reused the `no_candidate` +
nullable `image_url` schema from `20260901000800` — no new migration.

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
| `places_prod` | ~~13,629~~ ~~16,661~~ ~~16,516~~ **21,965** (2026-08-31: +USFS INFRA, −CLOSED exclusion) | PROD (Vercel `NEXT_PUBLIC_TYPESENSE_COLLECTION=places_prod`) |
| `places_test` | ~~1,749~~ ~~14,911~~ **33,047** (2026-08-31) | dev (`web/.env.local`) + `data/.env` |

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
