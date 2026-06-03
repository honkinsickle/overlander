# entity-resolution/

Week 3 work. Stubbed for now.

Will contain:
- `matcher.ts` — deterministic candidate scoring (Jaro-Winkler name + distance + category compat)
- `promote.ts` — `place_match` → `master_place` linkage
- `audit-cli.ts` — manual review CLI (`pending`, `show`, `confirm`, `reject`, `merge`, `coverage`)
- `tests/fixtures/` — known good/bad match pairs

See `phase-1-build-spec.md` section 9.

---

## Spec corrections (canonical from week-1 smoke tests)

When implementing `matcher.ts` in week 3, reference these values — not the original spec:

- **RIDB auth header** is `apikey:` (lowercase), not `X-API-KEY`.
- **RIDB OrgID → agency** mapping:
  - `128` → nps (spec said 10 — wrong)
  - `131` → usfs
  - `126` → blm (spec said 125 — wrong)
  - `130` → usace

Source: `/api/v1/organizations` endpoint (RIDB), verified 2026-05-27.

## Aggregated fields (UNION, not precedence-resolved)

Three master_place fields are arrays that aggregate across all linked
source_records rather than picking one source per field via `resolve_field()`:

- `alternative_names TEXT[]` — union of all distinct names seen across sources
- `secondary_categories TEXT[]` — union of all distinct inferred_categories
- `overlander_tags TEXT[]` — union of all tag arrays in normalized_payload.overlander_tags

These three are intentionally absent from `field_precedence` and must be
handled by a dedicated `recompute_aggregated_fields(master_place_id)` helper
called from `recompute_master_place()` in week 3. The standard
`resolve_field()` path returns a single value — wrong shape for arrays.

Implementation sketch:

```sql
-- inside recompute_master_place(p_master_place_id UUID):
-- after the field-precedence loop, call:
PERFORM recompute_aggregated_fields(p_master_place_id);
```

`recompute_aggregated_fields()` reads the linked source_records, deduplicates
across their `name` / `inferred_category` / `normalized_payload.overlander_tags`,
and writes the result to `master_place.alternative_names` /
`secondary_categories` / `overlander_tags`.

---

## ER Findings (observed during smoke tests, applied in week 3)

### ER Finding: OSM amenity nodes are sub-features, not siblings

Observed in JT smoke test (2026-05-27): 6/8 RIDB campgrounds match
within 100m to OSM nodes tagged dump_station / toilet / water /
fire_pit / picnic_area. These are sub-features inside the campground
polygon, not sibling places.

~53% of JT OSM rows (62/116) are amenity-type categories that should
roll up into the nearest containing campground/recarea master_place
rather than become orphan master_places.

Implication for week 3 ER: needs a separate amenity-rollup path.
If source_record.inferred_category in AMENITY_TYPES (dump_station,
toilet, water, fire_pit, picnic_area, shower, charging_station) AND
there's a campground/recarea master_place within ~100m, merge into
that master_place's amenities JSONB instead of creating a sibling.

Do not encode in schema yet — keep AMENITY_TYPES as a const in
matcher.ts and resolve at ER time.

OSM is intentionally absent from the `amenities` row in
`field_precedence` for this exact reason — OSM amenity data reaches
master_place via the matcher.ts amenity-rollup path, not via
resolve_field().

### ER Finding: NPS↔RIDB share coordinates at ~0m for federally-bookable campgrounds

Observed in JT 3-way overlap (2026-05-27): Belle, White Tank, and
Hidden Valley campgrounds have NPS and RIDB lat/lng identical to
~0m precision. Federally-bookable NPS campgrounds use Recreation.gov
(RIDB) as their reservation backend, so both sources draw from the
same canonical coordinate.

Implication for week 3 ER: a distance-only auto-link threshold of
≤10m for (source_id='nps', source_id='ridb') pairs would be 100%
correct for this class. The name-similarity + category-compat
scoring is unnecessary for NPS↔RIDB pairs at near-zero distance.

### ER Finding: NPS↔RIDB drift up to ~350m for some campgrounds

Observed in JT 3-way overlap (2026-05-27): not every NPS↔RIDB pair
shares coordinates. Sheep Pass Group separated by 248m, Jumbo Rocks
Campground by 341m. Likely NPS uses entrance kiosk coordinates while
RIDB uses center-of-sites (or vice versa).

Implication for week 3 ER: the spec §9.1 candidate retrieval radius
of 200m is too tight — would miss Jumbo Rocks. Bump to ≥400m for
NPS↔RIDB candidate retrieval. Standard 0.85 confidence threshold
should still gate auto-link via name similarity (both sources use
"<Name> Campground" formatting).

### ER Finding: OSM Sheep Pass exception — some campgrounds ARE OSM nodes

Observed in JT 3-way overlap (2026-05-27): OSM Sheep Pass Group is
tagged `tourism=camp_site` (not just an amenity child), but with
name="3" (the site number, not a descriptive name). 1 of 6 JT
campgrounds; the other 5 surface only as OSM amenity nodes.

Implication for week 3 ER: the OSM-amenity-rollup heuristic above
doesn't fully replace name-based matching. Even for amenity-rollup
candidates, also run name match against any nearby
inferred_category='campground' OSM rows. The Jaro-Winkler floor for
linking should reject the "3" ↔ "Sheep Pass Group" match (similarity
< 0.3); category compat (camp_site ↔ campground = 1.0) + distance
(98m) should still lift combined_confidence into the auto-link band.

### ER Finding: OSM park-as-node is at polygon centroid, not facility centroid

Observed in JT 3-way overlap (2026-05-27): OSM "Joshua Tree National
Park" (osm:node:358802880) sits at the geographic centroid of the
park polygon (~58km from RIDB's recarea coordinate and NPS's park
centroid). 500m candidate retrieval misses it entirely.

Implication for week 3 ER: for source_record.inferred_category='park',
distance-only candidate retrieval is wrong. Use polygon containment
against NPS boundary polygons (stored on master_place.geometry_polygon
once recompute_master_place runs). If an OSM park node falls inside
an NPS park's boundary, auto-link regardless of distance.

This needs `master_place.geometry_polygon` populated first
(week-3 recompute_master_place reads geometry_polygon from NPS via
field_precedence). Sequence matters: ER for parks runs after polygon
promotion, not before.

---

## 4-way overlap findings — Google Places JT smoke 2026-05-27

Single-tile Google Places run against the JT bbox (1 request, 5 inserts).
All 5 inserted rows are JT campgrounds; all 5 match an OSM + RIDB + NPS
record within 500m. Findings below.

### ER Finding: Google lodging taxonomy includes campground

Observed in JT 4-way overlap: requesting
`includedPrimaryTypes: ['lodging', ...]` returned 5 results, all with
`primaryType: "campground"`. Google's `lodging` is a taxonomic parent
that contains `campground` as a child type.

Implication for week 3 ER: the `category_compatibility` matrix in
`matcher.ts` must include `lodging ↔ campground = 1.0`. Without
this, a Google-discovered campground (Google's local type is
`campground`) would fail to match an RIDB row whose
`inferred_category='lodging'` (hypothetical — RIDB doesn't actually
use `lodging`, but the principle generalizes to any future source
that uses Google-style hierarchical typing).

More broadly: `category_compatibility` should encode the cross-source
type taxonomy, not just direct equality.

### ER Finding: Google coordinate drift varies 8m–216m vs RIDB

Observed in JT 4-way overlap: Google's lat/lng for the same
campground vs RIDB:

  - Ryan Campground:         8m
  - Jumbo Rocks Campground: 67m
  - Hidden Valley:          88m
  - White Tank:             88m
  - Sheep Pass:            216m

Implication for week 3 ER: the spec §9.1 candidate-retrieval radius
of 200m is the right floor. Tightening to ≤100m would miss Sheep
Pass's Google↔RIDB pair. The combined_confidence formula's 0.4 ×
distance weight (with 100m cutoff) correctly distinguishes near-zero
matches (Ryan) from near-radius matches (Sheep Pass) — keep it.

Google appears to use parking-lot or kiosk coordinates that drift
from the campground center; RIDB uses booking-system coordinates
which match NPS's reservation feed at 0m. Treat Google geometry as
weaker than NPS/RIDB even when present.

### ER Finding: Google lodging is the cleanest 4-way discovery route

Observed in JT 4-way overlap: 5/5 of Google's results matched all
three other sources within 500m. By comparison: RIDB ↔ NPS is 6/8;
OSM ↔ RIDB is 6/8 (and four of those match an OSM dump_station, not
a campground node — see the amenity-rollup finding above).

Implication for week 3 ER: when seeding the test fixtures in
`entity-resolution/tests/fixtures/`, prefer Google-anchored 4-way
matches as positive examples. They have the strongest signal across
all sources and clean structural typing.

Caveat: this is specific to federally-bookable campgrounds. Google's
discovery route for non-federal POIs (gas stations, restaurants) will
behave differently — no NPS/RIDB neighbors, OSM neighbors common.

### ER Finding: peak ↔ campground must be category-incompatible

Observed in JT 4-way overlap: Google's Hidden Valley Campground has
its nearest OSM neighbor as "Chimney Rock"
(`inferred_category=peak`), 78m away — closer than the actual OSM
amenity nodes inside the campground (dump station at ~60m).

Implication for week 3 ER: the `category_compatibility` matrix must
explicitly set `peak ↔ campground = 0.0` (or near-zero). Without it,
the amenity-rollup path could wrongly attach a peak feature as an
amenity of the nearest campground master_place, polluting the
amenities JSONB.

General rule: geological features (peak, spring, beach, viewpoint)
are NOT amenities of nearby facilities. They're sibling places.
AMENITY_TYPES (dump_station, toilet, water, fire_pit, picnic_area,
shower, charging_station) is the correct allowlist — anything else
should be treated as a sibling regardless of proximity.

---

## Phase 3a diagnostic: cross-source distance modes A/B/C and the corrected matcher rules

The first `matcher.ts` pass implemented the spec §9.1 formula literally
(0.4 × distance + 0.4 × name + 0.2 × category, distance clipped at 100m,
auto-link at ≥0.85). A throwaway diagnostic over the 5 JT campground
fixtures (`diagnose.ts`, uncommitted) measured pair-by-pair confidence
under that formula and exposed three failure modes — not fixture-fitting
but real properties of the source data:

### Mode A — 60–100m drift on named cross-source pairs

Pairs that are genuinely the same place but drift apart because different
sources put the lat/lng at slightly different reference points (kiosk vs.
center vs. parking lot).

Measured under the spec formula:

| Pair                                 | dist  | name_sim | cat_compat | conf  | verdict |
|--------------------------------------|------:|---------:|-----------:|------:|---------|
| Hidden Valley NPS↔Google             | 88.0m |    1.000 |       1.00 | 0.648 | review  |
| Hidden Valley RIDB↔Google            | 88.0m |    1.000 |       1.00 | 0.648 | review  |
| White Tank NPS↔Google                | 87.8m |    1.000 |       1.00 | 0.649 | review  |
| White Tank RIDB↔Google               | 87.8m |    1.000 |       1.00 | 0.649 | review  |
| Jumbo Rocks RIDB↔Google              | 67.5m |    1.000 |       1.00 | 0.730 | review  |
| Sheep Pass NPS↔Google                | 41.4m |    1.000 |       1.00 | 0.834 | review  |

Distance clip at 100m drops distance contribution to near zero for
60–100m pairs. With perfect name + category they max at conf ≈ 0.83
— just under the 0.85 auto-link threshold. The 41.4m Sheep Pass case
misses by 0.016.

### Mode B — 200–350m drift exceeds candidate radius

Genuinely-same-place pairs that the spec's 200m candidate retrieval
radius excludes entirely. The blended formula never sees them.

| Pair                                 | dist   | name_sim | cat_compat | conf  | flag     |
|--------------------------------------|-------:|---------:|-----------:|------:|----------|
| Jumbo Rocks RIDB↔NPS                 | 340.9m |    1.000 |       1.00 | 0.600 | EXCLUDED |
| Jumbo Rocks NPS↔Google               | 346.7m |    1.000 |       1.00 | 0.600 | EXCLUDED |
| Sheep Pass RIDB↔Google               | 215.7m |    1.000 |       1.00 | 0.600 | EXCLUDED |
| Sheep Pass RIDB↔NPS                  | 247.7m |    1.000 |       1.00 | 0.600 | EXCLUDED |

### Mode C — non-semantic OSM names

OSM tags Sheep Pass campsites with names "1" through "6" (campsite
numbers, not the campground name). Within 39–100m of the real
campground cluster, with `category=campground` (correct OSM
taxonomy), but `name_sim = 0` against any neighbor.

| OSM record (name)     | Distance to nearest cluster MP | name_sim | cat_compat | conf  |
|-----------------------|--------------------------------:|---------:|-----------:|------:|
| "5"                   | 39.0m                           |    0.000 |       1.00 | 0.444 |
| "4"                   | 45.4m                           |    0.000 |       1.00 | 0.418 |
| "1"                   | 99.4m                           |    0.000 |       1.00 | 0.202 |

Below the 0.6 review floor — all become orphan master_places with the
spec formula.

### Corrected rules (D2 refinement)

The blended formula stays unchanged — it's now the fallback for residual
cases. Three changes upstream of it:

**1. Widen candidate retrieval radius from 200m → 500m.**
The `find_master_place_candidates` RPC default is bumped; matcher.ts
`findCandidates` default tracks. Resolves Mode B's exclusion problem.

**2. `name_dominant` auto_link rule** (matcher.ts step 3).

Fires when a candidate within 500m has `name_sim ≥ 0.85` AND
`cat_compat ≥ 0.8` AND the candidate's master_place does NOT already
have a source_record from the incoming source. Auto-links with
`method='name_dominant'` and `confidence` = the blended score.

Resolves Mode A entirely. Also covers the Mode B pairs that re-enter
scoring under the widened radius.

The same-source guard prevents chain-business false merges: two
distinct OSM Shell gas stations 500m apart with identical names won't
auto-link to each other because the candidate already has OSM linked.
Those fall through to blended scoring (where distance does its job).

**3. `close_nameless` manual_review rule** (matcher.ts step 4).

Fires when a candidate within 100m has `cat_compat ≥ 0.8` AND
`name_sim < 0.85` AND the same-source guard passes. Routes to human
review rather than blind auto-merge.

Resolves Mode C: OSM Sheep Pass campsite-numbered nodes within 100m
of the cluster queue for review. Beyond 100m they fall through to the
blended formula and typically become their own master_places.

The new rules execute **after** `fed_exact` and `amenity_rollup`,
**before** the blended fallback. Sequence (per matcher.ts matchOne):

1. fed_exact (NPS↔RIDB within 10m → auto_link conf 1.0)
2. amenity_rollup (AMENITY_TYPES → nearest parent within 100m)
3. **name_dominant** (NEW)
4. **close_nameless** (NEW)
5. blended scoring (existing fallback)

### Fixture expectation adjustment for Sheep Pass

Under the corrected rules, OSM Sheep Pass campsite nodes route to
`manual_review`, not `auto_link`. The D4 test fixture for Sheep Pass
should expect `nps`, `ridb`, `google` auto-linked, with OSM records
left in pending review state — not in `expected_source_ids`.

---

## Known cross-category federations

`fed_exact` (NPS↔RIDB within 10m) auto-links at confidence 1.0 with
**no category-compatibility check**. This is by design: federal
coordinate coincidence is the strongest signal in the system — NPS
and RIDB drawing from the same canonical coordinate effectively means
"the agencies agree this is one physical place," which trumps
source-side taxonomy mismatches.

Observed case (Segment A rematerialize, 2026-05-29):

  - **McGee Overlook** — NPS source_record (`inferred_category=viewpoint`)
    federated into a master_place seeded by RIDB
    (`primary_category=facility`). RIDB's taxonomy labels overlooks /
    picnic-areas / launches as `Facility`; NPS labels the same physical
    site as `viewpoint`. The system correctly identifies them as one
    place via coordinate match.

Auditing implication: when a 3b audit pass surfaces master_places
whose `primary_category` disagrees with one of its linked source_records'
`inferred_category`, this is **not necessarily a bug**. Check whether
the link came through fed_exact (`place_match.match_method = 'fed_exact'`);
if so, it's expected, and the right fix is at the field-precedence /
display-category layer, not at the matcher.

---

## Known limitations / 3b work

### Seed-geometry coupling in amenity rollup (fix in 3b)
Amenity rollup distance is measured against the master_place's seed
geometry (the creating source's coords), not the final precedence-
resolved geometry. Currently safe because source_quality_score ordering
(NPS>RIDB>Google>OSM) coincidentally matches geometry precedence, so the
seed source is also the geometry winner. NOT enforced — a future source
where quality_score and geometry precedence disagree would break this.

3b fix: two-pass design. Resolve named places + recompute geometry first,
THEN roll up amenities against finalized parent geometry via polygon
containment (preferred) or distance-to-finalized-point (fallback). This
converges with the polygon-containment work and also fixes the 28 orphan
dump stations.

### Polygon containment: federate orphan amenities into containing parks (Phase 3b — DESIGN LOCKED 2026-05-31)

**What it is.** Federate orphan amenity records into their containing park
`master_place` via a spatial query (`ST_Covers`). Establishes a
parent/child containment relationship so the system can answer
"campgrounds in Banff"-style searches and render "located in Banff
National Park" context on amenity cards. The amenity stays a distinct
`master_place` — this is a *relationship*, not a merge.

**Design status: all open questions resolved (locked 2026-05-31).** The
decisions below are final; implementation can proceed against them without
re-litigating.

**Locked decisions:**

1. **Ongoing computation with one-time backfill.** Polygon containment
   runs as part of the `recompute_master_place` pipeline going forward. A
   dedicated backfill script calls `recompute_master_place` for every
   existing `master_place` at initial deployment to populate relationships
   for existing data.

2. **Trigger point: `recompute_master_place` (per-record granularity).**
   - When recompute fires for an **amenity** (point geometry), the function
     queries which park polygons cover the point.
   - When recompute fires for a **park** (polygon geometry), the function
     queries which amenity points fall inside its polygon and updates
     relationships for all contained amenities.

3. **Schema: new `place_relationships` table.**
   - Columns: `(child_master_place_id, parent_master_place_id, relationship_type, computed_at)`.
   - Primary key on `(child_master_place_id, parent_master_place_id, relationship_type)`.
   - Foreign keys to `master_place(id)` with `ON DELETE CASCADE`.
   - CHECK constraint: `relationship_type IN ('contained_in')` — strict
     enum; future relationship types require a migration to expand.
   - CHECK constraint: `child_master_place_id <> parent_master_place_id` —
     prevents self-referential relationships.
   - Indexes on **both** `(parent_master_place_id, relationship_type)` and
     `(child_master_place_id, relationship_type)` for efficient queries in
     both directions.

4. **Spatial query uses `ST_Covers`, not `ST_Contains`.** `ST_Covers`
   includes boundary points (a campground exactly on the park edge counts
   as contained). `ST_Contains` is strict and creates surprising edge cases
   for campgrounds at park boundaries.

5. **Park polygon change handling: fan-out recomputation.** When a park's
   polygon is updated, all previously-contained amenities have their
   containment recomputed via `recompute_master_place` fan-out. Rare in
   practice; cost acceptable.

   **Refined during implementation (Phase 3b milestone 2, 2026-06-01 —
   migration `20260601040000`).** The locked wording above described fan-out
   as recursive `recompute_master_place` calls on *previously-contained*
   amenities. Implementation instead does a **direct edge-set rewrite inside
   the park's own recompute** (delete + reinsert the park's `contained_in`
   edges per role). Two reasons the mechanism changed: (a) the literal
   "previously-contained" wording has a **grow-case gap** — when a polygon
   expands to cover a *newly*-contained amenity, that amenity was never
   previously contained, so a previously-contained-only fan-out would never
   create its edge; the stateless rewrite handles grow and shrink uniformly.
   (b) it avoids the recursive recompute fan-out separately tracked as a perf
   heavy-tail above. Same fan-out *semantics* (one park recompute updates N
   amenity relationships), bounded *mechanism* (one query per role, not N
   recompute calls). Point-in-polygon is used for nested child parks too
   (a child park is placed by its representative point), keeping `contained_in`
   a single point-in-polygon relation; polygon-in-polygon would be a distinct
   future relationship type. See the migration header for the full rationale.

6. **Multi-park unions** (e.g., Waterton-Glacier International Peace Park):
   treat boundary records as separate park `master_places`. An amenity
   inside both registers two relationships (one per containing park). Search
   returns the amenity for queries about either park. The one-to-many schema
   supports this natively.

7. **Nested parks** (e.g., a BC provincial park inside Parks Canada
   territory): both relationships persist — the amenity is contained in
   both. The application layer decides which to surface in the UI (typically
   the most-specific containing park), but both are queryable.

**Prerequisite (satisfied).** `master_place.geometry_polygon` must be
populated for PC, BC, and Alberta park records. This was blocked by missing
`field_precedence` rows; resolved by migration
`20260601020000_phase1_5_geometry_polygon_promotion.sql` (applied test +
prod 2026-06-01), which adds `geometry_polygon` precedence rows for
`parks_canada` (1), `bc_parks` (2), and `alberta_parks` (3).

**Estimated effort:** 2–3 days focused work once started. Real architecture
work — fresh-session.

**Implementation outline (when picked up):**

1. Migration: create `place_relationships` table with all constraints and
   indexes.
2. Modify the `recompute_master_place` SQL function to compute containment
   relationships per the trigger logic above.
3. Backfill script: iterate over all `master_places` calling
   `recompute_master_place`.
4. Unit tests covering: amenity inside one park; amenity inside nested
   parks; amenity exactly on boundary (`ST_Covers` behavior); amenity
   outside all parks (no relationships); park with no amenities inside; park
   polygon change triggering fan-out recomputation.
5. Federation tests verifying: search "campgrounds in Banff" returns
   contained campgrounds; card displays "located in [park]" for contained
   amenities; no false relationships from spatial near-misses.
6. D4 regression check (relationships are additive; `matchAll` outcomes
   should be unchanged).
7. Smoke test on the Banff bbox: verify ~10–20 RIDB campgrounds get a
   `contained_in` relationship pointing at the Banff park `master_place`.

### matchAll perf — items deferred from the 2026-05-29 profile

Step-2 profile run (313 samples across the 15,645-record Segment A
corpus, trace at `data/.cache/matchall-perf-trace.jsonl` in the local
working tree) measured RPC roundtrip cost at 95.6% of matchOne time —
the empty-master_place skip is the only in-scope fix for that PR. Three
secondary items surfaced and were deferred:

1. **`searchPlanned` linear-scan replacement** (~4.1% of current
   matchOne time; sum=3.5s across 313 samples ⇒ ~3min extrapolated to
   the full corpus). Becomes the top remaining item once the RPC skip
   lands. p50 grows roughly linearly with `planned_size_at_start`:
   0.4ms at <100 → 16ms at 6–8K → 16ms at 10–15K (with a tier-2
   short-circuit dip at 8–10K from amenity-rollup category filter).
   At Segment B scale (no NPS/RIDB → more new_master_place outcomes →
   larger plannedMasterPlaces) this grows further. Candidate fix: coarse
   lat/lng grid index (e.g., 0.01°/~1km cells) for O(1) candidate
   lookups instead of O(N) linear scan.

2. **`findCandidates` merged-list re-sort.** The RPC returns
   `dbCandidates` already sorted by distance ASC, and `searchPlanned`
   could trivially return sorted output. The current code concats both
   then re-sorts the combined list. Negligible cost today (scoring loop
   is 0.0% of profile time), but correctness-equivalent to a single
   linear merge.

3. **`fetchSourceRecord` DB fallback is dead code during matchAll.**
   `initMatchAllCaches` pre-populates the cache with every record in the
   sort order; matchOne only ever calls `fetchSourceRecord` for IDs in
   that set. The fallback `db.from("source_record").select(...).eq(...)`
   path can never fire during a matchAll. Still needed for standalone
   `matchOne` callers (tests, audit CLI). Cleanest fix: rename to
   `fetchSourceRecordUncached` and explicitly call that from non-matchAll
   sites; matchAll's code path uses the cache map directly.

### Recompute fan-out has a heavy tail — architectural batching for 3b

The 2026-05-29 partial-apply failure and recovery exposed a structural
issue with `apply_match_outcomes`: per-outcome-batch recompute fan-out is
unbounded by batch size. Each batch of N outcomes triggers
`recompute_master_place(mp_id)` for every distinct master_place touched;
recompute scope itself grows with federation size at each MP.

Restoration timings (32 batches × 500 outcomes, post-PR #59 timeout
patch):

  - median batch: ~1.5s
  - p95 batch:    ~3.5s
  - worst batches (11, 12): **6.5–7.0s** — the same batches that timed out
    at 8s before the patch

The 300s explicit override on `apply_match_outcomes` covers the symptom.
The underlying pattern — "operation cost = outcome batch × recompute
scope per MP" — isn't bounded by either knob the orchestrator controls.
At Segment B+ scale (more federation density, more sources per MP) the
tail grows linearly while the median stays flat.

3b architectural improvement: batch the recompute step inside apply,
decoupling recompute scope from outcome batch size. Outcomes accumulate
their recompute queue; recompute then runs in its own bounded chunks
(e.g., recompute_master_place_batch(uuid[] LIMIT 100)). This converts
the heavy-tail risk into a predictable cost ceiling. Bundle with the
polygon-containment + seed-geometry refactor.

### Ingestion follow-ups from Parks Canada integration (2026-05-30)

Two forward-looking items surfaced while wiring Parks Canada — neither is
a bug; both are bets about where the next refactor pressure will appear.

1. **`fed_exact` is hardcoded to the NPS↔RIDB pair.** Parks Canada
   Reservation Service has no public API today, so `fed_exact` can't fire
   for Parks Canada — `name_dominant` carries Parks Canada ↔ Google
   federation in the meantime, which is acceptable per the spec. If PCRS
   ever exposes a programmatic surface, `findFederalAnchor` (in
   `matcher.ts`) needs extension beyond the hardcoded `nps` / `ridb`
   source-id check. Likely a small change — generalize to a `Map<source_id,
   partner_source_id>` lookup — but flag the dependency so the change
   isn't missed when PCRS lands.

2. **Three-endpoint ESRI client may want extraction.** Parks Canada hits
   three ESRI REST layers via the same `fetchEsriLayer(serviceUrl, bbox,
   label)` shape. BC Parks and Alberta Parks are both on ArcGIS Online
   per their open-data portals — same query API. If both follow this
   pattern, the third source confirms a shared utility belongs in
   `data/ingestion/lib/esri.ts`. Don't pre-extract — wait for the third
   instance to inform the abstraction shape, then refactor all three
   together.

### field_precedence resolution determinism (4a shipped; 4b deferred)

Surfaced during Parks Canada migration design; shipped 4a in the
migration-verify workflow-hardening cluster (migration
`20260601010000_phase3a_resolve_field_determinism`).

**4a — deterministic tie-breaker (SHIPPED).** `resolve_field` and the two
geometry resolution queries in `recompute_master_place` now order by
`priority ASC, source_quality_score DESC NULLS LAST, source_id ASC` at all
three resolution sites. The secondary `source_quality_score DESC` breaks a
priority tie by quality; the tertiary `source_id ASC` guarantees a total
order even when quality also ties — necessary because the real
jurisdictional collisions tie on quality by ingester convention
(nps == parks_canada == 0.95; bc_parks == alberta_parks == 0.90), so a
two-key sort alone would NOT have delivered determinism for them.
`NULLS LAST` is defensive only (`source_quality_score` is `NOT NULL`).
Behaviour-preserving on current data (D4 baseline unchanged); the fix is
defensive against any future collision, including a non-disjoint one.

**4b — `UNIQUE (field_name, priority)` constraint (DEFERRED).** Not added:
the schema **deliberately permits priority sharing across geographically-
disjoint sources** — NPS + Parks Canada + BC Parks + Alberta Parks all
share priority 1 for `canonical_name`, `description`, and `geometry` by
design (co-equal jurisdictional authority; they never co-link to one
master_place because the geographies are disjoint). A blunt global UNIQUE
constraint would fight that design, forcing arbitrary distinct priorities
on co-equal sources. The 4a tertiary tie-breaker provides operational
(total-order) determinism without it. A future improvement might be a
*partial* UNIQUE that excludes the documented disjoint groups, but the
tie-breaker already gives total ordering. **Revisit if a future source
pattern emerges that is non-disjoint AND priority-colliding** (a genuine
same-geography collision), where schema-level enforcement would add value
the tie-breaker can't.

### Ingester insert/update counter accuracy (surfaced 2026-05-30)

Every existing ingester (NPS, RIDB, Google, OSM, Parks Canada) reports
`inserted: N, updated: 0` regardless of whether each upsert was actually
an insert or an update of an existing row. Root cause: `upsertSourceRecord`
calls `upsert_source_record` RPC which returns just the row id — no
insert/update discriminator. Each ingester optimistically counts every
successful return as "inserted".

The Banff smoke iteration 2 unmasked this: 3,078 features fetched, all
"inserted" per the counter, but only 1,888 distinct rows persisted
because 1,190 collided on the (then-broken) external_id key. The
counter said "OK" when reality wasn't.

Fix shape (small follow-on PR across all sources):
  - `upsert_source_record` RPC returns `{ id, is_insert }`.
  - `upsertSourceRecord` helper threads the boolean back.
  - Each ingester tracks `inserted` vs `updated` separately.
  - `fetched - (inserted + updated)` becomes a real discrepancy signal.

Not Segment B scope. File for batched follow-on.

### Parks Canada Trails APCA dataset (Segment B follow-up)

Parks Canada publishes a separate Trails dataset
(`https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4`)
that this PR's three-endpoint client does NOT consume. Interest Points
covers viewpoints, lookouts, historic points, accommodation references —
but not trailheads. Banff smoke surfaced zero `inferred_category='trailhead'`
records from Parks Canada.

If Segment B execution shows a trailhead coverage gap (likely — OSM is
the primary trailhead source for Segment A, but Canadian OSM coverage
varies), add Trails APCA as a fourth Parks Canada endpoint or a separate
spec.

### Parks Canada URL_f field mislabeling (upstream data quality)

Accommodation layer's `URL_f` field contains stable park-site codes
(e.g., `"BAN-TMV1-D19"`) for 1,632 of 1,679 Banff records — not URLs as
the field name suggests. 40 records actually contain URLs in `URL_f`;
7 are empty. The field is being used as a code column despite being
named for URLs.

We don't depend on this: our accommodation external_id keys on
`OBJECTID` regardless. But if Parks Canada ever cleans up this upstream
mislabeling (puts real URLs in `URL_f` and moves the codes to a new
field), URL_f becomes a usable canonical-key candidate, more stable
than OBJECTID across ESRI layer rebuilds. Re-evaluate accommodation
external_id strategy at that point.

### Parks Canada within-source endpoint-disjointness (informational)

14 Accommodation × Interest Points pairs within 100m in the Banff bbox,
all describing semantically distinct features (campground vs interpretive
feature within same site — e.g., "Rocky Mountain House Heritage Camping"
vs "Bison Lookout - Rocky Mountain House" at 86m). Confirms the
two-endpoint pattern doesn't create within-source federation gaps — the
endpoints are complementary, not overlapping. BC Parks (next source,
DataBC, also multi-endpoint) should be audited similarly during its
smoke test.

### BC Parks is park-scoped, not point-scoped (data-shape note, 2026-05-31)

BC's open data publishes ONE record per protected area with aggregated
amenity summaries — no per-campsite point geometry exists in DataBC
(unlike Parks Canada's per-campsite Accommodation layer). Three
downstream implications for Segment B execution:

1. The BC Parks corpus is ~1,000 records (one per protected area), NOT
   the ~2,000–4,000 the Segment B spec estimated from a per-campsite
   assumption. Revise that estimate at execution time.
2. iOverlander carries BC campsite-level granularity. BC Parks (polygons
   + summary amenities) + iOverlander (campsite UGC) together reach
   Parks-Canada-equivalent coverage for BC.
3. BC Parks × Google federation is correct-by-design: BC Parks
   contributes polygon + park-level amenity summary while Google
   contributes commercial point data (reservation pages, visitor-centre
   addresses) — different aspects of the same physical park, federating
   via name_dominant (BC Parks does not participate in fed_exact).

Also: BC Parks is multi-endpoint (WFS boundaries + REST per-park
enrichment, joined on the ORCS code). Per the Parks Canada
within-source-disjointness note above, audit for within-source
near-duplicate pairs during the Mount Robson smoke (expected: none — the
two surfaces describe the same park, joined on ORCS, so they collapse to
one source_record rather than forming sibling records).

### Smoke teardown not enforced in the pipeline (convention only)

Surfaced during BC Parks (PR #63). Source-integration smoke tests write
to the test project; the convention (CLAUDE.md "Source integration
workflow") is to manually `DELETE FROM source_record WHERE source_id =
'<new_source>'` after smoke validation passes, so the D4 baseline stays
at its canonical 219 / 153 / 16 / 17 / 33. Without it, leftover smoke
records become extra solo master_places under full-corpus `matchAll` and
the D4 distribution drifts (BC Parks left 8 records → 227 / 161 until
cleaned).

Future improvement: add a `--cleanup-after` flag to the ingester that
auto-deletes by `source_id` + ingestion-run timestamp once smoke
validation completes. Removes the reliance on convention and makes
baseline drift impossible by construction. Low priority — the manual
DELETE convention is sufficient short-term.

### Parks Canada park-boundary records unlinked on production (surfaced by Phase 3b backfill, 2026-06-01)

5 Parks Canada park-boundary `source_record`s exist in production — Banff,
Yoho, Glacier, Kootenay, Jasper — each `is_active = true` with valid `Polygon`
GeoJSON in `normalized_payload.geometry_polygon`, but `master_place_id = NULL`
on all five. ER materialization never linked them, so no Parks Canada
`master_place` exists to carry their boundary, and the `geometry_polygon`
precedence rows added in PR #70 (parks_canada = 1) never fire for them.

Consequence: Parks Canada park polygons never promote to
`master_place.geometry_polygon`, so the 2,924+ Parks Canada campgrounds in
production receive **no** `contained_in` edges. The Phase 3b backfill produced
3,647 edges, all pointing at NPS parks; every Canadian park containment is
empty. This is an upstream ER/materialization gap, not a Phase 3b defect — the
containment function and backfill are correct for the data that exists.

Resolution path: investigate why `apply_match_outcomes` / recompute never
linked these `park_boundary` records (likely a category-mapping or
matching-rules issue specific to `park_boundary`); run materialization to
create their `master_place`s; re-run `backfill:polygon-containment`
(idempotent — safe to re-run, will light up Banff/Yoho/Glacier/Kootenay/Jasper
containment).

Priority: medium — production search is incomplete for Canadian parks but
functional.

### BC Parks and Alberta Parks integrations not yet executed against production (surfaced by Phase 3b backfill, 2026-06-01)

Phase 1.5 BC Parks (#63) and Alberta Parks (#66) integrations were
smoke-tested on the test project only, never executed against production —
zero `bc_parks` and zero `alberta_parks` `source_record`s exist in production.
Consequence: no BC/Alberta park containment in production federation.

Resolution path: run the established ingestion commands against production
(the integrations are validated test-side; swap to the prod env and execute),
then run materialization + `backfill:polygon-containment`.

Priority: medium — same shape as the Parks Canada item above.

### Materialization investigation needed for park_boundary source_records (BC + PC blocked on same gap) (2026-06-01)

> **RESOLVED via rung-2 empirical test (2026-06-02).** The investigation
> question — does the matcher have a structural gap that prevents
> `park_boundary` records from linking, or were these records simply never
> processed by materialize? — is answered: **no structural gap.** The 8 BC
> `park_boundary` records from the Mount Robson test bbox materialized cleanly
> via plain additive `materialize` on the test environment, each linking as
> `new_master_place` with promoted `MultiPolygon`. There is no category
> exclusion (none in `matcher.ts`); production's unlinked state is "**materialize
> was never run over these records**," not "materialize ran and failed" — the two
> were indistinguishable from the unlinked state alone (see original framing
> below); the empirical test distinguishes them.
>
> **Test design.** On the test project (`znldzjdatkogdktymtvi`): materialized the
> canonical JT corpus to a fully-linked baseline (D4 = 153/16/17/33, unchanged),
> real-ingested the 8 BC Mount Robson `park_boundary` records (bbox
> `[-119.5, 52.8, -118.5, 53.3]`), then ran **plain**
> `npm run -w data materialize -- --skip-sync` (NOT `--rematerialize`). This is
> the production analog: an already-materialized corpus plus
> newly-ingested-but-never-matched records, processed additively via
> `findTrulyUnresolvedIds` → `matchAll(delta)`.
>
> **Result.** `findTrulyUnresolvedIds` returned exactly the 8 BC records (the 33
> JT manual_review records were correctly excluded — they carry `place_match`
> rows). All **8/8 linked** as `new_master_place` (`match_method='deterministic'`,
> confirmed, confidence 1.0), each with `geometry_polygon` promoted to a
> `MultiPolygon` via the migration `20260601020000` precedence rows. 0 errors.
>
> **Bonus finding — containment runs inline; no backfill required for new
> ingestions.** Phase 3b containment runs *inside* `recompute_master_place`
> (locked decision #2), so the plain materialize ALSO created `contained_in`
> edges in the same pass — including a nested-park edge (`Mount Robson Park ⊃
> Mount Robson Corridor Protected Area`, child placed by representative point). A
> post-materialize `backfill:polygon-containment --dry-run` showed state already
> converged (a real run would be idempotent). `backfill:polygon-containment`
> remains useful for *retroactive* recomputation over existing data, but is NOT
> required for new ingestions — materialize alone suffices.
>
> **Resolution path (reframed by the blast-radius finding below).** The
> *mechanism* is unchanged — a plain `npm run -w data materialize` against
> production (standard env-swap; NOT `--rematerialize`, which would destructively
> rebuild the entire 15,645-row materialized prod corpus). But the **scope is far
> larger than the original 13-boundary framing**: the full truly-unresolved set
> is **3,086 records** (see "Blast radius finding" below) — effectively a
> first-time materialization of the entire Parks Canada ingestion plus the 8 BC
> boundaries. A live run would produce:
>   - ~3,086 ER outcomes (mix of `new_master_place` and possibly `auto_link` /
>     `amenity_rollup` / `manual_review` — distribution unknown until dry-run);
>   - recompute fan-out across every touched master_place — the documented
>     heavy-tail risk applies at this volume (budget wall-clock; the
>     `apply_match_outcomes` 300s override will matter);
>   - inline `contained_in` edges from the 5 PC + 8 BC boundary master_places to
>     the ~2,924 PC campgrounds (and any other amenities inside those polygons);
>   - federation with existing Google/OSM Banff-area records — untested at this
>     scale.
>
> **Prerequisite gate 1 — dry-run before live apply.** Run
> `npm run -w data materialize -- --dry-run --skip-sync` first to preview the
> new_master_place / auto_link / amenity_rollup / manual_review split at
> production scale and surface unexpected outcomes (e.g. duplicate-name
> campground federation) before any live apply.
>
> **Prerequisite gate 2 — code change required before production execution.**
> The additive (non-`--rematerialize`) path calls `matchAll(trulyUnresolvedIds)`,
> which filters with a single unbatched `.in("id", […])` (matcher.ts:1031). At
> ~3,086 UUIDs the URL exceeds PostgREST's length cap — the same 400 Bad Request
> documented for this path (materialize.ts:215-219), which is why
> `--rematerialize` passes no ids. Both the dry-run and the live apply route
> through this call. A small matcher change is required to batch the `.in()` (or
> chunk the delta into sub-1000-id incremental runs) before either dry-run or
> live apply is executable. Tracked separately — see "matchAll ID-list batching
> for large-delta materializations" item.
>
> **Caveats — what the test validated vs what production introduces.** The
> rung-2 test verified linkage + polygon promotion + inline containment for 8 BC
> records on a small JT-centric corpus. Production materialize introduces
> variables not covered by the test: PC `park_boundary` records specifically (not
> tested — only BC was in the test fixture), 12k+ corpus scale, and any other
> truly-unresolved records in production state. The validated mechanism is
> reasonable to expect to hold, but production execution is the first real-data
> test of those specific scenarios.
>
> **Blast radius finding (2026-06-02).** A read-only production probe of the full
> truly-unresolved set (`master_place_id IS NULL AND is_active AND NOT
> EXISTS(place_match)`, all sources) materially revises the scope. It is **not**
> the 13 records the original investigation implied.
>
> - **Total truly-unresolved: 3,086 records** — what a `materialize` would process.
> - **By source:** `parks_canada` = **3,078** (the entire PC ingestion);
>   `bc_parks` = **8**. No other source has any.
> - **By category:** 2,924 campground · 70 park_feature · 52 viewpoint · 24
>   national_historic_site · 13 park_boundary (8 BC + 5 PC) · 3 visitor_center.
> - **Sample-flagged concerns:**
>   - *Within-source duplicate names* — `Tunnel Mountain Village I` appears 3×
>     with distinct ids/ingest timestamps; ER federation behavior for these is
>     untested (cf. the BC Parks within-source near-duplicate audit note above).
>   - *Heterogeneous `park_feature`* — mixes real park amenities (`Banff
>     Gondola`, `Buffalo Nations Museum`) with adjacent commercial POIs (`IGA`,
>     `Nesters` grocery) that may federate with Google/OSM equivalents.
> - **Sanity:** production is *mostly* materialized — `place_match` total 15,645
>   vs `source_record` total 18,731 — but the Parks Canada ingestion (timestamped
>   2026-05-31, after the last materialize) is entirely unmaterialized. The 13
>   known boundaries are a small fraction of the backlog.
> - **Implication:** a production `materialize` is no longer a 13-record touch-up.
>   It is **first-time completion of the full Parks Canada ingestion (~3,078
>   records) plus the 8 BC boundaries** — see the reframed Resolution path above
>   for the consequent state changes and prerequisite gates.
>
> (Probe filtered `is_active = true` per the standard query; the materialize
> delta is `master_place_id IS NULL` regardless of `is_active`, so the true delta
> is ≥3,086 if any inactive unresolved records exist.)
>
> **Priority: execute validated fix — but scope is larger than first framed.**
> The *mechanism* is validated; the *volume* is not the ~10-min, 13-record
> touch-up originally estimated — it is a first-time full-PC materialization
> (~3,086 records) gated on the two prerequisites above. A deliberate,
> dry-run-first operation, not a quick fix.
>
> Original investigation framing retained below for the record.

BC Parks was executed against production this session (Mount Robson test
bbox `[-119.5, 52.8, -118.5, 53.3]`): **8** `source_record`s landed
(`source_id='bc_parks'`, `inferred_category='park_boundary'`) — Mount
Robson Park, Wells Gray Park, Mount Terry Fox Park, Rearguard Falls Park,
Small River Caves Park, Mount Robson Corridor Protected Area, Mount Robson
Protected Area, Jackman Flats Park. All ingested cleanly (0 errors, REST
enrichment fired, polygons in `normalized_payload.geometry_polygon`). All
8 are `is_active=true` with `master_place_id` **NULL** — unlinked.

This is the **same state** as PC's 5 `park_boundary` records (Banff, Yoho,
Glacier, Kootenay, Jasper), surfaced in PR #71's milestone 5D. Both sets
are inert and stable: not referenced by any production query, not in any
federation result, not in any `place_relationships` edge.

**Key mechanism finding (new this session): ingestion does NOT
materialize.** `upsert_source_record` has no inline ER trigger — the only
trigger on `source_record` is `set_updated_at` (timestamp). Linking
happens exclusively in a deliberate `npm run -w data materialize`
operation, which runs `matchAll` + `applyMatches` over the **entire**
corpus. No materialize has been run over the BC records since ingestion.

**This reframes the PR #71 5D conclusion as undersupported.** 5D claimed
"ER materialization didn't link PC." The evidence only supports "PC's
`park_boundary` records are unlinked." Whether that is because materialize
*ran and failed to link them*, or materialize *was never run* over those
records, is currently **undetermined** — and those two cases are
indistinguishable from the unlinked state alone. The same caveat applies
to BC: 8 unlinked records after ingestion-only is the *expected* state,
not yet evidence of a materialization failure.

Investigation questions — answer before any further production write work:

1. **What is `materialize` supposed to do, in detail?** Operations,
   idempotency properties, blast radius (bare vs `--rematerialize`).
2. **Current state of ALL unlinked `source_record`s on production** —
   count by `source_id` and category. Tells us the blast radius of a
   production materialize run.
3. **When did `materialize` last run against production?** Git history,
   operator notes, any audit log.
4. **Why are PC's 5 boundaries unlinked specifically?** Pre-materialize:
   do they pass `matchAll`'s filters? Is there a category-specific
   exclusion for `park_boundary`?
5. **What is the ER design intent for `park_boundary` records?** Are they
   meant to link via a different path than point-scoped records?
6. **What would running `materialize` change about ALL unlinked records**,
   not just BC/PC? (Whole-corpus `matchAll` blast radius.)

Priority (updated 2026-06-02): execute the validated fix — see the RESOLVED
note at the top of this item. Until run, still blocks Phase 1.5 source
integrations (PC, BC, Alberta) from reaching full federation value. Current
unlinked state:

- 8 BC `source_record`s in production unlinked (this session's ingestion)
- 5 PC `park_boundary` records in production unlinked
- Alberta integration not yet executed against production

The 8 BC records are stable and inert in their unlinked state. No urgent
action needed; the fix is the plain additive `materialize` validated above.

### matchAll ID-list batching for large-delta materializations (2026-06-02)

> **RESOLVED (2026-06-02) — PR #75** (branch `fix/matchall-id-list-batching`).
> The ID-list path now chunks its fetch via the exported
> `fetchUnresolvedByIds` helper (`ID_FETCH_CHUNK = 200` ids/request, well under
> PostgREST's URL-length cap). Because each chunk is an independent query, the
> concatenated rows are re-sorted in-app by
> `(source_quality_score DESC, external_id ASC)` using a code-unit string
> compare (not `localeCompare`) — reproducing the single-query `ORDER BY`
> exactly, so seed-source assignment and amenity-rollup distances stay
> byte-identical to the unbatched path. Scope was localized to the ID-list
> branch (Option A); the full-corpus (no-IDs) range-paginated path is untouched.
> Covered by 5 unit tests in `matcher.test.ts`: chunk boundary (450 → [200,200,50]),
> cross-chunk order reconstruction, small-list single call (the phase3a 2-id
> path), empty list (zero fetches), and per-chunk `master_place_id IS NULL`
> filter. The `materialize.ts` historical-400 note was updated to reflect the
> fix. Original framing retained below.

Discovered during the 2026-06-02 production blast-radius probe (PR #73). The
additive (incremental, non-`--rematerialize`) materialize path calls
`matchAll(trulyUnresolvedIds)`, which filters the corpus fetch with a **single
unbatched `.in("id", [...])`** at `matcher.ts:1031`. At ~3,086 UUIDs the request
URL exceeds PostgREST's length cap and returns **400 Bad Request** — the same
failure mode already documented for this path at `materialize.ts:215-219`
(which is why `--rematerialize` deliberately passes no ids and drives its own
server-side full-corpus query instead).

**Impact.** A production blocker for any `materialize` whose truly-unresolved
delta exceeds ~1000 records. Concretely it blocks the Parks Canada production
materialization (3,078 unresolved records; see the `park_boundary` materialization
item above) and would block any future large-delta additive operation. Both the
dry-run (`--dry-run`) and the live apply route through the same `matchAll(ids)`
call, so neither is executable at this scale until this lands.

**Resolution.** Batch the `.in("id", ...)` at `matcher.ts:1031` into chunks of N
ids (suggest <500–1000 per chunk) and concatenate the fetched rows before the
sort / cache-init / scoring steps, OR add a chunking wrapper in `materialize.ts`
that calls `matchAll` over sub-1000-id slices of the delta and merges the
outcomes. Prefer the former: `matchAll` calls `resetPlanning()` and builds its
in-memory planning/caches over the full `records` set per invocation
(`matchAll`/`initMatchAllCaches`), so a per-slice wrapper would fragment that
shared planning state across calls. Batching only the fetch keeps one coherent
matchAll invocation. Add a regression test for the >1000-id delta path.

**Priority: high but bounded.** Blocks PC materialization. Small, well-localized
code change (single fetch site) — not an architectural change.

### matchOne transient-error retry for long production passes (2026-06-02)

> **RESOLVED (2026-06-02) — PR #78** (branch `fix/matchone-transient-retry`).
> The `find_master_place_candidates` RPC (the only RPC in `matchOne`,
> reached via `findCandidates`) is now wrapped in `withRetry` (new in
> `ingestion/lib/retry.ts`, beside `defaultRetry`): 3 attempts, 2s per-attempt
> `AbortController` timeout via `.abortSignal()`, 4s total budget, full-jitter
> backoff, injectable sleep/rng/clock for deterministic tests. Transient errors
> retry; permanent errors fail fast; exhaustion throws `RetryExhaustedError`,
> which `matchAll` skips (today's semantics) plus diagnostics. Classification is
> string/code-based (`isTransient`) because postgrest-js 2.106.2 flattens errors
> to `{message, details, hint, code}` and strips `.cause.code` — a canary test
> table in `retry.test.ts` pins the exact shapes so a future upgrade fails
> loudly. **Plus a circuit breaker** (the key addition): per-record retry helps
> a transient blip but would turn a *sustained* outage into a ~3.4h grind that
> still skips everything; `matchAll` now aborts with `MatchAllCircuitBreakerError`
> after **K=15 consecutive** `RetryExhaustedError`s (reset on success), fixing
> the "exit 0 with partial coverage" misleading-green that masked the incident.
> Zero-partial-write is guaranteed: `matchAll` (read/compute) aborts strictly
> before `applyMatches` (write), which runs only after matchAll returns.

Discovered during the 2026-06-02 production dry-run (the gate-1 read-only ER
pass over the 3,086-record PC/BC truly-unresolved set). `matchOne`'s RPC calls
(`find_master_place_candidates` and friends) have **no transient-error retry** —
a single `fetch failed` rejects that record's `matchOne`, which `matchAll`
catches, logs, and skips, producing **no outcome** for it.

**Empirical.** ~36 seconds into a ~12-minute prod `matchAll` pass, a local DNS
blip (`getaddrinfo ENOTFOUND nqzeywzcowujzyegxbsr.supabase.co`) began and
persisted, causing **2,920 of 3,086 records to silently skip** (returned no
outcome). The run completed "successfully" (exit 0) with a distribution that
covered only ~3% of the corpus — a misleading green. DNS recovered on its own
(resolved fine immediately after); it was transient, not an outage.

**Risk for live apply.** The same blip during a live `materialize` apply would
silently skip records, leaving them unresolved. Not *corrupting* —
skipped records carry no `place_match` row, so a subsequent run re-processes
them (idempotent) — but **incomplete in a way that's easy to miss** (exit 0,
partial distribution). At 3,086 records over ~12 min, the exposure window is
real.

**Resolution direction.** A retry/backoff wrapper around `matchOne`'s RPC
calls that distinguishes **transient** errors (network/DNS, HTTP 5xx, timeouts —
retryable) from **logic** errors (bad input, 4xx, schema — not retryable), with
bounded exponential backoff. Mirror the existing retry shape in
`ingestion/lib/esri.ts`. Add a test asserting transient errors retry and logic
errors propagate immediately. Consider also a post-pass guard: if any
`matchOne` skipped due to error, surface a non-zero count loudly (so a partial
run can't masquerade as complete).

**Priority: high before the next live apply** (the PC production
materialization). Not blocking today's dry-run *analysis* — a clean re-run on a
stable connection suffices for the decision data. Scoped as its own PR + tests,
not bolted onto the dry-run session.

### Parks Canada Accommodation is per-campsite — campground rollup strategy needed (2026-06-02)

Discovered during the 2026-06-02 production dry-run (the read-only analysis
equivalent of `materialize --dry-run` over the 3,086-record PC/BC
truly-unresolved set). The PC Accommodation API returns **one record per
campsite** (one `source_record` per `OBJECTID`), **not per campground**.
Yesterday's PR #73 blast-radius probe undercounted from a 5-row sample:
**"Tunnel Mountain Village I" alone has 828 `source_record`s on production**, not
the 3 the sample suggested. The "~2,924 PC campgrounds" are really individual
campsites, hundreds sharing one campground name.

**Empirical materialize outcome distribution** (read-only dry-run; 3,086
records; matchAll wall-clock 657s; 0 errors):

| outcome | count | % |
|---|---:|---:|
| `new_master_place` | 270 | 8.7% |
| `auto_link` | 128 | 4.1% — all within-batch, **zero** federation with existing corpus |
| `manual_review` | 2,688 | 87.1% |

Of the 2,688 `manual_review`, **2,681 are PC campground (campsite) records.**
Every other category materializes cleanly: `park_boundary` 13/13 new,
`park_feature` 70/70 new, `viewpoint` 50/52 new, `national_historic_site`
19/24 new, `visitor_center` 3/3 new, and all 8 `bc_parks` new. The pathology is
isolated to the PC campsite category.

**Root cause.** The matcher correctly refuses to blind-merge same-source,
same-name records 290–460 m apart: the `name_dominant` same-source guard fires
(all `parks_canada`), so they fall to blended scoring → conf **0.600** →
`manual_review` (`blended_residual`). Behaviour is *correct*; there's just no
campsite→campground rollup path, so per-campsite duplicates flood manual review.
Note: because `manual_review` records don't link (no `master_place`), a live
apply would create ~270 master_places + queue 2,688 pending, NOT ~2,924
campground master_places — and the per-campground containment-edge expectation
shrinks accordingly (only the linked seeds get edges).

**Resolution direction (OPEN design question — NOT a decision):**

- **Option A — rollup at ingestion.** Parse the `URL_f` field (campground-site
  code, e.g. `BAN-TMV1-D19` = campground `BAN-TMV1` + site `D19`; see the
  `URL_f` mislabeling note above) to group campsites under a parent campground
  at ingest time. Affects the `parks_canada` source integration only.
- **Option B — campsite→campground rollup path in ER.** A new matcher rule that
  recognizes per-campsite same-source clusters and rolls them up to a
  synthesized campground `master_place`. Affects the matcher (critical path).
- **Option C — materialize only non-campground PC categories.** A scoped
  materialize over boundaries, features, viewpoints, NHS, and visitor_centers;
  defers the campsite problem indefinitely.

Each option has different scope and downstream implications (ingestion vs
matcher vs operational). Worth a design session, not a quick patch.

**Priority: high** (blocks PC federation completion) but unblocked enough to
design deliberately. The 8 BC boundaries + 13 PC/BC boundaries + PC
non-campground categories are *not* blocked by this — they materialize cleanly
today; only the campsite category needs the rollup decision.

---

Bundling note: the "migration-verify and source-integration workflow
hardening" PR cluster shipped four of these items — the two `db:push-verify`
items (cwd + `--test`), the `ingest:manual` env-file item, and 4a of the
`field_precedence resolution determinism` item (all closed/updated above).
The `geometry_polygon promotion` item shipped separately in migration
`20260601020000` and has been removed from the open items above.


### PAD-US Wilderness is a HARD pre-prod gate — Fee-first ships without it (2026-06-02)

The `padus` land-status source (Phase 1) ingests the PAD-US **Fee Managers**
layer only. The Fee class EXCLUDES Wilderness (`des_tp='WA'` lives in PAD-US's
separate Designation feature class, whose endpoint was not resolvable during the
Phase 1 build). Consequence under Fee-first: a point inside a Wilderness inherits
the enclosing forest's `dispersed_camping='likely_allowed'` — a wrong "camp here",
the one safety-critical failure mode. Harmless on test (Fee validates
tuple/dissolve/category-split/containment/dispersed for everything but
Wilderness). **Must NOT ship to prod without both:**

1. Wiring the PAD-US Designation endpoint (find via the USGS PAD-US web-services
   page item / the test project's PAD-US web map).
2. Proving a `WA` record carries `likely_restricted` AND **overrides** the
   enclosing forest's `likely_allowed` at containment-resolution time
   (restricted-beats-allowed when a point is `contained_in` multiple land-status
   polygons — a new multi-parent resolution rule).

`deriveDispersedCamping` in `padus.ts` already returns `likely_restricted` for
`des_tp='WA'`; the missing pieces are the Designation endpoint + the multi-parent
resolution rule. Wilderness records are additive (own tuples), no rework.

### PAD-US dispersed_camping calibration + des_tp fail-to-hidden (Phase 1 test, 2026-06-02)

From the JT-corridor test (113 padus units): BLM→`likely_allowed` is correct (3/3 BLM|PUB), but two gaps to fix before prod:
1. **`NGO` (private conservation) and `DIST` (special-district local parks) leak to `unknown`** — should be `likely_restricted` (the const map only catches `Mang_Type` LOC/PVT). ~28 of 42 "unknown" were really restricted. Add NGO→restricted, DIST(local)→restricted.
2. **des_tp is fail-to-hidden:** any `des_tp` not in `NAMED_DES_TP` silently becomes `land_status` and drops from search (e.g. a National Monument vanished). Route **unrecognized** des_tp to a review/log path instead of silent exclusion. Pull DISTINCT des_tp for the corridor AND nationally and classify each explicitly before prod. (Corridor distinct set observed: LP, LREC, PCON, LOTH, POTH, SOTH, TRIBL, SCA, PUB, SRMA, LCA, NP, UNK, NWR — only NP/NWR named.)
3. Validate the `likely_allowed` slice on a genuinely BLM-dense bbox (the JT bbox is NP/local-dominated; Gate A showed 172 BLM + 62 USFS in the lower corridor → all `likely_allowed`).

### PAD-US containment product-direction not yet exercised (Phase 1 test, 2026-06-02)

The product use is point→land-status (a campsite resolving what land it sits on). In the JT test, 20 containment edges formed but only **2 were baseline-POI ⊂ PAD-US**; 18 were PAD-US ⊂ PAD-US. Cause: JTNP (the natural container for the 153 JT points) is stuck in `manual_review`, so its polygon never materialized over them. Before declaring the containment model product-ready: resolve the JTNP federation, or test a BLM-dense bbox that covers existing POIs.

### National-fill prerequisite: federated-park auto-resolution (2026-06-02)

The lone JTNP `manual_review` in the corridor test is the tip of an iceberg: every park present in BOTH PAD-US and an authoritative source (NPS/Parks Canada) queues one `manual_review`, so a national fill floods with federated-park duplicates. Before national fill, add an auto-resolution rule — generalize `findFederalAnchor`/`fed_exact` to link PAD-US `public_land` ↔ the existing authoritative park master_place (the geometry/name come from the authoritative source via field_precedence; PAD-US enriches land-status). National-fill prerequisite, not a corridor blocker.

### REQUIRED before national fill: empirically fire the 0.1 dispersed↔campground lock (2026-06-03)

The `dispersed_camping ↔ campground / recreation_area = 0.1` compat lock (PR-0.1)
is **math-proven** safe — max blended at 0m + identical (suffix-stripped) name is
`0.4 + 0.4 + 0.2·0.1 = 0.82 < 0.85`, so it can never auto-merge — and there is no
alternate merge path (amenity rollup excludes dispersed; `AMENITY_PARENT_CATEGORIES`
doesn't include it). But it has **not yet fired on real data**: PR-A's isolated
dispersed-only test has no co-located developed-campground source (RIDB/OSM
campgrounds and USFS dispersed don't coincide in the test corpus), and the
USFS↔OSM canonical_name eyeball needs OSM dispersed (PR-B). Both deferred to a
**combined A+B(+RIDB) corridor check**. **Before national fill, confirm empirically**
that a real dispersed site at ~0m + same name as a developed campground lands in
`manual_review` (not auto-merge, not silently swallowed) — math-only is not
sufficient sign-off for the safety-critical err-toward-separate decision.
