# entity-resolution/

Week 3 work. Stubbed for now.

Will contain:
- `matcher.ts` — deterministic candidate scoring (Jaro-Winkler name + distance + category compat)
- `promote.ts` — `place_match` → `master_place` linkage
- `audit-cli.ts` — manual review CLI (`pending`, `show`, `confirm`, `reject`, `merge`, `coverage`)
- `tests/fixtures/` — known good/bad match pairs

See `phase-1-build-spec.md` section 9.
