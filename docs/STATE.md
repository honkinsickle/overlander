# Branch State — `main` (STEP 2 LIVE on PROD; STEP 3 committed, unpushed)

```
Branch:      main   (both feature arcs merged in; working branch is now main)
HEAD/main:   STEP 3 (two-write collapse) — local main is 1 commit AHEAD of
                          origin/main (`95c5c07` STEP-2-live, the STATE.md commit
                          `2bcf1bb` above it). STEP 3 is TEST-only, UNPUSHED; Adam
                          authorizes the push. STATE.md is written against
                          `2bcf1bb`; the STEP 3 commit carrying it sits one above.
                          History: e51e8be → d56840d (checkNotFrozen rail) →
                          3e909da (STEP 1) → 95c5c07 (STEP 2, on PROD) → 2bcf1bb
                          (STATE: STEP 2 live) → THIS commit (STEP 3).
Merged in:   feat/living-plan-editing (tip c3611d8, 20 commits, LLM/NL trip-edit)
             + feat/manual-trip-edit (42-commit manual-edit arc on top). manual
             DESCENDS from living-plan (merge-base c3611d8), so both went in as
             two clean fast-forwards; both branches are fully contained in main.
Deploy:      GREEN — 95c5c07 (STEP 2) deployed to PRODUCTION successfully
             (2026-07-22, Vercel status "success"). ORDER MATTERED: the STEP 2
             migration (trips.version) was applied to PROD FIRST — pre-flight
             confirmed it the SOLE pending migration; column landed integer NOT
             NULL default 0 with all 9 rows backfilled to 0 — THEN the code was
             pushed, so the concurrency code finds the column it expects. Prior
             green: e51e8be. Sole historical failure: d68cd1c (a `next build` TS
             error tolerated by typecheck; see LESSON under Gotchas).
Written:     2026-07-22
DB baseline: clean — TEST copy dawson-cassiar-livingplan-test, placeRanks {}
             as of restore@2026-07-22T20:24Z. No verification fixtures injected.
             RULE: navigate the browser OFF the edited day (close the tab) BEFORE
             restoring baseline, then re-read — an open Day-N edit view holds
             optimistic localRanks and any interaction re-persists them (writes
             tag `node-edit@`, vs a restore's `restore@`), silently undoing the
             restore. This was the "ranks reappeared after I cleared them" anomaly.
             STEP 1 seeded a SEPARATE TEST trip (seed-owner@overlander.test) for the
             RLS write-path harness — untouched by this baseline. The STEP 2 verify
             script leaves `conflict-*` waypoints on THAT trip (idempotently stripped
             on its next run); does not touch dawson-cassiar-livingplan-test.
```

_Session-restart aid. Overwrite in place at every "stop for review" gate — do not fork per session._

Base: `origin/main` (merge-base `1859cff`).

## PROD REALITY (found 2026-07-22 — contradicts how this arc was reasoned about)
The manual-drag / living-plan arc is TEST-gated, but the app AROUND it is not pre-prod. Do NOT assume "everything is TEST-gated, nothing can affect prod":
- **Auth is live** — Google OAuth (`signInWithGoogle` → `signInWithOAuth`, `app/auth/actions.ts`). Anyone can sign in; `createTrip` (`repository.ts:326`) inserts into `public.trips`.
- **`public.trips` on PROD (nqzey) has 9 rows** — real user data exists (count-only read, 2026-07-22).
- **Waypoint add/remove on USER trips is LIVE and NOT flag-gated.** Reachable via the browse/find-nearby "add to day" toggle (`trip:toggleAdded` → `addWaypointAction`, `day-detail-corridor-column.tsx:436`) and the inline read-spine ✕ (`removeWaypointAction`); both persist to `public.trips` under RLS. This is a SHIPPED feature, distinct from the TEST-gated `node-actions`/`edit-actions`.
- **Guard kinds matter:** PHASE guards (flag, TEST-ref in `checkRails`) belong ONLY on the pre-prod living-plan path — they disappear at ADR §1. Shipped paths get the PROPERTY guard only (`checkNotFrozen`). The frozen PROD trip `dawson-vancouver-cassiar` was protected only by accident (a `TRIPS[slug]` fixture-miss in `repository.ts:184`) until this session added the `checkNotFrozen` rail to the waypoint actions.

## Committed (recent arc — POI sequencing, "Option B")
The live thread is drag-to-order POIs within/between node clusters via durable fractional ranks:
- `(this gate)` — STEP 3, INSERTION INDICATOR (`day-detail-node-blocks`). A 2px amber line shows where a drop will land — needed because on iPad the finger covers the card. Computed in `onDragMove` (NOT `onDragOver` — that fires only on droppable CHANGE, so it can't track between cards in one cluster) via the SAME `computeInsertAt`/`computeInsertIndex` the drop path uses; held as `{clusterId, insertIndex} | null`, cleared on end+cancel; rendered as a zero-height absolutely-positioned line (no layout shift); NODE clusters only (drive/unpin is attachment, not sequence). KEY CORRECTION found by instrumenting the drop: the dragged midpoint MUST be `active.rect.current.translated` (viewport coords), NOT `initial + delta` — dnd-kit's `delta` folds in container auto-scroll, so `initial+delta` diverges from the on-screen position under mid-drag scroll (5-drop audit: 1/5 disagreed, by one slot; `translated` matched the on-screen landing every time). Both `onDragMove` and `onDragEnd` feed `translated` → one derivation, line == drop. Verified live: same-node line tracks + drop lands at the indicated slot; cross-node line appears in the target and tracks (over=`smithers-bc`, line 677→597). Cross-node DROP-lands-at-slot not reproducible via synthetic events (dnd-kit `pointerWithin` non-deterministic across cluster boundaries) — Adam verifies that by hand.
- `f2f07ae` / `5d9945b` / `cb6e1bc` — READ SPINE HONORS `placeRanks` (was Queued #1). Two hops via the ONE shared rule `sortClusterByRank(scopeRankKey(cities, ranks))`. `cb6e1bc` extracted `scopeRankKey` + exported `sortClusterByRank` (edit spine calls it; output unchanged). `5d9945b` Hop A: read-spine pool cluster sorts by rank (unit-verified only — every TEST-trip target is curated, so this path never renders live). `f2f07ae` Hop B: `classifyCuratedPicks` is rank-aware — an authored node-scoped rank (not just an override) groups a curated pick under its node, ordered by the same cluster rule (pinned-keystop treatment: sorted at node mile, true mile shown). Verified live: read spine + hard-nav `/trip/[id]` show `Ksan · Gitwangak · Seven Sisters` (rank order, not mile 130/134/158). NOTE: changed Fix #1's multi-pick override-only ordering from mile → cluster/append order (single-override case unchanged) — required for read/edit agreement; see BACKLOG (insert-by-mile).
- `2ba79cb` — THE ROOT FIX: `placeRanks` is node-scoped `Record<placeId, {nodeId, rank}>`. A rank counts only in its authored cluster; a foreign/stale rank surviving into another cluster is inert → appended (never mis-sorts). Separate `rankKey` (cluster) / `orderKey` (near→far stretch) maps + scale-guard assert. Append newcomer policy (never demote). Carry-forward carries+guards `placeRanks`. Verified live on TEST: write path persists `{nodeId, rank}` with the TARGET nodeId (survives refresh); read path treats a Stewart-scoped `-99` on Seven Sisters as inert (appended last, authored order preserved). Baseline since restored (`restore@2026-07-21T22:28Z`, `placeRanks {}`).
- `69c323f` — cross-node drop authors position atomically (attachment + rank land in ONE `pinPlaceAction` write; no partially-ranked cluster reachable on disk).
- `d70c8e8` — same-node reorder wired end to end (`localRanks` optimistic overlay; ref-registry via `useCallback`).
- `5585d56` — `computeInsertIndex`: pure pointer-vs-rect drop index (Option 2, no dnd-kit SortableContext).
- `cebeceb` — `insertRank`: pure fractional-rank core. `262da89` — round-trip days order near→far, not reversed-spur mile.
- `6ecd725` — Phase 1: drag POI between nodes to pin/unpin (optimistic + persisted).

Earlier landed on this branch: node-stack model (`3d654c8`→render), living-plan productionization + partial re-plan, corridor northern gazetteer.

## ADR §1 migration arc (make manual-edit live — the version-column groundwork)
Sequence toward flipping `NEXT_PUBLIC_LIVING_PLAN_EDIT` live and dispatching user-trip writes through the SSR/RLS path. See the handoff for STEP 3/4 detail.
- `d56840d` — **checkNotFrozen rail** on the SHIPPED waypoint add/remove actions (property guard; the frozen PROD trip was previously protected only by a fixture-miss accident).
- `3e909da` — **STEP 1: seed-test-user** RLS harness. `scripts/seed-test-user.ts`, TEST-ref-guarded, idempotent. Proves RLS isolation (owner vs other) on the write path off-prod. Seeds owner+other trips under `seed-owner@ / seed-other@overlander.test`.
- `95c5c07` — **STEP 2: optimistic concurrency on `trips.payload`. LIVE on PROD.** Adds `trips.version` (migration `20260722120000`, applied to TEST **and PROD** — column integer NOT NULL default 0, 9 PROD rows backfilled to 0; applied to PROD BEFORE the code push). `updateUserTripPayload` now reads `version`, writes `.eq("version", v)` with `version: v+1`, 0 rows = conflict; a REQUIRED `onConflict` policy per mutator: `retry` (by-id composes), `refuse` (absolute-set / index — returns `TRIP_CONFLICT`, surfaced as `TRIP_CHANGED_ERROR`), `abandon` (best-effort derived). DI `client` seam so verify drives the REAL fn under the seeded JWT. Fixed the swallowed-conflict defect: 3 `FormState` wizard actions truthiness-checked a now-truthy `TRIP_CONFLICT` and advanced having lost the write. Deleted dead index-based `reorderWaypoints`/`reorderWaypointsAction` (a class-(b) refuse path with no consumer) rather than converting. Verify: `next build` exit 0; 149 corridor+trips tests pass; STEP 2 verify script 5/5 under the seeded JWT.
- `(this commit)` — **STEP 3: collapse the two-write add/remove path. TEST-only, UNPUSHED.** `recomputeDay` now runs ONCE before a SINGLE guarded write: `addWaypoint`/`removeWaypoint` persist the waypoint AND its derived (miles/driveHours/corridorCities) together in one version bump (no torn intermediate a concurrent edit can straddle). A Mapbox failure skips derived and still persists the waypoint atomically. Deleted `applyDayDerived` + `recomputeDayBestEffort` — the ONLY abandon-class caller; onConflict census after: `retry×6 refuse×6 abandon×0` (abandon machinery retained — designed policy, STEP 2 verify exercises it). add/remove stay `retry`. New `verify-trip-collapse.ts` drives the real collapsed path under the seeded JWT (Mapbox leaf stubbed): 3/3 pass; `next build` exit 0; 149 tests. This hardens the already-SHIPPED waypoint add/remove path — it is NOT the edit button.
- KEY FINDING (STEP 4 scope): the edit-button **drag-reorder** slice writes `placeRanks` via `node-actions` and does NOT call `recomputeDay` / touch `day.waypoints` — it never enters STEP 3's add/remove/recompute path. So STEP 4's minimal slice depends on **STEP 2's envelope**, NOT STEP 3. STEP 3 and the STEP-4 edit-button slice are parallel consumers of STEP 2, not a dependency chain.
- NEXT: STEP 4 (ADR §1 dispatch on `isUserTripId`) — NOT STARTED. Concentrated in `node-actions.ts`: dispatch `persist()`/read on UUID→`updateUserTripPayload` (RLS) vs slug→`reference_trips` (service), swap `checkRails` phase guards for authenticated + owns-via-RLS + editable + `checkNotFrozen`(slug), classify each `placeRanks`/`nodeSeeds` write's onConflict, then flip `NEXT_PUBLIC_LIVING_PLAN_EDIT` in Vercel (Adam-owned). Moderate, single-file-dominant, smaller than STEP 2.

## In-flight (uncommitted working tree)
None. STEP 3 (this commit) lands on `2bcf1bb`; TEST-only, unpushed — Adam authorizes the push. STEP 2 (`95c5c07`) is on origin/main and live on PROD.

## Queued
1. Dwell-day reorder (Day 6 out-and-back POIs) — needs a scope decision (spur-distance axis vs. reorder-in-drive vs. leave near→far). Read spine has NO near→far (edit-only); Day 6 keeps mile order until this lands.
2. Save Changes + confirmation modal — day-reorder is local-only (discarded on refresh); pins/ranks persist immediately. Specced, not built.
3. `applyPlaceOverrides` insert-by-mile (see BACKLOG) — makes "server order" == mile order everywhere, retiring the append quirk the read-spine gate flagged.

## Open — Adam-owned (repo/CI settings, not code)
Two settings would have caught the `d68cd1c` prod failure before it shipped; both are Adam's to make:
1. **Require PRs into `main`** (branch protection) — a fast-forward PUSH to main currently bypasses CI entirely (see the LESSON under Gotchas).
2. **Add `cd web && npx next build` to `ci.yml`** — CI today runs only `tsc`-based typecheck + data tests; `next build` is what Vercel actually runs and is a strict superset.

## Parked
dnd-kit `SortableContext` — deferred; pointer-vs-rect (`computeInsertIndex`) chosen instead, no model change.

## Invariants this branch established
- User overlays (`nodeSeeds`, `placeOverrides`, `placeRanks`) are placeId-keyed, survive regeneration, and carry forward together; regeneration dropping an overlay fails LOUD (`58ce737`).
- Attachment + order persist atomically — a partially-ranked cluster is unreachable on disk, not merely unlikely.
- `placeRanks` is node-scoped: rank read only when `nodeId` == current cluster; foreign/stale ranks ignored. `scopeRankKey` (lib/corridor/stretches) is the ONE scoping fn; both spines call it.
- ONE ordering rule: `sortClusterByRank(ids, rankKey)` — ranked-by-rank first, unranked appended in server (`placeIds`) order; none ranked → server order verbatim. Never demote a ranked cluster to mile order. The edit spine, the read-spine pool cluster (Hop A), and the read-spine curated group (Hop B, via `classifyCuratedPicks`) all call it — no reimplementation, so surfaces can't drift. Caveat: "server order" is mile order for auto-bucketed picks but PIN (append) order for overrides (`applyPlaceOverrides` appends) — see BACKLOG.
- `rankKey` (fractional ranks) and `orderKey` (near→far miles) are different units — must NEVER both cover a cluster member; `assignPlacesToStretches` throws if they do. The read spine has no near→far (edit-only), so no scale-mix risk there yet.
- Reference trips serve DB-first; snapshot is fallback — data edits need a reseed to appear, even locally.
- Dev targets TEST copy `dawson-cassiar-livingplan-test`; PROD `dawson-vancouver-cassiar` frozen until after the drive (~7/26).

## Gotchas
- Tests: the real runner is **`node:test` via tsx**, NOT vitest (there is no committed vitest config; a bare `npx vitest run` fails at the `@/` alias). Run: `cd web && npx tsx --test <files>`. Current suite = **263 tests, all passing** (32 files). Earlier "193/193" and "207" figures came from tooling not in the tree — ignore them. Quirk: a single all-32-files invocation aborts before printing the summary; run per lib-dir (`corridor`+`trips` = 144, `itinerary` = 93, `discovery`+`routing` = 15, `corridor/data`+`components/trip` = 11) and sum.
- THE BUILD GATE IS `cd web && npx next build`, exit 0, NO EXCEPTIONS. `npm run typecheck` (`tsc --noEmit`) is a subset — same tsconfig, but `next build` also enforces RSC/`'use client'` boundaries, route types, bundling, static-gen. There are NO tolerated errors; a non-zero exit is a red gate, full stop.
- LESSON (the `d68cd1c` prod failure): a real TS error in `scripts/verify-bell2-seed.ts` reached `main` because (1) a red `npm run typecheck` was accepted as "cosmetic — just a script, src/ clean", AND (2) `ci.yml` is `pull_request`-only, so the fast-forward PUSH to main skipped it. **The check existed and never ran.** Don't tolerate a red gate; don't reach main by a path CI doesn't cover (see Open — Adam-owned). That script had also printed `absent` unconditionally since it was written (same bug); the fix matches `SeedResolution.seedId` and it now resolves correctly — day-5, mile 243, seedId == nodeSeed id.
- Live-verify the slideup: dev server via `preview_start` name `web` (port 3210); dev talks to TEST because `.env.development.local` (znldz) overrides `.env.local`, and the edit flag `NEXT_PUBLIC_LIVING_PLAN_EDIT=1` comes from `.env.local`. Soft-nav only: `/demo/livingplan` → click "Open the TEST copy" → select day → "Edit". Hard-reload `/trip/[id]?day=day-N` = surface #2 fresh server read.
- Synthetic dnd (hard-won): pointerdown+threshold, then moves, then pointerup each in SEPARATE js calls (rAF gap) — pointerup in the same call as moves → `onDragEnd` never fires. Keep the drag target mid-viewport: the top/bottom edges trigger dnd-kit auto-scroll, which shifts the layout AND (critically) inflates `delta`. `active.rect.current.translated` is the on-screen truth for the dragged midpoint; `initial+delta` diverges under scroll — use translated. `read_console`/`__drag()` read in the SAME call as the dispatch is stale (async) — read state in a separate call. `over` is non-deterministic across cluster boundaries with synthetic events (cross-node drop can't be forced) — verify cross-node by hand. Escape cancels the drag AND closes the slideup.
