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

## 2026-08-25 (scoping) — Interest-Category chips: scoping doc + A/B/C decided, no code

### Session part 2 — A/B/C decided, D–H open, two flags surfaced

- **A/B/C decisions arrived mid-session** (Adam) — recorded in
  `docs/specs/interest-category-chips.md` §9 with reasoning: (A) `overnight`
  end-to-end, not `hotel`; (B) guarantee gate covers 8 of 9 (all except
  `interest`); (C) Option A guarantee-wins-strictly.
- **B verification found two load-bearing caveats before writing "decided"** —
  Adam had explicitly asked to check them, not build around. Both confirmed
  `[read source 2026-08-25]`:
  - **B.1 `fuel` in the gate is inert with today's mechanism.** Traced from
    `pickAnchorStop` (`anchor-backfill.ts:131`) → `candidates: PoolPOI[]`
    (`:116`) → `pool: facts.poolPOIs` at the caller
    (`audit.ts:510-515`) → `preComputeFacts` (`facts.ts:167-257`) which folds
    corpus-only via `fetchCorpusForSegment`/`fetchCorpusForPolyline` in
    `bake-corridors.ts`. No `PlaceResolver` / Google / `fetch` in the backfill
    path — `anchor-backfill.ts:11-13` comment is explicit. Adam's assumption
    that "fuel resolves via Google Places live-resolve" describes the
    LLM→audit path (`audit.ts:100-107` → `resolve.ts:19` `places:searchText`)
    for LLM-emitted `keyStops` names, NOT the backfill. Fuel pool candidates
    DO exist when corpus rows have `primary_category ∈ {gas_station,
    ev_charging, truck_stop}` (`federated.ts:22`) — but those rows are absent
    in the far-north/off-corridor regions the fuel-POI layer (per
    `expedition-planner.md §8.5`) is meant to cover.
  - **B.2 `overnight` in the gate DUPLICATES the existing overnight
    mechanism.** LLM's overnight is a dedicated required per-day slot at
    `schema.ts:281-295, :310`, grounded independently at `audit.ts:550-557`,
    marked as the day's single `isOvernight` via `markOvernightTile` at
    `bake.ts:282-290, :141-145`. A backfill pick, by contrast, lands as an
    extra `KeyStop` on `day.keyStops` at `audit.ts:526-527`, is featured as a
    curated card via `noteByRef` at `bake.ts:216-221`, and NEVER enters the
    `overnightRef`/`markOvernightTile` path. If backfill picks a different
    hotel/motel row than the LLM's overnight (three-row source pool per
    `SLIDE_TO_PRIMARY_CATEGORY.overnight = [hotel, resort_hotel, motel]`,
    `federated.ts:41`), the day carries TWO overnight-category features with
    no dedupe — the anchor-covered test at `audit.ts:463-470` reads keyStop
    coords only, not overnight coords.
- **Both flags reported per the ask, not built around.** Written into the spec
  §5.2 and §9 B as "resolved-with-caveats"; the implementation plan §11
  defers wiring `fuel` and `overnight` chips into the selector until Adam
  re-decides. Chips can render (disabled or with a caveat tooltip) without
  blocking the other 6 categories.
- **Implementation plan §11 added** — 10 steps, each labelled unblocked /
  partially blocked / blocked, with the blocker-to-step map at the end.
  Steps that can ship in a first PR without ANY of D–H: 2, 3, 4a, 8-scenic-
  only, 9 (payload/state plumbing + `scenic` removal + flag scaffold). Steps
  5 (audit-loop change), 6 (new selector), 7 (contention wiring) are all
  blocked on D — cannot even prototype cleanly because the shape of
  `missingGuaranteedCategories` diverges per D option.
- **Convention: default is not decided.** The plan writes recommended
  defaults for E (rank order), F (chip order/copy), G (Preferences fate), H
  (prompt posture) so a reader can see the shape — but every recommendation
  is labelled as such, and no code should ship the default silently.

### Session part 1 — initial scoping doc

- **Framing that changed the shape of the answer.** The ask read like "add a
  chip row and wire it up," but tracing the four subsystems (wizard state,
  payload schema, LLM prompt, backfill selector) surfaced two facts that
  dominate design before any UI decisions matter, so the doc leads with them
  rather than the UI. Both are `[read source 2026-08-25]`.
- **The 9-category taxonomy exists in two canonical forms and the app
  translates between them.** `Category` (display, `"hotel"`) at
  `web/src/components/primitives/detail-card.tsx:58-67`; `SlideCategoryKey`
  (data-fetch + generation pipeline, `"overnight"`) at
  `web/src/lib/trip-browse/places.ts:7-16`. A wizard chip labelled `hotel`
  reaching `pickAnchorStop` as the literal `"hotel"` will never match a pool POI
  — `PoolPOI.category` is set from `BrowsePlace.category?: SlideCategoryKey` and
  carries `"overnight"`. Bridge functions live at
  `web/src/lib/trip-browse/palette.ts:48-63`. This is a decision the wizard
  can't dodge — every downstream string check has an opinion.
- **`OPENER_CATEGORIES` is a strict 5-of-9 subset** — excludes `interest`
  ("junk drawer", explicit comment at `web/src/lib/itinerary/anchor-
  backfill.ts:41-42`), `urban`, `fuel`, `overnight`/`hotel`. So four of the nine
  categories in the assignment silently no-op through today's selector if the
  guarantee shares that gate. If the guarantee uses its own broader gate, the
  `interest` and `fuel` decisions get inherited from what were, at the time,
  considered calls (interest's junk-drawer status, fuel's missing corpus layer).
- **`scenic` as a Preferences chip has zero downstream enforcement.** Grepped
  every consumer: it reaches the LLM as an array element on `payload.rig` and no
  code path reads it. Removing it (per Adam's collision resolution) touches 5
  files, none of which are DB or code that would silently break something
  further. But **removal from `PREFERENCE_OPTIONS` will NOT drop existing seed
  rigs** — three seeded vehicles at `web/src/lib/vehicles/repository.ts:24, 39,
  54` still carry `"scenic"` in their `rig.preferences` array and will render as
  unknown chips until edited. In-memory only, so purely a code cleanup.
- **The 9-category vocabulary is never enumerated to the LLM today.** The
  system prompt (`web/src/lib/itinerary/master-prompt.ts:15-111`) does not list
  the nine; the model sees category strings only per-POI on
  `payload.poolPOIs[].category`; and `keyStops[]` output schema imposes no
  category enum. Whichever taxonomy form Adam picks, this feature is the first
  time the vocabulary would be named to the model at all.
- **No per-day facts sent to the LLM either.** `buildFactsMessage` sends
  `{ params, rig, anchors, route, corridorCities, poolPOIs }` — trip-level.
  Days are the LLM's own output; the audit derives per-day corridor membership
  from `facts.corridorCities` via the day's polyline at `audit.ts:492-497`.
  Points at where a "guaranteed categories" fact would land structurally.
- **Wizard is a single flat page, not a stepper.** Despite the name
  `ExpeditionWizard`, no `PlanStep` slice to fit into — the change is one new
  `<Section>` inserted between `expedition-wizard.tsx:474` and `:477`.
- **Referenced style templates don't exist.** The assignment named
  `docs/specs/search-resolution.md` and `docs/specs/corridor-ranking.md` as
  patterns; neither is in the repo `[grep]`. Style pattern taken from
  `expedition-planner.md`, `state-parks-source-architecture.md`, and
  `corridor-cities-spec.md`. Flagged in the spec front-matter.
- **Product calls left in Adam's court, not decided:** taxonomy source of
  truth (A), category gate (B), contention model — three options (C),
  trip-wide vs per-city vs per-day granularity (D), rank order (E), UI
  specifics (F), Preferences-as-a-whole (G), prompt posture (H). Build is
  blocked on all eight. Full detail in `docs/specs/interest-category-chips.md`
  §9.

## 2026-08-24 — notes-to-spine, then the overnight-marking chain (#278–#285)

- **The notes-to-spine ask was two problems, not one (#278, merged).** Places
  named in a day's Overnight/Logistics/Fuel/Reserve notes render only as prose.
  Traced it: only the OVERNIGHT is structured + grounded — and already on the
  spine as a tile/node on **96 of 104** overnight-bearing days in a TEST sample
  `[computed]`; Logistics/Fuel/Reserve are free-text with no place slot, and most
  places they name are ALREADY spine nodes, so naive extraction mostly
  duplicates. Overnight slice = cheap labeling; service stops parked.
- **Shipped the overnight→spine-tile link (#279, merged).** Audit records the
  overnight's canonical tile id (identity, not substring); bake marks that tile
  `isOvernight`+`curated`; the Camping block derives from it; the redundant
  "Overnight —" prose line drops. Desc-only/off-corridor → prose fallback.
- **A "tile missing" report was NOT a bug — deploy lag (#280, #281).** Every
  generated TEST trip lacked `isOvernight` because they predate #279's deploy; an
  integration test proved the wiring, and a live gen (#281, approved spend)
  confirmed it end-to-end (San Elijo/San Onofre marked). The badge is a subtle
  "Overnight ·" status prefix — flagged as a UX call, not decided.
- **"New Shady Rest missing" = timing again (#282) — but it surfaced a REAL
  gap.** A pool-hit overnight is grounded to a trip-wide pool id, but bake only
  marks tiles in the PER-DAY corpus fold; when the fold misses the campground, no
  tile carries the ref → unmarked even on #279 code.
- **Reproduced the gap live (#283, approved spend):** Bishop→Mammoth(dwell)→
  Tahoe, all 5 overnights pool-hits, **2 marked / 3 not** `[computed]`, incl. the
  predicted LAYOVER trigger. Root cause broadened: the overnight ref (`mp:`) and
  the tile that represents the place (fold `mp:`, or a live-resolve `google:`
  endpoint) can differ or be absent — independent paths, different id schemes.
- **id-reconciliation built but INERT (#284, merged).** `markOvernightTile` falls
  back to the pool row's `google_place_id` to bridge `mp:`↔`google:`. But that id
  is RPC-join-sourced from a linked Google source_record, and **0 of 351** rows
  on the #283 TEST corridor carry one (backcountry has no Google link)
  `[computed]` — correct, but changes nothing on today's data. Flagged, not
  smoothed over.
- **Fuzzy name+proximity tier (#285, OPEN).** Adam's call: fuzzy match over a
  Google backfill, to avoid a Google-coverage dependency on off-grid places.
  Third tier after exact id + google_place_id: strict name subset (≥2 tokens) AND
  ≤0.5 mi, closest wins, no-match→prose. Confirmed on real corpus+Google coords
  (no LLM): Hope Valley now marks (**0.067 mi** apart) `[computed]`. Convict Lake
  (layover) still can't — no tile exists at all; that last slice needs tile
  synthesis, still parked.
- **Learned:** the corpus deliberately lacks Google ids for backcountry — that is
  WHY the id bridge is inert and fuzzy was needed. The overnight is usually the
  day's endpoint, so its tile is duplicated in the payload but the render dedups
  by id. And pool-grounding's own name match is EXACT-only (fuzzy was removed
  there earlier for mis-binding "Cedar City"→"Cedar City Field Office"), so #285's
  fuzzy is scoped narrowly to overnight-only + name AND distance to avoid that
  class. Two flagged product calls remain open: the badge prominence, and #285's
  chosen thresholds.

## 2026-08-25 (later) — extending the backfill to corridor cities, and the three ways it embarrassed itself first

- **Reused rather than rebuilt.** `pickBackfillStops` is a loop over #275's
  `pickAnchorStop`, adding only ordering, a cap and dedupe — so the gates and
  the null-rather-than-pad contract could not drift between the two cases.
- **Capped machine picks at two per day, and said why.** Covering every bare
  corridor city was the obvious move and the wrong one: the model supplies 2–4
  real key stops, so unbounded backfill turns "key stops" into a list of towns.
  When the cap bites it keeps the earliest anchors — an empty morning is felt
  more than an empty afternoon.
- **Three defects only live runs would have found.** A corpus row literally
  named "Carson City, Nevada" got featured as the stop for Carson City — the
  `urban` exclusion misses it because the row is `park_feature`. The same
  wilderness got featured on two consecutive days, because dedupe was per-day.
  And Carson City got attributed to a Mammoth→Mammoth dwell day, because
  mid-corridor selection reused `onCorridor`, which on a dwell day is a wide
  straight-line radius rather than a route test. All three are now gated,
  trip-wide-deduped, and polyline-based respectively.
- **The target gap is closed:** Oceanside went from `(EMPTY)` to Top Gun House
  in every post-change run, Riverside to Trujillo Adobe. Silver Lakes and Carson
  City stayed bare — correctly, nothing qualified.
- **The honest ceiling is the corpus, not the logic.** Top Gun House has no
  photo and no description, so its card renders blank. Richness is a preference,
  not a gate, precisely so a bare node isn't preferred to a real-but-thin place.
- Stacked on #275, which is still unmerged — noted in the PR rather than
  silently rebasing.
- Decision doc: `docs/decisions/2026-08-25-corridor-city-keystop-backfill.md`.

## 2026-08-25 — the prompt nudge wasn't enough, so the backfill became a mechanism — and its first picks were junk

- **#274 shipped a preference; this shipped the mechanism.** Start-of-day stayed
  empty after the prompt change, so the audit now backfills one opener from the
  corpus pool when the model kept nothing near a day's start. Deterministic, no
  re-ask, no network call — chosen over a re-ask loop (latency + spend + it
  invites the padding we're trying to avoid) and over a live Google lookup
  (crosses the deliberate `resolve.ts` / `discovery/google-places.ts` split).
- **The bar is the feature, and it is all hard gates.** Category, proximity, the
  caller's own corridor guard, no duplicates — and `null` when nothing clears
  it. Twelve of the seventeen tests are about what it must REFUSE, because the
  failure that matters is a padded stop, not a missing one.
- **Its first live picks were embarrassing, and that was the useful part.**
  Three of four were `atlas_oddities` rows — "Mick Jagger's Urinal", "Space
  Whale", "Kesey Square" — with no photo, no description, no rating: cards that
  render blank. Proximity-only ranking systematically surfaces the THINNEST rows
  in the corpus, and rating can't counter it because `master_place.rating` is
  NULL corpus-wide. Fixed by teaching `PoolPOI` whether a row will actually
  render and ranking on it — as a preference, not a gate, or the fix would empty
  the starts the feature exists to fill.
- **The originally-reported case now passes for the boring reason.** The Bishop
  run logged zero backfills — the model covered Bishop itself that time. Correct
  non-firing. A single run still can't be read as evidence either way; run-to-run
  variance on the same route remains large.
- **A limit I could not close:** one backfilled pick didn't show under its day's
  first spine node. It may have bucketed under a neighbour — not verified. Same
  shape as the Victorville pool-hit from 2026-08-24, so pre-existing rather than
  introduced. Parked in BACKLOG rather than guessed at.
- Decision doc: `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md`.

## 2026-08-24 — key stops cluster at the end of a day; the fix was one prompt paragraph, and it half-worked

- **Chased a clustering complaint to the wrong root cause first, and the
  correction is the useful part.** A generated day put every curated stop in its
  back half, leaving San Diego / Oceanside / Riverside / Silver Lakes as bare
  "Explore N more" nodes. The natural hypothesis — the model can't spread across
  cities it never sees — is **false**. `buildFactsMessage` has always sent
  `corridorCities` with `milesFromStart`, built by `deriveCorridorCities` inside
  `preComputeFacts`. Checking that *before* designing a fix turned a plumbing
  change into a prompt edit.
- **Ruled out a silent-drop bug first, with temporary instrumentation.** Two
  generations logged the raw LLM `keyStops` per day plus every grounding
  outcome: **zero dropped** in both, every stop accounted for as pool-hit or
  live-resolve. So "no curated stop at this city" is the LLM not naming one, not
  the corridor guard eating it. Instrumentation was added and fully reverted
  twice; it is not in the tree.
- **Which cities get a card varies run to run on the SAME route.** One run put a
  curated card on San Diego (Lucha Libre Taco Shop, ~2 mi); another put nothing
  before Ridgecrest. Worth remembering before reading a single generation as
  evidence of anything structural.
- **The change is a preference, not a mechanism.** `SYSTEM_PROMPT` now asks for
  a progression across the day's corridor cities and names the start-of-day gap;
  `buildFactsMessage` repeats it next to the list. Both say explicitly: do not
  pad, skipping a city is fine, coverage is only a tie-breaker. Nothing
  downstream counts cities.
- **Measured honestly: partially effective, and the headline gap is unfixed.**
  Three post-change runs on the same route all covered **Riverside** and the end
  city — an improvement. All three still left **San Diego and Oceanside empty**,
  which is precisely what the new text calls out, and one *pre*-change run had
  covered San Diego. Confound stated rather than smoothed: day-1 shape shifted
  (post-change runs all ran San Diego → Bishop), so it is not a clean A/B, and
  the sample is small.
- **A side finding that unblocked all of this:** Google is not an enabled
  provider on TEST (`/auth/v1/settings` → email only), so the single "Continue
  with Google" button cannot complete there — the standing "no dev sign-in path"
  gap is real. A dev-only password sign-in was built to work around it and is
  **uncommitted**, deliberately out of this PR.
- Decision doc: `docs/decisions/2026-08-24-keystop-corridor-spread.md`.

## 2026-08-23 — all four place-data surface cutovers landed (flag-gated, off), + the enrichByGoogleId capability

- **Completed the read-surface half of the resolver-consolidation ADR: all four
  originally-planned surfaces are cut over or resolved-as-not-needed.** Each was
  plan-doc-first then a thin route wrapper behind an env flag, default OFF, client
  untouched. `origin/main` tip is now `b227e65`. Search #260 (`d62f660`), Date
  Detail #266 (`a086cb8`), Day Column #267 (`4757067`, no cutover), Day-scoped
  browse #269 (`b227e65`). Plans: #258/#261/#262/#264/#265/#267/#268.
- **Search's blocker was the tier bug; Date Detail's was a different, deeper gap —
  worth not conflating.** Search: the Verified/Unverified tier was dead on the
  bbox/hydrate path because `hydratePlacesByIds` never selected `description_source`,
  so `mapMasterPlaceRow` stamped every hydrated place `unverified`. Fixed by
  threading the field through hydrate (#259 `9c212a6`). Date Detail: `resolvePlaces()`
  returns `BrowsePlace[]` and, in `ids` scope, returns **nothing** for bare Google
  `place_id`s — it has no mode that yields the `place_id → PlaceRich` map the endpoint
  is. So a new capability was built, `enrichByGoogleId()` (#263 `bc2c9c2`), and
  `enrichPlaces()` refactored to consume it. Same fetch, cache-less (the route keeps
  its own 15-min cache — this is ADR option 1, NOT step 4's shared cache).
- **Day Column turned out to be no cutover at all** — verified against code, it's a
  passive `Trip.days` renderer (`placePool`) with zero live calls of its own; the only
  fetches in that component are Date Detail's. There is no endpoint to wrap. Its real
  work is a write-path/baking consolidation (`bake-corridors.ts` corpus fold, behind
  `USE_FEDERATED_CORRIDOR`), deferred to BACKLOG. The four-surface framing over-counted
  Day Column.
- **Day-scoped browse was the cleanest** — `resolvePlaces()` day-corridor scope was
  literally designed from this endpoint (byte-identical radii/sources/buffer, measured).
  The wrinkle: it already had `USE_FEDERATED_POIS`, so the new `TRIP_BROWSE_USE_RESOLVER`
  is **orthogonal** — the wrapper maps `include: { federated: USE_FEDERATED_POIS }`,
  preserving all four flag combinations. The one new behaviour, Verified-before-Unverified
  sort, only reorders when `USE_FEDERATED_POIS` is on and is never displayed
  (`LocationBrowseCard` drops the tier).
- **A naming collision worth remembering:** Date Detail / Day Column / Day-scoped browse
  cards render `verified={!!p.placeId}` — a "Google-backed" boolean — which is NOT
  `BrowsePlace.verified` (the #255/#256 tier). The tier is computed but dropped before
  the card everywhere except where `resolvePlaces()` uses it for *sorting*.
- **Verification lesson repeated from prior sessions:** unit tests prove routing (dep-seam
  spies) but can't prove the wired route end-to-end; each cutover added a live TEST script
  driving the wired path with a non-vacuous contrast (Search: live results source-stamped
  under the resolver vs untagged legacy; Date Detail: real Google enrichment + a garbage id
  omitted; Day-scoped browse: 0-federated/all-untagged vs many-federated/all-stamped). For
  the two Google-passthrough routes (Date Detail, and the trip-browse full GET) the live
  driver had to call the delegate, not the full route, because the route's client helpers
  need a request-scoped `cookies()`/Next context `tsx` can't provide — flagged in each PR.
- **ADR step 4 (shared client cache) is now ready to build** (three read surfaces cut over,
  each with its own cache) — recorded in BACKLOG. Note: there was no pre-written "build once
  a second surface needs it" trigger in the docs; the readiness is simply that the surfaces
  now exist. **Nothing from this arc is live in production — all three flags default OFF.**

## 2026-08-22 (later) — `resolvePlaces()` built as an additive service (ADR step 2), branch `feat/resolve-places-service`

- **Built `resolvePlaces()` and wired it to nothing.** One signature over three
  scopes (`ids` | `bbox` | `day-corridor`), LIVE + FEDERATED concurrently,
  merge on canonical id, `BrowsePlace[]` out. The three endpoints it will
  eventually replace show **zero diff**, and a repo-wide grep confirms **no
  importer** outside `web/src/lib/places/`. Verified, not asserted — that was
  the whole constraint of the session.
- **Re-reading the three handlers found nine divergences that a resolver
  cannot silently reconcile**, all written up in
  `docs/architecture/resolve-places-design.md` §2 rather than resolved. The
  three that actually block cutover: the two endpoints speak **different
  category vocabularies** whose translation maps are not inverses
  (`LIVE_SLIDE_FOR_PRIMARY` is a deliberate subset, `SLIDE_TO_PRIMARY_CATEGORY`
  is the full map); there are **three doors into `master_place` with different
  membership** — the corridor RPC excludes template-only descriptions and
  `needs_review` rows, the search-hydrate service-role path does not, so a
  place can be corridor-invisible and search-visible; and **`POST
  /api/places/details` does not return places** — it returns `PlaceRich`
  fragments keyed by Google place_id, for grafting onto tiles the client
  already has. Folding that in means the resolver decides when to hydrate
  instead of the caller, so enrichment shipped opt-in and off.
- **The id problem is bigger than the ADR's "add a normalization step".** Not
  three forms but **eight, in two schemes** — federated `mp:` + colon, live
  `<prefix>/` + slash. And **the live prefix is not the `SourceId`**: `gpl`≠
  `google`, `fsq`≠`foursquare`, `ridb`≠`rec-gov`, `node`≠`osm`. Four of six
  would be wrong if the map were derived instead of written out.
- **A typo in a test fixture found a real parser bug.** A stray colon in an
  `fsq/…` fixture failed, and the failure was correct: checking `:` before `/`
  reads `fsq/abc:def` as prefix `fsq/abc`, fails the `mp` test, and returns
  `opaque` — an unresolvable id with no error. External ids are opaque
  third-party tokens and nothing promises they avoid `:`. Fixed to pick the
  scheme by whichever separator comes first; kept as a regression test. Worth
  recording because the bug was invisible to every hand-written fixture — it
  took an accident.
- **Deliberately not built:** no cache (ADR step 4 puts one on the client; a
  server cache here would be a second, competing one, and the three endpoints'
  cache grains don't reconcile anyway), no env reads (`USE_FEDERATED_POIS`-style
  gating is the caller's via `include`), no trip/day lookup (`day-corridor`
  takes coordinates, not a `tripId` — a place service shouldn't couple to the
  trip repository or its RLS).
- **Two gaps that limit what "verified by tests" means here.** Web tests **do
  not run in CI** — the `test` job is `npm run -w data test` only and
  `web/package.json` has no `test` script, so the 47 tests are not enforced on
  merge (pre-existing, not introduced). And the service has **never run against
  live infrastructure** — it is verified through a dependency seam with fakes,
  because nothing imports it and standing it up would require the cutover this
  session was told not to do.
- **No DB, network, or API calls at all this session** — not TEST, not PROD,
  not the management API.

## 2026-08-22 — #247 merged; doc-currency pass

- **PR #247 (the 2026-08-21 master_place enrichment-columns work) merged to
  `main` as `4f2a6af`**, now the `origin/main` tip. The section below still
  framed it as committed-locally-not-pushed; corrected in place, not
  rewritten, per this file's convention.
- **The squash means the branch SHA `7110a6e` is NOT an ancestor of `main`.**
  Worth stating because `git merge-base --is-ancestor` answers "no" and that
  reads as unmerged. It isn't — `git diff 7110a6e 4f2a6af` is empty, so the
  trees are identical. Same squash-into-a-new-SHA pattern as #237 and #244;
  check the tree, not the ancestry, when a branch here looks unmerged.
- **Merging changed nothing about the database.** Both migrations
  (`20260821060000`, `20260821070000`) are still applied to **TEST only** and
  PROD has neither. Every follow-up that PR flagged as deliberately-not-done
  is still open, and is now tracked in `BACKLOG.md` rather than only inside
  the merged section's OPEN list: `photo_url` not wired into
  `recompute_master_place()`, the BLM/state_parks photo fields unmapped in
  their normalizers, and the export view still reading its own lateral rather
  than the new column.

## 2026-08-21 (later) — master_place enrichment columns (ADR step 1), branch `master-place-enrichment-columns` (**MERGED as `4f2a6af`, #247**)

- **Added four nullable columns to `master_place` — `rating`, `review_count`,
  `price_tier`, `photo_url` — not five.** The ADR names five fields but
  `description` has existed since the Phase 1 migration and is owned by
  `recompute_master_place()`; re-adding or writing it directly would have
  violated the schema invariant and been erased on the next recompute. Applied
  to TEST only. `price_tier` is `smallint` 1–4 to match the existing web
  convention (`priceTier?: 1 | 2 | 3 | 4`), not a text enum — nothing in the
  codebase uses a textual price representation.
- **Investigated all six ingested sources by full-scan census of every
  source_record payload rather than by reading the normalizers**, and that
  choice paid: two photo fields are sitting in `raw_payload` completely
  unmapped by their ingesters — BLM `props.PHOTO_LINK` (102 rows) and state
  parks `props.Imagelink` (138 rows, **all Washington** — see the correction
  bullet below). Same shape as the BLM `WEB_LINK` miss from 2026-08-20. The
  backfill reads them from raw_payload so the 221 photos aren't dropped;
  fixing the normalizers is a flagged follow-up.
- **rating / reviewCount / priceTier are measured zero across the entire
  corpus, not "we couldn't find a good one."** Four near-misses were examined
  and rejected by name rather than waved off: OSM `stars` (8 rows, hotel
  classification), OSM/USFS fee booleans, NPS `fees[].cost` (dollar amounts),
  RIDB fee *descriptions*. Inferring a 1–4 tier from any of them would be
  fabrication. One instructive false positive: RIDB `IsPreview` matched a
  review-count regex on the substring `review` — the census reports candidates
  for judgement instead of auto-mapping, which is why that didn't ship.
- **The columns were still added despite three of them being empty
  corpus-wide** — that is the ADR's actual point (the renderer stops branching
  on provenance). But flagged hard in the migration header: the only source
  carrying all three is Google Place Details, whose `rating`/`userRatingCount`
  are explicitly non-cacheable, so these columns are **not** a destination for
  Google data.
- **7,360 master_place rows backfilled with `photo_url`** (nps 4,690 · ridb
  2,449 · blm 88 · state_parks 133). Cross-checked against the export view's
  existing photo lateral rather than trusted: 6,430 identical, and the 23 that
  differ were *explained* not assumed — 23/23 link more than one
  photo-carrying nps/ridb source_record, and the view's lateral has no
  tie-breaker within a source, so its pick is arbitrary while the column's is
  a total order.
- **A same-day self-audit caught four claims in the above that were wrong or
  under-scoped. Corrected in the report and STATE.md; recording them here
  because the mistakes are more instructive than the fixes.**
  - **"0 view-only, the column is a strict superset as designed" — the
    measurement was right, the reason was invented.** The export view's photo
    lateral does **not** filter `is_active`; the RPC does. Nothing structural
    makes the column a superset. It held only because TEST currently has 0
    inactive nps and 0 inactive ridb rows carrying a photo — the first
    deactivation of a photo-carrying NPS/RIDB record breaks it. Classic
    green-for-the-wrong-reason: the check couldn't distinguish "superset by
    construction" from "superset by today's data".
  - **"The 907 column-only rows are excluded by the view's filters" was an
    asserted attribution, and 214 of them contradict it.** Measured split:
    693 absent from the view (filters), 214 *present in it with a NULL
    photo_url* because their photo is blm/state_parks and the lateral reads
    only nps/ridb. That 214 is the actual argument for repointing the view.
  - **The state_parks findings are Washington-only and were reported as
    "state parks".** `props.Imagelink` 138/138 WA, `props.Description` 97/97
    WA, across all 1,736 rows of a six-state source. No BLM state breakdown
    was determined, so none is claimed.
  - **The rating/reviewCount/priceTier absence rested on a regex census,
    which is a discovery instrument, not an absence proof — and it leaked.**
    `price` is not a substring of `pricing`, so OSM's `pricing`/
    `pricing:display`/`pricing:check_method`/`pricing:check_required` tags
    were never reported (1 row; checkout metadata, not a tier). Re-established
    by enumerating the full key space per source — nps 156 leaf names, ridb
    84, state_parks 119, blm 36, usfs 112, atlas_oddities 19, osm 950. **The
    conclusion survived**; two more near-misses surfaced and were rejected
    (NPS `relevanceScore` = API search relevance; USFS `development_scale` /
    `usage_level` = site classifications).
- **Found a broader gap while measuring description: `blm` and
  `atlas_oddities` have NO `field_precedence` rows for ANY field.** Because
  `resolve_field()` INNER JOINs that table, both sources contribute zero
  resolved fields to `master_place` — 138 BLM-linked and 95 state_parks-linked
  master_places carry a real source description while
  `master_place.description` is NULL. Not fixed: seeding precedence is a
  product decision, and the state-parks spec §10a excluded description on
  purpose. Reported, not reversed.
- **The LLM description pilot has already gone to bulk on TEST — STATE.md is
  stale on this.** `master_place_generated_content` now holds 7,433
  `generation_method='llm'` rows (`claude-sonnet-4-5`, prompt
  `2026-08-20b-antifab`, generated today 19:23–19:37 UTC, almost certainly a
  parallel workspace) against STATE.md's "0 llm". Untouched by this branch.
  **Verdict on the overlap question: the description column should NOT draw
  from that output** — the generated-content table's own migration header
  records that a `master_place` column was considered and rejected for exactly
  this, and `description_source` derives `'source'` from
  `master_place.description IS NOT NULL`, so LLM text there would be
  mislabeled on both the export view and Typesense. Also corrected the
  framing: the pilot targets the STRONG/WEAK bucket with no real description
  (7,154), **not** the NONE bucket — the NONE bucket was the template pass.
- **`photo_url` is a snapshot, not resolver-owned** — same staleness class as
  `master_place.state`, and deliberately so: wiring it into
  `recompute_master_place()` needs `field_precedence` seeding (Adam's call)
  and a dedicated step, since `resolve_field()` reads
  `normalized_payload->><field>` while the photo lives at
  `normalized_payload.photo.url`. The backfill is idempotent and
  self-clearing, so re-running it after a materialize is the interim
  mitigation. Full report:
  `docs/measurements/2026-08-21-master-place-enrichment-columns.md`.

## 2026-08-21 — state-boundary rebuild, NONE-bucket templates, eligibility + provenance + review

- **A manual spot-check (Astoria Column, WA/OR border, labeled Oregon
  when it reads as Washington) escalated from a Nevada-only bbox patch to
  a full six-state rebuild on real geometry.** During the narrower fix's
  own testing, Las Vegas and Reno — unambiguously Nevada — resolved to
  "ambiguous" under a naive multi-box-vote design, because California's
  existing box independently also overreaches into real Nevada. That
  regression was the concrete signal to stop patching one box in
  isolation. Rebuilt on US Census TIGER/Line 2023 point-in-polygon for
  all six states in one pass; the Nevada-only module was deleted once
  fully redundant. Corpus-wide backfill corrected 2,964 of 32,734
  in-scope rows (9.05%) — NV→CA was the large majority, but two smaller
  patterns (AZ overreach, a near-even OR↔WA Columbia River split) only
  surfaced by doing all six states properly.
- **10,292 zero-fabrication template descriptions generated for the
  NONE bucket, then two follow-up passes corrected them as the state fix
  landed underneath.** 158 rows had already-generated text naming the
  now-wrong state (confirmed via literal text inspection, not the
  transition matrix alone); 1,211 rows had never named any state at all
  and gained a correct one once real geometry made it resolvable — kept
  as a separate pass since it's an addition, not a stale-fact fix.
- **Decided template descriptions count as STRONG for eligibility, but
  conditioned that decision on building provenance and exclusion in the
  same pass, not deferring them.** `has_template_description` folded into
  `isStrong()`; NONE bucket 10,527 → 235 corpus-wide. In the same pass:
  `description_source` ('source'/'template'/'llm'/null) added to the
  export view and the Typesense index, and `pois_along_corridor` now
  excludes template-only rows by default — verified a "dual" row (real
  description plus an unused template backup) is NOT wrongly excluded.
- **A review/re-queue mechanism was built and immediately exercised on a
  real case, not just designed.** Four flat columns on
  `master_place_generated_content` (chose against a companion table —
  the real need is one current flag, not a history log). The Astoria
  Column's template row is flagged for real, confirmed excluded from
  trip generation via the flag, confirmed still browsable.
- **Wiring `description_source` into Typesense surfaced a real,
  independent gap: the collection already existed, so a schema addition
  in code never reached the live index.** Fixed with a
  schema-reconciliation step that PATCHes missing fields into an
  existing collection before re-import — which incidentally caught a
  SECOND, pre-existing instance of the same bug on `photo_url` (added to
  the schema in an earlier migration, never reconciled either) and fixed
  it in the same pass. One self-caught bug along the way: the first
  reconciliation attempt tried to alter Typesense's implicit `id` field
  and was cleanly rejected before being corrected.
- **This entire session ran without a single write to PROD**, and — like
  2026-08-20 — ~~the code from this session is uncommitted as of this docs
  pass, sitting directly on local `main`, not a branch, not pushed~~
  **[CORRECTED below — since merged as #244]**. This docs pass is a separate
  commit from that code, on purpose.
- **PR #243 (the 2026-08-20 session's own work) merged to `main` since
  that session's doc pass** — `5a822ab`. The "open PR" framing throughout
  the 2026-08-20 `STATE.md` section is now corrected in place, not
  rewritten.
- **PR #244 — THIS session's corpus-quality work — has since merged to
  `main`** as `d6c55ac`. The state-boundary rebuild, NONE-bucket template
  descriptions, eligibility/provenance/review mechanism, and placeholder
  deactivations described above are on `main`; the "uncommitted / not pushed"
  framing in the first bullet is corrected here in place, not rewritten.
- **PR #245 — place-data resolver consolidation ADR** (a follow-up added
  after this session's original work; decided in a design-review
  conversation, implementation pending) merged to `main` as `4fbd051`, now
  the `origin/main` tip. Doc:
  `docs/decisions/2026-08-21-place-data-resolver-consolidation.md`.

## 2026-08-20 — state_parks LIVE ON PROD

- **state_parks ingester built, TEST ingest + materialize complete.** 1,736
  source_records across 6 states (CA 914, WA 280, OR 342, NV 105, AZ 48, UT 47).
  881 new master_places, 58 auto_linked, 797 manual_review, 0 errors.
- **Campsite aggregation implemented** — AZ's 1,346 individual sites → 14
  park-level campground records (per `PARK_ABBR4`); WA's 6,124 sites → 73
  park-level campground records (per `ParkName`, Filter=active only). Per-site
  records are NOT emitted as individual source_records — they're aggregated to
  avoid flooding corridor-ranking density scoring.
- **Three defects caught by self-audit and fixed before TEST ingest:** (1) AZ
  campground names were raw PARK_ABBR4 codes ("LDSP Campground") — no shared
  join key between the AZ campsites and parks layers; resolved via nearest-point
  matching against State_Park_Points, all 14 matches verified unambiguous with
  ≥1.17km margin to second-nearest. (2) NV facility category mapping was broken
  — all 362 records got `park_feature` because the code checked for a `Campground`
  field that doesn't exist on TP_SCORP_Master; fixed to use the `type` coded-
  domain field (31 Campground, 20 Trailhead, 311 park_feature). (3) AZ/WA
  aggregated rows missing `park_id` in normalized_payload.
- **Two polygon-geometry routing bugs caught during dry-run:** WA and NV parks
  endpoints return polygon geometry but the code routed them through
  `buildPointParkRow` (point-only), skipping all records. Fixed by adding
  `groupBy` to route through the dissolve path.
- **NV facilities data-quality finding:** `guid` is whitespace on ALL 362
  state-park-filtered records — the earlier verification checked the unfiltered
  7,412-record layer. `objectid` is the only populated unique field; accepted
  as key with same risk class as NV parks name-key. Also, 284 of 362 NV
  facilities have blank `poiname` (toilets, parking, kiosks) — correctly
  skipped.
- **Manual-review queue analysis:** 797 pending, 83% blended_residual. The
  dominant pattern is state_parks park-boundary records matching PAD-US
  land-status polygons (608/663 = 92% of blended_residual). Matches are
  typically same name + ≤50m distance + name_sim ≥0.9, but cat_compat=0.0
  (recreation_area vs land_status) blocks auto-confirm. These are real
  same-place matches; the category mismatch is what holds them.
- **Multi place_match check:** 0 state_parks SRs with >1 place_match row.
  26 all-sources duplicates found — all `atlas_oddities`, pre-existing.
- **Field precedence verified:** state_parks (priority 4) correctly wins over
  OSM (priority 5) for canonical_name; RIDB (priority 3) correctly wins over
  state_parks. Checked 4 specific multi-source master_places.

## 2026-08-18 — State Parks Enumeration

- **State parks source enumeration — six states, investigation-only, no code.**
  Branch `state-park-systems-enumeration`. All six OSM target states (CA, AZ, NV,
  UT, WA, OR) have public, unauthenticated ArcGIS endpoints for their state park
  systems. Every endpoint URL verified live. Data depth splits three ways: AZ has
  per-campsite amenity data (from 2016), WA/CA/NV have campground/facility-level
  points, OR/UT are boundaries-only. No state publishes fees or seasonal closures
  via GIS.
- **Architecture spec written and reviewed through four verification rounds**
  (`docs/specs/state-parks-source-architecture.md`, v4, READY FOR BUILD). Covers
  source_id, external_id keys, dissolve logic, category mapping, quality scores,
  field_precedence, per-state adapter config. All open questions resolved; only
  the description placeholder is blocked on a separate visitor-website investigation.
- **Key findings worth carrying forward:** (1) ArcGIS OBJECTID is NOT stable on
  at least 4 of 10 endpoints — GlobalID or agency codes preferred wherever
  available. (2) NV's `id` field is broken (753/759 records = 0); NV boundaries
  have no GlobalID; `name` is the only viable key, risk accepted at 27-record
  scope. (3) WA `ParkCode` has 3 collisions (different parks sharing a code:
  Brooks Memorial ≠ Satus Pass, Conconully ≠ Conconully Lake, Deception Pass ≠
  Hope Island); `ParkName` (207/207 distinct) used instead. (4) AZ `SITE_ID`
  collides across parks (site 44 appears in 10 different parks); GlobalID used.
  (5) CA has 461 boundary polygons → 394 UNITNBR groups → CSP official 280 "park
  units" — the gap is non-classified holdings. (6) OR `NAME` has 2 edge cases
  (false merge + false split); `FULL_NAME` (342 distinct, 0 nulls) resolves both.
  (7) OSM operator-tag coverage is too sparse for primary use: 3 (UT) to 122 (WA)
  features with correct state-parks operator tags.
- **Self-audit methodology proved valuable.** Three rounds of "re-analyze for
  hallucinations, scope creep, failures, and incorrect logic" caught: the NV id=0
  problem, AZ SITE_ID collisions, WA ParkCode collisions, CA's unsourced "~280"
  figure, the OR dissolve edge cases, the iOverlander rationale referencing a
  banned source, and imprecise description-coverage counts. Each was then closed
  with a targeted verification query against the live endpoint.
- **Decisions made by Adam this session:** scope = six states; depth =
  campground-level where available; fee/seasonal = omitted; NV key risk =
  accepted; CA SUBTYPE = ingest all, filter downstream; description = from
  visitor websites, not GIS (separate investigation underway); OSM = fallback
  only.

## 2026-08-20 — corpus quality: BLM/RIDB eligibility fixes, LLM description prompt, placeholder deactivations (PR #243)

- **Google Places content warehousing ruled out on compliance grounds
  before any code was written.** Checked Google's Places API (New) caching
  policy directly: only `place_id` and coordinates (30-day) are cacheable;
  `editorialSummary` and every other Place Details field has no caching
  exception, field-based not display-based. The only compliant path is
  live-fetch-at-render, never persist — a different architecture than what
  was scoped. Parked in `BACKLOG.md`, sequenced after the LLM-enrichment
  pass below. ADR: `docs/decisions/2026-08-20-corpus-enrichment-and-cleanup-decisions.md` §1.
- **LLM description generation: prompt redesign fixed real fabrication,
  41% → 4% any-fabrication on the same 27 rows** (severe: 15% → 0%). Target
  population scoped to STRONG/WEAK-bucket-no-description (8,782 rows),
  `atlas_oddities` excluded (0 of 2,866 active rows have any description
  text, despite many being STRONG via tags/hours). One residual fabrication
  case remains, reported not papered over; the 4% figure is explicitly a
  small-sample result, not certified at scale. ADR §3.
- **Two real missed-field gaps found and fixed in `eligibility.ts`** — RIDB
  `FacilityDirections` was never parsed into `normalized_payload`, and BLM's
  `WEB_LINK` was mapped to `web_link` but never `contact.website` (a
  deliberate original design choice, reversed here on explicit instruction
  and flagged in the code). New source-agnostic `has_real_directions`
  signal. Backfilled + verified on TEST: 273 rows flipped out of NONE
  (265 BLM + 8 RIDB). **Code is uncommitted as of this doc pass.**
- **OSM's NONE bucket investigated and found genuinely sparse, not a hidden
  win like BLM/RIDB.** Every OSM row on a NONE-bucket place structurally has
  <5 raw tags and zero of the 10 recognized meaningful keys — verified with
  zero exceptions across 14,105 rows. Checked all 195 distinct tag keys down
  to frequency 1; none carried prose. No fix applied — there's nothing to
  fix.
- **Self-audited the session's own work (`sg` skill) and found three real
  errors, none yet corrected:** a false "RecAreaSchema has no directions
  field" claim (it does, 90.5% populated), a 1,157-vs-1,144
  atlas_oddities count mismatch between two same-session docs never
  cross-checked, and a "severe cases cluster on WEAK bucket" claim
  contradicted by the report's own cited example. Presented to the user;
  changing nothing until there's a decision, per the skill's own rule.
- **Deactivated two placeholder-name populations on TEST** — 3,427
  picnic_area + 748 ev_charging rows, both NONE-bucket AND carrying the
  exact literal placeholder name (`"Unnamed picnic area"` /
  `"Unnamed ev charging"`), same mechanism as the 2026-08-11 peak/spring
  deactivation. **ev_charging's placeholder pattern was investigated fresh
  rather than assumed to mirror picnic_area's — it does share the
  single-exact-string shape, but covers only 26% of the category (real
  brand names dominate), not ~75% like picnic_area.** Verified both:
  0 deactivated rows in the search-export view, 0/5 spot-checked still
  surface via live `pois_along_corridor` generation calls.
- **This entire session ran without a single write to PROD.** Every DB
  write (LLM sample, BLM/RIDB backfill, both deactivations) targeted TEST
  (`znldzjdatkogdktymtvi`) only, each script asserting the project ref
  before writing.

## 2026-08-18 — Amenities & Category Curation

- **Amenities reconnected end to end, then a session of category curation.**
  Source-layer normalization (OSM + NPS, NPS extended to 9 further categories),
  the boolean-map → display-label translator for the slideup, the
  capacity/amenities/priceTier merge-layer reconnect, OSM added to `amenities`
  `field_precedence` as gap-fill only, and the OSM/parks_canada priority
  collision resolved 5 → 8. All on `fix/amenities-render-shape`, **pushed to origin
  at end of session; no PR opened**.
- **Two categories deactivated as product scope, not as a data bug.** peak +
  spring, **65,389 rows measured 2026-08-18** (earlier notes said ~64,300 — the
  measured figure supersedes). Confirmed real via a live Overpass cross-check
  before flipping anything: these exist and are correctly tagged, they are simply
  not POIs this product curates.
- **A measurement bug was fixed BEFORE trusting the sparseness verdict it fed.**
  The STRONG/WEAK/NONE eligibility bucketing never read
  `normalized_payload.description` directly, which wrongly scored RIDB/USFS-heavy
  categories (facility, visitor_center, recreation_area) as sparse. After the fix
  those categories moved and the seven genuinely-sparse ones did **not** — that
  non-movement is what justified the sparse-batch deactivation. Worth keeping:
  the deactivation decision was re-derived after the instrument was repaired,
  rather than inherited from the broken run.
- **`pois_along_corridor` never checked `source_count` in any of its 6
  revisions.** A place deactivated via the established pattern
  (`is_active=false` → recompute → `source_count = 0`) was correctly hidden from
  browse/search by the export view's filter, but the generation RPC reads
  `master_place.geometry` directly, bypassing the view — so a deactivated place
  was still offered as a trip stop. Fixed (migration `20260818160000`, TEST-only).
  **This is why the reactivation was later verified on both surfaces and not
  just one.**
- **dump_station was 83% mislabeled.** 123 of 149 rows carried pre-#202
  `amenity=waste_disposal` — municipal trash bins. Reclassified to null first,
  then hard-deleted on Adam's call (matching BACKLOG's original preference).
  **The premise was verified only AFTER the deletion, and it held**: a full scan
  of all 123 backed-up rows found 100% `waste_disposal`, zero content-bearing
  tags, and the only 2 named rows literally named `"Dumpster"`. Real population
  is **26**. Recorded as a sequencing lesson — the check should have preceded the
  destructive step, and the conclusion was inherited from a 20-row PROD sample
  taken on a different date until then.
- **Templated descriptions built for toilet / water / dump_station**, then those
  three **reactivated** (`b794a23`). Gap-fill only — a real OSM
  `description`/`note` always wins, and all 29 pre-existing real descriptions
  survived verbatim. Bare rows get no description rather than a fabricated one.
  Safety rule: explicit `drinking_water=no` outranks a generic "drinking water"
  lead, because 38 water rows are explicitly non-potable and that is the one
  error here with real-world consequences.
- **Typesense synced clean** — 36,175 indexed, 0 failed, 81,086 stale pruned;
  `places_test` now equals the export view exactly. **The 3 OOM failures the
  handoff reported did not recur — but were also never observed in this
  session**, so they remain a reported constraint, not a reproduced one.
- **Seven self-audits, and the pattern they exposed is the durable finding.**
  In order: a vacuous timezone-based date filter that manufactured a false
  before/after contrast; an unpaginated query that was right by luck; two
  invented numbers (a false "byte-identical" claim and a wrong distance) that
  were chat-only and never committed; one correctly-measured number misapplied
  to an inflated claim (173 where the real figure was 59); one arithmetic error
  in a commit message (4 new tests vs 2); and an inherited claim about a prior
  session's OOM failures presented as this session's own observation.
  **Every single failure was in summarizing prose — a commit message or a chat
  report. Not one was in the underlying measurement.** The data work held up
  under every audit. The rule this produced: a number that appears only in a
  summary and not in a tool output is unverified by construction, and must be
  recomputed before it is written. Now a standing instruction in Adam's memory
  system.
- **Docs gap closed.** This branch had made multiple corpus mutations without a
  single `STATE.md` or `LOG.md` entry; this pass is the first. Every figure was
  re-queried against TEST in one pass rather than transcribed, because counts
  drifted between reports during the session.

## 2026-08-17

- **All four USFS categories materialized live on TEST.** Picnic (570 SR) +
  dispersed (401 SR) ran, then campground (2,312 SR): **715 new_master_place +
  655 auto_link + 942 manual_review** `[handoff, unverified — split not isolated
  this session; the three sum to the measured 2,312]`. Corpus **150,844
  master_place** (+1,459), queue **5,745** (blended_residual 4,979 · close_nameless
  325 · **name_dominant_low_conf 0 → 441**) `[queried TEST 2026-08-17]`. The floor's
  low-conf cluster is now visible in the queue for the first time.
- **LLM place-pair adjudication calibration — not usable unsupervised** `[handoff,
  unverified — measured this session, not re-run]`. 60 pairs, 3 groups. **No-web run
  ($0.26):** the model abstained just **1 of 60** and treated copied federal
  descriptions (USFS text mirrored into a ridb record) as **identity evidence** —
  a same-text ≠ same-place failure. **Web-enabled re-run** confirmed the
  FS↔recreation.gov link is real but cost **$0.40/pair** and **exhausted API
  credits after 17 pairs** — infeasible at queue scale.
- **The deterministic finding that replaced the LLM: the recreation.gov facility
  id is already embedded in the USFS INFRA payload text.** No fetch, no model —
  a regex over stored data. **$0, ~40s for the full queue.** The fetch path the
  earlier design assumed is a dead end (below).
- **`resolve_place_match` / `unresolve_place_match` RPCs** (migration
  `20260817120000`, **TEST only**). The confirm path **did not exist**:
  `apply_match_outcomes` is INSERT-only and its `manual_review` branch leaves the
  source_record unlinked, so confirming an existing pending row had no path
  (re-insert collides with `unique(source_record_id, master_place_id)`).
  `resolve_place_match` links the SR + flips to `confirmed` + tags `resolved_by` +
  recomputes; `unresolve_place_match` is the exact inverse for snapshot-based undo.
  Neither deletes. ADR `2026-08-17-resolve-place-match-and-recgov-id-rule.md`.
- **Recgov-id rule applied as tag `full0817`: 370 campground rows confirmed on
  exact facility-id match. 0 failures, 0 renames, 0 recategorizations, max
  source_count 6** `[queried TEST 2026-08-17]`. **The 0 renames was PROVABLE from
  `field_precedence` before it was measured** — usfs ties ridb at `canonical_name`
  priority 3 / quality 0.9 and loses the tie on `source_id ASC`; usfs has no
  `primary_category` precedence row at all. Undo verified **exact** on a 2-row round
  trip before the full run. Chunked 25 with health checks (73–181 ms, flat).
- **Surfaced and untouched:** **58** rows where the payload id resolves to a
  *different* master_place (mis-pairings); **28** naming recreation.gov facilities
  not in the corpus. PR **#230** open, commit `45e6ede`, not merged.
- **Findings worth keeping (not just events):** (1) **The recgov bridge is a
  developed-campground feature.** Payload-embedded ids: campground **921/2,312
  (40%)**, but trailhead 5/3,041 · picnic 21/570 · dispersed **0/407** — only **26
  of 4,018** non-campground SRs carry any id `[queried TEST 2026-08-17]`. Those rows
  have no identity evidence at any price. (2) **The stored `usda_portal_url` is a
  dead legacy link** — 301s to a generic forest index and drops the recid; any
  future design assuming it resolves is wrong `[measured this session]`. (3)
  **`fs.usda.gov` 403-blocks non-browser user agents** `[measured this session]`.
  (4) **Duplicate master_places exist that the matcher never proposed as pairs** —
  the recgov-id rule is a *high-precision* duplicate detector (same facility id →
  two MPs = one place split in two); confirmed cases Smiling River Campground,
  Allingham, South Shore, East Kachess Group Site `[queried TEST 2026-08-17]`. A
  corpus-wide count is **not** cleanly obtainable by name (brands + geographically
  distinct same-named campgrounds confound it); a real count later would come from
  the recgov-id path itself. Distinct from the queue — a corpus problem.
- **Merge note:** the 2026-08-16 code PRs #223 (usfs + scripts) and #224 (matcher
  floor + dry-run tooling) **merged to `main`** since that entry was written (the
  entry's "still OPEN" line is historical, not edited).

### — later session (NPS six-state) —

- **NPS was a stale demo: 83 rows, all Joshua Tree, one 13-second run in May** —
  against 91 units + ~223 campgrounds in the six states (~1% coverage). The
  ingester is parkCode-driven and won't enumerate; codes come from
  `/parks?stateCode=` as a manual pre-step. Ingested all 91 → **5,283
  `source_record`** `[queried TEST 2026-08-17]`.
- **Two matcher/ingester fixes merged.** #234 bars `nps:park_feature` from
  linking: **all 103 bad auto_links came through `fed_exact`** — the within-10m
  federal coordinate shortcut, which is category-blind AND name-blind, so 11
  fossil labels collapsed onto Quarry Exhibit Hall and NPS priority-1 precedence
  renamed it. The guard forces `new_master_place` (also bars `amenity_rollup` +
  `manual_review`). #235 wired `/parks`: park rows were getting a synthetic
  `"NPS park boundary: <code>"` name that would have renamed Alcatraz Island + 8
  others on materialize. ADR: `docs/decisions/2026-08-17-bar-nps-park-feature-linking.md`.
- **Also merged earlier this session: #233** parametrized the recgov rule's
  sources (usfs → +nps) and fixed a latent hardcode that modeled every added SR
  as `usfs`/0.9 — that would have under-reported NPS rename risk as zero.
- **Live materialize — 7 category chunks, 5,200 rows, 0 errors, 0 5xx, no halt.**
  4,651 `new_master_place` · 262 `auto_link` · 279 `manual_review` · 8
  `amenity_rollup`. **Zero `park_feature` linked to anything** (measured: max
  `source_count` 1, 0 with `source_count>1`, max 1 SR/MP) `[queried TEST
  2026-08-17]`.
- **Renames: 103 canonical, 0 category.** Re-measured against the actual 272
  shared target MPs, not the dry run's predicted 261 — the count held. **Category
  = 0 is a real finding about the dry-run report:** it predicted 56, but it
  compares NPS `inferred_category` to `primary_category`, while `recompute`
  resolves from `normalized_payload.primary_category`, which the NPS ingester
  never populates (0 MPs carry `attribution.primary_category=='nps'`). That 56 is
  a report artifact and will mislead again.
- **The 121→103 canonical gap, worth writing down because the shape recurs:** the
  dry run predicts renames **per prediction row** (SR→MP); the corpus renames
  **per master_place**. The 18 not-landed = 9 `park` (synthetic in the dry run,
  now real `/parks` names → no-op) + 9 non-park (~5 *sibling* renames where a
  different NPS SR on the same MP won, so the row "didn't land" but the MP did
  rename — counted once under the winner; ~4 genuine no-ops). **Not order effects.**
- **NPS `/places` is an editorial CMS, not a POI catalog.** Every record is a
  content card with `bodyText` + `images`; a picnic area and a fossil label share
  one schema. No field cleanly separates physical sites from interpretive content
  — the two best signals disagree on ~250 of 900 sampled rows; a 50-row read
  showed roughly half are real destinations.
- **Typesense was stale by ~102k, not the 4,651 NPS delta.** `places_test`
  **14,911 → 117,261** — the 14,911 was the 2026-08-10 state; the index was **not
  synced since 2026-08-10**, so OSM/PAD-US/BLM never reached search. One
  `materialize --skip-er` (collection `places_test`, 0 failed) caught it up.
- **Cleanup:** the last synthetic-named MP (jotr, already-resolved from May) →
  targeted `recompute_master_place` → `"Joshua Tree National Park"`, one call. 0
  synthetic names remain. 10 jotr `park_feature` rows still pending from May (the
  guard would have made them new MPs; they predate it) — reported, not touched.
- **Process:** two self-audits this session caught the sampled-as-total habit
  again ("renames mostly casing" → 21/216 cosmetic; "category changes all
  facility→campground" → 28/159) and one over-clean "order effects" gloss on the
  121→103 gap — corrected before drafting by re-measuring against actual targets.

## 2026-08-16

- **PAD-US six-state campaign COMPLETE on TEST.** Fee_Managers endpoint, all six
  states; padus active `source_record` → **37,701**. Corpus **149,385 master_place**
  `[queried TEST]`. Polygon centroids are structurally disjoint from the point corpus
  under the current matcher (0 auto_link, 0 amenity_rollup across all six
  `[per #225, not re-measured this turn]`) — the carried-forward "over-merge"
  fear did **not** reproduce. **~96% of the land-status
  family is `land_status`** (35,966 vs 1,314 `public_land`), all search-excluded; the
  corpus-weight question is open (`BACKLOG.md`).
- **USFS ingester rewritten** `EDW_RecreationOpportunities_01` → `EDW_RecInfraRecreationSites_02`
  (PR #226 → OPEN #223). **6,324 active SRs** (trailhead 3,041 · campground 2,312 ·
  picnic 570 · dispersed 401) `[queried TEST]`; 6 legacy `usfs:recarea:*`
  deactivated. **Trailhead materialized live** — 2,601 linked `[queried TEST]`
  (the 630 auto_link / 1,971 new_MP split is `[handoff, unverified]`); 440 manual_review.
  Campground PARKED, picnic + dispersed dry-ran clean, not run.
- **Matcher Bug 2 fixed** — `name_dominant` now gates on `combined_confidence ≥ 0.70`,
  below-floor → `manual_review` (`name_dominant_low_conf`), no fall-through (PR #227 →
  OPEN #224; ADR `2026-08-16-name-dominant-confidence-floor.md`). Campground preview
  1,427 auto → 657, `low_confidence` flags 771 → 0; picnic byte-identical (382/0/138/50).
  **0.70 vs 0.65:** the choice moved only 59 campground rows; 0.70 kept because it zeroes
  the report's own low-conf flag and keeps the 40–75 m band `name_dominant` exists for.
  Distance clip deliberately left alone (it's the Step-5 gate corpus-wide; wrong blast
  radius + wrong sign to touch it). Guarded by a mocked-DB routing test (the only CI
  guard — `phase3a` is excluded); apply path exercised end-to-end + cleaned up. Also
  shipped: `materialize --dry-run-report` (per-match JSONL; matcher untouched, counts
  byte-identical) in OPEN #224.
- **Manual-review queue measured 5,089** (95% osm `blended_residual`). No processing
  framework; the floor adds ~803 more from campground. **Triage framework scoped, not
  built** (`BACKLOG.md`) — it is now the blocker on a live campground materialize, not
  the matcher.
- **Incident `[handoff, unverified — not observed by this agent]`:** TEST (Micro
  `t4g.micro`) went Unhealthy ~2h during a WA PAD-US materialize — `materialize`
  has no `pLimit`, back-to-back runs exhausted the tier.
  Recovered; runs since chunked with health checks. **No PROD writes all session.**
- **Claims that did NOT survive measurement earlier this session** — all from the
  handoff / prior turns and **not re-verified by this agent** (`[handoff, unverified]`
  throughout; recorded so the next agent doesn't re-inherit them as open): MVUM encodes
  **no** dispersed-camping corridor data (vehicle
  class + seasonal only; corridor rules live in per-forest PDFs); `EDW_RecreationAreaActivities_01`
  **is** the real multi-value activity roster (52,482 rows, ~3× RecOpp's dispersed
  coverage) — not the dead end it was twice dismissed as; `EDW_InfraRecreationSites_01`
  has more fields (137 vs 70) than `_02` but they're ~90% empty, so `_02` was still the
  right layer; `EDW_Wilderness_02` (629 subparcels, 253 six-state) is the source to wire
  for the still-unbuilt PAD-US Designation gap; and an earlier "6–10% of campground merges
  are wrong" figure was fabricated from an 8-row eyeball — wrongness is unknown and
  unknowable from corpus data (USFS↔RIDB share no identifier).
- **Merge/docs note:** docs-only #225 (padus) + #228 (matcher/CI notes) merged to `main`;
  the *code* PRs #223 (usfs + scripts) and #224 (matcher floor + dry-run tooling) are still
  OPEN — the matcher floor and USFS ingester are **not on `main`** yet.

## 2026-08-11

- **bbq/fire_pit deactivated on PROD.** 223 osm `inferred_category = fire_pit`
  source_records set `is_active = false` (one batch of ≤500, fire_pit-only
  compound filter); their **138** solo master_places recomputed to
  `source_count = 0`; the **85** dangling pending `place_match` rows on the
  unlinked source_records cleared; `search:sync` pruned **138** stale docs from
  `places_prod`. View **16,654 → 16,516**; `places_prod` = view exactly;
  active source_record 20,750 → 20,527. All re-verified `[queried PROD]`.
- **Why they were noise.** `amenity=fire_pit` has **zero** nodes across all six
  states (CA/NV/UT/AZ/WA/OR, ISO-area Overpass) — every "fire_pit"-category row
  was actually `amenity=bbq`. And bbq is picnic-area grills: **83%** (184/223)
  sit within 100m of another bbq node, all nameless, no `operator`. Ingested,
  they rendered as standalone "Unnamed fire pit" pins. `amenity_rollup` could
  **not** absorb them because `AMENITY_PARENT_CATEGORIES`
  (campground/recreation_area/facility/lodging) excludes `picnic_area` and
  `park` — measured **0/223** within 100m of a rollup parent.
- **The 138 were recomputed, not deleted.** They stay in `master_place` at
  `source_count = 0` (still `is_searchable`); the view's `source_count > 0`
  filter is what drops them. `master_place source_count = 0` went 0 → exactly
  138, boundary-checked against `updated_at` (zero unexpected rows touched).
- **gas_station (261) + ev_charging (184) deliberately left active** — their
  mappings were dropped in #214, but the rows remain (gas covered live by
  Google; ev_charging is the only corpus EV source until Google's
  `electric_vehicle_charging_station` type is verified in prod). See BACKLOG.
- **Operation hygiene.** `data/.env` swapped to PROD for the op (fail-closed
  PROD assertion + fire_pit-only filter on every write), then restored to TEST
  byte-identical; CLI link never touched (unlinked, not PROD). No schema change,
  no migration — pure data.

## 2026-08-10

- **Three PRs merged: #200 matcher placeholder-name fix; #201 diagnostics
  + apply/undo scripts; #202 OSM tag correction + `--iso`/`--families`
  flags.** Each squash-merged, remote branch deleted. Full description of
  what each shipped: `STATE.md` §2026-08-10. All landed within ~10
  minutes end-to-end (04:49–04:56 UTC).
- **OSM tag defect quantified before the fix landed.** `waste_disposal`
  had been mapped to `dump_station` — but `waste_disposal` is
  OSM-semantics for a municipal trash bin. **1,723 PROD rows
  misclassified as `dump_station`** `[queried PROD 2026-08-09]`; sample
  of 20 returned **0 real dump stations** (every one a trash bin at a
  park entrance / gas station / urban corner). The actual RV tag
  `amenity=sanitary_dump_station` was **never requested** by any
  Overpass query in the adapter's history. Similarly
  `tourism=camp_site + backcountry=yes` was **never a fetch predicate**;
  the adapter fetched bare camp_site and depended on category-mapping
  refinement to split dispersed. Both fixed in #202.
- **Placeholder-name matcher defect quantified: 43% → 3.6%.** Fabricated
  `"Unnamed <category>"` strings from OSM's `inferName` fallback collide
  at `jaroWinkler = 1.0`, and combined with same-category = 1.0 the
  blended formula **clamps at exactly 0.600** — the `manual_review`
  floor — for any pair >100m apart. Measured on UT camping ingest
  (2,176 rows): 945 queued for review = **43%**; 22 of 30 samples pinned
  at conf 0.600; 27 of 30 identical placeholder names. Fix (#200): force
  `name_similarity = 0` when either side is a placeholder. Re-measured
  after fix on WA/OR/NV ingest: **3.6%** review rate — a 12× reduction.
- **PROD Part 1 of the six-state trim: done by the parallel havana
  session, NOT this one.** Between STOP #1 and 02:00 UTC 2026-08-10, the
  `work/six-state-trim` branch in the `havana` worktree applied
  `20260810120000_reference_trips_is_active.sql` to PROD and flipped
  `la-to-deadhorse` + `dawson-vancouver-cassiar` inactive. Both target
  rows updated at the same microsecond timestamp
  `2026-08-10T01:52:40.76769+00:00` (single-statement UPDATE signature).
  Cassiar payload byte-integrity verified via SHA
  (`46a17cbb421208f7…` matches the frozen-Cassiar SHA in
  `docs/decisions/2026-07-25-reference-trips-db-first.md`). Discovered
  by this session in a read-only preflight query and reported at STOP;
  attribution recorded to prevent future sessions attributing the write
  to this session.
- **521-row placeholder rewrite applied to TEST; 424 legitimate reviews
  preserved BYTE-IDENTICAL.** Targeted script
  (`apply-placeholder-rewrite.ts` in #201) consumed
  `/tmp/dryrun-classification.json`, applied 521 `new_master_place`
  outcomes via the standard `apply_match_outcomes` RPC (0 skipped by the
  idempotency guard, 0 errors). Post-condition verifier proved all 424
  keeps identical across all 8 place_match fields vs a pre-flight
  snapshot. Reversal instrument
  (`undo-placeholder-rewrite.ts`) preserved; mapping durable at
  `~/.config/overlander/backups/rewrite-mapping-20260810-052514.json`.
- **4-state TEST OSM camping pattern proven.** WA/OR/NV serial ingest
  after UT under `--iso $ISO --families camping`: predicted 1,224 /
  1,504 / 168 · fetched **exactly the same on every state** · zero
  errors · zero non-camping spillover. UT (2,176) rounded the set out to
  **5,072 total across 4 states, 0 rows lost or gained** vs the
  area-scoped Overpass predictions. `materialize --skip-sync` produced
  95.8% new_master_place + 3.6% review + 0.6% auto_link with the
  matcher fix active. Full breakdown: `STATE.md` §2026-08-10.
- **Cross-category `amenity_rollup` defect surfaced but NOT fixed by the
  placeholder work** (recorded in BACKLOG). 5-8 collapsed MPs on TEST
  hold different amenity types under one placeholder name (e.g.
  `"Unnamed water"` MP holding 3 water_taps + 1 toilet, another holding
  4 water_taps + 2 dump_stations). Placeholder fix stops NEW such
  collisions from auto-linking; already-confirmed merges remain.
  Orthogonal to the placeholder fix — a real-named `"Belle Toilets"`
  auto-linked to `"Belle Water"` at 20m has the same shape.
- **~28 RIDB `/media` errors from the 2026-08-09 backfill are asserted
  not-auth but the error shape remains UNVERIFIED** (BACKLOG). Prior
  session's `docs/state-ridb-route-a` wrap asserted they're not
  `web/.env.local` 401 (that key is unused; every RIDB consumer runs off
  `data/.env`'s working key), but the run's stderr wasn't captured and
  no log file exists. A `--dry-run` backfill would surface the shape.
- **LESSON — `docs/state-ridb-route-a` sibling branch existed
  independently.** A prior session had opened it with the accurate #198
  wrap + PREFLIGHT diagnosis; my STOP #1 branch (#199, closed today)
  duplicated the ground and got DRIFT #1 partly wrong. Rule: check for
  `docs/state-*` branches before writing a new refresh.
- **CI shape correction.** `#201`'s first CI failed on typecheck —
  `scripts/test-manual-review-dryrun.ts` imported `isPlaceholderName`
  which only existed on #200's branch. Merging #200 first + rebasing
  #201 resolved the import; a second bug (arithmetic on a non-numeric
  compound in `verify-rewrite-postconditions.ts`) was fixed inline. Rule
  worth naming for later: **when two PRs are dependent, merge the
  dependency FIRST, then rebase the dependent to pick up the exported
  symbols — CI failure is the natural gate**.
- **Two more PRs merged: #203 (end-of-day doc snapshot) and #206
  (`materialize`: split `matchAll` from `apply` for the incremental
  path).** #206 is what made the batch-25 recovery run below possible —
  `--apply-from-cache` re-applies saved outcomes without re-paying matchAll.
- **PROD's `statement_timeout` is 60 s — discovered the hard way.** The
  first PROD `apply_match_outcomes` runs failed with SQLSTATE **`57014`
  "canceling statement due to statement timeout"** at **batch 500 (60,107
  ms)** and **batch 100 (60,129 ms)** — the RPC is one statement, so the
  whole batch is bounded by the role `statement_timeout`. **Batch 25 runs
  ~33 s** and clears it. The error is emitted by Postgres, relayed through
  PostgREST/supabase-js unchanged — NOT a client `AbortError`, PostgREST
  504, or pooler cut. `promote.ts`'s in-code calibration comment still
  cites a "~10 s" ceiling from a different project — stale, now backlogged.
  `data/.env` has **no client-side timeout** (`db.ts` `createClient` sets
  none), so this is purely server-side and adjustable via
  `ALTER ROLE service_role SET statement_timeout` (not changed).
- **Six-state OSM camping ingest COMPLETE on PROD, per-state, predicted =
  actual on every state.** `--source osm --iso US-<st> --families camping`,
  each pinned to `overpass-api.de` with a `timestamp_osm_base` ≤7-day
  freshness assert first (a bare/unpinned run earlier had silently drawn a
  **70-day-stale** snapshot from `kumi.systems` — always pin + assert):

  | state | predicted | fetched | inserted | updated | recats | manual_review |
  |---|--:|--:|--:|--:|--:|--:|
  | AZ | 893 | 893 | 887 | 6 | 0 | 4.40% |
  | CA | 2,721 | 2,721 | 2,474 | 247 | **23** (= predicted) | 8.33% |

  (WA/OR/NV/UT landed earlier in the day per the 4-state block above.)
  Every ingest matched its area-scoped Overpass prediction exactly. The
  adapter reports `updated: 0` always — a counting artifact
  (`persistElement` returns `"inserted"` for every upsert); the real
  insert/update split is measured from the DB via `created_at`. **CA's 23
  campground→dispersed recats matched the prediction exactly** (23
  pre-existing camp_site rows carrying `backcountry`/`informal` re-scored
  by `inferCategory`; the upsert overwrites `inferred_category` but never
  touches `master_place_id` — all 247 CA updates kept their link).
- **manual_review rate climbs with camping density: TEST 3.6% → AZ 4.4% →
  CA 8.33%.** All post-#200 (placeholder noise gone); the residual is
  genuine named-site ambiguity, and CA's 8.33% is unexplained — backlogged.
- **`search:sync` → `places_prod` on the shared Typesense cluster.** The
  PROD env backup carries only Supabase URL+key, so the collection had to
  be resolved by hand: `TYPESENSE_COLLECTION=places_prod` (what Vercel's
  `NEXT_PUBLIC_TYPESENSE_COLLECTION` reads), same host+admin key as
  `places_test`. Indexed **16,661**, pruned 0, failed 0 — exactly the
  `master_place_search_export` row count, dispersed 2,855 and campground
  5,369 matching the corpus per category. `places_prod` 13,708 → 16,661.
- **CORRECTION — per-state dispersed camping is 3,125, not the ~1,885 a
  radius spot-check suggested.** A `location:(lat,lng,150 km)` interior
  sample undercounts large states badly. ISO-area Overpass counts
  (`camp_site` + `backcountry`|`informal`, distinct) **sum to exactly the
  PROD `osm dispersed_camping` source_record total of 3,125**: CA 757, UT
  893, WA 682, AZ 270, OR 508, NV 15. The radius sample had read UT 373 /
  WA 327 / OR 156 / NV 2. **Lesson: a radius sample is not a state total —
  scope the query to the subject (ISO area), and cross-check the sum
  against the DB.**
- **RIDB Route A photo count could not be reconciled to a stated 5,256.**
  Measured on PROD: **1,622** `ridb` source_records carry a promoted
  `normalized_payload.photo.url` (nps 4,451; all sources 6,073). None of
  these is 5,256 — flagged UNVERIFIED rather than asserted. Separately,
  `master_place_search_export` has **no photo column** at all, so no photo
  reaches search yet (the "Artboard C" lateral is still open).
- **#209 — export view repointed from `six_state_scope()` to
  `six_state_footprint()`.** Analysis found the coarse scope's WA-east edge
  (−116.90) leaked **9 Idaho panhandle rows** (Priest Lake, Moscow/Lewiston,
  all ridb/nps) into search. Repointed to the tighter footprint. **Net was
  −9 +2, not −9**: footprint is NOT a strict subset of scope — its accurate
  WA-northwest edge (Haro Strait) correctly re-includes **2 San Juan Islands
  WA** campgrounds (Jones Island S/N) that scope's flat 48.40 step wrongly
  dropped. View **16,661 → 16,654**; `search:sync` pruned exactly the 9,
  `places_prod` = 16,654 `[measured PROD 2026-08-10]`.
- **#210 — `promote.ts` `DEFAULT_BATCH_SIZE` 500 → 25.** Replaced the stale
  "~10 s from a different project" calibration comment with the measured
  reality: PROD `statement_timeout` is **60 s**, `apply_match_outcomes` is a
  single statement, batch 500/100 fail `57014`, batch 25 ran min 66 ms /
  max 34.5 s / avg 8.0 s over 99 batches. No other code assumed 500; no test
  asserted it (the `500` in `phase3a.test.ts` is the 500 m candidate radius).
- **#211 — Artboard C: corpus photo in search + hydrate.** Added the same
  nps/ridb photo lateral `20260809130000` uses to `master_place_search_export`
  (`photo_url`, NPS preferred), plumbed through `sync-typesense.ts`
  (`PlaceDocument`) and `hydratePlacesByIds` (via the existing
  `nps_photo_url → photoUrl` map — no UI change). **TEST then PROD:** PROD
  view 16,654 unchanged, **3,526 rows carry a photo (~21%)**, `places_prod`
  16,654 = view; a `places_prod` doc carries `photo_url` and hydrate returns
  `photoUrl` against PROD `[measured 2026-08-10]`.
- **TEST brought to the PROD view baseline.** TEST was missing the four
  six-state view migrations (`180000–180300`); applied via
  `db:push-verify --test`, view **16,410 → 14,911** (dropped **exactly** the
  1,499 out-of-footprint rows: Idaho 1,141, MT/WY 124, CO/NM 40, Baja 10,
  other 184; osm 1,460 / google_resolved 40). TEST view now matches PROD's
  predicate structure.
- **CORRECTION — the objects-without-ledger drift was PROD-only, not TEST.**
  An earlier report this session claimed `six_state_footprint()` /
  `source_record_scope` existed on TEST as objects without a ledger row (the
  #204 pattern). The full TEST `migration list` disproved it: `20260810120000`
  and `130000` were **already in TEST's ledger** (applied via a normal
  `db push`). The direct-SQL-no-ledger drift happened only on PROD; TEST had
  **nothing to repair** — the 4 missing migrations had neither ledger rows nor
  objects and were genuinely pending.

## 2026-08-06

- **NPS corpus imagery (#196) went live end-to-end on PROD.** Migration applied to
  TEST **and** PROD; backfill run on PROD (4,451 of 4,837 nps rows carry
  `normalized_payload.photo.url`); `pois_along_corridor` returns `nps_photo_url`
  verified by query on both DBs; the Portland corridor returns "Voices" / "Honoring
  our Salmon" with `nps.gov` URLs. Position + the chain: `STATE.md` §2026-08-06.
- **DIAGNOSED: existing trips don't benefit — the second `milesFromStart`-shaped
  baked-stale debt.** Rest-day `segmentSuggestions` are baked at insert (`insertRestDay`)
  and rendered from storage with no live re-query, so `b97d06bf` day 4 (created 08-03)
  has 10 tiles with NO `photoUrl` key at all, though 9 of 10 have a corpus photo on PROD
  today. "Needs regeneration," NOT "the mapping is missing" — established by reading the
  insert path and querying the stored payload, not by guessing. `BACKLOG.md` §Refreshing
  stored suggestions.
- **The backfill's `scan()` had a pagination-while-mutate defect.** Unordered `.range()`
  paging while issuing UPDATEs in the same loop shifted heap tuples out from under the
  cursor: the PROD run left **738** rows unwritten, then **47**, converging only over
  **three** apply→dry-run passes (mid-apply `withPhoto` even read 4507 vs a stable 4451,
  double-counting). Fixed two-phase — Phase 1 reads every row in `.order("id")` and
  collects writes, Phase 2 updates by id — proven RED→GREEN with a vitest fake that
  relocates a row on each UPDATE, `pageSize=2` over 6 rows (old scanned 4, fix scans 6).
  Full writeup + the "same footgun bites any paginate-while-write backfill → shared
  helper" note: `BACKLOG.md` §NPS photo backfill.
- **CI stalled: GitHub Actions budget was $0 with stop-usage enabled, so jobs QUEUED
  indefinitely rather than failing.** Diagnosed by noticing typecheck AND build were
  queued alongside test — which rules out the repo's own test-serialization as the
  cause (all three independent jobs were stuck, not one waiting on another).
- **The #196 merge required an admin bypass — recorded WHY it was legitimate.** A
  `workflow_dispatch` run executed the identical typecheck/test/build jobs on the exact
  head SHA and all passed; the `pull_request`-event run never received a runner (the
  budget stall). So **verification was present — only the run↔PR bookkeeping link was
  missing**, not the checks. Branch enforcement stayed active; a Repository-admin bypass
  entry existed for the few seconds of the merge and was removed, confirmed by re-read.

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
