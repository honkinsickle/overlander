# Camping category narrowing: exclude facility, move recreation_area to scenic

Date: 2026-08-23

## Context

The "Camping" UI bucket (`SLIDE_TO_PRIMARY_CATEGORY.camping` in `federated.ts`)
included six `primary_category` values: `dispersed_camping`, `campground`,
`recreation_area`, `facility`, `rv_park`, `camping_cabin`. Two of these are
problematic:

**`facility`** is RIDB's residual bucket. RIDB assigns `FacilityTypeDescription =
"Facility"` to everything that is not a designated campground — trailheads, picnic
areas, visitor centers, ranger stations, boat launches, shooting ranges, day-use
areas, OHV sites, interpretive sites, and more. Investigation `[queried TEST
2026-08-23]` found that only a small fraction of `facility`-tagged `master_place`
rows have camping-like names (RIDB miscategorizations where the real type is
campground but RIDB's own metadata says "Facility"). Including the full set in a
"Camping" filter pulls overwhelmingly non-camping places into camping results.

**`recreation_area`** contains national parks, wildlife refuges, wilderness areas,
BLM backcountry byways, national monuments, and state recreation areas. These are
large public land areas — semantically identical to what the `scenic` bucket
already holds (`national_park`, `state_park`, `natural_feature`, `park_feature`).

## Decision

1. **Camping = `campground`, `dispersed_camping`, `rv_park`, `camping_cabin`
   only.** These four are unambiguously camping places.

2. **`recreation_area` moves to `scenic`.** It joins its semantic peers there.

3. **`facility` moves to `interest`** (the residual/uncategorized bucket). It was
   already a residual category at the data layer; placing it in the residual UI
   bucket is honest. The small number of miscategorized real campgrounds in the
   `facility` population are a data-correction task (fixing their
   `inferred_category` upstream in the ingester), not a category-mapping task.

4. **No Find Nearby tile** is created for `recreation_area` in scenic — it
   doesn't need a dedicated tile to be reachable via the scenic chip.

## Consequences

- The Camping filter/chip now returns only actual campgrounds and dispersed
  camping sites. Users searching for camping will not see trailheads, visitor
  centers, or shooting ranges.
- `facility`-tagged places still appear in browse/search under the `interest`
  catch-all, not hidden — just not falsely labeled as camping.
- `recreation_area` places appear under the Scenic filter, alongside national
  parks and other large public land areas they're semantically identical to.
- The ~101 RIDB-miscategorized campgrounds tagged `facility` will not appear
  under Camping until their `inferred_category` is corrected at the data layer
  (a separate, smaller task).
- `rv_park` and `camping_cabin` remain in the Camping bucket despite currently
  having 0 corpus rows — forward-compatible, adds nothing, costs nothing.
