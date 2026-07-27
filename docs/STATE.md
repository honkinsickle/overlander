# STATE — `main` · 2026-07-27

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
  `/api/search-area` returns PROD's corpus (US + Canada sources) via Typesense
  `places_prod`. Restored 2026-07-23 after a rotated prod service key Vercel never
  received had silently broken hydrate. Counts and the full picture live in
  `docs/DATA_INVENTORY.md`.
- **Curated-POI kebab (Move to day / Delete)** — live on user-owned UUID trips
  (#131). See the caveat under RESIDUALS.

## DEV GATES
- `main` is protected — direct pushes rejected (deletion, non_fast_forward,
  pull_request, required_status_checks). Every change goes through a PR.
- CI gates every merge: `typecheck`, `test`, and `build`
  (`cd web && npx next build`) must pass before merge.

## MERGED THIS SESSION (2026-07-26 → 07-27)

The previous STATE was stale by five PRs and carried a "stale below this line"
marker. That marker is now discharged — the entries below are reconciled from
`gh pr view` and `git log`, not carried forward.

- **#146 — continuous day-detail scroll (Design A, view mode).** The day-detail
  centre is a continuous river of days when NOT in edit mode; `ContinuousDayStack`
  IO-windows near-viewport days. Presentation layer only, zero diff to the
  day-partitioned model. `editMode` + Overview keep the single-day swap as a
  bridge, to be deleted in PR2.
- **#147 — `docs/architecture/place-render-model.md` Part 1.** What a place record
  carries vs what the day-detail card renders; §7 shape corrections; the
  disjoint-instruments caveat.
- **#148 — place-render-model Part 2.** The detail slideup is
  `map-detail-overlay.tsx` and renders directly from the dispatched payload — no
  fetch, no store, no loading state. Routing and Places are independent: a place
  that fails to enrich keeps its detour figures.
- **#149 — `fix(places/details)`: surface resolved-but-empty results.** One-line
  behaviour change: `if (rich)` instead of `if (rich && Object.keys(rich).length > 0)`,
  so a place that resolves with no rich fields is cached as hydrated rather than
  re-fetched forever.
- **#150 — corrected the "zero round-trips" claim.** Opening a detail costs zero
  round-trips when the tile is already hydrated (post-#149 that includes
  resolved-but-empty), one when it isn't. The original claim was scoped at the
  component; the fetch lives in the column.
- **#151 — `docs/architecture/generation-pipeline.md`.** First end-to-end trace of
  the expedition WRITE path: form → `preComputeFacts` → `generateAndAudit` →
  `bakeGeneratedDays` → `itineraryToTrip` → `attachHeroPhotos` → persist →
  `enqueueResolvedPlaces`.
- **#152 — `stretches.ts` stale-comment correction.** Comment-only, zero
  non-comment lines changed. Cherry-picked out of the parked `fix/generated-day-miles`
  because the hazard was live on `main` and shouldn't wait on a decision about the
  fix itself.
- **#154 — `fix(db)`: enforce RLS and explicit grants on `mvum_roads`.** It was
  created by migration without `enable row level security` while every sibling
  reference table enables it. Migration `20260727120000_mvum_roads_rls.sql`: RLS
  on, zero policies, explicit revokes on the table and on `upsert_mvum_road`.
  Applied and catalog-verified on both projects.

## OPEN

- **#153 — `docs/architecture/trip-creation-surfaces.md`, STILL OPEN.** The client
  half of trip creation: the wizard form, what it collects, the in-flight render,
  the post-creation landing. Companion to `generation-pipeline.md` (#151, merged),
  which covers only the server half. **Not on `main`** — anything referencing
  `trip-creation-surfaces.md` will 404 until this merges.

## PARKED / BLOCKED

- **PARKED: `fix/generated-day-miles`** — pushed to remote, **unmerged, no PR**,
  awaiting a decision. Carries (1) `web/scripts/check-payload-invariants.ts`, a
  read-only TEST-only measurement instrument, deliberately **not** in CI —
  baseline on `expedition-ms28y793` is 1/6 assertions passing; (2) a
  `where === "keyStop"` via filter + `placeId`-keyed role merge in `bake.ts`,
  12 unit tests, mutation-checked.
  - **Parked because the fix was measured and is small:** the via filter removes
    **~6%** of the geometry inflation (2.25× → 2.18× vs the direct line). The
    dominant term is key-stop vias being genuine off-route excursions in LLM
    emission order, which the filter does not touch. Numbers:
    `docs/architecture/generation-pipeline.md` §7.
  - **Its third component has already landed separately as #152** — the
    `stretches.ts` hazard-fix comment. The branch still contains that commit, so
    expect it to be a no-op on rebase. The `TODO(scope)` hazard it describes is
    now correctly documented on `main`.
  - No database was written. `expedition-ms28y793` is untouched and remains the
    only artifact of the unfixed pipeline.

- **BLOCKED: the wizard swap — decided, cannot start.** The legacy 5-step wizard
  is to be **replaced** by the expedition (LLM) wizard, and generation will
  **require sign-in** so a generated trip is an owned, editable, findable `trips`
  row. Trips created by the legacy wizard can be discarded; the anon `TRIPS` store
  is to be deleted rather than replaced.
  - **The blocker is auth, and nothing in the sequence moves until it is
    resolved.** Google OAuth is the only wired sign-in method
    (`web/src/app/auth/actions.ts`, `signInWithGoogle`; the sign-in page's own copy
    says "Google · only sign-in method for v1"). **TEST has no Google provider
    configured**, and **PROD's provider is disabled**. So requiring sign-in for
    generation makes the primary creation path unreachable in dev without
    hand-minting a session cookie, and unreachable in prod outright.
  - Sequence and the full scoping live in `docs/BACKLOG.md` §Wizard swap. The
    client-side surface trace is #153 (still open).

## RESIDUALS (known, deliberate, not defects)

- **Reference-fixture removal (residual of #143).** The `TRIPS` module survives as
  the anon-wizard store only; reference literals still sit in it but no longer
  shadow the DB. `ensureAlaskaUpgraded` still has 4 waypoint-helper callers.
  Gated on lookup-vs-write of those helpers. **Note the interaction:** the wizard
  swap deletes the anon `TRIPS` store, so these two items are the same work and
  should not be started independently.
- **Curated kebab move-to-day is an array-splice** — sticks on serve but does NOT
  survive a regenerate, because day membership is geographically re-derived at
  bake/regen. Durable cross-day assignment needs `dayAssignment`, not yet built.
- **`dayAssignment` — DESIGN OPEN, NOT built.** The anchor-seed-uuid key is ruled
  out (coord-deduped, so a revisited city collides). Recommendation: mint a
  genuine per-day uuid; regen-survival remains a separate open problem. Scope and
  rejected alternatives:
  `docs/decisions/2026-07-24-cross-day-stop-movement.md`.
- **Seed-id pin resolution — queued, scoped, not built.** Cross-node drag-pins
  write a `nodeSeed`-keyed override the read spine can't resolve. Landing it also
  reverts the #146 view stack from optimistic values to server truth.
- **Pinned ER fixture (#128) corpus block is UNVERIFIED end-to-end** — `test:er`
  is inert while `SUPABASE_TEST_URL` and `SUPABASE_URL` share a ref. First real
  `test:er` run is the true gate.

## NEXT (ordered)
1. **Resolve the auth blocker.** It gates the entire wizard swap, and the swap is
   the largest decided-but-unstarted piece of work. Until sign-in is exercisable,
   nothing downstream of it can be verified.
2. **`dayAssignment` — decide the day-key, then build.** Mint a per-day uuid vs
   accept regen orphan-drop. Then apply at pool-assembly, extend `rescopeOverlays`,
   carry through regen, and re-wire the kebab's move-to-day to write it.
3. **DATA_INVENTORY maintenance** — keep `docs/DATA_INVENTORY.md` re-measured. It
   is the source of truth for what data lives where.
4. **Search architecture (reframed)** — the corridor corpus already EXISTS on PROD
   and works. The open question narrows to Google-primary vs corpus-first
   ranking/precedence, and whether audit-resolved Google records write back.
5. **Dwell-day reorder** — Day 6 POIs live in the drive:droppable. Scope decision.

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
- **A probe is only as trustworthy as the identity it ran under.** Before
  concluding anything from a client-side query, verify which role it actually
  authenticated as. See `docs/architecture/trip-resolution.md` §"The RLS drift
  that wasn't".
