# Trip resolution — how `getTrip` serves a trip

**Point-in-time: 2026-07-25.** Written at the end of the reference-trips DB-first
migration ([PR #143](https://github.com/honkinsickle/overlander/pull/143),
MERGED — the flip is on `main`; the residual fixture removal is backlogged).
Re-verify against source before trusting a claim that has aged.

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
fixture. `[grep]` The reference **literals also still sit in `TRIPS`** but no
longer shadow the DB (the flip resolves them via DB first). Removing both is
tracked by [`docs/BACKLOG.md`](../BACKLOG.md) → "Finish reference-fixture removal"
(gated on whether those 4 helpers back any write); **that work must update this
section** when it lands.

## `reference_trips` — access and contents

The RLS policy (`for select using (true)`, anon-readable) and the per-DB row
inventory (which slugs exist in TEST vs PROD) live in
[`docs/DATA_INVENTORY.md`](../DATA_INVENTORY.md) § `reference_trips` — that is
"what data lives in which database," and it changes independently of this code.

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

The three payload shapes (fixture-degraded · reference-derived · regenerated),
including which test trip exercises each and the `[UNVERIFIED]` 30-cap rung, are
documented once in [`docs/architecture/itinerary-model.md`](itinerary-model.md) §7
— the scroll/windowing layer is where that distinction bites, so it lives with
the model. This doc's **baked-vs-unbaked** section above covers what those shapes
mean at *serve* time.

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

For RLS/read: `createClient(url, ANON_KEY)` with no session,
`.from("reference_trips").select("id")`.

> **⚠️ Correction, 2026-07-27 — that recipe was NOT RLS-subject on TEST.** The
> value in `NEXT_PUBLIC_SUPABASE_ANON_KEY` on TEST was a **secret** (`sb_secret_…`)
> key, not the publishable one, so a client built from it authenticated as
> service-role and **bypassed RLS entirely**. Any TEST read taken this way
> measured service-role behaviour while being labelled anon. The PROD half was
> fine — PROD's variable held a genuine publishable key. The local env has been
> corrected and the key rotated. **When re-running this recipe, check the key's
> prefix (`sb_publishable_` vs `sb_secret_`) first** — the variable name does not
> guarantee the value. See §"The RLS drift that wasn't" below.

## The RLS drift that wasn't — a retraction (2026-07-27)

**There is no RLS drift between the migrations and either database. The migrations
are an accurate description of both projects.** This section exists because a
previous session concluded the opposite, loudly, and that conclusion was wrong.

Verified from the live catalog `[queried catalog, TEST + PROD, 2026-07-27]`:

- **Policies match migrations exactly.** Both projects carry the same **8**
  policies — 4 on `trips`, 3 on `users`, 1 on `reference_trips` — and those are
  precisely the 8 declared in `20260513000000_init_identity.sql`. Nothing in the
  DB that is not in migrations; nothing in migrations that is not in the DB; no
  logical differences beyond Postgres' standard re-parenthesisation.
- **Grants are identical across roles.** `anon`, `authenticated` and
  `service_role` hold the same table privileges on every table checked.
- **No structural drift.** Every live application table is declared in migrations;
  `trips` and `reference_trips` match column-for-column on names, types,
  nullability and defaults; indexes and triggers match.

### What actually produced the anomaly

The reported symptom was that `anon` could read `master_place` and `source_record`
while `authenticated` could not — which no policy configuration explains, since
both tables have RLS enabled with **zero** policies and should deny both roles.

The cause was **one misconfigured environment variable, not the database**. The
probe's "anon" client was built from `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which on TEST
held a secret key (above). That client therefore ran as service-role and bypassed
RLS, returning rows. The "authenticated" client sent a real user JWT in
`Authorization`, which PostgREST honours over the `apikey` header, so *that* one
genuinely ran as `authenticated` and was correctly denied. The "split" was an
artifact of comparing a service-role client against an authenticated one while
believing both were unprivileged.

The definitive test, which settles it in one query and should have been run first:

```sql
SET ROLE anon;           -- master_place 0, source_record 0, reference_trips 9
SET ROLE authenticated;  -- master_place 0, source_record 0, reference_trips 9
```

Both roles, identical, exactly as the migrations predict.

### The durable lesson

**A probe is only as trustworthy as the identity it ran under.** Role-differentiated
behaviour was reported across four turns without once verifying which role the
client actually authenticated as. Before concluding anything from a client-side
query — especially anything shaped like "role X can do Y and role Z cannot" —
establish the effective role, either by decoding the key or with `SET ROLE` against
the catalog. `current_user` is one column and it is cheap.

A corollary, since this cut the other way in the same investigation: **migrations
are not authoritative about live state, but neither is a client probe.** The
catalog is. Where this doc's claims rest on migrations rather than a catalog read,
they are tagged as such.
