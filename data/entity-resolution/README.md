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
