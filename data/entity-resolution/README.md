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
