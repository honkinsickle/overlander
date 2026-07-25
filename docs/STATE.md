# STATE — `main` · 2026-07-25

Position, not changelog. `git log` is the changelog. Overwrite in place at every
review gate; update in the SAME commit as the work. No SHAs — deliberately.

## LIVE ON PROD (what a user can do today)
- **Manual drag editing on user-owned trips.** `NEXT_PUBLIC_LIVING_PLAN_EDIT=1`
  set in Vercel Production. Verified by Adam on a real user trip. The flag split has
  DEPLOYED, so this flag now gates manual editing ONLY.
- Reference slugs (`la-to-deadhorse`, `dawson-vancouver-cassiar`) never show the
  edit toggle — `canEdit = !isReference && isUserTrip(trip.id)`. Cassiar FROZEN.
- **"Change this trip" (NL editing) is now DARK on prod.** The flag split (#126)
  deployed, moving it behind its OWN flag `NEXT_PUBLIC_NL_EDIT` — **unset in Vercel =
  off, the prod end state; DO NOT set it.** (It had been per-interaction Opus spend with
  no quota/rate-limit infra, which is why it's dark until that infra exists.)
- **Corpus search works over the full LA→Deadhorse corridor.** Federated
  `/api/search-area` returns PROD's 13,629-place corpus (lat ~30→70.2, US +
  Canada sources) via Typesense `places_prod`. Restored 2026-07-23 after a
  rotated prod service key Vercel never received had silently broken hydrate.
  Counts and the full picture live in `docs/DATA_INVENTORY.md`.

## DEV GATES
- `main` is protected — direct pushes rejected (deletion, non_fast_forward,
  pull_request, required_status_checks). Every change goes through a PR.
- CI gates every merge: `typecheck`, `test`, and `build`
  (`cd web && npx next build`) must pass before merge.

## IN FLIGHT
- **Continuous day-detail scroll (Design A) — BUILT (view mode).** The day-detail
  center is now a continuous river of days when NOT in edit mode: a new
  `ContinuousDayStack` (`components/trip/continuous-day-stack.tsx`) IO-windows the
  near-viewport days (far days are height-holding placeholders), the scroll writes
  `?day=` settle-debounced (140ms) with a 400ms max-wait ceiling, and the one
  shared map follows the scroll-centered day on settle. Hysteresis (±15% vp dead
  zone) + cached measured heights (unmount is height-neutral). **PRESENTATION
  LAYER ONLY** — zero diff to the day-partitioned model (fence held); values cross
  the bridge (server-truth overrides/ranks), the optimistic edit machinery does
  not. `editMode` + Overview keep the single-day swap VERBATIM (the bridge; delete
  it once edit mode moves inside the container — PR2). Pure scroll math is
  unit-tested (`lib/trips/continuous-scroll.ts`). Verified in the slideup on
  `la-to-deadhorse` (66d) + `yotrippin-demo` (19d); build green. Why + mechanics:
  `docs/decisions/2026-07-25-continuous-day-detail-scroll.md`; §4 of
  `docs/architecture/itinerary-model.md` updated.
- **Reference trips serve DB-first** — [PR #143](https://github.com/honkinsickle/overlander/pull/143)
  **MERGED** to `main` (auto-deploys to prod via Vercel). Resolves the
  docs-say-DB-first / code-was-fixture-first contradiction. `getTrip` is now
  DB-first + reader-aware: `la-to-deadhorse` →
  `getReferenceTrip` (snapshot fallback + memo); other reference slugs →
  `getPersistedReferenceTrip`; anon trips last. `la-to-portland` migrated into
  `reference_trips` (raw payload) on TEST + PROD (idempotent
  `scripts/seed-reference-la-to-portland.ts`). **RESIDUAL:** the `TRIPS` module
  survives — it is now ONLY the anon-wizard store (`createTrip`/`listAnonTrips`/
  slug-write paths); the reference literals still sit in it but no longer shadow
  the DB; `ensureAlaskaUpgraded` still has 4 waypoint-helper callers. Finishing
  the fixture removal is backlogged (gated on lookup-vs-write of those helpers;
  lands with the remove-✕ affordance gating). Accepted: federated-fold-as-
  convergence, 404-on-DB-failure for the demo slug. Why + how:
  `docs/decisions/2026-07-25-reference-trips-db-first.md`; the serving model
  (readers, derivation, caching) is documented in
  `docs/architecture/trip-resolution.md`; `reference_trips` rows per DB live in
  `docs/DATA_INVENTORY.md`.
- **Curated-POI editing (kebab)** — MERGED (#131) and **DEPLOYED to prod** (Vercel
  auto-deploys `main`; the prod deployment on the #131 SHA completed successfully). Live
  now on user-owned UUID trips. A ⋮ kebab on each curated-POI card in the day detail:
  **Move to day** (curated/`segmentSuggestions` tiles) + **Delete**; route-waypoint
  tiles get Delete only. Gated on `canEdit` (user UUID trips; reference/frozen never
  show it). **Move-to-day is FUNCTIONAL, not a stub** — `moveCuratedPlace`
  (`web/src/lib/trips/curated-place.ts`) splices the POI between days'
  `segmentSuggestions` + `rescopeOverlays` drops its now-orphaned pin/rank, persisted
  in one guarded `updateUserTripPayload` write. **Geometry-free** (routing runs over
  `waypoints` only). CAVEAT: the move is an **array-splice**, so it **sticks on serve
  but does NOT survive a regenerate** — day membership is geographically re-derived at
  bake/regen (see `docs/architecture/itinerary-model.md` §2d, restored to main via #138).
  Durable cross-day assignment needs `dayAssignment` (below), NOT yet built.
- **`rescopeOverlays`** — MERGED (#130). Pure keep/drop core: given the trip-level
  `placeRanks`/`placeOverrides` + a NEW day layout, drops overlays whose stop lost its
  home, keeps the rest, never rewrites a `nodeId`. The kebab move uses it; `dayAssignment`
  will extend it.
- **`dayAssignment` — DESIGN OPEN, NOT resolved, NOT built.** Would make manual
  cross-day assignment authoritative + durable (survive regen), parallel to
  `placeOverrides`/`placeRanks`. **The anchor-seed-uuid key is DEAD** (verified from
  code, not assumed): `nodeSeed` ids are coord-deduped (`SEED_DEDUPE_MI=0.25`,
  `node-edits.ts:24,77,150`) → a revisited city collides (per-city, NOT per-instance),
  and `nodeSeeds` is trip-level + empty on fresh trips (never stamped per day). A **plain
  positional day key** breaks on reorder/regen renumber. Recommendation: **mint a genuine
  per-day uuid** (unique + reorder/remove-durable); **regen-survival remains a separate
  open problem** — days are regenerated content, not a carried coords-projected overlay,
  so no key survives regen for free (needs a re-attach rule). Scope +
  rejected-alternatives in `docs/decisions/2026-07-24-cross-day-stop-movement.md`.
- **Pinned ER fixture** — MERGED (#128). Replaces
  the ER seed's "copy every prod `source_record`" (silently tracked prod, 219 →
  20,384, baselines drifted) with a ~17-record hand-built fixture
  (`data/entity-resolution/fixtures/er-corpus.ts`), loaded via `upsertSourceRecord`;
  the seed no longer needs prod credentials. Assertions re-keyed to per-case
  outcomes; +4 `scoreMatch` unit tests (previously untested). Path values checked
  by pure computation. **The corpus block is UNVERIFIED end-to-end** — `test:er`
  is inert while `SUPABASE_TEST_URL` and `SUPABASE_URL` share a ref (the disposable
  ER project doesn't exist yet); first real `test:er` run is the true gate. The
  trade (and what a small fixture can't catch) is in
  `docs/decisions/2026-07-23-pinned-er-fixture.md`.

## NEXT (ordered)
1. **`dayAssignment` — decide the day-key, then build.** First call: mint a per-day
   uuid vs accept regen orphan-drop (the anchor-seed key is ruled out — see IN FLIGHT).
   Then build `dayAssignment` (a third overlay), apply at pool-assembly
   (`resolve-corridor-cities.ts`), extend `rescopeOverlays`, carry through regen, and
   **re-wire the kebab's move-to-day to write it** (replacing today's array-splice) so a
   move survives regeneration. Geographically-foreign assigned POIs render "Along the
   way", no fabricated mileage.
2. **DATA_INVENTORY maintenance** — keep `docs/DATA_INVENTORY.md` re-measured and
   current. It is the source of truth for what data lives where.
3. **Search architecture (reframed)** — the corridor corpus already EXISTS on
   PROD (13,629, federated + working). The open question narrows to
   Google-primary vs corpus-first ranking/precedence and whether audit-resolved
   Google records write back — NOT whether to build the corpus.
4. **Dwell-day reorder** — Day 6 POIs live in the drive:droppable. Scope decision.
5. **Reference-fixture removal (residual of #143)** — empty the reference `seed()`,
   reroute `ensureAlaskaUpgraded`'s 4 waypoint-helper reads to the DB reader, drop
   `la-to-portland` from `FIXTURE_TRIPS`. Gated on lookup-vs-write of those helpers;
   `TRIPS` must survive (it is the anon-wizard store). Full item + open question in
   `docs/BACKLOG.md`; updating `docs/architecture/trip-resolution.md` is part of it.

_Design-A continuous day-detail scroll is no longer parked — **BUILT (view
mode)**, see IN FLIGHT above. Remaining: PR2 brings edit mode inside the windowed
container (per-day optimistic overlays + drag) and deletes the single-day-swap
bridge._

## INVARIANTS (do not violate)
- A rank is meaningful only within a cluster. Key it to the node.
- Partial ranking is unrepresentable. Newcomers append, never demote.
- Display order is DOM order. Do not re-derive from miles.
- Phase guards (flag, TEST-ref) never on a shipped path. Property guards
  (`checkNotFrozen`) do.
- `retry` is correct ONLY if the mutate recomputes inside the closure. A
  precomputed full-structure overlay is refuse mislabeled as retry — it clobbers.
- Schema before the code that reads it. Always.
- The real gate is `cd web && npx next build`, exit 0. No tolerated errors.
- `data/.env` points at ONE project (TEST) and is NOT the whole picture. The
  corpus lives on PROD. Read `docs/DATA_INVENTORY.md` before drawing any
  conclusion about coverage or "what data exists."
