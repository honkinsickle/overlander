# Finding — sub-floor gazetteer communities surface ONLY via the >150mi gap-fill

**Date:** 2026-07-21
**Branch:** feat/manual-trip-edit
**Class:** known limitation, deliberately not fixed in the northern-density slice.

## What

`deriveCorridorCities` picks intermediate nodes in two passes:

1. **Top-N prominence** ([derive.ts:170-178](../../src/lib/corridor/derive.ts)) — candidates are
   filtered `pop >= popFloor` (10,000) before selection.
2. **Adaptive gap-fill** ([derive.ts:180-225](../../src/lib/corridor/derive.ts)) — any along-route
   gap > `maxGapMi` (150) is filled with the most prominent unselected candidate
   *inside* it, **floor relaxed** (it draws from `candidates`, the full gazetteer
   set, not the `pop >= floor` subset).

The northern communities we ingested (`cities-na-north.json`) are genuinely small
— Dease Lake / Iskut / Pelly Crossing are unincorporated (`pop: 0`), Teslin 239,
Carmacks 588, Watson Lake 1,133, New Hazelton 602 — all far below `popFloor`. So
they are **never** selected by pass 1. They surface only through pass 2, the
gap-fill, which needs an along-route gap **> 150 mi** to fire.

## The limitation

A sub-floor community on a **short day (< 150 mi with no >150 gap)** will NOT
appear as a node even though it is now in the gazetteer — there is no gap to
fill, and it fails the top-N floor. This is **correct for the Cassiar** (its
legs are long, 200–340 mi, so gaps exist and the towns surface), but it is
**wrong in general** and will read as a bug to whoever hits a short northern leg
next ("I added Foo to the gazetteer and it still doesn't show").

Not fixed here on purpose: the honest fix is a region/density-aware admission
rule (admit real communities by category where the population floor is
meaningless), which is a `derive.ts` change with its own tuning. This slice is
data-only + the existing gap-fill; see the earlier analysis that the gap-fill
already relaxes the floor, so no parallel admission rule was added.

## Why pop=0 is safe through the derive path

`byProminence` sorts `b.tier - a.tier || b.pop - a.pop || …`. `pop: 0` is a real
integer, so the sort is stable (no NaN — that only arises from null/undefined,
which is why the schema uses 0, never null). Placement (`milesFromStart`) is
projected from coords, independent of `pop`. In a gap with one candidate it is
selected regardless of `pop`; `pop` only tiebreaks when several communities
compete for the same gap. So a `pop: 0` tier-2 locality wins an otherwise-empty
gap and places correctly — it needs no fabricated population.

## Data provenance (cities-na-north.json)

Coordinates + feature type from the **Canadian Geographical Names Database**
(Natural Resources Canada, `geogratis.gc.ca/services/geoname`), which federates
GeoYukon / BCGNIS / NWT. Populations for the four incorporated municipalities
from the **2021 Census of Population** (StatCan): Watson Lake 1,133, Carmacks
588, Teslin 239, New Hazelton 602. Unincorporated places (Dease Lake, Pelly
Crossing, Iskut, Kitwanga) carry `pop: 0` — they have no census-subdivision
count, and grounding forbids inventing one. `tier: 2` (generic populated place)
for all, matching the base gazetteer's GeoNames-derived tier scale.

A production ingest should pull directly from the GeoYukon / DataBC APIs into a
committed, repeatable build script (mirroring `build-cities-na.ts`); this Narrow
set is curated for the Cassiar corridor.
