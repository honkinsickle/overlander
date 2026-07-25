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
