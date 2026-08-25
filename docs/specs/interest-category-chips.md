# Spec — Interest Category chips (wizard guarantee section)

**Status:** SCOPING draft. Do not build from this yet — the paragraphs labelled
"Open — Adam" and the option lists in §5.4 are unresolved.

**Owner:** Adam (product) — this doc surfaces unknowns and enumerates options; it
does not decide them.

**Companion docs:** `docs/specs/expedition-planner.md` (the wizard's overall spec
— note §8.1 lists `scenic` under Preferences, so it will need a companion edit;
see §7); `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md` and the
corridor-city extension in the merge chain #274→#276 (this feature layers priority
onto that mechanism, does not replace it).

**Style note on file naming:** the assignment referenced
`docs/specs/search-resolution.md` and `docs/specs/corridor-ranking.md` as pattern
templates; neither exists in the repo `[grep 2026-08-25]`. Style pattern taken
from `expedition-planner.md`, `state-parks-source-architecture.md`, and
`corridor-cities-spec.md`.

---

## 0. Framing — priority within a cap, not a new budget

A new "Interest Categories" section in the trip-creation wizard lets the user
guarantee that the trip's stops span certain kinds of place. **Guarantee =
priority within the existing per-day backfill cap (`MAX_BACKFILLS_PER_DAY = 2`,
`web/src/lib/itinerary/anchor-backfill.ts:205` `[read source 2026-08-25]`); NOT a
separate budget on top of it.** Backfill only fires when the LLM's own picks miss
something — for corridor coverage today; for a selected category tomorrow — and
the same 2 slots per day serve both.

This resolves a naming collision at the same time: `scenic` today is one of five
soft **Preferences** chips (`PREFERENCE_OPTIONS`,
`web/src/lib/plan/expedition.ts:91-97` `[read source 2026-08-25]`) with no
downstream enforcement; it becomes a category with guarantee semantics in the new
section, and comes out of Preferences.

The scoping here is deliberately paused-before-building because three things are
not yet decided (§5.4 contention model, §6 UI shape, §7 blast-radius calls) and
the feature reaches five subsystems (wizard state → payload schema → LLM prompt →
backfill selector → vehicle seeds).

---

## 1. Placement — insert as a new `<Section>` between the two existing ones

- The wizard is **a single flat page**, not a stepper. `ExpeditionWizard`
  (`web/src/components/plan/expedition-wizard.tsx:227-587` `[read source
  2026-08-25]`) renders three `<Section>` blocks in order: `"Your destinations"`
  (247-398) → `"Trip details"` (401-474) → `"Your rig"` (477-562). The
  `PlanStep` type in `lib/plan/types.ts` referenced by `web/CLAUDE.md` is a
  *different, older* wizard flow — not this one; no stepper slice to add.
- The new section is a **fourth `<Section title="Interest categories">`** inserted
  between the JSX blocks at `expedition-wizard.tsx:474` and `:477` — i.e. between
  "Trip details" and "Your rig", matching the assignment.
- Form state stays plain `useState` (there is no store or form library here) —
  add one `useState<Category[]>([])` alongside the eleven others at
  `expedition-wizard.tsx:137-151`, then project it into `ExpeditionForm` via the
  `useMemo` at `:182-207`.

## 2. The two-canonical-taxonomies problem — decide the source of truth first

**This is the largest surprise in the trace and it precedes every other design
decision.** The 9 categories exist in **two forms** and the app translates
between them:

- `Category` (display, browse UI): `"fuel" | "camping" | "scenic" | "urban" |
  "food" | "oddity" | "attraction" | "interest" | "hotel"`
  (`web/src/components/primitives/detail-card.tsx:58-67` `[read source
  2026-08-25]`).
- `SlideCategoryKey` (data-fetch, generation pipeline): same nine but with
  **`"overnight"` in place of `"hotel"`**
  (`web/src/lib/trip-browse/places.ts:7-16` `[read source 2026-08-25]`); bridged
  by `slideCategoryToBrowseCategory` / `browseCategoryToSlide`
  (`web/src/lib/trip-browse/palette.ts:48-63` `[read source 2026-08-25]`).

The assignment names the nine as `camping, urban, scenic, food, fuel, hotel,
oddity, attraction, interest` — the `Category` form. **The generation and
backfill code that a "guarantee" would run through operates on the
`SlideCategoryKey` form** — `PoolPOI.category` is a raw string set from
`BrowsePlace.category?: SlideCategoryKey` via `toPoolPOI`
(`web/src/lib/itinerary/facts.ts:145-158` `[read source 2026-08-25]`). If the
wizard chip labelled `hotel` reaches the selector as the literal string `"hotel"`,
it will silently never match a pool POI, because pool rows carry
`"overnight"` for that category.

**Two survivable paths, both need a decision:**

- **(a) UI shows `hotel`, code stores `overnight` internally.** Translation at
  the wizard→payload boundary. Consistent with today's rendering (the browse
  panel and design tokens use `hotel` — `web/src/lib/trip-browse/palette.ts:36`
  `[read source 2026-08-25]`).
- **(b) UI and code both use `overnight`.** Consistent with the pool/backfill
  path, but users see a word they don't see anywhere else in the app today.

**Open — Adam:** which of (a)/(b), or a third framing you'd prefer. The rest of
this spec is written assuming (a) — chip label `hotel`, internal `overnight` —
and flags where that choice bites.

**Also load-bearing:** the 9-category vocabulary is **never enumerated to the
LLM** today. The system prompt (`web/src/lib/itinerary/master-prompt.ts:15-111`
`[read source 2026-08-25]`) does not list the nine; the model sees category
strings only per-POI on `payload.poolPOIs[].category` (`master-prompt.ts:135-141`
`[read source 2026-08-25]`), and `keyStops[]` output schema imposes no category
enum (`web/src/lib/itinerary/schema.ts:259-280` `[read source 2026-08-25]`, note
comment at `:220-225` — "No min/max/length constraints (unsupported) — the audit
enforces bounds"). Whichever form Adam picks in (a)/(b), this feature is the
first time the taxonomy will be named to the model, if it is at all (§5.3).

---

## 3. How preferences reach generation today — for context and blast radius

The path a selected chip travels today, so §4 and §7 have a shared vocabulary:

1. **Wizard state.** `rig.preferences: string[]` on the `useState<RigProfile>`
   at `expedition-wizard.tsx:151` `[read source 2026-08-25]`. Toggled by the
   `<ChipGroup>` at `:550-560` (options come from
   `PREFERENCE_OPTIONS` — the five soft chips).
2. **Payload.** Included in `ExpeditionForm.rig`
   (`web/src/lib/plan/expedition.ts:47-68` `[read source 2026-08-25]`), then
   passed through to `GenerationInput.rig`
   (`web/src/lib/itinerary/facts.ts:79-87` `[read source 2026-08-25]`) verbatim
   by `expeditionToGenerationInput` (`expedition.ts:100-140`, line
   `:124-132` `[read source 2026-08-25]`).
3. **LLM.** Delivered as a raw JSON field on `payload.rig` at
   `master-prompt.ts:121-142` `[read source 2026-08-25]`. **Not called out by
   name in `SYSTEM_PROMPT`**; the model must notice the `preferences` array on
   its own. No downstream code reads `rig.preferences`.

Consequences worth stating explicitly, since the assignment asked what "scenic"
does today:

- **`scenic` as a preference chip has no enforcement path — it's a hope.** It
  reaches the LLM as an array element and nothing else. Removing it does not
  silently break a filter or a rank because no filter or rank consumes it.
- **`scenic` as a taxonomy category is entirely separate** (`Category` union,
  `BROWSE_CARD_CATEGORIES`, `OPENER_CATEGORIES`, discovery/source mappings — see
  the full occurrence list in §7). None of those need to change to remove the
  preference chip.
- **A third `scenic` exists — `returnRouting: "scenic"`** (`facts.ts:64` `[read
  source 2026-08-25]`, wizard select at `expedition-wizard.tsx:24, 431-445` `[read
  source 2026-08-25]`). Different concept entirely (return-leg routing style).
  **Must not be touched.**

---

## 4. Where "guaranteed categories" lands in the payload + prompt

Given §3, three places are candidates. All three will likely be needed together;
the question is what each one carries.

### 4.1 On `GenerationInput` — a new top-level field, not on `rig`

`RigProfile.preferences` is a rig thing (attribute of the vehicle profile — even
the seeds carry per-vehicle preferences,
`web/src/lib/vehicles/repository.ts:24,39,54` `[read source 2026-08-25]`).
Guaranteed categories are a **trip-shaped** intent — they'd travel with the
route, not the vehicle. Put them on `GenerationInput` alongside `objective` and
`params` (proposed name: `guaranteedCategories: SlideCategoryKey[]`).

### 4.2 In the prompt payload — as a *fact*, not a preference

The prompt sends `{ params, rig, anchors, route, corridorCities, poolPOIs }` at
`master-prompt.ts:121-142` `[read source 2026-08-25]`. `guaranteedCategories`
belongs alongside `corridorCities` (trip-level facts), not tucked inside `rig`,
because it names a constraint on the *output structure* the way `corridorCities`
does. It should be described in `SYSTEM_PROMPT` with the same posture as
`corridorCities`: **a preference to weave into `keyStops[]`, never a quota**
(matching how #274 landed the corridor-cities preference at
`web/src/lib/itinerary/master-prompt.ts` per `docs/decisions/2026-08-24-keystop-corridor-spread.md`).
Saying "skipping is fine, coverage is a tie-breaker" is the pattern; a quota
prompt is what the whole #274→#276 arc was pushing away from.

### 4.3 As per-day audit input — this is the guarantee's real teeth

Even a well-crafted prompt line won't reliably fire on every day. The **audit** is
where the enforcement mechanism lives (via #276's backfill, §5). The audit runs
per-day (`web/src/lib/itinerary/audit.ts:268` `[read source 2026-08-25]`) — it
already knows which corridor cities apply to each day
(`audit.ts:492-497` `[read source 2026-08-25]`); it does *not* yet know "what
categories does this day cover / miss." Adding that:

- After the LLM's `keyStops` are ground into `keptStops` (`audit.ts:436-449` `[read
  source 2026-08-25]`), compute `coveredCategories = new Set(keptStops.map((s) =>
  s.category))` for that day.
- Missing categories = `guaranteedCategories \ coveredCategories`.
- The missing set feeds the backfill selector (§5) — its ranking decides who
  actually gets a slot within the cap.

**No per-day fact structure exists today**, so this is where a small structural
addition goes. It does not need to be sent to the LLM — the audit does it
post-generation.

---

## 5. #276 backfill — where the priority resolves

### 5.1 The mechanism as it stands today `[read source 2026-08-25]`

- Constant: `MAX_BACKFILLS_PER_DAY = 2` at
  `web/src/lib/itinerary/anchor-backfill.ts:205`; consumed at `:249`.
- Selector: `pickAnchorStop(candidates, anchor, ...)` at
  `anchor-backfill.ts:131-146`. Gates a candidate must pass:
  - dedupe on `p.id` **or** `p.name` against `keptRefs`;
  - `p.category ∈ OPENER_CATEGORIES` (the strict subset `["scenic", "food",
    "oddity", "attraction", "camping"]` at `:45-51`);
  - not a city-name tautology at the anchor (`:103-107`);
  - within `ANCHOR_NEAR_MI = 25` of the anchor coordinate (`:63`);
  - passes the caller's `onCorridor(coords)` guard.
- Rank / tie-break: `rank(p, anchor)` at `:163-171` — `ratingPenalty` (inert;
  `master_place.rating` is corpus-wide NULL `[measured 2026-08-21]` per
  `docs/measurements/2026-08-21-master-place-enrichment-columns.md`), then
  `richnessPenalty` (`hasPhoto ? -60 : 0`, `hasDescription ? -30 : 0`), then
  proximity. Preference for a renderable row is intentional (added mid-flight
  during #275 after `atlas_oddities` NULL-photo picks landed).
- Loop + cap: `pickBackfillStops` at `:241-267` iterates anchor list, calls
  `pickAnchorStop` per anchor, threads each pick into `taken`, breaks at
  `picks.length >= max` (line 254).
- Caller: `auditItinerary` at `web/src/lib/itinerary/audit.ts:268` — backfill
  runs *inside* the per-day loop, after the model's `keyStops` are ground
  (`:436-449`) and before overnight grounding (`:538+`). Full block:
  `audit.ts:451-536`. Anchors list assembled at `:482-508` (day start + each
  mid-corridor city within `GUARD_MI = 60` of the day polyline, in
  along-route order). Trip-wide dedupe set `backfilledTripWide` at `:312` (comment
  `:308-311` — two consecutive days can otherwise share a corridor city).
- Gated by env flag `KEYSTOP_ANCHOR_BACKFILL !== "false"` at `audit.ts:67`, ON
  by default per `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md`.

### 5.2 The gap `OPENER_CATEGORIES` opens for a full-taxonomy guarantee

The strict subset excludes `interest` (explicit — "junk drawer" comment at
`anchor-backfill.ts:41-42` `[read source 2026-08-25]`), `urban`, `fuel`, and
`overnight`/`hotel`. A guarantee on any of those four **silently no-ops** through
today's selector: the candidate can't clear the `OPENER_CATEGORIES` gate. Four of
the nine assignment-listed categories are affected.

**Open — Adam:** does the guarantee-selector share `pickAnchorStop`'s category
gate, or use its own? If shared, the guarantee can only ever enforce five
categories, matching what the corpus-quality reasoning behind `OPENER_CATEGORIES`
already accepted. If separate, we need a stated policy for the four excluded
ones — most sharply for `interest`, whose "junk drawer" status was a considered
call, not an oversight; and for `fuel`, which the fuel-POI layer (`expedition-
planner.md` §8.5) hasn't shipped yet.

### 5.3 Where in the audit's per-day loop the guarantee fires

The backfill loop today runs once per day and always spends up to 2 slots on
corridor-anchor coverage. The natural insertion point is *within the same loop*
(`audit.ts:451-536`), so the two coverage kinds compete for the same slots per
the assignment's "priority within the cap, not additive" rule.

### 5.4 The contention model — three options, no pick

This is the assignment's central open question. All three assume: the audit
computes both `missingCorridorAnchors` (today's set) and `missingGuaranteedCategories`
(new); the same `MAX_BACKFILLS_PER_DAY = 2` slots serve both.

- **Option A — guarantee wins strictly, one-for-one, then anchors fill remaining
  slots.** Missing guaranteed categories get first crack, up to `min(missing,
  cap)`; remaining slots serve corridor anchors as today. **Tradeoff:** on a day
  with 2 missing guaranteed categories, corridor coverage falls to zero — that day
  can lose the Riverside/Oceanside kind of stop the #276 arc measured as a real
  win. Simplest to implement.
- **Option B — anchors keep their current picks, guarantee fills only slack.**
  Corridor anchors run as today; guaranteed-category misses use only the slots
  the anchors didn't spend (frequently zero on multi-city days). **Tradeoff:**
  guarantee semantics are undermined — on the exact days where the LLM missed a
  category *and* left cities bare, the anchors would have already claimed the
  slots. Simplest to reason about, weakest new mechanism.
- **Option C — interleave with a merit rule** (e.g., alternate categories vs
  anchors up to the cap; or a signed score per candidate that rolls category-
  miss and corridor-city-miss into one rank). **Tradeoff:** most flexible,
  hardest to reason about — a chosen policy plus the parameters that govern it
  becomes new prior art in this file. The rich stuff about *which* miss matters
  more (a bare Riverside vs a missing `scenic` for the trip) is a real product
  judgement to state, not a knob.

**Open — Adam:** pick one, or a fourth. Independent from that: is the guarantee
**trip-wide** (once satisfied on any day, it's done) or **per-city** (a
guaranteed category should appear at every mid-corridor city and every
start/end)? The assignment text reads per-city ("guaranteed to show up in every
city on the route"); the mechanism above assumes per-day, which is what the audit
loop natively supports. Per-city inside a day is a further granularity — it
would run the guarantee against each mid-corridor anchor in `audit.ts:501-507`
rather than each day.

### 5.5 A ranking wrinkle worth naming

`pickAnchorStop`'s current rank prefers **rich** rows (photo + description). For
a guarantee it may want to prefer **on-category** rows, then rich, then close.
Whichever contention model wins in §5.4, the rank function needs one line added
per selection kind — trivial but a decision (state the order).

---

## 6. Wizard UI — chip section shape

Following the existing `<Section title="…"><ChipGroup /></Section>` pattern
at `expedition-wizard.tsx:550-560` `[read source 2026-08-25]`:

```
Section: "Interest categories" (new)
  Sub-copy: 1-2 lines about what "guaranteed" means and that it's optional
  ChipGroup: multi-select, all 9 categories (labels per §2 decision), default [] on load
```

Concrete calls left open:

- **Copy for the sub-line.** The user needs to understand this is a "priority"
  not a "quota" — mirroring the prompt's own posture (§4.2). Not a quota-language
  chip section.
- **Icons.** Each category already has an icon (`web/src/components/icons/category-
  icons.tsx:106+` and `-v2.tsx:173+` `[read source 2026-08-25]`); we may want
  them on the chips, especially since 9 is a lot and text-only rows get busy. Not
  currently done on `PREFERENCE_OPTIONS` chips.
- **Order.** `BROWSE_CARD_CATEGORIES` (`palette.ts:17-27` `[read source
  2026-08-25]`) is the closest thing to a canonical display order — comment
  `:15-16` says "outdoors first, then services, then the interest catch-all
  last." That order is: `camping, scenic, attraction, oddity, food, fuel, hotel,
  urban, interest`. Reasonable default.
- **Whether to show `interest`.** Given the "junk drawer" designation
  (`anchor-backfill.ts:41-42` `[read source 2026-08-25]`), exposing it as a
  user-selectable guarantee is a call. Included today only because the
  assignment names it in the "all 9."

**Open — Adam:** which of these should the UI do differently from today's
Preferences chips (which are text-only, no icons, and hard-coded left-to-right
in list order)?

---

## 7. `scenic` removal — the blast radius, measured

**Files that must change to remove `scenic` from Preferences (the intended
change), all `[read source 2026-08-25]`:**

- `web/src/lib/plan/expedition.ts:91-97` — drop `"scenic"` from
  `PREFERENCE_OPTIONS`.
- `web/src/lib/vehicles/types.ts:32-34` — update the docstring on
  `RigProfile.preferences` (still lists the five inline).
- `web/src/lib/vehicles/repository.ts:24, 39, 54` — the three seed rigs
  (`veh-lexus-gx-470`, `veh-tacoma-trd`, `veh-rivian-r1t`) each carry `"scenic"`
  in their `rig.preferences` array. **Removing from `PREFERENCE_OPTIONS` will
  not auto-drop these** — they will render as an "unknown" chip in the wizard's
  Preferences group until edited. The repository is in-memory only
  (`repository.ts:1-9`), so this is purely a code cleanup, not a DB migration.
- `docs/specs/expedition-planner.md:274` — the §8.1 Rig Profile table row for
  Preferences still lists "scenic" as one of five. Companion edit.

**Nothing else consumes `scenic` as a preference.** No filter, ranker, or prompt
line reads it (§3). The full occurrence list of literal `'scenic'` /
`"scenic"` `[grep 2026-08-25]` (from the trace, for the record):

- **Preferences chip (to be removed):** `expedition.ts:91-97`, `types.ts:32-34`,
  `repository.ts:24,39,54`.
- **`returnRouting` enum (KEEP, do not touch):** `expedition-wizard.tsx:24`,
  `facts.ts:64`.
- **Taxonomy category (KEEP, unchanged):** `detail-card.tsx:61`,
  `places.ts:10,19`, `palette.ts:19,36`, `card-stats.ts:140`,
  `anchor-backfill.ts:46` (`OPENER_CATEGORIES`), plus discovery/source
  mappings (`blm.ts:54`, `foursquare.ts:92,96`, `google-places.ts:28,218,424,427`,
  `overpass-tags.ts:116`, `usfs.ts:47`), API routes (`api/trip-browse/[tripId]/
  [dayId]/route.ts:17`, `app/search/page.tsx:30`), display components
  (`browse-day-section.tsx:29`, `category-icons.tsx:106`,
  `category-icons-v2.tsx:173`), corpus / resolver (`resolve-places.ts:206-226`),
  plus fixtures and tests (`alaska.ts`, `fixtures.ts`, `destination-photo.ts`,
  the four `*.test.ts` files under generation/backfill).

**Open — Adam:** the docstring in `types.ts:32-34` calls preferences "distinct
from the stop-category interests taxonomy" — the whole point of the new section is
to blur that boundary (a category is now user-selectable in a wizard section
directly). Do we keep that framing (Preferences = rig vibe, Categories = trip
intent) or collapse Preferences entirely into the new section and drop the whole
row? Today's other Preferences (`solitude, photography, simple-camp, local-food`)
are also unenforced by any downstream code (§3) — the same "hope, not
mechanism" gap that `scenic` had; a call to keep or retire them individually is
outside the assignment but worth flagging alongside.

---

## 8. What this spec does NOT cover

- **A `fuel` guarantee's realism.** `expedition-planner.md` §8.5 states the
  fuel-POI layer as a Stage-2 prerequisite that has not shipped, so the corpus
  can't reliably serve a fuel-category guarantee across the corridor today. If
  the wizard chip for `fuel` is enabled, it will silently misfire on far-north
  stretches. Out of scope here; flagged in §5.2's four-excluded-categories note.
- **LLM-side compliance measurement.** Whether a prompt-level guarantee actually
  shifts model behaviour is an A/B question and this spec proposes only the
  prompt line (§4.2) plus the audit-side enforcement (§4.3, §5). Measuring the
  prompt line's independent effect is out of scope — the whole thesis of the
  #274 arc was that prompt-only was insufficient, which is why there's a
  mechanism layered on top.
- **Persistence of guarantee selections onto `trips.payload`.** The generation
  path already persists its input into `trips.generationInput` (`Record<string,
  unknown>` per the circular-import gotcha in `web/CLAUDE.md`); the guarantee
  selections land there automatically once added to `ExpeditionForm`. No further
  storage needed unless we want to expose the guarantee state on an already-
  generated trip's Day Detail — a later product call.
- **Contention resolution beyond §5.4.** The three options are enumerated
  without a pick; picking one is a product decision that unblocks build, not a
  scoping deliverable.
- **`master_place_generated_content` LLM-description fallback for guaranteed
  categories.** Existing infra (§STATE.md 2026-08-21) already handles absent
  descriptions; not this feature.

---

## 9. Open questions / decisions for Adam

Consolidated from throughout — each item names a `§` for context.

- **A. Two-taxonomies (§2).** Chip label `hotel` vs `overnight` internally, or
  use `overnight` end-to-end? Everything downstream of the wizard runs on
  `SlideCategoryKey` (`overnight`). **Confirm** which label the user sees, and
  therefore where the translation lives.
- **B. Category gate (§5.2).** Does the guarantee-selector share
  `OPENER_CATEGORIES` — silently making the guarantee unenforceable for
  `interest`, `urban`, `fuel`, `hotel/overnight` — or use its own broader gate?
  If broader, what's the policy on `interest` (its "junk drawer" status is a
  considered call) and on `fuel` (the fuel-POI corpus layer hasn't shipped)?
  **Confirm** category gate for the new selector.
- **C. Contention model (§5.4).** Option A (guarantee-first), B (guarantee-in-
  slack), C (interleave/merit) — or a fourth. **Pick one.**
- **D. Trip-wide vs per-city vs per-day (§5.4).** The assignment phrasing reads
  per-city; the audit's native granularity is per-day. **Confirm** which the
  guarantee enforces.
- **E. Rank order (§5.5).** For the guarantee-selector's `rank()`: on-category
  first, then richness, then proximity — or a different order? **Confirm.**
- **F. Chip section shape (§6).** Sub-copy phrasing, icons on chips, order, and
  whether `interest` is exposed. **Product calls.**
- **G. Preferences-as-a-whole (§7).** Keep Preferences alongside Categories
  (rig vibe vs trip intent framing), collapse Preferences into the new section,
  or retire Preferences entirely (given none of its remaining four items are
  enforced downstream)? Broader than the assignment — flagged, not decided.
- **H. Prompt posture (§4.2).** Word the guaranteed-categories fact as a
  preference-to-weave (matching #274 corridor-cities posture) or as a stronger
  contract? The mechanism enforces it either way — the prompt's job is model
  behaviour, not enforcement. **Confirm** the copy stance.

---

## 10. Cross-references

- `web/src/lib/itinerary/anchor-backfill.ts` — the selector this feature layers
  onto (`MAX_BACKFILLS_PER_DAY`, `OPENER_CATEGORIES`, `pickAnchorStop`,
  `pickBackfillStops`, `rank`).
- `web/src/lib/itinerary/audit.ts:268, 312, 451-536` — the per-day audit loop
  and trip-wide dedupe where guarantee selection would fire.
- `web/src/lib/itinerary/facts.ts:79-87, 145-158` — `GenerationInput` /
  `toPoolPOI` where `PoolPOI.category` gets its `SlideCategoryKey` value.
- `web/src/lib/itinerary/master-prompt.ts:15-111, 121-142` — `SYSTEM_PROMPT`
  and `buildFactsMessage` where the guarantee would surface to the model.
- `web/src/lib/itinerary/schema.ts:259-280` — `keyStops[]` output schema
  (no category enum today).
- `web/src/components/plan/expedition-wizard.tsx:227-587` — the wizard shell.
- `web/src/lib/plan/expedition.ts:47-140` — `ExpeditionForm`,
  `PREFERENCE_OPTIONS`, `expeditionToGenerationInput`.
- `web/src/lib/vehicles/repository.ts:24, 39, 54` and `types.ts:32-34` — the
  seed and typedef "scenic" carriers.
- `web/src/components/primitives/detail-card.tsx:58-67` — canonical `Category`
  union.
- `web/src/lib/trip-browse/places.ts:7-16, 18-28` and
  `web/src/lib/trip-browse/palette.ts:15-63` — `SlideCategoryKey` and the
  `hotel ↔ overnight` bridge.
- `docs/specs/expedition-planner.md` — the wizard's parent spec (§8.1 needs a
  Preferences-row companion edit).
- `docs/decisions/2026-08-24-keystop-corridor-spread.md` — the prompt-only
  version of the corridor coverage nudge; the model for §4.2's posture.
- `docs/decisions/2026-08-25-start-of-day-keystop-backfill.md` — the mechanism
  that added `pickAnchorStop` and `KEYSTOP_ANCHOR_BACKFILL`.
