# 2026-07-23 — Pinned ER fixture (hand-built, not prod-derived)

## Context

The entity-resolution D4 suite (`data/entity-resolution/phase3a.test.ts`) runs
the real matcher over a corpus seeded into a disposable test project by
`data/scripts/seed-test-fixtures.ts`. That seed **copied every prod
`source_record`** into the test project.

It was written when prod held ~**219** rows. By 2026-07 prod holds **20,384**
(the full LA→Deadhorse corridor). The seed silently tracked that growth, and
nothing pinned it. Consequences, all real:

- **The D4 baseline drifted.** The suite's ground truth was the JT distribution
  (219 → 153 `new_master_place` / 16 `auto_link` / 17 `amenity_rollup` / 33
  `manual_review`). Over a 20k corpus the per-fixture uniqueness assertions
  (`toHaveLength(1)` for "Ryan Campground") stop holding — the corridor contains
  ambiguous name-matches and many more amenities — and the amenity "closest one"
  heuristics break.
- **The run got slow and unreasonable.** `matchAll` over 20k records is minutes,
  pushing the vitest `hookTimeout`.
- **It couples a correctness test to a moving production dataset.** A test that
  changes meaning every time prod ingests is not a test.

A disposable ER test project (Phase 2.5 Part B Option 1) is the eventual home for
these suites; it should be seeded with a **known, versioned** corpus, not a
snapshot of whatever prod happens to be.

## Decision

Seed the ER test project from a **pinned, hand-built fixture**:
`data/entity-resolution/fixtures/er-corpus.ts` — ~17 typed records, one per
match path, loaded through `upsertSourceRecord`. `seed-test-fixtures.ts` no
longer reads prod at all (it doesn't even build a prod client; it writes only to
`SUPABASE_TEST_*` and refuses if that ref equals the working ref).

Assertions are **per-case outcomes, not counts** ("these two records resolved to
one master_place with sources {…}", "this restaurant stayed solo"), so they
survive any fixture edit that preserves the shapes and depend on no corpus size.
The one count is `source_record === ER_CORPUS.length`, a seed-loaded-fully sanity
check. The two float-window fallback paths (`deterministic`, `blended_residual`)
moved to `scoreMatch` unit tests in `matcher.test.ts` rather than geo-tuned
corpus records — `scoreMatch` previously had **no** unit test and was exercised
only through the corpus run.

The fixture's name-similarity / category-compatibility / blended-confidence
values were verified by pure computation against the matcher's own
`scoreMatch` / `normalizeName` / `lookupCompatibility` while authoring it. The
end-to-end corpus run itself is **UNVERIFIED** until the disposable ER project
exists — `test:er` is inert while `SUPABASE_TEST_URL` and `SUPABASE_URL` share a
ref (preflight aborts), which is the case today.

## Consequences

**This is a trade, not an oversight.** A ~17-row hand-built fixture cannot
reproduce what a 219-row (let alone 20k) prod-derived one did. What is lost:

1. **Emergent / combinatorial behavior** — the matcher against many overlapping
   candidates: the top-10 candidate cap, distance-tie ordering, the same-source
   guard against *multiple* chain neighbors, the tier/`fedRank` sort over a
   crowded input. A fixture tests the paths you knew to encode; it can't surface
   an interaction between records you didn't think to place adjacent.
2. **Real coordinate-drift distributions** — the 8m–347m cross-source drift
   modes that *motivated* the 500m radius and 100m distance clip came from real
   data. Hand-built points bake in the conclusions instead of re-deriving them; a
   threshold regression can pass because the points sit comfortably inside it.
3. **Real name-normalization edge cases** — actual source names carry
   punctuation, casing, and suffix stacks the normalizer was tuned against. Clean
   fixture names won't catch a normalizer regression on messy input.
4. **The scale / perf surface** — N+1 regressions, the PostgREST 1000-row
   pagination cap, runtime blowups. ~17 records will never catch a reintroduced
   N+1. (Partly mitigated: `matcher.test.ts` unit-tests pagination and chunking
   directly.)
5. **"Unknown unknowns"** — the prod-derived fixture occasionally caught a record
   shape nobody would design. That value is gone by definition.
6. **The populated-`master_place` candidate RPC** — `find_master_place_candidates`
   is not exercised end-to-end by the corpus run (the D4 `beforeAll` resets
   `master_place` empty → `matchAll` runs in `skipRpcs` rematerialize mode). This
   is **pre-existing** — it was already true of the prod-derived run and is not
   caused by this change — so it lives in `docs/BACKLOG.md`, not here.

**Why the trade is acceptable — the two-net model.** The pinned fixture is the
**fast, deterministic correctness gate**: it runs in seconds, means the same
thing every time, and locks every match path a reader can enumerate. The
**emergent-behavior net** is an *occasional, manual, prod-scale ER run* —
decoupled from CI, following the CLAUDE.md "snapshot-before, restore-to-snapshot"
discipline — run when the matcher or its constants change materially. Losing
items 1–5 from the *unit* suite is acceptable precisely because that second net
still exists out-of-band; what would not be acceptable is having neither.

If you found this fixture small and are about to conclude it's inadequate: it is
deliberately small. The size is the point. Add the prod-scale run back as the
net; do not re-couple the unit gate to prod.
