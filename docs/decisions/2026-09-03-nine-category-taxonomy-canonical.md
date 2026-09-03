# 2026-09-03 — The 9-category taxonomy is canonical across the app

**Status:** Proposed — awaiting Adam's review. Design only; no implementation.
**Amended 2026-09-03** (Decisions 7-8) resolving the two questions #380 left open.
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
`dump_station`, now assigned to `fuel`/Services by the amendment — their *UI
fate* remains the open decision below.

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
Adam's decision, covering Museums, Galleries, Theaters and Historic Sites.

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
**Services** cluster alongside rest areas and — replacing this ADR's earlier
weaker proposal — water fill, showers, dump stations and toilets. `[literal]` The
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
   tile. `oddity` and `urban` still gain none, and `urban` remains structurally
   empty — both its claimed primaries have zero corpus rows `[literal]`.
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
   **⚠️ A new blocker replaces it:** `foursquare.ts:84-89` deliberately routes
   `theater|theatre` to `oddity` (*"Roadside-quirky entertainment stays oddity"*),
   which would recreate the same split for Theaters specifically. Routing table
   §3.4.
5. **Two "just needs wiring" beliefs must not survive this ADR.** `[cited #366]`
   Mapbox `trailhead` and `viewpoint` were measured near-empty; wiring them
   *"would be near-worthless."* Both route corpus-primary.
6. **NEW (2026-09-03): two of Culture's four chips are empty and a third does not exist.**
   `[literal]` Museums and Galleries have **0** corpus rows; `theater` is not a
   `primary_category` anywhere. Only **Historic Sites** has corpus behind it —
   and it also has the best-measured live coverage in the routing table. **A
   cluster whose chips all return nothing is worse than no cluster**, so ship
   order inside Culture matters: Historic Sites first, Theaters last.

---

## Open decision — NOT taken here (Adam's call)

`[cited #364, #366]` Four categories have **no live source anywhere checked** and
either no corpus or a suppressed one. Per the brief, their UI fate is explicitly
not decided in this ADR:

| Category | Corpus (TEST in-scope) `[literal]` | Suppressed at `hydrate.ts:140`? | Live source |
|---|--:|---|---|
| `urban` (`shopping_mall`, `city_park`) | **0 and 0** | no | none as wired |
| Water fill (`water`) | 169 | **yes** | none |
| Showers (`shower`) | 4 | **yes** | none |
| Dump stations (`dump_station`) | 6 | **yes** | none |

**The choice: keep them as empty-state subtypes, or remove them from the UI.**

**Still open after the 2026-09-03 amendment — and the amendment sharpened it.**
The three amenities now have a *parent* (`fuel`/Services) rather than sitting in
the residual bucket, but a parent is not a reprieve: they still have no source.
**The amendment also raises the stakes**, because `fuel`/Services will contain
the table's best-covered live target (`auto_repair`) sitting beside four
guaranteed-empty chips. Whatever is decided, those subtypes need **per-chip**
empty states, not one at the category level.

Facts that bear on it, and nothing more:

- All three amenities currently carry **NEW** badges while being unable to return
  a result — they are empty twice over (no source, *and* dropped at hydrate).
- **`water` is the one with a real corpus behind it.** `[cited #366]`
  *"unsuppressing [is] the more plausible lever than sourcing."* Removing it from
  the UI would discard reachable data; removing showers/dump stations would not.
- **`urban` is a different case from the other three.** It is structurally empty
  — both claimed primaries have zero rows — but it is one of the canonical 9 and
  carries design tokens and a section label. Removing it from Find Nearby is a
  smaller decision than removing it from the taxonomy, and this ADR keeps it in
  the 9 either way.
- `[cited #366]` A live-source question sits underneath `urban`: Mapbox `park` is
  dense but *"maps more naturally to `scenic`"* — unresolved there, unresolved
  here (routing table §3.2).

---

## UI copy and labels this design changes — for sanity-check before implementation

`[literal]` Where a current tile name does not read naturally as "under" its
parent. Flagged for review, not redesigned here.

| Current UI | Under the collapse | The problem |
|---|---|---|
| **Auto / Repair** (group "FUEL & REPAIR") | ~~subtype of interest~~ → **`fuel` / Services** | **RESOLVED by the amendment.** The mismatch is gone; the data model now agrees with the heading the UI already showed. |
| **Groceries** (group "SUPPLY") | subtype of **food** | Defensible but lossy: "Food" reads *restaurants*; resupply is a distinct planning job. |
| **Water fill / Showers / Dump stations** (groups "SUPPLY", "SERVICE") | ~~interest~~ → **`fuel` / Services** | **AMENDED.** These are the overlander "town stop" errand — same trip as fuel, laundry and a mechanic. `camping` was rejected: campground amenities are *attributes of a campground*, whereas a dump station you drive to is a destination. UI fate still open above. |
| **Trailheads, Viewpoints** (group "CAMP & EXPLORE") | subtypes of **scenic** → "SCENIC" | Reasonable, but they move out of the camping-flavoured group they live in today. |
| **Dispersed, Campgrounds** | subtypes of **camping** | Clean. |
| Group headings **CAMP & EXPLORE / FUEL & REPAIR / FOOD / SUPPLY / SERVICE / STAY** | replaced by the 9 chips | Six headings disappear. Two of them (**FUEL & REPAIR**, **SUPPLY**) currently express groupings the 9 categories *cannot* — that expressiveness is lost, and the Auto/Repair row above is the sharpest instance. |
| Chip label **"POINT OF INTEREST"** for `interest` | **rename required** | **Decision 8 makes this mandatory, not optional.** The bucket now renders no subtypes and holds only unclassifiable residue; "Point of Interest" claims a curation it does not have. Suggested direction: name it as a remainder ("Other", "Everything else"). Final wording is Adam's. |
| Chip label **"FUEL"** | **rename required** | `fuel` now spans gas, EV charging, mechanics, car washes, rest areas and (pending the open decision) water/showers/dump stations. "Fuel" no longer describes its contents. The existing Find Nearby heading "FUEL & REPAIR" is closer but still omits the amenities. |
| **NEW cluster headings** "Culture" (under `attraction`) and "Services" (under `fuel`) | new copy | Neither exists in the UI today. "Culture" is Adam's wording. "Services" is this pass's proposal and is the weaker of the two — it is generic, and "Amenities" or "Town stop" may read better to an overlander. |
| **Theaters** chip | new copy, **and a conflicting rule** | Beyond copy: `foursquare.ts:84-89` currently classifies theaters as `oddity` ("roadside-quirky"). If Adam's "Theaters" means performing-arts/cinema, that rule must move; if it means drive-ins and novelty theaters, the current rule may be right and Culture is the wrong home. **This is a product question, not an implementation detail.** |

**The `interest` label and the Auto/Repair placement are the two items most
worth settling before implementation starts.** Both are cosmetic-looking and
neither is: they determine whether a user can find a mechanic.

---

## Not decided here

Deliberately out of scope: which subtype chips actually render; the exact
`interest` and `fuel` chip wording; `park` → `urban` vs `scenic` (still open,
routing table §3.2); unsuppressing `water`; whether `theater` means
performing-arts venues or roadside novelty (routing table §3.4); and all
implementation sequencing. **Closed by the 2026-09-03 amendment:** the
`attraction`/`oddity` contradiction, and whether `car_repair`/`car_wash` move to
`fuel` — both now decided above. The routing table §4 proposes an
order; it is an argument, not an authorisation.
