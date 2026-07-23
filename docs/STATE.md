# Branch State — `main` (ADR §1 arc COMPLETE — manual editing LIVE on PROD)

```
HEAD/main:  f3d8f33 (this STATE-only commit) == origin/main, all deployed green.
Arc:        95c5c07 STEP2 → ede50c9 STEP3 → 964404d STEP4 → f3d8f33 (STATE).
Projects:   PROD nqzeywzcowujzyegxbsr · TEST znldzjdatkogdktymtvi. Never cross them.
Written:    2026-07-22
```

_Restart aid. Overwrite in place at every review gate — do not fork per session._

## LIVE ON PROD
- **Manual drag editing works on user-owned trips.** `NEXT_PUBLIC_LIVING_PLAN_EDIT=1`
  set in Vercel Production (non-sensitive; required for a NEXT_PUBLIC var to reach
  the client bundle). Verified working by Adam on a real user trip.
- Reference slugs (`la-to-deadhorse`, `dawson-vancouver-cassiar`) never show the
  toggle — `canEdit = !isReference && isUserTrip(trip.id)`. Cassiar stays FROZEN, untouched.
- **"Change this trip" (NL editing) came live with the SAME flag.** Per-interaction
  Opus spend, no quota/rate-limit infra. Splitting manual from NL = one env var,
  two UI sites, one checkRails fork. **WATCH THIS.**

## SHIPPED THIS ARC (main, all deployed green)
- Rank/sequence primitive: `insertRank`, `computeInsertIndex`, drag reorder,
  cross-node authoring, scoped ranks (`placeId → {nodeId, rank}`), read spine
  honoring ranks, 2px insertion indicator.
- `checkNotFrozen` extracted as a property guard on the waypoint actions —
  previously the frozen trip was protected only by a fixture-map miss.
- STEP 1: TEST parity seed (`seed-owner`/`seed-other`, RLS isolation proven).
- STEP 2: `version` column on `public.trips` + optimistic concurrency, REQUIRED
  per-call-site `onConflict` (retry/refuse/abandon); `resetUserTripDayToReference`
  folded onto the guarded helper.
- STEP 3: add/remove collapsed to ONE guarded write; `applyDayDerived` +
  `recomputeDayBestEffort` deleted (the only abandon-class caller).
- STEP 4: node-edit writes dispatch on `isUserTrip` — UUID → `public.trips` via
  RLS with inside-closure recompute; slug → `reference_trips` unchanged.
  Bake-at-write on the UUID path (public.trips serve does NOT re-derive corridors).
  Payload shape diverges by table BY DESIGN.

## INVARIANTS EARNED — do not violate
- A rank is meaningful only within a cluster. Key it to the node.
- Partial ranking is unrepresentable. Newcomers append, never demote.
- Display order is DOM order. Do not re-derive from miles.
- Phase guards (flag, TEST-ref) never on a shipped path. Property guards
  (`checkNotFrozen`) do.
- `retry` is correct ONLY if the mutate recomputes inside the closure. Applying a
  precomputed full-structure overlay is refuse-behavior mislabeled retry — it
  silently clobbers the winner.
- Schema before the code that reads it. Always.
- The real gate is `cd web && npx next build`, exit 0. No tolerated errors.

## OPEN — Adam owns, neither is code
- Require PRs into `main` (branch protection).
- Add `cd web && npx next build` to `ci.yml`. CI is PR-only today, so every
  fast-forward push to main skips it — that is how a red build reached production.

## NEXT WORK
- **Flag split**, if NL editing should stay dark while manual is live.
- **Dwell-day reorder** — Day 6 POIs live in the drive:droppable. Scope decision.
- **Search architecture** — June Google-primary vs July corpus-first unresolved;
  blocks discovery → cards → corpus, incl. whether audit-resolved Google Places
  records write back.
- **`saveStopsAction` is a KNOWN LOSSY PATH** on conflict (drops `avoidHighways`,
  redirects). Fix is `useActionState` on the stops page. (docs/BACKLOG.md)

## OPERATIONAL (restart aids)
- Tests: **node:test via tsx**, NOT vitest. `cd web && npx tsx --test <files>` per lib-dir.
- Concurrency/RLS verifies drive REAL fns under the seeded JWT (DI `client` seam):
  `verify-trip-version.ts` / `-collapse.ts` / `-step4.ts`.
- Dev verify: `preview_start` name `web` (port 3210, talks to TEST via
  `.env.development.local`); flag from `.env.local`. A UUID trip needs an authed
  session (RLS) — a slug renders anonymously.
