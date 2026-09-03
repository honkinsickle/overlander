# Investigation — live-source coverage sampling (closes the #364 gap)

**Date:** 2026-09-03 (runs stamped 2026-09-03T00:49Z and 00:52Z UTC)
**Branch:** `mapbox-coverage-sampling`, cut from `main` at `9d936af`
**Mode:** READ-ONLY. No writes to TEST or PROD, no ingest, no Typesense, no
browser automation. Two DB reads (TEST) used only to pick sample anchors.

**Follow-up to** `docs/investigations/2026-09-02-category-source-audit.md`
(PR #364), which established which Mapbox canonical category ids **exist** but
explicitly did not ask whether data actually **comes back**. That was the last
open unknown before a vocabulary/routing decision. This pass closes it.

**The routing table and canonical vocabulary remain deferred.** Nothing is
proposed here.

---

## What changed versus #364

#364's Mapbox column answered "is the door there." This pass asks "is anything
behind it," and the answer **reverses the reading of two rows**:

- **Trailheads** and **Viewpoints** were listed in #364 as *"id exists,
  available, unwired"* — implying wiring would help. **Sampling shows Mapbox has
  almost no data for either.** Wiring Mapbox for these would add close to
  nothing. Foursquare — **already wired** — has visibly better data for both.
- **Auto / Repair** was the same label, and it holds up completely: Mapbox
  saturates at every settled sample point against **zero** corpus rows.

Same label in #364, opposite conclusion once sampled. That is the value of this
pass.

---

## Method

### Instruments

| # | Instrument | Output |
|---|---|---|
| 1 | `web/scripts/sample-mapbox-coverage-2026-09-03.ts` | 26 Mapbox ids × 12 points = **312** requests |
| 2 | `web/scripts/sample-foursquare-coverage-2026-09-03.ts` | Foursquare text probe, 11 query×row pairs × 12 points |

Both import nothing from the app except `bboxFromCoords`, so the bbox maths is
production's rather than a reimplementation.

### Sample points — reused, not invented

Twelve points, provenance recorded per point in instrument 1. **Six metro**
points come from `data/scripts/atlas-oddities-prod-verify.ts` (OR/WA/AZ/UT/NV)
and `data/scripts/family-destinations-verify.ts` (CA). **Six rural** points: four
from `web/src/lib/trip-browse/places.ts` browse fixtures (CA/OR/UT/WA).

AZ and NV had no rural fixture, so both were drawn from the TEST corpus:

- **AZ — Fool Hollow Lake Rec Area `[-110.0613, 34.2731]`**: highest-prominence
  in-scope campground that classifies **unambiguously** as AZ and sits >1° from
  the Phoenix probe.
- **NV — Cave Lake State Park `[-114.6986, 39.1795]`**: ⚠️ **NV could not be
  selected by geometry at all.** The repo's own `STATE_BOXES` classifier returns
  `ambiguous` for essentially every NV point, because the NV box is almost
  entirely contained in the CA box — the known state-boundary limitation
  (`docs/measurements/2026-08-21-state-boundary-bug-blast-radius.md`). A naive
  bbox pick returned Sierra National Forest, **California**. NV was therefore
  selected by **source provenance** instead: a master_place carrying an active
  `nevada_state_parks` source_record is in Nevada by construction.

### Apparatus check — run before trusting any number

The first Mapbox aggregate looked implausibly uniform (many categories
saturating everywhere), which is the signature of an endpoint that ignores its
category filter. **Negative control:** a nonsense category id
(`zzz_not_a_real_category`) at the AZ rural bbox returned **0** features, while
`campground` at the same bbox returned **13** and `art_gallery` returned **1**.
The endpoint filters correctly; the metro saturation is real. Recorded because
the check could have gone the other way and would have invalidated the run.

### Three limits that govern how the numbers may be read

1. **`limit=25` is Mapbox's ceiling** (and the app's `MAX_RESULTS`). A cell
   showing 25 means **"at least 25"**, never exactly 25. Saturated cells are
   counted separately and written `25+` in the matrix.
2. **One fixed 10 km probe radius for every category**, so densities are
   comparable across categories. Production uses **per-category** radii of
   5–50 km. For wide-radius categories — camping is 50 km — these counts are a
   **floor**, not the production figure.
3. **The rural tier is heterogeneous.** Only **WA-R** (Ohanapecosh, Mt Rainier)
   and **NV-R** (Cave Lake) are genuinely remote. AZ-R sits beside Show Low,
   OR-R beside Bend, CA-R beside I-10, UT-R beside Hurricane/St George. So
   "4/6 rural" below almost always means *"every rural point except the two
   wilderness ones."* That pattern is itself the finding — see §Summary.

**2 of 312 Mapbox requests failed**, both HTTP 429 after one retry
(`motel` @ NV-R, `lodging` @ OR-M). Counted, not silently dropped.

---

## Table — #364's rows, extended with sampled coverage

`metro` / `rural` = points returning ≥1 result, out of 6 each. `feat` = total
features (saturated cells contribute 25, so these are floors). Corpus columns
are carried forward from #364 (TEST in-scope).

| #364 row | Corpus in-scope | Mapbox ids | Mapbox metro | Mapbox rural | metro feat | rural feat | Foursquare (text probe) | Verdict change vs #364 |
|---|--:|---|---|---|--:|--:|---|---|
| **Campgrounds** | 6,114 | `campground` | **6/6** | **5/6** | 67 | 36 | not probed | unchanged — viable, modest density |
| **Trailheads** | 4,759 | `trailhead` | **2/6** | **2/6** | **3** | **2** | **10/12 pts, 32 name-matches, most real** | ⚠️ **REVERSED** — Mapbox effectively empty; FSQ better |
| **Viewpoints** | 340 | `viewpoint` | 4/6 | **0/6** | **8** | **0** | **6/12 + 9/12 pts, many real** | ⚠️ **REVERSED** — Mapbox effectively empty; FSQ better |
| **Gas / fuel** | 2,887 (≈all EV) | `gas_station` | 6/6 | 4/6 | 150 (sat×6) | 61 | not probed | unchanged — viable |
| " | " | `charging_station` | 6/6 | 4/6 | 150 (sat×6) | 45 | not probed | **EV live source confirmed viable, still unwired** |
| **Auto / Repair** | **0** | `auto_repair` | **6/6** | **4/6** | 150 (sat×6) | **100 (sat×4)** | not probed | **CONFIRMED** — densest unwired gap |
| " | " | `repair_shop` | 6/6 | 4/6 | 150 (sat×6) | 61 | not probed | confirmed |
| " | " | `car_wash` | 6/6 | 4/6 | 150 (sat×6) | 47 | not probed | confirmed |
| **Coffee** | 2 | `cafe` | 6/6 | 4/6 | 150 (sat×6) | 46 | not probed | unchanged — live-dependent, live is strong |
| " | " | `coffee_shop` | 6/6 | 4/6 | 150 (sat×6) | 43 | not probed | " |
| **Restaurants** | 564 | `restaurant` | 6/6 | **5/6** | 150 (sat×6) | 101 (sat×4) | not probed | unchanged — viable |
| **Groceries** | 546 | `grocery` | 6/6 | 4/6 | 150 (sat×6) | 38 | not probed | confirmed available, unwired |
| " | " | `supermarket` | 6/6 | 4/6 | 150 (sat×6) | 22 | not probed | " |
| **Hotels / overnight** | 4 | `hotel` | 6/6 | 4/6 | 150 (sat×6) | 67 | not probed | unchanged — live-dependent, live is strong |
| " | " | `motel` | 6/6 | 4/6 | 95 | 18 | not probed | 1 cell failed (429) |
| " | " | `lodging` | 5/6 | 5/6 | 125 | 85 | not probed | 1 cell failed (429) |
| **attraction** | 106 | `museum` | 6/6 | 4/6 | 146 | **12** | not probed | viable in metro, thin rural |
| " | " | `art_gallery` | 6/6 | 3/6 | 150 (sat×6) | 20 | not probed | " |
| " | " | `historic_site` | 6/6 | **6/6** | 150 (sat×6) | 26 | not probed | " |
| " | " | `monument` | 6/6 | **6/6** | 150 (sat×6) | 26 | not probed | " |
| **oddity** | 2,745 | `tourist_attraction` | 6/6 | **6/6** | 150 (sat×6) | 71 | not probed | viable everywhere sampled |
| **interest** | 2,537 | `rest_area` | 5/6 | **1/6** | **29** | **1** | not probed | thin — a partial answer at best |
| " | " | `laundry` | 6/6 | 4/6 | 150 (sat×6) | 19 | not probed | viable |
| **urban** | **0** | `park` | 6/6 | **6/6** | 150 (sat×6) | 85 | not probed | live source exists and is dense — but see note |
| " | " | `theme_park` | 6/6 | 3/6 | 115 | 9 | not probed | " |
| " | " | `dog_park` | 6/6 | 2/6 | 66 | 6 | not probed | " |
| **Dispersed camping** | 2,533 | **no id** *(carried from #364)* | — | — | — | — | **1 real hit in 24 point-queries** | no viable live source |
| **Water fill** | 169 (suppressed) | **no id** *(carried from #364)* | — | — | — | — | **0 relevant in 24 point-queries** | **no viable live source anywhere checked** |
| **Showers** | 4 (suppressed) | **no id** *(carried from #364)* | — | — | — | — | **3 heuristic hits, ~1 genuinely a public shower** | **no viable live source anywhere checked** |
| **Dump stations** | 6 (suppressed) | **no id** *(carried from #364)* | — | — | — | — | **1 real hit in 24 point-queries** | **no viable live source anywhere checked** |

**Note on `urban`:** Mapbox `park` is dense, but the wired `urban` primaries are
`shopping_mall` / `city_park`. Mapbox's `park` is a different concept and maps
more naturally to `scenic`. Flagged as an ambiguity for the decision; **not
resolved here.**

---

## Foursquare — the taxonomy is still unreachable, and here is exactly what was tried

#364 recorded this as "unmeasured." Re-attempted properly rather than stopping
at the same wall:

**24 combinations, all HTTP 404** — 4 paths × 3 API versions × 2 auth styles:

| Paths tried | Versions tried | Auth styles |
|---|---|---|
| `places-api.foursquare.com/places/categories` | `2025-06-17` (the pinned version) | `Authorization: Bearer <key>` |
| `places-api.foursquare.com/categories` | `2025-02-05` | `Authorization: <key>` (legacy v3 style) |
| `places-api.foursquare.com/places/taxonomy` | *(header omitted entirely)* | |
| `api.foursquare.com/v3/places/categories` | | |

Every response: `{"message":"Endpoint '<path>' not found."}`. The **legacy v3
host returns the same error shape as the new host**, which suggests it now
proxies the same backend rather than serving the old API.

**Auth is not the cause.** The same key returns **HTTP 200 with 10 results** on
`/places/search` (control run at the top of instrument 2's output). So: the
endpoint does not exist on this platform, and Foursquare's category vocabulary
**remains unenumerable**.

### So the question was answered a different way

Free-text `query=` **is** supported. Instrument 2 probes the four categories
#364 found have no Mapbox id, at all 12 points:

| Row | Query | Points w/ any result | Points w/ heuristic-relevant result | Total results | Total relevant |
|---|---|---|---|--:|--:|
| Dump stations | `dump station` | 10/12 | **0/12** | 94 | **0** |
| Dump stations | `RV dump` | 9/12 | 1/12 | 89 | **1** |
| Showers | `shower` | 8/12 | **0/12** | 66 | **0** |
| Showers | `public shower` | 9/12 | 3/12 | 76 | **3** |
| Water fill | `potable water` | 10/12 | **0/12** | 83 | **0** |
| Water fill | `water fill` | 10/12 | **0/12** | 83 | **0** |
| Dispersed camping | `dispersed camping` | 7/12 | 1/12 | 10 | **1** |
| Dispersed camping | `primitive camping` | 7/12 | 5/12 | 16 | 7 |
| Trailheads *(comparison)* | `trailhead` | 10/12 | **10/12** | 32 | **32** |
| Viewpoints *(comparison)* | `viewpoint` | 6/12 | 6/12 | 25 | 23 |
| Viewpoints *(comparison)* | `scenic overlook` | 9/12 | 9/12 | 51 | 35 |

**⚠️ Foursquare text search matches NAMES, not categories.** The high
"any result" counts are noise: `dump station` returned *Union Station*, fire
stations, *Crêpe Station*; `shower` returned delicatessens and spas; `potable
water` returned water-damage firms and *Water Grill*.

**The heuristic's own hits need a second filter, applied by hand:** of the 7
`primitive camping` matches, six are *Primitive Science*, *Future Primitive
Brewing*, *Primitive Accents Body Piercing*, *Primitive Smoke BBQ*, *Primitive
Kool Outsider Art Gallery*. **Exactly one is a campsite** — *Primitive Camping
At Sand Hollow*. Similarly the 3 shower hits include *Hoyers Showerama* (a
business name) and *Jon's Shower* (ambiguous); **one**, *Brighton Street Comfort
Station & Showers*, is clearly a public shower. Every accepted name is printed
in the instrument's output so this judgement can be re-made rather than trusted.

**How far this licenses a conclusion.** This is a **text probe, not a category
probe**. A near-zero result is *evidence of absence via the only reachable
interface* — it is **not** proof that Foursquare holds no such category. Stated
that way deliberately.

**The comparison rows are the surprise.** Trailheads returned relevant results
at **10 of 12** points and viewpoints at 6/12 and 9/12 — visibly better than
Mapbox's 2/6 and 0/6 rural. **Foursquare is already a wired source**, mapped to
`scenic` via its Outdoors top-level id. So some of this data may already reach
the `scenic` chip today — while the Trailheads and Viewpoints **tiles** miss it,
because they query `primary_category` values that map to no live slide key.
That is #364's Finding 0 (three vocabularies) showing up as lost data, not just
inconsistency.

---

## Summary — priority order for the decision

### A. Confirmed: no viable live source across everything checked

Neither Mapbox (no canonical id) nor Foursquare (no usable text-search evidence)
can serve these. **Wiring cannot fix them; only a new source or an ingest can.**
All three are additionally dropped at `hydrate.ts:140` and carry NEW badges.

1. **Dump stations** — corpus 6 in-scope; **1** plausible Foursquare hit in 24
   point-queries.
2. **Showers** — corpus 4 in-scope; **~1** genuine public shower across 24
   point-queries.
3. **Water fill** — corpus 169 in-scope (suppressed); **0** relevant hits in 24
   point-queries. The only one of the three with a real corpus behind it, which
   makes *unsuppressing* the more plausible lever than sourcing.
4. **Dispersed camping** — no Mapbox id, **1** real Foursquare hit. But corpus
   is **2,533 in-scope**, so unlike the three above this category is *already
   well served* by the corpus and simply has no live complement.

### B. Confirmed available and dense — genuinely just needs wiring

5. **Auto / Repair** — **0** corpus rows against Mapbox saturating (`25+`) at
   **all six** metro points and at **four of six** rural points, the two
   exceptions being the genuinely remote ones. `auto_repair` returned the
   highest rural total of any id sampled. **The cleanest wiring win available.**
6. **`charging_station` for EV** — corpus holds **2,886** EV rows while the live
   half cannot reach them; Mapbox's `charging_station` is dense wherever
   `gas_station` is. Closes the fuel inversion #364 identified.
7. **Groceries** — 546 corpus rows, Mapbox `grocery`/`supermarket` dense in
   metro, present at 4/6 rural.

### C. Reversed from #364 — the id exists but the data does not

8. **Trailheads** — Mapbox `trailhead`: **2/6 metro, 2/6 rural, 3 and 2 total
   features.** Against a corpus of **4,759**. **Wiring Mapbox here would be
   near-worthless.** Foursquare is the better live candidate and is already
   wired for `scenic`.
9. **Viewpoints** — Mapbox `viewpoint`: **4/6 metro but 0/6 rural, 8 total
   metro features.** Against a corpus of 340. Same conclusion.
10. **`rest_area`** (part of `interest`) — 5/6 metro but **1/6 rural**, 29 and 1
    features. Thin; a partial answer at best.

### D. Live-dependent and safe — live is strong where corpus is not

11. **Hotels/overnight (4 corpus rows)** and **Coffee (2)** — both effectively
    have no corpus and both saturate in metro. They work today because the live
    half carries them; the exposure is a live outage, not a gap.

### The cross-cutting pattern worth carrying into the decision

**Mapbox coverage tracks settlement, not geography.** At the two genuinely
remote points — Ohanapecosh (Mt Rainier) and Cave Lake (eastern Nevada) —
Mapbox returned **0** for campground, gas, auto repair and most other
commercial categories; Ohanapecosh returned 1 restaurant and 0 fuel. Every "4/6
rural" in the table above is really "every rural point except the two
wilderness ones."

For a product whose users are specifically in those two kinds of place, that is
the single most decision-relevant fact this pass produced: **live sources
degrade exactly where overlanding happens, and the corpus is the only thing that
does not.** The categories with deep corpora — campgrounds 6,114, trailheads
4,759, dispersed 2,533, oddity 2,745 — are the ones that will still work off-grid.

**Not sampled, and worth naming:** coverage was measured at 12 points on one
day. It is a sample, not a population measurement, and no claim here describes
Mapbox or Foursquare coverage outside those points.

---

## Reproducing

```
cd web
export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
npx tsx scripts/sample-mapbox-coverage-2026-09-03.ts

export FSQ_API_KEY=$(grep '^FSQ_API_KEY=' .env.local | cut -d= -f2-)
npx tsx scripts/sample-foursquare-coverage-2026-09-03.ts
```

Both are read-only and hit only public vendor APIs. Neither touches a database.
