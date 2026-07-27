<!-- Append-only session log. Newest entry at top. One "## YYYY-MM-DD" per
     session; today's entry may gain bullets as the session continues, but
     entries for prior dates are never edited or reordered. 3-8 bullets:
     what happened, what was found, what was decided, what was learned that
     git log won't show. Include corrections and dead ends — a later entry
     corrects an earlier one, the earlier one is not rewritten. Link PRs and
     decision docs. -->

# LOG — append-only session diary

What happened, in order. The running narrative the other docs deliberately
don't keep: STATE.md overwrites, `git log` records commits not findings,
`docs/decisions/` holds single choices.

## 2026-07-26

- **Generation (the WRITE path) traced end to end for the first time
  ([#151](https://github.com/honkinsickle/overlander/pull/151), open).** New
  `docs/architecture/generation-pipeline.md` rather than a third section of
  `place-render-model.md` — that doc is scoped to the READ path and generation
  shares almost no code with it. Cross-linked both ways; trip-shape facts stay
  in `itinerary-model.md` §7, not duplicated. Read-only: no trip generated, no
  LLM called, no failure induced, nothing written.
- **`day.weather` is a fabricated field in user-visible UI.** It is a `required`
  property of the LLM's output `json_schema`, the prompt payload carries no
  weather input, `auditItinerary` spreads it through untouched, and an
  exhaustive sweep found **no weather or climate source anywhere in the repo**
  (source, 3 × package.json, 15 × .env*, 38 migrations, every external hostname
  literal, every local dataset). It renders under a WEATHER heading carrying
  specific Fahrenheit ranges — observed in-browser on TEST: *"Arrive · Hot
  desert, 95–105°F"*. The schema docstring, the prompt, and the `FactConfidence`
  union all call weather "advisory", but that tag is only ever attached to
  `distanceConfidence` — nothing marks weather advisory in the payload or the UI.
  Parked in `docs/BACKLOG.md`.
- **The temp pill is a DIFFERENT origin, and is dead code.** Nobody had checked
  whether the two shared a source; they don't. `weatherHiF`/`weatherLoF` are
  hardcoded `70`/`45` literals in `itineraryToTrip` — identical on every
  generated trip regardless of route, season, or latitude — but the only
  component that renders the pill, `TripDetailHeader`, has **no call site**
  (superseded by `DayDetailOverview`). Confirmed in-browser: no hi/lo pill on
  any live surface. So the handoff's premise that a pill "appears in the
  day-detail header" did not survive checking.
- **Generation never asks Google for rating/photo/price/hours.** `RESOLVE_FIELD_MASK`
  (searchText, by name) and the render-time `DETAILS_FIELD_MASK` (details, by id)
  are both server-fixed constants but disjoint in exactly those fields. That is
  the *upstream* cause of essentials-only tiles — not a stripping step later, as
  the shape record alone might suggest.
- **Corpus fold ∪ tier-2 is a true union with no cross-source dedup.** Precedence
  lives one stage earlier as the audit's pool-first grounding. Consequence in
  stored data: day 6 of `expedition-ms28y793` persists the same `placeId` twice
  (endpoint-resolved + keyStop-resolved), and that id appears twice in a node's
  `placeIds` — the "renders twice" failure mode `node-identity.ts` documents as
  its intended-safe outcome, occurring for real.
- **Nothing about the audit survives persistence.** `AuditReport` and per-day
  `DayAudit` are both transient, so a dropped key stop leaves **no trace in the
  payload at all** (`SILENT_FLAG_KINDS` also hides it from `notes`). Six
  generated `ItineraryOutput` sections (`routeSummary`, `phases`, `variants`,
  `permits`, `borders`, `anchorsHonored`) are generated, paid for, and dropped.
- **Audit failure is advisory, not blocking** — after `REGEN_BUDGET = 2` the trip
  persists with structural violations and a soft note. The largest silent
  degradation found: a missing `GOOGLE_PLACES_API_KEY` makes every tier-2 name
  drop while the action still returns `ok: true` (44 of 48 tiles on the
  instrument came from tier-2).
- **The day-mile fix was built, measured, and PARKED — the measurement is why.**
  Branch `fix/generated-day-miles` (pushed, unmerged, no PR). Rebuilding all
  three per-day lines with `routeBetween` on `expedition-ms28y793`: direct
  **899 mi**, corrected (keyStop vias only) **1,960 mi**, old (all resolved
  vias) **2,019 mi**. So filtering vias to `where === "keyStop"` removes
  **~6%** of the inflation, not most of it — day 6 is the only day it
  materially changes. The dominant term is key-stop vias being genuine
  off-route excursions threaded in LLM emission order. A backfill would have
  written miles measured against a still-2.18×-inflated line, so it was not
  run and nothing was written.
- **The map was never affected — checked because it would have changed the
  priority of everything.** `routePolyline` is the audit's DIRECT geometry;
  `BakedDay` has no polyline field and the re-routed line is a discarded local.
  Stored polyline measures 899 mi, matching direct exactly. The zigzag is
  transient.
- **Two separate defects fell out and are now in BACKLOG.** (a) `routePolyline`
  omits ~25% of the trip — 899 mi drawn vs 1,200 mi claimed, because
  `isOutAndBack` never routes a start==end day (6 of 15 days, 300 mi). This one
  IS visible on the map. (b) 30/48 tiles belong to no node; re-bucketing on a
  corrected line only reaches 17/48, because `maxAttachMi = 25` against node
  gaps up to 148 mi, and round-trip days derive both nodes at mile 0. The
  remaining 17 are structural — no mile fix reaches them. The 63% figure had
  sat in a baseline for two sessions unexamined.
- **The read path already does it right.** `positionPlacesOnDay` projects onto
  the correct 899-mi polyline with a round-trip-aware offset. Three consumers
  use it and are correct; four trust stored miles and are wrong. Pointing the
  four at what the three do needs **no write** and fixes existing trips — an
  option that was never priced, now recorded rather than skipped by default.
- **No PROD trip is affected** — zero stored miles anywhere on PROD, including
  the FROZEN `dawson-vancouver-cassiar` (417 tiles, 0 miles). The frozen-trip
  risk that shaped the earlier scoping does not exist.
- **Three unmeasured claims of mine were caught this session, all the same
  shape** — stating a magnitude without computing it: "A3/A4 will pass" (they
  failed, and A4 failing is the zigzag's own signature, which my own report had
  already measured two sections earlier); "A6 will flip after the bake fix" (it
  reads stored data, so it cannot); "residual inflation is much smaller" (it is
  2.18× vs 2.25×). Recorded because the pattern, not any one instance, is the
  thing to watch.
- **Recorded fragments checked against source.** Four verified correct (bake.ts
  union + uncapped, the 30-cap's real owner, the corpus mapper's
  `placeId`/`source`, `resolvedToTile`'s `google:` prefix). Two corrections: the
  recorded pipeline omits `attachHeroPhotos` (a network call that mutates the
  payload before persist) and `enqueueResolvedPlaces` (after persist); and the
  tier-2 cap is **not** `RESOLVE_CAP = 15` — the audit constructs
  `PlaceResolver(Math.max(80, days * 8))` = 120 for a 15-day trip.

## 2026-07-25

- **Reference trips now serve DB-first — the fixture no longer shadows the DB
  ([#143](https://github.com/honkinsickle/overlander/pull/143), open).** Fixed the
  docs-say-DB-first / code-was-fixture-first contradiction. Phase 1: migrated
  `la-to-portland` (a demo trip that lived only in the in-code fixture) into
  `reference_trips` as a raw pre-derivation payload via an idempotent script,
  seeded on TEST **and PROD**. Phase 3: `getTrip` is DB-first + reader-aware —
  `la-to-deadhorse` keeps `getReferenceTrip` (snapshot fallback + memo, so the
  live PROD trip doesn't regress); other reference slugs use
  `getPersistedReferenceTrip`; anon trips resolve last.
- **The find that stopped Phase 4: `TRIPS` has TWO roles.** Beyond the reference
  fixtures it is the LIVE anon-wizard trip store (`createTrip` at
  `plan/actions.ts:786`, `listAnonTrips`, the slug-write paths). Deleting the
  module would break the anon wizard — so fixture *deletion* was deferred to
  backlog, not executed as the spec literally said. Ship Phase 1+3; residual
  state documented in the PR.
- **(e) proof discharged before touching anything deletable** — the DB payload
  for la-to-deadhorse is baked and carries every `LA_TO_DEADHORSE_RAW` day
  override (heroImage/label), 0 mismatches on TEST and PROD. `getReferenceTrip`
  and `getPersistedReferenceTrip` apply the identical `withCorridors(fold(...))`
  pipeline, so the reader-aware split adds zero derivation divergence.
- **PROD write, proven not asserted:** reference_trips 2 → 3 rows (exactly one
  added), `dawson-vancouver-cassiar` payload sha256 `46a17cbb421208f7` byte-
  unchanged before/after (frozen trip untouched), la-to-portland deep-equals the
  fixture literal.
- **Corrections caught by reading source (not assumed):** (1) "la-to-portland
  leaves the anon /trips list" is FALSE — `listAnonTrips` filters
  `id.startsWith("trip-")`, so reference fixtures were never in that list. (2)
  `ensureAlaskaUpgraded` has 4 *other* callers (waypoint helpers) besides
  getTrip — deleting it is not a one-liner; backlogged with the removal.
- **Federated fold on la-to-portland (TEST): runs but adds 0 tiles** — the TEST
  corpus footprint (LA→Deadhorse corridor) doesn't overlap the LA→Portland route.
  Convergence is structural (same pipeline now); visible payoff is corpus-
  coverage-dependent. Accepted trade-offs: fold-as-convergence, 404-on-DB-failure.
- **Design-A continuous day-scroll: scoped hard, then put on hold.** A full
  read-only scoping + self-falsification pass ran (windowing primitive =
  IntersectionObserver, map stays one shared instance, hydration re-key,
  scroll↔`?day=` settle-debounce with max-wait, dead-zone hysteresis). Not built
  — the fixture-shadow cleanup preempted it. No code; findings live in the
  session transcript for when it resumes.
- **#143 and #144 both merged.** (Corrects the "open" on the first bullet —
  append-only, so noted here rather than rewritten.)
- **Process lesson — a doc commit pushed AFTER the merge was in flight got
  orphaned.** `trip-resolution.md` was committed one commit *after* #143's merge
  point, so it never landed on `main`; merging #143 auto-deleted the branch, and
  the later push *re-created* it as a stray branch stranding the doc there.
  Recovered via #144 (cherry-picked the doc onto a fresh branch + synced STATE's
  now-stale "OPEN" → "MERGED"). Takeaway: once a PR is merging, don't push more
  commits to its branch — open a follow-up.
- **Doc placement corrected to the taxonomy (#144 + the session doc-pass).**
  Premise-checked first (no existing architecture doc overlaps
  `trip-resolution.md`, so it earns its own file). Then split single-homed: the
  `reference_trips` RLS + per-DB row inventory → `DATA_INVENTORY.md`; the three
  payload shapes → `itinerary-model.md` §7 (where the scroll work gets bitten);
  cross-linked all three both ways; recorded the bidirectional dependency so the
  fixture-removal backlog item knows it must update `trip-resolution.md`.
- **Cleanup:** landed the long-floating "plotting-on-map architecture" BACKLOG
  edit (stashed across the whole migration) as #145; deleted the merged
  `docs/trip-resolution-and-state-sync` and the stray
  `refactor/reference-trips-db-first` branches (local + remote).
- **Tooling:** installed the Superpowers plugin (`superpowers@claude-plugins-official`
  v5.1.0, user scope). The CLI install was blocked by the permission classifier;
  ran from the terminal instead. Plugin skills load at session start, so it's
  active next session, not this one.
- **Built the continuous day-detail scroll (Design A, view mode) —
  [#146](https://github.com/honkinsickle/overlander/pull/146).** The day-detail
  center is now a continuous river of days when NOT editing, not a one-at-a-time
  swap. New `ContinuousDayStack` IO-windows the near-viewport days; scroll writes
  `?day=` settle-debounced (140ms) with a 400ms max-wait; the one shared map
  follows on settle (settle-only `?day=` write ⇒ settle-only flyTo, for free).
  Hysteresis (±15% vp) + measured-height cache make unmount height-neutral.
  Re-verified the handoff's `[RECHECK]` claims against `main` first (all held).
  **Falsification catch that shaped it:** `placeOverrides`/`ranks` drive pin +
  cluster order in VIEW mode (no editMode guard), so every mounted day gets
  server-truth values while the optimistic drag machinery stays out —
  "values cross the bridge, machinery does not." `editMode` + Overview keep the
  VERBATIM single-day swap (the bridge; PR2 deletes it). Presentation-only fence
  held (zero model-file diff). Verified in the slideup on `la-to-deadhorse` (66d)
  + `yotrippin-demo` (19d): windowing, cached-height no-jump, rail-click
  programmatic guard, Overview flush-guard (the guard stops the unmount flush from
  resurrecting a day when you leave to Overview — a bug I hit and fixed).
  Edit-mode + saved-pins-in-view were NOT exercised end-to-end (needs an authed
  UUID trip / a trip carrying overrides) — verbatim render + server-truth wiring
  cover them by construction. Decision:
  `docs/decisions/2026-07-25-continuous-day-detail-scroll.md`; §4 of
  `docs/architecture/itinerary-model.md` updated.
- **#146 review round: the "by construction" shortcut above was called, correctly.**
  Review demanded the authed verifications. Ran them on a fresh editable 66-day
  TEST fork (`05b346df…`, forked in-app as seed-owner; the handoff's `762577ca…`
  fork is PROD — substituted, flagged). Results: edit-mode bridge PASS (mid-scroll
  toggle lands the swap on the centered day, not the stale `?day=`); freeze PASS
  byte-level (only `["day-2"]` of 66 days changed on a real add); authored order
  PASS in the view stack. **Upward-scroll jump FOUND+FIXED**: first-mount
  estimate→measured deltas were uncompensated (cache had no prior entry) — 366px
  jumps scrolling UP through never-mounted days; fixed by seeding the height cache
  with the rendered estimate + above-fold-clamped compensation; re-measured 0px
  both directions. **Pre-existing finding (BACKLOGGED, not this PR):** cross-node
  drag-pins write seed-id overrides that the read spine can't resolve (baked cc =
  plain slugs; `nodeSeeds` never consumed at view render) → pins render un-homed
  in view mode on main AND branch identically (proven via the shared
  `applyPlaceOverrides` on live state). Also learned the hard way: synthetic
  pointer-drags leak dnd-kit auto-scroll (`scrollBy`) — two "self-scrolling
  stack" scares were tooling contamination, proven by a spied fresh context
  (50s idle, zero writes, pinned scroll); and this machine's clock is ~1h ahead
  of TEST's auth server, so minted sessions must patch `expires_at`
  (`web/scripts/mint-dev-session.ts`, now committed).

- **#146 second review round — the A/B overturned my own "pre-existing" verdict.**
  Review rejected function-level equivalence as proof and demanded a direct A/B.
  Ran it (checkout `main`, same fork, same drag, editMode asserted by the
  toggle's label — the first attempt was invalid because `stackPresent:false` is
  trivially true on main and proved nothing about edit state). Result: the seed-id
  pin gap IS pre-existing on a fresh serve (both revert), **but** `main` keeps the
  pin looking re-homed after exiting edit mode via its OPTIMISTIC `localOverrides`,
  and the windowed stack — passing server truth per the build spec — snaps it
  back. That is a real post-edit regression I had reported as "identical". Left
  for Adam's call (accept / pass the optimistic trip-level values / fix the
  seed-id resolution). **Lesson: "same function, same inputs" is not "same
  rendered outcome" — the component receives served + optimistic state, not the
  row I queried.**
- **Two loose ends from the previous round closed, both tooling not product:**
  the "day renders 6 nodes, ZERO cards" scare was a probe querying `span` only
  (card titles are `<h3>`; correct selector finds all 3), and the two dev-server
  deaths were not windowing memory churn — both happened during route/auth work
  with no stack mounted, and a 60-transition sweep of the 66-day trip holds DOM
  nodes flat (2393 → 2393) with sawtooth heap and the server alive. Also fixed
  the rail-click-then-Edit edge I had wrongly deferred (the flush now prefers the
  click target while the programmatic guard is open) and corrected CLAUDE.md:
  **`762577ca…` is a PROD trip**, unusable from dev — TEST replacement
  `05b346df…` recorded.

- **#146 round 3 — behaviour-neutrality chosen over spec-literalism.** Adam's
  call on the post-edit divergence: **option (b)** (stack passes the optimistic
  trip-level values), with the seed-id pin fix as its own PR since the tripwire
  forbids the read spine consuming `nodeSeeds` inside this one. Rationale worth
  keeping: a presentation-only refactor matching `main` IS neutrality even when
  what `main` shows is known-false — otherwise the refactor becomes blameable for
  a pre-existing defect. Re-ran the three-point A/B after the change; `main` and
  the branch now match at all three (`original` / `re-homed` / `re-homed`).
  Dependency recorded on BOTH ends: the seed-id fix dissolves the divergence and
  its PR must revert `renderViewDay` to server truth.
- **Debugging lesson that cost the most time this session: a stale auth session
  looks exactly like broken drag tooling.** Four consecutive "synthetic drags
  stopped working" failures were the minted session expiring — the drags fired,
  the server action refused (*"Couldn't move: Sign in to edit this trip."*), and
  the optimistic overlay reverted, so the DOM read as "drag did nothing". Only a
  screenshot showed the error banner; every JS probe I had written looked at
  placement, not at errors. **Read the screen before re-engineering the tool** —
  and probe for error banners, not just expected state.

- **Credential decision: ACCEPT, do not rotate (Adam).** The seeded TEST password
  in 4 tracked scripts of a public repo stays. Measured blast radius is one TEST
  account's own trips — RLS blocks the corpus (enabled, no policies) and PROD is a
  different ref, and `reference_trips` is anon-readable regardless, so the
  credential buys an attacker nothing there. Weighed against a cascade-risky
  rotation (`trips.owner_id` is ON DELETE CASCADE — delete-and-recreate would
  destroy the seed harness trip and the `05b346df…` fork) plus four script edits.
  Recorded in BACKLOG as a considered accept with the cascade hazard and a
  binding forward rule: new scripts read seed creds from env; the four existing
  ones are grandfathered.
- **#146 closed out and merged.** Final shape: continuous view-mode scroll,
  optimistic trip-level values crossing the bridge (with a scheduled revert), the
  seed-id pin fix queued as its own PR. Three review rounds, and each one caught
  something the previous round's summary had smoothed over — the unauthenticated
  verification, then the equivalence-by-inference, then the deferred edge that was
  actually a small fix. The durable lesson from all three: **an untested claim
  dressed as a verified one is worse than an admitted gap**, because it spends the
  reviewer's trust to hide exactly the work that still needed doing.

## 2026-07-24

- **`rescopeOverlays` landed (#130)** — a pure keep/drop core for overlays across
  a day change: given the trip-level `placeRanks`/`placeOverrides` and a NEW day
  layout, drop overlays whose stop lost its home, keep the rest, never rewrite a
  `nodeId`. Function + 8 tests, no wiring.
- **Curated-POI cross-day move + delete kebab shipped (#131, merged).** A curated
  POI is a `Day.segmentSuggestions` OVERLAY entry, not a routed `Day.waypoints`
  point — so moving/removing one changes NO drive geometry (routing runs over
  waypoints only). The move is a geometry-free `segmentSuggestions` array-splice +
  `rescopeOverlays`, one guarded `updateUserTripPayload` write. ⋮ kebab: Move-to-day
  + Delete on curated tiles, Delete-only on route-waypoint tiles, gated on `canEdit`.
- **Verified before writing STATE (checked, not assumed):**
  - **Move-to-day is FUNCTIONAL, not a stub** — `moveCuratedPlace` actually splices
    the array and persists; it does NOT depend on `dayAssignment`. CAVEAT: array-splice
    STICKS on serve but is LOST on regenerate — day membership is geographically
    re-derived at bake/regen (the corpus fold populates each day's `segmentSuggestions`
    from a per-day-segment query).
  - **The `dayAssignment` anchor-seed-uuid key is DEAD.** `nodeSeed` ids are coord-
    deduped (`SEED_DEDUPE_MI=0.25`, `node-edits.ts:24,77,150`) → a revisited city
    (Cassiar return leg) collides to ONE uuid: per-CITY, not per-instance. And
    `nodeSeeds` is trip-level, never stamped per day (empty on fresh trips). So there
    is no unique-per-day anchor uuid to key on. Recommendation: mint a genuine per-day
    uuid; **regen-survival stays open** (days are regenerated content, not a carried
    coords-projected overlay — no key survives regen without a re-attach rule).
- **BACKLOG honesty items (#129, open)** — recorded three carried detail-panel items
  after re-verifying each against current code; a fourth candidate (the "Adds ~22h28m"
  card-face detour) was verified ALREADY RESOLVED (its owner `suggested-section.tsx`
  was deleted in the 2026-07-12 one-day-renderer refactor) and skipped rather than
  recorded.
- **Doc-consolidation churn (#133, merged)** — added an architecture doc then dropped
  it ("canonical version supersedes it") and rewrote CLAUDE.md POINTERS → an
  END-OF-DAY DOC PASS section (+ `/wrap`). This is why several open doc PRs conflict on
  CLAUDE.md.
- **Merge-cascade correction (dead end to record):** while merging the PR cluster,
  **#134 was merged into the wrong base** — its base was the orphan branch
  `docs/itinerary-model-architecture`, not `main` (I failed to check `baseRefName`
  before merging). #131 landed on main correctly (`f3a8651`); #134's cross-day decision
  doc is on the orphan branch (`a370926`), NOT on main, and needs a fresh PR to main.
  Lesson: verify each PR's base branch before `gh pr merge`, not just its mergeable
  state (which is computed against the base, not necessarily main).
- **Started this LOG** (`docs/LOG.md`); the append rule lives in CLAUDE.md's
  END-OF-DAY DOC PASS section. (Supersedes the LOG.md drafted in #132, whose 2026-07-23
  entry is carried below and whose CLAUDE.md hunks are redundant post-#133 — #132 closed.)
- **#134 misroute RESOLVED** (corrects the bullet above): the cross-day decision doc,
  merged into the orphan branch instead of main, was re-PR'd onto main via **#136**. The
  rest of the cluster landed too — **#129** (BACKLOG honesty items), **#114** (place-search
  decision docs, CLAUDE.md hunk dropped as redundant post-#133), **#135** (STATE.md +
  LOG.md); **#132 closed** with its 2026-07-23 entry carried into this LOG.
- **Architecture doc restored to main (#138).** #133 had dropped `itinerary-model.md`
  deferring to a canonical branch that never merged — leaving the architecture layer
  absent while STATE.md + the decision doc still referenced it (dangling). Restored the
  266-line version; corrected §4 (windowing NOT built) and §5 (`rescopeOverlays` IS wired
  via `moveCuratedPlace`) against code, resynced line refs drifted by #131.
- **Doc-consistency corrections (verified from code, provenance preserved):**
  **#137** fixed the decision doc's false "scroll/windowing layer built and working" §4
  claim (no `IntersectionObserver`/virtualization exists — center is a single-day swap).
  **#141** corrected the "Chosen design" `dayAssignment` key from the anchor-SEED uuid
  (DEAD — coord-deduped, revisited-city collision) to a **newly-minted per-day uuid**,
  inverting two backwards rejected-alternatives items; decision doc, STATE.md, LOG.md now
  AGREE on the key. **#139** fixed a stale note (the itinerary-model ref no longer dangles).
- **Stale-PR triage** — closed 6 superseded/obsolete PRs (#79, #49, #35, #34, #19, #6; all
  300-424 commits behind, work reworked or landed elsewhere). **Kept #24 open** (live
  weather — OpenMeteo + climatology fallback, `src/lib/weather/` + `resolve-weather.ts`,
  ABSENT from main): a genuine unmerged feature, rescue is a SALVAGE not a rebase (its
  hook `suggested-section.tsx` was deleted 7/12). Recorded in BACKLOG (#140) so it isn't
  lost as a dead-looking stale PR. Open-PR list is now #24 only.
- **Verified the kebab is live on prod** — the Vercel Production deployment on the #131
  SHA completed successfully; the ⋮ kebab is reachable now on user-owned UUID trips (not
  reference slugs, not flag-gated — gated on `canEdit` only). Also confirmed `/wrap` is a
  Claude Code command (`.claude/commands/wrap.md`), NOT a web route — no `/wrap` URL exists.

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
