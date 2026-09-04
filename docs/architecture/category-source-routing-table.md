# Category → source routing table

**Status:** DESIGN ONLY. Not implemented, not wired. Companion to
`docs/decisions/2026-09-03-nine-category-taxonomy-canonical.md` and
`docs/architecture/category-subtype-mapping.md`.

This is the artifact #364 said had to wait: *"Any routing table will have to pick
one vocabulary to be canonical before it can be written."* The ADR picks it. This
is the table.

**Confidence key:** `[literal]` = computed in this pass · `[cited #364]` /
`[cited #366]` = carried by reference from that investigation, not re-derived ·
`[proposed]` = a routing decision made here · `[open]` = undecided.

---

## ⚠ AMENDED 2026-09-03 by the five-source routing investigation

`docs/investigations/2026-09-03-source-to-category-routing.md` re-measured this
table's inputs across all five sources — including **Overpass/OSM** and
**Foursquare's category filter**, neither of which #364 or #366 examined — and
added a genuinely remote sample tier. **Five rows below are contradicted.** They
are left in place with pointers rather than rewritten, so the change is legible:

1. **`urban` is NOT R4 NONE.** Mapbox `shopping_mall` **exists** in the 482-id
   canonical list and returns 6/6 metro, 4/6 rural. Only `city_park` is absent.
   §2/`urban` and §3.3 overstate the finding — see the investigation §5.
2. **Showers / dump stations / water fill are not sourceless.** OSM holds
   **945 / 521 / 10,113** nodes across the six states, and `osm.ts` already maps
   all three tags. §3.3's "no amount of wiring makes these work" is right about
   *wiring* and wrong about *sourcing* — see the investigation §6.
3. **The EV row's "one wired source id" is wrong.** `ev_charging` is absent from
   `LIVE_SLIDE_FOR_PRIMARY` *and* mis-mapped to `gas_station` in
   `MAPBOX_CATEGORY_FOR_PRIMARY`. Two lines, two files — see §4 item 1 below.
4. **Do NOT wire `grocery`+`supermarket` or `historic_site`+`monument` as
   pairs**, and do NOT wire `tourist_attraction` to `oddity` — measured
   taxonomy overlaps, investigation §9.
5. **Foursquare is not blocked.** Its *taxonomy enumeration* 404s (reproduced,
   24/24); its *category filter* returns HTTP 200 and is what production already
   calls. The §2 provenance note conflates the two.

**Also: §3.1 is marked RESOLVED but is NOT implemented** — `resolve-places.ts:241`
still routes museum/art_gallery/historical_landmark to `oddity`.

**Drawn as a diagram:** `overlander_1` → page *"Source→Category Routing — PR #400"*
(https://app.paper.design/file/01KNTTXWMR13F0Y99G08SQM12D/8-0), exported to
`docs/assets/2026-09-03-source-category-routing-diagram.png`. It is a view of the
investigation, not a second source — see that report's *Visual reference* section
for what the board does differently from this table.

**And upstream of most of the corpus depths in this table:** 82.3% of OSM's
source_records are `is_active = false`, which is what holds 5,946 ingested gas
stations and ~6,100 viewpoints out of the export view. Cause undetermined;
investigation §7.

---

## 0. Provenance and what may be read off this table

- **Corpus depths** are `[literal]` — #364's read-only instrument re-run against
  **TEST** at 2026-09-03T19:49Z. Figures are **in-scope** rows
  (`master_place_search_export`). **PROD is not described by any number here.**
- **Live coverage verdicts** are `[cited #366]`. They are **not** re-measured
  here, and #366's own scope limit governs them: *"coverage was measured at 12
  points on one day. It is a sample, not a population measurement."*
- **Mapbox id existence** is `[cited #364]` — and #364's caveat rides with it:
  *"a canonical id existing means the query is expressible, not that Mapbox has
  data at any given location."*
- **Foursquare** is `[cited #366]`: its taxonomy endpoint is unenumerable
  (404 across every combination tried), so all Foursquare evidence is
  **name-text-search, not category-filter**. #366 states the limit exactly —
  a near-zero result is *"evidence of absence via the only reachable interface"*,
  **not proof of absence**.

**Two things this table deliberately does NOT rest on:**

1. **#366's "Mapbox coverage tracks settlement, not geography" hypothesis.** It
   is held on **two** genuinely remote sample points and #366 itself says to
   *"weigh it as a hypothesis to test, not a finding to build on."* If it holds
   it would strengthen every corpus-primary row below — so the routing here is
   **conservative with respect to it**, never dependent on it.
2. **"Foursquare beats Mapbox for trailheads/viewpoints."** #366 explicitly
   walks this back: *"it would be wrong to read them as 'Foursquare beats
   Mapbox'"* — category-filter vs name-search are different instruments. Rows
   below say "candidate worth testing," never "better source."

---

## 1. Routing rules the table applies

`[proposed]` Four rules, applied mechanically so each row is checkable:

| Rule | Condition | Routing |
|---|---|---|
| **R1 CORPUS-PRIMARY** | deep corpus **and** live coverage measured thin | corpus first; live merged only as a supplement |
| **R2 LIVE-PRIMARY** | corpus empty/negligible **and** live coverage measured dense | live first; corpus contributes nothing today |
| **R3 MERGE** | both non-trivial | both, deduped by canonical id — today's `resolvePlaces()` behaviour |
| **R4 NONE** | neither reachable | no route. Cannot be fixed by wiring. |

**R4 is the load-bearing one.** It marks the categories where an implementation
pass would otherwise waste effort wiring a source that does not exist.

---

## 2. The table — 9 parents and their routing-distinct subtypes

Corpus = TEST in-scope, this pass. "Live available" = a source exists at all;
"coverage" = what #366 measured, in its own metro/rural framing.

**Structure after Decision 9 — the row count is unchanged and that is
deliberate.** `[literal]` Removing `urban`, water fill, showers and dump stations
from the UI **deleted no rows from this table.** They are struck through and
marked *no UI surface*, because this table's job is "which source serves category
X" and the answer for those four — **none, measured twice** — is the fact most
worth keeping. A deleted row reads as an unasked question; a struck row reads as
an answered one.

**It still reads at 9 parents.** `urban` keeps its section (empty, no surface);
the other eight are unchanged. **Surfaced chips: 8.**

### camping

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `campground` | 6,114 | Mapbox `campground`, Google, rec-gov, USFS, BLM | 6/6 metro, 5/6 rural | **R3 MERGE** | **Yes** — already does |
| `dispersed_camping` | 2,533 | **none** — no Mapbox id; FSQ 1 real hit in 24 probes | — | **R1 CORPUS-PRIMARY** | **Yes**, corpus-only |
| `rv_park`, `camping_cabin` | **0** | Mapbox `campground` covers loosely | — | R2 by default | Yes; nothing to serve today |

**Note:** `dispersed_camping` is the clearest R1 in the app — deep corpus,
no live source at all. #366: *"already well served by the corpus and simply has
no live complement."*

### scenic

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `trailhead` | 4,759 | Mapbox `trailhead`; FSQ (name-search only) | Mapbox **2/6 metro, 2/6 rural** — near-empty | **R1 CORPUS-PRIMARY** | **Yes**, corpus-first |
| `viewpoint` + `peak`/`mountain_peak`/`scenic_spot` | 340 (`viewpoint`) | Mapbox `viewpoint` | Mapbox **4/6 metro, 0/6 rural** | **R1 CORPUS-PRIMARY** | Yes, corpus-first |
| `park_feature` | 3,691 | none | — | **R1** | Yes, corpus-only |
| `park` | 2,518 | Mapbox `park` (dense) | 6/6 metro, 6/6 rural | **R3 MERGE** | **Yes — RESOLVED to `scenic`, §3.2** |
| `recreation_area` | 1,572 | none | — | **R1** | Yes, corpus-only |
| `lake`, `hiking_area`, `river`, and the rest | 0 | none | — | R4 in practice | no-op |

**⚠️ Trailheads and Viewpoints are the two rows #366 REVERSED from #364.** #364
listed them as "available, unwired," implying wiring would help. #366 measured
that *"wiring Mapbox here would be near-worthless."* **Both route corpus-primary.**
Foursquare is `[open]` as a *candidate to test*, not a source to wire.

### fuel

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `ev_charging` | 2,886 | Mapbox `charging_station` — **available, unwired** | 6/6 metro, 4/6 rural | **R3 MERGE** | **Yes — highest-value change in this table** |
| `gas_station` | ~0 corpus; live-carried | Mapbox `gas_station` (the only wired Mapbox category) | 6/6 metro, 4/6 rural | **R2 LIVE-PRIMARY** | Yes — already does |
| `truck_stop` | 0 | Mapbox `gas_station` loosely | — | R2 | Yes |
| **Services** → Auto/Repair (`car_repair`, `car_wash`) | 0 | Mapbox `auto_repair` + `car_wash` — **WIRED 2026-09-03**. `repair_shop` deliberately excluded (live-probed as appliance/electronics repair, not auto) | **live-verified this session: results in CA/OR/UT/WA metros; 0 in rural NV** | **R2 LIVE-PRIMARY** | **Yes — wired via the Mapbox source** |
| **Services** → Rest areas (`rest_area`) | in `interest` today | Mapbox `rest_area` | 5/6 metro, **1/6 rural** — thin | R1/R3 | partial at best |
| ~~Services → Water fill (`water`)~~ | 169 — suppressed | none anywhere checked | — | **R4 NONE** | **No UI surface — Decision 9** |
| ~~Services → Showers (`shower`)~~ | 4 — suppressed | none anywhere checked | — | **R4 NONE** | **No UI surface — Decision 9** |
| ~~Services → Dump stations (`dump_station`)~~ | 6 — suppressed | none anywhere checked | — | **R4 NONE** | **No UI surface — Decision 9** |
| ~~Services → Toilets (`toilet`)~~ | 128 — suppressed, unclaimed | none | — | **R4 NONE** | no surface; proposal stood down |

**AMENDED 2026-09-03 — `fuel` absorbs the Services cluster** (mapping doc §4.1,
§4.3, §4.7), **then Decision 9 removed four of its six members from the UI.**

**Rows are struck through, not deleted.** Deleting them is exactly how a
"removed until a real source exists" decision gets rediscovered as a gap and
re-litigated. They stay as R4 NONE with **no UI surface**, so the next reader
sees the measurement and the decision together.

**Routing consequence, now simpler than it was:** `fuel` ships as
`gas_station` + `ev_charging` + `truck_stop` + Services(Auto/Repair, Rest areas).
The earlier warning that one parent chip would span "dense live data" and
"nothing exists" **no longer applies** — the "nothing exists" rows are not
surfaced. **No per-subtype empty-state work is required.**

**The fuel inversion, restated.** `[cited #364]` The corpus is ~all EV while the
live half is ~all gas — #364 called it *"the worst in the audit."* `[cited #366]`
Wiring `charging_station` *"closes the fuel inversion."* This is one wired source
id, and it makes ~2.9k existing corpus rows reachable live. **Highest
value-per-unit-effort row in the table.**

### food

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `restaurant` + cuisines | 556 (`restaurant`) | Mapbox `restaurant` + cuisines, Google, FSQ | 6/6 metro, 5/6 rural | **R3 MERGE** | Yes — already does |
| `cafe` / coffee | 1–2 | Mapbox `cafe`, `coffee_shop` | 6/6 metro, 4/6 rural | **R2 LIVE-PRIMARY** | Yes — already does |
| `grocery`, `grocery_store` | 546 (`grocery`) | Mapbox `grocery`, `supermarket` — **available, unwired** | 6/6 metro, 4/6 rural | **R3 MERGE** | **Not today** — wiring gap |
| 15 empty cuisine primaries | 0 | via `restaurant` | — | R2 | no-op |

### hotel / `overnight`

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `hotel`, `motel`, `resort_hotel` | ~4 total | Mapbox `hotel`/`motel`/`lodging`, Google, FSQ | dense metro | **R2 LIVE-PRIMARY** | Yes — already does |

`[cited #366]` *"They work today because the live half carries them; the exposure
is a live outage, not a gap."* **This is the one category where a live-source
failure is a total outage**, and it should be treated as an availability risk,
not a coverage gap.

### attraction

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `visitor_center` (outside Culture) | 102 `[cited #364]` | Google, FSQ | — | **R3 MERGE** | Yes |
| **Culture** → Museums (`museum`) | 0 | Mapbox `museum`, Google, FSQ | 6/6 metro, 4/6 rural | **R2 LIVE-PRIMARY** | Yes, once §3.1 lands |
| **Culture** → Galleries (`art_gallery`) | 0 | Mapbox `art_gallery`, Google, FSQ | 6/6 metro, 3/6 rural | **R2 LIVE-PRIMARY** | Yes, once §3.1 lands |
| **Culture** → Historic Sites (`historic`, `landmark`, `historical_landmark`, `historical_place`, `monument`, `national_historic_site`) | 24 · 3 · 1 · 1 · 1 · 0 | Mapbox `historic_site`, `monument`; Google `historical_landmark`; FSQ | **6/6 metro, 6/6 rural** — the strongest coverage sampled | **R3 MERGE** | Yes, once claimed |

**§3.1 RESOLVED 2026-09-03 — this category is now routable.** Culture sits under
`attraction`; `LIVE_SLIDE_FOR_PRIMARY` moves `museum`/`art_gallery`/
`historical_landmark` from `oddity` to `attraction`. Mapping doc §4.4, §4.7.

**Culture is THREE chips — Theaters was dropped 2026-09-03** once Adam clarified
it means novelty/roadside theaters, which `foursquare.ts:84-89` already routes to
`oddity` and which are the opposite of `attraction`'s "formal cultural set only"
definition. Mapping doc §4.7.

**Two of the three are empty in corpus — but both are `R2 LIVE-PRIMARY`, i.e.
unwired rather than dead.** Museums and Galleries fill as soon as the §3.1 live
route lands. **Historic Sites is the only chip that returns anything today**, and
it also has the best-measured live coverage in the whole table (6/6 metro, 6/6
rural) — so it ships first, and the other two follow the §3.1 fix rather than any
ingest work.

### oddity

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `oddity` (Atlas Obscura) | 2,745 | Google emits nothing by design; FSQ Arts, BLM | — | **R1 CORPUS-PRIMARY** | Yes |
| `tourist_attraction`, `roadside_attraction` | 0 | Mapbox `tourist_attraction` | **6/6 metro, 6/6 rural** | R2 | Available, unwired |

**⚠️ `oddity` loses live results when §3.1 lands, and that is intended.** `[literal]`
It currently receives museum/gallery/landmark results misfiled by
`LIVE_SLIDE_FOR_PRIMARY`. After the move, `oddity`'s bbox live half returns
**nothing** — Google emits nothing for it by design and the Mapbox source is
fuel-only. Correct for an R1 corpus-primary category on 2,745 rows, but it should
be expected rather than discovered. Wiring Mapbox `tourist_attraction` is the
obvious follow-up if a live complement is wanted.

`tourist_attraction` is one of only **two** ids #366 measured at full 6/6 metro
**and** 6/6 rural. It is unwired and its corpus is empty — a quiet gap.

### interest

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `facility` | 2,245 | none | — | **R1 CORPUS-PRIMARY** | Yes, corpus-only |
| ~20 further residuals (`unknown`, `point_of_interest`, `atm`, `bus_stop`, `park_boundary`, …) | mostly 0 | none | — | R4 | no-op |

**AMENDED 2026-09-03 — most of what this section used to route has moved out**
(mapping doc §4.6): `car_repair`/`car_wash` and `rest_area` → `fuel`/Services ·
`water`/`shower`/`dump_station` → `fuel`/Services · `amphitheatre` →
`attraction`/Culture · `marina` → `scenic`.

**What is left routes as one rule, which is why it needs no table.** Everything
remaining is **R1 corpus-primary or R4**, because no live source maps to any of
it. `facility` (2,245) is the only meaningful mass, and `[cited #364]` it is *"a
generic RIDB container that spans campgrounds, day-use sites and offices"* — so
its rows cannot be routed more precisely than "corpus, unsplit." **`interest`
renders no subtype chips**, so there is nothing finer to route.

`[open]` Mapbox `laundry` measured 6/6 metro, 4/6 rural `[cited #366]` but
corresponds to no `primary_category` today. It is a plausible Services member if
a laundry primary is ever ingested.

### urban

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `shopping_mall` | **0** | ⚠ **CORRECTED 2026-09-03 — Mapbox `shopping_mall` EXISTS** (in the 482-id canonical list) and returns **6/6 metro, 4/6 rural, 0/6 remote**; FSQ has a Shopping Mall category too | see left | **R2 LIVE-PRIMARY, unwired** | **No — unwired, not unsourceable** |
| `city_park` | **0** | **none** — absent from Mapbox's canonical list | — | **R4 NONE** | **No** |

**`urban` is structurally empty, not merely sparse** `[literal]` — both of its
claimed primaries have zero corpus rows. `[cited #366]` Mapbox `park` is dense
(6/6, 6/6) but *"is a different concept and maps more naturally to `scenic`."*
**RESOLVED 2026-09-03: `park` routes to `scenic`** (§3.2), leaving `urban` with
~~no live source and no corpus — **nothing routes to it at all.**~~

⚠ **CORRECTED 2026-09-03 — the "no live source" half is FALSE.** `[literal, the
five-source investigation]` Mapbox's canonical list was enumerated in full (482
ids) rather than spot-checked, and **`shopping_mall` is in it**, returning
**6/6 metro, 4/6 rural** across all six states (150 + 22 features); Foursquare
carries a Shopping Mall category as well (6/6 metro, 204 features). **Only
`city_park` is genuinely absent.** So `urban` is **unwired, not unsourceable**.

The **corpus** half of the finding stands unchanged: 0 rows, both primaries.

**This does not reopen Decision 9.** Whether an `urban` chip returns is Adam's
call, and one live-sourceable primary that is `0/6` at remote points is a weak
argument for a chip in an overlanding product. The correction is recorded
because the decision cited "no live source" as a premise, and that premise was
measured wrong.

**FINAL, Decision 9: `urban` is REMOVED from the UI.** No chip in the browse
filter row, no Find Nearby presence. **It remains one of the canonical nine in
the data model** — `SlideCategoryKey`, `BROWSE_CARD_CATEGORIES`, DESIGN.md §1.2
tokens and its section label are all untouched. **This section is retained on
purpose:** a category with no route and no surface is precisely the thing a
future reader would otherwise rediscover as an oversight.

`[literal]` **Removing the chip changes no fanout:** `categories=all` already
expands to seven buckets and already excludes `urban` — verified by executing
`resolveRequestedCategories` earlier in this chain.

---

## 3. Blocking items — routing cannot be implemented until these are decided

### 3.1 ~~`attraction` vs `oddity`~~ — **RESOLVED 2026-09-03**

**Resolved to `attraction`**, per Adam's Culture decision. `[literal]` The
evidence is stronger than #380 reported: re-checking found a **third** encoding,
Foursquare's classifier (`foursquare.ts:76-82`), which already files
museum/gallery/historic under `attraction` with the comment *"Formal cultural →
attraction (mirrors the federated corpus split)."* With Google's fanout that
makes **three encodings against one** — `LIVE_SLIDE_FOR_PRIMARY` is the sole
outlier, which is strong inference that it is a slip rather than a decision.

Fix: move those three primaries from `oddity` to `attraction` in
`LIVE_SLIDE_FOR_PRIMARY` (`resolve-places.ts:236`). One constant, three lines;
no other file changes. Consequence for `oddity` is stated in §2.

~~One new blocking item takes its place — see §3.4 (Theaters).~~ **§3.4 is now closed too — see below. §3.1's fix has no remaining blocker.**

### 3.2 ~~Does Mapbox `park` route to `urban` or `scenic`?~~ — **RESOLVED: `scenic`**

**Adam's decision, 2026-09-03.** It matches what the corpus already does
`[literal]`: `scenic` claims the `park` primary and holds 2,518 in-scope rows for
it, while `urban` claims `city_park`, which has none. So live Mapbox `park`
results now join the same bucket as the corpus rows of the same name — no new
divergence between the corpus and live paths, which is the failure mode §3.1
existed to fix.

**Fully resolved, including the consequence:** `urban` is left with **no live
source and no corpus — nothing routes to it at all.** That collapsed the ADR's
open decision on `urban` to a single clean question — *keep an empty chip, or
remove it* — with no remaining sourcing option behind it. **That question has
since been answered: removed (ADR Decision 9, §3.3 below).**

### 3.3 The R4 NONE set — `water`, `shower`, `dump_station`, and `urban`

`[cited #364, #366]` No live source exists in anything checked: no Mapbox
canonical id, and Foursquare's text probe returned essentially nothing relevant.
All three amenities are *additionally* dropped at `hydrate.ts:140`, so they are
empty twice over.

**Routing consequence, and it is the whole point of marking them R4:** *no amount
of wiring makes these work.* The available levers are **unsuppression** (only
`water` has a real corpus behind it — 169 in-scope) or **new ingest**.

**RESOLVED 2026-09-03 — Decision 9: all four are REMOVED from the UI.** Not kept
as empty-state subtypes. **This is a "removed until a real data source exists"
decision, not an oversight**, and it is written here as well as in the ADR so
that anyone arriving at this table first sees it.

**Nothing about the corpus changes.** `water`'s 169 in-scope rows still exist and
are still suppressed at `hydrate.ts:140`; removal is a surface decision only. If
a source appears, or unsuppression is decided independently, these rows are
available and these rows are where to start.

---

### 3.4 ~~Theaters conflicts with a Foursquare rule~~ — **CLOSED 2026-09-03: no conflict, no change**

**Adam clarified that "Theaters" means novelty / roadside theaters** — precisely
what `foursquare.ts:84-89` already classifies as `oddity` (*"Roadside-quirky
entertainment stays oddity"*). **That rule is correct and stays untouched.**

The conflict this section described was real but it was a **scoping error in the
design, not a defect in the code**: Theaters had been placed in Culture, which is
scoped to `attraction`'s *"formal cultural set only"*, while the code had already
classified novelty theaters as the opposite. **Culture drops to three chips**
(Museums, Galleries, Historic Sites) and the disagreement disappears.

Everything this section previously listed as required work is **withdrawn**:

- ~~add a `theater` `primary_category`~~ — no chip needs it.
- ~~move `theater|theatre` out of the oddity regex~~ — it is already right.
- ~~probe Mapbox for a theater id~~ — nothing depends on the answer.

`[open, separate question]` **A novelty-theater chip under `oddity`** is not
proposed here and was deliberately not added unprompted. If it is ever wanted:
`[literal]` the Foursquare rule classifies **live FSQ results by name only** and
does nothing for corpus rows, so a corpus-backed chip would still need a
`theater` primary and an ingest mapping. The existing rule is not a substitute
for one.


## 4. Implementation order this table implies `[proposed]`

Ordered by measured value per unit of work. **Nothing here is authorised** — it
is what the table says, for the follow-up pass to argue with.

1. **Wire Mapbox `charging_station` → `fuel`.** ~~One id~~ — **CORRECTED
   2026-09-03: TWO lines in TWO files, and doing only the obvious one is worse
   than doing nothing.** `ev_charging` is absent from `LIVE_SLIDE_FOR_PRIMARY`
   (so the request never reaches a source) *and* `MAPBOX_CATEGORY_FOR_PRIMARY`
   maps `ev_charging → gas_station` (so closing only the first gap returns **gas
   stations** under the EV tile — #394's exact failure mode). Add
   `ev_charging: "fuel"` **and** repoint to `charging_station`. Still the
   highest-value change here; makes ~2.9k existing corpus EV rows live-reachable
   and closes #364's worst-rated inconsistency.
2. ~~**Wire Mapbox `auto_repair`/`repair_shop`/`car_wash`.**~~ **DONE 2026-09-03.**
   Wired `auto_repair` + `car_wash` only — `repair_shop` was live-probed and
   returns appliance/electronics/furniture repair (`poi_category: "repair shop"`),
   not auto, so it was excluded. The parent question resolved to `fuel` (Decision 8):
   `car_repair`/`car_wash` → `fuel` in `LIVE_SLIDE_FOR_PRIMARY`, and the Mapbox
   source reads the raw primaries to split Auto/Repair from Gas within that bucket
   (both collapse to the `fuel` slide key). Live-verified in CA/OR/UT/WA metros.
3. **Wire Mapbox `grocery`/`supermarket`.** Available, unwired, real corpus.
4. ~~Resolve §3.1~~ **DONE.** Its implementation is now a 3-line change to
   `LIVE_SLIDE_FOR_PRIMARY`, and it should ship **with** the Culture cluster, not
   before it — on its own it silently empties `oddity`'s live half.
4b. **Claim `historic`, `historical_place`, `monument` under `attraction`.** They
   are unclaimed today `[literal]` and carry Culture's only real corpus. Historic
   Sites also has the best-measured live coverage in the table (6/6 metro, 6/6
   rural) — **this, not Museums, is the chip that makes Culture look alive.**
   Museums and Galleries need no separate step: they fill from item 4's live-route
   fix.
5. **Do NOT wire Mapbox `trailhead`/`viewpoint`.** #366 measured them as
   near-empty. Route corpus-primary instead; test Foursquare's *category* API if
   the taxonomy ever becomes enumerable.
6. ~~Decide the R4 set~~ **DONE — Decision 9: removed from the UI.** The
   implementation consequence is a *deletion*, not a wiring step: drop the Water
   fill / Showers / Dump stations tiles and the `urban` chip. **Not started —
   that is component work for the follow-up pass.**
7. ~~Theaters last.~~ **WITHDRAWN — Theaters is not part of Culture (§3.4).** No
   ingest mapping, no `foursquare.ts` change and no Mapbox probe are required.
   **This removes the only item in the list that was blocked on work outside the
   routing layer.**

**A caution on ordering by these numbers.** Items 1–3 rest on #366's 12-point,
one-day sample. That is enough to justify trying them in the stated order — it is
not enough to promise a coverage outcome. Any of the three should be verified at
implementation time against a wider set of points, especially remote ones, where
#366 sampled only two.
