# STATE — `main` · 2026-07-23

Position, not changelog. `git log` is the changelog. Overwrite in place at every
review gate; update in the SAME commit as the work. No SHAs — deliberately.

## LIVE ON PROD (what a user can do today)
- **Manual drag editing on user-owned trips.** `NEXT_PUBLIC_LIVING_PLAN_EDIT=1`
  set in Vercel Production. Verified by Adam on a real user trip. Once the flag
  split (IN FLIGHT) deploys, this flag gates manual editing ONLY.
- Reference slugs (`la-to-deadhorse`, `dawson-vancouver-cassiar`) never show the
  edit toggle — `canEdit = !isReference && isUserTrip(trip.id)`. Cassiar FROZEN.
- **"Change this trip" (NL editing) is still live on the SAME flag ON PROD** until
  the split deploys. Per-interaction Opus spend, no quota/rate-limit infra. The
  split that moves it behind its OWN dark flag `NEXT_PUBLIC_NL_EDIT` (unset = off,
  no dashboard action) is IN FLIGHT.
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
- **Flag split** — MERGED to main (#126); takes effect on the next Vercel deploy
  (Adam owns deploy), at which point NL goes dark and the LIVE ON PROD note above
  updates. Splits `NEXT_PUBLIC_LIVING_PLAN_EDIT` (which gated BOTH surfaces) so manual
  editing stays live and NL "Change this trip" goes behind a new
  `NEXT_PUBLIC_NL_EDIT` (unset = off, the prod end state — dark on deploy, no
  dashboard action). UI: manual `LIVING_PLAN_ON && canEdit`, NL
  `NL_EDIT_ON && canEdit`. Server: `checkRails` → `checkManualRails` /
  `checkNlRails` (frozen-id + TEST-ref guards unchanged on both). 12 rails unit
  tests + real-browser DOM verify on TEST (owner canEdit=true: Edit shows / NL
  hidden with only manual on; neither with both off). `next build` exit 0.
  **DO NOT set `NEXT_PUBLIC_NL_EDIT` in Vercel** — unset is the desired prod state.
- **Pinned ER fixture** — branch `feat/pinned-er-fixture`, PR #128 open. Replaces
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
1. **DATA_INVENTORY maintenance** — keep `docs/DATA_INVENTORY.md` re-measured and
   current. It is the source of truth for what data lives where.
2. **Search architecture (reframed)** — the corridor corpus already EXISTS on
   PROD (13,629, federated + working). The open question narrows to
   Google-primary vs corpus-first ranking/precedence and whether audit-resolved
   Google records write back — NOT whether to build the corpus.
3. **Dwell-day reorder** — Day 6 POIs live in the drive:droppable. Scope decision.

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
