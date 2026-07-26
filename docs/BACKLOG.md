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
  **PARTIAL (2026-07-25):** the helper-script half now exists —
  `web/scripts/mint-dev-session.ts` (TEST-ref-guarded, prints the cookie JSON;
  used for the continuous-scroll authed verify, #146). CAVEAT it documents: this
  machine and the TEST auth server disagree by ~1h, so the printed session's
  `expires_at` must be patched to local-now before injecting or `@supabase/ssr`
  force-refreshes (and 401s once the refresh chain goes stale). The
  `/auth/dev-login` route remains the cleaner endgame.

- **SEED-ID PINS ARE INVISIBLE TO THE READ SPINE (view mode)** — surfaced during
  the #146 authed verify. **Pre-existing, NOT introduced by the continuous
  scroll — established by direct A/B on `main` vs the branch, same trip, same
  drag** (an earlier "proof" by running `applyPlaceOverrides` on raw stored state
  was BAD METHODOLOGY and is retracted: it tested the function, not what the
  component receives). Observed: on a FRESH SERVE both `main` and the branch
  render the pinned place under its ORIGINAL node — the durable behaviour is
  identical and wrong on both. (What DOES differ post-edit is recorded as its own
  item below.) A cross-node
  drag-pin in the edit spine mints a `nodeSeed` ("promoted") and writes
  `placeOverrides[].nodeId` as the **seed id** (`seed-<city>-<suffix>`), but the
  baked `Day.corridorCities` carry **plain slug ids** and the read spine
  (`DayDetailCorridor` / `applyPlaceOverrides`) never consumes `trip.nodeSeeds` —
  so the override dangles (inert per the documented semantics) and the pin
  renders in its ORIGINAL bucket in view mode, while the edit spine (seed-aware
  projection) shows it re-homed. Same-node rank writes use the plain cc id and
  DO render in view. Fix directions: teach the view spine to resolve seed ids
  (inject promoted seeds into the render spine, as the edit spine does), or bake
  seed nodes into `corridorCities` at write time. Touches verified bucketing
  code — needs its own pass, not a drive-by. **Scoped as its own PR** (Adam,
  2026-07-25): it cannot ride inside #146, whose tripwire forbids the read spine
  consuming `nodeSeeds`.
  **↔ DEPENDENCY (both ends):** landing this **dissolves** the post-edit
  divergence recorded below, because server truth and the optimistic list then
  agree. When it lands, **revert the continuous stack to server truth** —
  `placeOverrides={trip.placeOverrides}` / `ranks` from `trip.placeRanks` in
  `renderViewDay` (`day-detail-corridor-column.tsx`), which is the build spec's
  original rule and drops the optimistic coupling from the view path.

- **Seeded TEST password hardcoded in 4 tracked scripts of a PUBLIC repo —
  DECIDED: ACCEPT, DO NOT ROTATE (Adam, 2026-07-25).** Not an oversight; a
  considered accept. Do not re-litigate without new facts.

  **The credential:** `const PW = "…"` in `web/scripts/seed-test-user.ts`,
  `verify-trip-collapse.ts`, `verify-trip-step4.ts`, `verify-trip-version.ts`
  (both seeded users share it). Surfaced by the #146 hygiene sweep. Permanent in
  git history, so stripping HEAD would not undo the exposure — only rotation
  would.

  **Why accept — measured blast radius** (read from
  `supabase/migrations/20260513000000_init_identity.sql` + the Phase-1 corpus
  migration, not assumed):
  - `public.trips` — owner-scoped RLS, so **only that account's own trips**.
  - `public.users` — its own row only.
  - `public.reference_trips` — read only, and the policy is `using (true)`:
    **anon can already read it without any credential**, so the password adds
    nothing.
  - `public.master_place` / corpus — **nothing**. RLS enabled with *no policies*;
    service-role only.
  - PROD — **nothing**. Scoped to the TEST ref `znldzjdatkogdktymtvi`.

  TEST holds no real user data. Weighed against that: rotation costs four script
  edits plus a cascade-risky user update (below). Not worth it.

  **⚠️ CASCADE HAZARD — read this before ever rotating.** `trips.owner_id` is
  `references public.users(id) **on delete cascade**`. Rotating by
  delete-and-recreate the seeded users **destroys the seed harness trip AND the
  66-day TEST fork `05b346df-3bb5-4c46-8ff1-e0c5cfe26301`**. Any real rotation
  must add an `admin.auth.admin.updateUserById(id, { password })` path to
  `seed-test-user.ts` — its current existing-user branch only *looks the user up*
  and never updates the password — and switch all four scripts to
  `process.env.SEED_PASSWORD`. CI is unaffected either way (it runs the data
  suite + web typecheck + build; never the seed or verify scripts).

  **FORWARD RULE (binding on new code):** TEST seed credentials come from **env**,
  never committed literals. The four scripts above are **grandfathered**; new
  scripts are not. `web/scripts/mint-dev-session.ts` is the pattern to copy — it
  reads `SEED_PASSWORD` and refuses to run against a non-TEST project ref.

- **POST-EDIT VIEW DIVERGENCE — RESOLVED in #146 by passing the optimistic
  trip-level values; REVISIT when the seed-id fix above lands.** Recorded because
  the resolution is a deliberate spec deviation with a scheduled undo, not a
  finished story. Original divergence (measured A/B, same trip + same drag,
  editMode asserted by the toggle's own label):
  | | fresh serve | in edit, after drag | after Done (view) |
  |---|---|---|---|
  | `main` | original node | re-homed | **re-homed** |
  | #146 branch | original node | re-homed | **original node** |

  Cause: `main`'s view render passes the OPTIMISTIC `localOverrides`, which
  survive the editMode toggle because `DayDetailCorridorColumn` stays mounted;
  the windowed stack passes server-truth `trip.placeOverrides` per the build
  spec ("values cross the bridge, machinery does not" — optimistic machinery
  deferred to PR2). Where the two disagree is exactly the seed-id case above:
  the persisted override cannot resolve, so server truth renders the pre-pin
  position. **Neither is durable** — `main`'s re-homing is a transient illusion
  that also reverts on reload; the branch was arguably more honest but showed the
  revert one step earlier, which reads as "my edit was lost".

  **RESOLUTION (Adam, 2026-07-25): option (b)** — the stack passes the optimistic
  trip-level values (`localOverrides` / `ranksMap`), handlers still undefined.
  Reasoning: this PR is presentation-only, so matching `main` IS
  behaviour-neutrality; a pin that snaps back on Done makes the refactor
  blameable for a defect it did not cause, and `main`'s falseness is the
  pre-existing pin bug, already tracked above. Re-verified after the change —
  all three points match (`original` / `re-homed` / `re-homed` on both).
  **↔ UNDO CONDITION:** when the seed-id fix above lands, revert
  `renderViewDay` to `trip.placeOverrides` / `trip.placeRanks` (the build spec's
  original rule). This item closes at that point.

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

- **`enrich.ts` HONESTY PASS — the trip-waypoint detail panel still fabricates**
  (`web/src/lib/trips/enrich.ts`). The detail-honesty pass (#85) made the
  browse/search path into the slide-up panel honest — `browsePlaceToWaypoint`
  surfaces every field real or absent. The OTHER path into the SAME panel — a
  trip waypoint already added to a day, enriched via `enrichWaypoint` — was
  deliberately left untouched and still invents, per the "Guisados"-card
  comparison: the reliability score ("81 GOOD RELIABILITY / computed from 2
  sources" is `75 + hash(slug,…)` / `2 + hash(slug,…)`, not computed); the "IF
  YOU STOP HERE" stop time (heuristic 45m); a ~$15–25 entrée (canned per
  category via `ENTRY_BY_CATEGORY`); planned/with-stop ETAs and "arrive at St.
  George at 1:20 PM" (hardcoded/derived); "DAY 2 UNAFFECTED" (asserted); and
  Local Eats / Sit-down / Cash-OK tags + the DATA SOURCES trio (the slug-hashed
  `*_BY_CATEGORY` maps — which even list `iOverlander`, a banned source). This
  violates the grounding invariant (every field real or absent) on a surface
  users see, so it ranks HIGHER than its age suggests. **THE FORK — record
  both, do not pick:** (a) strip the fabrication so trip-waypoint cards match
  the honest browse cards — consistent and honest, but thinner; (b) keep the
  rich "if you stop here" impact layout and rebuild it on REAL routing data —
  real detour and arrival impact, now feasible with Mapbox routing (the same
  routing the directions panel uses). Under (b) the reliability score and canned
  tags would still need real backing or stay out.

- **FED-MERGE LIVE-PROVENANCE GAP — merged live rows lose their DATA SOURCES
  section** (`web/src/lib/trip-browse/merge-corpus.ts`). `mergeCorpusIntoPool`
  folds the federated corpus into a day's live-discovered pool via a coord+name
  `sameSpot` match; on a match CORPUS WINS and only `photoUrl`/`photoAlt` are
  backfilled from the live twin — NOT `mention.secondary`. When the winning
  corpus row (`mapMasterPlaceRow`) has null/empty `attribution`, its `secondary`
  is `""` (`federated.ts:176`), so `realDataSources` (`card-stats.ts:191`)
  returns `[]` and the panel's DATA SOURCES section is omitted entirely — even
  though the matched live row carried real provenance ("Google ·
  OpenStreetMap"). Honest (absent provenance → no section, not fabrication) but
  a real gap, and the most prod-visible of these: the corpus fold feeds
  `day.segmentSuggestions`. Fix: on a corpus-wins match, backfill `mention`
  (and/or `attribution`/`overlanderTags`) from the live twin the same way the
  photo already is. Note: the note that surfaced this filed it under
  `USE_FEDERATED_POIS`; the verified provenance-drop is in the
  `USE_FEDERATED_CORRIDOR` corpus fold (`plan/actions.ts:216-233`) — the
  browse-route `USE_FEDERATED_POIS` merge is purely additive
  (`[...liveTagged, ...federated]`) and does NOT drop live provenance.

- **GPS-ORIGIN LABEL on the no-GPS directions fallback**
  (`web/src/components/trip/directions-panel.tsx:126`). For a route-to-place
  search result (`dayRelative === false`), the route origin is
  `routeTo ? position ?? legStart : legStart` — with no GPS fix it silently
  falls back to the day-start (`legStart`), yet the panel presents a live "from
  now" arrival ETA (`:49`, `:230-233`) that frames the route as departing from
  the user's current position. Nothing labels the origin as the day-start
  rather than "here," so the no-GPS case (the common web-planning case — noted
  as such at `:195`) mislabels where the route starts. Small, cosmetic,
  honest-labelling issue. Fix: label the origin when it's the day-start fallback
  (i.e. when `position` is null), so the route/ETA don't imply a live-location
  departure that isn't happening.

- **Live-weather integration — RESCUABLE from PR #24 (salvage, not rebase).** OpenMeteo
  forecast + climatology fallback (`src/lib/weather/` + `src/lib/trips/resolve-weather.ts`)
  is a genuine unmerged feature: **ABSENT from main** — only the `Day.weather` placeholder
  field exists, not the live fetch. PR #24 sits ~400 commits behind; **do NOT rebase it**
  (it would fight 400 commits of drift). Rescue by SALVAGE: lift the weather lib and
  re-wire it into `DayBriefingCard` — its original hook `suggested-section.tsx` was
  deleted in the 2026-07-12 one-day-renderer refactor. Kept open as PR #24 with the same
  note; this entry is what keeps it from reading as a dead stale PR. (Triage 2026-07-24.)

- **Finish reference-fixture removal** (follow-up to the getTrip DB-first flip,
  branch `refactor/reference-trips-db-first`). The flip made reference trips
  serve from `reference_trips`; the `TRIPS` fixture no longer shadows the DB but
  the reference literals still sit in the module. To fully remove them: empty
  `seed()` of the reference literals, reroute `ensureAlaskaUpgraded`'s 4
  waypoint-helper callers (`repository.ts:94,108,120,181`, which read
  `TRIPS["la-to-deadhorse"]`) to the DB reader, then delete `ensureAlaskaUpgraded`,
  and drop `la-to-portland` from `FIXTURE_TRIPS` in
  `api/trip-browse/[tripId]/[dayId]/route.ts` (so it goes live/federated instead
  of the curated `BROWSE_PLACES` catalog — verify the browse path still resolves).
  **Open question that decides its size (investigate before scoping):** are those
  4 helpers pure lookups, or does any back a WRITE? A DB reader returns a fresh
  object, so rerouting a write path silently no-ops. **Likely wants to land with
  or after the remove-✕ affordance gating** — same in-memory write paths. Do NOT
  bundle on tired assumptions; every dig this session found another coupling.
  Note: `TRIPS` must SURVIVE this — it is also the anon-wizard store (below).
  **DOC:** this removes the "4 residual `ensureAlaskaUpgraded` reads" and the
  "literals still sit in `TRIPS`" claims — update
  `docs/architecture/trip-resolution.md` (§ `TRIPS`' current role) in the same PR.
- **`TRIPS` is the anon-wizard persistence layer** (not just reference fixtures).
  `createTrip` (`plan/actions.ts:786`, anon finalize, gated `ENABLE_PLANNER_WIZARD`)
  writes `trip-<8char>` drafts into the `globalThis`-pinned `TRIPS` store;
  `listAnonTrips` lists them (`id.startsWith("trip-")`); the repository slug-write
  paths edit them; `getTrip` resolves them (last, after the DB reference readers).
  Ephemeral — lost on server restart, never persisted to Supabase. Not part of the
  reference-trip migration; recorded so the next person doesn't mistake it for
  dead fixture code. Deleting the `TRIPS` module would remove this feature.
- **Plotting-on-map architecture (deep dive)** — an ARCHITECTURE REVIEW that
  intra-day map plotting waits on, NOT a feature ticket. Today the map plots only
  day start/end pins and user waypoints; day-detail items (corridor cities, curated
  picks) are never plotted. Before building intra-day plotting, the map's plotting
  architecture needs a dedicated design pass.
  - **Already measured (verified from source 2026-07-25 — carry forward, do not
    re-derive):**
    - Every PIN is a `mapboxgl.Marker` DOM instance in `map-column.tsx` — day-end
      pins (default color) plus waypoint pins built as hand-rolled category-colored
      DOM elements (`CAT_SVG` icon map). The route line is a GL layer (`map.on("load")`
      source+line); there is NO GeoJSON source+layer for POINTS anywhere.
    - Open call: DOM markers vs GeoJSON source + symbol/circle layer. Not settled.
      The argument is CHURN (markers created/destroyed per `?day=` transition), NOT
      raw volume.
    - Volume/day: corridor cities ~2–6 (`CorridorCity`, soft cap `max_nodes=4`
      intermediate per corridor-cities-spec); `Day.segmentSuggestions` capped at
      `MAX_SEGMENT_SUGGESTIONS` (`routing/day-suggestions.ts`); legacy `Day.suggestions`
      ~5–8. Fuel/camp/food are CATEGORY values (`category` on waypoints/picks), NOT
      distinct item kinds; fuel additionally lazy-fetches per day via
      `FuelStopCard` → `/api/trip-browse/{tripId}/{dayId}?category=fuel` and is NOT in
      the Trip payload.
    - Coordinates: `CorridorCity.coords` and `BrowsePlace.coords` are REQUIRED, real,
      sourced (gazetteer / corpus / Google). `Waypoint.coords` is OPTIONAL and the map
      already skips the coordless ones (`if (!wp.coords) continue`). `NodeSeed`
      "re-projection" computes an along-route MILE scalar from a real pin — it does NOT
      synthesize map coordinates. So there is no approximated-onto-route case; grounding
      holds by construction (omit, never approximate).
    - Test-data caveat: reference-derived trips populate `Day.suggestions` but NOT
      `Day.segmentSuggestions` (`placePool` in `day-detail-corridor-column.tsx`), so the
      66-day fork likely shows ~5–8 items/day. A regenerated trip is needed to exercise
      the `MAX_SEGMENT_SUGGESTIONS` cap.
  - **Questions the deep dive must answer:**
    - DOM markers vs GL source+layer, and what the migration costs if it changes.
    - WHICH day's items are plotted. Prior lean was CENTERED-DAY-ONLY driven by the
      `?day=` param — the same channel that drives `flyTo` — so the map never learns the
      scroll window. Confirm or revisit, but preserve the constraint that the map does
      NOT know which days are mounted.
    - Marker ↔ detail-list highlight linkage. A design was described to this session
      as living in `OVERLANDER_STYLE_GUIDE.md` (per-type marker colors + an Active POI
      State, 22px → 35px, double-ring glow) — but NO such file exists in the repo, and
      that spec text is in NO tracked file (verified 2026-07-25). What DOES exist:
      `DESIGN.md` carries the marker tokens (`--pin`/`--marker`/`--pin-border`) and the
      per-category color roles the current DOM markers already use — but no Active-POI-
      State / marker-highlight spec. The deep dive's FIRST step is to locate the real
      source (likely a Paper artboard, where this project's designs live) before treating
      the 22px→35px/double-ring detail as settled.
    - Interaction with the continuous-scroll settle-debounce (the scroll→`?day=` sync in
      the Design-A continuous day-detail scroll).

- **DEFINE "yoTrippin Verified" — what it means and what earns it.** Needs a
  **product decision before it can be scoped.** The label currently on place
  cards is a **PLACEHOLDER**: it presents Google Places data under a yoTrippin
  name. That is a deliberate interim choice, **not a bug**. What is missing is a
  definition — what does yoTrippin actually verify, and what earns the badge?
  - **Current mechanical state** `[verified this session — see
    docs/architecture/place-render-model.md §5]`: the `verified` prop **defaults
    to `true`**; **no call site on the day-detail card surface passes it**; **no
    `verified` field exists** in `BrowsePlace`, `Waypoint`, or `CorridorPlace`;
    therefore **no code path can set it false**. Distribution: **0 true / 0 false
    / 100% undefined in data; 100% true at render.**
  - **The concrete defect, independent of how the definition lands.** Because the
    gate never closes, the label renders on tiles carrying NO Google data at all:
    - **Klondike River** — no `placeId` field whatsoever; a corpus tile whose row
      has no `google_place_id`, so it can never enrich.
    - **Fixture waypoints** — the displayed rating is a stored constant, not a
      fetched value.
    So even under the "Google Places renamed" reading, the label is applied to
    things that are not that. True regardless of what "Verified" ends up meaning.
  - **Open question — the parameters.** Candidate inputs, **none decided**:
    source tier (corpus-materialized `mp:` vs live-resolved `google:` vs
    LLM-suggested); presence of required fields vs inferred/defaulted ones;
    coordinate confirmation against a second source; freshness / last-checked
    date of the underlying record; human ground-truthing — someone has actually
    been there.
  - **Binding design constraint.** "Verified" is a provenance assertion, and the
    project rule is **every field real or absent**. Whatever the definition,
    **it must be capable of being false** — otherwise the badge carries no
    information and is decoration wearing the costume of a claim.
  - **Known dependency.** There is currently **no field in the tile types to hang
    this on**. Any real definition likely requires a **new field on the tile
    schema** — which per prior decisions sits at the grammar ceiling and needs
    deliberate planning, not casual addition. Scope this only **after** the
    definition exists.

- **Empty-pool trip on PROD — is it user-reachable?** Two PROD `public.trips`
  rows share the title "Tok, AK to Dawson, YT":
  `24f14ecc-a209-45e7-a414-16ecc816bab0` is populated (63 tiles, 2 days) and
  `81865432-7a18-4f18-beaa-d6d95e6da249` has an **EMPTY pool** (0 tiles).
  `[queried PROD, 2026-07-26]` Open question: **is that row user-reachable, and
  if so what does it render?** Nobody has looked. Not investigated — recorded.
  When picked up: **read-only; PROD writes are not authorized.** Row facts live
  in `docs/DATA_INVENTORY.md`.

- **TEST fork vs PROD `segmentSuggestions` discrepancy — the fork may not
  represent the shape it stands in for.** TEST fork `05b346df…` carries **0**
  `segmentSuggestions` (its pool is 43 `day.suggestions` + 92 `waypoints`), while
  the PROD equivalent carries **63**. **Reason UNVERIFIED.** Consequence: the
  TEST fork may not represent the reference-derived shape *as actually served on
  PROD*, which affects its value as a test instrument — see the instrument
  caveat in `CLAUDE.md` §RUNBOOK gotchas and
  `docs/architecture/place-render-model.md` §2.

- **PLACES ENRICHMENT: EMPTY vs MISSING IS INDISTINGUISHABLE — LARGELY RESOLVED
  BY [#149](https://github.com/honkinsickle/overlander/pull/149) (merged
  2026-07-26).** Status first so this stops reading as open: the route now emits
  resolved-but-empty `{}` instead of dropping it (`if (rich)`), which **closes
  the retry leak described below** on both paths and gives the client a
  distinguishable signal. Google's not-found shape was verified in the process
  (invalid id → HTTP 400 → `null`), so failures remain separable. Mechanics and
  the accepted trade now live in
  `docs/architecture/place-render-model.md` §4.3. **Still open from this item:**
  the UX copy decision (next item), and the retry-ceasing leg is `[UNVERIFIED]`
  by observation. The body below is retained as the original analysis.
  The original
  premise was **WRONG** and is corrected here. *(No prior BACKLOG item existed to
  replace — the diagnostic was only ever referenced in session prompts and in
  `place-render-model.md` §7.)*
  - **Original premise (RETRACTED).** An earlier session found day-2 of
    `expedition-ms28y793` returning **0 of 3** from `/api/places/details` while
    day-13 returned 3 of 3, and inferred a population of dead or never-verified
    `placeId`s.
  - **What measurement found** `[swept 2026-07-26, both trips, 2 batched calls]`:
    - `expedition-ms28y793` (TEST): **43 of 44** id-bearing tiles resolved
      (97.7%); 4 tiles carry no `placeId`.
    - `24f14ecc-a209-45e7-a414-16ecc816bab0` (PROD): **60 of 60** (100%); 3 tiles
      carry no `placeId`.
    - **Day-2's three ids ALL RESOLVED on re-measurement.** The earlier 0/3 was
      **TRANSIENT**. Cause **UNVERIFIED**.
    - **No cluster, no scatter** — one failure across 104 id-bearing tiles is an
      absence of the phenomenon, not a distribution.
    - **No differential** between the corpus path (`mp:`) and the live-resolution
      path (`google:`). Nothing localizes to one path.
  - **Why a transient blip looked permanent.** On FAILURE `placeDetails` returns
    `null` and the route calls `cacheSet(id, null)`, cached **15 minutes**
    (`CACHE_TTL_MS`). One momentary upstream error is replayed as failure for the
    rest of that window. `[read source: app/api/places/details/route.ts:20,84-86]`
    Worth remembering as a general property of this endpoint.
  - **SETTLED — empty results ARE cached, as `{}`.** `placeDetails` returns an
    object built entirely of conditional spreads, so a 200 with no rich fields
    yields **`{}`, not `null`** (`google-places.ts:333-347`). The route then runs
    `if (!cached) cacheSet(id, rich)` — unconditional on the *value*, and
    `cacheSet(id, value: PlaceRich | null)` accepts either — so `{}` is stored
    under the same 15-minute TTL. A subsequent request inside the window hits
    `cacheGet`, re-drops it from `details`, and **does not call Google**.
    `[read source: app/api/places/details/route.ts:35-53, 84-89]`
  - **The actual finding — a MEASUREMENT defect, not a data defect.** The single
    failure, `ChIJJeKtgR9ySYcRa30K1fgPrTw` ("Chimney Rock", day-10, `curated`,
    `google:` prefix), is a **REAL LIVE PLACE**. Queried Google directly: HTTP
    200, id matches exactly, coordinates match the stored tile exactly,
    `displayName` "Chimney Rock". It carries no `rating`, no `userRatingCount`,
    no `photos`, no `priceLevel`, no hours, and `types: ["route"]` maps to no
    category. So `placeDetails` builds `{}` and the route drops it via
    `if (rich && Object.keys(rich).length > 0)`. **Therefore the endpoint reports
    "this id is dead" and "this place exists and has nothing to add" IDENTICALLY
    — both as a missing key.** Neither ordinary staleness nor a grounding
    violation: a third thing nobody had named.
  - **Why it matters disproportionately for this product.** Field-poor places —
    routes, natural features, trailheads, river access, dispersed sites — are
    exactly what an overlanding product drives past. Google has nothing to say
    about them and never will. The ambiguous case is not an edge case here; it is
    a substantial share of the corpus.
  - **THE THREE STATES** (the basis for any UI decision):
    1. **No `placeId` at all** — can never enrich, correctly. TEST's 4 are `mp:`
       corpus rows with `mention.secondary` `"osm"`; PROD's 3 are water features.
       **Klondike River** is the canonical example.
    2. **Resolves, nothing to add** — **Chimney Rock**. Real place, empty response.
    3. **Genuinely fails** — measured at effectively zero.

    States 1 and 2 are **honest thinness**. Only 3 warrants error treatment, and
    it barely occurs. An "Offline / Limited Data" indicator would have fired
    wrongly nearly every time.
  - **~~LIVE BUG~~ — retry leak (client-side only; billing is capped). FIXED by
    #149** — kept for the analysis; the guard behaviour described here is what
    the fix exploits. Failures
    never enter the client cache: `setHydrated` merges only RETURNED keys, so a
    failed id leaves `hydrated[id]` `undefined`. The guard is
    `t.placeId && !t.photoUrl && !hydrated[t.placeId]`, so the id **re-fires on
    every mounted-set change, indefinitely**.
    `[read source: day-detail-corridor-column.tsx:306-345]`
    - **CLIENT-SIDE: real regardless.** The browser issues a POST containing
      those ids on every windowing change — network, battery and latency cost on
      a device used in the field.
    - **BILLING: capped, NOT recurring-billable.** Because `{}` and `null` are
      both cached (above), the server absorbs the retries: at most **one upstream
      Google call per id per 15-minute TTL window, per server instance**. Caveat:
      the cache is in-process (`globalThis.__placeDetailsCache`, LRU
      `CACHE_MAX_ENTRIES = 1000`), so cold starts and evictions re-fetch — the cap
      is per instance per window, not a global guarantee.
    - **Scope.** `hydrated` is React state on the parent column, **ephemeral per
      session**, persisted nowhere — so there is nothing to clean up
      retroactively and a reload clears it. That is also why this **recurs rather
      than accumulates**.
  - **Nothing distinguishes "not yet fetched" from "fetched and returned
    nothing"** — both are `hydrated[id] === undefined`. No negative cache, no
    error state, and per `place-render-model.md` Part 2 no loading or error state
    in the slideup either.
  - **~~Proposed fix (NOT authorized here — separate PR)~~ — SHIPPED as #149**,
    in the minimal form: the endpoint stops dropping `{}`. The "stop
    re-requesting for a long interval" half was deliberately NOT taken — TTL was
    left at 15 minutes because the client-side repeat was the actual cost and
    this removes it (reasoning in the #149 PR description). Original text: Have the endpoint
    distinguish resolved-but-empty from not-found, and let the client stop
    re-requesting the former for a long interval — **not permanently**: a
    dispersed site or small business can gain a Google listing later, and a
    permanent cache would leave the app silently wrong with nothing to flag it.
    Kills the retry leak, caps the spend, gives the UI an honest signal.

- **UX: honest copy for thin places (supersedes any "Offline / Limited Data"
  framing).** No such entry previously existed; recorded now because the
  three-state taxonomy above changes what the question even is. The distinction
  is **not connectivity** — it is whether Google has anything to say about the
  place. For states 1 and 2 (no `placeId`; resolves-but-empty) the honest copy is
  something like *"Google has no listing for this place"* rather than a blank
  slot or an "Offline" indicator that misattributes the cause. For state 3
  (genuine failure, measured at effectively zero) show **no indicator** — it is
  too rare to design around and indistinguishable from state 2 until the endpoint
  separates them (see the proposed fix above). Depends on that fix landing first.

- **`MAX_IDS = 40` truncation does not self-heal — dense trips can render
  partially thin until the user scrolls.** `parsePlaceIds` dedupes then
  `.slice(0, 40)` with **no error and no signal**, and the hydration effect
  **re-fires only on mounted-set change, never when `hydrated` updates** — its
  dep array is `[hydrateKey]` and `hydrated` is deliberately excluded with an
  `eslint-disable` `[read source: app/api/places/details/route.ts:19,55-63;
  day-detail-corridor-column.tsx:283-291, 340-343]`. So ids past the 40th are
  dropped and **wait** for the next mounted-set change rather than converging in
  place. Reachable on the corpus-dense shape: `24f14ecc…` carries 41 tiles on
  day-1 alone, so a ~3-day window can exceed 40 unhydrated ids in one pass.
  Recorded during the #149 doc pass, **not fixed** — no measurement of how often
  a real window actually exceeds the cap `[UNVERIFIED]`. Mechanics:
  `docs/architecture/place-render-model.md` §4.4.

_(add items here as they surface; keep one line each, promote to STATE.md
§Queued when scheduled)_
