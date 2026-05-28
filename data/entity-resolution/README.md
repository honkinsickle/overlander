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
