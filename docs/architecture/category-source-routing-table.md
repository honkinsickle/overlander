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
| `park` | 2,518 | Mapbox `park` (dense) | 6/6 metro, 6/6 rural | **R3 MERGE** | `[open]` — see §3.2 |
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
| `visitor_center` + `landmark` | ~106 bucket `[cited #364]` | Google, FSQ | — | **R3 MERGE** | Yes |
| `museum`, `art_gallery` | 0 | Mapbox `museum`, `art_gallery` | 6/6 metro; 4/6 and 3/6 rural | R2 | ⚠️ **BLOCKED — see §3.1** |
| `historic`, `monument`, `historical_place` | 24 / 1 / 1 | Mapbox `historic_site`, `monument` | **6/6 metro, 6/6 rural** | R3 | Not claimed today (§5.1 of the mapping doc) |

**⚠️ This category cannot be routed until §3.1 is resolved.**

### oddity

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `oddity` (Atlas Obscura) | 2,745 | Google emits nothing by design; FSQ Arts, BLM | — | **R1 CORPUS-PRIMARY** | Yes |
| `tourist_attraction`, `roadside_attraction` | 0 | Mapbox `tourist_attraction` | **6/6 metro, 6/6 rural** | R2 | Available, unwired |

`tourist_attraction` is one of only **two** ids #366 measured at full 6/6 metro
**and** 6/6 rural. It is unwired and its corpus is empty — a quiet gap.

### interest

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `car_repair`, `car_wash` | **0** | Mapbox `auto_repair`, `repair_shop`, `car_wash` | **6/6 metro, 4/6 rural; highest rural total of any id sampled** | **R2 LIVE-PRIMARY** | **Not today** — the cleanest wiring win `[cited #366]` |
| `facility` | 2,245 | none | — | **R1** | Yes, corpus-only |
| `rest_area` | ~in `interest` bucket | Mapbox `rest_area` | 5/6 metro, **1/6 rural** — thin | **R1/R3** | partial at best |
| `laundry` (unclaimed by any primary) | n/a | Mapbox `laundry` | 6/6 metro, 4/6 rural | `[open]` | not a primary today |
| `water`, `shower`, `dump_station` | 169 / 4 / 6 — **all suppressed** | **none anywhere checked** | — | **R4 NONE** | **No** — see §3.3 |
| ~20 further residuals | mostly 0 | none | — | R4 | no-op |

### urban

| Subtype | Corpus `[literal]` | Live available | Coverage `[cited #366]` | Rule | resolvePlaces serves? |
|---|--:|---|---|---|---|
| `shopping_mall`, `city_park` | **0 and 0** | Mapbox has neither as wired | — | **R4 NONE** | **No** |

**`urban` is structurally empty, not merely sparse** `[literal]` — both of its
claimed primaries have zero corpus rows. `[cited #366]` Mapbox `park` is dense
(6/6, 6/6) but *"is a different concept and maps more naturally to `scenic`.
Flagged as an ambiguity for the decision; not resolved here."* **This design does
not resolve it either** — see §3.2.

---

## 3. Blocking items — routing cannot be implemented until these are decided

### 3.1 `attraction` vs `oddity` for museums and galleries `[literal, unresolved]`

The corpus path files `museum`/`art_gallery`/`historical_landmark` under
**`attraction`**; the live bbox path files them under **`oddity`**; Google is
asked for them when a caller requests **`attraction`**. Detail and file
references in the mapping doc §4.4.

**A routing table cannot have two answers for one primary.** Until this is
decided, the `attraction` row above is unimplementable. It has had no visible
effect only because those primaries have zero corpus rows.

### 3.2 Does Mapbox `park` route to `urban` or `scenic`? `[open]`

Inherited from #366 unresolved. `scenic` already claims the `park` primary and
holds 2,518 in-scope rows for it `[literal]`; `urban` claims `city_park`, which
has none. Routing `park` to `scenic` is the smaller change and matches the
existing corpus assignment — but it leaves `urban` with **no** live source and
**no** corpus, which is precisely the ADR's open product decision.

### 3.3 The R4 NONE set — `water`, `shower`, `dump_station`, and `urban`

`[cited #364, #366]` No live source exists in anything checked: no Mapbox
canonical id, and Foursquare's text probe returned essentially nothing relevant.
All three amenities are *additionally* dropped at `hydrate.ts:140`, so they are
empty twice over.

**Routing consequence, and it is the whole point of marking them R4:** *no amount
of wiring makes these work.* The available levers are **unsuppression** (only
`water` has a real corpus behind it — 169 in-scope) or **new ingest**. **Their UI
fate is Adam's decision, recorded as open in the ADR — this table only records
that there is nothing to route.**

---

## 4. Implementation order this table implies `[proposed]`

Ordered by measured value per unit of work. **Nothing here is authorised** — it
is what the table says, for the follow-up pass to argue with.

1. **Wire Mapbox `charging_station` → `fuel`.** One id; makes ~2.9k existing
   corpus EV rows live-reachable and closes #364's worst-rated inconsistency.
2. **Wire Mapbox `auto_repair`/`repair_shop`/`car_wash`.** #366's *"cleanest
   wiring win"*; zero corpus against the densest rural coverage sampled. Blocked
   on the §4.1 parent question in the mapping doc (`interest` vs `fuel`).
3. **Wire Mapbox `grocery`/`supermarket`.** Available, unwired, real corpus.
4. **Resolve §3.1** — no code, one decision, unblocks `attraction`.
5. **Do NOT wire Mapbox `trailhead`/`viewpoint`.** #366 measured them as
   near-empty. Route corpus-primary instead; test Foursquare's *category* API if
   the taxonomy ever becomes enumerable.
6. **Decide the R4 set** (ADR open decision) before any UI work assumes it.

**A caution on ordering by these numbers.** Items 1–3 rest on #366's 12-point,
one-day sample. That is enough to justify trying them in the stated order — it is
not enough to promise a coverage outcome. Any of the three should be verified at
implementation time against a wider set of points, especially remote ones, where
#366 sampled only two.
