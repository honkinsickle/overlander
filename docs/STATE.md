# Branch State — `feat/manual-trip-edit`

```
Branch:      feat/manual-trip-edit   (manual drag-to-edit: pin / unpin / reorder POIs)
HEAD:        5d9945b   <- sha this file was written against; the review-gate commit
                          that ADDS this file also carries the Hop B code (curated
                          placement + read spine) — so actual HEAD sits one commit
                          ahead of 5d9945b carrying code+docs. That is THIS gate,
                          not a discrepancy (CLAUDE.md §SESSION START step 3).
Written:     2026-07-22
DB baseline: clean — TEST copy dawson-cassiar-livingplan-test, placeRanks {}
             as of restore@2026-07-22. No verification fixtures injected.
Sibling:     feat/living-plan-editing (last commit c3611d8) holds the SEPARATE
             LLM/NL trip-editing work — do NOT conflate with this branch.
```

_Session-restart aid. Overwrite in place at every "stop for review" gate — do not fork per session._

Base: `origin/main` (merge-base `1859cff`).

## Committed (recent arc — POI sequencing, "Option B")
The live thread is drag-to-order POIs within/between node clusters via durable fractional ranks:
- `(this gate)` — READ SPINE HONORS `placeRanks` (was Queued #1). Two hops, both via the ONE shared rule `sortClusterByRank(scopeRankKey(cities, ranks))`. `cb6e1bc` extracted `scopeRankKey` + exported `sortClusterByRank` (edit spine now calls it; output unchanged). `5d9945b` Hop A: read-spine pool cluster sorts by rank (unit-verified only — every TEST-trip target is curated, so this path never renders live). This commit Hop B: `classifyCuratedPicks` is rank-aware — an authored node-scoped rank (not just an override) groups a curated pick under its node, ordered by the same cluster rule (pinned-keystop treatment: sorted at node mile, true mile shown). Verified live: drag Ksan to top → read spine + hard-nav `/trip/[id]` both show `Ksan · Gitwangak · Seven Sisters` (rank order, not mile 130/134/158), survives refresh; baseline restored. NOTE: this changed Fix #1's multi-pick override-only ordering from mile → cluster/append order (single-override case unchanged) — required for read/edit agreement; see BACKLOG (insert-by-mile) to retire the append quirk.
- `2ba79cb` — THE ROOT FIX: `placeRanks` is node-scoped `Record<placeId, {nodeId, rank}>`. A rank counts only in its authored cluster; a foreign/stale rank surviving into another cluster is inert → appended (never mis-sorts). Separate `rankKey` (cluster) / `orderKey` (near→far stretch) maps + scale-guard assert. Append newcomer policy (never demote). Carry-forward carries+guards `placeRanks`. Verified live on TEST: write path persists `{nodeId, rank}` with the TARGET nodeId (survives refresh); read path treats a Stewart-scoped `-99` on Seven Sisters as inert (appended last, authored order preserved). Baseline since restored (`restore@2026-07-21T22:28Z`, `placeRanks {}`).
- `69c323f` — cross-node drop authors position atomically (attachment + rank land in ONE `pinPlaceAction` write; no partially-ranked cluster reachable on disk).
- `d70c8e8` — same-node reorder wired end to end (`localRanks` optimistic overlay; ref-registry via `useCallback`).
- `5585d56` — `computeInsertIndex`: pure pointer-vs-rect drop index (Option 2, no dnd-kit SortableContext).
- `cebeceb` — `insertRank`: pure fractional-rank core. `262da89` — round-trip days order near→far, not reversed-spur mile.
- `6ecd725` — Phase 1: drag POI between nodes to pin/unpin (optimistic + persisted).

Earlier landed on this branch: node-stack model (`3d654c8`→render), living-plan productionization + partial re-plan, corridor northern gazetteer.

## In-flight (uncommitted working tree)
None — the read-spine gate (Hop A `5d9945b`, Hop B this commit) is landing with this STATE.md update. Tree clean afterward except an unrelated `CLAUDE.md` edit (session-start protocol; not this arc's).

## Queued
1. Dwell-day reorder (Day 6 out-and-back POIs) — needs a scope decision (spur-distance axis vs. reorder-in-drive vs. leave near→far). Read spine has NO near→far (edit-only); Day 6 keeps mile order until this lands.
2. Save Changes + confirmation modal — day-reorder is local-only (discarded on refresh); pins/ranks persist immediately. Specced, not built.
3. `applyPlaceOverrides` insert-by-mile (see BACKLOG) — makes "server order" == mile order everywhere, retiring the append quirk the read-spine gate flagged.

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
- Typecheck (the reliable gate): `npm run typecheck` in `web/`. One PRE-EXISTING error in `scripts/verify-bell2-seed.ts` (`SeedResolution.find`) is tolerated; product `src/` is clean.
- Live-verify the slideup: dev server via `preview_start` name `web` (port 3210); dev talks to TEST because `.env.development.local` (znldz) overrides `.env.local`, and the edit flag `NEXT_PUBLIC_LIVING_PLAN_EDIT=1` comes from `.env.local`. Soft-nav only: `/demo/livingplan` → click "Open the TEST copy" → select day → "Edit". Synthetic dnd needs pointerdown+moves and pointerup in SEPARATE js calls (rAF gap), target mid-viewport (top edge auto-scrolls). Hard-reload `/trip/[id]?day=day-N` = surface #2 fresh server read.
