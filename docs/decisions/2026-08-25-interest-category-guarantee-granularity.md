# Decision — interest-category guarantee granularity: D-B (per-city)

**Status:** DECIDED (Adam) + BUILT 2026-08-25. Resolves blocker **D** of
`docs/specs/interest-category-chips.md` §9. Formalizes the report-only brief
`docs/specs/interest-category-chips-D.md` (left in place as historical record).

## Context

The Interest-Category-Chips feature lets a user guarantee that a trip's stops
span certain kinds of place (`scenic`, `food`, …). "Guarantee" = **priority
within the existing per-day backfill cap** (`MAX_BACKFILLS_PER_DAY = 2`), NOT a
new budget — spec §0. The mechanism is the #274/#275/#276 anchor backfill:
when the LLM's own key stops miss coverage near an anchor, a stop is picked
from the in-memory corpus pool (`facts.poolPOIs`) the model was already given —
deterministic, no LLM re-ask, no network.

Contention model (blocker **C**) was already resolved by Adam to **Option A**:
guaranteed categories win the cap first, openers fill any remaining slots.

Blocker **D** — the granularity of the guarantee — was open: per-day, per-city,
or trip-wide. The brief (`interest-category-chips-D.md`) expanded all three with
edge cases and *recommended* D-A (per-day) for predictability. **Adam chose D-B
(per-city)** instead.

## Decision

**D-B — per-city.** Every corridor city (and the day-start anchor) the route
passes gets its OWN shot at surfacing each interest the user selected. A
category is "covered" at an anchor when a kept stop of that category sits within
`ANCHOR_NEAR_MI` (25 mi) of it; the rest are that anchor's outstanding
guarantees. Because the missing set is computed **per anchor**, the SAME
category can be guaranteed at more than one city on a day — the density D-B was
chosen for.

**Rationale (confirmed with Adam's framing):** D-B favours **density around the
actual cities a traveller passes** over D-A's even one-per-day spread. A user
who turns on `scenic` wants something scenic at each town they roll through, not
merely one scenic stop somewhere on the day. The tradeoff — the 2-slot cap bites
on multi-city days, so trailing cities silently fall through — is accepted:
it only happens because the user opted into those categories, and a bare node is
always an acceptable outcome (the null-rather-than-pad contract stands).

### What shipped (spec §11 steps 5–7)

- **Step 5 — per-anchor missing computation** (`audit.ts`, the backfill block).
  For each anchor (day start + each mid-corridor city on the day's polyline),
  `missingAt(coords)` = the user's pool-side guaranteed categories minus those
  already covered by a kept stop within `ANCHOR_NEAR_MI`. Coverage is attributed
  from **pool-hit categories** (a `SlideCategoryKey` directly); a live-resolved
  keyStop carries a raw Google type, of which only `restaurant`→`food` maps to a
  guaranteed category (`RESOLVED_TO_GUARANTEE`). Other resolved types don't count
  as coverage — biasing slightly toward an extra (density) pick, which is D-B's
  intent, bounded by the cap + dedupe. Each anchor carries its own
  `missingCategories` set on the `BackfillAnchor`.

- **Step 6 — `pickGuaranteedStop`** (`anchor-backfill.ts`), a NEW pure selector
  alongside `pickAnchorStop` (not a replacement). Same shape and same gates
  (dedupe on id/name, `isCityTautology`, `ANCHOR_NEAR_MI`, `onCorridor`) and the
  same `rank`, but over its OWN broader `GUARANTEE_CATEGORIES` gate, filtered to
  the categories the user selected AND this anchor is missing. Takes
  `pool: PoolPOI[]` as input — no data-fetching of its own, **NOT** routed
  through `resolvePlaces()` (that merge is a deferred BACKLOG item —
  "`preComputeFacts` → `resolvePlaces()` migration").

- **Step 7 — two-phase `pickBackfillStops`** (Option A). Phase 1 iterates
  anchors in traveller order and, per anchor, per outstanding category, calls
  `pickGuaranteedStop` up to the shared cap. Phase 2 is the existing opener loop
  for any slots left. Both phases share the `taken` dedupe set and the one
  `MAX_BACKFILLS_PER_DAY` cap. An anchor served by a guarantee is not also given
  an opener. Backward-compatible: with no `missingCategories` on any anchor,
  phase 1 is a no-op and behaviour is byte-identical to before (all 37
  `anchor-backfill` unit tests, including the 25 pre-existing, pass unchanged).

### The `urban` gate (spec §5 / §9-B)

`urban` was excluded from the opener gate `OPENER_CATEGORIES` because featuring
a town under its own node is a tautology for an *unrequested* opener. That
objection does not hold when a user **explicitly** guarantees `urban` — they
asked for a town-flavoured stop. **Chosen: give the guarantee selector its OWN
broader gate** (`GUARANTEE_CATEGORIES`), NOT widen `OPENER_CATEGORIES`. This
resolves `urban` for the guarantee without regressing the opener path (which
would otherwise start featuring towns under their own nodes unprompted). It is
also the path spec §9-B implicitly picked ("guarantee-selector uses its own
broader gate"). `urban` still passes `isCityTautology`, so the guarantee
surfaces a DISTINCT urban POI near the anchor, never the anchor town itself.

`GUARANTEE_CATEGORIES` = the five openers (`scenic`, `food`, `oddity`,
`attraction`, `camping`) **plus `urban`** — 6 pool-side categories.

## Deviations / open threads called out (per the ask, not dropped)

- **`fuel` and `overnight` are EXCLUDED from `GUARANTEE_CATEGORIES`.** Spec §11
  step 6 is explicit: *do not merge fuel/overnight wiring until B.1/B.2
  resolve.* `fuel` is handled by the separate live-resolve path A
  (`fuel-live-resolve.ts`) and is inert in this pool-only mechanism (B.1);
  `overnight` would duplicate the dedicated per-day overnight slot the
  #279–#285 chain owns (B.2). Both stay out until those blockers resolve. This
  is a deliberate deviation from a naive "all 8 categories" reading, flagged.

- **Rank order (blocker E) is the spec's RECOMMENDED default, not an Adam
  pick.** `pickGuaranteedStop` ranks on-category (implicit — the filter admits
  only outstanding categories) → richness (`hasPhoto`/`hasDescription`, reusing
  `pickAnchorStop`'s `rank`) → proximity. A one-line change if a different order
  is wanted. Flagged.

- ~~**Cross-category saturation under the cap.**~~ **CORRECTED 2026-08-25
  (later same day) — this was misdiagnosed. The dominant symptom was a SCOPE
  BUG, not the category-monopoly tradeoff.** The cap was written
  `MAX_BACKFILLS_PER_DAY` and enforced per-DAY: phase 1 broke at
  `picks.length >= max` across ALL of a day's anchors, so the traveller-first
  day-START anchor routinely consumed the whole day budget and every
  mid-corridor city that day got ZERO — despite real candidates existing.
  Measured on trip `ab146c1d` (San Diego → Reno): the two day-1 picks landed at
  the San Diego start (scenic + camping), and Oceanside / Riverside /
  Silver Lakes were starved even though `pickGuaranteedStop` returns a real
  candidate at each `[measured 2026-08-25]`. The D-B spec is per-CITY density,
  so this was a **correctness bug against the spec**, not a tuning tradeoff.
  **Fixed:** renamed and rescoped to `MAX_BACKFILLS_PER_CITY` — each anchor
  (start, mid-corridor, end) carries its OWN budget of 2, with no day-level
  break in either phase. Re-run on the same trip's real pool: all four day-1
  anchors now receive their own picks (2 each). Locked by
  `anchor-backfill.test.ts` ("each city gets its OWN budget of 2 — an early
  anchor does not starve a later one").
  - **The genuine category-monopoly case still exists, now at per-CITY scope:**
    within a single city's 2 slots, one selected category iterated first can
    take both before another gets a turn (a `[scenic, food]` city where scenic
    ranks first twice). Still flagged; a future refinement could round-robin
    categories within a city. Not built.
  - **Consequence to weigh:** removing the per-day ceiling means a multi-city
    day can now surface materially more machine picks than before (up to 2 ×
    cities passed, plus openers). The old per-day cap's "a key stop at every
    town is a list of towns" concern is now bounded per-city, not per-day — a
    deliberate consequence of honoring the D-B density spec, flagged here.

- **Coverage attribution is pool-hit-first.** Live-resolved keyStops (raw Google
  types) mostly don't count as category coverage (only `restaurant`→`food`),
  biasing slightly toward an extra pick. Aligned with D-B's density intent;
  flagged.

## What is NOT in scope

- ~~The user-facing **chip UI** (blocker **F**).~~ **RESOLVED 2026-08-25 (later
  same day).** The wizard now renders a multi-select chip row for the 6 pool-side
  categories in the "Interest categories" section, alongside the fuel checkbox —
  `GUARANTEE_CHIP_CATEGORIES` (`web/src/lib/plan/guarantee-categories.ts`),
  drift-locked to `GUARANTEE_CATEGORIES` by `guarantee-categories.test.ts`.
  **Deviation flagged:** the driving task asked for "all 8 categories besides
  fuel", but that premise treated `overnight` as absent from the taxonomy. It is
  not — `overnight` is the `SlideCategoryKey` name for the display category
  `hotel` (isomorphic via `palette.ts`). So `hotel`(=`overnight`) and `interest`,
  both excluded from the backend gate, get NO chip (a chip that silently no-ops
  would mislead — the same reasoning that kept the fuel PR from shipping a
  "1-of-8-working" row). The honest, backend-serviceable set is 6, not 8.
- Path A / the Mapbox fuel swap (unrelated).
- `preComputeFacts` → `resolvePlaces()` migration (deferred BACKLOG item —
  the guarantee ships against the existing pool source deliberately).

## Feature flag

`INTEREST_CATEGORY_GUARANTEE` — kill switch, ON by default
(`!== "false"`), same posture and rationale as `KEYSTOP_ANCHOR_BACKFILL`: the
whole wizard is gated behind `ENABLE_PLANNER_WIZARD` (which prod never sets), so
shipping OFF would ship a fix that does nothing. Pool-only, no network — which
is why it does NOT share the fuel path's default-OFF posture. The guarantee
fires only when `guaranteedCategories ∩ GUARANTEE_CATEGORIES` is non-empty.

## Testing / verification

- **Unit (deterministic, CI):** `anchor-backfill.test.ts` — 37 tests pass
  (25 pre-existing unchanged + 12 new): the `GUARANTEE_CATEGORIES` gate, the
  `urban` gate difference, interest/fuel/overnight exclusion, on-category-only
  filter, the shared gates, and the two-phase contention (guarantee wins the cap
  first, per-city density, shared cap, no double-serve, the moved bare check,
  guarantee-only mode). Full itinerary suite: 180 tests pass. Local gate exits 0
  on both workspaces (`npm run -w web typecheck`, `cd web && npx next build`,
  `npm run -w data typecheck`).

- **Live TEST corpus (read-only, no LLM):**
  `web/scripts/verify-guarantee-percity.ts` drives the REAL `preComputeFacts` +
  `auditItinerary` against TEST (`znldzjdatkogdktymtvi`) with a synthetic
  empty-keyStops itinerary so the guarantee fires. Confirmed on two corridors
  (San Diego→San Francisco, Sacramento→Reno): a `scenic` guarantee produced two
  `guaranteed` scenic picks at two DISTINCT corridor cities on the day
  (per-city density), the control run produced opener-only picks, and the
  guarantee won the cap over the opener (Option A). Read-only — no corpus
  mutation, no cleanup. NB the TEST corpus is scenic-heavy (e.g. one corridor
  had 2 `food` rows, another had 0), so a `food`/`oddity` guarantee is
  data-limited there — a corpus-coverage reality, not a mechanism defect.

## Consequences

- A user who selects a pool-side interest category now gets it featured at each
  corridor city that lacks it, up to the 2/day cap, from the corpus pool.
- On multi-city days the cap bites; trailing cities and later-selected
  categories can silently fall through (accepted, D-B).
- No new external cost — pool-only, no network calls.
- The chip UI and the fuel/overnight gate remain open threads (see above).

## Follow-up 2026-08-26 — anchor GRANULARITY fix (audit ↔ bake spine alignment)

**Status:** BUILT 2026-08-26. Distinct from the per-day→per-city cap fix above.

**Bug.** Even with the per-city cap, some rendered mid-corridor cities got zero
backfill. Root cause (measured on trip `b2078e6d`, San Diego→Fort Bragg, all 6
categories): the audit drew its backfill anchors from `facts.corridorCities`,
which `preComputeFacts` derives over the WHOLE route — coarse, because
`deriveCorridorCities`' `maxNodes`/`minSpacingMi` cap thins a long route hard.
The itinerary, meanwhile, RENDERS a finer spine that `bake.ts` derives PER-DAY
over each day's shorter segment. Cities on the day spine but dropped from the
route spine — **Oceanside** (~38mi from San Diego) and **Arvin** (~16mi from
Bakersfield) — were visible render nodes the backfill never considered;
`pickBackfillStops` was never called for them, regardless of real candidates
(Oceanside's real `pickGuaranteedStop` pick is "Top Gun House"). Not a cap
issue, not a pool gap — an anchor-set granularity mismatch.

**Decision (Adam).** Align the audit's anchor derivation with bake's, rather
than feeding bake's output into the audit as a separate pass. Implemented as a
SHARED helper `dayCorridorAnchors` / `deriveDayCorridor`
(`web/src/lib/corridor/day-corridor.ts`) that both `bake.ts` and `audit.ts` now
call — the same `deriveCorridorCities` invocation over the same day segment, so
the two spines cannot drift apart again. Both the interest-guarantee block AND
the fuel block in the audit use it (the fuel block had the same coarse
derivation).

**Endpoint rule preserved.** Cities within `ANCHOR_NEAR_MI` of either day
endpoint are still dropped inside the helper. Verified on real data: Arvin is
present in the raw per-day spine but correctly excluded from the anchor set
because it is 15.7mi from the Bakersfield endpoint (< 25mi) — excluded for the
right reason, not by absence. Oceanside is now an anchor.

**Consequence (accepted tradeoff).** A finer per-day spine means MORE anchors
per day, and each anchor carries its own per-city budget of 2 — so a multi-city
day can now surface materially more machine backfill picks (a denser trip). This
is the known, accepted cost of aligning the two spines; it compounds with the
per-day→per-city change above. If density becomes a problem, the levers are
`MAX_BACKFILLS_PER_CITY`, the corridor `maxNodes`/`minSpacingMi` params, or a
per-day ceiling — a tuning decision, flagged.

**Locked by** `web/src/lib/corridor/day-corridor.test.ts`: a city dropped from
the whole-route spine is still a valid per-day anchor; the endpoint rule still
excludes an Arvin-class city (present in the raw spine, filtered for endpoint
proximity), not by absence.
