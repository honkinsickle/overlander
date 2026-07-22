# Branch State — `feat/manual-trip-edit`

```
Branch:      feat/manual-trip-edit
HEAD:        51e8268          <- the sha this file was written against
Written:     2026-07-22
DB baseline: clean — TEST copy dawson-cassiar-livingplan-test, placeRanks {}
             as of restore@2026-07-21T22:28Z. No verification fixtures injected.
```

_Session-restart aid. Overwrite in place at every "stop for review" gate — do not fork per session._

Base: `origin/main` (merge-base `1859cff`).

## Committed (recent arc — POI sequencing, "Option B")
The live thread is drag-to-order POIs within/between node clusters via durable fractional ranks:
- `2ba79cb` — THE ROOT FIX: `placeRanks` is node-scoped `Record<placeId, {nodeId, rank}>`. A rank counts only in its authored cluster; a foreign/stale rank surviving into another cluster is inert → appended (never mis-sorts). Separate `rankKey` (cluster) / `orderKey` (near→far stretch) maps + scale-guard assert. Append newcomer policy (never demote). Carry-forward carries+guards `placeRanks`. Verified live on TEST: write path persists `{nodeId, rank}` with the TARGET nodeId (survives refresh); read path treats a Stewart-scoped `-99` on Seven Sisters as inert (appended last, authored order preserved). Baseline since restored (`restore@2026-07-21T22:28Z`, `placeRanks {}`).
- `69c323f` — cross-node drop authors position atomically (attachment + rank land in ONE `pinPlaceAction` write; no partially-ranked cluster reachable on disk).
- `d70c8e8` — same-node reorder wired end to end (`localRanks` optimistic overlay; ref-registry via `useCallback`).
- `5585d56` — `computeInsertIndex`: pure pointer-vs-rect drop index (Option 2, no dnd-kit SortableContext).
- `cebeceb` — `insertRank`: pure fractional-rank core. `262da89` — round-trip days order near→far, not reversed-spur mile.
- `6ecd725` — Phase 1: drag POI between nodes to pin/unpin (optimistic + persisted).

Earlier landed on this branch: node-stack model (`3d654c8`→render), living-plan productionization + partial re-plan, corridor northern gazetteer.

## In-flight (uncommitted working tree)
Never-cold-start scaffolding lands as the review-gate commit ONE above the `HEAD` recorded in the header block (`51e8268`): the CLAUDE.md SESSION-START/STANDING-RULES/WRITE-DISCIPLINE/POINTERS block, this header block, `docs/decisions/README.md`, and `docs/BACKLOG.md`. No code touched. Expect a clean tree with actual HEAD exactly one commit ahead of `51e8268` — that is the healthy state per CLAUDE.md §SESSION START step 3, not a discrepancy.

## Queued
1. **Read spine honors `placeRanks` (APPROVED, planning).** Authored order shows in the EDIT spine only; the read spine (`DayDetailCorridor` non-edit), iPad, and share still mile-order it — same edit/read divergence Fix #1 (`6ecd725`) closed for overrides. Put the scoped-rank sort in a shared `lib/corridor` fn every surface calls; edit-path output must stay byte-identical.
2. Dwell-day reorder (Day 6 out-and-back POIs) — needs a scope decision (spur-distance axis vs. reorder-in-drive vs. leave near→far).
3. Save Changes + confirmation modal — day-reorder is local-only (discarded on refresh); pins/ranks persist immediately. Specced, not built.

## Parked
dnd-kit `SortableContext` — deferred; pointer-vs-rect (`computeInsertIndex`) chosen instead, no model change.

## Invariants this branch established
- User overlays (`nodeSeeds`, `placeOverrides`, `placeRanks`) are placeId-keyed, survive regeneration, and carry forward together; regeneration dropping an overlay fails LOUD (`58ce737`).
- Attachment + order persist atomically — a partially-ranked cluster is unreachable on disk, not merely unlikely.
- `placeRanks` is node-scoped (in-flight): rank read only when `nodeId` == current cluster; foreign/stale ranks ignored.
- `rankKey` (fractional ranks) and `orderKey` (near→far miles) are different units — must NEVER both cover a cluster member; `assignPlacesToStretches` throws if they do.
- Cluster order: ≥1 ranked member → ranked-by-rank first, unranked appended in server order; none ranked → server order verbatim. Never demote a ranked cluster to mile order.
- Reference trips serve DB-first; snapshot is fallback — data edits need a reseed to appear, even locally.
- Dev targets TEST copy `dawson-cassiar-livingplan-test`; PROD `dawson-vancouver-cassiar` frozen until after the drive (~7/26).

## Gotchas
- Tests: `web/` has NO committed vitest config and `vite-tsconfig-paths` isn't installed, so a bare `npx vitest run` fails on every file at the `@/` alias. Commit messages' "193/193 pass" used tooling not in the tree — reproduce test runs before trusting them here.
- Typecheck (the reliable gate): `npm run typecheck` in `web/`. One PRE-EXISTING error in `scripts/verify-bell2-seed.ts` (`SeedResolution.find`) is tolerated; product `src/` is clean.
