# Brief — Interest-Category Chips, decision D (granularity)

**Status:** AWAITING PICK. Not committed to any branch. Not built. Report-only
brief for Adam to review, then either pick + convert to a decision doc, or
edit and hand back.

**Path choice:** filed as `docs/specs/interest-category-chips-D.md` (sibling to
the parent scoping doc `docs/specs/interest-category-chips.md`, which lives on
branch `scope-interest-category-chips`, PR #287). Two options considered:

- `docs/decisions/2026-08-XX-interest-category-chip-granularity.md` — the
  standard ADR shape, but ADRs in this repo document RESOLVED choices (see
  `2026-08-25-fuel-live-resolve.md`, `2026-08-25-mapbox-fuel-source.md`,
  `2026-08-25-test-only-signin-bypass.md`). Filing there before the pick would
  misrepresent the shape.
- `docs/specs/…` — the parent scoping doc lives here. Sibling filing keeps
  the brief adjacent to §9-D + §11-step-5/6/7 where it belongs. **Chosen.**

**Companion:** `docs/specs/interest-category-chips.md` (`git show scope-interest-category-chips:docs/specs/interest-category-chips.md`)
— §9-D lists the three options at three lines; §11 steps 5/6/7 describe the
loop-shape divergence. This brief expands each option into product-experience
terms + edge cases + concrete cost, and offers a recommendation.

---

## 0. What this decides

Whether a user-selected interest category (e.g. `scenic`, `oddity`, `food`)
should be guaranteed **per day**, **per city**, or **once across the whole
trip**. The pick determines the shape of the audit-loop change (`web/src/lib/
itinerary/audit.ts`) that wires user-selected chips through to the already-
built pool-anchor selector `pickAnchorStop` (`web/src/lib/itinerary/anchor-
backfill.ts:131`).

Nothing about fuel is affected — that's path A (`pickFuelAtAnchor`), a
separate live-Google mechanism confirmed working on 2026-08-25.

---

## 1. Baseline — what exists today, what the pick would change

**What is running on `main` today:**

- `pickAnchorStop` (`anchor-backfill.ts:131`) — pure, category-blind at the
  input level; hardcoded gate `OPENER_CATEGORIES = {scenic, food, oddity,
  attraction, camping}` (`anchor-backfill.ts:45-51`). Ranks by richness
  (`hasPhoto`, `hasDescription`) then proximity within `ANCHOR_NEAR_MI = 25`.
  Doesn't know a user picked anything.
- `pickBackfillStops` (`anchor-backfill.ts:241-267`) — thin loop over
  `pickAnchorStop`. Iterates anchors in traveller order, breaks at
  `picks.length >= max` (default `MAX_BACKFILLS_PER_DAY = 2`), threads each
  pick back into `taken` so a single POI can't be featured twice on one day.
- `audit.ts:492-560` — per-day audit loop that calls `pickBackfillStops` once
  per day with `{anchors: [dayStart, ...midCorridorCities], pool:
  facts.poolPOIs, keptRefs, onCorridor}`. Cross-day dedupe via
  `backfilledTripWide` (`audit.ts:312`).
- `guaranteedCategories?: SlideCategoryKey[]` field on `ExpeditionForm` +
  `GenerationInput`, plumbed from the wizard, currently readable only by the
  fuel branch (`audit.ts:584`).

**What the pick enables:** the audit-loop change (spec §11 step 5) that
computes `missingGuaranteedCategories` and hands it to a new
`pickGuaranteedStop` (§11 step 6) so pool-side categories the user selected
actually influence what gets picked. Fuel and overnight stay on their existing
mechanisms.

---

## 2. Option D-A — per-day

### Product experience

"Every day of your trip guarantees a stop matching each interest you picked
— if the day has a good candidate near an anchor within the 2/day cap."

Concretely: a user picks `scenic` and `food`. On every day of the trip, the
audit checks whether the LLM already picked a scenic and a food stop for
that day. Any missing category gets one shot at being surfaced from the pool,
priority-first within the day's 2-slot cap. If a day already covers both,
zero pool picks; if only food is covered, up to one pool scenic pick fires;
if neither, up to two pool picks (one per missing category).

### Edge cases

- **Short trip (2–3 days):** every day still gets the guarantee — consistent.
- **Long trip (14+ days):** every day still gets the guarantee — potentially
  many pool picks across the trip. Not surprising given the user opted in.
- **Dwell / out-and-back day:** currently these have no forward polyline, so
  `midCorridorCities` is `[]` and only the day-start anchor is available. The
  guarantee would fire only if the pool has a matching category near the
  base town. Consistent with how corridor-backfill already behaves on dwell
  days (`audit.ts:504-505`).
- **User picks 4+ categories with `MAX_BACKFILLS_PER_DAY = 2`:** at most 2
  fire per day; the other 2+ silently skip. Which 2 fire depends on ordering
  choice not resolved here — could be traveller-order (natural: iterate the
  day's anchors, first anchor that has a missing candidate wins), or
  selection-order (the order the user checked boxes), or ranked by "how
  underrepresented is this category across the trip so far" (requires
  trip-wide state, which is D-C's shape). **This ordering question is a
  D-A follow-up** but is smaller than D itself.
- **A day where no anchor has a candidate for the missing category:**
  `pickAnchorStop` returns `null` and the day stays without that category.
  The `null-rather-than-pad` contract at `anchor-backfill.ts:262` already
  handles this cleanly.
- **The LLM naturally covers everything the user picked, all days:** zero
  pool picks fire. Silent no-op. The user's selection has effectively no
  visible effect on that trip. This is desirable (no redundant featuring),
  but a UX question worth naming: is a chip whose effect is invisible on
  well-generated trips satisfying to the user, or does it need some
  affirmative signal that "we checked, you're covered"?

### Implementation cost

§11 step 5 calls this "trivial." My reading of the current
`audit.ts:492-560` loop matches: after `keyStops` are ground into
`keptStops` (`audit.ts:449` region), compute the covered-category set from
`keptStops` + `resolvedPlaces`, subtract from `guaranteedCategories`, hand
the missing Set to the day's backfill call. The existing `pickBackfillStops`
signature would extend with a `missingCategories: Set<string>` parameter
that `pickAnchorStop`'s candidate filter also consults. The per-day loop
structure is unchanged.

---

## 3. Option D-B — per-city

### Product experience

"Every city (or corridor town) you pass through gets a shot at surfacing
each interest you picked."

Concretely: a user picks `scenic` and `food`. On a day passing through 3
mid-corridor cities plus the day-start, the audit iterates 4 anchors. Each
anchor gets a chance to satisfy one of the missing categories — but still
subject to the 2/day cap. On a rich 4-anchor day this means the cap bites
after 2 picks, and the remaining 2 anchors silently fall through.

### Edge cases

- **Short trip through 1 city per day:** functionally identical to D-A. No
  observable difference.
- **Long trip through 4+ cities per day:** the 2/day cap bites HARD. Two
  category picks per day means the trailing cities silently miss out —
  functionally equivalent to D-A but with more computational churn and no
  user-visible benefit.
- **Dwell day:** same as D-A — `midCorridorCities` is `[]` on dwell days,
  so only the day-start anchor is available. Identical to D-A there.
- **User picks 4+ categories:** doesn't help vs D-A — the cap still bites
  at 2/day. A user picking 5 categories on a 4-city day still gets at most
  2 of them fired.
- **Contention with corridor coverage:** the current corridor-city backfill
  (PR #276) already competes for the same 2-slot cap. D-B would tilt every
  anchor toward guarantee-first (per §5.4 Option A / decision C), so
  corridor-city coverage effectively drops to zero when the user picks any
  guarantees. That's a real behavioural regression vs today's baseline.
- **Two adjacent anchors both eligible for the same category:** the cap
  handles this correctly (first pick threads back into `taken`, second
  anchor's search will find the same POI blocked by dedupe and move on to
  a different POI or return `null`). No new logic needed.

### Implementation cost

§11 step 5 calls this "requires refactoring the current anchor loop to
track guarantees per anchor." My reading of `pickBackfillStops` at
`anchor-backfill.ts:241-267` agrees: the current loop iterates anchors and
picks whatever qualifies, category-blind. Per-anchor guarantee-tracking
means the caller must supply a `Map<anchor, Set<missingCategory>>` instead
of a single trip-level Set, and each anchor's `pickAnchorStop` call needs
to filter by THAT anchor's missing set. Not a large refactor structurally
— the loop shape is unchanged — but the input plumbing gains a Map layer
that D-A doesn't need.

Also: to compute the per-anchor missing sets, the audit needs to know which
kept stops "belong to" which anchor (nearest anchor within
`ANCHOR_NEAR_MI`?). No such attribution exists today. Adds a small
association step in the audit.

---

## 4. Option D-C — trip-wide

### Product experience

"Somewhere in your trip, once, we made sure each interest you picked
appears."

Concretely: a user picks `scenic` and `food` on a 5-day trip. Across the
whole trip, exactly one scenic and one food guarantee-pick fires — on
whichever day/anchor first has a good candidate. Days 2-5 see no
guarantee-driven picks (the guarantee is already satisfied trip-wide).

### Edge cases

- **Short trip (2 days):** works as expected — one pick per selected
  category, distributed across the two days.
- **Long trip (14 days):** underwhelming. A user picking `scenic` gets ONE
  scenic featured across 14 days. From the user's perspective this reads
  like the chip barely did anything — the visible-effect problem is worst
  here.
- **Dwell day:** the guarantee might fire on the base town's anchor, or
  might wait for the next travel day. Depends on order of iteration.
- **User picks 4+ categories:** aligns well with cap arithmetic — 4 picks
  across N days is comfortable, no cap pressure. This is D-C's strongest
  scenario.
- **The LLM already covers a category on day 1:** guarantee satisfied
  immediately; zero pool picks fire for that category. Same silent-no-op
  UX question as D-A but even more likely to hit (single hit across whole
  trip is easy to trigger).
- **Which day does the pick fire on?** Genuinely open — no natural default.
  First eligible? Best-quality? Best-photo? Introduces an implicit ranking
  question that D-A and D-B don't have (both are "iterate in order, first
  qualifier wins per day/anchor").

### Implementation cost

§11 step 5 calls this "requires new state above the per-day loop." My
reading matches — currently each day's audit iteration is independent
(days share `backfilledTripWide` for POI-id dedupe, but not
category-outstanding state). D-C threads an `outstandingGuarantees:
Set<category>` through the day loop, subtracting picked categories after
each day. Not large — a mutable variable at the audit function scope, one
subtraction per day, one `pickBackfillStops` call whose missing-set input
starts full and shrinks. Similar cost to D-A structurally, just with the
Set at trip scope instead of computed per-day.

But: introduces the day-selection question (§which-day-first). Requires
either an arbitrary default (first-day-with-candidate) or a new ranking
heuristic. Small but a real design surface.

---

## 5. Cross-cutting note — `urban` is a separate problem

**Not resolved by picking D.** `pickAnchorStop`'s current category gate at
`anchor-backfill.ts:45-51` accepts `{scenic, food, oddity, attraction,
camping}` — five categories. `urban` is explicitly excluded by a comment
at `anchor-backfill.ts:41` ("urban IS the town — featuring it under its
own node is a tautology"). `interest` is also excluded ("junk drawer").

If a user picks `urban` as an interest guarantee under any of D-A / D-B /
D-C, `pickAnchorStop` returns `null` on every urban candidate. The guarantee
silently no-fires.

**This has to be resolved before `urban` ships in the chip row, independent
of D.** Two paths (both spec §11 step 6):

- Widen `OPENER_CATEGORIES` to include `urban` — reversing the tautology
  argument. Costs the trip renderer a "town featured under its own town
  node" case, which was the reason for exclusion.
- Add a separate `pickGuaranteedStop` selector with its own broader gate
  that permits `urban` — leaving `pickAnchorStop`'s corridor-backfill gate
  as it is.

**Recommendation** (small, flagged separately from the D pick): the
per-decision spec §9-B answer already picked "guarantee-selector uses its
OWN broader gate" — so the second path is already implicitly decided.
Which means `urban` shipping in the chip row is not blocked by any code
change beyond what step 6 already covers. Neither of D-A / D-B / D-C
changes this.

---

## 6. Recommendation (flagged as recommendation, not decision)

**D-A (per-day).** Reasoning:

- **Product predictability.** "I picked scenic, I get a scenic stop each
  day" matches the mental model of a chip labelled with a promise. D-B
  loses discoverability at the cap boundary (cities silently drop). D-C
  loses the promise entirely on long trips (one scenic across 14 days
  reads as "did anything happen?").
- **Cap behaviour is understood.** #275/#276 already tuned
  `MAX_BACKFILLS_PER_DAY = 2` for the corridor-city backfill's density
  concerns; D-A preserves that tuning cleanly (guarantee wins first per
  Option A / C already decided, corridor coverage fills remainder). D-B
  would functionally replace corridor coverage on multi-city days, which
  is a bigger behavioural change than picking D is meant to be.
- **Implementation matches "trivial" per spec.** No cross-day state
  (unlike D-C), no per-anchor accounting (unlike D-B), no new
  "which-day-does-this-fire-on" ranking question (unlike D-C).
- **Silent-no-op UX is real but the mildest form of it.** D-A: silent when
  the LLM already covered you. D-C: silent under the same condition PLUS
  silent for days 2-N even when uncovered. D-A wins on the "did my chip
  do anything?" question by having the most opportunities to fire.
- **Ordering follow-up is smaller than D itself.** The 4-categories-with-2-
  slots question requires a picking rule, but that's a paragraph in the
  decision doc, not a design surface.

**Where D-A weakens vs the others:**

- **D-C's cap headroom** — if in practice users pick many categories AND
  most days already have LLM coverage, D-A's per-day accounting is
  redundant work. D-C amortizes over the trip. But this is only a
  meaningful win if the "many categories" case dominates, which I don't
  have measurement for.
- **D-B's per-city density** — a user who WANTS density (every town has
  something for me) prefers D-B. D-A trades that for cap-respect and
  predictability. If Adam thinks the target user is density-seeking, D-B
  might be right despite the corridor-coverage tradeoff.

**Confidence:** medium-high on the reasoning, low on the calibration
(no measurement of how often trips already cover user-selected categories
via LLM output — would need to instrument a few generations to know).
Willing to be talked out of D-A if the density-seeking user model is
correct.

---

## 7. What picking D unblocks

Per spec §11:

- **Step 5** (compute `missingGuaranteedCategories`) — unblocked, shape
  determined by pick.
- **Step 7** (contention wiring in `pickBackfillStops`) — unblocked;
  Option A guarantee-first pattern already decided.
- **Step 6** (new `pickGuaranteedStop` selector) — the selector's shape is
  independent of D and could ship ahead of D, but its integration site
  moves per D pick (per-day loop vs per-anchor loop vs trip-scope
  accumulator).
- **Step 4a** (LLM prompt payload wiring) — independent of D, unblocked
  today.

D does NOT unblock:

- **Step 4b** (system-prompt copy line) — blocked on **H** (prompt posture)
- **Step 1** (full 8-chip UI row) — blocked on **F** (chip UI shape) and
  the B.1/B.2 caveats about fuel/overnight
- **`urban` in the chip row** — blocked on §5 above (separate gate
  question), though the answer is implicit in the spec §9-B decision.

**Steps that ship regardless of D:** Step 2 (wizard state, already done in
PR #288 for fuel-only), Step 3 (payload type, already done in PR #288),
Step 8 (`scenic` removal from Preferences — independent scoping), Step 9
(feature flag scaffold).

---

## Appendix — verification of the loop-shape claim

Adam's task said §11 documents that "the loop shape differs meaningfully
per option" and that steps 5+7 can't be prototyped until D is chosen. I
verified this against the current `web/src/lib/itinerary/anchor-
backfill.ts:241-267` (`pickBackfillStops`) and the audit caller at
`web/src/lib/itinerary/audit.ts:492-560`:

- `pickBackfillStops` today iterates `anchors` in traveller order with a
  cross-anchor `taken` Set, breaking at cap. Category filtering is
  category-blind — every anchor asks for the "best pool candidate that
  clears the gates," and the gates are hardcoded.
- To wire D-A: extend the input with `missingCategories: Set<string>`,
  filter candidates by category membership in `pickAnchorStop`. Loop
  shape unchanged.
- To wire D-B: extend the input with `missingByAnchor: Map<anchor, Set>`,
  pass the anchor-specific set to each `pickAnchorStop` call. Loop shape
  unchanged but input structure grows.
- To wire D-C: extend the CALLER (`audit.ts`) with trip-scoped state,
  subtract picks after each `pickBackfillStops` call. `pickBackfillStops`
  itself unchanged.

**All three are per-day mechanically** — the difference is where the
missing-set lives (day-scoped vs anchor-scoped vs trip-scoped) and how it's
threaded. §11's phrasing "loop shape differs" reads slightly stronger than
the actual difference — the loop stays a per-day iteration in all three;
what changes is the state boundary. That's still enough divergence that
prototyping one wouldn't cleanly transfer to the other two (the Set shape
in `missingCategories` differs), so §11's conclusion stands, but it's
worth calibrating: **D is a real choice, but the code diff between the
three options is smaller than "different loop shape" suggests.** The
biggest cost differences are UX ripple (silent-no-op frequency, cap
contention, ordering questions), not lines of code.
