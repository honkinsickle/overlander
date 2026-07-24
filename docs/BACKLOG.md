# Backlog — open work

Durable and deferred work. This is the long list; the **active cut** — what is
queued or in-flight right now — lives in `docs/STATE.md` (§Queued, §In-flight)
and is authoritative for the current branch. When an item here becomes the next
thing worked, it moves into STATE.md §Queued.

## Deferred / parked
- **dnd-kit `SortableContext`** — parked. Pointer-vs-rect (`computeInsertIndex`)
  was chosen instead, no model change. Revisit only if pointer-vs-rect proves
  insufficient. (See STATE.md §Parked.)

## Someday / unscheduled
- **`reorderWaypoints` was dead — deleted in STEP 2; id-based only if a consumer
  returns.** The index-based `reorderWaypoints` (repo) + `reorderWaypointsAction`
  pair had NO consumer (live drag-reorder goes through `node-actions`/`localRanks`
  fractional `placeRanks`, not waypoint-index splice). Both were deleted rather
  than converted, removing a conflict-class (b) `refuse` path entirely instead of
  fixing it. IF a waypoint-reorder consumer is ever added: implement it id-based
  ("move waypoint X before waypoint Y"), NEVER index-based — position-splice
  corrupts against any changed list (a stale client view reorders the wrong pair),
  and id-based lands in class (a) so its write can `retry`/compose. Same lesson as
  `placeRanks` being keyed by placeId, not position.
- **Wizard form-actions can't surface `TRIP_CONFLICT`** — the four void
  `writeWizardSlice` callers in `plan/actions.ts` (`addStopAction`,
  `removeStopAction`, `saveStopsAction`, `toggleSuggestionAction`) are consumed as
  `<form action={…}>` server actions returning `void`, so a `refuse` conflict has
  no return channel. `addStop`/`removeStop`/`toggleSuggestion` stay on-page and the
  trailing `revalidatePath` re-reads fresh state, so a dropped edit shows as absent
  and the user retries.
- **KNOWN LOSSY PATH — `saveStopsAction` silently drops the `avoidHighways`
  toggle on a `refuse` conflict.** Unlike its stay-on-page siblings, it `redirect`s
  to the loader after the write, so a conflict advances the wizard having dropped
  the toggle with no signal. Do NOT call this benign: it only looks harmless at
  today's 9 single-owner trips — exactly the light-usage reasoning the `version`
  column exists to stop relying on. Fix: convert the stops page to `useActionState`
  so the `refuse` conflict has a return channel and surfaces `TRIP_CHANGED_ERROR`
  (same treatment the three `FormState` wizard steps already got).
- **Reference trips render a remove ✕ that always fails** — the read spine shows
  the ✕ on waypoint tiles for reference trips too, but `removeWaypointAction` on a
  slug hits the in-memory `TRIPS` fixture (`repository.ts:184`), misses a DB-only
  reference trip, and returns *"Could not remove stop."* A visible control that
  cannot work. Reference trips are read-only templates (fork-to-edit), so the ✕
  should not render on them. Fix: pass `isReference` from `trip-slideup-body.tsx`
  into `DayDetailCorridorColumn` (`:337` currently omits it) and gate the remove
  control on `!isReference`. (Separate from the frozen-trip *server* guard, which
  is now `checkNotFrozen`.)
- **`applyPlaceOverrides`: insert by mile, not append** — today a re-homed place is
  appended to its node's `placeIds` (`bucket.ts:112-122`), so "server order" is mile
  order for auto-bucketed picks but pin order for overridden ones. That makes an
  unranked cluster's display order depend on pin sequence. Inserting the override at
  its along-route mile instead would make server order == mile order everywhere, so
  unranked display order stops depending on how you pinned. Touches verified
  attachment code (`bucketPlacesIntoCorridor`/`applyPlaceOverrides`) — needs the
  Phase-1 bucketing re-verification, not a drive-by.

- **`CATEGORY_COMPATIBILITY` has no keys for `restaurant`, `grocery`,
  `car_repair`** (`data/entity-resolution/matcher.ts:162-201`). With the
  google_resolved category fix landed, food/grocery resolutions now carry a
  correct *stored* `primary_category`, but `lookupCompatibility` returns 0 for
  those categories, so they can never `name_dominant`/auto-link and accumulate
  as isolated `master_place` rows (one per resolution, no dedup). Given how much
  itinerary content is food, extending the matrix (add restaurant/grocery/
  car_repair rows + cross-compat to any OSM/pipeline equivalents) is worth
  scoping. Not in the google_resolved-category PR.

- **`materialize`'s final Typesense-sync stage fails (DNS `ENOTFOUND`) from a
  network-restricted context** — the DB stages (entity resolution + promotion)
  run and commit FIRST, then the last stage syncs `*.typesense.net`. From a
  sandboxed/egress-restricted environment that host doesn't resolve, so the run
  exits non-zero AFTER the corpus writes have landed: `master_place` is updated
  but the search index is NOT. Net effect — a `materialize` run from a
  restricted context leaves **Typesense stale** (DB and index diverge) while
  reporting failure. Mitigations today: run `materialize` from a machine that
  can reach `*.typesense.net`, or run `npm run -w data search:sync` separately
  afterward to reconcile the index. Worth scoping: make the sync stage a
  distinct, separately-resumable step (or a preflight reachability check) so a
  DB-successful run isn't reported as a total failure and the index gap is
  explicit. Surfaced 2026-07-23 during the google_resolved end-to-end proof.

- **No dev sign-in path — verifying any authed browser surface needs a hand-minted
  cookie every time.** The UI offers Google OAuth only, and TEST has no Google
  provider configured, so exercising a `canEdit`/RLS surface in a real browser means
  minting a Supabase SSR session server-side and injecting the cookie by hand — a
  throwaway script each session (done again during the NL flag-split verify, PR #126).
  Options: a dev-only `/auth/dev-login` route, or a committed helper script that mints
  and prints the cookie. The route is cleaner. Its guard MUST be the TEST-ref check
  (the same `ref !== znldzjdatkogdktymtvi` gate `checkRails` uses), NOT a flag — so it
  is structurally incapable of existing in prod, flag misconfiguration notwithstanding.

- **`find_master_place_candidates` is not exercised end-to-end by the ER corpus
  run** — the phase3a D4 `beforeAll` calls `reset_phase3a_test_state`, leaving
  `master_place` empty, so `matchAll` runs in `skipRpcs` rematerialize mode
  (`matcher.ts` — RPC skipped, candidates come from in-memory
  `plannedMasterPlaces`). The populated-`master_place` PostGIS candidate lookup
  is therefore covered only by `matcher.test.ts` mocks and the 3b synthetic
  `recompute` (a different RPC), never by a real populated-corpus `matchAll`.
  **Pre-existing** — true of the old prod-derived seed too, NOT introduced by the
  pinned-fixture change (docs/decisions/2026-07-23-pinned-er-fixture.md). Worth a
  dedicated test that seeds a small resolved corpus (non-empty `master_place`)
  and runs an incremental `matchAll(delta)` so the RPC path runs for real.

_(add items here as they surface; keep one line each, promote to STATE.md
§Queued when scheduled)_
