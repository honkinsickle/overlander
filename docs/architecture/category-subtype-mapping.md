# Category subtype mapping — every known category, assigned to one of the 9

**Status:** DESIGN ONLY. Nothing here is implemented. Companion to
`docs/decisions/2026-09-03-nine-category-taxonomy-canonical.md` (the ADR) and
`docs/architecture/category-source-routing-table.md` (the routing table).

**Confidence key:** `[literal]` = computed or read from source in this pass ·
`[cited]` = carried from a prior investigation by reference, not re-derived ·
`[proposed]` = a design assignment made here, not a fact about the code ·
`[open]` = deliberately undecided.

---

## 0. How the sets in this document were produced

`[literal]` The vocabulary set-differences below were **computed in this pass**
by importing the live constants (`SLIDE_TO_PRIMARY_CATEGORY` from
`web/src/lib/trip-browse/federated.ts`, `LIVE_SLIDE_FOR_PRIMARY` from
`web/src/lib/places/resolve-places.ts`, `SUPPRESSED_PRIMARY_CATEGORIES` from
`federated.ts`) and the 13 tile definitions from
`web/src/components/trip/find-nearby-panel.tsx`, then differencing them.

Results: **88** distinct primaries claimed by a slide bucket · **46** claimed by
a Find Nearby tile · **3** tile-only · **45** slide-only.

**⚠️ Read this before trusting the provenance of any list here.** The brief asked
for "every category identified in #364's mismatch findings — the 3 tile-only, the
45 slide-only, the 40 tile-claimed-but-zero-corpus, the 22 unclaimed corpus."
**#364 enumerates only one of those four sets.** It gives counts for all four,
but names members only for the tile-only 3, plus an explicit `including…` sample
of 4 of the 22. The 45-member and 40-member lists appear nowhere in that
document. Every list in this document was therefore **re-derived in this pass**,
not transcribed from #364:

- The **tile-only 3** and the **slide-only 45** come from differencing the code
  constants `[literal]`. Both **reproduce #364's counts exactly**.
- The **22 unclaimed** and the **claimed-but-empty** sets come from re-running
  #364's own read-only TEST instrument `[literal]`, §5. The 22 reproduces
  exactly; the empty-set count differs from #364's 40 for a definitional reason
  that resolves precisely (§5.2).

Four independent reproductions of #364's counts is the reason this design treats
#364's measurements as sound enough to build on.

---

## 1. The 9 canonical categories

`[literal]` Names exactly as they exist today. The display/fetch split is the one
documented divergence.

| # | Display key (`Category`, DESIGN.md §1.2) | Fetch key (`SlideCategoryKey`) | Chip label (`browseCardPalette`) | Section label (`browse-day-section.tsx`) |
|---|---|---|---|---|
| 1 | `camping` | `camping` | CAMPING | Camping & Overnights |
| 2 | `scenic` | `scenic` | SCENIC | Sights & Landmarks |
| 3 | `attraction` | `attraction` | ATTRACTION | Attractions |
| 4 | `oddity` | `oddity` | ODDITY | Oddities |
| 5 | `food` | `food` | FOOD | Food |
| 6 | `fuel` | `fuel` | FUEL | Fuel |
| 7 | **`hotel`** | **`overnight`** | HOTEL | Overnights |
| 8 | `urban` | `urban` | URBAN | Urban |
| 9 | `interest` | `interest` | POINT OF INTEREST | Points of Interest |

Row 7 is the only non-identity mapping, bridged by `browseCategoryToSlide` /
`slideCategoryToBrowseCategory` (`palette.ts`) and `TRIP_CATEGORY_TO_SLIDE`
(`places.ts`). **This ADR does not rename either side** — see ADR §Consequences.

---

## 2. The 13 Find Nearby tiles → parent category

`[literal]` The **parent column is not a proposal for 10 of the 13** — it is
what the code already implies. Each tile queries `primary_category` values; every
one of those values already has a parent in `SLIDE_TO_PRIMARY_CATEGORY`, except
the three suppressed amenities. **The subtype hierarchy this ADR ratifies is
therefore already latent in the data model; what is missing is the UI expressing
it.**

| Tile (current label) | Current group heading | NEW badge | Queries `primary_category` | → Parent | Basis |
|---|---|---|---|---|---|
| Dispersed | CAMP & EXPLORE | yes | `dispersed_camping` | **camping** | `[literal]` already claimed |
| Campgrounds | CAMP & EXPLORE | yes | `campground`, `rv_park`, `camping_cabin` | **camping** | `[literal]` |
| Trailheads | CAMP & EXPLORE | yes | `trailhead`, `hiking_area` | **scenic** | `[literal]` |
| Viewpoints | CAMP & EXPLORE | yes | `viewpoint`, `peak`, `mountain_peak`, `scenic_spot` | **scenic** | `[literal]` |
| Gas | FUEL & REPAIR | — | `gas_station`, `truck_stop`, `ev_charging` | **fuel** | `[literal]` |
| Auto / Repair | FUEL & REPAIR | yes | `car_repair`, `car_wash` | **fuel** / Services | `[amended]` — was `interest`; see §4.1 |
| Coffee | FOOD | — | `cafe` | **food** | `[literal]` |
| Restaurants | FOOD | — | 22 cuisine primaries | **food** | `[literal]` |
| Groceries | SUPPLY | — | `grocery`, `grocery_store` | **food** ⚠️ | `[literal]` — see §4.2 |
| Water fill | SUPPLY | yes | `water` | **fuel** / Services | `[amended]` — unclaimed today, see §4.3 |
| Showers | SERVICE | yes | `shower` | **fuel** / Services | `[amended]` — unclaimed today |
| Dump stations | SERVICE | yes | `dump_station` | **fuel** / Services | `[amended]` — unclaimed today |
| Hotels | STAY | — | `hotel`, `motel`, `resort_hotel` | **hotel** (`overnight`) | `[literal]` |

**Collapse summary — AMENDED 2026-09-03.** After §4.1/§4.3 the 13 tiles fold
into **5** of the 9 parents — camping, scenic, fuel, food, hotel. **No tile maps
to `interest` any more**, which is the point of §4.6. `attraction` gains subtypes
from the **Culture** cluster (§4.7) rather than from any existing tile;
`oddity` and `urban` still gain none. `[literal]`

---

## 3. The 45 slide-only primaries → parent category

`[literal]` Claimed by a slide bucket, claimed by **no** Find Nearby tile. Parent
is the existing `SLIDE_TO_PRIMARY_CATEGORY` assignment — these are already
mapped; the table exists so the collapse can be reviewed as a whole. The
`live` column is `LIVE_SLIDE_FOR_PRIMARY`, i.e. what the bbox live half can
reach; `NONE` means corpus-only.

| Parent | Primaries (slide-only) | live route |
|---|---|---|
| **scenic** | `park`, `beach`, `lake`, `natural_feature`, `river`, `national_park`, `state_park`, `spring`, `park_feature`, `recreation_area` | all `NONE` |
| **attraction** | `visitor_center`, `national_historic_site`, `landmark` | `NONE` |
| | `museum`, `art_gallery`, `historical_landmark` | **`oddity` today → `attraction`** once §4.4 lands |
| **oddity** | `oddity`, `roadside_attraction`, `tourist_attraction` | all `NONE` |
| **urban** | `shopping_mall`, `city_park` | all `NONE` |
| **interest** | `rest_area`, `activity_pass`, `permit`, `tree_permit`, `timed_entry`, `ticket_facility`, `venue_reservations`, `hardware`, `outdoor_gear`, `marina`, `casino`, `library`, `atm`, `bus_stop`, `government_office`, `kiosk`, `amphitheatre`, `mobile_home_park`, `national_fish_hatchery`, `sports_activity_location`, `park_boundary`, `facility`, `point_of_interest`, `unknown` | all `NONE` |

Two structural observations, both `[literal]`:

- **Every one of the 45 has `live: NONE` except the three in §4.4.** The live
  bbox half cannot reach any of them. Anything in this table is corpus-or-nothing
  regardless of how the UI presents it.
- **`interest` holds 24 of the 45.** It is not a category; it is the residue of
  one. §4.1 and §6 both follow from this. **AMENDED 2026-09-03:** §4.6 promotes
  `car_repair`, `car_wash`, `rest_area`, `marina` and (weakly) `library` out of
  it, and rules that what remains renders no subtype chips. (`amphitheatre` was
  promoted in the previous revision and **returns here** — §4.7.)

---

## 4. Assignments that do not fit cleanly — flagged, not forced

### 4.1 `car_repair` / `car_wash` → **RESOLVED 2026-09-03: moved to `fuel`**

~~The Auto / Repair tile's primaries live in `interest`.~~ **Amended.** They move
to **`fuel`**, into a new **Services** subtype cluster (§4.7).

`[literal]` The decisive evidence is that **the UI already asserts this
grouping and only the data model disagrees**: the Find Nearby group heading for
these tiles is literally **"FUEL & REPAIR"**. Nobody has to be persuaded that a
mechanic belongs next to a gas station — the product already says so, and
`SLIDE_TO_PRIMARY_CATEGORY` is the outlier.

Three further reasons: `[cited #366]` Auto/Repair is *"the cleanest wiring
win available"* — dense Mapbox coverage against zero corpus rows — so this
category is about to become genuinely useful and should not debut under the
app's least meaningful label. `[literal]` `fuel` is a thin bucket (its corpus is
`ev_charging` 2,886 in-scope and essentially nothing else), so absorbing repair
dilutes nothing. And it removes the single worst artifact of the 13→9
collapse — *a user looking for a mechanic tapping "POINT OF INTEREST."*

**This does not add a category.** It reassigns two primaries between two of the
existing 9.

### 4.2 `grocery` / `grocery_store` → `food`

`[literal]` Already assigned to `food` in `SLIDE_TO_PRIMARY_CATEGORY`, while the
tile sits under a **SUPPLY** heading. Groceries-as-food is defensible (it is
consumables) but "Food" to an overlander reads *restaurants*, and resupply is a
distinct trip-planning job. Flagged for §7; no change proposed. **Unaffected by
the 2026-09-03 amendment.**

### 4.3 `water` / `shower` / `dump_station` → **AMENDED: `fuel` / Services, not `interest`**

`[literal]` These three are the entire tile-only set: claimed by a tile, claimed
by no slide bucket, and simultaneously members of
`SUPPRESSED_PRIMARY_CATEGORIES` — so they are dropped at `hydrate.ts:140` even
when a corpus row exists.

~~`[proposed]` Parent = `interest`.~~ **Amended to `fuel` → Services (§4.7).**
The original assignment was made "only because it is the assignment that requires
no change to a category's meaning," and was flagged in the same breath as *"the
weaker of the two on user intent."* Once a Services cluster exists, that
compromise is unnecessary.

**Why Services and not `camping`** — the alternative this doc previously called
stronger: campground amenities are *attributes of a campground*, surfaced on its
card. A dump station or potable-water tap you **drive to** is a **service stop**,
and it is the same errand as fuel, laundry and a mechanic — the overlander "town
stop." Filing them under `camping` would make them compete with places to sleep.

**Assigning a parent is still not deciding their UI fate.** Whether they appear
at all remains the ADR's open decision, and remains Adam's call.

### 4.4 `museum` / `art_gallery` / `historical_landmark` — **RESOLVED: `attraction`, on both paths**

**Adam's decision, 2026-09-03: introduce "Culture" as a subtype cluster under
one of the 9.** Originally scoped as Museums, Galleries, Theaters and Historic
Sites; **amended the same day to Museums, Galleries and Historic Sites** — see
§4.7, "Theaters is out.

**It goes under `attraction`, and the code already says so in prose** `[literal]`:

> `// attraction: the formal cultural set only.` — `federated.ts:42`
>
> `// oddity: roadside / generic attractions. `tourist_attraction` (generic POI
> attraction) lives here, NOT in the formal-cultural `attraction` bucket.`
> — `federated.ts:48-49`

The corpus taxonomy already draws exactly the distinction Adam is drawing, and
already names `attraction` as the formal-cultural bucket. Culture is not a new
concept being placed; it is **the existing definition of `attraction`, given a
label and chips.** `oddity` was never a candidate: it holds the Atlas Obscura
corpus (2,745 in-scope `[literal]`) under a deliberately different sense —
*curious*, not *cultural*.

#### The inconsistency is narrower than #380 reported — two of three encodings already agree

`[literal]` #380 recorded a corpus-vs-live disagreement. Re-checking in this pass
found a **third** encoding, and it changes the diagnosis:

| Encoding | File | Files museums/galleries/historic under |
|---|---|---|
| Corpus / federated | `federated.ts:43-46` | **`attraction`** |
| Live — Foursquare classifier | `foursquare.ts:76-82` | **`attraction`** — comment: *"Formal cultural → attraction (mirrors the federated corpus split)"* |
| Live — bbox slide map | `resolve-places.ts:236` | **`oddity`** ⚠️ |
| Google fanout | `google-places.ts` `TYPES_BY_CATEGORY.attraction` | asked for under **`attraction`** |

**`LIVE_SLIDE_FOR_PRIMARY` is the sole outlier of four.** #380 rated it
`[unverified]` whether deliberate; three-against-one, with one of the three
explicitly commented as mirroring the corpus split, is **strong inference that it
is a slip, not a decision.**

**Resolution `[proposed]`, in the direction that changes least:** move
`museum`, `art_gallery`, `historical_landmark` in `LIVE_SLIDE_FOR_PRIMARY` from
`oddity` to `attraction`. One constant, three lines. `federated.ts`,
`foursquare.ts` and the Google fanout need no change.

**A real consequence, stated because it is a behaviour change, not a no-op:**
`oddity`'s live half currently receives these misfiled museum/gallery results
and will stop. `[literal]` Google emits nothing for `oddity` by design
(`TYPES_BY_CATEGORY.oddity = []`) and the Mapbox source is fuel-only, so after
the change `oddity`'s bbox live half returns **nothing** via
`LIVE_SLIDE_FOR_PRIMARY`. That is correct — `oddity` routes corpus-primary on a
2,745-row corpus — but it should be expected rather than discovered.

### 4.5 Carried from #364 — ambiguities already named there, not re-litigated

`[cited]` #364 §"Categories that don't fit the framework cleanly" flags:
`facility` (generic RIDB container, in `interest` "by residual assignment, not by
fit"); `park_feature` (assigned to `scenic`, "acknowledged-arbitrary at source");
`land_status` and `public_land` (land-tenure polygons, "not POIs… Counted,
flagged, not forced"); and that `oddity` and `interest` are each **both** a slide
bucket and a bare `primary_category`, so "a reader comparing 'the oddity
category' across documents can land on either meaning."

This design changes none of those. They are inherited, and they remain
open.

### 4.6 **RESOLVED 2026-09-03 — the `interest` dumping-ground fix**

#380 called this the design's weakest point. Adam has no preference, so this is
a single proposal with its reasoning, not a menu.

**The proposal: keep `interest` as one of the 9 and keep its chip, but change
what it means — from "a category" to "the fallback sink, drained of everything
that has a better home, and rendering no subtype chips of its own."**

Four parts.

**(a) Promote every primary that has a better parent.** `[proposed]`

| Primary | From | To | Why |
|---|---|---|---|
| `car_repair`, `car_wash` | `interest` | **`fuel`** / Services | §4.1 — the UI already says "Fuel & Repair" |
| `rest_area` | `interest` | **`fuel`** / Services | a stop-service, same errand class |
| `marina` | `interest` | **`scenic`** | a waterfront destination, not an errand |
| `library` | `interest` | **`attraction`** / Culture | `[weakest of these]` — civic-cultural; if it reads wrong, leave it |
| `hut` | *(unclaimed)* | **`overnight`** | shelter (§5.1) |
| `picnic_area` | *(unclaimed)* | **`scenic`** | §5.1 |
| `toilet` | *(unclaimed)* | **`fuel`** / Services | §4.7 |
| `water`, `shower`, `dump_station` | tile-only | **`fuel`** / Services | §4.3 |

**(b) `interest` renders NO subtype chips.** `[proposed]` What remains is
`unknown`, `point_of_interest`, `facility`, `park_boundary`, `atm`, `bus_stop`,
`government_office`, `kiosk`, `mobile_home_park`, `national_fish_hatchery`,
`sports_activity_location`, `hardware`, `outdoor_gear`, `casino`, `permit`,
`tree_permit`, `timed_entry`, `ticket_facility`, `activity_pass`,
`venue_reservations` — plus, by the `primaryCategoryToSlideKey` fallback, every
corpus primary nobody claims. **There is no honest chip label for that set**, and
a filter whose contents a user cannot predict is worse than no filter.

**(c) Keep the parent chip.** Deleting it would hide real data — `facility`
alone is 2,245 in-scope rows `[literal]` — and would break the total fallback
that makes `primaryCategoryToSlideKey` safe. The chip stays; only the promise of
sub-navigation goes.

**(d) Rename the chip.** "POINT OF INTEREST" claims curation this bucket does not
have. `[proposed]` Something that names it as a remainder — "Everything else",
"Other" — is more honest. Final wording is a copy decision (ADR §UI copy).

**Reasoning — why this shape rather than the alternatives.**

*Why not split `interest` into more specific subtypes?* Because its mass is not
splittable by the data available. `[literal]` The single largest member is
`facility` at 2,245 in-scope — `[cited #364]` *"a generic RIDB container that
spans campgrounds, day-use sites and offices."* **No taxonomy decision can split
it; only richer ingest can.** Inventing chips over an unsplittable container
would produce filters that return arbitrary subsets — the same "cannot fail /
cannot be reasoned about" problem in UI form.

*Why not delete `interest` outright?* See (c) — it is load-bearing as a fallback,
and it holds real rows.

*Why does this stay within the ADR?* It moves primaries between existing parents
and changes one label. **The count stays at 9.** `interest` remains a canonical
category; it simply stops pretending to be a browsable one.

**What this actually buys, stated plainly:** it does not make `interest` good. It
makes it *honest*, and it removes the two genuinely absurd outcomes — a mechanic
under "Point of Interest," and a subtype list a user cannot predict. **The
residue is still a residue.** The real fix for `facility` is an ingest change and
is out of this pass's scope; it is the item to watch.


### 4.7 The **Culture** cluster, and the **Services** cluster `[proposed]`

Two labelled subtype clusters. **Neither is a top-level category; the count stays
at 9.** A cluster is a heading over a group of filter chips inside one parent.

**Culture — under `attraction`**

| Chip | Primaries | Corpus (TEST in-scope) `[literal]` | Status |
|---|---|---|---|
| Museums | `museum` | 0 | claimed, empty in corpus — **live-pending, not dead** |
| Galleries | `art_gallery` | 0 | claimed, empty in corpus — **live-pending, not dead** |
| Historic Sites | `historical_landmark`, `national_historic_site`, `landmark`, `historic`, `historical_place`, `monument` | 1 · 0 · 3 · 24 · 1 · 1 | `historic`, `historical_place`, `monument` are **unclaimed today** (§5.1) and must be claimed by `attraction` |
| *(ungrouped)* | `visitor_center` | 102 `[cited #364]` | stays in `attraction`, outside Culture — it is wayfinding, not culture |

#### ⚠️ AMENDED 2026-09-03 (third pass): Culture is THREE chips. Theaters is out.

**Adam's clarification: "Theaters" means novelty / roadside theaters** — the same
sense `foursquare.ts:84-89` already encodes (*"Roadside-quirky entertainment
stays oddity"*). **That rule stays untouched.**

**This removes Theaters from Culture on the cluster's own definition, not as a
compromise.** `[literal]` Culture is scoped to `attraction`, which
`federated.ts:42` defines as *"the formal cultural set only"*, and the adjacent
comment puts roadside/generic attractions in `oddity`. **A novelty theater is
the `oddity` sense by the code's own words** — putting it in Culture would have
imported into the formal-cultural bucket exactly what that bucket is defined to
exclude.

**Three consequences, all simplifications:**

1. **The `theater` primary is no longer needed.** The instruction to add one
   (recorded in the previous revision of this section) is **withdrawn** — no
   chip requires it.
2. **The `foursquare.ts` blocker is gone.** The previous revision required moving
   `theater|theatre` out of the oddity regex. It stays where it is, correctly.
3. **`amphitheatre` returns to `interest`.** `[proposed]` Its promotion in the
   previous revision was justified *only* by "performance venue → Theaters." With
   Theaters gone from Culture that justification lapses, and it does not belong
   in Museums, Galleries or Historic Sites. It has **0** corpus rows `[literal]`
   so nothing changes in practice. `[strong inference]` In a corpus this
   RIDB/USFS-heavy, `amphitheatre` most likely denotes a campground interpretive
   amphitheatre — a facility, not a venue — which supports leaving it residual.

**A novelty-theater chip under `oddity` is a separate open question.** Not
proposed here, and deliberately not added unprompted. If it is ever wanted, note
`[literal]` that the Foursquare rule classifies **live FSQ results by name only**
— it does nothing for corpus rows — so a corpus-backed Theaters chip would still
need a `theater` `primary_category` and an ingest mapping. The FSQ rule alone is
not a substitute.

#### Does dropping Theaters change the ship-order risk? Yes — and not in the obvious direction

`[literal]` Culture now has **3** chips, **2** of which have zero corpus rows. The
previous revision had 4 chips with 2 empty and 1 non-existent.

- **Absolutely better:** the permanently-blocked chip is gone. Nothing in Culture
  now depends on an ingest change that does not exist.
- **Proportionally worse:** two of three chips are empty rather than two of four.
  A smaller cluster makes each empty chip more conspicuous.
- **But the two empties are not the same kind of empty as Theaters was, and this
  is the part that actually changes the ordering advice.** `[cited #366]` Mapbox
  `museum` measured 6/6 metro and 4/6 rural; `art_gallery` 6/6 and 3/6. Both are
  **R2 LIVE-PRIMARY** rows — empty *in corpus*, and non-empty as soon as the
  `attraction` live route lands (routing table §3.1). **Their emptiness is
  conditional on wiring, not permanent.** Theaters' was permanent without ingest.

**Revised ordering:** Historic Sites first — it is the only chip that returns
anything from corpus today, and `[cited #366]` it also has the strongest measured
live coverage in the routing table (6/6 metro, 6/6 rural). Museums and Galleries
follow **the §3.1 live-route fix**, not an ingest project. **The #382 framing that
lumped all three together as "empty" was too coarse: one was blocked, two were
merely unwired.**


**Services — under `fuel`**

| Chip | Primaries | Corpus (TEST in-scope) `[literal]` | Live `[cited #366]` |
|---|---|---|---|
| Auto / Repair | `car_repair`, `car_wash` | 0, 0 | Mapbox dense; highest rural total sampled |
| Water fill | `water` | 169 — **suppressed** | none |
| Showers | `shower` | 4 — **suppressed** | none |
| Dump stations | `dump_station` | 6 — **suppressed** | none |
| Rest areas | `rest_area` | in the `interest` bucket | Mapbox `rest_area`: 5/6 metro, **1/6 rural** |
| Toilets | `toilet` | 128 — **suppressed**, unclaimed today | none |

`fuel`'s existing chips (`gas_station`, `ev_charging`, `truck_stop`) form the
sibling **Fuel & Charging** cluster. The parent chip's label needs revisiting —
"FUEL" no longer covers its contents (ADR §UI copy).


## 5. The corpus-derived sets — enumerated

`[literal]` Because #364 does not name the members of either set, #364's own
read-only instrument was **re-run against TEST in this pass**
(`data/scripts/measure-category-source-audit-2026-09-02.ts`, 2026-09-03T19:49Z)
and differenced against the code constants. It reproduced #364's structural
totals exactly — **161,431** `master_place` rows, **33,216** in-scope, **70**
distinct `primary_category` values — which is what licenses treating the derived
sets below as continuous with #364 rather than as a competing measurement.

Scope, stated as #364 stated it: **TEST only**, in-scope = the
`master_place_search_export` definition. PROD is not described.

### 5.1 The 22 unclaimed corpus primaries — complete `[literal]`

Present in the corpus, claimed by **no** slide bucket. The count independently
reproduces #364's 22, and contains all four members #364 named as its sample.

| Primary | total | in-scope | Also a tile? | Suppressed? | `[proposed]` disposition |
|---|--:|--:|---|---|---|
| `picnic_area` | 4,668 | 1,223 | — | **yes** | → `scenic` subtype. Unsuppression is a precondition. |
| `public_land` | 1,327 | 448 | — | — | leave in `interest` fallback — land tenure, not a POI (#364) |
| `toilet` | 630 | 128 | — | **yes** | → `camping` services, with §4.3 |
| `water` | 963 | 169 | **yes** | **yes** | see §4.3 — open |
| `dump_station` | 99 | 6 | **yes** | **yes** | see §4.3 — open |
| `shower` | 25 | 4 | **yes** | **yes** | see §4.3 — open |
| `hut` | 56 | 52 | — | — | → `hotel`/`overnight`. Shelter, not a point of interest. |
| `historic` | 26 | 24 | — | — | → `attraction`. Blocked on §4.4. |
| `land_status` | 35,966 | **0** | — | — | none — polygon layer, contributes nothing |
| `fire_pit` | 3,409 | **0** | — | **yes** | none while zero in-scope |
| `brewery` | 3 | **0** | — | — | → `food` if it ever populates |
| `lodging` | 2 | 1 | — | — | → `hotel`/`overnight` — near-synonym of a claimed primary |
| `interest` | 2 | 2 | — | — | bare primary sharing a bucket name — #364 §4.5 ambiguity |
| `monument` | 2 | 1 | — | — | → `attraction`. Blocked on §4.4. |
| `coffee_shop` | 1 | 1 | — | — | → `food` — near-synonym of claimed `cafe` |
| `food_court` | 1 | 1 | — | — | → `food` |
| `electric_vehicle_charging_station` | 1 | 1 | — | — | → `fuel` — long-form synonym of claimed `ev_charging` |
| `historical_place` | 1 | 1 | — | — | → `attraction`. Blocked on §4.4. |
| `construction_camp_site` | 1 | 1 | — | — | none — ingestion artifact |
| `intersection` | 1 | 1 | — | — | none — ingestion artifact |
| `transportation_service` | 1 | 1 | — | — | none — ingestion artifact |
| `southwestern_us_restaurant` | 1 | **0** | — | — | → `food` if it populates |

**The dominant finding here is synonym drift, not missing categories.**
`coffee_shop`/`cafe`, `electric_vehicle_charging_station`/`ev_charging`,
`lodging`/`hotel`, `historical_place`/`historic`/`historical_landmark` are the
same concepts arriving under different labels from different ingest sources.
`[proposed]` Normalising synonyms at ingest is a cheaper fix than adding
subtypes for each, and it shrinks this table substantially.

**No member of the 22 needs a 10th category.** Every one either maps to an
existing parent, is an ingestion artifact, or is a non-POI polygon layer.

### 5.2 The claimed-but-empty set — and a reconciliation with #364

`[literal]` Claimed primaries with **zero in-scope rows**: **42**. #364 reports
**40**. The gap is definitional, not a disagreement, and it resolves exactly:
#364 counted primaries with zero rows *at all*, while this pass counted zero
**in-scope** rows. Exactly two primaries — `river` and `steak_house` — have one
corpus row each that falls outside the in-scope filter. 42 − 2 = 40.

By parent: **food** 15 (`fast_food_restaurant`, `italian_restaurant`,
`chinese_restaurant`, `indian_restaurant`, `french_restaurant`,
`brazilian_restaurant`, `taco_restaurant`, `chicken_restaurant`,
`family_restaurant`, `fine_dining_restaurant`, `sandwich_shop`, `bar_and_grill`,
`gastropub`, `brewpub`, `grocery_store`, plus `steak_house` out-of-scope) ·
**interest** 10 (`amphitheatre`, `atm`, `bus_stop`, `car_repair`, `car_wash`,
`casino`, `government_office`, `marina`, `mobile_home_park`, `park_boundary`,
`point_of_interest`, `sports_activity_location`) · **attraction** 3 (`museum`,
`art_gallery`, `national_historic_site`) · **scenic** 3 (`hiking_area`, `lake`,
plus `river` out-of-scope) · **camping** 2 (`rv_park`, `camping_cabin`) ·
**urban** 2 (`city_park`, `shopping_mall` — the whole bucket) · **oddity** 2
(`roadside_attraction`, `tourist_attraction`) · **overnight** 1 (`motel`) ·
**fuel** 1 (`truck_stop`).

**Empty ≠ wrong parent.** Every one of the 42 already has a defensible parent;
zero rows is a *routing* fact — whether a live source can fill the gap — and is
handled in the routing table, not by reassignment. The two rows that matter for
this design are `urban` (both its primaries are empty, so the bucket is
structurally empty, not merely sparse) and `car_repair`/`car_wash` (empty corpus
against dense live coverage per #366 — §4.1).

---

## 6. What the collapse actually costs

`[literal]` Consequences that follow arithmetically from §2 and §3:

1. ~~**Three of the nine chips gain no subtypes**~~ — **AMENDED.** `attraction`
   now carries the **Culture** cluster (§4.7). `oddity` and `urban` still gain
   none, and `urban` remains structurally empty (§5.2).
2. ~~**`interest` absorbs the most heterogeneous set**~~ — **RESOLVED by §4.6.**
   The mechanics, car washes and suppressed amenities move to `fuel`/Services;
   the rest stays but renders no subtype chips and gets an honest label.
   **The residue is still a residue** — `facility` (2,245 in-scope `[literal]`)
   is unsplittable without richer ingest, and that, not the label, is the real
   remaining problem.
3. **The 13→9 collapse is not a 13→9 collapse in information terms.** Ten tiles
   already sit inside a parent; the collapse *removes a level of navigation*
   rather than removing concepts — provided the subtype chips actually ship. If
   subtypes are deferred, this is a capability regression, not a simplification.
4. **Empty chips at ship time — REVISED after Theaters was dropped.**
   `[literal]` Culture is now **3** chips, **2** with zero corpus rows
   (Museums, Galleries). **But those two are `R2 LIVE-PRIMARY` rows: empty in
   corpus, non-empty as soon as the `attraction` live route lands** — their
   emptiness is conditional on wiring, whereas Theaters' was permanent without an
   ingest change. Dropping Theaters therefore removed the only *blocked* chip
   while raising the *share* of empty ones. Historic Sites remains the only chip
   that returns anything today (`historic` 24, `landmark` 3, one row each of
   `historical_landmark`/`historical_place`/`monument`) and ships first.
   Services is the genuinely hard case: Water fill / Showers / Dump stations are
   suppressed **and** sourceless — R4, not merely unwired.

Points 3 and 4 are the ones worth the most scrutiny before implementation.
