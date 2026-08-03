# STATE — `main` · 2026-08-03

Position, not changelog. `git log` is the changelog. Overwrite in place at every
review gate; update in the SAME commit as the work. No SHAs — deliberately.

## COLD START (read this first, in this order)

Written 2026-07-31 for an agent arriving in a **different environment** — work is
moving off Claude Code on Adam's desktop. Do not assume your harness loads
anything automatically.

1. **Read `CLAUDE.md` at the repo root FIRST — load it by hand if your
   environment does not.** It is not background reading; it carries the standing
   instructions you will otherwise violate: `main` is protected and every change
   goes branch → PR → **Adam merges** (never merge your own); the git hygiene
   rule (`git add` explicit paths only — no `add .`, no `-A`, no `commit -a`);
   the tripwire discipline (state the paths that must show ZERO diff, then verify
   it); PROD/TEST separation (`dawson-vancouver-cassiar` is **FROZEN**);
   iOverlander is a **banned data source**; and the RUNBOOK, whose gotchas are
   measured, expensive, and not re-derivable from source — which test trip to
   reach for, the ~1h dev-session expiry that masquerades as broken drag
   tooling, the 15-minute negative cache on `/api/places/details`, and the
   apparatus-validation lessons.
   - `web/CLAUDE.md` and `web/AGENTS.md` carry the web-specific conventions
     (slideup-not-full-page, design tokens, the repository layer).
2. **Then this file** for position — what is live, what merged, what is decided
   but unbuilt, what is parked.
3. **Then the architecture doc for your task.** There are five and the filenames
   do **not** make the split obvious:

| Doc | Read it when you are working on |
|---|---|
| `docs/architecture/trip-resolution.md` | **How an id becomes a payload** — `getTrip`'s resolution order, the two reference readers, fork, caching. Also the source of the **evidence-tag convention** every doc here uses. |
| `docs/architecture/itinerary-model.md` | **The data model as it stands** — `Day`/waypoint/corridor-spine shape, the route-vs-overlay two-layer model, nodeId keying, guarded single-write persistence. §7 is the single home for the five trip payload shapes. |
| `docs/architecture/generation-pipeline.md` | **The WRITE path** — the server-side generation run (gates → `preComputeFacts` → LLM → `bakeGeneratedDays` → persist), LLM field provenance, failure modes. |
| `docs/architecture/trip-creation-surfaces.md` | **The client/UI half of creation** — which surfaces create a trip, every expedition-wizard input, the destination autocomplete, what `expeditionToGenerationInput` forwards. |
| `docs/architecture/place-render-model.md` | **The READ/render path for one place** — what a stored tile carries vs what the day-detail card and the detail slideup each show, enrichment via `/api/places/details`. |

4. **`docs/BACKLOG.md`** for parked work, **`docs/LOG.md`** for why things are the
   way they are (append-only, newest at top), **`docs/DATA_INVENTORY.md`** for
   which data lives in which database.

**Conventions that are easy to miss.** Every factual claim in `docs/` carries an
inline evidence tag — `` `[read source]` ``, `` `[grep]` ``, `` `[queried TEST]` ``,
`` `[queried PROD]` ``, `` `[script]` ``, `` `[measured YYYY-MM-DD]` ``, or
`` `[UNVERIFIED]` ``. The convention exists because a confident doc once recreated
a false belief (`trip-resolution.md` §"Why this doc states its evidence"). **Add a
claim only with its evidence, and mark what you could not verify.** Superseded
text is struck through with `~~` and annotated **in place**, never deleted — a
later entry corrects an earlier one and the earlier one stays.

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

## 2026-08-03 — day-insert UX shipped (#182 · #183 · #184)

Three PRs merged this week, all on `main`, nothing stranded `[gh pr list +
git grep for the symbols on origin/main, 2026-08-03]`. My branch's content is
fully in `main` (empty diff vs `origin/main`). The only open PR is **#24** (May,
live-weather salvage — unrelated).

- **#182** — `splitDay` (subdivide a leg A→B at an interior point M into A→M /
  M→B). Merged 2026-08-01; at merge it was **wired to nothing** — repo + routing
  machinery only, no action or UI. This session's STATE was four days stale and
  did not know #182 existed — the day-insert work built directly on it.
- **#183** — doc-only: softened the Paper MCP RUNBOOK gotcha to what was measured.
- **#184** — **the day-insert feature.** Wires #182 to an action + UI and builds
  "add a rest day" on the same machinery.

### SHIPPED on `main` (#184)
- **Two day-level kebab items** on each day in the live corridor view, gated on
  `canEdit` (user-owned editable UUID trips), **no feature flag**. The kebab is
  NEW — the old day-level `DayHeader` kebab (rename/delete/reset) is orphaned
  (§below), so there was no host to add to.
- **Split this day** → a `BottomSheet` split-point picker listing the day's own
  interior stops (`splitEligibility`), **disabled with a reason** when a day has
  no interior stop (layover / no route / no stop). Calls `splitDay` via
  `splitDayAction` behind the `checkNotFrozen` rail.
- **Add a rest day** → `insertRestDay`: a sparse `start === end` layover (miles 0
  / driveHours 0, no spine), nearby corpus suggestions distance-ranked + capped
  at 10, one guarded write, **zero route calls**. `insertRestDayAction`, same rail.
- **Render home** — a layover renders its suggestions inline (an `isRestDay`-gated
  "Nearby" block in `DayDetailCorridor`). Without it the tiles are stored and
  never seen — they are non-curated with no corridor spine to bucket under.
  Observed 0/4 → 4/4 against a 2/7 normal-day control `[renderToString probe,
  2026-08-03]`.
- Actions use **no `getUser()`** — RLS enforces ownership at the write (a
  non-owner reads null → not-found), matching `addWaypointAction`. The handoff's
  "getUser()" was intent, not the shipped pattern.
- Mechanics: `docs/architecture/itinerary-model.md` §6 (write) and
  `docs/architecture/place-render-model.md` (the Nearby render home). Follow-ups:
  `docs/BACKLOG.md` §Day-insert.

### NOT verified — four browser-only checks (carried to `docs/BACKLOG.md`)
No browser/preview was reachable this session; server-side + `renderToString` was
the ceiling. **Unobserved:** map draws the rebuilt split polyline / no phantom
layover segment / per-day highlighting; slideup re-render after `router.refresh()`
when day ids shift across the whole tail (**structural**, not cosmetic — and
`deleteDayAction` shares the same path, so a gap may be two things); kebab↔`heroTag`
overlap; edit-mode drive connector on a layover.

### Deploy status — `[UNVERIFIED]`
#184 is on `main`; whether Vercel Production has redeployed since is **not checked
from here**. The kebab carries no flag, so it is live on any `canEdit` trip
wherever #184 is deployed. Not added to §LIVE ON PROD until deploy is confirmed.

## 2026-07-31 — planning scope narrowed; out-of-region trips de-linked

**Three PRs merged, all on `main`, nothing stranded** `[gh pr list, verified
2026-07-31 — each confirmed present on origin/main by grep, not by the merge
banner]`. The only open PR in the repo is **#24** (May, unrelated).

- **#176** — `/api/places/details` **chunks instead of truncating**. No id is
  dropped. `BATCH_SIZE = 40` is now a fan-out chunk size, not an input cap.
- **#177** — the three out-of-region reference trips de-linked; `4534add5`
  adopted as the standing instrument (this section).
- **#178** — **trip creation restricted to the six-state planning region**, in
  code. Two commits: the constraint, then a correction making the invariant
  actually compiler-enforced (see §PLANNING REGION below).

**Scope is now CA, NV, UT, AZ, WA, OR.** Three reference trips sit outside it and
were test fixtures serving as product content. Their in-product pointers are gone.

- **DE-LINKED, not retired and not deleted.** No row removed, nothing made
  unreachable. `reference_trips` is still anon-readable, so
  `/trip/la-to-deadhorse` renders for anyone with the URL. Deleting rows is a
  separate decision and a separate authorization.
- **Pointers found and removed — two, not the one expected.** The `/trips` empty
  state (`app/trips/layout.tsx`) *and* the home browse link
  (`components/plan/entry-scene.tsx`). **`alaska-south-final` and `yotrippin-demo`
  had zero pointers** — de-linking them was doc-only.
- **Both surfaces already carried a wizard CTA**, so neither goes empty; the
  wizard link is simply now the only one. The `/trips` copy changed from "Start by
  forking the LA to Deadhorse reference itinerary" to "Plan your first trip."
- **`REFERENCE_TRIP_IDS` deliberately NOT changed** (duplicated in
  `app/trip/[id]/page.tsx` and `app/@modal/(.)trip/[id]/page.tsx`). It is not a
  link table — nothing navigates through it. It marks reference *behaviour*
  (`isReference` → fork CTA, forces `canEdit` false); reachability comes from
  `getTrip()`. Removing the id would strip the trip's reference treatment while
  leaving it reachable — a behaviour change dressed as a de-link.
- **`dawson-vancouver-cassiar` untouched.** Out of region, but FROZEN by an
  earlier deliberate decision; every guard stands.
- **NEW STANDING INSTRUMENT: `4534add5-3787-4b5f-ade6-584ce0fc27e7`** (PROD
  `public.trips`, San Diego → Portland, 11d). Healthy `dayRoutes` shape, 770
  tiles, day 2 over the MAX_IDS cap at 45, two round-trip days, `curatedMode`
  true. **RLS-scoped, so NOT anon-readable** — browser DOM measurement now needs a
  minted session. Density is lopsided; its mean is not representative. Shape
  re-verified in a second pass before recording: `docs/DATA_INVENTORY.md`.
- **Two cases lost their default instrument:** the 91-id / three-batch MAX_IDS
  case and the `curatedMode = false` render mode. Both probably want a synthetic
  fixture. Recorded, not built — fixture design in `docs/BACKLOG.md`.

### PLANNING REGION — the constraint is in code, not just policy (#178)

- **One constant, one place:** `web/src/lib/plan/planning-region.ts` holds
  `PLANNING_REGION_CODES` and the display string. Widening the region is a
  one-line diff there; nothing else hardcodes a state code `[grep, 2026-07-31]`.
- **Codes, not a bounding box** — deliberate. A box over the six states contains
  **Idaho entirely**, western Montana, western Wyoming, and a strip of
  Baja/Sonora. (It does **not** meaningfully contain Colorado or New Mexico —
  UT/AZ's eastern border *is* CO/NM's western border, the Four Corners meridian
  at −109.045°. An earlier claim that it leaked into those two states was wrong;
  see `docs/LOG.md` 2026-07-31.)
- **The region STOPS at `expeditionToGenerationInput`** `[read source]`. That
  mapper builds each `Anchor` field by field and does not copy `region`, so it
  never reaches `GenerationInput` or anything under `lib/itinerary/`. It exists
  to be *checked* before generation, not to be planned with.
- **The check lives in `validateExpeditionForm`, not in the action.** A
  deliberate deviation from "add a third guard in
  `generateExpeditionTripAction`": the action calls the validator, so one
  implementation covers both the client gate and the server backstop.
  `generateExpeditionTripAction`'s guards, in order, are **flag → sign-in →
  `validateExpeditionForm`** `[read source]`; there is no fourth guard before
  spend.
- **Strict by design:** a Mapbox suggestion with no `region_code` is dropped
  too — we admit only what we can positively prove is in region. The failure
  mode is **silent** (no error, no log), so if places start vanishing from the
  autocomplete, an absent `region_code` is the first thing to check.

### DECIDED BUT NOT BUILT (current, as of 2026-07-31)

Decided means the shape is settled and the next person can build it without
re-litigating. Full entries in `docs/BACKLOG.md`; one line each here.

- **Badge gate on `placeId`.** Gate the "yoTrippin Verified" badge on whether the
  tile carries a `placeId`. Scoped; the enrichment-gated alternative was
  **rejected on measurement** (506 ms flicker) and on provenance.
- **Synthetic fixture replacing the de-linked instruments.** One fixture — a
  ~90-tile `placeId`-bearing day with no curated flags — covers both the
  three-batch chunking case and `curatedMode = false`.
- **Remove the orphaned `${name}Lat` / `${name}Lng` hidden inputs** in
  `location-autocomplete.tsx`. Dead since #166; zero consumers `[grep across
  both workspaces incl. `web/scripts`, 2026-07-31]`. Deliberately left in #178 as
  unrelated cleanup.

### PARKED (current, as of 2026-07-31)

Parked means blocked, deferred, or waiting on a decision that is **not** made.

- **`fix/generated-day-miles`** — new generations still write bad
  `milesFromStart`; nothing renders them since #170. Data-quality debt.
- **`USE_FEDERATED_POIS` is unset**, so the browse route's corpus merge never
  runs. Whether it is set in **Vercel Production is `[UNVERIFIED]`** — no
  committed file records it.
- **Unbounded request size at `/api/places/details`** (introduced by #176).
  Nothing can currently send an absurd request, but that is a property of the
  client, not the endpoint.
- **`yotrippin-demo` spine/label divergence** — cause unestablished; not
  checkable from source.
- **"yoTrippin Verified" still has no definition.** The badge gate above is
  mechanical; what the label *means* remains an unmade product decision.

## 2026-07-28 — ONE CAUSAL CHAIN, plus one separate thread

`[gh pr view #153–#175, 2026-07-28]` — nine PRs merged today (**#165–#173**);
**#159–#164 were yesterday**; ~~#174/#175 do not exist~~ **— true when written;
#174/#175 merged later on 07-28 and 07-30 respectively, and #176–#178 on 07-31
`[gh pr list, 2026-07-31]`.** Nothing from today is open
or stranded. The only open PR in the repo is **#24** (May, unrelated). Verified
rather than assumed — #153 was once taken as merged a day early, and **#172
merged mid-correction today**, stranding a fix on its branch until it was
cherry-picked as #173.

**Read this as a chain, because it was one.** Each link caused the next:

1. **The wizard swap completed** (#166 4b, #167 4c) → the expedition wizard is
   the only creation path, and generation went live on PROD.
2. **Generated trips started landing in `public.trips`** — three of them, all
   created 2026-07-28 by the same owner.
3. **The `milesFromStart` pricing pass discovered them**, which **falsified the
   recorded claim that no PROD trip carried stored miles** (true when measured
   2026-07-26; the table held no generated rows then).
4. That turned a TEST curiosity into a **live production defect** and settled
   option (a) vs (b) **in favour of (b), the read-path fix**.
5. **(b) shipped as #170.**

**MAX_IDS ran separately** — measured, scoped, and deliberately not built *that
day*; **shipped 2026-07-31 as #176**.

### SHIPPED (live on `main`)
- **#165** — no date-pin toggle on start/end destinations.
- **#166 (4b) / #167 (4c)** — legacy 5-step wizard **deleted**, trips-domain
  residue unwound. `/plan` 404s.
- **#170 — the read spine projects coordinates, never stored miles.** Ordering
  and labels now come from `positionPlacesOnDay`; round-trip days claim **no**
  mile (their driving is absent from `routePolyline`); same-mile ties break on
  `offsetMi`, which at a polyline-end clamp is distance past the terminus.
  Ships with `web/scripts/verify-projection-delta.ts`. Mechanics:
  `docs/architecture/itinerary-model.md` §2c-i.
- **#168 / #169 / #171 / #172 / #173** — doc passes and corrections, including
  the three-site correction of the stale "no PROD trip stores `milesFromStart`"
  claim (#171) and two rounds of MAX_IDS corrections (#172, #173).

### DECIDED BUT NOT BUILT
- **~~MAX_IDS = 40 → chunk server-side. Measured, scoped, tripwired, unbuilt.~~
  BUILT AND MERGED as #176 on 2026-07-31.** `parsePlaceIds` no longer slices;
  the route chunks all ids at `BATCH_SIZE = 40`. The cap was **not** raised and
  nothing was reordered by proximity, as the scoping required. Kept here struck
  rather than deleted because the reasoning still governs the next change to
  this route. **One consequence to know about: removing the `.slice` removed the
  only bound on request size** — see `docs/BACKLOG.md`.

### PARKED
- **`fix/generated-day-miles` — LOWER urgency after #170, but not closed.**
  Both halves matter: **nothing renders the bad miles any more** (the read path
  stopped trusting them), **and new generations still write them**. That is
  data-quality debt rather than a render bug. See PARKED below and
  `docs/BACKLOG.md`.

## MERGED EARLIER (2026-07-26 → 07-27)

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
- **#153 — `docs/architecture/trip-creation-surfaces.md`.** The client half of
  trip creation, companion to `generation-pipeline.md` (#151, the server half):
  the wizard form and every input, what actually reaches the pipeline, the
  in-flight render, and the post-creation landing. Read-only — the form was
  **never submitted**, so every in-flight/error/landing claim is static code
  analysis and no duration is estimated anywhere. Three findings carried forward:
  - **No degradation signal reaches any component.** The action returns
    `{ ok, tripId, days, note? }`; the wizard reads `ok`/`error`/`tripId` only, so
    `note` and `days` are dropped on arrival. `note` keys off surviving structural
    violations, so the **missing-`GOOGLE_PLACES_API_KEY` case emits no signal at
    all**. There is no toast/banner/alert system anywhere in the repo to surface
    one.
  - **The live creation path is the LEGACY 5-step wizard, not this pipeline** — it
    has no feature flag and is the root page's primary CTA, while the expedition
    wizard is flag-gated with zero links. The anon `TRIPS` path is not a third
    surface; it is the legacy wizard's anonymous finalize branch. This is what the
    wizard-swap decision below acts on.
  - **A generated trip is neither editable nor findable** — `expedition-<base36>`
    is not a UUID so `canEdit === false`, and it is written to `reference_trips`
    while the listings query `trips` / filter `trip-`, so it appears in no listing
    on any surface.
  - Also recorded: the only timeout in the whole generation chain is
    `AbortSignal.timeout(8000)` on the Google fetch — nothing on the LLM call, no
    `maxDuration`, no error retry. `ENABLE_PLANNER_WIZARD`'s **production** value
    is `[UNVERIFIED]` (no `vercel.json`; dashboard env is not in source), which is
    weaker than the previously-recorded "prod never sets it."
- **#154 — `fix(db)`: enforce RLS and explicit grants on `mvum_roads`.** It was
  created by migration without `enable row level security` while every sibling
  reference table enables it. Migration `20260727120000_mvum_roads_rls.sql`: RLS
  on, zero policies, explicit revokes on the table and on `upsert_mvum_road`.
  Applied and catalog-verified on both projects.

## PARKED / BLOCKED

- **PARKED: `fix/generated-day-miles`** — pushed to remote, **unmerged, no PR**,
  remote tip `37faabb`.
  - **The decision it was awaiting has been made, and it went the other way.**
    Option (b) — fix the read path — shipped as **#170**. So this branch is no
    longer the pending choice; it is a separate, lower-urgency question.
  - **Nothing renders the bad miles now.** #170 pointed every read-path consumer
    at coordinate projection, so the stored field is inert at the surfaces that
    used to trust it.
  - **But new generations still write it.** Every trip created from here on
    accumulates an inflated `milesFromStart` that nothing validates. Data-quality
    debt, not a render defect — and the reason this stays open rather than closed.
  - Merge check `[2026-07-28]`: merges onto `main` with one **comment-only**
    conflict in `stretches.ts` (take main's paragraph); its 12 tests pass on the
    merged tree.
  - Carries (1) `web/scripts/check-payload-invariants.ts`, a
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

- **The wizard swap — ALL FIVE code steps MERGED. Blocked on one missing PROD env
  var, not on code.** Every PR below is confirmed merged
  `[gh pr list --state all, 2026-07-27]` — not assumed; #153 was assumed merged a
  day early and was not.
  - **#159** — auth gate on `/plan/expedition`, both halves (page redirect +
    action `getUser()`). The flag check runs FIRST so a disabled wizard 404s
    rather than leaking its existence.
  - **#160** — write target moved from `reference_trips` to an owned
    `public.trips` row: `owner_id` from the session, `state: "active"`,
    `reference_id: null`, enforced by `trips_insert_owner`
    (`auth.uid() = owner_id`). Generated trips are now editable and findable.
  - **#161** — root CTA repointed to `/plan/expedition`.
  - **#162 (4a)** — de-linked the remaining legacy entry points (the `/trips`
    empty state and draft trip cards). **Deletes nothing.** Zero
    `<Link href="/plan">` remain in `web/src` `[grep]`.
  - **#163** — removed the TEST-only rail from the trip write, and **narrowed it
    to the `enqueueResolvedPlaces` call site** rather than deleting it. The trip
    insert is session-scoped and RLS-enforced, so the rail no longer described
    it; the corpus write is still service-role into a shared curated table, so
    the gate stays there. See BACKLOG §"Corpus capture on PROD".

- **PROD state — VERIFIED, not reported.** `[vercel env ls production +
  unauthenticated probe of the public alias, 2026-07-27]`
  - **`ENABLE_PLANNER_WIZARD` is set in Production** (1h before this pass) and the
    wizard is live: `GET /plan/expedition` returns **307 →
    `/auth/sign-in?next=/plan/expedition`**. With the flag off that path 404s
    (`notFound()` runs before the auth check), so the redirect is positive proof
    the flag is on AND the auth gate works on PROD.
  - **`ANTHROPIC_API_KEY` is NOT set in Production.** This is the ONE blocker to a
    first PROD generation — the action throws `missing_key` before any spend.
  - **`GOOGLE_PLACES_API_KEY` IS set in Production** (49d, Preview+Production).
    This matters: the feared interaction with the silent-degradation defect
    **does not apply** to the first PROD generation. Tier-2 resolution will work.
  - `NEXT_PUBLIC_NL_EDIT` remains unset — the intended prod end state, unchanged.
  - **`/plan` still mints on PROD**: `GET /plan` → 307 →
    `/plan/<id>/going`. The legacy route is fully live; #162 only removed the
    links to it, by design. Direct-URL entry still works — which is exactly what
    makes 4b safe to defer.

- **PR 4b MERGED (#166) — the legacy wizard is GONE.** Both gates cleared first:
  `ANTHROPIC_API_KEY` is set in Vercel Production, a PROD generation succeeded end
  to end, and the post-sign-in return was verified. 32 deletions — `app/plan/route.ts`
  + `app/plan/[id]/**`, 14 legacy-only components, `lib/plan/*` except `types.ts`,
  `lib/routing/day-suggestions.ts` + `suggestions-for-segment.ts`, and the smoke
  test for the last of those. `/plan` now 404s.
  - **Two orphans 4b created are still noted-not-acted-on:**
    `components/ui/checkbox` and `lib/imagery/mapbox-static` both dropped to
    **zero** importers across all of `web/`. Neither was in 4b's scope and
    neither is in 4c's. Decide them deliberately or leave them.
  - **Runbook lesson recorded in `CLAUDE.md` §RUNBOOK gotchas**, not just in the
    PR: a dependency sweep must walk `web/scripts`, not only `web/src` — the
    build gate type-checks both, and 4b's group 4 broke on exactly that.

- **THE WIZARD SWAP IS COMPLETE.** All of 4a–4c merged
  `[gh pr view, 2026-07-28]`: **4a (#162)** de-linked the last two in-app entry
  points; **4b (#166)** deleted the routes and legacy-only modules; **4c (#167)**
  unwound the trips-domain residue. **#168** recorded the #166 correction and
  widened the search-boundary runbook lesson. `main` is at `86e3acf`. The
  expedition wizard is now the **only** creation path in the codebase.

- **Repo hygiene, 2026-07-28.** **52 merged local branches deleted, 2 stale
  remote-tracking refs pruned** (`origin/feat/remove-legacy-wizard-4b`,
  `origin/fix/no-datepin-on-start-end`). Deleted with `git branch -d` so git
  itself refused anything not fully merged; the one branch that needed `-D`
  (`feat/manual-trip-edit`) was confirmed an ancestor of `main` first, so nothing
  was lost. 16 local branches remain — 15 unmerged plus `main`.
  - **`fix/generated-day-miles` SURVIVED THE CLEANUP DELIBERATELY.** Still
    pushed, still **no PR** `[gh pr list --head, 2026-07-28]`, remote tip
    `37faabb`. It is parked pending a decision between fixing `bake.ts` and
    projecting on the read path — see PARKED above and
    `generation-pipeline.md` §7.6. It was explicitly excluded from the prune;
    do not treat it as debris.

- **PR 4c — trips-domain residue unwound (MERGED, #167).** `createUserWizardTrip`,
  `writeWizardSlice`, `UserTripSummary.wizardStep`, and `Trip.wizard` all deleted;
  each verified dead against the post-4b graph first.
  - **`Trip.wizard` is gone from the TYPE but still in the DATA**, and that is
    fine by construction: reads are a bare `data.payload as Trip` cast (no zod,
    no allowlist) and writes spread (`{...rawPayload}` → mutate → `{...updated}`),
    so an unknown `wizard` key is **preserved on rewrite, never dropped**.
    Measured 2026-07-28 on TEST: the **only** row carrying it is the seed draft
    `7e6774b9`, `{"currentStep":"going"}`; no generated trip has ever written the
    key. (Named as which row rather than a ratio — a bare count goes stale the
    next time anyone generates.) **PROD NOT MEASURED** — the Supabase
    access token has been revoked and no PROD credentials exist locally. The 7
    PROD draft rows were previously reported as `wizardStep=going`, which implies
    they carry it; treat that as prior report, not a fresh measurement.
  - **CORRECTION — drafts can still be created.** The 4c scoping assumed
    `createUserWizardTrip` was the only writer of `state='draft'`. It was not.
    Three live paths remain `[read source]`: **duplicate-trip**
    (`app/trips/actions.ts:110` inserts `state:"draft"`), **`setTripState`**
    (`app/trips/actions.ts:16`, user-settable via the StatePill), and the **DB
    default** (`state text not null default 'draft'` — any insert omitting state).
    Draft is a live product concept independent of the wizard; do not treat it as
    vestigial.
  - **`lib/plan/types.ts` stays, and is now down to ONE consumer:**
    `components/plan/planning-topbar.tsx`, using 4 of its 17 exports
    (`PLAN_STEPS`, `STEP_DISPLAY_NUMBER`, `TOTAL_DISPLAY_STEPS`, `PlanStep`). The
    other 13 — `PlanWith`, `PlanLocation`, `Pace`, `PACE_BOUNDS`, `GoingData`,
    `VehicleData`, `InterestsData`, `PlannedStop`, `StopsData`, `DraftStatus`,
    `DraftTrip`, `WizardSlices`, `STEP_TITLE` — now have **zero** consumers
    `[re-verified 2026-07-28: 1 consumer, 17 exports, 4 used]`. Reported, not
    deleted. (`STEP_TITLE` was missing from this list as first written — the
    count said 13 while the enumeration held 12.) Note the topbar derives its step from the URL segment, so with
    `/plan/[id]/<step>` deleted **the STEP counter can no longer activate** on any
    surviving route; it renders its blank state on home. That whole file is a
    candidate for a later pass.
  - **Known cosmetic consequence of 4a**, measured on TEST against a
    deliberately-constructed 0-day draft: a dateless draft renders in the slideup
    as `NaN/NaN-NaN/NaN • 0 Days • 0 mi` (the `/trips` card already showed
    `Invalid Date` before this change). It renders — no crash, no dead link —
    but **PROD has 7 such draft rows**, so 7 users would see that header. A date
    guard is unscoped; decide it with 4b.

  The legacy
  5-step wizard is to be **replaced** by the expedition (LLM) wizard, and
  generation will **require sign-in** so a generated trip is an owned, editable,
  findable `trips` row. Trips created by the legacy wizard can be discarded; the
  anon `TRIPS` store is to be deleted rather than replaced.
  - **CORRECTION 2026-07-27 — the recorded blocker was wrong.** This was written
    as *"TEST has no Google provider configured, and PROD's provider is
    disabled."* The first half holds; **the second is false.** Actual state
    `[queried Management API config/auth, 2026-07-27]`: **TEST has no Google
    provider configured. PROD has Google enabled, with a client id and secret
    set. Email is enabled on both.** The original claim was recorded from a
    verbal report without an evidence tag and without being checked.
  - **What actually remains is a UI gap, not missing infrastructure.**
    **Sign-in works on PROD today.** No email, magic-link, OTP or password-reset
    form exists anywhere in `web/src` — a repo-wide grep for `signInWithPassword`,
    `signInWithOtp`, `signUp`, `verifyOtp`, `resetPasswordForEmail` and
    `signInAnonymously` returns **zero hits** in app code, and
    `web/src/app/auth/actions.ts` exports only `signInWithGoogle` and `signOut`
    `[grep]`. So *"should the product ship Google-only?"* is a **product
    decision**, not a prerequisite — the sequence can start whenever that is
    settled.
  - **Scriptable dev login already works — confirmed, not inferred.**
    `external_email_enabled` is `true` on TEST `[queried Management API
    config/auth, 2026-07-27]`, which is exactly what the committed
    `signInWithPassword` scripts rely on (`mint-dev-session.ts`,
    `seed-test-user.ts`, the three `verify-trip-*.ts` harnesses). The only
    friction is the ~1h session expiry already documented in CLAUDE.md §RUNBOOK.
  - **Magic-link callback shape RESOLVED 2026-07-27 — it is `?code=`.** A real
    client-initiated `signInWithOtp` redirects with a query param, not a fragment,
    so `exchangeCodeForSession` serves both flows and the callback change is
    **additive**. An earlier `#fragment` measurement was an artifact of using
    `admin/generate_link`, which carries no PKCE challenge. Two link types exist
    (`signup` first-time, `magiclink` returning) and the current route sees
    neither. Mechanics + instrument:
    `docs/decisions/2026-07-27-generation-requires-sign-in.md` §Magic-link
    mechanics.
  - Sequence and the full scoping live in `docs/BACKLOG.md` §Wizard swap. The
    client-side surface trace is `docs/architecture/trip-creation-surfaces.md` (#153).

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
1. **The wizard swap is DONE through 4c.** 4a–4c merged or in review; the legacy
   wizard's routes, modules, and trips-domain residue are gone. What remains of
   the teardown is deliberately parked, not forgotten:
   - The **anon `TRIPS` store** — still out of scope, entangled with the
     reference-fixture removal, and inert now that legacy is gone.
   - **`lib/plan/types.ts`** — 13 of 17 exports have zero consumers (see above).
   - **4b's two orphans** — `components/ui/checkbox`, `lib/imagery/mapbox-static`.
   - The **dateless-draft header** (`NaN/NaN-NaN/NaN • 0 Days • 0 mi`) on PROD's
     7 draft rows. Still undecided, and drafts are still creatable via
     duplicate-trip, so this is not self-limiting.
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
- Trip creation is restricted to **CA/NV/UT/AZ/WA/OR**, and the six-state list
  lives in exactly one module (`web/src/lib/plan/planning-region.ts`). Do not
  hardcode a state code anywhere else, and do not replace it with a bounding box.
- ~~The real gate is `cd web && npx next build`, exit 0. No tolerated errors.~~
  **CORRECTED 2026-07-31 — necessary but NOT sufficient.** `next build` does
  **not** type-check every file in the tsconfig scope; a real type error in
  `web/src/lib/plan/planning-region.test.ts` sat behind a green `next build`
  and would have failed CI `[measured 2026-07-31]`. **CI runs three separate
  jobs — `typecheck`, `test`, `build`.** Before pushing, run
  `npm run -w web typecheck` **as well as** `cd web && npx next build`. Note
  `data/` has its own gate that neither covers (`npm run -w data typecheck`).
- `data/.env` points at ONE project (TEST) and is NOT the whole picture. The
  corpus lives on PROD. Read `docs/DATA_INVENTORY.md` before drawing any
  conclusion about coverage or "what data exists."
- **A probe is only as trustworthy as the identity it ran under.** Before
  concluding anything from a client-side query, verify which role it actually
  authenticated as. See `docs/architecture/trip-resolution.md` §"The RLS drift
  that wasn't".
