<!-- Append-only session log. Newest entry at top. Never edit past entries.
     One "## YYYY-MM-DD" per session. 3-8 bullets: what happened, what was
     found, what was decided, what was learned that git log won't show.
     Include corrections and dead ends. Link PRs and decision docs. -->

# LOG — append-only session diary

What happened, in order. The running narrative the other docs deliberately
don't keep: STATE.md overwrites, `git log` records commits not findings,
`docs/decisions/` holds single choices.

## 2026-07-24
- **`rescopeOverlays` landed (#130)** — a pure keep/drop core for overlays
  across a day change: given the user's trip-level `placeRanks`/`placeOverrides`
  and a NEW day layout, drop overlays whose stop no longer has a valid home,
  keep the rest, never rewrite a `nodeId`. nodeIds are name/coords-based (not
  day-index), so a day insert/remove/reorder doesn't invalidate one by index.
  Function + 8 tests, no wiring.
- **Cross-day stop movement resolved toward a curated-POI (overlay) move.** The
  finding that settled the fork: a curated POI is a `Day.segmentSuggestions`
  OVERLAY entry, not a routed `Day.waypoints` point — moving or removing one
  changes NO drive geometry (routing runs only over waypoints). So the move is a
  geometry-free array splice + `rescopeOverlays` to drop the now-orphaned
  pin/rank. In progress on `feat/curated-poi-kebab` (`curated-place.ts` + test,
  `curated-kebab.tsx`; uncommitted), built on #130.
- **Started this LOG** (`docs/LOG.md`) + a WRITE-DISCIPLINE rule to append an
  entry each session. Format lives in the file's own header so it can't drift.
- Correction/gap: the WIP `curated-place.ts` cites
  `docs/architecture/itinerary-model.md`, which does not exist yet — a dangling
  reference; that doc still needs writing.

## 2026-07-23
- **Corpus outage root-caused and fixed — the corpus was on PROD all along.**
  `/api/search-area` had silently returned nothing because the **2026-06-01 prod
  Supabase service-role key rotation never reached Vercel**; hydrate failed with
  `master_place read failed: Invalid API key` from June 1 until the fix today
  (Vercel key updated + redeploy). PROD's full 13,629-place LA→Deadhorse corpus
  (Typesense `places_prod`) was intact the whole time — the earlier framing that
  the corpus still needed building was wrong. (`docs/DATA_INVENTORY.md`)
- **Second, independent fault: the shared Typesense `places` collection.** Prod
  and test shared one cluster AND one collection; `search:sync`'s prune pass
  deletes every doc whose id isn't in the syncing env's `master_place`, and the
  two envs' uuid id-sets are disjoint — so each env's sync clobbered the other's
  docs, taking the federated half fully down (`failedSources: ["corpus"]`), not
  merely returning fewer results. Fixed with **one collection per environment**
  (`places_prod` / `places_test`), name read from env with NO default (fails
  loud), orphan `places` deleted. (#120, #123;
  `docs/decisions/2026-07-23-typesense-collection-per-env.md`)
- **The tools that made these silent faults findable:** `failedSources` (#119)
  distinguishes a down source from a genuine no-match, and a `?debug=1` /
  `SEARCH_DEBUG_ERRORS=1` gate (#121) surfaces the per-source error text (off by
  default so internal DB error strings never leak).
- **`credential-drift` check** (`npm run -w data drift:check`, #124) — probes
  deployed prod + every stored service key by SHA-10 fingerprint. It is the
  check that would have caught 2026-06-01: every local/backup key was valid the
  whole time; only Vercel's runtime key was stale, so a local file scan couldn't
  have found it.
- **Flag split (#126):** `NEXT_PUBLIC_LIVING_PLAN_EDIT` gated BOTH manual drag
  editing and NL "Change this trip"; split so manual stays live and NL goes
  behind its own dark flag `NEXT_PUBLIC_NL_EDIT` (unset = off — do NOT set it in
  Vercel). Takes effect on the next deploy.
- **`DATA_INVENTORY.md` written as the measured source of truth** for what data
  lives where (PROD/TEST/Typesense/backups) + STATE refresh (#122); pinned ER
  fixture replacing the copy-prod-into-test seed (#128).
