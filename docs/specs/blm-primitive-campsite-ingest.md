# Spec — BLM Primitive Campsite ingester (BLM_Natl_Recs_pts layer 23)

Status: DRAFT for review. Design/spec pass only — no ingest, no materialize.
Author session: 2026-08-17. Branch: `blm-primitive-campsite-ingest`.

## Purpose

Ingest the **dispersed/primitive camping** slice of BLM's national recreation
points into `source_record`, scoped to the six planning states
(CA/AZ/NV/UT/OR, where OR includes WA). This is the one slice of
BLM_Natl_Recs_pts that is genuinely net-new against the existing corpus — the
developed-reservable and generic-campground slices are already covered via
RIDB and are deliberately excluded.

Prior scoping (measured, not re-derived here):

- `FET_SUBTYPE = 'Campsite - Primitive - Non Reservable - No Fee'` — 1,276
  national, ~877 six-state (≈743 OR / ≈119 CA-AZ-NV-UT / ≈15 WA).
- 83.5% of these are net-new vs BLM-tagged RIDB at 2km (the USFS
  dispersed-camping pattern); developed-reservable was 92% already-covered.
- Attribute-poor: PHOTO_TEXT/PHOTO_LINK ~100% null; DESCRIPTION ~42% null SW4 /
  ~86% null OR; WEB_LINK mostly office-level, not per-POI.

## Verified this session (read-only)

- **`Original_GlobalID` is 100% populated AND fully unique across all 10,241
  national rows** (paged the whole layer at 2000/page; 0 duplicates). Valid
  idempotency key.
- **`dispersed_camping` corpus in TEST:** OSM 3,471 + USFS 407 = 3,878
  source_records → 3,548 master_places. **Zero `source_id='blm'` rows exist**
  — this is a clean first ingest.
- The shared `data/ingestion/lib/esri.ts` client reads geometry from GeoJSON
  (`f=geojson`, `outSR=4326`) with explicit 1000-row OID-keyset pagination, and
  **BLM SMA already rides it**. This automatically avoids the OR/WA LAT/LONG
  trap (see §5).

---

## 1. Ingester design (mirrors `usfs.ts` / the EDW_RecInfra pattern)

New file `data/ingestion/sources/blm-rec.ts`, `SOURCE_ID = "blm"`. A **simpler**
clone of `usfs.ts` — single subtype, no secondary-service enrichment (no RIDB
join). Rides `fetchEsriFeatures` + `resolveCorridorFilter`, exactly like
USFS/PAD-US.

**Endpoint:**
`https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/23`

**Server-side WHERE (six-state scope):**

```
FET_SUBTYPE = 'Campsite - Primitive - Non Reservable - No Fee'
  AND ADMIN_ST IN ('CA','AZ','NV','UT','OR')
```

This exact string is the 1,276-national / ~877-six-state slice (the
`'Primitive campsite'` shorthand from the brief). `ADMIN_ST IN (...)`
reproduces the measured footprint precisely (the OR office administers both OR
and WA). No bbox envelope is needed for scoping — but `resolveCorridorFilter`
still supplies a spatial filter for the shared client, so pass a six-state
bounding envelope as the coarse pre-filter and let the WHERE do the real
scoping.

### Field mapping (18 BLM_Natl_Recs_pts fields → source_record)

| source_record field | from | notes |
|---|---|---|
| `source_id` | const `"blm"` | |
| `external_id` | `` blm:recpt:<Original_GlobalID> `` | GUID kept verbatim incl. braces; verified 100% populated + unique |
| `name` | `FET_NAME` | as-is, no synthesis (USFS naming rule); many are placeholder ("Campsite 91") — kept honest |
| `inferred_category` | const `"dispersed_camping"` | see §2 |
| `geometry` | GeoJSON Point from client → `pointEwkt([lng,lat])` | **never** the LAT/LONG columns (null in OR) |
| `raw_payload` | `{ props, fetched_at }` | full attribute bag via `.passthrough()` zod |
| `normalized_payload` | see below | |
| `source_quality_score` | `0.5` | below RIDB 0.9 / USFS 0.9 — bare inventory points with sparse attributes; loses tiebreaks to richer federal sources |

Fields not mapped (measured ~100% null or not useful at POI level):
`PHOTO_TEXT`, `PHOTO_LINK`, `PHOTO_THUMB`, `SOURCE`, `UNIT_NAME`,
`WEB_DISPLAY`, `PHOTO_TEXT`. `LAT`/`LONG` are intentionally ignored (see §5).
All 18 fields still land verbatim in `raw_payload`.

### `normalized_payload` (mirror `usfs.ts` dispersed shape)

Kept structurally identical to the USFS dispersed-camping payload so it behaves
the same downstream:

```
canonical_name:  FET_NAME
description:     trimOrNull(DESCRIPTION)          // ~42% present SW4 / ~14% OR
overlander_tags: ["federal_land", "blm", "dispersed_camping_likely"]
dispersed_camping: "likely_allowed"
verify_locally:  true
mvum_corridor:   null
web_link:        trimOrNull(WEB_LINK)             // office-level, not per-POI — stored, not promoted
amenities:       null                             // photos ~100% null; emit null, do not fabricate
hours:           null
contact:         null
access:          null
provenance: {
  layer:              "BLM_Natl_Recs_pts:23",
  original_global_id: Original_GlobalID,
  admin_st:           ADMIN_ST,                   // soft state tag — see §3
  fet_subtype:        FET_SUBTYPE
}
```

zod `.passthrough()`; only >50%-populated fields are named in the schema, the
rest ignored — same discipline as `InfraPropsSchema` in `usfs.ts`.

### Registration

- `rate-limit.ts`: add `blm: pLimit(4)` (ESRI REST, no documented limit, be
  polite — same as `usfs`/`padus`).
- `manual.ts` `loadSource`: add `case "blm"` importing `./sources/blm-rec.ts`;
  extend the `--source` help text and the "Available:" error string.

Run:

```
npm run -w data ingest:manual -- --source blm --bbox -124.9,31.3,-109.0,49.1 --dry-run
```

---

## 1a. Live-ingest bbox — the 876-row physical-six-state scope

**Use exactly this `--bbox` for the live ingest (west,south,east,north):**

```
-124.9,31.3,-109.0,49.1
```

This is the value verified in the dry-run: WHERE + this envelope returns **876
rows** (0 skipped, 0 errors), vs **877** for the ADMIN_ST-driven scope with no
bbox.

Why 876, not 877: `ADMIN_ST` is the *administering office*, not physical
location, so a wider or purely ADMIN_ST-driven scope pulls in at least one
out-of-region point — `Cunningham Gulch Dispersed Campsite 14`, which is
`ADMIN_ST='CA'` but physically in Colorado near Silverton (lon −107.58, lat
37.79); this bbox's east edge (−109.0) excludes it (confirmed: 0 of that row
inside the envelope). The remaining 876 are the primitive-campsite points
physically inside the six planning states.

**Any future ingest run against this source must reuse this bbox** unless there
is a deliberate reason to widen it. Nothing in `blm-rec.ts` or `manual.ts`
hardcodes or enforces the 876-row scope — the bbox is a runtime `--bbox` flag
(`resolveCorridorFilter(opts.bbox)`), so the scope decision lives with the
operator's command, and this section is the only record of the intended value.

---

## 2. Category mapping — reuse `dispersed_camping`

**BLM primitive campsite → `dispersed_camping`** — the exact category USFS
`CAMPING AREA` at `development_scale ≤ 1` uses. The matcher already treats it as
a first-class category (`matcher.ts` `CATEGORY_COMPATIBILITY`):

- `dispersed_camping ↔ dispersed_camping = 1.0`
- `dispersed_camping ↔ campground = 0.1`
- `dispersed_camping ↔ recreation_area = 0.1`

No new category, no schema change (`inferred_category` is a free string; USFS
already writes this value). Distinguishability by source is preserved via
`source_id="blm"` + `overlander_tags:["blm"]` + `provenance.layer` — a consumer
can always tell a BLM primitive from a USFS dispersed site without a separate
category.

---

## 3. OR/WA handling — ingest as-is with a soft tag, do NOT split

Store `ADMIN_ST` (always `'OR'` for OR-office rows) in `provenance.admin_st` as
a **soft state tag**, and rely on **point geometry** for all map/state queries.

Rationale: the OR/WA boundary is the meandering Columbia; the bbox lat-cut is an
approximation (WA ranged 277–423 across cut latitudes in scoping), so baking a
hard WA/OR attribute would encode a guess as fact. Geometry is exact and is what
map-bounds queries use anyway. Split is ~743 OR / ~15 WA / ~119 CA-AZ-NV-UT (WA
soft). If a real per-state rollup is ever needed, do a PostGIS state-polygon
join at query time — not at ingest.

---

## 4. Volume / effort

- **Script:** ~200 lines, strictly less than `usfs.ts` (no RecOpp map, no scale
  gate, no site-type token table). Pure helpers (`bestName`, `buildRow`,
  `extractPoint`, `normalize`) + zod schema + `_internals` test seam.
- **Test:** `blm-rec.test.ts` exercising `buildRow` on fixture features — a real
  name, a placeholder name, a missing-geometry row, and an OR-office row with
  null LAT/LONG (to lock in that geometry comes from the GeoJSON `geometry`, not
  the attribute columns).
- **Expected TEST ingest:** ~877 source_record rows, one `fetchEsriFeatures`
  call, seconds of wall time.
- **Blockers before first TEST ingest:** none structural. The RIDB preflight
  401 is irrelevant (this source never touches RIDB). The only real gate is the
  review-queue load in §6.

---

## 5. The LAT/LONG trap (why geometry, not attributes)

Measured in scoping: **OR-office rows carry `LAT`/`LONG` attribute columns that
are null** — they have SHAPE geometry but not the lat/long fields. CA/AZ/NV/UT
populate LAT/LONG; OR does not. An ingester reading coordinates from LAT/LONG
would silently drop the entire OR/WA footprint (~743 rows, the bulk of the
slice). The shared `esri.ts` client already requests `f=geojson` + `outSR=4326`
and reads the GeoJSON `geometry`, so this is handled — but `extractPoint` must
prefer the GeoJSON Point and **not** fall back to LAT/LONG for this source
(unlike `usfs.ts`, whose lat/lng fallback is safe because USFS populates them).

---

## 6. Matcher-impact note (measured, not assumed)

This **corrects the earlier "review-queue load should be low"** expectation.
That came from the RIDB-BLM dedup (28% within 2km). Dedup was never measured
against the OSM/USFS `dispersed_camping` corpus — the gap flagged in the brief.
Measured now against the 3,548 existing `dispersed_camping` master_places in
TEST.

### No coord-dominant false MERGE is structurally possible

Scoring is `0.4·distance + 0.4·name + 0.2·category` with distance clipped at
100m, so distance alone tops out at 0.4 — below the 0.6 review floor, far below
the 0.85 auto-link threshold. Every merge path requires a name or category
signal:

- `name_dominant` auto-link needs `name_sim ≥ 0.85` AND `cat_compat ≥ 0.8`. BLM
  primitive names are largely placeholder/numeric ("Campsite 91"), and the
  matcher forces `name_sim = 0` for placeholder names — so this rarely fires,
  and when it does (two real matching names within 500m at cat 1.0) it is a
  *correct* dedup of the same site.
- `dispersed_camping ↔ campground = 0.1` caps any BLM-primitive-vs-RIDB-
  campground blend at 0.82 < 0.85 — **can never auto-swallow into a developed
  campground.** This is the exact err-toward-separate guard USFS relies on.

### But the review-queue load is NOT low — it is the real cost

Measured, BLM primitives (n=877) vs existing `dispersed_camping` master_places:

| distance to nearest existing dispersed_camping MP | count | matcher outcome |
|---|--:|---|
| within 100m | **232 (26.5%)** | `close_nameless` → **manual_review** (cat 1.0, placeholder/low name, ≤100m, cross-source) |
| 100–500m | ~178 (20.3%) | mostly `new_master_place` (distance zeroed >100m, name≈0, blend ≈0.2) |
| beyond 500m | **467 (53.2%)** | clean `new_master_place` |

So expect **~53% clean net-new, ~20% net-new, and up to ~26% (≈232) routed to
`manual_review`** via `close_nameless` against co-located OSM/USFS dispersed
camping. These are **not** false merges (nothing auto-links silently) — they are
legitimate "is this the same dispersed site OSM already mapped?" decisions a
human must clear. Some fraction are genuine duplicates (OSM mapped the same BLM
site); some are distinct nearby pins. Same shape as USFS dispersed camping, but
the queue is heavier than implied in the prior phase.

### Recommendation

The slice is still worth ingesting (~645 net-new dispersed sites absent from the
corpus), but plan for a **~230-row manual_review pass** as part of the first
six-state materialize — it is the gate, and it should be surfaced in the dry-run
report before any live promote. If that review load is unwelcome, options are to
raise the `close_nameless` distance floor or add a BLM-vs-dispersed same-place
pre-pass — but do not change matcher constants for one source without explicit
sign-off.

---

## 7. Open items for Adam before build

1. Approve `dispersed_camping` reuse (§2) vs a distinct `blm_dispersed` category.
2. Approve `source_quality_score = 0.5` (§1).
3. Approve the OR/WA soft-tag decision (§3) — no hard WA attribution at ingest.
4. Acknowledge the ~230-row manual_review queue (§6) as the first-materialize gate.
5. Optional extension (not in v1): the sibling primitive variants
   (`Campsite - Primitive - Non Reservable - Fee` 99, `... Reservable Fee` 46,
   `... Reservable No Fee` 11, `Campsite - Undeveloped` 9). Small; the reservable
   ones may overlap RIDB. Left out of v1 deliberately.
