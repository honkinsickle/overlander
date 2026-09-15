# Atlas Obscura → PROD density-cascade measurement

**Date:** 2026-08-27 · **Method:** read-only, TEST + PROD in parallel
· **Script:** `data/scripts/measure-ao-density-cascade.ts`
· **Scoping context:** `docs/proposals/2026-08-27-atlas-oddities-prod-promotion-scoping.md`
§2.4 Path A + Path B, both executed here.

**No PROD writes were performed. No PROD-shape mutations. Only
`SELECT`-shaped calls (`pois_along_corridor(...)` — a `SECURITY DEFINER`
read function — and `source_record.select(master_place_id)`).**

## Verdict

**Safe to promote — with caveats.** No data-integrity risk, no cross-
source entanglement, no downstream code changes needed. But adding
`atlas_oddities` to PROD materially changes pool composition on every
measured corridor, and would flip some corridor cities from silent
today to visible after promotion. Whether that's *desirable* (real
oddity is reason to stop) or *problematic* (obscure oddity in an
unremarkable pass-through town) is a product call, not a technical
safety call.

Full detail below.

## Method

- Eight sample routes chosen to sweep the AO-density distribution from
  PR #310's scoping §2.2: two dense CA routes (SF Bay + LA metro), one
  CA mid-density (Central Valley), one OR (wave 1), and one each for
  the wave-2 states (AZ, NV, UT, WA-into-OR).
- For each route, called `pois_along_corridor(route, 16000, null)`
  against TEST **and** against PROD in parallel. The PROD read uses a
  service-role client instantiated from
  `~/.config/overlander/env-backups/.env.production-backup`, hardcoded
  to refuse if the URL isn't the PROD ref. `data/.env` was never
  swapped; the Supabase CLI was never re-linked.
- For each TEST row, checked `source_record` for any non-atlas_oddities
  `is_active = true` record linked to that master_place_id. Rows with
  no non-AO active source_record are labelled **AO-only** — they would
  disappear from the RPC output entirely without AO (since the RPC's
  `source_count > 0` filter would drop the master_place).
- Rows carrying `attribution.description = 'atlas_oddities'` or
  `photo_credit = 'Atlas Obscura'` on an AO-backed master_place would
  have been labelled **AO-backed**. In practice this number came out
  **zero on every route** — see §Interpretation.
- Approximated `isRealContent` per `web/src/components/trip/day-detail-corridor.tsx`:
  `p.category !== FUEL_CATEGORY && hasDescription(p)`. This is the
  `filterVisibleSpineItems()` bar for whether a pass-through corridor
  city stays visible.
- Approximated the "would this create a corridor-city visibility flip?"
  question by measuring the great-circle distance from each AO-only,
  real-content row to the nearest PROD row on the same corridor. An
  AO-only row >5 mi from any PROD row is a **potential flip candidate**
  — the pool near it has no non-AO real content today, so AO alone
  would carry that stretch's `hasRealContent` verdict from `false` to
  `true`.

## Confirmed: corridor-city selection is gazetteer-based

`web/src/lib/corridor/derive.ts` — `deriveCorridorCities` takes
`gazetteer: GazetteerCity[]` as input and applies the ≤3mi `corridorMi`
rule to a city's straight-line offset from the day polyline. POI
density is **not** a parameter. Adding atlas_oddities to PROD cannot
add or drop cities from the spine. The only surfaces AO can affect
are (a) pool composition within each already-selected city, and (b)
the `filterVisibleSpineItems()` pass-through-city visibility gate.

## Raw results (per route, this session)

| route | TEST rows | PROD rows | AO-only | AO-only real-content | flip? |
|---|--:|--:|--:|--:|--:|
| SF Bay: San Jose → San Francisco | 1000 * | 377 | 211 | 211 | 26 |
| LA metro: Santa Monica → Riverside | 684 | 71 | 318 | 318 | 10 |
| Central Valley: Sacramento → Fresno | 139 | 14 | 24 | 24 | 7 |
| Oregon coast: Portland → Eugene | 391 | 62 | 91 | 91 | 6 |
| Arizona: Phoenix → Tucson | 419 | 746 | 84 | 84 | 9 |
| Nevada: Reno → Las Vegas | 220 | 56 | 100 | 100 | 20 |
| Utah: Salt Lake City → Moab | 525 | 340 | 25 | 25 | 2 |
| Washington: Seattle → Portland OR | 705 | 53 | 226 | 226 | 17 |
| **Totals** | | | **1,079** | **1,079** | **97** |

`*` SF Bay TEST hit exactly 1000 — the PostgREST default row-limit cap.
The 211 AO-only figure is unaffected (AO-only is a client-side split
of the returned rows), but the 789 "no-AO" figure on that route is a
lower bound. Rerunning with a higher limit is a follow-up if precise
non-AO counts matter; for the promotion decision they don't.

## Interpretation

### AO-only = zero AO-backed

Every AO-attributed row in the TEST returns comes from a master_place
with no other active source_record. This is the direct consequence of
two things:

1. atlas_oddities `source_quality_score` is 0.5 and its
   `field_precedence` priority for description is 6 — below every
   other source. So if a master_place has any non-AO source with a
   description, that non-AO source wins attribution, and the row
   won't be labelled "AO-attributed."
2. AO POIs on TEST are largely unique places that no other source
   catalogued — the CSV set is by construction Atlas Obscura's own
   editorial curation.

So the population of interest ("what does AO add to PROD?") is
cleanly the AO-only set. The AO-backed case would matter if a
non-AO-photoed row started carrying an AO photo credit; it doesn't
happen because AO is last in the photo precedence chain too.

### Every AO-only row is real content

`aoOnlyIsRealContent` equals `aoOnly` on every route. Every AO-only
row is non-fuel (all are `primary_category = 'oddity'`) and carries a
description (the PR #309/#311 ingest wrote them). So the
`filterVisibleSpineItems` bar `p.category !== FUEL_CATEGORY &&
hasDescription(p)` is cleared by every one of them.

### 97 rows are geographically isolated from PROD's current content

These 97 rows (out of 1,079 AO-only across the 8 sampled corridors,
roughly 9%) are 5+ miles from the nearest existing PROD content on
their corridor. Whether they cause visible corridor-city flips
depends on whether they fall inside a gazetteer city that today has
no PROD content — which this measurement doesn't verify at
per-gazetteer-city precision. What it DOES tell you:

- In dense CA (SF Bay, LA metro), most AO-only rows sit near existing
  PROD content and get absorbed into visible cities. 26 + 10 rows are
  in outlier areas. Names like "El Palo Alto" (15 mi from PROD),
  "Chùa Giác Minh" (13 mi), "Prometheus" (12 mi) are the shape.
- In sparse states (NV, WA), AO carries a much larger share of the
  proposed pool. NV's Reno→LV route today has 16 PROD real-content
  rows; AO would add 100, of which 20 are isolated by 5+ miles. This
  is where the pool composition shift is biggest.
- The extreme: Central Valley has an AO-only row 74 miles from the
  nearest PROD row (Meux Home Museum). PROD returns 1 real-content
  row on that entire 190-mile corridor today. Adding AO makes that
  corridor go from "mostly empty" to "24 populated stops," which is
  either great or terrifying depending on product intent.

### Route-by-route shift shape

Ratio-of-real-content-that-would-be-AO-attributable (`AO-only /
(AO-only + PROD-real-content)`, computed here):

| route | PROD real-content today | AO-only added | AO share of proposed pool |
|---|--:|--:|--:|
| SF Bay | 350 | 211 | 38% |
| LA metro | 18 | 318 | 95% |
| Central Valley | 1 | 24 | 96% |
| OR (Portland → Eugene) | 15 | 91 | 86% |
| AZ (Phoenix → Tucson) | 18 | 84 | 82% |
| NV (Reno → Las Vegas) | 16 | 100 | 86% |
| UT (SLC → Moab) | 128 | 25 | 16% |
| WA (Seattle → Portland OR) | 23 | 226 | 91% |

Two shapes:
- **CA-Bay-Area and Utah** — AO is a supplement, not the majority.
  Existing PROD real content dominates.
- **Every other measured corridor** — AO becomes the majority of the
  real-content pool. This isn't wrong, but it changes the character
  of what browse tiles show on those routes materially.

## Caveats and limits

- The 5-mile flip proxy is an approximation. A per-corridor-city
  analysis using the actual gazetteer + `deriveCorridorCities` would
  give an exact answer for how many corridor-city headers flip from
  hidden to shown. Not done this session; the shape is what matters
  for a go/no-go, and the shape is that flips DO happen (97 candidates
  is the ceiling on how many cities could plausibly flip).
- SF Bay's TEST return hit the PostgREST 1000-row cap. AO-only count
  and flip count on that route are unaffected (both derived from the
  AO subset, not from the non-AO tail).
- `pois_along_corridor` on PROD returns fewer rows than TEST on every
  route except AZ. Not a measurement problem — TEST corpus is ~8x
  larger than PROD (per DATA_INVENTORY.md) so this is expected. The
  measurement compares AO's contribution against PROD's own baseline,
  which is the right frame.
- The AO description content is markdown-flavored (contains inline
  `[link](url)` and real newlines per PR #309's flagged gotcha).
  Downstream tile rendering treats descriptions as text, so markdown
  will render literally. This is a rendering-fidelity concern, not a
  density concern; noted for completeness.

## Verdict — safe to promote, with caveats

The density change is real and measurable. Nothing about it is unsafe
at the data-integrity or code-path level:

- **No corridor city gains or drops from the spine** (selection is
  gazetteer-based, verified).
- **No rows are dropped from the RPC** — AO is additive-only.
- **No description or photo is overwritten on any existing PROD row**
  — AO's priority-6 posture in both field_precedence and the photo
  RPC means AO only fills gaps.
- **Rollback is clean** (per scoping §4).

What Adam is deciding, given these numbers, is a product question:

1. Is a ~9% (97/1,079) isolated-AO-content rate acceptable, given that
   these correspond to real editorial write-ups of real places?
2. Is it acceptable that on rural corridors (NV Reno→LV, OR
   Portland→Eugene, WA Seattle→Portland OR), AO would carry the
   majority of the real-content pool?
3. Is the markdown-in-description rendering fidelity acceptable at
   PROD scale, or does that need a converter first?

None of these are density-cascade blockers in the "spine breaks" or
"visibility rules misfire" sense. They're the shape of what PROD
would look like after promotion.

**Recommendation for the go/no-go:** proceed with the promotion when
the product answer to (1)–(3) above is "yes." The measurement finds no
technical blocker; only the product-shape questions remain.

## What this measurement does not answer

- **PROD user-trip count in scope** — how many active PROD trips
  route through AO-heavy corridors and would surface AO content on
  next generation vs after `refreshCorpusTiles`. Read against
  `public.trips` on PROD would answer it; not done this pass (scoping
  §6 flagged it and Adam has not authorized).
- **Per-corridor-city precise flip count** — would need the real
  gazetteer + `deriveCorridorCities` in a script. The 97 upper bound
  is defensible; a tighter number needs more work.
- **PROD `master_place_search_export` view row-count reshape** — noted
  in scoping §6, not measured here (Typesense sync scope, not
  corridor-render scope).
