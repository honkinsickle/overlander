# Investigation — full category × source audit

**Date:** 2026-09-02 (corpus run stamped 2026-09-03T00:07Z UTC)
**Branch:** `category-source-audit`, cut from `main` at `9d936af`
**Mode:** READ-ONLY. No writes to TEST or PROD, no ingest, no Typesense, no
browser automation.

**Purpose:** input to a follow-up architecture decision. This pass **measures**;
it deliberately proposes no routing table.

---

## Scope, method, and what "measured" means here

Same enumerate-before-measure shape as the 2026-08-20 corpus gap scan: enumerate
the vocabularies from source first, then measure the corpus against them, then
report the mismatch rather than reconciling it.

**Every number below was computed in this investigation.** Nothing is carried
over from a prior session's report. Three instruments, all new:

| # | Instrument | What it produced |
|---|---|---|
| 1 | `data/scripts/measure-category-source-audit-2026-09-02.ts` | per-`primary_category` corpus counts + STRONG/WEAK/NONE, TEST |
| 2 | `web/scripts/rollup-category-audit-2026-09-02.ts` | rollups to the 9 slide buckets and 13 tiles; vocabulary-coverage diffs |
| 3 | live `GET https://api.mapbox.com/search/searchbox/v1/list/category` | Mapbox's canonical category list (**482** entries), for the "does a compliant live source exist at all" question |

⚠️ **Deviation from the brief, flagged not silently taken.** The brief says "no
code changes." Instruments 1 and 2 are new files. They are read-only measurement
scripts under `data/scripts/` and `web/scripts/`, which is this repo's
established pattern for exactly this kind of pass (every file in
`docs/measurements/` has one). They touch no application code and mutate no DB
state. Instrument 1 imports its bucketing **unchanged** from
`data/scripts/lib/eligibility.ts` — the classification was not re-derived.

**Corpus scope: TEST (`znldzjdatkogdktymtvi`) only**, per the brief. **PROD was
not measured and no claim here describes it.** The two databases are known to
differ structurally (PROD has no PAD-US and no `land_status` rows), so the
absolute counts below should not be read across.

**Run totals (instrument 1):** `master_place` **161,431** rows; in-scope
(`master_place_search_export`) **33,216**; active `source_record` scanned
**94,410**, of which **51,062** link to an in-scope MP; in-scope MPs carrying a
template description **10,167**; **70** distinct `primary_category` values.
Overall buckets: **STRONG 32,922 · WEAK 46 · NONE 248**.

**"In-scope" is the export view's definition**, which is stricter than the
convention the 2026-08-20 scan used: `is_searchable` **and** `source_count > 0`
**and** inside `six_state_footprint()` **and** `operational_status` not
CLOSED/DECOMMISSIONED. The footprint clause post-dates that scan (#209).

---

## Finding 0 — the two vocabularies do not match, and that is the headline

The brief asked whether the canonical taxonomy and the surface-specific
subcategories line up 1:1. **They do not, in three separate ways.**

1. **DESIGN.md §1.2 ↔ `BROWSE_CARD_CATEGORIES` ↔ `SlideCategoryKey`: these DO
   match**, 9 for 9, isomorphic except the documented `hotel` (display) ↔
   `overnight` (fetch) rename. No finding here.
2. **The day-browse route accepts only 7 of the 9.** `SLIDE_CATEGORIES`
   (`api/trip-browse/[tripId]/[dayId]/route.ts:16-24`) omits `urban` and
   `interest`. This is the same constant used as the validation allowlist — the
   apparent-400 defect filed from PR #361.
3. **The 13 Find Nearby tiles are a THIRD vocabulary keyed on
   `primary_category`, not on slide keys** — and it is not a subset. Computed by
   instrument 2:
   - **3** primaries are claimed by a tile but by **no** slide bucket:
     `water`, `shower`, `dump_station`. These are exactly the three in
     `SUPPRESSED_PRIMARY_CATEGORIES`.
   - **45** primaries are claimed by a slide bucket but by **no** tile.
   - **40** primaries are claimed by a slide bucket and/or a tile and have
     **zero** corpus rows.
   - **22** `primary_category` values that exist in the corpus are claimed by
     **no** slide bucket at all — including `picnic_area` (**1,223** in-scope),
     `public_land` (**448**), `toilet` (**128**), `hut` (**52**).

So a category's behaviour depends on which of three vocabularies the surface
happens to speak. That is the structural fact underneath most of the drift below.

---

## Table 1 — the 9 canonical categories

Corpus columns are TEST, computed by instruments 1+2. "Live wired" lists only
sources that actually emit for that key today.

| Category | Current live source (wired) | Path | Compliant live source available at all? | Corpus total → in-scope | STRONG / WEAK / NONE | Surfaces | Consistent? | Notes |
|---|---|---|---|---|---|---|---|---|
| `camping` | Google `campground`,`rv_park` · FSQ Outdoors · rec-gov `camp` · USFS `campground\|dispersed` · BLM `campground\|campsite` | B, C | **Yes** — 4 non-Google sources already wired; Mapbox has `campground` | 12,394 → **8,647** | 8,434 / 0 / 213 | S1 S2 S2b S3 S5 | **No** — S5 uses Overpass, not Google | Deepest corpus of any category. `rv_park`, `camping_cabin` have **0** rows |
| `scenic` | Google `tourist_attraction`,`park`,`national_park` · FSQ Outdoors · USFS overlook/vista/viewpoint/byway/trailhead · BLM overlook/interpretive/trailhead/POI | B, C | **Yes** — USFS+BLM+FSQ non-Google; Mapbox has `viewpoint` | 85,356 → **13,113** | 13,065 / 44 / 4 | S1 S2 S2b S3 S5 | **No** — S5 Overpass-led | Largest total, and the largest collapse: see Finding 2. `lake`, `hiking_area` **0** rows |
| `food` | Google `restaurant`,`cafe`,`bar`,`bakery` · FSQ Dining | B, C | **Yes** — FSQ wired; Mapbox has `restaurant`+46 cuisines, `cafe`, `coffee_shop` | 1,273 → **1,112** | 1,096 / 0 / 16 | S1 S2 S2b S3 S5 | **No** — S5 Overpass-led | **15 of 25** claimed primaries have 0 rows |
| `fuel` | **Mapbox `gas_station` ONLY** | B, C | **Yes** — currently the only Mapbox-served category | 9,581 → **2,887** | 2,885 / 0 / 2 | S1 S2 S3 S4(dead) A | **No — worst in the audit** | Corpus is ~all EV, live is ~all gas. See Finding 3 |
| `overnight` / `hotel` | Google `lodging`,`hotel` · FSQ Travel · rec-gov lodge/cabin · USFS cabin/lookout · BLM cabin | B, C | **Yes** — 4 non-Google wired; Mapbox has `hotel`,`motel`,`lodging` | 4 → **4** | 4 / 0 / 0 | S1 S2 S2b S3 S5 | **No** — S5 `resolve-overnights` Overpass-led | **Effectively no corpus.** Entirely live-dependent. `motel` **0** rows |
| `attraction` | Google `museum`,`art_gallery`,`historical_landmark` · FSQ Arts (split) | B, C | **Yes** — FSQ wired | 198 → **106** | 106 / 0 / 0 | S1 S2 S2b S3 | Yes | All 3 Google types have **0** corpus rows — live-only in practice |
| `oddity` | **Google emits nothing** (`TYPES_BY_CATEGORY.oddity = []`) · FSQ Arts · BLM fire lookout/lighthouse | B, C | **Yes** — already non-Google by design | 2,747 → **2,745** | 2,745 / 0 / 0 | S1 S2 S2b S3 S5 | **No** — S5 Overpass-led | Corpus is the Atlas Obscura `oddity` primary. `roadside_attraction`, `tourist_attraction` **0** rows |
| `interest` | **NONE** | — | **Partly** — Mapbox has `rest_area`, `laundry`, `auto_repair`, `car_wash`; no single "interest" concept | 2,692 → **2,537** | 2,537 / 0 / 0 | S1 S2(**400s**) S2b S3(works) | **No — same chip, opposite behaviour** | Residual bucket, 26 primaries, **12** with 0 rows. See Finding 1 |
| `urban` | **NONE** | — | Partly — Mapbox has `park`, `theme_park`, `dog_park`; not `shopping_mall`/`city_park` as wired | **0 → 0** | 0 / 0 / 0 | S1 S2(**400s**) S2b S3(empty) | **No — same as `interest`** | **Both claimed primaries have zero rows. Completely dead bucket.** |

---

## Table 2 — the 13 Find Nearby tiles (Surface 3's own vocabulary)

`live_slide` = what the bbox live half can reach after mapping the tile's
primaries through `LIVE_SLIDE_FOR_PRIMARY`. `NONE` means the live half
short-circuits to `[]` and the tile is corpus-only.

| Tile | Bucket | NEW badge | live_slide | Mapbox category exists? | Corpus total → in-scope | STRONG / WEAK / NONE | Suppressed at hydrate? | Notes |
|---|---|---|---|---|---|---|---|---|
| Dispersed | CAMP & EXPLORE | NEW | **NONE** | **No** — no `dispersed`/`primitive`/`boondock` id | 4,055 → **2,533** | 2,489 / 0 / 44 | No | Corpus-only, but a genuinely deep corpus |
| Campgrounds | CAMP & EXPLORE | NEW | camping | Yes (`campground`) | 8,339 → **6,114** | 5,945 / 0 / 169 | No | Best-covered tile in the app |
| Trailheads | CAMP & EXPLORE | NEW | **NONE** | **Yes** (`trailhead`) — available, **unwired** | 5,317 → **4,759** | 4,757 / 0 / 2 | No | Deep corpus; `hiking_area` **0** rows |
| Viewpoints | CAMP & EXPLORE | NEW | scenic | Yes (`viewpoint`) | 40,231 → **340** | 340 / 0 / 0 | No | **A 40,231 → 340 collapse.** See Finding 2 |
| Gas | FUEL & REPAIR | — | fuel | Yes (`gas_station`, `charging_station`) | 9,581 → **2,887** | 2,885 / 0 / 2 | No | See Finding 3 |
| Auto / Repair | FUEL & REPAIR | NEW | **NONE** | **Yes** (`auto_repair`, `repair_shop`, `car_wash`) — available, **unwired** | **0 → 0** | 0 / 0 / 0 | No | **Zero corpus AND no live wiring.** Cannot return anything today |
| Coffee | FOOD | — | food | Yes (`cafe`, `coffee_shop`) | 2 → **2** | 2 / 0 / 0 | No | Corpus is negligible; live-dependent |
| Restaurants | FOOD | — | food | Yes (`restaurant` + 46 cuisines) | 571 → **564** | 557 / 0 / 7 | No | **14 of 22** claimed primaries have 0 rows |
| Groceries | SUPPLY | — | **NONE** | **Yes** (`grocery`, `supermarket`) — available, **unwired** | 700 → **546** | 537 / 0 / 9 | No | Corpus-only and **not** NEW-badged — the badge tracks nothing |
| Water fill | SUPPLY | NEW | **NONE** | **No** — only `waterfall`, `water_park` (different things) | 963 → **169** | 169 / 0 / 0 | **YES** | Corpus exists but is dropped at render |
| Showers | SERVICE | NEW | **NONE** | **No match in 482 ids** | 25 → **4** | 4 / 0 / 0 | **YES** | Worst case |
| Dump stations | SERVICE | NEW | **NONE** | **No match** (probed `dump`/`sanit`/`sewage`/`rv`/`disposal`) | 99 → **6** | 6 / 0 / 0 | **YES** | Worst case |
| Hotels | STAY | — | overnight | Yes (`hotel`, `motel`, `lodging`) | 4 → **4** | 4 / 0 / 0 | No | `motel` **0** rows |

**Caveat on the Mapbox column, stated plainly:** a canonical id existing means
the **query is expressible**, not that Mapbox has data at any given location.
Coverage was **not measured** — that would need per-bbox sampling, which is out
of scope here. Read this column as "is the door there", not "is anything behind
it."

**A second negative with its scope named:** Foursquare's amenity coverage was
**not measured.** Its taxonomy endpoint returned HTTP 404 on the API version
this app pins (`x-places-api-version: 2025-06-17`) at both
`places-api.foursquare.com/places/{categories,taxonomy}` and the legacy
`api.foursquare.com/v3/places/categories`. So "no compliant live source exists"
for showers/dump stations/water fill is established **against Mapbox's list**,
not against every possible provider.

---

## Finding 1 — the same 9 chips behave differently on Surface 2 and Surface 3

`CategoryFilterRow` renders the identical 9 chips on both surfaces
(`category-browse-panel.tsx` and `find-nearby-panel.tsx:415`). What each sends
diverges completely:

| | Surface 2 (day browse) | Surface 3 (Find Nearby) |
|---|---|---|
| Chip → wire format | **slide key** (`categories=camping`) | **primary_category list** via `SLIDE_TO_PRIMARY_CATEGORY` (`categories=campground,rv_park,…`) |
| Server allowlist | `SLIDE_CATEGORIES`, 7 keys | none |
| `urban` chip | **HTTP 400** (per PR #361) | runs, returns **0** (zero corpus rows) |
| `interest` chip | **HTTP 400** | runs, returns from **2,537** in-scope rows |

**The `interest` chip is the sharpest case: it is a working, corpus-backed
filter over 2,537 rows on one surface and an error on the other.** Same icon,
same row, same user intent.

## Finding 2 — the corpus collapse is `source_count = 0`, not `is_searchable`

The largest categories lose almost everything between `total` and `in-scope`.
I initially read that as a searchability filter. **It is not** — probed directly:

| primary_category | total | `is_searchable` | `source_count > 0` |
|---|--:|--:|--:|
| `peak` | 33,775 | 33,775 | **15** |
| `spring` | 30,990 | 30,990 | **2** |
| `viewpoint` | 6,442 | 6,442 | **339** |
| `gas_station` | 5,947 | 5,947 | **1** |
| `ev_charging` | 3,634 | 3,634 | 2,886 |

**Every one of these rows is still `is_searchable = true`.** What removed them is
`source_count = 0` — every linked `source_record` was deactivated by the 2026-08
category-deactivation passes, leaving hollow `master_place` rows that the export
view (and therefore Typesense, and therefore every corpus-backed surface) drops.

This matters for the decision: these are not rows that need re-classifying, they
are rows whose **content** was retired. Any plan that counts on "we already have
33,775 peaks" is counting hollow rows.

## Finding 3 — fuel is inverted between corpus and live

- **Corpus:** `gas_station` in-scope = **1**. `ev_charging` in-scope = **2,886**.
  The `fuel` bucket's 2,887 in-scope rows are ~entirely EV chargers.
- **Live:** Mapbox serves `gas_station` only. `ev_charging` is **not** in
  `LIVE_SLIDE_FOR_PRIMARY`, so it never reaches the live half.
  Mapbox **does** publish `charging_station` — available, **unwired**.

So the corpus has EV and no gas; the live source has gas and no EV. The Gas tile
requests all three primaries and gets each half from a different world.

**A stale rationale worth correcting in the decision, not here.**
`docs/BACKLOG.md` §"OSM fuel family retired (#214)" justifies letting the corpus
`gas_station` population lapse because "gas_station is covered **live** by Google
Places." Google's `TYPES_BY_CATEGORY.fuel` was emptied on 2026-08-25 and fuel
moved to Mapbox. The conclusion still holds — fuel *is* covered live — but the
stated reason names a source that no longer serves the category.

## Finding 4 — two surfaces nobody has counted

Enumerating callers of the place APIs across `web/src` turned up two paths
outside PR #361's three:

- **`FuelStopCard`** (`components/trip/fuel-stop-card.tsx`) calls
  `/api/trip-browse/…?category=fuel`. **It has no importer anywhere in the
  repo** — scope: repo-root grep over `*.ts`/`*.tsx` excluding `node_modules`,
  which found only its own definition. Dead code, but live-looking dead code
  that would exercise the single-category fixture fast path.
- **`resolveSuggestions` / `resolveOvernights`** (`lib/trips/`), used by
  `lib/trips/alaska.ts` for the reference-trip load. These use a **different
  source list entirely**: `[overpassSource, recGovSource, usfsSource, blmSource,
  foursquareSource]` — **OSM/Overpass instead of Google, and no Mapbox at all.**
  `overpassSource` is wired into these two call sites and nowhere else.
  `resolveSuggestions` covers only 4 categories (`scenic`, `food`, `oddity`,
  `camping`); `resolveOvernights` covers `camping` + `overnight`. **Fuel is
  absent**, so a reference trip gets no fuel suggestions from any source.

This is the drift the brief asked to catch, in its strongest form: `camping`,
`scenic`, `food` and `oddity` are served by **Google-led** fanout on the browse
surfaces and by **Overpass-led** fanout on the reference-trip path.

## Finding 5 — the suppression list, sized

`SUPPRESSED_PRIMARY_CATEGORIES` is dropped at `hydrate.ts:140` in both resolver
flag states. Measured against the corpus:

| primary_category | total | in-scope |
|---|--:|--:|
| `picnic_area` | 4,668 | 1,223 |
| `water` | 963 | 169 |
| `toilet` | 630 | 128 |
| `dump_station` | 99 | 6 |
| `shower` | 25 | 4 |
| `fire_pit` | 3,409 | 0 |
| `picnic_ground` | 0 | 0 |
| **total** | **9,794** | **1,530** |

**1,530 in-scope rows — 4.61% of the 33,216-row in-scope corpus — are indexed
and then discarded at render.** Three Find Nearby tiles point directly at three
of these values.

---

## Categories that don't fit the framework cleanly — flagged, not forced

Per the brief, classified best-effort with the ambiguity named:

- **`oddity` and `interest` are both a slide bucket AND a `primary_category`.**
  Tables 1–2 treat the slide bucket as the unit. The bare `primary_category`
  rows (`oddity` 2,745 in-scope; `interest` 2 in-scope) are counted inside their
  same-named buckets. A reader comparing "the oddity category" across documents
  can land on either meaning.
- **`facility`** (2,245 in-scope) is a generic RIDB container that spans
  campgrounds, day-use sites and offices. It sits in `interest` by residual
  assignment, not by fit.
- **`park_feature`** (3,691 in-scope) is documented in `federated.ts` as "mixed
  natural/interpretive but unsplittable by primary_category" and assigned to
  `scenic` to preserve prior behaviour. Counted in `scenic`; the assignment is
  acknowledged-arbitrary at source.
- **`land_status`** (35,966 total, **0** in-scope) and **`public_land`** (1,327
  total, 448 in-scope) are land-tenure polygons, not POIs. `land_status` is
  claimed by no bucket and contributes nothing. Counted, flagged, not forced.
- **`water` / `shower` / `dump_station`** are claimed by tiles but by no slide
  bucket — they exist in the tile vocabulary only. Counted under the tiles.

---

## Summary — where a decision is most needed

Ordered worst-first by the brief's criterion (thin corpus **and** no live
source), with the compliance question separated from the wiring question,
because they need different remedies.

**Tier 1 — no corpus AND no live source available at all. Nothing can fix these
by wiring.**

1. **Showers** (4 in-scope, suppressed at render, **no Mapbox category exists**)
2. **Dump stations** (6 in-scope, suppressed at render, **no Mapbox category**)

   These two are advertised with NEW badges and, per PR #361, are additionally
   dropped at hydration — so they are empty twice over. Any fix is a sourcing
   decision (a new provider, or an OSM-derived corpus ingest), not a routing one.

3. **`urban`** (**0** corpus rows, no live source, both claimed primaries empty)
   — a fully dead bucket that still occupies a chip on two surfaces.

**Tier 2 — no corpus, but a compliant live source EXISTS and is simply unwired.
These are wiring decisions.**

4. **Auto / Repair** — **0** corpus rows, no live wiring, but Mapbox publishes
   `auto_repair`, `repair_shop`, `car_wash`. Cheapest gap to close in the audit.
5. **Water fill** — 169 in-scope but suppressed at render; **no** Mapbox
   equivalent, so unsuppressing the corpus is the only lever, not wiring.
   (Sits between tiers: corpus exists, live does not.)

**Tier 3 — thin corpus, live source exists and IS wired. Live-dependent by
design; the risk is a live outage, not a gap.**

6. **`overnight`/Hotels** (4 in-scope) and **Coffee** (2 in-scope) — essentially
   no corpus at all. Both work today only because the live half carries them.
7. **`attraction`** (106 in-scope; all three Google types have 0 corpus rows).

**Tier 4 — corpus is deep, live is absent, and nothing is broken; these are
opportunities, not gaps.**

8. **Trailheads** (4,759 in-scope) and **Dispersed** (2,533) — the two deepest
   corpus-only tiles. Mapbox has `trailhead`; nothing has dispersed camping.
9. **Groceries** (546 in-scope, Mapbox `grocery`/`supermarket` unwired).

**Cross-cutting, and arguably ahead of all of the above:** the three-vocabulary
split (Finding 0) and the Overpass-vs-Google split on the reference-trip path
(Finding 4) mean "which source serves category X" currently has **no single
answer** — it depends on the surface. Any routing table will have to pick one
vocabulary to be canonical before it can be written.

---

## Raw instrument output

Instrument 1's full 70-row TSV and instrument 2's rollups are reproducible:

```
cd data && npx tsx --env-file=.env scripts/measure-category-source-audit-2026-09-02.ts > /tmp/cat-audit.out
cd ../web && npx tsx scripts/rollup-category-audit-2026-09-02.ts /tmp/cat-audit.out
```

Both are read-only and TEST-guarded (instrument 1 exits non-zero on any project
ref other than `znldzjdatkogdktymtvi`).
