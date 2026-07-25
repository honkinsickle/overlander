# STATE — `main` · 2026-07-24

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
