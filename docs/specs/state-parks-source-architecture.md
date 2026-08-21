# Spec — State Parks source architecture

Status: **READY FOR BUILD** (v4 — all open questions resolved). The only
outstanding item is the `description` placeholder (§10a), which is blocked on a
separate visitor-website investigation, not on this spec.
Author session: 2026-08-18. Branch: `state-park-systems-enumeration`.

Enumeration report: `.context/state-park-systems-enumeration.md` (v2, verified).

## Purpose

Add a `state_parks` source to the ingestion pipeline, covering the state park
systems of CA, AZ, NV, UT, WA, OR. These are NOT in RIDB (federal-only) and are
not reliably captured by the existing OSM pull. Each state runs its own ArcGIS
endpoint independently — there is no single federal umbrella.

Scope decisions (finalized by Adam):
- Six states: CA, AZ, NV, UT, WA, OR.
- Campground/site-level where available; boundaries-only for OR/UT.
- Fee and seasonal-closure fields: **omitted entirely** — no state publishes
  them via GIS.
- OSM: fallback-only, not a primary source (coverage 3–122 features per state;
  operator tagging is sparse and inconsistent).

---

## 1. One `source_id`, not six

**`source_id = "state_parks"`**. All six states share one source_id, with per-
state identity encoded in `external_id` and `normalized_payload.provenance`.

Rationale: every existing non-OSM source uses one `source_id` per agency/dataset
family, not per geographic subdivision. USFS is one `source_id` across all
forests; NPS is one across all parks; RIDB is one across all facilities. Six
separate `source_id` values (`state_parks_ca`, `state_parks_az`, ...) would
fragment the source for no operational benefit — `field_precedence`, quality
scores, and the manual.ts `--source` flag all key on `source_id`, and the
precedence/quality of state park data is the same regardless of which state
published it.

Per-state filtering is available via `external_id` prefix (see §3) or a
`normalized_payload->'provenance'->>'state'` query when needed.

---

## 2. Architecture: one table, depth-dependent `normalized_payload`

**Single `source_record` table** (the existing one), not a separate table. No
schema migration needed.

### Why not a separate amenity/campground layer?

The `road_segments` split-out was justified because road geometry is
fundamentally different from POI points — different geometry type (LineString vs
Point), different spatial index characteristics, no entity-resolution path. State
park records are all Points (boundary centroids or campground/facility locations)
flowing through the standard `source_record → place_match → master_place`
pipeline. Splitting them into a second table would duplicate the ER
infrastructure for no structural reason.

### Depth unevenness handled in `normalized_payload`, not in columns

The six states produce three shapes of data:

| Shape | States | What lands in `source_record` |
|---|---|---|
| **Boundary-only** | OR, UT | One record per park unit (polygon centroid as Point geometry). `normalized_payload` carries park name, acreage, designation, and boundary polygon (same pattern as PAD-US `geometry_polygon`). |
| **Boundary + campground-level facilities** | CA, NV, WA | One record per park unit (boundary centroid) + one record per campground/facility point. Park-unit records link to their campground children via a shared `park_id` in `normalized_payload.provenance`. |
| **Boundary + individual-campsite amenities** | AZ | One record per park unit + one record per individual campsite, with per-site fields (hookups, ADA, surface, etc.). Each campsite record carries a `data_vintage` field (see §4). |

This mirrors NPS, which ingests parks, campgrounds, and places as separate
record types under one `source_id`, distinguished by `external_id` prefix
(`nps:park:<code>`, `nps:campground:<id>`, `nps:place:<id>`).

Nullable depth-dependent fields in the schema would force every consumer to know
which states populate which columns — a coupling the `normalized_payload` JSONB
bag avoids. The payload shape varies by record type, same as USFS (whose
trailhead payload differs from its campground payload).

---

## 3. `external_id` format — RESOLVED `[verified 2026-08-18]`

```
state_parks:<ST>:park:<stable_key>         — park-unit boundary record
state_parks:<ST>:campground:<stable_key>   — campground/camp-area point OR aggregated campground
state_parks:<ST>:facility:<stable_key>     — facility point (NV trailhead, ranger station, etc.)
```

**Aggregated campground rows (AZ, WA):** Per-site campsite data is aggregated
at ingest time — one `campground`-category source_record per park, not per
individual site. `<stable_key>` for aggregated rows is the park-level grouping
key (`PARK_ABBR4` for AZ, `ParkName` for WA), not the per-site GlobalID. The
`:campsite:` prefix is not used — aggregated rows are structurally campgrounds.
Park name is resolved for AZ via nearest-point matching against
State_Park_Points (no shared join key exists between the two AZ layers).

`<ST>` is the two-letter state code. `<stable_key>` is the best available
persistent identifier per endpoint, verified against live data:

| State | Endpoint | Key field | Key type | Evidence |
|---|---|---|---|---|
| CA | ParkBoundaries | `GlobalID` (row-level); `UNITNBR` (dissolve grouping) | esriFieldTypeGlobalID | GlobalID populated on all records; UNITNBR is a park-level grouping key, not per-row unique `[verified]` |
| CA | Campgrounds | `GISID` | Agency-assigned code (e.g. `GIS0006395`) | Populated on all records, stable format `[verified]` |
| AZ | State_Park_Points | `GlobalID` | esriFieldTypeGlobalID | No agency code field exists; GlobalID is the only stable option `[verified]` |
| AZ | Campsites_WGS | `GlobalID` | esriFieldTypeGlobalID | **`SITE_ID` collides across parks** — `SITE_ID=44` matches 10 distinct parks (BUMO, CACO, CATA, DEHO, HORU, KACA, LAHA, LODU, LYLA, PALA) `[verified]`. Log compound `PARK_ABBR4:SITE_ID` for debug readability but key on GlobalID. |
| NV | SCORPRecAreas_Master | `name` (within `ownership='Nevada State Parks'` filter) | String | **`id` field is broken** — 753/759 records have `id=0` `[verified]`. No GlobalID exists. All 27 state-park names are unique `[verified]`. This is the highest-risk endpoint for key stability; a name change on republish would orphan the record. |
| NV | TP_SCORP_Master | `objectid` | esriFieldTypeOID | ~~**`guid` contains real GUIDs** `[verified on unfiltered layer]`.~~ **CORRECTED `[verified 2026-08-20]`:** `guid` is whitespace (`" "`) on ALL 362 state-park-filtered records (`jurisdicti='NV State Parks'`). The earlier verification checked the unfiltered 7,412-record layer where GUIDs are populated — the state-parks subset is data-sparse. `waypoint_i` is also whitespace on all 362. `objectid` is the only populated unique field. **Accepted risk:** `objectid` is not guaranteed stable across ArcGIS republishes. Same risk class and blast radius as the NV parks `name`-key acceptance (78 usable facility records with real `poiname`; 284 with blank names are correctly skipped at ingest). |
| UT | Utah_State_Park_Management_Areas | `GlobalID` (row-level); `parkabbid` (dissolve grouping) | esriFieldTypeGlobalID | parkabbid has 46 distinct values for 77 rows — it's a park-level grouping key `[verified]` |
| WA | ParkBoundaries | `ParkName` | String (207 distinct out of 207 records `[re-verified independently 2026-08-18, full-population curl + Python parse]`) | **No GlobalID exists** on this layer. **`ParkCode` collides** — 3 codes map to different parks: 71003 (Brooks Memorial ≠ Satus Pass), 61500 (Conconully ≠ Conconully Lake), 52500 (Deception Pass ≠ Hope Island) `[verified]`. ParkName is the only field confirmed 1:1 with records. |
| WA | Campsites | `GlobalID` | esriFieldTypeGlobalID | Also has `Keylink` compound field (e.g. `Potlatch27`) for debug readability — **Keylink uniqueness spot-checked on 5 samples only, not full-population verified; it is a debug convenience, not a relied-upon identifier** `[verified]` |
| OR | Oregon_State_Parks | `GlobalID` | esriFieldTypeGlobalID | No agency code field; GlobalID is the only stable per-row key `[verified]` |

---

## 4. AZ staleness marker — `data_vintage` field

Per decision: AZ campsite data (2016) must carry a visible staleness marker at
the field level, not just in documentation.

Every AZ campsite `source_record` carries in `normalized_payload`:

```jsonc
{
  "data_vintage": "2016",          // the source data's own last-modified year
  "data_vintage_source": "layer_metadata.editingInfo.lastEditDate",
  // ... other fields
}
```

`data_vintage` is distinct from `fetch_timestamp` (when we pulled it) and from
`updated_at` (when our row was last written). It answers "how old is the
upstream data?", not "when did we last check?"

This field is AZ-only in practice today, but the schema is not AZ-specific —
any state whose data carries a visible staleness signal should populate it. If a
state's layer metadata shows a `lastEditDate` older than 2 years, populate
`data_vintage`; otherwise omit it (absence = "current within the layer's stated
update cycle").

The field is in `normalized_payload` (JSONB), not a top-level column — it does
not require a migration, and consumers who don't check for staleness are
unaffected.

---

## 5. `normalized_payload` shapes (per record type)

### Park-unit record (`state_parks:<ST>:park:*`)

```jsonc
{
  "canonical_name": "Valley of Fire State Park",
  "description": null,                     // populated where available (AZ, WA)
  "designation": "State Park",             // WA Category, OR DESIGNATION, etc.
  "acreage": 46085.0,                      // where available
  "web_link": "https://...",               // where available
  "geometry_polygon": "SRID=4326;MULTIPOLYGON(...)",  // boundary, same pattern as PAD-US
  "provenance": {
    "state": "NV",
    "layer": "SCORPRecAreas_Master",
    "source_filter": "ownership='Nevada State Parks'",
    "agency_id": "Valley of Fire State Park"  // NV uses name as key
  }
}
```

### Campground/facility record (`state_parks:<ST>:campground:*` or `:facility:*`)

```jsonc
{
  "canonical_name": "Ritchey Creek Campground",
  "type": "Developed Family Camp Area",    // CA TYPE
  "subtype": "Tent Only",                  // CA SUBTYPE (null for other states)
  "park_name": "Bothe-Napa Valley SP",     // parent park name
  "park_id": "state_parks:CA:park:240",    // external_id of parent park record
  "provenance": {
    "state": "CA",
    "layer": "Campgrounds",
    "agency_id": "GIS0006395"
  }
}
```

WA campsites carry location + name + active flag only — NO amenity block. They
use the `:campground:` prefix with a `record_granularity: "site"` flag in
provenance to distinguish from CA's area-level campgrounds, rather than creating
a false equivalence with AZ's amenity-carrying `:campsite:` records.

### Individual campsite record (`state_parks:AZ:campsite:*`) — AZ only

```jsonc
{
  "canonical_name": "Site 42",
  "park_name": "Lost Dutchman State Park",
  "park_id": "state_parks:AZ:park:<GlobalID>",
  "data_vintage": "2016",
  "data_vintage_source": "layer_metadata.editingInfo.lastEditDate",
  "amenities": {
    "electrical": true,
    "water": true,
    "sewer": false,
    "ada": false,
    "reservable": true,
    "shaded": true,
    "firepit": true,
    "grill": true,
    "picnic_table": true,
    "surface": "gravel",
    "amperage": 30,
    "double_wide": false
  },
  "provenance": {
    "state": "AZ",
    "layer": "Campsites_WGS",
    "park_abbr4": "LDSP",
    "site_id": "42",               // for debug readability (not unique across parks)
    "debug_key": "LDSP:42"         // compound form for log grep
  }
}
```

---

## 6. Record-count-vs-park-count — RESOLVED `[verified 2026-08-18]`

### CA park-unit count: 280 (CSP official), not ~389 (raw UNITNBR dissolve)

CSP states **280 park units** in two official sources `[verified]`:
- parks.ca.gov About Us page: "With 280 state park units..."
- 2025 California State Park System Map PDF (parks.ca.gov/?page_id=862):
  "Park System Summary: 1.65 million acres / 280 park units / 83.9 million visitors"

The UNITNBR dissolve on the GIS boundary layer produces **389** distinct non-null
groups + 5 null singletons = **394** total `[measured]`. The 114-unit gap (394 −
280) is unclassified holdings, easements, and administrative parcels that CSP
does not count as "park units" in its public figure. The `SUBTYPE` field
distinguishes these: "Park Unit or Property" is the classified subset;
"Properties not operated as CSP units" and "Park Unit operated by other entity"
are the administrative remainder.

**Decision for ingest:** dissolve by UNITNBR (producing ~394 records), preserve
`SUBTYPE` in `normalized_payload`, and let downstream queries filter on SUBTYPE
if they need the CSP-official ~280 subset. Ingesting all administrative units is
more complete; the 280 figure is a presentation filter, not an ingest gate.

### Dissolve keys and expected counts (all states)

| State | Grouping key | Raw records → Dissolved | Evidence |
|---|---|---|---|
| CA | `UNITNBR` | 461 → ~394 (389 distinct + 5 null singletons; CSP official = 280) | UNITNBR confirmed safe: zero false merges of distinct parks; 3 cases of administratively-bundled inholdings (correct behavior). UNITNAME over-splits by ~24 groups due to trailing whitespace bugs and name variants. `[spot-checked: Fort Ross, Angel Island, Point Lobos, Anza-Borrego, Mount Diablo]` |
| AZ | `Name` (State_Park_Points, 1:1) | 34 → 34 | |
| NV | `name` (SCORPRecAreas, 1:1 within state parks filter) | 27 → 27 | All 27 names unique `[verified]` |
| UT | `parkabbid` | 77 → 47 (46 non-null + 1 null singleton "Lost Creek") | parkabbid strictly dominates `name` (48 distinct) — one rename case: parkabbid `SVSP` correctly merges "Starvation" + "Fred Hayes State Park at Starvation" (same park, old and new name). Null-parkabbid record (Lost Creek, OBJECTID 174) needs name-based fallback. `[verified, full-population 2026-08-18]` |
| WA | `ParkName` (1:1) | 207 → 207 | ParkCode collides on 3 pairs; ParkName is 207/207 distinct `[re-verified independently, full-population 2026-08-18]` |
| OR | `FULL_NAME` | 422 → 342 | **`NAME` had two edge cases; `FULL_NAME` resolves both** `[verified, full-population 2026-08-18]`: NAME (339 distinct) false-merged "Deschutes River SSW" (3 management categories) and false-split "Deschutes River SRA" (same area under two NAME values). FULL_NAME (342 distinct, 0 nulls) correctly separates the false-merge and joins the false-split. All 29 previously-clean NAME groups remain homogeneous on FULL_NAME (no over-splitting introduced). **13 records carry trailing whitespace in FULL_NAME** — trim at ingest. Verified that no trimmed value collides with a different group's raw value, so trim-before-dissolve and dissolve-before-trim produce the same 342 groups — the whitespace and the distinct count are not in tension. The +3 distinct count (342 vs 339) is entirely explained by the Deschutes River SSW group splitting into its constituent management units. |

### Park_id linkage

Campground/facility/campsite records carry a `park_id` in
`normalized_payload` pointing to the `external_id` of their parent park-unit
record. This is a soft reference — it doesn't create a foreign key, but it
enables any consumer to group sub-park records under their parent.

**No downstream consumer should use `COUNT(*) WHERE source_id='state_parks'` as
a park count.** The record count includes park units AND their child
campgrounds/facilities/campsites. A park count is
`COUNT(*) WHERE source_id='state_parks' AND external_id LIKE 'state_parks:%:park:%'`.

---

## 7. WA category preservation

WA's `Category` field (7 values, summing to 207) is stored in
`normalized_payload.designation` `[verified 2026-08-18]`:

| Category | Count |
|---|---|
| State Park | 90 |
| State Park Property | 63 |
| Marine State Park | 19 |
| State Park Heritage Site | 17 |
| Historical State Park | 11 |
| State Park Trail | 5 |
| State Park Conservation Area | 2 |
| **Total** | **207** |

All 207 are ingested. `inferred_category` = `recreation_area` for all categories
in v1 — the `designation` field preserves the original value for any future
category-level refinement without incurring false category-mismatch penalties in
the matcher.

---

## 8. `inferred_category` mapping (all states)

| Record type | `inferred_category` | Rationale |
|---|---|---|
| Park-unit boundary (all states) | `recreation_area` | Existing category; `recreation_area ↔ campground = 0.7` in `CATEGORY_COMPATIBILITY`, which is correct (a state park is often co-located with a campground but is not itself one). |
| Campground/camp-area point (CA, WA, NV) | `campground` | Matches existing vocabulary; these are named campground facilities. |
| Facility point — trailhead (NV) | `trailhead` | Matches existing vocabulary. |
| Facility point — other (NV ranger station, scenic view) | `park_feature` | Nearest existing category for non-campground park infrastructure. |
| Individual campsite (AZ) | `campground` | A campsite within a campground is still a `campground` POI. The individual-site granularity is expressed in `normalized_payload`, not in the category. |

No new categories are introduced. The existing `CATEGORY_COMPATIBILITY` map
handles all these without modification.

---

## 9. `source_quality_score` — RESOLVED `[verified 2026-08-18]`

**`0.7`** — above BLM (0.5) and OSM (0.4), below PAD-US (0.8), RIDB (0.9), and
USFS (0.9).

The existing scale (from implemented code, not docs):

| Score | Sources |
|---|---|
| 0.95 | NPS, Parks Canada |
| 0.9 | RIDB, USFS, BC Parks, Alberta Parks |
| 0.85 | Google Places |
| 0.8 | PAD-US |
| **0.7** | **state_parks (proposed)** |
| 0.5 | BLM, system default |
| 0.4 | OSM |

0.7 is calibrated against this existing scale, not chosen in isolation. State
park GIS data is authoritative for park identity (it comes from the managing
agency) but sparser than federal sources on amenity fields and variable in update
frequency (AZ: 2016).

**AZ campsites: `0.5`** — matching BLM's score for the same reason (sparse,
stale attributes). A decade-old hookup inventory should not win a precedence tie
against a current RIDB record. This is a per-record score set at ingest time,
not a per-source constant — `batchUpsert` already accepts it per row.

**Note on scale-drift in docs:** The phase-1.5 spec docs (`phase-1.5-bc-parks-
spec.md`, `phase-1.5-parks-canada-spec.md`) use a 0–100 prose scale (NPS=100,
RIDB=85, Google=70, OSM=50) that does NOT match the implemented 0–1 code values
(NPS=0.95, RIDB=0.9, Google=0.85, OSM=0.4). The `.ts` source files are the
ground truth; the prose figures in those older docs are approximate and have
drifted. This spec cites the implemented values.

---

## 10. `field_precedence` seed rows — RESOLVED `[verified 2026-08-18]`

`source_quality_score` is NOT the primary field-ranking mechanism — that role
belongs to the explicit `field_precedence(field_name, source_id, priority)` table
(lower wins). `source_quality_score` only breaks ties at the same priority.

State parks is authoritative for identity fields (it is the managing agency) but
sparse on operational fields. Priority 4 on identity fields places state_parks
below all federal sources (nps=1, google=2, ridb/usfs=3) and above OSM (priority
5 on most identity fields). At priority 4, state_parks may tie with existing
community sources on some fields; ties are broken by `source_quality_score`
(state_parks 0.7 > OSM 0.4).

```sql
-- field_precedence for the `state_parks` source.
-- Identity fields: priority 4 (below nps/google/ridb/usfs, above OSM at 5).
-- Sparse operational fields: appended at next-unused priority.
-- hours/contact/services/cell_signal: NO ROWS (state park GIS layers
-- do not carry structured data for these fields).
-- description: NO ROW — descriptions will come from a future visitor-website
-- source (§10a), not from this GIS source.
INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name',   'state_parks', 4),
  ('primary_category', 'state_parks', 4),
  ('geometry',         'state_parks', 4),
  ('geometry_polygon', 'state_parks', 4),
  ('amenities',        'state_parks', 8),
  ('access',           'state_parks', 6),
  ('capacity',         'state_parks', 5),
  ('seasonality',      'state_parks', 6);
```

Fields omitted (no row = state_parks never wins that field):
- `hours` — state GIS layers carry no structured hours data.
- `contact` — same.
- `services` — same.
- `cell_signal` — only iOverlander carries this; no other source has rows.

### 10a. `description` — RESOLVED: not sourced from GIS

**Decision (Adam, 2026-08-18):** Park descriptions will come from state visitor
websites (parks.ca.gov, stateparks.oregon.gov, etc.), not from the `state_parks`
ArcGIS GIS source. A separate investigation into visitor-website structure,
coverage, content quality, and terms/robots.txt per state is underway — its
results are not in yet.

**Consequence for this spec:**
- **No `description` row in the `state_parks` field_precedence SQL.** The GIS
  source is not the description source, so it should not compete for that field.
- WA's GIS `Description` field (the only real narrative text found across the
  six states' GIS layers `[surveyed 2026-08-18]`) still lands in
  `normalized_payload` as data — it just doesn't participate in field precedence.
- A future source (working name: `state_parks_web` or similar — source_id NOT
  finalized) will carry descriptions once the visitor-website investigation
  completes. **That source does not exist yet** — no schema, no endpoint, no
  field_precedence priority, no quality score. It is a placeholder pending the
  investigation's findings, not a commitment to a specific design.
- No `description` field_precedence SQL should be written for either `state_parks`
  or the future web source until the website investigation reports back.

---

## 11. Ingester design

One file: `data/ingestion/sources/state-parks.ts`. Rides the existing
`fetchEsriFeatures` client (same as USFS, PAD-US, BLM).

### CLI

```
npm run -w data ingest:manual -- --source state_parks --state CA
npm run -w data ingest:manual -- --source state_parks --state CA --dry-run
npm run -w data ingest:manual -- --source state_parks --state ALL
```

New `IngestOptions` field: `state?: string` — two-letter code or `"ALL"`. No
`--bbox` needed (each state's endpoint is state-scoped already).

### Per-state adapter config

```ts
const STATE_CONFIGS: Record<string, StateConfig> = {
  CA: {
    endpoints: {
      parks: {
        url: "https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/ParkBoundaries/FeatureServer/0",
        groupBy: "UNITNBR",   // dissolve multi-polygon parks; GlobalID for row-level identity
        stableKey: "GlobalID", // per-row key for pre-dissolve identity
      },
      campgrounds: {
        url: "https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/Campgrounds/FeatureServer/0",
        stableKey: "GISID",
      },
    },
  },
  AZ: {
    endpoints: {
      parks: {
        url: "https://services2.arcgis.com/gdcQ6sUWKP8qwBmV/ArcGIS/rest/services/State_Park_Points/FeatureServer/0",
        stableKey: "GlobalID",
      },
      campsites: {
        url: "https://services2.arcgis.com/gdcQ6sUWKP8qwBmV/ArcGIS/rest/services/Campsites_WGS/FeatureServer/0",
        stableKey: "GlobalID",  // NOT SITE_ID (collides across parks)
      },
    },
    dataVintage: "2016",
  },
  NV: {
    endpoints: {
      parks: {
        url: "https://arcgis.water.nv.gov/arcgis/rest/services/Hosted/SCORPRecAreas_Master/FeatureServer/0",
        where: "ownership='Nevada State Parks'",
        stableKey: "name",  // id field broken (753/759 = 0); no GlobalID; names unique within 27 state parks
      },
      facilities: {
        url: "https://arcgis.water.nv.gov/arcgis/rest/services/Hosted/TP_SCORP_Master/FeatureServer/0",
        where: "jurisdicti='NV State Parks'",
        stableKey: "guid",  // untyped but contains real GUIDs
      },
    },
  },
  UT: {
    endpoints: {
      parks: {
        url: "https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_State_Park_Management_Areas/FeatureServer/0",
        groupBy: "parkabbid",  // dissolve multi-polygon parks; GlobalID for row-level identity
        stableKey: "GlobalID",
        // Null-parkabbid handling: 1 record (Lost Creek, OBJECTID 174) has
        // parkabbid=null. Treated as a singleton group for dissolve grouping
        // only — external_id still uses GlobalID per §3. The dissolve logic
        // must not merge null-parkabbid records with each other (each null is
        // its own group).
      },
    },
  },
  WA: {
    endpoints: {
      parks: {
        url: "https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/ParkBoundaries/FeatureServer/2",
        stableKey: "ParkName",  // NO GlobalID on this layer; ParkCode collides on 3 pairs
      },
      campsites: {
        url: "https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/Campsites/FeatureServer/78",
        stableKey: "GlobalID",
      },
    },
  },
  OR: {
    endpoints: {
      parks: {
        url: "https://maps.prd.state.or.us/arcgis/rest/services/Land_ownership/Oregon_State_Parks/FeatureServer/0",
        groupBy: "FULL_NAME",  // NAME has 2 edge cases (§6); FULL_NAME resolves both
        stableKey: "GlobalID",
      },
    },
  },
};
```

### Flow

1. For the specified `--state` (or each state if `ALL`):
2. Fetch the `parks` endpoint → dissolve by `groupBy` key if configured →
   emit one `source_record` per park unit (centroid geometry, polygon in payload).
3. Fetch `campgrounds`/`campsites`/`facilities` endpoint if configured →
   emit one `source_record` per point, linking to parent park via `park_id`.
4. `batchUpsert` with `onConflict: "source_id,external_id"`.

Rate limiting: `pLimit(4)` per state (same as USFS/PAD-US for ESRI REST). States
run serially (one at a time) to keep the log readable and allow per-state
error isolation.

### Registration

- `rate-limit.ts`: add `state_parks: pLimit(4)`.
- `manual.ts` `loadSource`: add `case "state_parks"` importing
  `./sources/state-parks.ts`; add `--state` flag parsing.
- `_types.ts`: add `state?: string` to `IngestOptions`.

---

## 12. Expected volumes

| State | Park-unit records | Campground/facility records | Campsite records | Total `source_record` |
|---|---|---|---|---|
| CA | ~394 (dissolved from 461; CSP official = 280) | 531 | — | ~925 |
| AZ | 34 | — | 1,346 | ~1,380 |
| NV | 27 | 362 | — | ~389 |
| UT | 47 (dissolved from 77; 46 parkabbid + 1 null) | — | — | ~47 |
| WA | 207 | 6,124 | — | ~6,331 |
| OR | 342 (dissolved from 422 by FULL_NAME) | — | — | ~342 |
| **Total** | **~1,051** | **~7,017** | **~1,346** | **~9,414** |

This is comparable to the RIDB six-state campaign (6,013 source_records) and
much smaller than OSM six-state (109,615).

---

## 13. Matcher impact (estimate, not measured)

Park-unit records (`recreation_area`) will match against existing PAD-US
`public_land` records, RIDB `recreation_area` records, and OSM park features.
The `recreation_area ↔ recreation_area = 1.0` compatibility means same-name
state parks within 500m of an existing master_place will likely auto-link or
enter manual review — this is correct behavior (the same park should merge, not
duplicate).

Campground records (`campground`) will match against existing RIDB campgrounds
and USFS campgrounds. Same-name campgrounds at the same location should auto-
link; the field-precedence system will resolve which source's fields win. At
`source_quality_score = 0.7`, state_parks fields lose to RIDB (0.9) and USFS
(0.9) — correct.

AZ campsites are individual numbered sites. RIDB and USFS do not go to site-
level granularity, so these are almost entirely net-new `master_place` records
(no existing corpus records to collide with at that granularity). Expect ~1,300+
new master_places from AZ alone.

**Manual-review queue load is NOT measured.** Unlike the BLM spec (which ran a
nearest-neighbor analysis against the existing corpus), this spec does not have a
measured cross-source collision count. Recommend a dry-run before first live
materialize, same as USFS.

---

## 14. What this spec does NOT cover

- **Fee/seasonal-closure data.** Omitted by decision. No fee or closure columns,
  no empty placeholder columns, no partial model. ReserveCalifornia
  (reservecalifornia.com) is the identified candidate for CA fee data; analogous
  platforms exist for other states. These are a separate source, not part of this
  spec.
- **OSM as a fallback.** OSM state park coverage is too sparse and inconsistently
  tagged to serve as primary (3–122 operator-tagged features across the six
  states vs ~1,047 official park units). OSM's existing `leisure=park` and
  `boundary=protected_area` records will match via entity resolution if they
  share a name/location with an official state park record — that's the right
  integration point, not a dedicated OSM-state-parks ingest path. No new OSM
  adapter work needed.
- **Boundary-polygon promotion to `master_place.geometry_polygon`.** The payload
  carries the polygon (like PAD-US), but promoting it to the master_place column
  via `recompute_master_place` is a separate step — same as PAD-US today.
- **AZ ParkAmenities layer** (34 records with park-level Y/N amenity flags). Not
  in v1. The park-unit boundary record covers park identity; the amenity flags
  (RV camping Y/N, showers Y/N, etc.) are a useful enrichment but their 2016
  vintage means they'd need the same `data_vintage` treatment as campsites.
  Straightforward to add later as an additional endpoint in AZ's config.
- **CA's additional layers** (Picnic Grounds, Buildings, Structures, Day Use
  Areas, Parking Areas, Park Entry Points, Routes). Not in v1. The campgrounds
  layer captures the highest-value POIs; the rest are add-on enrichment.
- **WA's Activity Points** (913 records). Not in v1 — activity-type points
  (Fishing, Bird Watching, Boating, etc.) are category metadata, not standalone
  POIs. Could enrich park-unit records in a later pass.

---

## 15. Remaining open questions for Adam

All pre-build verification gaps and design questions are closed. **No open items
remain except the `description` placeholder (§10a), which is blocked on a
separate visitor-website investigation — not on this spec.** The spec is ready
for build on everything except description.

### Previously open, now resolved

- **NV parks key risk.** ACCEPTED (Adam, 2026-08-18). Use `name` as the key for
  the 27-record state-park boundary subset. No synthetic hash key. **Accepted
  risk:** a park rename on the upstream side would orphan the record.
  **Rationale:** 27-record scope keeps blast radius small; any orphan would be
  easy to spot and fix manually (one UPDATE to realign the external_id).
- **NV facilities key risk.** Same risk class, discovered during dry-run
  `[2026-08-20]`. `guid` is whitespace on all 362 state-park-filtered records
  (the earlier `[verified]` tag was measured on the unfiltered 7,412-record
  layer — corrected). `objectid` is the only populated unique field, used as
  the key for the 78 records with usable `poiname` values. `objectid` is not
  guaranteed stable across ArcGIS republishes. **Accepted risk:** same blast
  radius reasoning (78 records); a republish renumbering would cause duplicates,
  detectable by a simple `source_id + name` duplicate check and fixable by
  a re-ingest.
- **CA SUBTYPE filter.** DECIDED (Adam, 2026-08-18). Ingest all ~394 UNITNBR
  groups including non-CSP-operated holdings. Do NOT pre-filter to CSP-official
  ~280. `SUBTYPE` is preserved in `normalized_payload` on every record so the
  CSP-official / non-official distinction remains available for downstream
  querying without requiring re-ingest.
- **`description` field_precedence.** Closed — descriptions will come from
  visitor websites, not from the GIS source (§10a). No `description` row in the
  `state_parks` field_precedence SQL. Future `state_parks_web` source pending
  a separate investigation.
- **OR dissolve key.** `FULL_NAME` verified as the dissolve key
  `[full-population 2026-08-18]`: 342 distinct (vs NAME's 339), 0 nulls, no
  over-splits. §6 and §11 updated. 13 records carry trailing whitespace —
  trimmed at ingest; verified no group-count impact.
- **OBJECTID stability.** All 10 endpoints checked `[2026-08-18]`. §3 updated
  with verified stable keys per endpoint.
- **CA dissolve.** UNITNBR confirmed as key `[spot-checked 5 parks]`. CSP
  official count = 280; dissolve produces 394. §6 updated.
- **Quality score grounding.** 0.7 / 0.5 calibrated against existing scale
  `[2026-08-18]`. §9 updated.
- **Field precedence.** 8 seed rows designed and proposed. §10 updated.
  `description` row held pending item 1 above.
