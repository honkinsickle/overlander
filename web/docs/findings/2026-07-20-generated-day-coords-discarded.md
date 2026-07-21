# Finding — generated trips discard per-day coords; the corridor engine has never run on them

**Date:** 2026-07-20
**Branch:** feat/manual-trip-edit
**Severity:** the node/corridor engine is dormant on every generated trip; render falls back to a degraded 2-node spine.

## What

`itineraryToTrip` writes per-day endpoint coords like this
([to-trip.ts:138-141](../../src/lib/itinerary/to-trip.ts)):

```ts
const startCoord =
  i === 0 ? first.coords : (output.days[i - 1] && undefined);   // ← always undefined for i>0
const endCoord =
  i === output.days.length - 1 ? last.coords : undefined;       // ← undefined except last day
```

The comment above it promises "Chain coords across days: day i ends where day i+1
starts." That chaining was never implemented — `output.days[i - 1] && undefined`
evaluates to `undefined` for every day past the first. Net result on a generated
trip: **`startCoord` is present only on day 1, `coords` (end) only on the last
day.** Measured on `dawson-cassiar-livingplan-test`: `startCoord` on 1/17 days,
`coords` on 1/17 days.

Meanwhile `baked = bakedByN.get(dp.n)` is in scope and `dayRoutes` carries a
resolved `startCoord`/`endCoord` for **every** day (bake.ts:84-85 uses exactly
those to build each day's polyline). The audit resolved the geometry; to-trip
threw it away at persist.

## Consequence

`resolveCorridorCities` requires `day.coords` (and a start coord) to slice each
day out of `trip.routePolyline`. With those absent on 16/17 days, **0/17 days
derive `corridorCities`** — the corridor engine never runs. Every node rendered
in the trip detail (read view and the new edit-mode City Blocks) comes from
`fallbackCorridor` (day-relative `Start=0` / `End=day.miles`), not the engine.
No server-side place→node bucketing ever happens.

## Reconciliation with the morning's "17/17 nodes, zero drift" check

Both are true. That check measured **fallbackCorridor** — start = label/first
half, end = label/last half at `day.miles` — which is always constructible from
the label + `day.miles`. It never exercised `resolveCorridorCities`, so it
couldn't see that the engine's inputs were missing. "17/17 have node coords" was
the fallback answering; the engine was silent the whole time.

## Class

Same class as the routePolyline-discarded-at-persist bug: the generation pipeline
computes real geometry, then the to-trip mapping drops it by omission. See also
the node-stack carry-forward guard built to catch this shape for user overlays.

## Related, downstream

The stored `segmentSuggestions.milesFromStart` on this trip is also unreliable —
a **constant ~+589 foreign offset** vs the true route-relative position (day 1:
stored 625/744/857 vs true 37/155/267). Positions must be recovered from POI
`coords` projected onto `trip.routePolyline`, not from the stored number. The
stretch-container render does this at render time as a stopgap (see
`lib/corridor/stretches.ts`), pending the coords-persistence fix here.

## Fix (separate slice — not done here)

In `itineraryToTrip`, set `startCoord`/`coords` from `baked`/`dayRoutes`
(`dr.startCoord`/`dr.endCoord`) for every day, chaining day i's end to day i+1's
start. Once persisted, `resolveCorridorCities` runs, real nodes + bucketing
appear, and the render-time geometry stopgap can be deleted.

## Fixed (2026-07-20)

`itineraryToTrip` now copies `dr.startCoord`/`dr.endCoord` from the audit's
`dayRoutes` for every day (commit `1c487c0`). NEW generated trips persist real
per-day coords going forward.

## Recovery for the already-persisted trip — geometry-only re-seed

The working trip `dawson-cassiar-livingplan-test` was persisted BEFORE the fix,
so it has neither per-day coords (1/17 start, 1/17 end) nor baked
`corridorCities` (0/17). Re-running the audit to recover them was rejected: 14
of its 17 day endpoints are NOT trip anchors and would re-resolve through live
Google — a silent content change (a moved/closed/re-ranked place lands at a new
coord), not a geometry fix. Instead `scripts/reseed-day-coords.ts` recovers each
day's coords purely from already-persisted data — the trip's own `routePolyline`
walked by the per-day published `miles` (net of round-trip / dwell days). It
re-resolves nothing and re-routes nothing. Measured slop: −0.2% total
(polyline 1992mi vs summed net day-miles 1995mi), endpoints pin at 0.00mi, and
the interior Barkerville anchor lands in its correct Wells excursion day (day 11,
3.3mi offset).

### PROVENANCE — day.coords now means two different things

A re-seeded day's `coords`/`startCoord` is a **point ON THE ROAD at cumulative
mile X**, not the overnight place's own coordinate. That is correct for
`resolveCorridorCities` (it slices the polyline between two miles), but it is
DIFFERENT PROVENANCE from what `itineraryToTrip` writes for NEW trips, where
`day.coords` is the audit's *resolved place* coordinate. Same field, two
meanings. Do not read a re-seeded `day.coords` as "where Whitehorse is."
