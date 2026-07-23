# STATE — `main` · 2026-07-22

Position, not changelog. `git log` is the changelog. Overwrite in place at every
review gate; update in the SAME commit as the work. No SHAs — deliberately.

## LIVE ON PROD (what a user can do today)
- **Manual drag editing on user-owned trips.** `NEXT_PUBLIC_LIVING_PLAN_EDIT=1`
  set in Vercel Production. Verified by Adam on a real user trip.
- Reference slugs (`la-to-deadhorse`, `dawson-vancouver-cassiar`) never show the
  edit toggle — `canEdit = !isReference && isUserTrip(trip.id)`. Cassiar FROZEN.
- **"Change this trip" (NL editing) is live on the SAME flag.** Per-interaction
  Opus spend, no quota/rate-limit infra. Manual vs NL split = one env var, two UI
  sites, one checkRails fork. **WATCH THIS.**

## IN FLIGHT
- **Build gate in CI** — PR `ci/add-build-gate` adds a `build` job running
  `cd web && npx next build` to `ci.yml`. Clean build needs no env/secrets
  (verified: every `.env*` absent → exit 0). Awaiting Adam's merge. Branch
  protection (require PRs into `main`) is still Adam-owned, not yet set.

## NEXT (ordered)
1. **Branch protection** (Adam-owned, not code). Require PRs into `main` so the
   new build gate can't be bypassed. CI is PR-only today, so fast-forward pushes
   to main skip it — that is how a red build reached PROD.
2. **Flag split** — if NL editing should stay dark while manual stays live.
3. **Search architecture** — June Google-primary vs July corpus-first unresolved;
   blocks discovery → cards → corpus (incl. whether audit-resolved Google Places
   records write back).
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
