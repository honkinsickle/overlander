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

### geometry_polygon promotion for provincial/federal boundaries (shared PC + BC Parks follow-up)

Surfaced during BC Parks integration (2026-05-31). Neither the Parks
Canada nor the BC Parks field_precedence migration seeds a
`geometry_polygon` row — only `nps` is in that precedence row (base seed:
"geometry_polygon: NPS only. No fallback."). Both sources normalize a
boundary polygon into `normalized_payload.geometry_polygon` expecting
week-3 `recompute_master_place` to promote it, but `resolve_field()`
resolves `geometry_polygon` solely from `nps`, so **Parks Canada and BC
Parks boundary polygons never reach `master_place.geometry_polygon`.**

Consequence: the polygon-containment ER path (OSM park-node →
auto-link-by-containment; see "OSM park-as-node is at polygon centroid"
above) can't fire for Canadian parks, because the containing polygon was
never promoted. Federal/provincial parks fall back to distance-only
candidate retrieval, which the OSM-park-node finding shows is wrong for
park-category records.

Fix shape (one small migration, both sources together): add
`('geometry_polygon', 'parks_canada', <n>)` and
`('geometry_polygon', 'bc_parks', <n>)` at next-unused priority (nps=1,
so 2 and 3 — order is moot, the geometries are geographically disjoint).
Bundle with — or sequence ahead of — the polygon-containment ER work so
the promoted polygons have a consumer. Not BC-Parks-PR scope; filed so it
isn't lost when the containment path is built.

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

---

Bundling note: the "migration-verify and source-integration workflow
hardening" PR cluster shipped four of these items — the two `db:push-verify`
items (cwd + `--test`), the `ingest:manual` env-file item, and 4a of the
`field_precedence resolution determinism` item (all closed/updated above).
The `geometry_polygon promotion` item remains open for a future cluster.

