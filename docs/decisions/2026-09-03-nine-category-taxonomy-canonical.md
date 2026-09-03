# 2026-09-03 — The 9-category taxonomy is canonical across the app

**Status:** Proposed — awaiting Adam's review. Design only; no implementation.
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
`dump_station` — see the open decision below.

**5. Parent assignment is a data contract; it does not oblige a chip.** A
primary having a parent does not mean the UI must render a subtype filter for it.
`interest` alone holds 24 of the 45 slide-only primaries `[literal]`, including
`atm`, `bus_stop` and `unknown`. Subtype chips are a curated subset.

**6. The routing table in
`docs/architecture/category-source-routing-table.md` is the single answer to
"which source serves category X."** It supersedes per-surface answers.

---

## Consequences

`[literal]` These follow arithmetically from the mapping doc; they are stated
here because they are the parts most likely to be objected to.

1. **The 13 tiles fold into only 6 of the 9 parents.** `attraction`, `oddity` and
   `urban` gain **no** Find Nearby subtypes.
2. **`interest` becomes the app's dumping ground.** It would hold mechanics, car
   washes, ATMs, bus stops, `unknown`, and — as proposed — dump stations and
   showers, under a chip reading "POINT OF INTEREST." **This is the weakest part
   of the design.** Mapping doc §4.1 sets out the three exits; none is taken here.
3. **This is not a 13→9 reduction in information — provided subtypes ship.** It
   removes a level of navigation. **If the subtype filters are deferred to a later
   pass while the tile collapse ships, it is a capability regression**, and
   `dispersed_camping` (2,533 in-scope rows, no live source) becomes unreachable
   from Find Nearby. The two changes must ship together.
4. **`attraction` is unroutable until an existing contradiction is resolved.**
   `[literal]` `museum`/`art_gallery`/`historical_landmark` are filed under
   `attraction` by the corpus path and under `oddity` by the live path, while
   Google is asked for them under `attraction`. Found in this pass; no comment or
   commit explains it. Detail in mapping doc §4.4, routing table §3.1.
5. **Two "just needs wiring" beliefs must not survive this ADR.** `[cited #366]`
   Mapbox `trailhead` and `viewpoint` were measured near-empty; wiring them
   *"would be near-worthless."* Both route corpus-primary.

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
| **Auto / Repair** (group "FUEL & REPAIR") | subtype of **interest** → chip reads "POINT OF INTEREST" | Worst mismatch in the design. A user seeking a mechanic taps "Point of Interest." The existing group heading already says "Fuel & Repair," so today's UI *disagrees with the data model.* |
| **Groceries** (group "SUPPLY") | subtype of **food** | Defensible but lossy: "Food" reads *restaurants*; resupply is a distinct planning job. |
| **Water fill / Showers / Dump stations** (groups "SUPPLY", "SERVICE") | proposed subtypes of **interest** | Campsite services filed under "Point of Interest." `camping` fits user intent better; `interest` was chosen only because it changes no category's meaning. Contingent on the open decision above. |
| **Trailheads, Viewpoints** (group "CAMP & EXPLORE") | subtypes of **scenic** → "SCENIC" | Reasonable, but they move out of the camping-flavoured group they live in today. |
| **Dispersed, Campgrounds** | subtypes of **camping** | Clean. |
| Group headings **CAMP & EXPLORE / FUEL & REPAIR / FOOD / SUPPLY / SERVICE / STAY** | replaced by the 9 chips | Six headings disappear. Two of them (**FUEL & REPAIR**, **SUPPLY**) currently express groupings the 9 categories *cannot* — that expressiveness is lost, and the Auto/Repair row above is the sharpest instance. |
| Chip label **"POINT OF INTEREST"** for `interest` | unchanged | Already the weakest label; the collapse loads more onto it. Worth renaming as part of implementation. |

**The `interest` label and the Auto/Repair placement are the two items most
worth settling before implementation starts.** Both are cosmetic-looking and
neither is: they determine whether a user can find a mechanic.

---

## Not decided here

Deliberately out of scope: which subtype chips actually render; the `interest`
rename; whether `car_repair`/`car_wash` move to `fuel`; the `attraction`/`oddity`
contradiction (§Consequences 4); `park` → `urban` vs `scenic`; unsuppressing
`water`; and all implementation sequencing. The routing table §4 proposes an
order; it is an argument, not an authorisation.
