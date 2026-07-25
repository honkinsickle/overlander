# Trip resolution — how `getTrip` serves a trip

**Point-in-time: 2026-07-25.** Written at the end of the reference-trips DB-first
migration ([PR #143](https://github.com/honkinsickle/overlander/pull/143), OPEN
at time of writing — the flip is on the branch, not yet merged; the residual
fixture removal is backlogged). Re-verify against source before trusting a claim
that has aged.

## Why this doc states its evidence

This migration existed *because* a doc asserted "reference trips serve DB-first"
while `getTrip` was fixture-first — a confident doc recreated a false belief. So
**every claim below states how it was verified this session**: `[read]` source,
`[grep]`, `[queried TEST]` / `[queried PROD]` (anon or service key), or
`[script]` (a committed, re-runnable check). Claims **not** verified this session
are omitted or marked `[UNVERIFIED]`. Do not fill gaps here with plausible
narrative — add a claim only with its evidence.

## Resolution order (`getTrip`, `web/src/lib/trips/repository.ts`)

Post-flip order `[read source: the flip edit this session]`:

1. **UUID id** (`isUserTripId`, UUID regex) → `getUserTrip` (DB, RLS). `[read: is-user-trip.ts]`
2. **`la-to-deadhorse`** → `getReferenceTrip`.
3. **Any other reference slug** (incl. `la-to-portland`) → `getPersistedReferenceTrip`; returns `null` on miss → 404.
4. **Anon `trip-<8char>`** → the in-memory `TRIPS` store, resolved **last**, so a DB reference row always wins but an in-progress anon draft still renders.

## The two reference readers, and why they are split (`web/src/lib/trips/reference.ts`)

`[read source]`:

- **`getReferenceTrip(id)`** — DB-first with a **committed-snapshot fallback**
  (`.alaska-snapshot.json`) and a **per-process module memo** (`cachedReferenceTrip`).
- **`getPersistedReferenceTrip(id)`** — plain `reference_trips` read; **`null` on
  miss**, **no snapshot fallback, no memo**.

**Why the split (not collapsed into the plain reader):** `la-to-deadhorse` is the
live PROD reference trip. Routing it through `getPersistedReferenceTrip` would
drop the snapshot fallback (404 on any DB blip) and the memo (a fresh DB read +
derivation every request) — a regression. The reader-aware split preserves both
for `la-to-deadhorse` only. `[read source]` Both readers apply the **identical**
`withCorridors(await withFederatedCorridorSupply(fromDb))` pipeline `[read: reference.ts]`,
so the split changes **fallback/memo, not derivation** — zero derivation divergence.

## `TRIPS`' current role (`web/src/lib/trips/fixtures.ts`)

After the flip, the `TRIPS` module is **the anon-wizard trip store**, not a
reference source:

- `createTrip` (`repository.ts`) writes `trip-<8char>` drafts into it — called by
  the anonymous wizard finalize (`plan/actions.ts`, the "insert into the fixtures
  map" path). `[read source]`
- Gated by `ENABLE_PLANNER_WIZARD` (`=true` on TEST). `[grep .env.development.local]`
- `globalThis`-pinned and **ephemeral** — lost on server restart, never persisted
  to Supabase. `[read: fixtures.ts store setup]`
- `listAnonTrips` lists them, filtering `id.startsWith("trip-")`. `[read: list-user-trips.ts]`
- The repository slug-write paths (`removeWaypoint`, etc.) splice `TRIPS[tripId]`. `[read source]`

**Residual fixture read path:** `ensureAlaskaUpgraded` still has **4 waypoint-helper
callers** in `repository.ts` (around `:94,108,120,181`) that read
`TRIPS["la-to-deadhorse"]` — the last place a reference trip is read from the
fixture. `[grep]` Removing it is backlogged (gated on whether those helpers back
any write). The reference **literals also still sit in `TRIPS`** but no longer
shadow the DB (the flip resolves them via DB first).

## `reference_trips` — access and contents

- **RLS:** `create policy "reference_trips_public_read" on public.reference_trips
  for select using (true)` — no role restriction. `[read: supabase/migrations/20260513000000_init_identity.sql:50-52]`
- **Anon read works** — confirmed empirically with the anon key (no session, RLS-subject):
  - TEST: 7 rows returned. `[queried TEST, anon key]`
  - PROD: read succeeded. `[queried PROD, anon key]`
- **Rows present (point-in-time):**
  - TEST: `alaska-south-final`, `alaska-south-regen`, `dawson-cassiar-livingplan-test`,
    `expedition-mri4puxo`, `expedition-mri5tv6g`, `la-to-deadhorse`, `yotrippin-demo`,
    plus `la-to-portland` (added this session). `[queried TEST]`
  - PROD: `dawson-vancouver-cassiar`, `la-to-deadhorse`, plus `la-to-portland`
    (added this session; 2 → 3 rows, one added). `[queried PROD; script hash-reference-trips.ts before/after]`

## Fork path (`web/src/app/api/trips/fork/route.ts`)

`[read source]`:

- Reads `reference_trips` **directly** (`.select("title, payload").eq("id", …)`),
  **not** through `getTrip`. So changing `getTrip`'s source does not affect forking.
- Copies the (baked-if-needed) `payload` into a new `public.trips` row — **forks
  are snapshots**; existing forks are independent of the reference source.
- **`la-to-portland` is now forkable** (the row exists) and, because it has **no
  `routePolyline`**, the route's `bakeCorridors` is a no-op — a fork **snapshots
  the degraded (no-`corridorCities`) shape**. Backlogged, not fixed here. `[read: fork route + fixtures grep]`

## Read-time derivation

Applied by both readers before returning:

- **`withCorridors` → `resolveCorridorCities`**: `if (!trip.routePolyline) return
  trip` — an **exact no-op without a `routePolyline`**. `[read: resolve-corridor-cities.ts:68]`
- **`withFederatedCorridorSupply` → `foldFederatedCorridorSupply`**: folds corpus
  POIs into `segmentSuggestions`, working off **`day.coords`** (not `routePolyline`);
  gated on `USE_FEDERATED_CORRIDOR=true`; **skipped when the payload already has
  baked corpus tiles** (`hasBakedCorpusTiles`). `[read: bake-corridors.ts]`
- For `la-to-portland` on TEST the fold **runs but adds 0 tiles** — the TEST corpus
  footprint (LA→Deadhorse corridor) doesn't overlap the LA→Portland route. `[script: one-off fold count, USE_FEDERATED_CORRIDOR=true]`

## Baked vs unbaked payloads (what it determines at serve)

A **baked** payload carries `corridorCities` (and possibly folded corpus tiles),
so `withCorridors` and the fold **short-circuit** → served == payload verbatim.
An **unbaked** payload gets live derivation at serve. `[read: reference.ts / bake-corridors.ts]`

Verified instances `[script: prove-la-to-deadhorse-neutral.ts]`:

- `la-to-deadhorse` — **baked** (66 days, `corridorCities` present) on TEST and
  PROD. PROD payload also has **baked corpus tiles** (fold skips at serve); TEST
  payload does **not** (fold runs at serve). Every `LA_TO_DEADHORSE_RAW` day
  override (heroImage/label) is present in the DB payload, 0 mismatches — the
  basis for the "deleting the fixture is behavior-neutral" proof.
- `la-to-portland` — **unbaked** (no `corridorCities`, no `routePolyline`). `[grep fixtures.ts + script]`

## The three trip shapes

- **Fixture-degraded** — no `corridorCities`, no `segmentSuggestions`; renders the
  two-node fallback. Exercised by **`la-to-portland`**. `[grep fixtures.ts: corridorCities count 0]`
- **Reference-derived (baked)** — a persisted reference payload carrying
  `corridorCities`. Exercised by the **`la-to-deadhorse` family**. `[script: prove-la-to-deadhorse-neutral.ts]`
- **Regenerated** — `segmentSuggestions` up to `MAX_SEGMENT_SUGGESTIONS = 30`
  per day. `[grep: web/src/lib/routing/day-suggestions.ts]` **Which specific test
  trip exercises the 30-cap rung was NOT confirmed this session** `[UNVERIFIED]` —
  a regenerated trip was never inspected.

## Caching on the trip path

`[grep + read + build output]`:

- No `dynamic` / `revalidate` / `fetchCache` / `force-static` on the trip pages. `[grep the 3 page files]`
- Pages are **dynamic** regardless, because they call `supabase.auth.getUser()`
  (cookies) — `next build` reports `ƒ /trip/[id]`. `[read page files + build output]`
- The only app-level memo is `cachedReferenceTrip`, and it applies **only to
  `getReferenceTrip`** (not `getPersistedReferenceTrip`), per-process, cold on
  deploy. `[read: reference.ts]`
- The only `no-cache` header is on `/sw.js`. `[read: next.config]`
- **Consequence:** no static/ISR/CDN layer serves stale fixture output — **no
  stale cache outlives a deploy** on this path.

## Browse coupling (`web/src/app/api/trip-browse/[tripId]/[dayId]/route.ts`)

`FIXTURE_TRIPS` is a **string set** (`new Set(["la-to-portland"])`) plus the
`BROWSE_PLACES` catalog — **independent of the `TRIPS` object**. Deleting the
fixture module would not break it; whether `la-to-portland` keeps its curated
browse or goes live/federated is a separate decision. `[read source]`

## Anon list

`listAnonTrips` filters `id.startsWith("trip-")`, so **reference slugs were never
in the anon `/trips` list** — the flip changes nothing there. `[read: list-user-trips.ts]`

## Not covered (not verified this session — do not infer)

Explicitly out of scope for this doc; **not investigated this session**, so no
claims are made about: the wizard internals, corpus / federated-supply internals
(`foldFederatedCorridorSupply`'s query + ranking), corridor-derivation internals
(`resolveCorridorCities`'s node selection), and the scroll / rendering layer.

## How to verify these claims (re-runnable, not one-offs)

The scripts committed with #143 are the checks — re-run them rather than trust
this doc:

- `web/scripts/prove-la-to-deadhorse-neutral.ts` — asserts the DB payload is
  baked and carries every day override. Run with `--env-file=.env.development.local`
  (TEST) or the PROD env.
- `web/scripts/hash-reference-trips.ts` — per-row payload sha256; run before/after
  a write to prove exactly which rows changed (and that frozen trips are unchanged).
- `web/scripts/seed-reference-la-to-portland.ts` — `--verify` deep-equals the
  stored payload against the fixture literal; `--revert` deletes the row.

For RLS/read: `createClient(url, ANON_KEY)` with no session, `.from("reference_trips").select("id")`.
