# STATE — `main` · 2026-07-23

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
- Nothing. Working tree clean.

## NEXT (ordered)
1. **DATA_INVENTORY maintenance** — keep `docs/DATA_INVENTORY.md` re-measured and
   current. It is the source of truth for what data lives where.
2. **TEST Slice-1 rollback** — TEST carries ~8,653 unresolved OSM source_records
   + a leftover active `segment_a_la_pnw` corridor from an aborted Slice-1 run.
   Revert with `npm run -w data slice:rollback` against the STEP-0 snapshot.
3. **Search architecture (reframed)** — the corridor corpus already EXISTS on
   PROD (13,629, federated + working). The open question narrows to
   Google-primary vs corpus-first ranking/precedence and whether audit-resolved
   Google records write back — NOT whether to build the corpus.
4. **Flag split** — if NL editing should stay dark while manual stays live.
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
