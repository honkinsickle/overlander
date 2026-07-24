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
