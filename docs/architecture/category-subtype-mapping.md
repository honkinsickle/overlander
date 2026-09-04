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
| Auto / Repair | FUEL & REPAIR | yes | `car_repair`, `car_wash` | **interest** ⚠️ | `[literal]` — residual bucket, see §4.1 |
| Coffee | FOOD | — | `cafe` | **food** | `[literal]` |
| Restaurants | FOOD | — | 22 cuisine primaries | **food** | `[literal]` |
| Groceries | SUPPLY | — | `grocery`, `grocery_store` | **food** ⚠️ | `[literal]` — see §4.2 |
| Water fill | SUPPLY | yes | `water` | **interest** | `[proposed]` — unclaimed today, see §4.3 |
| Showers | SERVICE | yes | `shower` | **interest** | `[proposed]` — unclaimed today |
| Dump stations | SERVICE | yes | `dump_station` | **interest** | `[proposed]` — unclaimed today |
| Hotels | STAY | — | `hotel`, `motel`, `resort_hotel` | **hotel** (`overnight`) | `[literal]` |

**Collapse summary:** the 13 tiles fold into **6** of the 9 parents — camping,
scenic, fuel, food, hotel, interest. **No tile maps to `attraction`, `oddity`, or
`urban`**, so under the collapse those three chips have no Find Nearby subtypes
at all today. `[literal]` That is a UX consequence worth confirming, not a defect.

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
| | `museum`, `art_gallery`, `historical_landmark` | ⚠️ **`oddity`** — see §4.4 |
| **oddity** | `oddity`, `roadside_attraction`, `tourist_attraction` | all `NONE` |
| **urban** | `shopping_mall`, `city_park` | all `NONE` |
| **interest** | `rest_area`, `activity_pass`, `permit`, `tree_permit`, `timed_entry`, `ticket_facility`, `venue_reservations`, `hardware`, `outdoor_gear`, `marina`, `casino`, `library`, `atm`, `bus_stop`, `government_office`, `kiosk`, `amphitheatre`, `mobile_home_park`, `national_fish_hatchery`, `sports_activity_location`, `park_boundary`, `facility`, `point_of_interest`, `unknown` | all `NONE` |

Two structural observations, both `[literal]`:

- **Every one of the 45 has `live: NONE` except the three in §4.4.** The live
  bbox half cannot reach any of them. Anything in this table is corpus-or-nothing
  regardless of how the UI presents it.
- **`interest` holds 24 of the 45.** It is not a category; it is the residue of
  one. §4.1 and §6 both follow from this.

---

## 4. Assignments that do not fit cleanly — flagged, not forced

### 4.1 `car_repair` / `car_wash` → `interest` — the worst UX consequence of the collapse

`[literal]` The Auto / Repair tile's primaries live in `interest`. Under a strict
collapse, a user looking for a mechanic taps a chip labelled **"POINT OF
INTEREST"**. `[cited]` #366 rates Auto/Repair "**the cleanest wiring win
available**" — dense Mapbox coverage against zero corpus rows — so this is a
category about to get *more* useful, filed under the app's least meaningful
label.

`[open]` Three ways out, none taken here: (a) accept it and fix the chip label;
(b) move `car_repair`/`car_wash` into `fuel`, making that chip "fuel & repair" in
substance if not in name; (c) admit a 10th category. **(b) is the smallest change
that removes the absurdity** and matches the existing Find Nearby group heading
"FUEL & REPAIR" — but it widens a canonical category, which is exactly the kind
of decision this ADR exists to make deliberately rather than by drift.

### 4.2 `grocery` / `grocery_store` → `food`

`[literal]` Already assigned to `food` in `SLIDE_TO_PRIMARY_CATEGORY`, while the
tile sits under a **SUPPLY** heading. Groceries-as-food is defensible (it is
consumables) but "Food" to an overlander reads *restaurants*, and resupply is a
distinct trip-planning job. Flagged for §7; no change proposed.

### 4.3 `water` / `shower` / `dump_station` → `interest` `[proposed]`

`[literal]` These three are the **entire** tile-only set: claimed by a tile,
claimed by no slide bucket, and simultaneously members of
`SUPPRESSED_PRIMARY_CATEGORIES` — so they are dropped at `hydrate.ts:140` even
when a corpus row exists.

`[proposed]` Parent = `interest`, on the same residual logic that already holds
`rest_area`. **The honest alternative is `camping`** — they are campsite
services, and an overlander looks for them while choosing where to sleep, not
while browsing points of interest. This document proposes `interest` only because
it is the assignment that requires no change to a category's meaning; **it is the
weaker of the two on user intent.**

**Assigning a parent is not deciding their UI fate.** Whether they appear at all
is ADR §Open decision, and is Adam's call.

### 4.4 ⚠️ `museum` / `art_gallery` / `historical_landmark` — the corpus and live paths disagree

**A divergence found in this pass, not previously written down** `[literal]`:

| Path | Constant | Files these three under |
|---|---|---|
| Corpus / federated | `SLIDE_TO_PRIMARY_CATEGORY` (`federated.ts:43-46`) | **`attraction`** |
| Live bbox | `LIVE_SLIDE_FOR_PRIMARY` (`resolve-places.ts:236`) | **`oddity`** |
| Google fanout | `TYPES_BY_CATEGORY.attraction` (`google-places.ts`) | asked for under **`attraction`** |

So a request for `attraction` asks Google for museums and galleries, and the
results are then filed into `oddity`. No comment in either file explains the
split; `federated.ts` annotates its three as "forward-compat (0 rows today)".

`[unverified]` Whether this is deliberate or a transcription slip is **not
established** — no comment, commit message or ADR found in this pass explains it.
`[cited]` #364 measured `museum` and `art_gallery` at zero corpus rows, which is
why the split has had no visible effect: there are no corpus rows to misfile, and
the live half only misfiles when the live path is on.

**It must be resolved before the routing table is implemented**, because the
routing table's whole premise is one answer per category. Recorded as an open
item in the ADR.

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

### 4.6 Primaries that arguably should not be a user-facing subtype at all

`[proposed]` Within `interest`: `unknown`, `point_of_interest`, `park_boundary`,
`facility`, `bus_stop`, `atm`, `government_office`, `kiosk`,
`mobile_home_park`. These are ingestion artifacts or civic infrastructure, not
things an overlander browses for. **The proposal is that a primary having a
parent does not oblige the UI to render it as a chip** — subtype chips should be
a curated subset, and the parent mapping is the data contract underneath.

---

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

1. **Three of the nine chips gain no subtypes** — `attraction`, `oddity`,
   `urban` have no Find Nearby tile mapping to them.
2. **`interest` absorbs the most heterogeneous set** — 24 of the 45 slide-only
   primaries plus, by fallback, every unclaimed corpus primary, plus (as
   proposed) the three suppressed amenities and the Auto/Repair pair. A chip
   labelled "POINT OF INTEREST" that contains mechanics, car washes, dump
   stations, ATMs and bus stops is not a category a user can reason about.
3. **The 13→9 collapse is not a 13→9 collapse in information terms.** Ten tiles
   already sit inside a parent; the collapse *removes a level of navigation*
   rather than removing concepts — provided the subtype chips actually ship. If
   subtypes are deferred, this is a capability regression, not a simplification.

Point 3 is the one worth the most scrutiny before implementation.
