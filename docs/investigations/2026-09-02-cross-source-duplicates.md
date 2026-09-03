# Cross-source duplicate master_places — investigation

**Date:** 2026-09-02 · **Status:** investigation only, no fixes, no merges, no data changes.
**Scope:** the six state-park visitor-content sources on PROD and TEST.
Derivation script: `data/scripts/crosssource-duplicate-investigation.ts` (read-only).

---

## 0. Three corrections to the framing, up front

**a) "78 pairs" was not a pair count.** The earlier per-state runs counted
*source records having at least one twin* (`dup++` per record). Re-derived as
distinct `master_place` pairs with the same narrow filter, PROD has **90**. Both
numbers are right; they are different units. One record can have several twins,
and two records can share one.

**b) The narrow filter hid most of the population.** The earlier measure only
counted candidates whose `primary_category` was `oddity` or `park_feature`.
Dropping that restriction, PROD has **427 pairs**.

**c) The stated premise — "usually `atlas_oddities`, NPS, occasionally
OSM/RIDB" — does not hold for the real population.** Actual `primary_category`
of the other side across the 427:

| category | pairs |
|---|---|
| campground | 180 |
| recreation_area | 146 |
| oddity | 59 |
| park_feature | 31 |
| facility / visitor_center / interest / dispersed_camping / picnic_area / trailhead | 11 |

By backing source, the largest classes are `state_parks` (156) and
`state_parks + wikipedia` (118) — **274 of 427 collisions are against the
visitor record's own GIS sibling**, not a foreign source. `atlas_oddities` is 59.

---

## 0b. TEST vs PROD — the sets differ badly, and TEST is the wrong place to build this

| measure | PROD | TEST |
|---|---|---|
| BROAD pairs (any category) | **427** | **775** |
| NARROW pairs (oddity/park_feature) | 90 | 94 |
| self-created duplicates | **43** | **0** |

The narrow class is comparable (90 vs 94) — `atlas_oddities` and NPS
`park_feature` exist on both databases. **The broad class is not.** TEST carries
~350 extra pairs that cannot exist on PROD, because they come from sources PROD
does not have:

| other side's backing source | TEST pairs |
|---|---|
| `padus` | 202 |
| `generated_template + state_parks` | 175 |
| `generated_llm + osm` | 53 |
| `padus + state_parks` | 52 |
| `generated_template + padus + state_parks` | 48 |

PROD has **zero** `padus` source_records and zero `land_status` master_places
(measured during NV's promotion). TEST has 37,701 and 35,966. TEST's other-side
category distribution is correspondingly dominated by `public_land` (169),
`campground` (162) and `land_status` (138) — a population that simply is not
present in production.

**Two consequences, and they point the same way:**

1. **TEST overstates the problem by ~1.8× and mis-weights its composition.** A
   merge tool tuned against TEST's population would be optimised for `padus` and
   `generated_*` collisions that will never be encountered on PROD.
2. **The single most actionable class — the 43 self-created duplicates — exists
   only on PROD (43 vs 0).** Developing against TEST would not surface it at all.

This is a deliberate exception to the project's standing "TEST first" rule, and
worth stating plainly: **for this problem TEST is not a representative
rehearsal.** Correctness of a merge *mechanism* can still be exercised on TEST,
but the *target list* and any thresholds must be derived from PROD.

---

## 1. The headline finding: 43 duplicates our own promotions created

Filtering to pairs where the visitor `master_place` is backed **only** by the
visitor source (i.e. it was a phase-2 `new_master_place`), the other side is a
`state_parks` GIS record, and the names are **identical** after normalisation:

| | PROD | TEST |
|---|---|---|
| self-created duplicates | **43** | **0** |

**42 of the 43 are OR; 1 is CA.** These are cases where the ER created a brand-new
`master_place` while an exact-name `state_parks` GIS record for the same park sat
146 m – 1993 m away. Previously only one such case was reported (AZ's Tubac
Presidio); the real number is 43.

TEST has **zero** — this is a PROD-corpus-specific outcome, not a defect
reproducible on TEST.

### Root cause — two mechanisms, both upstream of any merge tool

`scoreMatch` (documented in `matcher.ts`):

```
combined = 0.4 × distance_score + 0.4 × name_similarity + 0.2 × category_compatibility
distance_score = 1 − min(distance, 100)/100        → 0 beyond 100 m
```

So an identical-name, identical-category pair beyond 100 m scores **0.60** — the
code comment says exactly this. Auto-link needs ≥ 0.85. `name_dominant` exists
for this case but gates on `name_sim ≥ 0.85`, **`cat_compat ≥ 0.8`**, and
`distance ≤ 500 m`, with `NAME_DOMINANT_CONFIDENCE_FLOOR = 0.7`.

Breakdown of the 43:

| by distance | pairs |
|---|---|
| > 500 m — outside `findCandidates` radius, never even a candidate | **26** |
| 100–500 m — was a candidate, scored below threshold | **17** |
| ≤ 100 m — would have auto-linked | 0 |

| by category pair (why it did not link) | pairs |
|---|---|
| `viewpoint → recreation_area` = **0** (below the 0.8 gate) | 10 |
| `public_land → recreation_area` = 0.7 (below gate) | 7 |
| `historic → recreation_area` = 0.7 (below gate) | 7 |
| `recreation_area → recreation_area` = 1.0 (failed on distance alone) | 10 |
| `park → recreation_area` = 0.9 (failed on distance alone) | 9 |

**`viewpoint ↔ recreation_area` = 0 is the same class of gap CA hit during its
TEST work** — `CATEGORY_COMPATIBILITY` had no entries for `park`, `historic`,
`interest`, so `cat_compat = 0` killed perfect-name matches. Those three were
added; `viewpoint` was left with the identical hole, and OR's name-suffix
category inference produces viewpoints in quantity.

**Why OR and not the others:** OR's visitor coordinates sit furthest from its GIS
records, and OR's inferred categories (`viewpoint`, `public_land`, `historic`)
are precisely the ones with weak compatibility to `recreation_area`.

---

## 2. Categorisation of all 427 PROD pairs

**By content shape** — which side actually has a description or photo:

| class | pairs |
|---|---|
| both sides have content (a merge would need to combine fields) | 239 |
| visitor side only (a clean supersede) | 188 |
| other side only | **0** |
| neither | **0** |

The visitor side has a description in **427/427** and a photo in **410/427**.
The other side: description **118/427**, photo **228/427**.

**By name match:**

| class | pairs | reading |
|---|---|---|
| identical after normalisation | 110 | strong duplicate signal |
| similar but not identical (0.85 ≤ sim < 1.0) | **317** | **must be treated as suspect** |

### ⚠️ Merging would be WRONG for a large share

The 317 "similar" pairs are dominated by genuine parent/child structure, not
duplication. Observed examples:

- `Pfeiffer Big Sur State Park` ↔ `Pfeiffer Big Sur Campground` / `Group Camp A` / `Group Camp B`
- `Candlestick Point SRA` ↔ `Candlestick Point Campground`, `Candlestick RV Park`
- `Colusa-Sacramento River SRA` ↔ `Colusa-Sacramento River Campground`
- `Torrey Pines State Beach` ↔ `Torrey Pines State Natural Reserve` — **genuinely distinct units**

`campground` (180) being the single largest collision category is the tell: those
are overwhelmingly campgrounds *inside* the park, which the schema already models
properly via `place_relationships` (`contained_in`), not duplicates.

True duplicates in the "similar" bucket are the abbreviation pairs —
`Petaluma Adobe State Historic Park` ↔ `Petaluma Adobe SHP`,
`Little River State Beach` ↔ `Little River SB`, `Kruse Rhododendron SNR`,
`Pfeiffer Big Sur SP`, `Torrey Pines SB`. These are the same shape as the 43
self-created ones and are almost certainly the same root cause.

**Conclusion:** name similarity alone is not a sufficient merge criterion. The
safe automatable subset is *identical* name **and** an existing GIS counterpart.

---

## 3. Canonical-source pattern — does the visitor side deserve to win?

| | pairs |
|---|---|
| visitor side has MORE contributing sources | 267 |
| equal | 151 |
| visitor side has FEWER | **9** |

Combined with content (visitor has a description in 427/427, the other in
118/427), **the visitor-content-linked side is the richer record in essentially
every pair.**

But that does *not* make it the right canonical target. The triage precedent
established across CA (Gray Whale Cove), OR (Erratic Rock) and NV (Cave Rock)
was the opposite: **the `state_parks` GIS record is the canonical home**, and the
visitor content should attach to it. The 43 self-created duplicates are exactly
the case where that did not happen.

So the rule is **not** "keep the richer row". It is:

> Prefer the `state_parks` GIS-backed `master_place` as canonical; move the
> visitor content onto it.

That is the reverse of what a naive "richest row wins" heuristic would do, and
would have merged 267 pairs the wrong way round.

---

## 4. Merge mechanism — scoping

### What references `master_place(id)`

| table | column(s) | on delete |
|---|---|---|
| `source_record` | `master_place_id` | SET NULL |
| `place_match` | `master_place_id` | CASCADE |
| `place_relationships` | **`child_master_place_id` AND `parent_master_place_id`** | CASCADE |
| `master_place_generated_content` | `master_place_id` | CASCADE |
| `master_place_photo_candidate` | `master_place_id` | CASCADE |

`place_relationships` has **two** FK columns — a merge must rewrite both, and
must guard against producing a self-referencing row (`child == parent`) when both
sides of a merged pair already participate in a relationship.

### Does a merge mechanism exist?

**No.** There is no `merge_master_place` / dedup function anywhere in
`supabase/migrations`, `data/entity-resolution`, `data/pipeline` or
`data/scripts`. `place_relationships` is explicitly documented as *"a
relationship, not a merge — both master_places remain distinct rows."*

The only single-row precedent is **`amenity_rollup`** in
`apply_match_outcomes`, which does exactly the useful half:

```
UPDATE source_record SET master_place_id = target
INSERT place_match (match_method='amenity_rollup', status='confirmed')
queue target for recompute
```

It does **not** delete the vacated `master_place`.

### The important scoping result: no DELETE is required

`recompute_master_place` sets `source_count` to the number of **active,
non-generated** `source_record`s pointing at the row. `master_place_search_export`
filters `where mp.source_count > 0`.

So repointing every `source_record` off a row and recomputing it drops
`source_count` to 0, which removes it from the export view — and therefore from
Typesense on the next `search:sync`, via the prune pass that already exists and
was observed removing 12 stale docs during CA's sync.

**A merge can therefore be built from primitives that already exist**
(repoint + recompute + sync), with no destructive DELETE and no new migration
for the core path. What still needs deciding:

1. Whether to hard-delete the vacated row or leave it orphaned at
   `source_count = 0` (invisible to search, still present in the table).
2. Rewriting `place_relationships` on both columns, with a self-reference guard.
3. What to do with `master_place_generated_content` and
   `master_place_photo_candidate` rows on the vacated side — CASCADE only fires
   on delete, so if the row is left orphaned these persist and point at a dead
   place.
4. Whether an explicit `same_as` `relationship_type` is preferable to merging at
   all. The `place_relationships` CHECK constraint is *deliberately named* so the
   enum can be extended — the schema anticipated this.
5. Typesense: no special handling needed. The count changes and the prune pass
   handles removal. Confirmed behaviour, not assumed — CA's sync pruned 12,
   UT's pruned 0 with a zero delta while still refreshing content.

---

## 5. Prioritisation data

**By state, PROD, count first per the standing recommendation:**

| state | broad pairs | narrow pairs | self-created dups |
|---|---|---|---|
| CA | 162 | 25 | 1 |
| WA | 107 | 13 | 0 |
| OR | 78 | 18 | **42** |
| NV | 27 | 16 | 0 |
| AZ | 27 | 10 | 0 |
| UT | 26 | 8 | 0 |
| **total** | **427** | **90** | **43** |

**Recommended order of work, highest value first:**

1. **Fix the two upstream causes before merging anything.** `viewpoint →
   recreation_area = 0` in `CATEGORY_COMPATIBILITY`, and the interaction of the
   100 m distance clip with `findCandidates`' 500 m radius. Otherwise the next
   quarterly refresh re-creates the same duplicates. This is the highest-leverage
   item and it is *not* a merge tool.
2. **The 43 self-created duplicates** — identical name, known-correct canonical
   target (the GIS row), single mechanism. The safest automatable batch. 42 are
   OR, so it is effectively one state's cleanup.
3. **The abbreviation pairs** in the "similar" bucket (`… State Historic Park` ↔
   `… SHP`) — same shape, needs a normalisation rule rather than case-by-case
   judgement.
4. **Everything else — do not batch.** 180 `campground` collisions and much of the
   rest are parent/child structure that `place_relationships` already models.
   Merging them would destroy real distinctions such as
   `Torrey Pines State Beach` vs `Torrey Pines State Natural Reserve`.

**High-traffic parks appearing in the pair list** (worth fixing regardless of
batch priority): Pfeiffer Big Sur, Torrey Pines, Kartchner Caverns, Valley of
Fire, Dead Horse Point / Goblin Valley area, Deception Pass, Fort Worden,
Ginkgo Petrified Forest.

---

## 6. Scope limits of this investigation

- Pairs are derived via `findCandidates(source_record, 3000 m)` + Jaro-Winkler ≥
  0.85 over `normalizeName`. **A duplicate further than 3 km, or named
  differently enough to score below 0.85, is not in these counts.** The figures
  are a floor, not a census.
- Only the six state-park visitor sources were swept. Duplicates between other
  source pairs (e.g. `nps` vs `osm`) are out of scope and unmeasured.
- No fixes, no merges, no schema changes, and no writes to either database.
