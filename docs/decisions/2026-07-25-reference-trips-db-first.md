# 2026-07-25 — Reference trips serve DB-first

[PR #143](https://github.com/honkinsickle/overlander/pull/143). Resolves the
contradiction where the docs said reference trips serve DB-first but `getTrip`
was fixture-first.

## Context

`web/src/lib/trips/fixtures.ts` held reference trips as in-code literals, and
`getTrip` checked that in-memory `TRIPS` map **before** the DB — so for the two
fixture slugs the literal *shadowed* `reference_trips`. `la-to-deadhorse` existed
in both (forcing the `ensureAlaskaUpgraded` merge dance); `la-to-portland` lived
*only* in the fixture (unforkable, never in the DB).

Investigation surfaced that `TRIPS` has a **second, live role**: the anon-wizard
trip store (`createTrip` at `plan/actions.ts:786`, `listAnonTrips`, the
repository slug-write paths), gated by `ENABLE_PLANNER_WIZARD`. So "delete the
fixture module" is not equivalent to "remove the reference shadow."

## Decision

1. **Flip `getTrip` to DB-first, reader-aware.** `la-to-deadhorse` →
   `getReferenceTrip` (keeps committed-snapshot fallback + per-process memo, so
   the live PROD trip does not regress); every other reference slug →
   `getPersistedReferenceTrip`; anon `trip-*` ids resolve last so a DB reference
   row always wins but an in-progress anon draft still renders. Both readers
   apply the identical `withCorridors(fold(...))` pipeline — the reader split
   adds **zero derivation divergence**.
2. **Migrate `la-to-portland` into `reference_trips`** as a raw, pre-derivation
   payload (no corridor bake — derivation stays at read), via an idempotent
   seed script, on TEST and PROD.
3. **Defer fixture deletion.** Because `TRIPS` is also the anon-wizard store,
   the literals stay in the module for now; finishing the removal (empty the
   reference seed, reroute `ensureAlaskaUpgraded`'s 4 waypoint-helper callers to
   the DB reader, drop `la-to-portland` from `FIXTURE_TRIPS`) is backlogged,
   gated on whether those 4 helpers back any write (a DB reader returns a fresh
   object, so rerouting a write path silently no-ops).

## Consequences

- **Proven behavior-neutral for la-to-deadhorse** (`scripts/prove-la-to-deadhorse-neutral.ts`):
  the DB payload is baked and carries every `LA_TO_DEADHORSE_RAW` day override
  (heroImage/label), 0 mismatches on TEST and PROD.
- **PROD write evidence:** `reference_trips` 2 → 3 rows (one added);
  `dawson-vancouver-cassiar` payload sha256 `46a17cbb421208f7` byte-unchanged
  before/after (frozen trip untouched).
- **Accepted trade-offs:** the federated fold now runs for `la-to-portland` at
  serve (positive convergence — it behaves like a real reference trip; on TEST
  it adds 0 tiles because the corpus footprint doesn't overlap the route);
  after the eventual fixture deletion the demo slug **404s on DB failure** (no
  snapshot fallback), accepted for a demo trip.
- **Correction recorded:** `la-to-portland` was never in the anon `/trips` list
  (`listAnonTrips` filters `id.startsWith("trip-")`), so the flip changes nothing
  there — contrary to an earlier assumption.
- **Residual:** `la-to-portland` is now forkable and a fork snapshots the
  degraded no-`routePolyline` shape — backlogged, not fixed here.
