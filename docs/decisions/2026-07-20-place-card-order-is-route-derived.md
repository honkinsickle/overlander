# Place-card order is route-derived, not stored — place-reorder is blocked on the node-stack model

**Status:** Finding. Place-reorder NOT built (deliberately). Branch `feat/manual-trip-edit`.
**Date:** 2026-07-20.

Manual-edit added drag-to-reorder for the **day cards** in the rail (a flat
`Day[]`, `arrayMove` + recompute + polyline splice — see `lib/trips/reorder-days.ts`).
The obvious next step was the same gesture for the **place cards** in the centre
corridor column. It doesn't fit the data. This note records why, so the next
session doesn't re-derive it.

---

## The finding

**Within a day, place cards have no stored order to reorder. Their order is
DERIVED from route position.**

- `placePool(day)` (`web/src/components/trip/day-detail-corridor-column.tsx` ~630)
  builds `CorridorPlace[]` from `day.segmentSuggestions ∪ day.waypoints`
  (+ legacy `day.suggestions`). There is no per-day ordered place array.
- `CorridorPlace.milesFromStart` (`day-detail-corridor.tsx`) is the along-route
  distance of a curated key stop, projected onto the day's polyline at bake time.
- `DayDetailCorridor` renders the day as a **spine** (`buildSpineItems`):
  - **curated key stops** render at their `milesFromStart` position, ordered by
    mile (`KeyStopNode`);
  - **pool tiles** bucket under a city node in `corridorCities[].placeIds` order
    (`CityNode`);
  - `MileTick` for distance markers.

So "the order of place cards in a day" is emergent from mile-position + city
bucketing — not a sequence anyone stored.

**Concrete evidence (dawson-cassiar-livingplan-test, day 9, Smithers → Prince
George):** the two cards are curated key stops — *Burns Lake @ 372 mi* and
*Nancy O's @ 514 mi*. They render in that order because those are their real
along-route distances. Burns Lake precedes Prince George because it does.

## Why reorder can't be bolted on

Dragging to reorder needs an order that doesn't exist. Every way to fake one is
a workaround, not a fit:

- **Introduce an explicit user order that overrides `milesFromStart`** — lets you
  put Prince George before Burns Lake, which is a lie about the drive, and has to
  drop/relocate the mile markers to do it.
- **Reorder only within a city-node's pool tiles** — leaves the route-positioned
  key stops fixed, so the common generated-trip case (the key stops above) isn't
  draggable at all.
- **Rewrite `milesFromStart` on drop** — corrupts the mile labels (which show real
  distances) and still fights the geometry.

## What is / isn't affected by place order (so the cost is understood)

Reordering places within a day changes **nothing computed**: a day's
`miles`/`driveHours` come from its **endpoint cities** (the `corridorCities`
start/end nodes = the overnight), not the intermediate place cards. No mileage
recompute, no polyline splice. The day's terminus is the end-node/overnight, which
is not a reorderable place card. So this was never blocked on routing cost — only
on the data model.

## The model this actually needs

The **node-stack model**: a day is an ordered list of **city nodes**; POIs hang
under nodes; you reorder **nodes**, and geography stays honest because the nodes
carry the mileage. Reordering the *sequence of places you visit* is really
reordering *nodes*, not detaching a POI from its along-route position. That model
isn't built. Place-reorder is blocked on it, not on drag implementation.

## What was built vs. left

- **Built (kept):** the place-card **grip** is rendered and **inert** — dotted
  `GripVertical` in the 47px Select/Drag lane (`category-list-card.tsx`,
  `editMode`-gated). No drag wired.
- **Not built:** place-card drag-reorder. Revisit only after the node-stack model
  exists.
