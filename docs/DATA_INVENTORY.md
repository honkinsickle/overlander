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
| `places_prod` | 13,629 | PROD (Vercel `NEXT_PUBLIC_TYPESENSE_COLLECTION=places_prod`) |
| `places_test` | 1,749 | dev (`web/.env.local`) + `data/.env` |

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
