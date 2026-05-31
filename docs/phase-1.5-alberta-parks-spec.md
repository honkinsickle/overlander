# Phase 1.5: Alberta Parks Source Integration

**Status:** Draft
**Sequence:** Third of five Segment B prerequisite specs
**Estimated effort:** Half-day (faster than BC Parks — reuses established provincial-source pattern)
**PR scope:** Single focused PR adding Alberta Parks as a federated source
**Depends on:** BC Parks spec landed (establishes provincial-source pattern this PR reuses)

## Why this source

Alberta Parks manages ~470 provincial parks, recreation areas, wildland provincial parks, and ecological reserves across Alberta. Provincial-level authority parallel to BC Parks but for Alberta jurisdiction. Required for Segment B coverage because the Whitefish → Whitehorse route may dip into southwestern Alberta (Crowsnest Pass area, Kananaskis Country) depending on routing choices, and broader future segments will benefit from full Alberta coverage. Even where the immediate corridor doesn't pass through Alberta, ingesting now means the source is ready for any route variation or future Alberta-adjacent corridors without revisiting integration.

This spec is the *second instance* of the provincial-source pattern. Most decisions copy from BC Parks; the deltas are the API source, naming conventions, and bbox.

## Data source

**Alberta Open Government Portal** at `https://open.alberta.ca` and the Alberta GeoDiscover Alberta platform. Available datasets to investigate during implementation:

- **Alberta Parks boundary data** — polygon geometries with park metadata.
- **Alberta Parks campground/facility data** — point data with site detail.
- **Alberta Recreation Sites** — provincial rec sites; investigate whether worth bundling or deferring (same decision pattern as Rec Sites and Trails BC).

Investigation step in implementation: confirm endpoints and dataset structure. Alberta's open data infrastructure is less centralized than BC's DataBC; may require combining sources from Alberta Parks directly + the open portal.

**License:** Open Government License - Alberta. Compatible with derivative-data product.

## Categories this source covers

Reuses categories established in the BC Parks integration:
- `provincial_park_boundary`
- `provincial_recreation_area`
- `campground`
- `picnic_area`
- `trailhead`
- `viewpoint`

Plus potentially:
- `wildland_provincial_park` — Alberta-specific designation for less-developed wilderness areas. Investigate during implementation whether this warrants a new category or maps to `provincial_park_boundary`. Default: map to `provincial_park_boundary` unless implementation surfaces a reason to differentiate.

## Field precedence

Same pattern as BC Parks, jurisdiction-scoped to Alberta provincial sites:

| Field | Alberta Parks rank | Reasoning |
|---|---|---|
| `canonical_name` | 1 for Alberta provincial sites | Provincial authority |
| `description` | 1 for Alberta provincial sites | Often well-curated |
| `geometry` | 1 for Alberta provincial sites | Provincial-source geometry authoritative |
| `contact` | 1 for Alberta provincial sites | Official |
| `hours` | 2 (below Google) | Google fresher |
| `amenities` | 2 | Union from all sources |

Add 6 rows to `field_precedence` for Alberta Parks, scoped to Alberta provincial-park records. No cross-jurisdiction conflicts with BC Parks (different provinces don't overlap geographically) or Parks Canada (federal vs provincial don't overlap).

## Source quality score

Recommended `source_quality_score = 90` (peer with BC Parks).

Same reasoning as BC Parks: provincial-level authoritative source, below federal sources, well above Google for tie-breaking. Effectively no operational impact since Alberta Parks doesn't share geography with other provincial or federal sources.

## Match rules — does Alberta Parks participate in:

Identical to BC Parks:
- **`fed_exact`:** NO. Reserved for federal-source pairs.
- **`amenity_rollup`:** YES. Standard.
- **`name_dominant`:** YES. Standard.
- **`close_nameless`:** YES. Standard.
- **Same-source guard:** YES. Standard.

## Ingestion implementation

**Directory:** `data/ingestion/alberta-parks/`

**Files:**
- `client.ts` — HTTP client wrapping Alberta open data endpoints
- `normalizer.ts` — transforms native Alberta Parks records into canonical `normalized_payload`
- `index.ts` — orchestrator

**Inputs:** bbox

**Outputs:** `source_record` rows with `source_id = 'alberta_parks'`, ledger entry per ingestion run

**Rate limiting:** ~5 req/sec default (no documented limits found; rate-limit politely).

**Pagination:** PostgREST-style range pagination.

**Idempotency:** `(source_id, external_id)` upsert key.

## Bbox strategy

Single enclosing rectangle. For initial integration testing, use a tight bbox around Kananaskis Country (well-known overlander area, multiple campgrounds, validates the pipeline). Expand to full Alberta corridor coverage when integration is validated.

Initial test bbox (Kananaskis area): `[-115.4, 50.5, -114.5, 51.2]`

## Validation criteria

Pre-merge integration testing:

1. **Ingestion against test bbox:** Kananaskis Country area returns expected parks (Peter Lougheed, Spray Valley) and campgrounds (Boulton Creek, Elkwood, Mount Kidd RV).
2. **Normalizer correctness:** spot-check 5 records.
3. **No regressions:** D4 suite on JT corpus still 12/12 with identical outcome distribution.
4. **field_precedence migration** applies cleanly on test and prod.
5. **Source quality score** correctly used by matcher.
6. **Cross-source non-overlap with BC Parks:** synthetic test confirming an Alberta provincial-park record and a nearby BC provincial-park record federate independently (BC↔Alberta border is the natural test geography — e.g., something just east of the border in Alberta vs something just west in BC).

## Out of scope (filed as future work, not bundled)

- Alberta Recreation Sites bundling — defer evaluation pending Segment B corridor results, mirroring the BC Rec Sites and Trails decision.
- iOverlander integration (next spec).
- Live operational status (closures, fire bans) — separate concern, Phase 3b or later.
- Alberta provincial campground reservation system (Reserve.AlbertaParks.ca) integration — defer to Phase 3b unless Segment B execution surfaces a clear need.
- Municipal/regional parks (Calgary parks, Edmonton parks, etc.) — out of scope; municipal-level coverage is not a Segment B requirement.

## Open questions to resolve during implementation

1. Where does the cleanest Alberta Parks API live? Alberta's open data infrastructure is more fragmented than BC's; may require combining multiple endpoints.
2. Does `wildland_provincial_park` warrant a distinct canonical category? Default: no, map to `provincial_park_boundary`.
3. Coordinate system — confirm WGS84 (Alberta may serve in EPSG:3402 (Alberta 10-TM) or NAD83); transform if needed.
4. Naming convention — Alberta Parks records often include "Provincial Park" or "Provincial Recreation Area" suffixes. Confirm `NAME_SUFFIXES_TO_STRIP` handles these (BC Parks spec already raises this; deduplicate the work).

## Success criteria

Integration is "done" when:
- ✓ Ingestion runs cleanly against test bbox (Kananaskis area).
- ✓ Normalizer maps native Alberta Parks fields to canonical schema.
- ✓ field_precedence migration applied to test + prod.
- ✓ source_quality_score row added.
- ✓ D4 on JT corpus still 12/12 identical.
- ✓ Synthetic test verifying cross-jurisdiction non-overlap (BC ↔ Alberta border geography).
- ✓ PR merged.

After this lands, iOverlander is the fourth and final source spec before Segment B corridor execution. iOverlander is the highest-effort source of the four — UGC, no formal API, very different ingestion shape from the federal/provincial sources.
