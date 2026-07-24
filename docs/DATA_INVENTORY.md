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

Small and **not representative of coverage.** It was **wiped 2026-06-03 by
`reset_phase3a_test_state`** — that is why it is tiny, not because the corpus is
SoCal-only. (Treating TEST as the corpus is what drove several wrong "corpus is
SoCal-only" conclusions this session; it isn't — PROD is.)

- **master_place:** 1,860 total · 1,749 searchable · 111 non-searchable
  (≈ the PADUS land-status polygons).
- **Searchable latitude range:** 33.8 → 34.4 (1,749 rows) — the LA/Joshua-Tree
  reseed only.
- **source_record:** 10,889 total, by `source_id`: `osm 10,674 · padus 113 ·
  nps 83 · ridb 8 · usfs 6 · google 5`.
  - ⚠ **`osm` is inflated:** ~**8,653 of the 10,674 are UNRESOLVED OSM
    source_records from an aborted Slice-1 corridor run** (baseline osm ≈ 2,021).
    `materialize` never ran, so `master_place` is unchanged (still 1,860). These,
    plus the leftover active corridor below, are reversible via
    `npm run -w data slice:rollback` against the STEP-0 snapshot.
- **Active corridor:** `segment_a_la_pnw`, status **`ingesting`** (never reset
  after the Slice-1 run was killed), envelope `[-119.1, 33.3] → [-112.6, 37.8]`.

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
| `places_prod` | 13,629 | PROD (Vercel `NEXT_PUBLIC_TYPESENSE_COLLECTION=places_prod`) |
| `places_test` | 1,749 | dev (`web/.env.local`) + `data/.env` |
| `places` | 1,749 | **old shared collection — now UNUSED**, left in place, safe to delete once confirmed |

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
