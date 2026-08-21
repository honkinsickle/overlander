# ADR — recreation_area ↔ public_land / land_status category compatibility

**Date:** 2026-08-20
**Status:** Applied (TEST + PROD)
**Context:** State parks source onboarding

## Decision

Added two entries to `CATEGORY_COMPATIBILITY` in `data/entity-resolution/matcher.ts`:

```
recreation_area ↔ public_land = 0.7
recreation_area ↔ land_status = 0.5
```

## Rationale

State parks source_records use `inferred_category = recreation_area`. PAD-US
source_records for the same physical parks use `public_land` (for named park
units, designation SP/SREC) or `land_status` (for generic ownership parcels,
search-excluded). Without this entry, `lookupCompatibility("recreation_area",
"public_land")` returned 0.0, and the blended confidence formula
(`0.4*dist + 0.4*name + 0.2*cat`) capped at 0.80 — below the 0.85 auto-link
threshold. This sent 608 same-name, sub-50m-distance, genuinely-same-place
matches to manual_review.

These are NOT false positives: PAD-US's "State Park" (SP) designation and
state_parks' "recreation_area" category describe the same physical park from
two different inventory systems. The PAD-US designation codes on the matched
records (SP=253, SREC=186, SHCA=57, SCA=36) confirm they are the same entity
type.

## Score precedent

- `public_land = 0.7` follows `recreation_area ↔ campground = 0.7` — genuinely
  the same place but different category vocabularies.
- `land_status = 0.5` follows `recreation_area ↔ park_feature = 0.5` — weaker
  match because `land_status` is the generic/search-excluded PAD-US category.

## Blast radius

- **State_parks:** 608 records directly affected (auto-confirmed instead of
  queued for manual review).
- **RIDB:** 56 unlinked recreation_area records potentially affected.
- **OSM/USFS/NPS:** Zero recreation_area source_records — not affected.

Verified on TEST: 484 records auto-confirmed after the change. All 10
spot-checked matches were genuine same-place merges (distance ≤8m, name_sim
≥0.94).

## Reversibility

Remove the two entries from `CATEGORY_COMPATIBILITY`. Records already confirmed
would need manual review to undo (place_match status = confirmed,
master_place_id set). No migration involved — this is a code-only change in
matcher.ts.
