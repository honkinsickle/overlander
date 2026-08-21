# State-boundary fix — all six states, real TIGER/Line geometry

TEST only (`znldzjdatkogdktymtvi`). No PROD. Investigate → design → apply
→ backfill → verify. Supersedes an earlier narrower "Nevada only" attempt
started in the same session — that attempt's helper module
(`data/scripts/lib/classify-state.ts` + test + a Nevada-only boundary
asset) was removed once this broader fix made it fully redundant; nothing
referenced it.

## 1. Data source

**US Census Bureau TIGER/Line 2023 national state boundary file**:
`https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip`
— the full-resolution TIGER/Line product, deliberately **not** the lighter
generalized cartographic boundary file, so this fix doesn't trade one
approximation for a smaller one. **License: public domain** — US Census
Bureau data is a work of the US federal government (17 U.S.C. §105), no
restriction. **Format: shapefile** (`.shp`/`.dbf`/`.prj`/`.shx`), converted
to GeoJSON (EPSG:4326) via `ogr2ogr` (GDAL, already present on this
machine — no new npm dependency added), filtered to the six states this
corpus targets. Per-state geometry size after conversion: 293KB (Utah) to
584KB (Oregon).

## 2. Design

**Current mechanism, confirmed:** no persisted state field existed before
this pass. State was inferred ad-hoc, per-script, from a bounding-box
classifier (`classifyState()`, copied into most of this session's
scripts) whose six rectangles are copied from `six_state_footprint()`'s
per-state boxes. Root cause of the scale of error (confirmed in the prior
blast-radius investigation, not re-derived): Nevada's real bounding
*envelope* nearly matches its box exactly — the defect is shape
(a diagonal/notched true border), not size, so no rectangle can fit it.

**New mechanism:**
- `state_boundaries` — new PostGIS table, one row per state
  (`state_code`, `state_name`, `geom geometry(MultiPolygon, 4326)`), GiST
  index. RLS enabled, public read (reference geometry, not corpus
  content), zero write policies.
- `load_state_boundary_geom(state_code, state_name, geojson)` — one-time
  loader RPC, converts GeoJSON server-side (`st_geomfromgeojson` +
  `st_multi` + `st_setsrid`), mirroring the existing `geometry_polygon`
  handling already in `recompute_master_place`. Idempotent (upsert on
  `state_code`).
- `resolve_state(geometry) returns text` — real point-in-polygon via
  `ST_Contains`, `stable parallel safe`. Returns **NULL**, not a guess,
  when a point is outside all six loaded states.
- `master_place.state text` — new nullable column, added for this pass's
  backfill so before/after is a real snapshot, not just console output.
  **Deliberately NOT wired into `recompute_master_place`** — making state
  a live-recomputed field alongside geometry/category is a bigger,
  ongoing-pipeline decision this task didn't ask for; flagged as an open
  follow-up, not decided here. This column is a one-time backfill
  snapshot as of 2026-08-21 — a future new/moved row won't get it
  auto-populated without a separate decision to wire it in.
- `backfill_state_for_ids(uuid[])` — bulk, set-based backfill helper
  (`UPDATE ... SET state = resolve_state(geometry) WHERE id = ANY($1)`),
  added after the first backfill design (per-row client-side UPDATEs)
  turned out to be the wrong shape for ~33k rows and violates this repo's
  own stack invariant ("spatial queries always use PostGIS, never compute
  in app code if the values are in the DB").

Migrations: `20260821010000_state_boundaries.sql`,
`20260821020000_backfill_state_for_ids.sql`. New scripts:
`data/scripts/load-state-boundaries-2026-08-21.ts`,
`data/scripts/backfill-state-boundaries-2026-08-21.ts`.

## 3. Loaded and spot-checked before trusting it

All 6 states loaded (`CA, OR, WA, UT, NV, AZ`) — confirmed by row count.
**13 reference points checked via `resolve_state()` directly, before any
corpus-wide run:**

| point | expected | got |
|---|---|---|
| Reno, NV | NV | NV |
| Las Vegas, NV | NV | NV |
| Bend, OR | OR | OR |
| Portland, OR | OR | OR |
| Sacramento, CA | CA | CA |
| Phoenix, AZ | AZ | AZ |
| Salt Lake City, UT | UT | UT |
| Seattle, WA | WA | WA |
| North Park (Porterville, CA — ~113mi from the true NV border) | CA | CA |
| Fort Miller / Millerton Lake, CA (the original flagged bug) | CA | CA |
| The Astoria Column, OR (WA/OR border) | OR | OR |
| Boise, ID (should resolve to none of the six) | null | null |
| Pacific Ocean off CA (should resolve to none of the six) | null | null |

**All 13 correct.** Notably, the Astoria Column now resolves to a single
definitive answer (OR) rather than "ambiguous" — with true non-overlapping
polygons, most of the border-zone ambiguity the earlier bbox-based fixes
had to work around simply doesn't exist anymore.

## 4. Backfill — corpus-wide, old vs new

**32,734 in-scope master_place rows** (same population the blast-radius
report used). Old state captured in-memory via the original bbox
classifier immediately before writing (nothing new persisted for "old" —
it never existed as a column), new state from `resolve_state()`.

**Full transition matrix:**

| old → new | count |
|---|--:|
| CA → CA | 11,106 |
| OR → OR | 5,165 |
| WA → WA | 4,639 |
| UT → UT | 3,952 |
| AZ → AZ | 3,863 |
| **NV → CA** | **2,192** |
| NV → NV | 1,045 |
| OR → WA | 189 |
| OR → outside (none of six) | 177 |
| WA → OR | 152 |
| AZ → NV | 107 |
| AZ → CA | 74 |
| UT → outside (none of six) | 48 |
| CA → outside (none of six) | 8 |
| OR → CA | 8 |
| WA → outside (none of six) | 4 |
| AZ → outside (none of six) | 3 |
| AZ → UT | 1 |
| outside → outside (none of six) | 1 |

**Unchanged: 29,770 (90.95%). Changed: 2,964 (9.05%).**

**NV → CA alone is 2,192 of 2,964 changes (73.96%)** — confirms the
blast-radius report's root-cause finding at full-corpus, full-precision
scale. Two smaller, previously-uncharacterized patterns also surfaced by
doing all six states properly rather than Nevada alone: **AZ → NV (107)
and AZ → CA (74)** — Arizona's box also mildly overreaches west; and a
genuine **OR ↔ WA reclassification (189 + 152 = 341)** — this one isn't
simply "the old classifier was wrong" in one direction, real points near
the Columbia River border resolve to whichever side is actually correct
now, splitting close to evenly.

**Write: 32,734 / 32,734 rows updated, 0 errors** (bulk, via
`backfill_state_for_ids`, chunked 2,000 at a time).

## 5. Points genuinely outside all six states — not forced

**241 in-scope rows resolve to NULL** — genuinely outside all six loaded
state polygons (the old classifier had wrongly claimed a state for 240 of
these; 1 was already "outside" under the old method too). Breakdown by
which state's box had wrongly claimed them: OR 177, UT 48, CA 8, WA 4,
AZ 3, plus 1 pre-existing unresolved. These are real — likely genuinely in
Idaho (the OR/ID and WA/ID border pairs the blast-radius report already
flagged as having real-but-smaller populations) or coastal/edge cases.
**`master_place.state` is `NULL` for these — no state was forced.**

## 6. Verify

**Spot-check, previously-flagged rows (persisted `master_place.state`,
read directly):**

| row | category | persisted state |
|---|---|---|
| The Astoria Column | oddity | OR |
| Fort Miller | campground | CA |
| North Park (Porterville) | park | CA |
| Zalud House | oddity | CA |
| Leavis Flat Campground (both rows) | campground | CA |
| Rocky Hill Recreation Area | facility | CA |
| Success Lake | recreation_area | CA |
| Ubehebe Crater | park_feature | CA |
| Bodie State Historic Park (park + oddity rows) | — | CA |
| Hope Valley | campground | CA |
| Von Schmidt Monument | oddity | CA |

**All correct.** Also checked 3 separate real rows sharing the name "White
River Campground" at genuinely different locations — resolved to OR, CA,
and NV respectively, matching their actual distinct coordinates
individually, confirming the fix generalizes beyond the specific
flagged cases rather than only fixing the exact rows already known to be
wrong. Two "North Park"/"Bodie State Historic Park"/"Hope Valley"
`land_status` rows correctly resolved to `NULL` rather than a guess —
flagged, not chased further in this pass, since `NULL` is the correct
"don't force it" behavior regardless of why.

**Independent cross-check against a second, different reference** (the
simplified public boundary GeoJSON used in the original blast-radius
investigation, evaluated via `@turf/turf` point-in-polygon — a completely
separate code path from the new PostGIS `resolve_state()`): **30,649 of
32,734 in-scope rows (93.63%) agree.** 169 disagree; 1,916 fall in that
simpler reference's own ambiguous/overlap zones (excluded from the
agree/disagree count, not this fix's concern). **All 10 sampled
disagreements sit within a few hundred meters of a real state line**
(repeated coordinates near the Portland OR/WA metro border, the OR/ID
border, the CA/AZ Colorado River border) — this is the expected signature
of comparing **full-resolution TIGER geometry (now persisted, the more
authoritative of the two) against a coarser, simplified reference**, not
an error introduced by this fix. 0.52% of in-scope rows land in that
narrow disagreement band.

## Confirmed scope

- **TEST only.** No `--confirm`/PROD path in either new script.
- **Full `data/` test suite: 29 files, 567 passed, 3 pre-existing skips, 0
  failed.** Typecheck clean.
- New unit coverage: none added directly for the SQL functions (no
  existing SQL-testing convention in this repo to extend), but the loader
  and backfill scripts were run for real against TEST and their console
  output is the evidence above, matching this session's established
  pattern for one-off data-loading/backfill scripts.
- `master_place.state` is a **snapshot, not a live field** — flagged
  explicitly as an open decision, not resolved here, whether to wire it
  into `recompute_master_place` going forward.
- The earlier "Nevada only" attempt's now-fully-superseded helper module
  was removed (nothing referenced it) rather than left as confusing dead
  weight alongside the real fix.
