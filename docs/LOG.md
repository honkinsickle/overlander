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

## 2026-08-09

- **STOP #1 delivered on the six-state PROD trim.** Three branches created off
  `main`, all clean, none pushed: `fix/osm-tag-corrections` (waste_disposal →
  sanitary_dump_station + backcountry/informal predicates, 11/11 osm tests
  green), `chore/prod-scope-diagnostics` (five read-only phase3 scripts),
  `feat/reference-trips-is-active` (migration + user-facing filter). TEST
  reference_trips flipped: 8 of 9 rows `is_active=false`, only
  `la-to-portland` remains active; every hidden row's payload is byte-intact
  under an unfiltered read. Waiting on Adam's "go" for the PROD apply.
- **PROD six-state classification MEASURED, not extrapolated.** 20,384 active
  source_records → **12,320 in-scope, 8,064 out-of-scope**; **0 master_place
  rows co-linked across the footprint boundary**, so the cut is clean and a
  bulk `is_active=false` UPDATE plus a view predicate suffices — no MP splits
  or re-materializations required.
- **BC-edge bug caught before shipping the view migration.** The initial WA
  bbox `[-124.85, 45.55, -116.90, 49.00]` includes **Vancouver Island**; 26 PROD
  rows around the Cowichan Valley classified as in-scope under that box. Fix
  is to use the US–Canada border as the northern bound (real state polygons if
  in-repo, or a tighter bbox). Recorded in `STATE.md` before touching PROD.
- **CORRECTION — the earlier "curated_fuel doesn't exist" claim was wrong.**
  Made against `data/ingestion/sources/` alone; the actual PROD `source_record`
  table carries **3 `curated_fuel` rows plus 4 other Canadian sources** the
  workspace grep missed (`bc_rec_sites_poly`, `bc_rec_sites_points_highvalue`,
  `bc_rest_areas`, `yk_parks_campgrounds`). "Grep the adapter dir" ≠ "measure
  the corpus."
- **CORRECTION — the earlier "50–200k OSM ingest projection" was wrong.**
  Extrapolated from a single dense southwest-Arizona bbox scaled by area to
  the whole 1,700 sq° corridor rectangle (including Pacific Ocean). Measure
  don't extrapolate: OSM ingest uses the corridor bbox rectangle via
  `getActiveCorridorBbox()`, and each state has its own tag density.
- **CORRECTION — the "3-batch MAX_IDS" and "curatedMode = false" instruments
  were reported as gone, but the underlying UUID trips still exist and are
  reachable directly.** They are de-linked from the app surfaces, not deleted;
  a direct URL still resolves.

## 2026-08-08

- **RIDB Route A shipped to PROD from an unmerged branch under explicit
  authorization.** Migrations `59330a3` (widen `pois_along_corridor` to accept
  `google + google_resolved`) and `d962055` (widen the photo lateral to accept
  `nps + ridb`) applied to PROD; the RIDB backfill wrote 1,519 photo rows;
  emitting-tile count rose **3,737 → 5,256** `[queried PROD]`. **Materialize
  was additive** (no `--rematerialize`); a `max(updated_at)` boundary snapshot
  confirmed zero pre-existing MPs touched.
- **DRIFT recorded, unresolved.** The RPC on PROD emits RIDB photos today, but
  the migration files that produced it live on `feat/ridb-imagery-route-a`,
  not `main`. `main` still carries only the NPS-only lateral from #196.
  Reconciliation task: open the branch as a PR. Documented in STATE.md §DRIFT
  so the next cold-start doesn't try to reapply the migrations from `main`
  and revert the widening.
- **APPARATUS LESSON — misread a running ingest as "0 successful fetches."**
  A killed retry pass against `overpass.private.coffee` had actually inserted
  ~8,918 rows before I stopped it; the log filter I was reading showed only
  retries, not writes. Retracted the "0 fetches" claim once the DB count
  disproved it. The rule the CLAUDE.md already carries: instrument writes and
  reads separately.

## 2026-08-06

- **RIDB adapter research done under a read-only investigation.** Measured the
  actual PROD RIDB row count (**3,797**, not the 2,874 echoed from the prompt).
  Recorded as a corpus-scale measurement gotcha: **do not restate a corpus
  count without measuring it against the environment the claim will apply to.**
- **Verified H6 by reading source, not by inference.** The RPC-widen migration
  in `59330a3` assumed the google source writes `external_id` as
  `google:<place_id>` — confirmed at `data/ingestion/sources/google-places.ts:342`.
  Recorded because the earlier migration was drafted without this check.

## 2026-08-05

- **Plot-day-detail places SHIPPED across four PRs.** #187 (scoping doc +
  relocated the two measurement harnesses out of gitignored `.context/` into
  `web/scripts/`), #188 (the GeoJSON circle layer `active-day-places-circles`,
  keyed on active day, coords-guarded), #189 (marker click → `trip:placeFocus` →
  card scroll + highlight), #190 (docs wrap). All verified on `main` by grep, not
  banner. Position: `STATE.md`.
- **Established a map DOES render in dev** — the token comes from `.env.local`,
  which `next dev` loads alongside `.env.development.local`; the "token absent"
  gotcha is scoped to `--env-file` verify scripts. Runbook corrected in `CLAUDE.md`
  (#188). This unblocked real browser verification via headless Chrome + a CDP
  query of the live map object (fiber-walk to the map instance — a throwaway
  diagnostic, nothing committed).
- **The curated finding — three measurements converged.** Max curated on any day
  of any trip is **4** (`4534add5` day 1 = 263-tile pool, 4 curated); the scroll
  shows curated inline and collapses the rest. `curatedMode = false` is LIVE via
  **rest days** (PROD `b97d06bf`, current pipeline, 8/15 days), not legacy-only.
  The 386-tile blowup is legacy-only (`generationInput = n`). **This is the THIRD
  independent measurement to land on the current-pipeline-good / legacy-patchy
  boundary**, after coords and category coverage — a pattern now named in
  `STATE.md`. Open direction (layer + category filtering + `addImage` icons vs a
  DOM-marker revert) and the UNANSWERED Google Places licensing question:
  `BACKLOG.md` §Open direction.
- **Noted (did not write): the map rendering model is undocumented.** Every point
  is a DOM marker, the polyline was the only GeoJSON layer until #188 added the
  first point layer, and four category vocabularies exist (`CategoryIconV2` 9,
  `CAT_SVG` 9, `DOT_BADGE_BY_CATEGORY` 6, `category-icons.tsx` 7).
  `place-render-model.md` covers the CARD, not the map. It warrants a doc — but
  NOT while the layer's future is unsettled; documenting mid-flux would need
  rewriting.
- **CORRECTION — "the 263-degradation check is PROD-gated" was false.** Disproved
  by loading **386 features on an anonymous TEST trip** (`yotrippin-demo` day-19)
  in dev. The claim came from the build handoff and was inherited rather than
  checked; the dense case was reachable all along.
- **CORRECTION — a grep near-miss read as MISSING.** Checking whether the runbook
  correction was on `main`, the grep used `"a map DOES render"` but the text says
  `"a REAL map DOES render"` → false MISSING. Re-grepping with the exact string
  found it. Same shape as every near-miss this week: a check that could not confirm
  what it was looking for. (Also caught by the `[verified 2026-08-04]` tag.)
- **LEARNED — the #189 scroll guard was unnecessary, established by measurement.**
  Markers plot the active day only, so centering an in-day card leaves the centered
  day unchanged and `?day=` stayed `day-1` across a marker-driven scroll — so
  `continuous-day-stack.tsx` was left untouched, not modified to expose its guard.
- **Two-layer category map SHIPPED — #192 (merged, squash `bd39db4`).** Replaces #188's
  circle layer with two symbol layers (POOL/PROMINENT) over the one source, split by
  `prominent = curated OR fromWaypoints`, 9 category toggles, an `addImage` icon
  pipeline (the first SVG-rasterizing machinery in the repo). Discriminator computed
  at render — no schema change, `lib/trips/types.ts` untouched. Reuses both existing
  icon sets (stroke `CAT_SVG` lifted to a shared module for pins + prominent; filled
  `CategoryIconV2` for pool); invents no third set.
- **FOUND: not all `day.waypoints` are user-added** — the discriminator question.
  Traced every writer: add-to-day (user), generation (`waypoints: []`), fork (copies
  the source verbatim), reference trips (`alaska.ts` hand-authors them). PROD measured:
  `la-to-deadhorse` = 93 editorial waypoints (`wp-eggslut`…), `la-to-portland` = 14.
  So `fromWaypoints` means "user-added" on generated trips but "reference author wrote
  it" on forks — recorded as an accepted KNOWN LIMITATION in the PR (editorial
  waypoints promote to prominent on legacy forks).
- **Collision DECIDED by looking, not reasoning** (per the spec). Rendered a dense
  263-tile synthetic day under both `icon-allow-overlap` binaries: `true` = all 267
  paint into an unreadable mass; `false` = clean but Mapbox picks winners. Chose
  **per-layer** (pool declutters, prominent always renders) — better than either
  binary, which the two-layer split makes free. Screenshots in `.context/`.
- **APPARATUS LESSON — a DOM-driven interaction test verifies WIRING, not
  REACHABILITY.** The category-toggle "works" check clicked the checkbox via
  `querySelector(...).click()` and passed — but the panel was rendering BEHIND the
  itinerary overlay (`elementFromPoint` at its centre returned the itinerary, not the
  panel), so no human could reach it. Same shape as this week's other apparatus
  misses: the check couldn't distinguish "works" from "works but invisible." Fix:
  probe `elementFromPoint`/visibility for a control a HUMAN must use, not just fire
  its handler. Moved the harness to centre-top; runbook note added to `CLAUDE.md`.
- **APPARATUS LESSON (repeat, cost a retraction mid-session) — synthetic
  `trip:browseResults`/`trip:flyTo` RESET the active-day place source.** A feature
  count taken right after firing them read **0 features** and looked like a broken
  layer; a clean reload showed 13. Reload and pan via `map.jumpTo` (direct, no app
  events) when measuring the layer. Already in the build spec; re-confirmed live.
- **NO DENSE TEST INSTRUMENT** — the dense verification used a synthetic
  `reference_trips` row, inserted and deleted (TEST restored). Standing TEST trips are
  sparse. One committed synthetic fixture (dense + `curatedMode=false` in one
  anon-readable trip) is wanted → `docs/BACKLOG.md`.
- **Browser-verification harness recorded to memory** — no `node_modules`/puppeteer
  by default in a fresh Conductor workspace; drive headless Chrome via raw CDP over
  Node's global `WebSocket`, reach the live `map` via a React-fiber walk, stage a
  dense trip as a temp TEST reference row.
- **This doc pass was STRANDED by the squash-merge and re-PR'd.** #192 merged as a
  squash (`bd39db4`), so the branch commits are not ancestors of `main` — checked by
  grepping origin/main for the actual symbols, not the PR banner. The panel-fix
  commit made the squash cut; this end-of-session doc commit did not, so it went out
  as its own docs-only PR. Lesson: after a squash-merge, verify late branch commits
  by CONTENT on `main` (`git diff origin/main HEAD`, two-dot), not SHA-ancestry.
- **DIAGNOSED then FIXED: day-detail places "not plotting" on PROD — a visibility
  interaction, not a broken layer (#194).** The symptom read as a dead layer. It was
  not: the source was populated, both symbol layers were in the style, and the
  filters passed — established by MEASURING **in-viewport vs rendered** feature counts
  (a Portland rest day: **8 pool in the viewport, 2 rendered** at zoom 8), not by
  inspecting code. Cause: fixed ~30px icons × a fixed zoom-8 fly-to too far out for a
  ~66px cluster × the pool's `icon-allow-overlap: false` declutter × DOM-marker
  occlusion. That in-viewport-vs-rendered measurement is what distinguished a
  visibility interaction from a data/filter failure — worth repeating whenever a
  layer "isn't showing."
- **Corrected the premise mid-diagnosis:** the handoff called b97d06bf day 3 a rest
  day; the exact `isRestDay` predicate (`start==end && miles==0 && corridorCities==0`)
  says day 3 is a round-trip (it drove); the real rest days are 4–11 `[queried PROD]`.
- **SHIPPED the fix (#194): day-bounds camera.** Fit the day's plottable PLACES
  (`placeBounds` sharing the one `isPlottableCoord` guard with
  `placesToFeatureCollection`), not endpoints (they degenerate to a point on rest/
  round-trip days) nor union (re-introduces the zoom-out). Rest day now z10.37 /
  10-of-10; dense day 2→124 (helps, doesn't solve — clustering is the follow-up).
  Guards + reasoning in `docs/architecture/map-day-render.md`.
- **Third synthetic-fixture insert+delete of the day** (`fit-test-tmp`) — the
  committed multi-shape fixture is now clearly wanted (`docs/BACKLOG.md`). Gotcha:
  synthetic `corridorCities` need `placeIds: []` or `classifyCuratedPicks` throws and
  the map never mounts.

## 2026-08-03

- **#184 shipped the day-insert UX** on top of #182's `splitDay` (which merged
  2026-08-01 wired to nothing). Kebab (Split this day / Add a rest day),
  BottomSheet split-point picker, `insertRestDay` layover, both actions behind
  `checkNotFrozen`, and an `isRestDay` "Nearby" render home. Position in
  `STATE.md`; mechanics in `architecture/itinerary-model.md` §6; follow-ups in
  `BACKLOG.md` §Day-insert. Adam merged it same day.
- **The priority finding, caught before ship: a rest day rendered nothing.** The
  suggestions were fetched, ranked, and stored, but the corridor view had no
  render home for a layover's non-curated tiles (no curated key stops, no spine to
  bucket under) — and "Explore more of Day N" does NOT surface them either (that
  endpoint runs a fresh live-discovery query and never reads `segmentSuggestions`
  `[grep: 0 refs in the trip-browse route]`). Verified by `renderToString`, not
  reasoning: **0/4 tiles → 4/4** after the Nearby block, against an unchanged 2/7
  normal-day control. This was exactly the artifact ("a rest day that shows
  nothing to do") we'd decided against.
- **CORRECTION — two checkpoints of render analysis were reasoned against
  `day-sidebar.tsx`, which is DEAD CODE.** I fixated on its `"0 mi | 0 hrs"`
  render as the rest-day surface problem across checkpoints 2–3; only on the UI
  checkpoint did I grep the mount and find `DaySidebar` (and `DayHeader`) are
  orphaned. **Lesson: confirm a component is mounted before reasoning about its
  render.** The live per-day miles stat is edit-only; view mode carries the
  semantic in the label.
- **CORRECTION — I reported a "blocker" that was a build step.** "No day-level
  kebab exists" is not a halt — creating one is implementation. The genuinely
  decision-worthy fork was narrow (revive the orphaned `DayHeader`, which drags
  rename/delete/reset + a `console.log` stub, vs. a new minimal kebab). I
  over-escalated a normal build decision into an A/B/C question.
- **CORRECTION — the overlay-rescope sequencing test was framed as guarding a
  live #182 hazard; for the rest-day op it guards a PRECONDITION.** `insertRestDay`
  never recomputes or clears existing days' `corridorCities`, so the "rescope over
  node-less days drops overlays" hazard cannot fire on that path. Re-labelled the
  test as a precondition guard so a future reader doesn't delete it as guarding a
  phantom.
- **`NEXT_PUBLIC_MAPBOX_TOKEN` is absent from `.env.development.local`** — split
  routing falls back to Haversine on every leg and reads as a code defect (a split
  whose halves carry null `driveHours` / no spine). Recorded in `CLAUDE.md`
  §RUNBOOK with the workaround (inject only the token from `.env.local`, keep TEST
  Supabase from `--env-file`) — cross-reference, not duplicated here.
- **Verified the four ageing BACKLOG items are still accurate** (MAX_IDS, the
  #176 request-size cap, the `placeId` badge gate, `USE_FEDERATED_POIS`): this
  session touched none of those paths, and the `USE_FEDERATED_POIS` gate in the
  trip-browse route reads exactly as recorded `[read source, 2026-08-03]`. No
  correction needed; not re-written.
- **TEST writes: temp UUID rows cloned from `expedition-ms28y793` by the two
  verify scripts, all self-cleaned — 0 leftover** `[queried TEST, 2026-08-03]`.
  See `DATA_INVENTORY.md`.

## 2026-07-31

- **Three PRs merged: #176 (chunking), #177 (de-link), #178 (planning region).**
  Verified on `origin/main` by grepping for the actual symbols, not by trusting
  the merge banner — #172 merged mid-correction on 07-28 and stranded a fix on
  its branch, so "merged" is checked, not assumed. Nothing stranded this time;
  #178's second, corrective commit is on `main`. Also merged **#175** on 07-30
  (the `mi off route` relabel), which no LOG entry covers.
- **The planning region is a constraint in code now, not a policy sentence**
  (#178). Codes from Mapbox's `context.region.region_code`, one constant module,
  no bounding box and no geo dependency. The region is checked in
  `validateExpeditionForm` and **dropped at `expeditionToGenerationInput`** — it
  never reaches the pipeline. Detail in `docs/STATE.md`.
- **CORRECTION — the Four Corners bbox error was MINE, not Claude Code's.** I
  asserted a six-state bounding box would leak into "western Colorado, most of
  New Mexico." That is wrong, and it is wrong in an embarrassing direction:
  **Utah's and Arizona's eastern border IS Colorado's and New Mexico's western
  border** (the Four Corners meridian, −109.045°), so a box over the six states
  contains essentially **none** of either. The real leakage is **Idaho
  entirely**, western Montana, western Wyoming, and a strip of Baja/Sonora — and
  Idaho alone is the stronger argument against a box, since it is exactly the
  neighbour a US-West trip planner would most plausibly be asked for. The
  argument survived; the evidence for it was fabricated. Recorded because the
  *conclusion* being right is what let a false premise stand unexamined.
- **CORRECTION — two of #178's verifications were vacuous, and I reported both
  as evidence.** Neither was a wrong measurement; both were measurements of
  nothing.
  - The **listbox-presence check** used a document-wide
    `querySelector('ul[role="listbox"]')` while destination **row 2 still had an
    open listbox** from a prior probe run. It would have read "present" even if
    row 1's listbox never rendered. The filtered-not-broken finding actually
    rests on `offered[0]` being row 1's option in DOM order — which held, so the
    conclusion stood on evidence other than the one I cited for it.
  - The **"no out-of-region error shown"** check ran against a form that was
    **never submitted**, and the error renders only behind `submitted &&
    validationError`. It was guaranteed to pass. In-region acceptance is covered
    by unit test; no browser observation established it.
- **CORRECTION — #177 shipped a UI change without anyone looking at it**,
  including an unrequested restyle of the `/trips` empty state that no brief
  asked for. Both surfaces were rendered and checked afterwards. A de-link is a
  content change, and a content change is a UI change.
- **The pattern under all three: an instrument scoped wider than the thing under
  test.** Distinct from the 07-28 lesson (validate the apparatus) — here the
  apparatus worked fine and the *query* pointed at the wrong element. Written up
  as a runbook line in `CLAUDE.md`.
- **CORRECTION — enumeration claims described a wider search than was run.**
  Several statements of the form "X has zero consumers" / "nothing else does Y"
  were made from a search narrower than the claim implied. Where re-run properly
  they held (the orphaned `${name}Lat`/`${name}Lng` inputs really do have zero
  consumers across both workspaces), but they were true by luck of scope, not by
  the search actually performed. **State the search that was run, then the
  conclusion — not the conclusion in language that implies a bigger search.**
- **`next build` is NOT a sufficient gate, and this cost a nearly-red CI.** A
  real type error in `planning-region.test.ts` (`RigProfile.groupSize` is a
  string; the fixture passed a number and forced it with `as`) sat behind a green
  `next build`. **CI runs `typecheck` as its own job** and would have failed.
  Corrected in `docs/STATE.md` §INVARIANTS. The same insufficient claim is still
  in `CLAUDE.md` §STANDING RULES — flagged, not edited.
- **A type predicate alone enforced nothing.** Making `isInPlanningRegion` a
  predicate to drop an `as string` looked like it moved an invariant into the
  type system. Mutation-checking it — delete the guard, expect a compile error —
  produced **no error**: the `.filter((s): s is Suggestion => …)` predicate
  launders the `.map()` callback's inferred return type. Annotating the callback
  is the load-bearing part. Without the mutation check I would have replaced a
  prose claim with a *more confident* prose claim.

## 2026-07-28

- **`MAX_IDS = 40` scoped and measured.** `alaska-south-final` scrolled end to
  end in a live browser with instrumented `fetch`: **19 requests, max 28 ids,
  zero windows over 40** (`yotrippin-demo` was sampled + simulated, not
  instrumented — it also stays under). The failures are single-day, not
  windowing: PROD
  `la-to-deadhorse` days 1/2/3/9 (**91**/57/57/42 distinct eligible) and
  `dawson-vancouver-cassiar` day 1 (42). Any window containing day 1 requests
  ≥91 cold, and a first request is always cold, so accumulation cannot rescue it.
  On day 1 all **51 dropped ids render as visible cards** — the day has zero
  curated tiles, so `curatedMode` is false and nothing collapses behind "Explore
  more". Recommendation: chunk server-side; do not raise the cap until someone
  establishes what 40 protected. Detail in `place-render-model.md` §4.4.1 and
  `BACKLOG.md`.

- **THREE CORRECTIONS from that pass — the more useful half of the session.**
  - **"The first hydration request on `la-to-deadhorse` drops 51 of 91" was
    WRONG.** Overview issues **zero** requests (`selectedDayId` is null without
    `?day=` → `hydrateDayIds` is `[]`); the 91 requires selecting day 1 first.
    Common, but not automatic, and it was stated as automatic. Caught by
    instrumenting `fetch` and watching 0 calls at Overview.
  - **The first pass simulated where measurement was available.** That part
    stands: with a browser open, the first attempt replayed sampled windows
    offline instead of instrumenting `fetch`.
  - **RETRACTED — the correction to that, written the same day, was itself
    wrong, and it reached the docs before being caught.** It read: *"the model
    was wrong — observed sum 203 against 142 distinct ids, an excess the model
    could not produce, because it treated accumulation as binary; reality is
    partial, ids resolving to `null` are re-requested every window, ≈43%
    overhead."* Re-measured at a realistic scroll speed (820–1200 ms per step
    rather than ~200 ms): **19 requests totalling exactly 142 ids against 142
    distinct, 0 aborted, 0 failed.** Every id resolved. **The simulation had been
    right** (it predicted 19 requests / 142) and the fast-scroll *measurement*
    was the artifact. The 203 came from the effect's `() => ctrl.abort()`
    cleanup cancelling in-flight requests during a scripted scroll faster than
    the network, so their ids were re-asked — a real behavior under flick-scroll,
    but nothing to do with null resolution.
  - **The lesson is not "measure instead of model."** It is that a measurement
    has an apparatus, and the apparatus can be the thing you are measuring. I
    distrusted a model because it disagreed with an instrument, without asking
    what the instrument was doing — and then wrote the instrument's artifact into
    three docs as a finding.
  - **Sampling at 0.5-viewport steps can skip transient mounted states.** The
    bias is conservative — a skipped window makes the next simulated request
    larger, not smaller — so "zero over 40" survives it. It went unstated.
  - Same shape as the near-miss inside the audit itself: inferring "dev has no
    `GOOGLE_PLACES_API_KEY`" from its absence in `.env.development.local`, when
    `next dev` also loads `.env.local` where the key lives. Probing the endpoint
    returned live Google data. An inference-shaped claim nearly shipped **while
    auditing inference-shaped claims**.

- **THREE MORE CORRECTIONS, found by re-reading the MAX_IDS work rather than by
  new investigation.** Two of them had already reached `main`; the third reached
  a PR body.
  - **"Two 19-day TEST trips scrolled end to end with instrumented `fetch`" was
    WRONG — one was.** `alaska-south-final` was instrumented;
    `yotrippin-demo` was window-sampled from the DOM and replayed offline. Both
    stay under the cap, so the conclusion held, but the headline figure came from
    one trip while being attributed to two — in a commit message, a PR body, and
    three docs. Fixed in #173.
  - **"React double-invokes effects in dev, which can add a mount-time
    request/abort pair" was WRONG for this repo.** `web/next.config.ts` sets no
    `reactStrictMode`, there is no `StrictMode` wrapper anywhere in `web/src`,
    and selecting a day issues exactly **one** hydration request
    `[measured 2026-07-28]`. The guess was written **inside the runbook entry
    about naming mechanisms without checking for them** — the lesson and its
    violation in the same commit. Replaced with the negative finding, since
    double-invoke is the obvious hypothesis and re-checking costs a measurement.
  - **"A dropped id is never in the cache to begin with" was WRONG.**
    `cacheStore` is keyed by `place_id` globally, so a dropped id may well be
    cached from an earlier window in which it survived the cut. The accurate
    statement is that it is never **looked up**: `parsePlaceIds` truncates before
    the handler consults the cache. (`place-render-model.md` had it right; only
    `BACKLOG.md` was wrong.)
  - **"Verified the remount empirically" — the conclusion held, the evidence did
    not.** The test called `history.back()` **in the same script** as the close
    click, so the resulting `/` could not be attributed to the close; it was
    marked `(observed)` in two docs anyway. Re-run with the close click alone,
    then the full cycle: open → select day 1 → **28 ids**; Close, nothing else →
    lands on `/` with a fresh document; reopen → select day 1 → **28 ids again**.
    `hydrated` does reset per open. Galling detail: that claim was written in the
    sentence *"verified rather than assumed, after last round's lesson."**
  - **#172 merged mid-correction**, taking `44c7f42` and stranding the fix on the
    branch, so `main` briefly carried two known-false statements. Recovered by
    cherry-picking onto a fresh branch (**#173**). Worth remembering that an open
    PR is not a safe place to park a known error — land the correction or say so
    in the PR before it can be merged out from under you.

- **WHAT THE DAY ACTUALLY DEMONSTRATED — the sharper finding.** Across three
  re-analysis passes over the MAX_IDS work, **every payload count held** — 91 /
  57 / 57 / 42 distinct eligible ids, `24f14ecc` at exactly 40, 51 dropped,
  zero-windows-over-40, 0 of 51 carrying a stored rating. Not one number moved
  under repeated scrutiny.
  **Every single error was a claim about MECHANISM or PROVENANCE:** "ids resolve
  to null" (it was request abort), "React double-invokes" (not in this repo),
  "never cached" (it may be — it is never looked up), "two trips instrumented"
  (one was), "observed" (confounded by my own `history.back()`).
  That is a more useful diagnosis than "we made mistakes": the counting
  discipline this project has built is working, and the failure has moved
  entirely to *why* and *how we know*. Both new `CLAUDE.md` runbook lines exist
  for that — validate the apparatus before trusting the instrument, and don't
  name a mechanism you haven't checked for.

- **The stale example this replaced had propagated to two docs**, both corrected
  in place: `BACKLOG.md`'s entry and `place-render-model.md` §4.4 both claimed
  *"`24f14ecc` carries 41 tiles on day-1 alone, so a ~3-day window exceeds 40."*
  `24f14ecc` has **2 days** — a ~3-day window cannot exist on it — and 41 is its
  `placePool` count, not the hydration-eligible set. Its true figure is **exactly
  40 distinct trip-wide against a cap of 40**: nothing dropped, but a boundary
  rather than a margin.

- **`GOOGLE_PLACES_API_KEY` confirmed set in Vercel Production**
  `[confirmed via Vercel dashboard, 2026-07-28]`, so the accumulating path is
  production behavior and the TEST measurements are representative.

- **CORRECTION, superseding the 2026-07-26 bullet "No PROD trip is affected —
  zero stored miles anywhere on PROD".** That is false as of today.
  `[queried PROD 2026-07-28, read-only]` **Three generated trips now live in PROD
  `public.trips`, all created today**, all carrying stored `milesFromStart`:
  `a54c5c65-…` (774 tiles), `cefc94e0-…` (552), `7e3e088a-…` (776). **18 curated
  tiles sit beyond their own day's `miles`, up to ×2.3** — day 1 of `a54c5c65-…`
  is a 268-mile day whose spine reached **626mi**. The mile defect is therefore a
  live production defect, not a TEST curiosity.
  - **The earlier bullet was not wrong when written** — it quantified over a table
    that held no generated rows at the time. Nothing re-checked it when generation
    began writing to `public.trips`. A bare row count is the claim that goes stale
    silently, which is the second time this shape has bitten (cf. the corpus-ADR
    `enqueueResolvedPlaces` "zero callers" correction, 2026-07-27).
  - **It had propagated to two other places**, both corrected in place rather than
    overwritten: `lib/corridor/stretches.ts`'s deletion-precondition block and
    `docs/architecture/generation-pipeline.md` §7.4. The `stretches.ts` copy was
    the dangerous one — it was the stated basis for deleting
    `positionPlacesOnDay`, and [#170](https://github.com/honkinsickle/overlander/pull/170)
    has just made that function load-bearing, so acting on it would have deleted
    the thing that fixes the bug.
  - **What still holds:** `dawson-vancouver-cassiar` (FROZEN) remains unaffected —
    417 tiles, 0 stored miles. The frozen-trip risk still does not exist.

- **CORRECTION to [#166](https://github.com/honkinsickle/overlander/pull/166) —
  "identical, including the per-day distribution" was FALSE.** The PR body and the
  commit message both claimed the pre- and post-deletion generations were
  identical. **The totals matched at 20; the distributions did not**
  `[re-measured 2026-07-28]`:
  - `ea1f51f7` (pre-4b baseline): 20 tiles, per-day **4 / 4 / 4 / 4 / 4**
  - `b67680c0` (post-4b): 20 tiles, per-day **4 / 3 / 5 / 4 / 4**

  **How it happened:** the verification script printed the per-day breakdown for
  the NEW trip only. There was **no per-day data for the baseline at all**, and
  the match was asserted anyway. Same failure mode this project keeps hitting — a
  conclusion stated with more confidence than the evidence carried — committed, in
  this instance, inside a PR whose stated purpose was rigor about that very
  number.

  **What survives:** the CONCLUSION of #166 still holds. Totals matched exactly,
  group 4 demonstrably did not thin the trip, and the deleted suggestion modules
  were never in the expedition path (`buildDaySuggestions` had one caller,
  `lib/plan/actions.ts`, itself deleted). It is the CHARACTERIZATION of the
  evidence that was false, not the finding.

  **[#167](https://github.com/honkinsickle/overlander/pull/167) contradicts #166
  on this point, and #167 is the correct one.** It argues run-to-run variance from
  the fact that "the two baselines already differ in shape from each other" —
  which is true, and which is precisely what makes #166's sentence wrong. Read
  #167.

  Recorded rather than rewritten: #166 is merged, and this repo's convention (see
  `docs/decisions/2026-07-23-corpus-writeback-dormant.md`) is a dated correction
  over an edited history. The PR body and commit message are left as they are.

- **The runbook lesson written in #166 was itself under-generalized, and is
  widened here.** It told the next person to "search the whole of `web/`" — one
  rung up from the "search `web/src`" mistake that caused the break, and still
  wrong for the same reason. **This is a multi-workspace repo and the gates are
  per-workspace:** `cd web && npx next build` does not run `data/`'s
  `tsc --noEmit`, so a deletion that breaks `data/` passes the gate the runbook
  names and fails elsewhere. Verified `data/` references none of the modules 4b
  deleted `[grep]`, so nothing was actually broken — the lesson simply would not
  have prevented the next instance. `CLAUDE.md` §RUNBOOK now enumerates the
  workspaces and their gates.

- **Swept `STATE.md` and `BACKLOG.md` for other counts that drift the same way.
  Nothing is currently stale**, so nothing was changed. Both checkable claims
  re-verified: `ensureAlaskaUpgraded` still has exactly **4** call sites
  (`repository.ts` 103/117/129/190) `[grep]`, and the auth-method sweep
  (`signInWithPassword`, `signInWithOtp`, `signUp`, `verifyOtp`,
  `resetPasswordForEmail`, `signInAnonymously`) still returns **zero hits** in
  `web/src` `[grep]`. `BACKLOG.md`'s ratios are pinned to named, frozen artifacts
  (`expedition-ms28y793`, PROD `24f14ecc…`), which is what makes them safe — the
  denominator can't move. The one genuinely drift-prone figure is **"PROD has 7
  such draft rows"**: it is a live DB count, it is now MORE fragile because 4c
  established drafts are still creatable (`duplicateTrip`, `setTripState`, the DB
  default), and it **cannot currently be re-measured** — the Supabase access token
  is revoked and no PROD credentials exist locally. Treat it as last-known, not
  current.

- **The wizard swap finished: [#167](https://github.com/honkinsickle/overlander/pull/167)
  and [#168](https://github.com/honkinsickle/overlander/pull/168) merged.** 4a
  de-linked, 4b deleted the routes and legacy-only modules, 4c unwound the
  trips-domain residue (`createUserWizardTrip`, `writeWizardSlice`,
  `UserTripSummary.wizardStep`, `Trip.wizard`). The expedition wizard is now the
  only creation path in the codebase. `main` at `86e3acf`.

- **Repo hygiene: 52 merged local branches deleted, 2 stale remote-tracking refs
  pruned.** Done with `git branch -d` rather than `-D` on purpose — that makes git
  itself the guard, so a branch that isn't fully merged cannot be removed by a
  filtering mistake. One branch (`feat/manual-trip-edit`) was refused because its
  *upstream* sat a commit behind it; confirmed an ancestor of `main` before
  forcing, so nothing was lost. **`fix/generated-day-miles` was excluded
  deliberately** and still has no PR — parked on a real decision (fix `bake.ts` vs
  project on the read path), not forgotten.
  - Worth keeping: the first pass computed merged-status against a `main` that was
    **six commits stale**, because #167 and #168 merged mid-task. Acting on that
    list would have spared two branches that were in fact merged. Fetch before you
    classify — "merged" is a claim about a moving target.

- **A premise I asserted was wrong, and the code said so.** I recorded that
  `createUserWizardTrip` was *likely the only writer* of `state='draft'`, implying
  drafts might become uncreatable once 4b deleted it. **Three live paths remain** —
  `duplicateTrip`, `setTripState`, and the DB default `[read source]`. Now in
  `docs/BACKLOG.md` §"Draft trips after the wizard swap", with the consequence:
  nothing branches on `state === "draft"` any more, so drafts stay creatable while
  nothing consumes them *as* drafts. A loose end to decide, not a bug to fix.

- **The #166 false claim was caught by re-audit, not by review.** Nobody
  challenged the "identical, including the per-day distribution" sentence — it
  surfaced only on a second pass re-reading this session's own output against the
  measurements. Two things follow. **The correction convention held:** a dated
  entry (above) plus a superseding section in `generation-pipeline.md` §9, with
  #166's body and commit message left intact — same posture as the
  corpus-writeback ADR. **And the failure mode is the durable lesson:** a
  verification script that prints one side of a comparison invites you to assert
  the other. Print both sides, or claim only what was measured.

- **The run-to-run variance baseline now has a home:**
  `docs/architecture/generation-pipeline.md` §9. Three generations of the
  byte-identical form — 20 tiles at `4/4/4/4/4`, 20 at `4/3/5/4/4`, 21 at
  `4/5/4/5/3`. Two agree on the total and disagree on the shape, which is what
  makes it evidence: **identical input does not produce an identical trip**, so a
  future shape difference is not prima facie a regression. It went in the pipeline
  doc rather than `place-render-model.md` because that file's tile-count caveat is
  about *disjoint instruments*, whereas this is the *same instrument regenerated*
  — a different question about the same numbers.

## 2026-07-27

- **The wizard swap went from "decided, not started" to fully merged in one
  session — five PRs
  ([#159](https://github.com/honkinsickle/overlander/pull/159),
  [#160](https://github.com/honkinsickle/overlander/pull/160),
  [#161](https://github.com/honkinsickle/overlander/pull/161),
  [#162](https://github.com/honkinsickle/overlander/pull/162),
  [#163](https://github.com/honkinsickle/overlander/pull/163)).** Auth gate →
  owned-row write target → root CTA → de-link legacy → remove the TEST-only rail.
  Deliberately sequenced so nothing was deleted while the replacement was
  unproven: #162 removed the *links* to the legacy wizard while leaving the route
  working, which is what makes the eventual teardown reversible-by-inaction.

- **#163's real finding: the TEST-only rail was doing two jobs, and only one of
  them had expired.** The brief's premise — that #159/#160 made the rail obsolete
  because the trip write is now session-scoped and RLS-enforced — was verified
  correct *for the trip write*. But `enqueueResolvedPlaces` is still a
  **service-role write to a shared curated table** (`upsert_source_record` →
  `source_record`, SECURITY INVOKER, RLS on with **zero policies**), and its blast
  radius was unchanged. Deleting the rail wholesale would have silently converted
  every prod generation into an unreviewed write to prod curated data —
  contradicting `ingest.ts`'s own docstring (*"a PROD corpus write would need a
  SEPARATE deliberate gate"*). **The gate moved to that call site instead of being
  deleted.** Lesson worth keeping: *"this guard is obsolete"* is a claim about a
  specific code path, not about the guard — enumerate every path it covers before
  removing it.

- **Verified the PROD env rather than accepting the report — and one worry turned
  out to be unfounded.** `[vercel env ls production]`: `ANTHROPIC_API_KEY` is
  **missing** (the one real blocker to a first PROD generation), but
  `GOOGLE_PLACES_API_KEY` **is set** (49d, Preview+Production). So the feared
  interaction with the silent-degradation defect **does not apply** to the first
  PROD generation. Also confirmed the flag positively rather than by assertion:
  `/plan/expedition` on the public alias returns **307 → sign-in**, and with the
  flag off that path 404s (`notFound()` runs first) — so the redirect proves both
  the flag and the auth gate. `/plan` still mints a draft on PROD, by design.

- **A dev-facing error string is reaching production users.** `generate.ts:60`
  throws *"ANTHROPIC_API_KEY is not set — add it to `web/.env.local` to run
  generation."* The action returns that verbatim as `{ ok: false, error }` and the
  wizard renders it, so the first PROD user to hit generate is told to edit a file
  that does not exist in their browser. Three sibling throws produce three
  different strings for the same condition. Filed, not fixed — this pass was
  docs-only.

- **`mvum_roads` brought into line with the other reference tables — RLS enforced
  on TEST and PROD ([#154](https://github.com/honkinsickle/overlander/pull/154)).**
  It was created by `20260603010000_phase2_mvum_corridor.sql` without
  `enable row level security`, while `master_place`, `source_record`,
  `place_match`, `legality_overlay` and `field_precedence` all enable it, and no
  later migration picked it up. Migration `20260727120000_mvum_roads_rls.sql`:
  RLS on, **zero policies**, plus explicit revokes on the table and on
  `upsert_mvum_road`.
- **Zero policies is correct because every consumer is service-role.**
  `data/ingestion/lib/db.ts` (`getDb()` → service-role key), `mvum:load`, and
  `recompute_master_place` — which reads `mvum_roads` and is SECURITY INVOKER,
  but is only ever called from that same service-role path. Nothing in `web/src`
  reads the table (`mvumCorridor` there is a derived `master_place` column). Same
  posture as `reference_trips`' write side.
- **Migration-authoring lesson: revoking function EXECUTE needs BOTH forms.**
  Two mechanisms can grant it and a revoke only clears the one it names —
  Postgres' default grant to `PUBLIC`, and explicit per-role grants visible in
  `pg_proc.proacl`. `revoke … from anon, authenticated` misses the first;
  `revoke … from public` misses the second. Our two projects differed in exactly
  that way, so each form alone was a silent no-op on one of them — a revoke
  against a grant a role never individually held succeeds and changes nothing,
  with no error. Do both, grant back to the one role that needs it, and **verify
  against `pg_proc.proacl` rather than trusting the DDL**. Two successive drafts
  of this migration read as correct and were not; post-apply catalog checks are
  the only reason that was caught.
- **Proofs on TEST, both green.** `mvum:load --dry-run` → 371 features / 308
  routes / 0 errors. `recompute_master_place` smoke → `mvum_corridor` stayed
  `true` on a dispersed-camping place. That is the sharp assertion: the value is
  *derived from the `mvum_roads` read*, so it would have flipped to `false` had
  RLS blocked it. Proving the value survived beats asserting "no error raised".
  Not run against PROD by design.
- **`mvum:load` with no `--bbox` fails on TEST for an unrelated pre-existing
  reason** — `ingestion_corridor` is empty, so `resolveCorridorFilter` aborts
  before reaching `mvum_roads`. Not an RLS regression; the code comment
  anticipates it ("e.g. fresh database"). The documented `--bbox` form runs fine.
- **Applied via the Supabase Management API, not `supabase db push`** — Docker is
  not installed on this machine and both `db push` and `pg_dump` require it. The
  `supabase_migrations.schema_migrations` row was written by hand on both
  projects so the migration history is not left out of sync with the file.
- **Noticed in passing, not investigated: PROD's migration history is missing
  `20260723120000_google_resolved_field_precedence`, which TEST has.** Recorded
  because a history gap between the two projects goes unnoticed until it bites.
- **End-of-day doc pass — STATE reconciled from five PRs of staleness.** The
  previous STATE carried a "stale below this line" marker covering #146–#150; that
  is now discharged and the file rewritten to actual position from `gh pr view` +
  `git log` rather than carried forward. **#153 turned out to still be open** — I
  had assumed it merged with the rest, which is exactly the kind of thing the
  marker existed to prevent. (It landed later the same session, rebased onto main
  after #155; the cross-links marked provisional at the time are now live. The
  assumption is recorded because it was wrong when made, not because it stayed
  wrong.)
- **Decision: generation will require sign-in, and the legacy wizard is replaced
  rather than migrated** —
  `docs/decisions/2026-07-27-generation-requires-sign-in.md`. **Blocked, not
  started.** Google OAuth is the only wired sign-in method; TEST has no Google
  provider and PROD's is disabled, so gating generation on sign-in makes the
  primary creation path unreachable in dev without a hand-minted cookie and
  unreachable in prod outright. Note `app/trips/layout.tsx` already carries its
  user gate commented out for the same reason — the two gates should move
  together. Sequence + ordering constraint in `docs/BACKLOG.md` §Wizard swap.
- **Swept `docs/decisions/` for stale factual claims: 7 of 12 records carry at
  least one.** Only the corpus-writeback ADR was corrected; the rest are recorded
  in `docs/BACKLOG.md`, not fixed. The pattern worth naming: **a record that says
  "verified, still true on `main` <sha>" is the one most likely to be trusted
  without re-checking, and therefore the most dangerous when it ages.** The worst
  offender asserts there is no windowing anywhere in the trip components; Design A
  shipped the next day as #146.

### Retractions — three claims that did not survive checking

Recorded because each cost real time, and the record is more useful with them
than without.

- **The "population of dead placeIds" did not exist.** Inferred from a cache that
  stores `null` on failure for 15 minutes, so one transient upstream blip replays
  as a permanent dead id for the rest of the window. Measured properly:
  **103 of 104 resolved.** The lesson is already in CLAUDE.md — re-measure after
  the TTL before calling an id dead.
- **The RLS drift did not exist.** A previous session reported that live policies
  diverged from migrations on three tables, on the strength of `anon` reading rows
  that `authenticated` could not. The live catalog says otherwise: **policies match
  migrations exactly on both projects, grants are identical across roles, and there
  is no structural drift.** The entire anomaly was **one misconfigured env var** —
  the "anon" probe client was built from a key that was actually a secret key, so
  it ran as service-role and bypassed RLS, while the "authenticated" client used a
  real JWT and was correctly denied. `SET ROLE anon` / `SET ROLE authenticated`
  settles it in one query and returns identical results. **The durable lesson: a
  probe is only as trustworthy as the identity it ran under** — role-differentiated
  behaviour was reported across four turns without once checking `current_user`.
  Full retraction: `docs/architecture/trip-resolution.md` §"The RLS drift that
  wasn't"; it is now also a STATE invariant.
- **The day-mile fix's magnitude was overstated by roughly 16×.** It was scoped as
  though the `where === "keyStop"` via filter would remove most of the geometry
  inflation. Measured, it removes **~6%** (2.25× → 2.18× vs the direct line) — the
  dominant term is key-stop vias being genuine off-route excursions in LLM emission
  order, which the filter does not touch. The branch is parked on that measurement
  rather than on a guess, which is the right outcome; the cost was scoping it first
  and measuring second.

All three share one shape: **a conclusion reached by inference from a partial
signal, stated with more confidence than the evidence carried.** The corrective in
each case was cheap and available up front — re-measure after a TTL, check
`current_user`, compute the delta before scoping the fix.

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
- **Trip creation's CLIENT half traced — new
  `docs/architecture/trip-creation-surfaces.md`.** Companion to
  `generation-pipeline.md` (#151, now merged), which covers only the server. Read-only,
  and deliberately never submitted the form: every claim about in-flight state,
  errors, and the landing is static code analysis, with no duration estimated
  anywhere.
- **The headline: no degradation signal reaches any component.** The action
  returns `{ ok, tripId, days, note? }`; `ExpeditionWizard.submit` destructures
  `ok`/`error`/`tripId` only, so `note` and `days` are computed, returned across
  the server-action boundary, and dropped. Worse, `note` keys off `unresolved`
  (surviving structural violations) — so the **no-`GOOGLE_PLACES_API_KEY` case
  sets no signal at all**, not merely an unread one. And there is no toast /
  banner / alert system anywhere in the repo (no library, four `components/ui/`
  primitives, root layout mounts no provider), so there is no host component to
  hang one on.
- **The expectation was inverted: the LEGACY 5-step wizard is the live one.** It
  is behind **no** feature flag and is fronted by the root page's primary CTA
  ("Create a Trip" → `/plan`), plus the `/trips` empty state and draft-card
  deep-links. The newer expedition wizard is flag-gated (404s without
  `ENABLE_PLANNER_WIZARD`) and has **zero** links anywhere — URL-only. Also: the
  anon `TRIPS` path is **not** a third surface, it is the anonymous branch of the
  legacy wizard's `finalizeTripAction`.
- **A generated trip is neither editable nor findable.** `canEdit` is
  `isUserTrip(id)`, a UUID regex; the minted id is `expedition-<base36>`, a slug
  → `canEdit === false` on both serving routes. And it is written to
  `reference_trips` while `listUserTrips` queries `trips` and `listAnonTrips`
  filters `trip-` — so it appears in **no listing on any surface**. The redirect
  URL is the only route back to it.
- **One timeout exists in the whole generation call chain, and it is not on the
  LLM.** `AbortSignal.timeout(8000)` on the Google Places fetch in `resolve.ts`
  is the only hit; the Anthropic call, `preComputeFacts`, and the upsert have
  none, and there is no `maxDuration` export. `REGEN_BUDGET = 2` is a quality
  re-prompt loop, not an error retry.
- **Recorded fragments checked: 5 held, 3 were wrong.** Wrong: the in-flight
  label is "Generating your expedition…" — `Rendering` has **zero** occurrences
  repo-wide; the date-field claim is half wrong (the hidden inputs are *dead* on
  this path and the wizard *does* contain a native `<input type="date">` for
  per-destination FIXED dates); and "prod never sets `ENABLE_PLANNER_WIZARD`" is
  stronger than the evidence — no `vercel.json` exists and dashboard env vars
  aren't in source, so prod's value is UNVERIFIED.
- **A subagent's "there is no Next.js middleware" was caught wrong by the build
  gate.** Next 16 renamed `middleware.ts` → `proxy.ts`; `web/src/proxy.ts` exists
  and runs on every navigation (the build prints `ƒ Proxy (Middleware)`). Its
  body is only `updateSupabaseSession` — no gating — so the conclusion held but
  the evidence didn't. Recorded in the doc so the same grep doesn't mislead
  again.
- **Dead code + misleading copy found in passing (not fixed).** `OffCacheBanner`
  is rendered nowhere — the identifier appears only in its own definition and two
  doc-comments. And the wizard's "Saved on the vehicle — reused across trips."
  overstates an in-memory garage that resets on restart; there is **no**
  user-facing copy anywhere warning that anon trips are ephemeral (every hit for
  "temporary/unsaved/will be lost" is a developer comment).

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
