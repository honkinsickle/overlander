# Investigation — source-to-category routing across all five sources

**Date:** 2026-09-03 (runs stamped 2026-09-04T05:16Z–05:33Z UTC)
**Branch:** `columbus`, cut from `main` at `31d6ae7`
**Mode:** READ-ONLY. TEST only. No writes to TEST or PROD, no ingest, no
Typesense, no schema change, no browser automation.

**Follow-up to** `2026-09-02-category-source-audit.md` (#364) and
`2026-09-03-live-source-coverage-sampling.md` (#366). Extends both across the
two sources neither examined — **Overpass/OSM** and **Foursquare's category
filter** — and re-measures the rest at a third, genuinely remote sample tier.

**Confidence key, used on every claim below:**
`[literal]` = directly computed in this pass, instrument named ·
`[strong inference]` = not directly measured, but follows from something that
was, with the step stated · `[estimated]` = a number or judgement that was NOT
computed — flagged as such every time · `[cited #N]` = carried by reference.

---

## 0. Five findings that change the routing answer

1. **`urban` is REFUTED as "no viable source exists."** `[literal]` Mapbox
   `shopping_mall` **exists in the canonical list** and returned results at
   **6/6 metro and 4/6 rural** points across all six states (150 + 22 features).
   `urban`'s other primary, `city_park`, **is genuinely absent** from Mapbox's
   482-id canonical list. Foursquare also has a Shopping Mall category
   (`4bf58dd8d48988d1fd941735`), **6/6 metro, 204 features**. So `urban`'s
   status is *unwired*, not *unsourceable*. See §5.

2. **Showers, dump stations and water fill are CONFIRMED absent from Mapbox and
   Foursquare — and abundantly present in OSM, the source nobody checked.**
   `[literal]` Overpass `out count;` over the six-state box:
   **945** `amenity=shower`, **521** `amenity=sanitary_dump_station`,
   **10,113** `amenity=drinking_water`. The corpus holds **4 / 6 / 167**
   in-scope. OSM is already the importer for exactly these tags. See §6.

3. **OSM is the corpus's largest contributor and its 82.3% inactive rate is the
   biggest single fact in this report.** `[literal]` OSM supplies **15,692** of
   the **33,103** in-scope master_places — more than the next three sources
   combined. It is also the **sole** source for `ev_charging`, `grocery`,
   `water`, `toilet`, `rest_area`, `dump_station` and `shower`. And **90,081 of
   its 109,492 source_records are `is_active = false` (82.3%)**, against ~0% for
   every other source. See §7 — **cause not determined here.**

4. **Every commercial live category returns ZERO at genuinely remote points —
   on both Mapbox and Foursquare.** `[literal]` At six remote anchors (one per
   state), Mapbox returned **0/6** for gas, auto repair, car wash, EV charging,
   grocery, museums, malls, laundry, rest areas — *and for campground and
   restaurant*. Foursquare returned **0/2** for all twelve categories probed.
   #366 raised this as a two-point hypothesis and said to weigh it, not build on
   it. It now rests on **six** points and **two independent providers**. See §4.

5. **EV charging cannot reach the live half at all, and the half-wiring is
   worse than no wiring.** `[literal]` `ev_charging` is absent from
   `LIVE_SLIDE_FOR_PRIMARY`, so a bbox request for it yields `slideKeys = []`
   and `resolveLive()` returns `[]` before any source is called. Meanwhile
   `MAPBOX_CATEGORY_FOR_PRIMARY` **does** contain `ev_charging` — mapped to
   **`gas_station`**. If only the first gap were closed, EV would return gas
   stations. See §8.

---

## 1. What has changed since the brief was written

The brief carried five premises from #364/#366. Checked rather than assumed:

| Premise in the brief | Status | Evidence |
|---|---|---|
| "Auto/Repair unwired on Mapbox" | **STALE — wired 2026-09-03 (#394)** | `MAPBOX_CATEGORY_FOR_PRIMARY` maps `car_repair`→`auto_repair`, `car_wash`→`car_wash` `[literal]` |
| "`repair_shop` → appliance/electronics mismatch, likely from Mapbox's flat list" | **CONFIRMED, and now characterised population-wide** | §9 `[literal]` |
| "Foursquare **category-search** endpoint 404ing → blocked" | **WRONG as stated** | The **taxonomy enumeration** endpoint 404s; `/places/search` **with `fsq_category_ids=`** returns HTTP 200 and is what production already calls `[literal]` |
| "`urban` has 0 corpus rows and no live source" | **Half right** | 0 corpus rows CONFIRMED; "no live source" REFUTED — §5 `[literal]` |
| "FuelStopCard's mystery `?category=fuel` endpoint with no importer" | **NOT a mystery** | `fuel-stop-card.tsx:14` calls `/api/trip-browse/[tripId]/[dayId]?category=fuel`, a route that exists at `web/src/app/api/trip-browse/[tripId]/[dayId]/route.ts` `[literal]` |

**Also stale: a routing table already exists** —
`docs/architecture/category-source-routing-table.md`, written by the #380→#389
design chain. This pass does not replace it; §11 lists exactly which of its rows
this pass contradicts.

**And one design decision is recorded as RESOLVED but is NOT in the code.**
`[literal]` The routing table's §3.1 says museums/galleries/landmarks move from
`oddity` to `attraction`. `resolve-places.ts:241` still reads
`museum: "oddity", art_gallery: "oddity", historical_landmark: "oddity"`, while
Google's `TYPES_BY_CATEGORY.oddity` is `[]`. §8 covers the consequence.

---

## 2. Instruments

All three are new, all read-only, all committed with this report.

| # | Instrument | What it produces |
|---|---|---|
| 1 | `data/scripts/measure-category-by-source-2026-09-03.ts` | corpus `primary_category` × `source_id` matrix, TEST |
| 2 | `web/scripts/sample-mapbox-six-state-2026-09-03.ts` | 482-id canonical enumeration + 540-request coverage probe + `poi_category` taxonomy audit |
| 3 | `web/scripts/probe-foursquare-taxonomy-2026-09-03.ts` | 24-combination 404 re-probe + category-id recovery + category-**filter** coverage |
| 4 | `web/scripts/probe-overpass-six-state-2026-09-03.ts` | six-state OSM `out count;` population + remote-anchor coverage |

**Sample points.** #366's twelve are reused **verbatim** so the figures are
directly comparable, plus **six new genuinely remote anchors**, one per state.
#366 flagged its own rural tier as heterogeneous — only 2 of its 6 "rural"
points are actually remote; the rest sit beside Bend, Show Low, St George and
I-10 — which is why its settlement hypothesis rested on two points.

**Every point's state was verified by Mapbox reverse geocoding, not asserted**
`[literal]` — the repo's `STATE_BOXES` classifier is known-broken for NV. All 18
points resolved to the expected state name. *(The instrument prints
"⚠ MISMATCH" on 6 rows; that is a defect in the instrument's comparator, which
tested for a two-letter code against a returned full region name — "ARIZONA"
does not contain the substring "AZ". The returned names are correct on all 18.)*

**Limits that govern every number below.**
- `limit=25` is Mapbox's ceiling and the app's `MAX_RESULTS`. A cell of 25 means
  **at least 25**. Saturated cells are counted separately.
- One fixed **10 km** probe radius for all categories, so densities are
  comparable across categories. Production uses per-category radii of 5–50 km,
  so for wide-radius categories (camping is 50 km) these are a **floor**.
- Overpass counts are **nodes only**, matching `overpass.ts`'s own `node[...]`
  queries — ways and relations carrying the same tag are **not** counted, so
  every population figure is a **floor**. The six-state **box** over-covers the
  real `six_state_footprint()` polygon at the edges, which pushes the other way.
  Both directions stated rather than resolved.
- **18 points on one day is a sample.** Nothing here describes Mapbox or
  Foursquare coverage outside those points. The Overpass `out count;` figures
  are the exception — those are population counts, not samples.

---

## 3. Corpus depth by source — the axis #364 did not measure

`[literal]` TEST, in-scope (`master_place_search_export`), 2026-09-04T05:16Z.
**33,103 in-scope master_places**; 94,434 active `source_record` rows, of which
55,090 point at an in-scope place.

A place is credited to **every** source with an active source_record on it, so
these columns sum to more than the distinct total.

| source_id | in-scope places | note |
|---|--:|---|
| **osm** | **15,692** | largest by far; sole source for 7 categories |
| generated_template | 5,059 | ⚠ a *description* generator, not a place source |
| ridb | 4,912 | |
| generated_llm | 4,597 | ⚠ description generator |
| usfs | 2,832 | |
| nps | 2,546 | |
| atlas_oddities | 2,182 | |
| state_parks | 728 | + 195 across the five per-state importers |
| editorial_food | 533 | |
| blm | 359 | |
| google_resolved / google | 95 / 5 | see the compliance note in §10 |
| wikipedia | 30 | |
| family_destinations | 13 | |

⚠ **`generated_template` and `generated_llm` rank 2nd and 4th and are not
sources.** They attach generated descriptions to places another source created;
neither can originate a place. Reading this table as a source ranking without
that caveat overstates them by two positions.

**Per-category, the routing-relevant rows** `[literal]`:

| primary_category | in-scope | contributing sources |
|---|--:|---|
| campground | 6,107 | osm 3,657 · ridb 1,679 · usfs 711 · state_parks 420 · nps 100 |
| trailhead | 4,758 | osm 2,714 · usfs 1,766 · nps 101 |
| park_feature | 3,678 | nps 2,214 |
| **ev_charging** | **2,884** | **osm 2,884 — sole source** |
| oddity | 2,708 | atlas_oddities 2,101 |
| dispersed_camping | 2,530 | osm 1,700 · blm 357 · usfs 159 |
| park | 2,480 | osm 2,405 |
| facility | 2,243 | ridb 1,914 |
| recreation_area | 1,550 | ridb 1,131 · state_parks family 200 |
| picnic_area | 1,222 | osm 818 · usfs 150 |
| restaurant | 556 | editorial_food 533 |
| **grocery** | **546** | **osm 546 — sole source** |
| viewpoint | 312 | osm 172 · nps 54 |
| **water** | **167** | **osm 163 — sole source** |
| **toilet** | **128** | **osm 121 — sole source** |
| visitor_center | 102 | ridb 34 · nps 11 |
| **rest_area** | **35** | **osm 35 — sole source** |
| **dump_station** | **6** | **osm 6 — sole source** |
| **shower** | **4** | **osm 4 — sole source** |
| **gas_station** | **1** | atlas_oddities 1 (!) |
| `car_repair` · `car_wash` · `shopping_mall` · `city_park` | **0 each** | absent from the corpus entirely |

---

## 4. Live coverage — six states, three tiers

`[literal]` 540 requests, **0 failures**. `metro`/`rural`/`remote` = points
returning ≥1 result out of 6 each. Features are floors (saturation at 25).

| Mapbox id | metro | rural | **remote** | feat m/r/rm | states with any |
|---|---|---|---|---|---|
| `gas_station` **[wired]** | 6/6 | 4/6 | **0/6** | 150/61/0 | all 6 |
| `auto_repair` **[wired]** | 6/6 | 4/6 | **0/6** | 150/100/0 | all 6 |
| `car_wash` **[wired]** | 6/6 | 4/6 | **0/6** | 150/47/0 | all 6 |
| `repair_shop` *[excluded]* | 6/6 | 4/6 | **0/6** | 150/61/0 | all 6 |
| `charging_station` *[unwired]* | 6/6 | 4/6 | **0/6** | 150/45/0 | all 6 |
| `grocery` *[unwired]* | 6/6 | 4/6 | **0/6** | 150/38/0 | all 6 |
| `supermarket` *[unwired]* | 6/6 | 4/6 | **0/6** | 150/22/0 | all 6 |
| `shopping_mall` *[unwired]* | 6/6 | 4/6 | **0/6** | 150/22/0 | all 6 |
| `laundry` *[unwired]* | 6/6 | 4/6 | **0/6** | 150/19/0 | all 6 |
| `museum` *[unwired]* | 6/6 | 4/6 | **0/6** | 146/12/0 | all 6 |
| `art_gallery` *[unwired]* | 6/6 | 3/6 | **0/6** | 150/20/0 | all 6 |
| `historic_site` *[unwired]* | 6/6 | **6/6** | **2/6** | 150/26/2 | all 6 |
| `monument` *[unwired]* | 6/6 | **6/6** | **2/6** | 150/26/2 | all 6 |
| `tourist_attraction` *[unwired]* | 6/6 | **6/6** | **4/6** | 150/71/5 | all 6 |
| `rest_area` *[unwired]* | 5/6 | 1/6 | **0/6** | 29/1/0 | 5 |
| `campground` *(control)* | 6/6 | 5/6 | **0/6** | 67/36/0 | all 6 |
| `restaurant` *(control)* | 6/6 | 5/6 | **0/6** | 150/101/0 | all 6 |
| `zzz_not_a_real_category` *(neg. control)* | 0/6 | 0/6 | 0/6 | 0/0/0 | — |
| `shower` · `dump_station` · `toilet` · `restroom` · `drinking_water` · `water` · `rv_park` · `city_park` · `truck_stop` · `tire_shop` · `truck_dealer` · `ev_charging_station` | 0/6 | 0/6 | 0/6 | 0/0/0 | **ABSENT from the canonical list** |

**Metro and rural reproduce #366 cell-for-cell** where the ids overlap — an
independent replication of that pass a day later.

**⚠ THE REMOTE COLUMN IS THE RESULT.** `[literal]` Thirteen of sixteen ids
returned **nothing at any of the six remote anchors** — including `campground`
and `restaurant`, the two dense controls. Only the historic/monument/tourist
family returned anything, and thinly (2/6, 2/6, 4/6). Foursquare, probed at two
of the same anchors, returned **0/2 on all twelve categories**.

**What this licenses, stated at its earned strength.** `[strong inference]`
Live commercial POI coverage from both vendors tracks **settlement**, not
geography, across this sample. Six points and two independent providers is
enough to act on where two was not. It is **not** a population claim: six
anchors on one day. What it does *not* say is that these vendors are bad — a
gas station genuinely does not exist in Saline Valley. It says the live half
**cannot be the answer for off-grid terrain**, which is the terrain the product
is for.

**Id-existence is now a membership test, not an inference.** `[literal]`
Mapbox's `/list/category` returned **482 canonical ids**. #364 could only spot-
check ids, and #366's own negative control showed a nonsense id returns HTTP 200
with 0 features — indistinguishable from a real-but-empty one. Membership
against the full list removes that ambiguity. A keyword sweep over all 482 found
**no** id containing `shower`, `dump`, `sanitar`, `toilet`, `restroom`, `tire`,
`mechanic`, `electric`, `ev_`, `fuel` or `petrol`; the only `charg` id is
`charging_station`, the only `wash` is `car_wash`, and the only `truck` is
`food_truck`.

⚠ **Three ids named in the brief's Google research are Google-only.** `[literal]`
`tire_shop`, `truck_dealer` and `ebike_charging_station`/
`electric_vehicle_charging_station` exist in Google's type list and are **absent
from Mapbox's 482**. Carrying a Google type list into Mapbox routing produces
silent zero-result categories.

---

## 5. `urban` — refuted

The brief asked to confirm or refute. **Refuted, on the live side.** `[literal]`

| | `shopping_mall` | `city_park` |
|---|---|---|
| Corpus in-scope | **0** | **0** |
| In Mapbox's 482 canonical ids | **YES** | **no** |
| Mapbox coverage | **6/6 metro, 4/6 rural, 0/6 remote** (150 + 22 feat) | — |
| Foursquare category id | **`4bf58dd8d48988d1fd941735` Shopping Mall** | not recovered |
| Foursquare coverage | **6/6 metro, 0/2 remote** (204 feat) | — |
| OSM `shop=mall` nodes, six-state | **101** | — |

`urban`'s corpus emptiness is confirmed (0 and 0). But **"no live source" is
false for `shopping_mall`** — two independent providers cover it densely in
metro, in all six states.

**What this does and does not bear on.** Decision 9 removed the `urban` chip
from the UI, and the ADR records "no live source and no corpus, measured twice"
as the premise. **The corpus half of that premise holds; the live half does
not.** Whether the chip should return is Adam's call and is not proposed here —
this pass only corrects the sourcing fact the decision cited. `[literal]` for
the measurement; the decision itself is untouched.

*One honest caution before anyone acts on it:* `shopping_mall` is **0/6 remote**
like every other commercial category, and a shopping mall is arguably the least
overland-relevant category in the taxonomy. "A source exists" is not "it is
worth surfacing."

---

## 6. Showers, dump stations, water — confirmed absent from the vendors,
## abundant in OSM

`[literal]` Overpass `out count;` over the six-state box, against TEST in-scope
corpus depth for the category the OSM importer maps that tag to:

| OSM tag | OSM nodes | corpus in-scope | corpus/OSM | importer maps to |
|---|--:|--:|--:|---|
| `amenity=shower` | **945** | 4 | **0.4%** | `shower` |
| `amenity=sanitary_dump_station` | **521** | 6 | **1.2%** | `dump_station` |
| `amenity=drinking_water` | **10,113** | 167 | **1.7%** | `water` |
| `amenity=toilets` | **14,997** | 128 | **0.9%** | `toilet` |
| `amenity=fuel` | **6,864** | 1 | **0.0%** | `gas_station` |
| `tourism=viewpoint` | **7,467** | 312 | **4.2%** | `viewpoint` |
| `shop=car_repair` | **5,149** | 0 | 0.0% | *(no rule)* |
| `amenity=car_wash` | **1,370** | 0 | 0.0% | *(no rule)* |
| `shop=mall` | **101** | 0 | 0.0% | *(no rule)* |
| `amenity=charging_station` | 4,735 | 2,884 | 60.9% | `ev_charging` |
| `tourism=camp_site` | 9,804 | 6,107 | 62.3% | `campground` |
| `leisure=park` | 2,961 | 2,480 | 83.8% | `park` |

**The three "no viable source anywhere checked" categories have a source, and
it is one the pipeline already runs.** `[literal]` `water_san` is in
`DEFAULT_FAMILIES`, and `osm.ts`'s `TAG_TO_CATEGORY` already maps all four tags.
The gap is not sourcing.

⚠ **The ratio column separates two very different regimes and that is its
point.** Categories at 60–84% are ingested about as completely as this
instrument can detect. Categories at 0.4–4.2% are not. `[strong inference]` The
box/node caveats in §2 shift these ratios somewhat, but they cannot explain a
0.4% against an 83.8% measured the same way in the same box.

---

## 7. The 82.3% — the largest unexplained fact found

`[literal]` `source_record` active/inactive by source, TEST:

| source | active | inactive | inactive % |
|---|--:|--:|--:|
| **osm** | 19,411 | **90,081** | **82.3%** |
| ridb | 6,005 | 8 | 0.1% |
| nps | 5,283 | 0 | 0.0% |
| usfs | 6,324 | 6 | 0.1% |
| atlas_oddities | 2,870 | 0 | 0.0% |

This is what actually produces the §6 ratios. Walking one category down
`[literal]`:

| `primary_category` | master_place rows | is_searchable | **+ source_count > 0** | in export view |
|---|--:|--:|--:|--:|
| `gas_station` | 5,947 | 5,947 | **1** | 1 |
| `viewpoint` | 6,442 | 6,442 | **338** | 312 |
| `picnic_area` | 4,668 | 4,668 | **1,241** | 1,223 |
| `water` | 963 | 963 | **169** | 169 |
| `toilet` | 630 | 630 | **128** | 128 |
| `dump_station` | 99 | 99 | **6** | 6 |
| `shower` | 25 | 25 | **5** | 4 |

**The rows were ingested.** 5,947 gas-station master_places exist against 6,864
OSM `amenity=fuel` nodes — the ingest landed. They fall out at `source_count >
0`. Sampling those rows `[literal]`: each has exactly **one** source_record,
`source_id = osm`, **`is_active = false`** — including named ones like
*Speedway Express*, so it is not simply an unnamed-node filter.

⚠ **CAUSE NOT DETERMINED.** This pass measured the effect and stopped. Whether
the deactivation is a deliberate retirement, a re-ingest that superseded rows
without reactivating them, or a defect is **`[unverified]`** and is a separate
investigation. **It is named here because it is upstream of most of §6**: the
"no data for showers" reading is downstream of it, and any routing decision that
assumes the corpus is a faithful picture of what was ingested is resting on it.

---

## 8. Two live-path defects found by reading the code

**8.1 EV charging cannot reach the live half.** `[literal]`
`LIVE_SLIDE_FOR_PRIMARY` (`resolve-places.ts:220–242`) has **no `ev_charging`
key**. `resolveLive()`'s bbox path maps requested primaries through it and
returns `[]` when the result is empty (`resolve-places.ts:443–451`). So an EV
request never reaches a source.

**And the half that IS wired is wired wrong.** `MAPBOX_CATEGORY_FOR_PRIMARY`
maps `ev_charging → gas_station` (`mapbox-search-box.ts:72`). `[strong
inference]` Closing only the `LIVE_SLIDE_FOR_PRIMARY` gap would therefore return
**gas stations** under the EV tile — the exact failure mode #394 had to fix for
Auto/Repair. Both lines must change together: add `ev_charging: "fuel"` to
`LIVE_SLIDE_FOR_PRIMARY` **and** repoint `ev_charging → charging_station`.

This is the routing table's #1-ranked recommendation, and the table describes it
as "one wired source id." `[literal]` It is two changes in two files, and doing
only the obvious one is actively wrong.

**8.2 The Culture fix (§3.1) is recorded as resolved but is not in the code.**
`[literal]` `resolve-places.ts:241` still routes `museum`/`art_gallery`/
`historical_landmark` to `oddity`, while `google-places.ts:49–50` has
`attraction: ["museum","art_gallery","historical_landmark"]` and `oddity: []`.
`[strong inference]` A bbox request for the `museum` primary therefore fans out
under `oddity`, where Google contributes nothing by design and the Mapbox source
returns `[]` for non-fuel — so museums get essentially no live results today.

---

## 9. Taxonomy-mismatch risks — the `repair_shop` class, generalised

Mapbox's category list is **flat**; `/list/category` does not describe
parent/child relationships. An id whose *name* implies a hierarchy it does not
have is therefore a structural hazard, not a one-off. This pass recorded the
`poi_category` values Mapbox actually stamps on returned features, per id, so
the class is detectable for every id rather than only the one someone looked at.

**R1 — `repair_shop` exclusion CONFIRMED, now population-characterised.**
`[literal]` `repair_shop` → `repair shop`(211) · `services`(211), with **zero**
`mechanic`. `auto_repair` → `mechanic`(250) · `services`(237). **Disjoint.** The
2026-09-03 exclusion was correct and rests on more than one probe now.

**R2 — `historic_site` and `monument` are near-duplicates.** `[literal]` Both
returned **178** features with near-identical profiles: `historic_site` →
`historic site`(178) · `tourist attraction`(176) · `monument`(141);
`monument` → `historic site`(178) · `monument`(178) · `tourist
attraction`(178). `[strong inference]` Wiring both for Historic Sites would
double-fetch a largely identical set. Wire **one**; `historic_site` is the
better name-to-concept fit. *(Dedupe by canonical id in `discover()` would
absorb much of the overlap — this is a wasted-request and ranking concern, not a
duplicate-cards one.)*

**R3 — `tourist_attraction` is a SUPERSET of the Culture set.** `[literal]` It
returned `tourist attraction`(226) · **`museum`(72)** · **`historic site`(52)**
· **`monument`(42)**. The routing table proposes wiring it to `oddity` as
"the obvious follow-up." `[strong inference]` Doing that would pour museums,
historic sites and monuments **into `oddity`** — reintroducing precisely the
mis-filing §3.1 exists to fix. **Do not wire `tourist_attraction` to `oddity`
until §8.2 lands, and even then expect cross-contamination.**

**R4 — `grocery` and `supermarket` heavily overlap.** `[literal]` `grocery` →
`grocery`(188) · `shopping`(188) · **`supermarket`(143)**; `supermarket` →
`grocery`(172) · `supermarket`(172). `[strong inference]` `grocery` is the
broader id and largely contains `supermarket`. Wire **`grocery` alone**; the
routing table's "wire `grocery`/`supermarket`" would double-request.

**R5 — `gas_station` is not purely fuel.** `[literal]` `gas station`(211) plus
`convenience store`(9) · `grocery`(9) · `shopping`(9) · `mechanic`(5) ·
`car wash`(5). Minor, and arguably correct for a travel product, but it means
the wired Gas tile already emits a few mechanics and car washes — worth knowing
now that Auto/Repair is a separate tile drawing from the same slide bucket.

**R6 — `car_wash` stamps `transportation`, `charging_station` stamps
`transportation`.** `[literal]` Both carry a broad secondary. No action; recorded
so a future `transportation`-based filter is not assumed to be narrow.

**R7 — Foursquare's taxonomy is deep, and that cuts both ways.** `[literal]`
Recovering ids from data surfaced **315 distinct categories** from 12 seed
queries, including a distinct *Automotive Repair Shop*, *Car Wash and Detail*,
*Electric Vehicle Charging Station*, *Fuel Station*, *RV Park* and *Hiking
Trail*. Depth is real and is the best available disambiguation for Auto/Repair
subtypes. **But the enumeration endpoint still 404s**, so any id set is
seed-dependent and cannot be validated against the published vocabulary.

---

## 10. Foursquare — the 404 re-probed, and the blocker partly dissolved

`[literal]`, this session:

- **Taxonomy enumeration: 24/24 combinations returned HTTP 404.** #366's finding
  **reproduces exactly** — 4 paths × 3 API versions × 2 auth styles.
- **`/places/search`: HTTP 200, 10 results.** Not 404.
- **`/places/search` with `fsq_category_ids=`: HTTP 200, 10 results.** Not 404.

**So the brief's "Foursquare category-search endpoint 404ing → blocked until
fixed" is wrong, and the correction matters.** What is broken is *downloading
the category list*. Category **filtering** works and is what `foursquare.ts`
already does in production.

**#366's blocker is therefore partly dissolved.** It said the Mapbox-vs-FSQ
comparison could not be settled because FSQ evidence was name-search against
Mapbox's category-filter. Recovering ids from search results and feeding them
back as filters gives the like-for-like instrument `[literal]`:

| Row | Recovered category id | name | metro | remote | feat |
|---|---|---|---|---|--:|
| Auto/Repair | `52f2ab2ebcbc57f1066b8b44` | Automotive Repair Shop | 6/6 | **0/2** | 300 |
| Car wash | `4f04ae1f2fb6e1c99f3db0ba` | Car Wash and Detail | 6/6 | **0/2** | 288 |
| **EV charging** | `5032872391d4c4b30a586d64` | Electric Vehicle Charging Station | 6/6 | **0/2** | 285 |
| Gas | `4bf58dd8d48988d113951735` | Fuel Station | 6/6 | **0/2** | 300 |
| Grocery | `4bf58dd8d48988d118951735` | Grocery Store | 6/6 | **0/2** | 292 |
| **Trailhead** | `4bf58dd8d48988d159941735` | Hiking Trail | 6/6 | **0/2** | 218 |
| Shopping mall | `4bf58dd8d48988d1fd941735` | Shopping Mall | 6/6 | **0/2** | 204 |
| Campground | `4bf58dd8d48988d1e4941735` | Campground | 6/6 | **0/2** | 90 |
| RV park | `52f2ab2ebcbc57f1066b8b53` | RV Park | 6/6 | **0/2** | 64 |
| Dump station | — | **no id recovered** | — | — | — |
| Shower | — | **no id recovered** | — | — | — |
| Drinking water | — | **no id recovered** | — | — | — |

⚠ **A matcher bug caught in this run, recorded because it nearly became a
number in this report.** The first pass matched dump stations with `/dump/` and
selected **"Dumpling Restaurant"** — which would have been printed as dump-
station coverage (6/6 metro, 51 features). The matchers were re-anchored to
whole category names and the run repeated. Same class as #366's abort artifact:
an instrument that can name the wrong thing reports confidently on it.

**Reading the "no id recovered" rows.** `[literal]` No harvested name contains
"shower" or "water" **at all** across 315 categories. `[strong inference]` That
is meaningfully stronger than #366's text-search near-zero, because these ids
come from what Foursquare *classifies*, not what places are *named* — but it
remains seed-dependent, so it is **evidence of absence, not proof**.

**On trailheads, #366's open question:** FSQ *Hiking Trail* returns **6/6 metro,
218 features** under a genuine category filter, against Mapbox `trailhead`'s
2/6 metro / 3 features `[cited #366]`. `[strong inference]` This is now a
like-for-like comparison and Foursquare is the better live trailhead source.
Caveat: "Hiking Trail" is a trail, not a trailhead — a related but not identical
concept. Worth wiring; worth checking what the cards look like first.

**Remote: 0/2 on every single row**, matching Mapbox's 0/6.

---

## 11. THE ROUTING TABLE

Category → recommended **live** source → recommended **corpus** source, with
confidence. Corpus depths are TEST in-scope `[literal]`. **Nothing here is
authorised** — it is a recommendation for Adam to argue with.

**Recommendation confidence** is about the *routing call*, not the underlying
measurement; each row's measurements carry their own labels above.

| # | Category / subtype | Corpus now | **Live source** | **Corpus source** | Confidence | Why |
|---|---|--:|---|---|---|---|
| 1 | **camping** / `campground` | 6,107 | Mapbox `campground` (metro/rural only) | **osm + ridb + usfs** (already) | **high** | corpus 6,107 vs live 0/6 remote; live is a metro supplement |
| 2 | **camping** / `dispersed_camping` | 2,530 | **none — do not wire** | **osm + blm + usfs** (already) | **high** | no Mapbox id; FSQ *RV Park* is a different concept |
| 3 | **camping** / `rv_park` | 0 | FSQ *RV Park* `52f2ab…8b53` (6/6 metro) | osm `tourism=caravan_site` | medium | Mapbox has no `rv_park` id `[literal]`; FSQ does |
| 4 | **scenic** / `trailhead` | 4,758 | **FSQ *Hiking Trail*** — **not** Mapbox | **osm + usfs** (already) | medium | §10; reverses #364, refines #366. Concept mismatch caveat |
| 5 | **scenic** / `viewpoint` | 312 | **none — do not wire** Mapbox (0/6 remote, 4/6 metro) | **osm — under-ingested, see §7** | **high** | OSM holds 7,467 nodes vs 312 in-scope |
| 6 | **scenic** / `park` | 2,480 | Mapbox `park` | osm (already, 83.8% ingested) | medium | dense both halves; §3.2 routes it here |
| 7 | **scenic** / `park_feature`, `recreation_area` | 3,678 · 1,550 | none | nps · ridb (already) | **high** | no live analogue exists |
| 8 | **fuel** / `gas_station` | **1** | **Mapbox `gas_station`** (wired) | **osm — 5,947 rows blocked by §7** | **high** | live-only *today*; the corpus half is a §7 casualty, not an absence |
| 9 | **fuel** / `ev_charging` | 2,884 | **Mapbox `charging_station`** — **two-line fix, §8.1** | osm (already, 60.9%) | **high** | closes the inversion; the naive one-line version returns gas |
| 10 | **fuel** / Auto/Repair | 0 | **Mapbox `auto_repair` + `car_wash`** (wired #394) | **none — or add osm `shop=car_repair` (5,149 nodes)** | **high** | live confirmed 6/6 metro, 4/6 rural, **0/6 remote** |
| 11 | **fuel** / `truck_stop` | 0 | Mapbox `gas_station` (approximation) | none | medium | no `truck_stop` id in Mapbox's 482 `[literal]` |
| 12 | **fuel** / `rest_area` | 35 | Mapbox `rest_area` — **thin, 5/6 metro but 1/6 rural** | osm (sole source) | low | partial at best; corpus also thin |
| 13 | **fuel** / Showers | 4 | **NONE — confirmed** (Mapbox + FSQ) | **osm — 945 nodes available** | **high** | §6. Sourceable via ingest, not via wiring |
| 14 | **fuel** / Dump stations | 6 | **NONE — confirmed** | **osm — 521 nodes available** | **high** | §6 |
| 15 | **fuel** / Water fill | 167 | **NONE — confirmed** | **osm — 10,113 nodes available** | **high** | §6 |
| 16 | **food** / `restaurant` | 556 | Mapbox `restaurant` + Google + FSQ | editorial_food (already) | **high** | dense metro/rural, 0/6 remote |
| 17 | **food** / `cafe` | 2 | Mapbox `cafe`/`coffee_shop` | none | **high** | live-carried; corpus is empty |
| 18 | **food** / `grocery` | 546 | **Mapbox `grocery` — alone, NOT `supermarket`** (R4) | osm (sole source) | **high** | unwired; overlap risk documented |
| 19 | **hotel/overnight** | ~4 | Mapbox `hotel`/`motel`/`lodging` + Google + FSQ | **none exists** | **high** | total live dependency — an availability risk, not a coverage gap |
| 20 | **attraction** / Museums, Galleries | 0 | Mapbox `museum`, `art_gallery` + Google + FSQ — **blocked on §8.2** | none | **high** | unreachable today; the code fix is 3 lines |
| 21 | **attraction** / Historic Sites | ~29 | **Mapbox `historic_site` — one id, NOT also `monument`** (R2) | california/oregon/nevada state parks | **high** | best-measured coverage in the table (6/6, 6/6, 2/6 remote) |
| 22 | **attraction** / `visitor_center` | 102 | Google, FSQ | ridb + nps (already) | medium | |
| 23 | **oddity** | 2,708 | **none — do NOT wire `tourist_attraction`** (R3) | atlas_oddities (already) | **high** | superset would re-pollute with Culture |
| 24 | **interest** / `facility` | 2,243 | none | ridb (already) | **high** | generic RIDB container; unsplittable without richer ingest |
| 25 | **urban** / `shopping_mall` | 0 | **Mapbox `shopping_mall`** *(exists, dense — §5)* | none; osm `shop=mall` = 101 nodes | medium | **source exists**; whether to surface is a product call |
| 26 | **urban** / `city_park` | 0 | **NONE — confirmed absent from Mapbox's 482** | osm `leisure=park` → routes to `scenic` | **high** | |

### Cross-cutting: the corpus is the only source that works off-grid

`[strong inference]` Rows 1, 2, 4, 5, 7, 23 and 24 all carry deep corpus against
**0/6 remote** live coverage. **Corpus-primary routing is correct for every
deep-corpus category**, and #366's hypothesis — held at two points, explicitly
flagged as not-to-build-on — is now supported at six points across two
providers. `[literal]` OSM was the only source returning *anything* at the
remote anchors (camp sites 18 at Hart's Pass, 2 at Alvord, 1 at Toroweap;
toilets 3/3/5; viewpoints 2 at Toroweap), and even it returned **0 fuel and 0
charging at all six**.

---

## 12. Recommended order, and what is NOT recommended

`[proposed]` — ordered by measured value per unit of work.

1. **Investigate the 82.3% OSM deactivation (§7).** Ahead of every wiring item.
   It gates 5,946 gas stations, ~6,100 viewpoints, ~3,400 picnic areas and ~800
   water/toilet rows *that are already ingested*. No API work competes with
   unblocking rows the corpus already holds. **Diagnosis first — not a fix.**
2. **Wire EV: both lines together (§8.1).** `ev_charging: "fuel"` in
   `LIVE_SLIDE_FOR_PRIMARY` **and** `ev_charging → charging_station` in
   `MAPBOX_CATEGORY_FOR_PRIMARY`. Highest-value live change; doing half is worse
   than doing none.
3. **Land the Culture fix (§8.2).** 3 lines; a design decision recorded as
   resolved is sitting unimplemented, and museums are live-unreachable until it
   lands.
4. **Wire Mapbox `grocery`** — alone, not with `supermarket` (R4).
5. **Wire Mapbox `historic_site`** — alone, not with `monument` (R2).
6. **Decide on OSM ingest depth for water/showers/dumps/viewpoints** — a
   product call, not a routing one. The source is wired; only the decision to
   deepen is missing. Blocked behind item 1, which may already explain the gap.
7. **Test FSQ *Hiking Trail* for trailheads** before wiring — the concept
   mismatch (trail ≠ trailhead) needs eyes on real cards.

**Explicitly NOT recommended:**
- ❌ **Do not wire Mapbox `tourist_attraction` to `oddity`** (R3).
- ❌ **Do not wire Mapbox `trailhead` or `viewpoint`** — #366's reversal holds
  and this pass adds 0/6 remote to it.
- ❌ **Do not wire both `grocery` and `supermarket`**, or both `historic_site`
  and `monument`.
- ❌ **Do not treat Foursquare as blocked.** Category filtering works today.
- ❌ **Do not port Google type names into Mapbox routing** — `tire_shop`,
  `truck_dealer`, `electric_vehicle_charging_station` are not Mapbox ids.

### On Google Places

`[literal]` The compliance rule ("warehousing is not compliant", recorded in
`docs/decisions/2026-08-25-mapbox-fuel-source.md`) means Google routes
**live-at-render only, never to the corpus**. Google's type list is the richest
of the four — 180+ types including `car_repair`, `tire_shop`,
`electric_vehicle_charging_station` — but that richness is unusable for the
corpus half by rule, and on the live half it is constrained by the Places UI Kit
requirement on a non-Google map, which is why fuel moved to Mapbox.

⚠ `[literal]` **The corpus nonetheless holds 95 `google_resolved` and 5 `google`
places.** The decision doc anticipates this (corpus warehoused independently of
live browse). Flagged for a compliance read, **not** diagnosed here — it is 100
rows out of 33,103 and outside this pass's scope.

---

## 13. What this pass did NOT establish

Stated plainly so none of it is read in by implication:

- **Why 82.3% of OSM source_records are inactive.** `[unverified]` Measured,
  not explained. §7.
- **Whether PROD looks like TEST.** Every corpus figure is **TEST**. `[literal]`
  No PROD number appears anywhere in this report.
- **Whether Foursquare's taxonomy contains a shower/water/dump category.** The
  315 recovered ids are seed-dependent. Evidence of absence, not proof. §10.
- **Any population claim about Mapbox or Foursquare coverage.** 18 points and 8
  points respectively, on one day. Only the Overpass `out count;` figures are
  population counts.
- **Whether the remote-tier zeros generalise beyond six anchors.** Six points and
  two providers is strong enough to route on; it is not a survey.
- **Anything about ways/relations in OSM.** Node counts only — every OSM
  population figure is a floor.

---

## Visual reference — Paper board

§11's table is also drawn as a scannable diagram:
**Paper file "Source → Category Routing — PR #400"**
(https://app.paper.design/file/01M1NG6YRP0516FQEK3Y7K64DG) ·
exported to `docs/assets/2026-09-03-source-category-routing-diagram.png`.

**It is its own top-level file, deliberately.** It was first built as a *page*
inside `overlander_1`, which turned out to be the wrong call: Paper's file
browser shows one thumbnail per file, so a page inside a 84-artboard file is
invisible from the place people actually go looking. The two PR #361
investigation boards are separate files for the same reason. Moved 2026-09-03;
the old `overlander_1` page is emptied and carries a signpost (Paper's MCP has
no delete-page call, so **the empty page needs deleting by hand**).

**The board is a VIEW of this report, not a second source.** Every figure on it
is carried from here; nothing was re-measured to draw it. Where the two ever
disagree, this document wins.

**Three things the board does deliberately, worth knowing before reading it:**

1. **It draws `fuel` split into five sub-rows** (Gas · Auto/Repair · EV ·
   Services · Rest areas) rather than as one row. The brief asked for
   nine categories plus Auto/Repair and EV; `fuel`'s subtypes carry **four
   different verdicts** (wired · wired · unwired-and-mis-mapped · no live source
   at all), so a single `fuel` row would have misreported three of the five.
2. **It carries BOTH confidence systems, in separate columns**, because §11 uses
   two and collapsing them would soften one. The colour chip is the *evidence*
   label (`[literal]` / `[strong inference]` / `[estimated]` / `[unverified]`);
   the `H` / `M` / `L` beside it is §11's *routing-call* confidence.
3. **It distinguishes "0/6 remote" from "not probed remote."** `hotel` and
   `scenic`'s own ids were not in this pass's remote probe set, so their remote
   behaviour is **unknown, not zero** — the board says so rather than leaving a
   blank that would read as an absence.

`camping` and `hotel` share `#6ECECE` in DESIGN.md §1.2, so on the board they
are told apart by label, not by colour. That is the design system as written,
not a drafting slip.

---

## Reproducing

```
# corpus (TEST, read-only)
npx tsx --env-file=data/.env data/scripts/measure-category-by-source-2026-09-03.ts

cd web
export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
npx tsx scripts/sample-mapbox-six-state-2026-09-03.ts

export FSQ_API_KEY=$(grep '^FSQ_API_KEY=' .env.local | cut -d= -f2-)
npx tsx scripts/probe-foursquare-taxonomy-2026-09-03.ts

npx tsx scripts/probe-overpass-six-state-2026-09-03.ts   # no key needed
```

All four are read-only. Three hit only public vendor APIs; the corpus one
refuses to run against any project ref other than TEST.
