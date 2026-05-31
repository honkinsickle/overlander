# Phase 1.5: Parks Canada Source Integration

**Status:** Draft
**Sequence:** First of five Segment B prerequisite specs
**Estimated effort:** Half-day to day
**PR scope:** Single focused PR adding Parks Canada as a federated source

## Why this source

Parks Canada is the Canadian federal equivalent of NPS — manages national parks, national historic sites, and national marine conservation areas across Canada. Highest-trust source for Canadian federal lands, the natural anchor for cross-border federation parallel to how NPS anchors US federal data. Required for Segment B (Whitefish → Whitehorse) to have meaningful authoritative coverage of Canadian federal sites along the route (Banff, Jasper, Kootenay, Yoho, Glacier-Revelstoke, Mount Revelstoke, Kluane).

## Data source

**Open Maps** (Parks Canada's open data portal) at `https://open.canada.ca` and direct Parks Canada GIS endpoints. Available datasets to investigate during implementation:

- **Parks Canada places** (national parks, historic sites, marine conservation areas) — point + polygon geometries with metadata.
- **Parks Canada campgrounds** — point data with facility detail.
- **Parks Canada reservations** (Parks Canada Reservation Service) — bookable site availability, parallel to RIDB for US federal sites.

Investigation step in implementation: determine which combination of endpoints gives the campground-level detail Segment B needs. Likely 2-3 endpoints combined.

**License:** Open Government License - Canada. Compatible with derivative-data product. No attribution requirement in product; attribution in documentation.

## Categories this source covers

Maps to existing OVERLANDER_01 canonical categories:
- `national_park_boundary` (geometry polygon)
- `national_historic_site` (new — see below)
- `national_marine_conservation_area` (new — see below)
- `campground` (point + facility data)
- `picnic_area`
- `trailhead`
- `viewpoint`

New canonical categories to add:
- `national_historic_site` — Parks Canada manages ~170 of these; no direct US equivalent at NPS (NPS national historic sites overlap conceptually but are categorized as `historical_park`).
- `national_marine_conservation_area` — Parks Canada-specific designation.

Both new categories slot into the existing category hierarchy without disrupting matcher rules.

## Field precedence

For each canonical field, Parks Canada's rank vs existing sources (NPS, RIDB, Google, OSM):

| Field | Parks Canada rank | Reasoning |
|---|---|---|
| `canonical_name` | 1 (highest) for Canadian sites; below NPS for US sites | Federal authority on its own sites |
| `description` | 1 for Canadian sites | Often well-curated by park rangers |
| `geometry` | 1 for Canadian sites | Federal-source geometry is authoritative |
| `contact` | 1 for Canadian sites | Official phone/website |
| `hours` | 2 (below Google) | Google generally fresher for hours |
| `amenities` | 2 (below specific source data) | Union from all sources |

Implementation: the `field_precedence` table needs per-source-per-field entries. Add 6 rows for Parks Canada, ranked above OSM/Google for the fields where it's authoritative.

**Important nuance:** ranking is fine-grained by *jurisdiction* — Parks Canada is rank 1 for sites *it manages* (Canadian federal), but doesn't apply to US sites at all (no rows compete). Document this pattern in the precedence rule so future Canadian provincial sources can use the same "jurisdiction-scoped precedence" approach.

## Source quality score

Recommended `source_quality_score = 95` (vs NPS=100, RIDB=85, Google=70, OSM=50).

Below NPS because the matcher uses quality score for deterministic tie-breaking when two federal-source rows compete; we don't expect Parks Canada and NPS to overlap geographically, but the tie-breaking order should reflect that NPS is the more mature source in the system. Effectively no operational impact since the sources don't share geography.

## Match rules — does Parks Canada participate in:

- **`fed_exact` (≤10m federal-pair anchor):** YES. Parks Canada ↔ Parks Canada Reservation Service (if separately ingested) is the direct parallel to NPS ↔ RIDB. If the reservation system is bundled into the same ingestion as the places endpoint, fed_exact won't have a partner to anchor against and the rule won't fire — that's fine, name_dominant will handle federation with Google.
- **`amenity_rollup` (≤100m parent anchor):** YES. Parks Canada amenity-type records (picnic areas, trailheads) should roll up into their parent park boundary the same way NPS amenities roll into park boundaries.
- **`name_dominant` (cross-source name + category):** YES. Standard federation.
- **`close_nameless` (manual_review queue):** YES. Standard fallback.
- **Same-source guard:** YES. Two Parks Canada records of the same name + category should never merge with each other (each is a discrete site in their taxonomy).

## Ingestion implementation

**Directory:** `data/ingestion/parks-canada/`

**Files:**
- `client.ts` — HTTP client wrapping Parks Canada / Open Canada API endpoints with retry, rate limiting, and pagination
- `normalizer.ts` — transforms native Parks Canada records into `normalized_payload` matching the canonical schema
- `index.ts` — orchestrator: fetches by bbox or by named-park-list, batches, writes to `source_record`

**Inputs:**
- bbox (for corridor-scoped ingestion — Segment B will pass the Whitefish→Whitehorse rectangle)
- Optional named-park list (for full-park-detail enrichment of specific anchors)

**Outputs:**
- `source_record` rows with `source_id = 'parks_canada'`, `raw_payload` (verbatim API response), `normalized_payload` (canonical shape)
- Ledger entry per ingestion run (records fetched, records skipped, errors)

**Rate limiting:** Parks Canada / Open Canada have no documented rate limits but rate-limit politely (~5 req/sec default) to avoid issues at scale.

**Pagination:** all queries paginated using PostgREST-pattern `range()` to handle the corridor-scale 1000+ row responses.

**Idempotency:** `(source_id, external_id)` is the upsert key. Re-running ingestion against the same bbox produces no new rows.

## Bbox strategy

Single enclosing rectangle, same pattern as Segment A. For initial integration testing, use a tight bbox around Banff (smaller corpus, faster iteration). Expand to Segment B's full Whitefish→Whitehorse rectangle when integration is validated.

Initial test bbox (Banff National Park area): `[-117.0, 50.5, -114.5, 52.5]`

## Validation criteria

Pre-merge integration testing:

1. **Ingestion against test bbox:** Banff park boundary returned as polygon, key campgrounds (Tunnel Mountain, Two Jack, Lake Louise) returned as points with reasonable amenity data.
2. **Normalizer correctness:** spot-check 5 records, confirm `canonical_name`, `geometry`, `contact`, `description` populate from the right source fields.
3. **No regressions on existing sources:** D4 suite on JT corpus still 12/12 with identical outcome distribution (Parks Canada integration shouldn't affect JT data at all — sanity check).
4. **field_precedence migration applies cleanly** on test and prod.
5. **Source quality score** correctly used by matcher in synthetic test (Parks Canada + Google sources for same place, Parks Canada wins canonical_name).

## Out of scope (filed as future work, not bundled)

- Provincial parks integration (separate spec — BC Parks, then Alberta Parks)
- iOverlander integration (separate spec — last source before Segment B execution)
- Parks Canada *operating status* live data (whether a park is currently open, fire closures, etc.) — separate concern, may be deferred to Phase 3b or later
- Historic site detail enrichment (descriptions, historical context) — base ingestion only; rich content is V2

## Open questions to resolve during implementation

1. Does the Open Canada API provide direct campground-level point data, or does it stop at park boundaries? If the latter, need to identify the campground-specific endpoint.
2. Does Parks Canada Reservation Service have a public API? If yes, integrate as the fed_exact partner. If no, fed_exact won't fire for Parks Canada and that's acceptable — name_dominant carries federation.
3. Coordinate system — confirm WGS84 (matches existing schema) or transform if different.

## Success criteria

Integration is "done" when:
- ✓ Ingestion runs cleanly against test bbox (Banff) producing expected records.
- ✓ Normalizer maps native Parks Canada fields to canonical schema with no information loss.
- ✓ field_precedence migration applied to test + prod, Parks Canada ranked correctly for Canadian federal sites.
- ✓ source_quality_score row added.
- ✓ D4 on JT corpus still 12/12 identical (no regression).
- ✓ New synthetic test verifying Parks Canada + Google federation behaves correctly.
- ✓ PR merged.

After this lands, BC Parks integration is the next spec.
