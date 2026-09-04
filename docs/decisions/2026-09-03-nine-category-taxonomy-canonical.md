# 2026-09-03 — The 9-category taxonomy is canonical across the app

**Status:** Decisions 1–9 accepted. **Decision 9's UI removal implemented
2026-09-03** (see the implementation note at the foot of this doc); the broader
Find Nearby 13→9 collapse (Decisions 3/4) is not yet implemented.
**All open items closed** as of the 2026-09-03 Decision 9 amendment.
**Amended 2026-09-03** (Decisions 7-8) resolving the two questions #380 left
open, and again the same day for Culture's scope, `park` → `scenic`, and the
declined chip renames.
**Companions:** `docs/architecture/category-subtype-mapping.md` (every category
assigned to a parent) · `docs/architecture/category-source-routing-table.md`
(category → source).

**Confidence key:** `[literal]` = verified in this pass · `[cited]` = carried
from a prior investigation by reference · `[open]` = deliberately undecided.

---

## Context

`[cited #364]` The category audit found the app was running **three** competing
category vocabularies: the canonical 9, the slide/fetch keys, and a third keyed
on `primary_category` — the 13 Find Nearby tiles, which are *not* a subset of the
other two. It concluded: *"'which source serves category X' currently has no
single answer — it depends on the surface. Any routing table will have to pick
one vocabulary to be canonical before it can be written."* This ADR picks it.

**One correction to the premise this ADR was commissioned under, stated because
the ADR would otherwise cite something that does not exist.** The brief asked to
cite *"#364's finding that 3 of the 4 systems already agreed."* **That wording,
and that 4-system framing, do not appear in #364** `[literal]` — the document
frames the problem as three vocabularies. What #364 *does* say, and what the
brief is evidently pointing at, is its Finding 0.1: *"DESIGN.md §1.2 ↔
`BROWSE_CARD_CATEGORIES` ↔ `SlideCategoryKey`: these DO match, 9 for 9,
isomorphic except the documented `hotel` (display) ↔ `overnight` (fetch)
rename."* Three systems, agreeing. The natural fourth — the day-browse route's
validation allowlist — is Finding 0.2: it *"accepts only 7 of the 9,"* omitting
`urban` and `interest`.

**And that fourth system has since been fixed, which strengthens this ADR rather
than weakening it.** `[literal]` PR #373 split the one overloaded constant into
`ALL_VIEW_CATEGORIES` and `REQUESTABLE_CATEGORIES`, the latter *derived from*
`BROWSE_CARD_CATEGORIES`. Verified by execution in this pass: all nine categories
are accepted by `resolveRequestedCategories`, and `categories=all` still expands
to the 7 live-fanout buckets. So **four of four systems now agree on the
vocabulary**, and the `all` asymmetry is a fanout question, not a disagreement
about what the categories are.

This ADR therefore **ratifies an alignment that has already converged in code**,
and extends it to the one vocabulary still outside it: the 13 tiles.

---

## Decision

**1. The 9 categories are canonical app-wide.** `[literal]` Named as they exist
today — display key first, fetch key where it differs:

`camping` · `scenic` · `attraction` · `oddity` · `food` · `fuel` ·
**`hotel`** (fetch key `overnight`) · `urban` · `interest`

Sources of truth, unchanged: `DESIGN.md` §1.2 for tokens, `BROWSE_CARD_CATEGORIES`
(`web/src/lib/trip-browse/palette.ts`) for display order, `SlideCategoryKey`
(`web/src/lib/trip-browse/places.ts`) for fetch.

**2. `hotel` ↔ `overnight` is retained, not renamed.** It is bridged by total
functions in both directions and is the *only* non-identity mapping. Renaming
either side touches the display taxonomy, the fetch taxonomy, the design tokens
and stored payloads for no user-visible gain.

**3. Find Nearby collapses from 13 top-level buttons to the same 9.**

**4. The current tiles become subtype filters within their parent, not
top-level buttons.** `[literal]` For 10 of the 13 this is not a new mapping —
each tile's `primary_category` values already have a parent in
`SLIDE_TO_PRIMARY_CATEGORY`. The hierarchy is already latent in the data model;
only the UI fails to express it. The three exceptions are `water`, `shower` and
`dump_station` — **now REMOVED from the UI entirely (Decision 9)**, so the
mapping question is moot for them.

**5. Parent assignment is a data contract; it does not oblige a chip.** A
primary having a parent does not mean the UI must render a subtype filter for it.
`interest` alone holds 24 of the 45 slide-only primaries `[literal]`, including
`atm`, `bus_stop` and `unknown`. Subtype chips are a curated subset.

**6. The routing table in
`docs/architecture/category-source-routing-table.md` is the single answer to
"which source serves category X."** It supersedes per-surface answers.

### Amendment, 2026-09-03 — the two questions this ADR left open in #380

Both were referred to Adam and are now decided. **Neither adds a category; the
count stays at 9.**

**7. "Culture" is a subtype cluster under `attraction`, not a 10th category.**
Adam's decision. **Scope amended the same day to Museums, Galleries and Historic
Sites — three chips, not four.** Adam clarified that "Theaters" means novelty /
roadside theaters, which `foursquare.ts:84-89` already routes to `oddity` and
which are the explicit opposite of `attraction`'s *"formal cultural set only"*
definition. **The code was right and the cluster's scope was wrong**; the rule
stays untouched. Mapping doc §4.7.

`[literal]` **`attraction` is where it fits, and the code already says so in
prose** — `federated.ts:42` reads `// attraction: the formal cultural set only.`,
and the adjacent comment states that generic `tourist_attraction` *"lives here
[oddity], NOT in the formal-cultural `attraction` bucket."* The corpus taxonomy
already draws exactly the distinction Adam is drawing. **Culture is not a new
concept being placed — it is the existing definition of `attraction`, given a
label and chips.** `oddity` was never a candidate: it carries the Atlas Obscura
corpus under a deliberately different sense, *curious* rather than *cultural*.

**The ADR's ceiling holds cleanly.** A cluster is a heading over filter chips
inside one parent. Nothing about Culture requires top-level status, so the
conflict this pass was told to watch for did not materialise. **Reported as a
non-event rather than left unsaid** — the check was real, and it passed.

**8. `interest` stops pretending to be a browsable category.** Adam had no
preference, so this is a single proposal: promote every primary that has a better
parent out of `interest`, keep the parent chip (it holds real rows and is the
`primaryCategoryToSlideKey` fallback), render **no** subtype chips beneath it,
and rename it away from "POINT OF INTEREST." Full reasoning and the promotion
table: mapping doc §4.6.

**The largest consequence: `car_repair`/`car_wash` move to `fuel`**, into a new
**Services** cluster alongside rest areas. ~~and water fill, showers, dump
stations and toilets~~ — **those four were subsequently REMOVED from the UI by
Decision 9, so Services ships as Auto/Repair + Rest areas only.** `[literal]` The
decisive argument is that **the UI already asserts this grouping and only the
data model disagrees**: the Find Nearby group heading is literally *"FUEL &
REPAIR."*

---

## Consequences

`[literal]` These follow arithmetically from the mapping doc; they are stated
here because they are the parts most likely to be objected to.

1. **The 13 tiles fold into 5 of the 9 parents** (camping, scenic, fuel, food,
   hotel) — **amended from 6**, since no tile lands in `interest` any more.
   `attraction` gains subtypes from the **Culture** cluster rather than from any
   tile. `oddity` gains none. **`urban` is removed from the UI entirely
   (Decision 9)** — both its claimed primaries have zero corpus rows `[literal]`
   and nothing routes to it.
2. ~~**`interest` becomes the app's dumping ground.**~~ **RESOLVED by Decision 8.**
   Mechanics, car washes, rest areas and the suppressed amenities move to
   `fuel`/Services; the rest keeps its parent chip but renders no subtypes and
   gets an honest label. **The residue is still a residue** — `facility`
   (2,245 in-scope `[literal]`) is unsplittable without richer ingest, and that,
   not the label, is what remains wrong.
3. **This is not a 13→9 reduction in information — provided subtypes ship.** It
   removes a level of navigation. **If the subtype filters are deferred to a later
   pass while the tile collapse ships, it is a capability regression**, and
   `dispersed_camping` (2,533 in-scope rows, no live source) becomes unreachable
   from Find Nearby. The two changes must ship together.
4. ~~**`attraction` is unroutable until an existing contradiction is resolved.**~~
   **RESOLVED by Decision 7 — and the diagnosis got sharper.** `[literal]`
   Re-checking found a **third** encoding: Foursquare's classifier
   (`foursquare.ts:76-82`) also files these under `attraction`, commented as
   *"mirrors the federated corpus split."* Three encodings against one, so
   `LIVE_SLIDE_FOR_PRIMARY` is the sole outlier — **strong inference that it is a
   slip, not a decision**, upgrading #380's `[unverified]`. Fix is three lines in
   one constant.
   ~~**⚠️ A new blocker replaces it:**~~ **CLOSED 2026-09-03.** The
   `foursquare.ts` theater rule was not a blocker but a signal that Culture's
   scope was wrong. Theaters left the cluster; the rule stands. **§3.1's fix now
   has no remaining blocker.** Routing table §3.4.
5. **Two "just needs wiring" beliefs must not survive this ADR.** `[cited #366]`
   Mapbox `trailhead` and `viewpoint` were measured near-empty; wiring them
   *"would be near-worthless."* Both route corpus-primary.
6. **REVISED (2026-09-03): Culture is three chips, two empty in corpus — but
   "empty" now means one thing, not two.** `[literal]` Museums and Galleries have
   **0** corpus rows, and both are `R2 LIVE-PRIMARY`: they fill as soon as the
   §3.1 live route lands. Theaters — the one chip whose emptiness was *permanent*
   without an ingest change — is out of the cluster entirely. **Dropping it
   removed the only blocked chip while raising the share of empty ones (2 of 3
   rather than 2 of 4); the first effect matters more than the second.** Historic
   Sites still ships first as the only chip with corpus behind it.

---

## Decision 9 (2026-09-03) — `urban`, water fill, showers and dump stations are REMOVED from the UI

**Adam's final decision, and the last open item in the #380 → #382 → #384 chain.
It is now closed.**

**This is a "removed until a real data source exists" decision, not an oversight
and not a gap to rediscover.** Stated that way deliberately: every one of the
four was measured, twice, and found to have no reachable source. A future reader
finding no `urban` chip and no water/shower/dump tiles is looking at an intended
outcome. **Re-adding any of them requires new data, not a UI change.**

| Removed | Corpus (TEST in-scope) `[literal]` | Suppressed at `hydrate.ts:140`? | Live source |
|---|--:|---|---|
| `urban` (`shopping_mall`, `city_park`) | **0 and 0** | no | **none** — and `park`, the one dense Mapbox candidate, went to `scenic` (routing §3.2) |
| Water fill (`water`) | 169 | **yes** | **none anywhere checked** `[cited #364, #366]` |
| Showers (`shower`) | 4 | **yes** | **none anywhere checked** |
| Dump stations (`dump_station`) | 6 | **yes** | **none anywhere checked** |

**Scope of "removed from the UI" — wider than Find Nearby.** `[literal]` `urban`
renders a chip in the **browse filter row** as well (`BROWSE_CARD_CATEGORIES`
contains all nine and the row renders every one). Removing it means removing that
chip too, not only a Find Nearby tile. The three amenities exist **only** as Find
Nearby tiles, so for them the removal is Find Nearby alone.

### The taxonomy stays at 9. The UI renders 8 category chips.

**This is the one thing most likely to be mistaken for a mistake, so it is stated
head-on.** `urban` **remains one of the nine canonical categories** — it keeps its
`SlideCategoryKey` member, its `BROWSE_CARD_CATEGORIES` entry, its `DESIGN.md`
§1.2 tokens and its section label. What it loses is its **chip**.

That is not a contradiction; it is **Decision 5 applied to a parent instead of a
subtype**: *"parent assignment is a data contract; it does not oblige a chip."*
Decision 8 already did the same thing one level down for `interest`'s subtypes.

**Why keep it in the taxonomy at all rather than dropping to 8?**

1. `[literal]` `primaryCategoryToSlideKey` is total; the nine keys are a closed
   set that other code switches on exhaustively. Removing a member is a code
   change with a blast radius, and this is a docs pass.
2. `[literal]` **Nothing else has to change.** `categories=all` already expands
   to seven buckets and **already excludes `urban`** — verified by executing
   `resolveRequestedCategories` earlier in this chain. So the default feed is
   **unaffected** by removing the chip.
3. If a live source for `shopping_mall`/`city_park` ever appears, restoring the
   chip is a UI change against a category that never went away.

**The honest cost:** "the 9-category taxonomy" and "the categories a user can
see" are no longer the same list. Anyone reading the ADR's Decision 1 and then
counting chips in the product will find eight. **That divergence is intended and
is recorded here so the count is never read as a bug.**

### What removal does NOT change

- **No data is deleted.** `[literal]` `water` still has 169 in-scope rows and
  they remain in the corpus, still suppressed at `hydrate.ts:140`. Removal is a
  surface decision; the rows are untouched and available the day a source or an
  unsuppression decision arrives.
- **The routing table keeps its rows.** They are marked **R4 NONE / no UI
  surface** rather than deleted — deleting them is how this gets rediscovered and
  re-litigated. See routing table §3.3.
- **`interest` is not affected.** It keeps its chip (Decision 8); only its
  *subtypes* are unrendered.

### One category in the same position that Adam did NOT name — flagged, not assumed

`[literal]` **`toilet`** is suppressed, sourceless and R4 — identical to the
three amenities — and this chain had *proposed* promoting it into
`fuel`/Services. It was **not** in the removal decision. It has **no UI presence
today** (it is an unclaimed corpus primary, never a tile), so there is nothing to
remove; what lapses is the *proposal to surface it*, by the same reasoning that
removed the other three. **Recorded rather than silently folded in** — if Adam
wants it treated differently, it is one line.


## UI copy and labels this design changes — for sanity-check before implementation

`[literal]` Where a current tile name does not read naturally as "under" its
parent. Flagged for review, not redesigned here.

| Current UI | Under the collapse | The problem |
|---|---|---|
| **Auto / Repair** (group "FUEL & REPAIR") | ~~subtype of interest~~ → **`fuel` / Services** | **RESOLVED by the amendment.** The mismatch is gone; the data model now agrees with the heading the UI already showed. |
| **Groceries** (group "SUPPLY") | subtype of **food** | Defensible but lossy: "Food" reads *restaurants*; resupply is a distinct planning job. |
| ~~**Water fill / Showers / Dump stations**~~ (groups "SUPPLY", "SERVICE") | **REMOVED — Decision 9** | No copy needed. The tiles and their group headings go. `[literal]` "SERVICE" disappears entirely (both its tiles were showers and dump stations); "SUPPLY" loses Water fill and keeps Groceries, which moves under `food`. |
| ~~**`urban`** chip~~ (browse filter row) | **REMOVED — Decision 9** | Not a Find Nearby tile — this is the browse chip. The taxonomy keeps `urban`; the UI stops rendering it, so the filter row shows **8** chips. |
| **Trailheads, Viewpoints** (group "CAMP & EXPLORE") | subtypes of **scenic** → "SCENIC" | Reasonable, but they move out of the camping-flavoured group they live in today. |
| **Dispersed, Campgrounds** | subtypes of **camping** | Clean. |
| Group headings **CAMP & EXPLORE / FUEL & REPAIR / FOOD / SUPPLY / SERVICE / STAY** | replaced by the 9 chips | Six headings disappear. Two of them (**FUEL & REPAIR**, **SUPPLY**) currently express groupings the 9 categories *cannot* — that expressiveness is lost, and the Auto/Repair row above is the sharpest instance. |
| ~~Chip label **"POINT OF INTEREST"** for `interest`~~ | **NO RENAME — declined 2026-09-03** | Adam's call. `interest` keeps its name despite no longer describing its contents. Recorded as a deliberate non-change, not an oversight: the label was flagged twice in this ADR's history and the decision is to live with it. The reasoning for *why* it is imprecise stands above (Decision 8) and is the thing to re-read if it is ever revisited. |
| ~~Chip label **"FUEL"**~~ | **NO RENAME — declined 2026-09-03** | Same call. `fuel` spans gas, EV charging, mechanics, car washes and rest areas, and "Fuel" does not cover that — accepted knowingly. **Note the display consequence:** the Find Nearby heading "FUEL & REPAIR" is *closer* to the truth than the canonical chip label, so the two will read slightly differently. Deliberate. |
| **NEW cluster headings** "Culture" (under `attraction`) and "Services" (under `fuel`) | new copy | Neither exists in the UI today. "Culture" is Adam's wording. "Services" is this pass's proposal and is the weaker of the two — it is generic, and "Amenities" or "Town stop" may read better to an overlander. **Unaffected by the no-rename decision**, which covers the nine canonical chip labels, not new cluster headings. |

**The `interest` label and the Auto/Repair placement are the two items most
worth settling before implementation starts.** Both are cosmetic-looking and
neither is: they determine whether a user can find a mechanic.

---

## Not decided here

Deliberately out of scope: which subtype chips actually render; the "Services"
cluster heading wording; and all implementation sequencing. (~~unsuppressing
`water`~~ — moot for the UI under Decision 9; it stays a corpus question only.)

**Closed across the 2026-09-03 amendments:** the `attraction`/`oddity`
contradiction · whether `car_repair`/`car_wash` move to `fuel` · what "Theaters"
means and where it belongs (novelty → stays `oddity`, out of Culture) · `park` →
`scenic` · and the `interest`/`fuel` chip renames, **declined**.

`[open, newly separated]` **A novelty-theater chip under `oddity`.** Not proposed
and deliberately not added unprompted. If wanted, it needs a `theater`
`primary_category` and an ingest mapping — `[literal]` the Foursquare rule
classifies live results by name only and does nothing for corpus rows.

~~**The only substantive open item left**~~ — **CLOSED by Decision 9: removed.**
**No open items remain in the #380 → #382 → #384 chain.** The routing table §4
proposes an implementation order; it is an argument, not an authorisation.

**⚠️ Implementation is still not authorised, and this decision does not start
it.** Removing these from the live Find Nearby component and the browse filter
row is code work for the follow-up pass. Nothing in `web/src` was touched by this
decision `[literal]`.

---

## Implementation note — Decision 9's UI removal landed 2026-09-03

The follow-up pass the note above anticipated is done. Three files changed, no
data-layer or corpus change:

- `web/src/lib/trip-browse/palette.ts` — added `BROWSE_FILTER_CHIP_CATEGORIES`
  (the 8 rendered chips = `BROWSE_CARD_CATEGORIES` minus `urban`).
  `BROWSE_CARD_CATEGORIES` stays at 9, so `urban`'s map layer, icons, API
  validity and top-picks are untouched — exactly the "keeps its data contract,
  loses its chip" split this decision specified.
- `web/src/components/trip/category-filter-row.tsx` — the filter row (shared by
  Find Nearby *and* the day-scoped Add-Waypoints browse panel) now iterates
  `BROWSE_FILTER_CHIP_CATEGORIES`, so it renders 8 chips, not 9.
- `web/src/components/trip/find-nearby-panel.tsx` — removed the Water fill tile
  from SUPPLY and the whole SERVICE bucket (Showers + Dump stations); dropped the
  now-unused `Droplet`/`ShowerHead`/`Trash2` icon imports.

**Deliberately NOT touched:** `place-category-toggles.tsx` — an explicit
throwaway test harness (its own docstring: *"NOT a proposed UI surface"*) that
exercises the map's data-contract layer set, which still includes `urban`.
Leaving `urban` in it is correct: it toggles the still-existing `urban` map
layer, not a user-facing chip.

Gates green: `npm run -w web typecheck`, `npm run -w web test` (714/714), and
`cd web && npx next build` (exit 0). `[literal — run this session]`
