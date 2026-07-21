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
