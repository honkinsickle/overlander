# `master_place_generated_content` bake-gap scope

**Date:** 2026-08-31 · **Environment:** TEST (`znldzjdatkogdktymtvi`)
**Investigation type:** measurement-only, no code changes proposed here.

## Context

Follow-up to the Boulder Basin investigation
(`docs/measurements/2026-08-31-day-detail-description-bug.md` §Recommended
fix path — "The larger latent gap"). The premise being measured:

- `master_place_generated_content` is the LLM/template fallback table added
  2026-08-21 (migration `20260821000000_master_place_generated_content.sql`).
- Its intended read semantics per the migration comment:
  *"show master_place.description when present; fall back to this table
  only when null. Never both."*
- The day-detail bake path (`mapMasterPlaceRow`,
  `web/src/lib/trip-browse/federated.ts:214-301`) reads only
  `master_place.description` and never touches `master_place_generated_content`.
- The `master_place_search_export` view DOES compose the two into a
  `description_source` field (`'source' | 'template' | 'llm' | null`),
  but the day-detail bake reads the base table, not the view — so any
  falling-back happens in Typesense-served surfaces (search / browse
  hydrate) and NOT on day-detail cards, MapDetailOverlay, Top Places, etc.

This doc measures the population currently affected, split by whether a
fallback row exists.

## How this was measured

Read-only pass this session, `data/scripts/scratch-generated-content-scope.ts`
(deleted after this doc landed). Every number below was computed here; no
figure is pulled from an earlier session or extrapolated from a sample.

- Population universe: `master_place` filtered to `is_searchable = true`.
- "Empty description" = `description IS NULL` OR `description = ''`.
- "Wiring-gap population (A)" = affected rows that DO have a matching
  `master_place_generated_content.master_place_id` row.
- "No-fallback population (B)" = affected rows with NO such row.
- Category breakdown = `master_place.primary_category` in-memory grouped.
- Source breakdown = per-mp union of `source_record.source_id` for A rows
  with `is_active = true`, counted once per mp per source.
- Trip exposure = scan all `reference_trips` + `public.trips` payloads on
  TEST, extract every tile whose `id` starts with `mp:`, intersect with A/B.

## Findings

### Universe

| Metric | Count | Share of searchable |
|---|---:|---:|
| Total `is_searchable = true` master_place rows | 125,289 | 100.00% |
| Of those, `description IS NULL` | 105,486 | 84.19% |
| Of those, `description = ''` | 115 | 0.09% |
| Total affected (NULL or empty) | 105,601 | **84.29%** |

Head-turner: **84.29% of all searchable places on TEST have no direct
`master_place.description`.** Whatever fraction of those the fallback table
covers is the answer to the question.

### A — Wiring gap (fallback EXISTS but bake path doesn't read it)

| Metric | Count |
|---|---:|
| Affected rows with a `master_place_generated_content` row | **13,942** |
| Share of the 105,601 empty-description population | **13.20%** |
| Share of the 125,289 total searchable population | **11.13%** |

**By `primary_category` (top 20):**

| Count | Category |
|---:|---|
| 3,071 | `campground` |
| 2,360 | `park` |
| 2,017 | `trailhead` |
| 1,954 | `dispersed_camping` |
| 1,881 | `ev_charging` |
| 777 | `picnic_area` |
| 531 | `grocery` |
| 373 | `public_land` |
| 373 | `recreation_area` |
| 213 | `beach` |
| 70 | `activity_pass` |
| 52 | `hut` |
| 51 | `hardware` |
| 48 | `park_feature` |
| 28 | `rest_area` |
| 25 | `unknown` |
| 23 | `permit` |
| 19 | `outdoor_gear` |
| 9 | `venue_reservations` |
| 8 | `scenic_spot` |

Campground + dispersed_camping + park + trailhead + recreation_area +
public_land + beach + picnic_area = **9,196** of the 13,942 A rows sit in
categories where users actively read editorial description on the card.

**By source (union of active `source_record.source_id`, counted once per
mp per source; a single mp may appear under multiple sources):**

| Count | Source |
|---:|---|
| 12,147 | `osm` |
| 1,305 | `state_parks` |
| 515 | `blm` |
| 111 | `ridb` |
| 75 | `google_resolved` |
| 6 | `atlas_oddities` |
| 6 | `usfs` |
| 2 | `nps` |

**A skews overwhelmingly to OSM** (~87% of A rows have an active OSM record).
OSM contributes many tag-only rows that are perfect input for the
LLM/template generator; that's exactly where the fallback table was
designed to compensate.

### B — No fallback anywhere (worse case)

| Metric | Count |
|---|---:|
| Affected rows with NO `master_place_generated_content` row | **91,659** |
| Share of the 105,601 empty-description population | **86.80%** |
| Share of the 125,289 total searchable population | **73.16%** |

**By `primary_category` (top 20):**

| Count | Category |
|---:|---|
| 33,760 | `peak` |
| 30,988 | `spring` |
| 6,104 | `viewpoint` |
| 5,946 | `gas_station` |
| 3,439 | `picnic_area` |
| 3,409 | `fire_pit` |
| 2,201 | `campground` |
| 1,631 | `dispersed_camping` |
| 941 | `public_land` |
| 794 | `water` |
| 750 | `ev_charging` |
| 502 | `toilet` |
| 494 | `trailhead` |
| 165 | `park` |
| 163 | `grocery` |
| 133 | `rest_area` |
| 93 | `dump_station` |
| 35 | `beach` |
| 31 | `recreation_area` |
| 21 | `shower` |

Two-thirds of B (**~64,752** of 91,659) is `peak` + `spring` — natural
features that don't need editorial descriptions on a place card. Another
sizable chunk (**~10,795 = gas_station + ev_charging + fire_pit + water +
toilet + dump_station + shower**) is infrastructure amenities that are
suppressed from browse entirely anyway (see
`SUPPRESSED_PRIMARY_CATEGORIES` in `federated.ts`, though not all of these
are in that set — worth confirming per-category if this matters).

Where B is a real problem: **2,201 campgrounds, 1,631 dispersed_camping,
494 trailheads, 165 parks, 141 grocery+rest_area, 35 beaches, 31
recreation_areas** — user-facing categories that have no description
source anywhere.

### Trip exposure — real user-visible impact today

13 baked trip payloads on TEST (9 `reference_trips` + 4 `public.trips`).
Not a representative sample of PROD traffic — this is what currently
exists on TEST for spot-checking.

| Metric | Count |
|---|---:|
| Distinct `master_place` ids referenced across all baked trips | 4,033 |
| Of those, A (wiring gap — fixable by reading the fallback table) | **779** |
| Of those, B (no fallback exists) | **4** |

So today, on average, roughly **60 A-population tiles per baked trip**
(779 ÷ 13, order-of-magnitude only — trips vary in size, this is a mean).
If bake reads the fallback table, those 779 tiles gain a description
immediately.

**Coverage discrepancy worth flagging:** 87% of A rows are OSM-attributed,
but only ~20% of tiles across baked trips have empty descriptions.
Inference (not measured): the trip generator tends to pick tiles that
DO have real descriptions (from RIDB/BLM/state_parks etc.), leaving the
long OSM tail as the always-hydratable-from-fallback pool. So the trip
exposure of the wiring gap is real but scoped — this doesn't wreck every
day, but it does hollow out the "explore more" sidebar and the
description-less compact cards.

## What this means for prioritization

I was not asked for a recommendation, but the numbers cluster into a
clear picture:

- **The wiring gap (A) is a modest-size fix with clear reward.** 13,942
  master_place rows already have generation-authored content sitting
  unused; 779 of them are in currently-baked trips. A single-file fix on
  the bake path (LEFT JOIN LATERAL to `master_place_generated_content`
  when `mp.description IS NULL`, mirror the `master_place_search_export`
  view's pattern) picks up all of them without generating anything new.
- **The no-fallback gap (B) is much larger by count (91,659) but
  concentrated in categories where descriptions are optional** (peak,
  spring, viewpoint, gas_station, fire_pit, etc.). The
  user-relevant portion is roughly 4,700 rows across
  campground/dispersed_camping/trailhead/park/grocery/rest_area/beach/
  recreation_area — that's the real "no editorial content exists"
  population and it's the ceiling on what the generation pipeline could
  usefully backfill.
- **The two gaps are independent.** A is a plumbing fix that surfaces
  existing content. B needs generation work OR is fine-as-is depending on
  the category.

## Constraints observed

- TEST-only per standing rules (`data/.env` verified pointing at
  `znldzjdatkogdktymtvi`).
- All figures above were computed this session by
  `scratch-generated-content-scope.ts` and can be recomputed by
  restoring that script from git history.
- The corpus grows — these figures are a point-in-time snapshot as of
  2026-08-31 and will drift.
- **Trip exposure figures are from 13 trips on TEST**, not PROD traffic.
  Extrapolating them to production requires a separate PROD measurement
  Adam has not authorized.
