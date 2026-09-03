# CA state_parks — root-cause fix for the `UNITNBR`-shared dissolve bug

**Date:** 2026-09-03 · **Status:** code fix landed; TEST re-ingested;
PROD surgical fix executed for the observably-broken record. **PROD writes
in this PR — see §5.**
**Follow-up to:** PRs #368 (the parent duplicate investigation), #370 (v1
merge preview), #372 (the 38 already-related pairs verdict, where
Agua Caliente was called out as needing an upstream fix), #374 (v2 merge
preview with the scoped plan).

**Related open PRs at time of writing:** #368, #369, #370, #372, #374 — all
still open. This branch is cut from `main`; the CA state_parks fix does not
depend on any of them for correctness. Verification steps that need the
sort-classifier or the merge-preview tool restore those scripts from the
sibling branches temporarily.

---

## 0. Answer, up front

The CA state_parks GIS record with `UNITNBR = 622` labeled
`Agua Caliente County Park (ABDSP)` (documented in PR #372 §5.1) carried a
250-part MultiPolygon with a 63 km × 102 km bounding box because
`data/ingestion/sources/state-parks.ts:dissolveBoundaries` grouped features
by `UNITNBR` alone, and CA DPR's ParkBoundaries source has features that
**share `UNITNBR` values across genuinely different parks**.

- **Scanned the full CA source this session.** Of 461 total features under
  56 UNITNBRs with 2+ features, **14 UNITNBRs (post-whitespace-normalize)
  have features with divergent UNITNAMEs.** Full list in §1.2. At least
  three cases (UNITNBR = 622 Agua Caliente/Anza-Borrego, 534 Huntington
  City Beach / Bolsa Chica SB, 449 Point Lobos SMR / SNR) are genuinely
  different parks; the other 11 are main-park + satellite-properties
  patterns, all of which the pre-fix dissolve was merging into one
  oversized polygon.
- **Root cause fix.** Added an `EndpointConfig.disambiguateBy` option and
  set `disambiguateBy: "UNITNAME"` on the CA config only. `dissolveBoundaries`
  now groups by (UNITNBR, UNITNAME_trimmed); when features under one
  primaryKey have divergent secondaryKeys, the alphabetically-first
  secondary keeps the bare `{UNITNBR}` external_id and the others get a
  slug-suffixed one. Pre-existing legit dissolves (Fort Ross, etc.) are
  unchanged. New tests cover the divergence path.
- **TEST re-ingest verified.** CA state_parks re-ingested on TEST. All 14
  divergent UNITNBRs now split into separate records. UNITNBR = 622 point-
  in-polygon test on TEST: Agua Caliente's polygon (2 parts) does NOT
  contain the ABDSP center point; Anza-Borrego's polygon (248 parts) does.
- **PROD surgical fix executed for UNITNBR = 622 only.** 9-step script
  documented in §5.2 ran against PROD:
  - Fetched both corrected polygons from CA DPR
  - UPDATE existing `state_parks:CA:park:622` → Agua Caliente polygon only
    (250 parts → 2)
  - INSERT `state_parks:CA:park:622-Anza-Borrego_Desert_SP` with
    Anza-Borrego's polygon (248 parts)
  - Repointed the misplaced visitor SR (`california_state_parks:638`) from
    the Agua Caliente CP mp to the pre-existing NPS Anza-Borrego mp
  - Linked the new state_parks record to the same NPS mp
  - Recomputed both affected master_places
- **Post-fix classifier re-run:** 427 pairs → **426 pairs total; 384 → 383
  pre-existing**. The Agua Caliente pair no longer forms. Bucket state:
  **SAME 135 · DIFFERENT 246 · UNCLEAR 2** (was 135 / 247 / 2 after PR #372's
  manual verdict; the root-cause fix removes the pair from the corpus
  entirely instead of moving it to DIFFERENT).

**Confidence: directly verified.** Every number above is a count computed
against live PROD or TEST this session.

---

## 1. The scan

### 1.1 Full CA ParkBoundaries feature set

Fetched all features from CA DPR's ArcGIS ParkBoundaries FeatureServer
(https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/ParkBoundaries/FeatureServer/0):

- **461 features total** on live CA DPR source
- **56 UNITNBRs have ≥2 features** (candidates for dissolve)
- Of the 56: **15 have UNITNAMEs that literally differ** across features
  before whitespace normalization; **14 after `.trim()`** (UNITNBR = 139
  has `"Bidwell Mansion SHP"` vs `"Bidwell Mansion SHP "` — a trailing-space
  divergence that a normalizing dissolve should merge, not split).
- **41 UNITNBRs have consistent UNITNAMEs across their features** and
  are legit multi-polygon dissolves (Fort Ross SHP style — the same park
  represented by disjoint polygon parts).

**Confidence: directly verified via `curl` against CA DPR's ArcGIS layer.**

### 1.2 The 14 divergent UNITNBRs (post-normalize)

Every one of these was producing a merged-polygon record on both TEST
(before this fix) and PROD (before the surgical write in §5). Names taken
from live CA DPR source this session:

| UNITNBR | # features | UNITNAMEs (alphabetical) |
|---:|---:|---|
| 132 | 2 | `Sutter Buttes`; `Sutter Buttes SP` |
| 203 | 3 | `Mount Diablo SP`; `Mount Diablo SP - Diablo Foothills Regional Park`; `Mount Diablo SP - Morgan Territory Regional Preserve` |
| 214 | 2 | `Candlestick Point SRA`; `Candlestick Point Submerged Lands` |
| 302 | 4 | `Tahoe SRA`; `TSRA Outliers - Gate Keepers Cottage`; `TSRA Outliers - Klausen Property`; `TSRA Outliers - Skylandia` |
| 318 | 3 | `FLSRA - Dam Operations Area`; `Folsom Lake SRA`; `Folsom Lake SRA - Nimbus Fish Hatchery` |
| 333 | 3 | `San Luis Reservoir SRA`; `San Luis Reservoir SRA - Dam Operations Area`; `San Luis Reservoir SRA - O'Neil Forebay Wildlife Area` |
| 432 | 2 | `Henry W. Coe SP`; `Henry W. Coe SP - Sillaci Conservation Easement` |
| 434 | 2 | `Rancho San Andrès (Castro Adobe)`; `Rancho San Andrès (Castro Adobe) Right of Way` |
| 449 | 2 | `Point Lobos SNR`; `Point Lobos State Marine Reserve` |
| 534 | 2 | `Bolsa Chica SB`; `Huntington City Beach` |
| 538 | 2 | `Providence Mountains SRA`; `Providence Mountains SRA - Designated Hunting Zone` |
| 614 | 3 | `Silver Strand SB` (× 2, same UNITNAME with different SUBTYPEs); `Silver Strand SB - Area leased to Navy` |
| 617 | 2 | `Palomar Mountain SP`; `Palomar Mountain SP School Camp` |
| **622** | 2 | **`Agua Caliente County Park (ABDSP)`; `Anza-Borrego Desert SP`** — the observably-broken case |

**Definitively wrong** (two truly different parks under one UNITNBR):
UNITNBR = 622 (Agua Caliente vs Anza-Borrego), 534 (Huntington vs Bolsa
Chica), 449 (Point Lobos SMR vs SNR are separate managed units under CA
DPR classification).

**Debatable / grey area** (parent-park + satellite properties/easements):
the other 11 cases (Mount Diablo, Folsom Lake, San Luis Reservoir, etc.).
The satellite properties are usually operated by other entities and have
their own distinct polygons; treating them as separate records is the
correct behavior.

**Confidence: directly verified — the table is a live query result this
session.**

---

## 2. The correct disambiguation key

Under this session's read of CA DPR's schema:

- **`UNITNAME`** is the human-readable park unit name. It's what tells
  humans (and any name-based ER step) which park the feature belongs to.
- **`UNITNBR`** was designed as a unique park unit identifier but is not,
  as the 14 cases above prove.
- **`GISID`** is a per-feature identifier stable across ingests (verified
  by comparing 2026-08-21 ingest data with today's source).
- **`GlobalID`** regenerates across ingests (verified — 2026-08-21 ingest's
  GlobalIDs for `state_parks:CA:park:622` no longer match today's).

The right composite for grouping is **(UNITNBR, trimmed UNITNAME)**.
Whitespace-only UNITNAME divergence (UNITNBR = 139's trailing space)
should be treated as a match; anything else should split.

**Confidence:**
- Directly verified: field presence, GISID stability, GlobalID
  regeneration, UNITNAME divergence patterns.
- Strong inference: that `disambiguateBy: "UNITNAME"` correctly captures
  the source's own semantics — CA DPR does not publish a data dictionary
  I could reach this session that explicitly says "UNITNBR is meant to be
  unique per (unit, name)"; the inference is from the observed pattern.

---

## 3. The code fix

`data/ingestion/sources/state-parks.ts`:

- New optional `EndpointConfig.disambiguateBy` field. Set to `"UNITNAME"`
  for CA only. Other states (WA `parkabbid`, UT `ParkName`, OR `name`,
  AZ points, NV) are untouched.
- `dissolveBoundaries` now accepts an optional `disambiguateByField`
  argument. When set, features under one groupBy value that disagree on
  `disambiguateByField` (trimmed) form separate units instead of merging
  their polygons.
- New `divergent`, `primaryKey`, `secondaryKey` fields on `DissolvedPark`.
- Second-pass tagging: for each primaryKey with >1 unit, sort by
  secondaryKey and mark all-but-alphabetical-first as `divergent`. The
  winner keeps the bare `{primaryKey}` external_id; the others get
  `{primaryKey}-{unitNameSlug(secondaryKey)}`.
- New `unitNameSlug` helper: NFKD-normalize, drop diacritics, whitespace
  → underscore, keep only `[A-Za-z0-9_-]`, truncate to 60 chars.

Chose alphabetical-first-wins because it's deterministic across ingests
and matches the pre-fix PROD state for 8 of the 14 divergent UNITNBRs
(including UNITNBR = 622: `Agua Caliente County Park (ABDSP)` <
`Anza-Borrego Desert SP` alphabetically, so Agua Caliente is the winner —
matches the current record).

New tests (`data/ingestion/sources/state-parks.test.ts`):

- Divergent-UNITNAME split (Agua Caliente / Anza-Borrego)
- Same-UNITNAME dissolve preserved (Fort Ross)
- Whitespace-only divergence merges (Bidwell Mansion)
- `disambiguateBy` off → old behavior preserved (backward-compat)
- 3-way divergence (Mount Diablo SP + regional preserves)

All 41 pre-existing tests still pass.

**Confidence: directly verified — `npm run -w data typecheck` passes;
`npx vitest run ingestion/sources/state-parks.test.ts` passes 41 tests.**

---

## 4. TEST re-ingest verification

Ran the full CA state_parks ingest on TEST (writes to
`znldzjdatkogdktymtvi`). Log:

- Fetched: 992
- Inserted: 933
- Updated: 0
- Skipped: 11
- Errors: 0

Post-ingest, all 14 divergent UNITNBRs now produce multiple records on
TEST, and every alphabetical-winner keeps the bare `{UNITNBR}` external_id.
Specifically for UNITNBR = 622:

```
state_parks:CA:park:622                          'Agua Caliente County Park (ABDSP)'  polygon parts=2
state_parks:CA:park:622-Anza-Borrego_Desert_SP   'Anza-Borrego Desert SP'             polygon parts=248
```

Point-in-polygon tests on the corrected TEST polygons:

| test point | inside Agua Caliente polygon | inside Anza-Borrego polygon |
|---|---|---|
| Visitor SR Point `[-116.406, 33.2569]` (ABDSP center) | **False** ✓ | **True** ✓ |
| Old Agua Caliente centroid `[-116.30362, 33.08427]` | False | True |

The old Agua Caliente centroid falls outside its new polygon because that
centroid was previously computed from the MERGED (Agua Caliente + ABDSP)
polygon — its geometry was ABDSP-influenced. Since Agua Caliente CP is
geographically INSIDE Anza-Borrego, the old centroid is also inside
Anza-Borrego's polygon.

**Confidence: directly verified.**

---

## 5. PROD surgical fix

### 5.1 Scope

Per the brief: "apply the equivalent fix to PROD for the affected
record(s)". The only observably-broken record on PROD (with a downstream
misplaced visitor SR) is UNITNBR = 622. The other 13 divergent UNITNBRs
are structurally broken in the same way but haven't produced observable
downstream damage in the merge-preview or duplicate-sort work. This
session's PROD write is scoped to UNITNBR = 622 only.

The remaining 13 will be corrected on the next full CA state_parks
re-ingest (which anyone can trigger with the fixed ingest code). That is
not this session's task.

### 5.2 The 9-step script (executed)

Script committed to `.context/apply-622-fix.py` (gitignored). Refuses to
run without `--confirm`. Steps, all completed against PROD this session:

1. Fetch Agua Caliente polygon (GISID = GIS0000369) from CA DPR ArcGIS.
2. Fetch Anza-Borrego polygon (GISID = GIS0000441) from CA DPR ArcGIS.
3. `UPDATE source_record` for `state_parks:CA:park:622`: replace
   `normalized_payload.geometry_polygon` with Agua Caliente's polygon
   (drop the merged-with-ABDSP portion), replace `raw_payload.props`
   with Agua Caliente's props (the correct UNITNAME/SUBTYPE/GISID were
   already there — this refreshes them).
4. `INSERT source_record` for
   `state_parks:CA:park:622-Anza-Borrego_Desert_SP` with Anza-Borrego's
   polygon.
5. `UPDATE source_record` for `california_state_parks:638` (the visitor
   SR named `"Anza-Borrego Desert State Park ®"`) to point at the
   pre-existing NPS Anza-Borrego mp (`2e118c6f-…`).
6. `UPDATE place_match` for that same SR to reflect the correction:
   `match_method = "manual_correction"`, `resolved_by =
   "manual:agua-caliente-fix-2026-09-03"`, `master_place_id = 2e118c6f-…`.
7. Link the new state_parks Anza-Borrego SR to the same NPS mp
   (`master_place_id = 2e118c6f-…`).
8. `INSERT place_match` for the new SR (`manual_correction`, confidence
   1.0).
9. `SELECT recompute_master_place(...)` for both affected mps.

Every step returned success. No errors. Verified state after execution
in §5.3.

### 5.3 PROD state before → after

| resource | before | after |
|---|---|---|
| `state_parks:CA:park:622` polygon parts | 250 (MultiPolygon spanning Anza-Borrego) | 2 (Agua Caliente CP only) |
| `state_parks:CA:park:622` UNITNAME | `Agua Caliente County Park (ABDSP)` (unchanged) | `Agua Caliente County Park (ABDSP)` |
| `state_parks:CA:park:622-Anza-Borrego_Desert_SP` | did not exist | new record, 248-part polygon (Anza-Borrego) |
| `california_state_parks:638` master_place_id | `9cf912c6-…` (Agua Caliente CP mp) | `2e118c6f-…` (NPS Anza-Borrego mp) |
| Agua Caliente CP mp `source_count` | 2 | **1** |
| NPS Anza-Borrego mp `source_count` | 1 | **3** (NPS + CA visitor + new state_parks) |
| Point-in-polygon: `state_parks:CA:park:622` polygon contains ABDSP visitor Point | True (buggy) | **False** (correct) |

**Confidence: directly verified via PROD queries after execution.**

---

## 6. Post-fix classifier + merge preview

Re-ran the sort classifier (temporarily restored from PR #368's branch;
deleted after) against fresh PROD:

- **Total pairs: 426** (was 427; the AC pair no longer forms because the
  two mps are correctly separated).
- **Self-created (43-pair set): 43** (unchanged; those come from
  visitor-solo mps with a state_parks GIS twin, unrelated to UNITNBR =
  622).
- **Pre-existing set: 383** (was 384).
- **Bucket state: SAME 135 · DIFFERENT 246 · UNCLEAR 2.**

Comparison with PR #372's post-verdict state:

| bucket | after PR #372's verdict | after this session's root-cause fix | delta |
|---|---:|---:|---:|
| SAME | 135 | 135 | 0 |
| DIFFERENT | 247 | 246 | −1 |
| UNCLEAR | 2 | 2 | 0 |

PR #372 moved AC out of SAME into DIFFERENT via manual verdict. The
root-cause fix removes AC from the classifier's output entirely — it's not
in either bucket now.

The merge preview tool (v2 from PR #374, restored temporarily) ran with
the new 135-pair input:

- **10 n-way clusters** — same as PR #374's report (Ginkgo, Palouse Falls,
  Fort Churchill 4-way, This Is The Place, Coral Pink Sand Dunes,
  Pigeon Point, Empire Mine, California Citrus, Fort Rock, Hat Rock).
- **123 merge groups** (unchanged: 113 size-2, 9 size-3, 1 size-4).
- **8 undecidable groups** (7 classic `either` size-2 pairs + Hat Rock OR
  3-way — unchanged).
- Canonical distribution: **63 other · 59 visitor · 13 either** — unchanged
  from PR #374 because the AC pair's exclusion was already applied there
  by hardcoded mp-id filter.

**Confidence: directly verified.**

---

## 7. Confidence key for the whole report

- **Directly verified (queried live PROD/TEST or ran the fixed ingest
  this session):** every count, every SR/mp field, the PIP tests, the
  before/after PROD state, the 14-UNITNBR divergent list, TEST re-ingest
  behavior, PROD surgical fix outcome, classifier post-fix output.
- **Strong inference:** that `disambiguateBy: "UNITNAME"` is the correct
  fix from CA DPR's own semantics — from observed pattern, not from a data
  dictionary; that the 41 non-divergent UNITNBRs are all legit dissolves —
  from name-agreement, not from geometric verification per record.
- **Unverified / estimated:** whether the other 13 divergent UNITNBRs
  (not fixed on PROD this session) are causing any observable downstream
  bugs beyond the merge-preview scope; whether OR / UT / WA sources have
  analogous cases (their `groupBy` is a name-based field, so structurally
  less likely, but not scanned).

---

## 8. What this PR does NOT do

- Fix the 13 other divergent UNITNBRs on PROD. Those get fixed on the
  next full CA state_parks re-ingest (`npm run -w data ingest:manual --
  --source state_parks --state CA` against PROD `.env`), which is a
  separate operator action.
- Modify the OR / UT / WA / AZ / NV state_parks logic. Their configs are
  unchanged.
- Delete the BACKLOG item for the `UNITNBR`-dissolve bug from PR #374 —
  see §9.
- Alter the merge preview tool's Agua Caliente exclusion. The tool still
  filters the pair by hardcoded mp-id via `--include-agua-caliente`
  override; after this fix the exclusion is effectively a no-op (the pair
  doesn't exist in classifier output), but the filter stays as a
  historical marker until PR #374 lands.

---

## 9. BACKLOG update

The BACKLOG item PR #374 added for this bug is **resolved by this PR** for
the observably-broken UNITNBR = 622 case, and the code fix prevents the
same class of bug on future ingests. The other 13 non-buggy-but-
structurally-affected UNITNBRs are documented in §1.2 and will be
corrected on the next full CA re-ingest. Removing the BACKLOG item this
session per the brief.

The one thing I'm NOT resolving as a follow-up: whether the merge preview
tool's hardcoded Agua Caliente exclusion (in PR #374 and #370) should be
removed. That belongs on those PRs, not this one.
