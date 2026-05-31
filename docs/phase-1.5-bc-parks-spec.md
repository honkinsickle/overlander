# Phase 1.5: BC Parks Source Integration

**Status:** Draft
**Sequence:** Second of five Segment B prerequisite specs
**Estimated effort:** Half-day to day
**PR scope:** Single focused PR adding BC Parks as a federated source
**Depends on:** Parks Canada spec landed (establishes Canadian-jurisdiction precedence pattern)

## Why this source

BC Parks manages ~1,000 provincial parks, conservancies, ecological reserves, and recreation areas across British Columbia. Provincial-level authority below Parks Canada in the Canadian federal/provincial hierarchy. Critical for Segment B coverage because the Whitefish → Whitehorse route passes through extensive BC provincial-park territory (Mount Robson, Stone Mountain, Muncho Lake, Liard River Hot Springs) where Parks Canada has no coverage and federal-only sourcing would leave large gaps.

Establishes the *provincial source pattern* that Alberta Parks (next spec) will reuse.

## Data source

**DataBC** (BC's open data portal) at `https://catalogue.data.gov.bc.ca`. Available datasets to investigate during implementation:

- **BC Parks, Ecological Reserves, and Protected Areas** — polygon geometries with park metadata.
- **BC Parks Campgrounds** — point data with facility detail.
- **BC Parks Recreation Sites and Trails** — separate dataset for non-park rec sites managed by Recreation Sites and Trails BC.

Investigation step in implementation: confirm which datasets give campground-level point data vs park boundaries. Likely 2 endpoints combined (boundaries + campgrounds), possibly 3 if rec sites are worth a separate ingestion.

**License:** Open Government License - British Columbia. Compatible with derivative-data product.

## Categories this source covers

Maps to existing OVERLANDER_01 canonical categories:
- `provincial_park_boundary` (new — see below)
- `provincial_recreation_area` (new — see below)
- `campground` (point + facility data)
- `picnic_area`
- `trailhead`
- `viewpoint`

New canonical categories to add:
- `provincial_park_boundary` — provincial-jurisdiction geometric boundary, parallel to `national_park_boundary`.
- `provincial_recreation_area` — BC-managed rec sites distinct from parks.

Both new categories slot into the existing hierarchy and reuse the same matcher rules as their federal counterparts.

## Field precedence

For each canonical field, BC Parks' rank vs existing sources for BC sites:

| Field | BC Parks rank | Reasoning |
|---|---|---|
| `canonical_name` | 1 for BC provincial sites | Provincial authority on its own sites |
| `description` | 1 for BC provincial sites | Often well-curated |
| `geometry` | 1 for BC provincial sites | Provincial-source geometry is authoritative |
| `contact` | 1 for BC provincial sites | Official phone/website |
| `hours` | 2 (below Google) | Google generally fresher |
| `amenities` | 2 (below specific source data) | Union from all sources |

**Jurisdiction-scoped precedence pattern:** BC Parks ranks 1 only for *BC provincial* sites. Doesn't compete with Parks Canada (different jurisdiction — federal vs provincial don't overlap geographically) or Alberta Parks (different province). The pattern established in the Parks Canada spec applies cleanly here.

Add 6 rows to `field_precedence` for BC Parks, scoped to provincial-park records.

## Source quality score

Recommended `source_quality_score = 90` (vs NPS=100, Parks Canada=95, RIDB=85, Google=70, OSM=50).

Below Parks Canada because provincial taxonomy is sometimes less consistently maintained than federal, but well above Google for authoritative-source tie-breaking. Effectively no operational impact since BC Parks doesn't share geography with NPS or Parks Canada.

## Match rules — does BC Parks participate in:

- **`fed_exact` (≤10m federal-pair anchor):** NO. fed_exact is reserved for federal-source pairs (NPS↔RIDB, Parks Canada↔Reservation Service). BC Parks is provincial; no provincial-source pair exists that warrants the same coordinate-coincidence trust level. Federation with Google happens via name_dominant instead.
- **`amenity_rollup` (≤100m parent anchor):** YES. BC Parks amenity-type records (picnic areas, trailheads) roll up into their parent park boundary the same way NPS amenities do.
- **`name_dominant` (cross-source name + category):** YES. Standard federation with Google + OSM.
- **`close_nameless` (manual_review queue):** YES. Standard fallback.
- **Same-source guard:** YES. Two BC Parks records of the same name + category should never merge with each other.

## Ingestion implementation

**Directory:** `data/ingestion/bc-parks/`

**Files:**
- `client.ts` — HTTP client wrapping DataBC API endpoints with retry, rate limiting, pagination
- `normalizer.ts` — transforms native BC Parks records into canonical `normalized_payload`
- `index.ts` — orchestrator: fetches by bbox, batches, writes to `source_record`

**Inputs:** bbox

**Outputs:**
- `source_record` rows with `source_id = 'bc_parks'`, raw + normalized payloads
- Ledger entry per ingestion run

**Rate limiting:** DataBC has documented limits — rate-limit politely (~5 req/sec default).

**Pagination:** PostgREST-style `range()` pagination for corridor-scale responses.

**Idempotency:** `(source_id, external_id)` upsert key.

## Bbox strategy

Single enclosing rectangle for the BC portion of Segment B. For initial integration testing, use a tight bbox around Mount Robson Provincial Park (smaller corpus, single iconic site, validates the pipeline). Expand to full BC corridor when integration is validated.

Initial test bbox (Mount Robson area): `[-119.5, 52.8, -118.5, 53.3]`

## Validation criteria

Pre-merge integration testing:

1. **Ingestion against test bbox:** Mount Robson park boundary returned as polygon, key campgrounds (Robson Meadows, Lucerne) returned as points with reasonable amenity data.
2. **Normalizer correctness:** spot-check 5 records, confirm canonical fields populate.
3. **No regressions:** D4 suite on JT corpus still 12/12 with identical outcome distribution.
4. **field_precedence migration** applies cleanly on test and prod.
5. **Source quality score** correctly used by matcher.
6. **Cross-source non-overlap with Parks Canada:** synthetic test confirming a place in a BC provincial park (e.g., Mount Robson) and a place in a nearby Canadian national park (e.g., Jasper) federate independently — they should NOT cross-merge.

## Out of scope (filed as future work, not bundled)

- Alberta Parks integration (next spec)
- iOverlander integration (subsequent spec)
- Recreation Sites and Trails BC's *non-park* rec sites — defer evaluation to after BC Parks core ingestion is stable. Worth ingesting if coverage justifies it; bundle decision into a follow-on spec rather than into this PR.
- Live BC Parks operational status (closures, alerts) — separate concern, deferred to Phase 3b or later.
- Provincial campground reservation system (DiscoverCamping.ca) integration — defer to Phase 3b unless Segment B execution surfaces a clear need for booking-availability data.

## Open questions to resolve during implementation

1. Are park boundaries and campgrounds in separate DataBC datasets, or unified? Two endpoints likely; confirm during implementation.
2. Are Rec Sites and Trails BC ingested in this PR or deferred? Default: defer. Reconsider if Segment B corridor surfaces coverage gaps.
3. Coordinate system — DataBC typically serves WGS84 but historical datasets sometimes use BC Albers (EPSG:3005); transform if needed.
4. Naming convention — BC Parks records often include "Provincial Park" suffix in canonical names. Confirm whether the existing `NAME_SUFFIXES_TO_STRIP` handles this or needs extension.

## Success criteria

Integration is "done" when:
- ✓ Ingestion runs cleanly against test bbox (Mount Robson area).
- ✓ Normalizer maps native BC Parks fields to canonical schema with no information loss.
- ✓ field_precedence migration applied to test + prod, BC Parks ranked correctly for BC provincial sites.
- ✓ source_quality_score row added.
- ✓ D4 on JT corpus still 12/12 identical.
- ✓ Synthetic test verifying cross-jurisdiction non-overlap (BC Parks vs Parks Canada in adjacent geography).
- ✓ PR merged.

After this lands, Alberta Parks integration is the next spec — should be faster since it reuses the provincial-source pattern established here.
