# Place-card order is route-derived — reorder is blocked on rendering (node-stack), not on pricing

**Status:** Finding. Place-card reorder **blocked on rendering**; the **node-stack
model is the prerequisite**. Pricing an arbitrary order is solved and free — the
backtrack detector ships as a standalone pure function (`lib/trips/backtrack.ts`,
tested). Branch `feat/manual-trip-edit`.
**Date:** 2026-07-20 (finding + two revisions same day; this is the settled version).

Manual-edit added drag-to-reorder for the **day cards** in the rail (a flat
`Day[]`, `arrayMove` + recompute + polyline splice — `lib/trips/reorder-days.ts`).
The same gesture for the **place cards** in the centre corridor column does not
fit the data, and — after chasing it down — the reason is rendering, not the
thing we first thought (faking an order / "lying about the drive").

---

## The finding — place order is derived, not stored

- `placePool(day)` (`web/src/components/trip/day-detail-corridor-column.tsx` ~630)
  builds `CorridorPlace[]` from `day.segmentSuggestions ∪ day.waypoints`
  (+ legacy `day.suggestions`). There is no per-day ordered place array.
- `CorridorPlace.milesFromStart` is the along-route distance of a curated key
  stop, projected onto the day polyline at bake time.
- `DayDetailCorridor` renders the day as a **mile-interleaved spine**
  (`buildSpineItems`): curated key stops at their `milesFromStart` position
  (`KeyStopNode`), pool tiles bucketed under a city node by `corridorCities[].placeIds`
  (`CityNode`), `MileTick` markers.

So "the order of place cards in a day" is emergent from mile-position + city
bucketing. Evidence (dawson-cassiar-livingplan-test, day 9): *Burns Lake @ 372 mi*
before *Nancy O's @ 514 mi* — because those are the real distances.

## Pricing is solved and free (Tier 1) — this part survives

A user visit order can be **priced with pure arithmetic, no network**: every place
has an along-route position (stored `milesFromStart`, else a projection of its
coords onto the day polyline via `alongRouteMiles`). Any step that goes backward
costs ~2 × the drop; sum = estimated extra miles.

Built as `lib/trips/backtrack.ts` (`detectBacktracks`) with a unit test
(`backtrack.test.ts`). It renders nothing — it just prices an order. Example:
visiting Nancy O's (514) before Burns Lake (372) ⇒ ~284 extra miles. The
node-stack model will use it.

## Why reorder is still blocked — RENDERING, not messaging

Showing a user order needs it to render coherently. Inside a mile-interleaved
spine there is no coherent way to do that:

- **(A) Flatten a reordered day to a plain user-ordered list** — rejected. A day
  that renders as a flat list *because it was touched* and as a mile spine
  *because it wasn't* makes the same trip look like two products depending on edit
  history. It also discards the city grouping, which the node model makes
  load-bearing. Dismantling the spine right before making it central is backwards.
- **(B) Preserve city grouping and reorder within/across nodes** — correct, but
  the live render is mile-interleaved, not node-structured, so it needs the spine
  **restructured into nodes first**. That restructure *is* the node work.

So place-reorder is blocked on the **node-stack model**: a day is an ordered list
of city **nodes**; POIs hang under nodes; you reorder **nodes**, and geography
stays honest because nodes carry the mileage (reorder ⇒ re-sequence nodes ⇒
re-route). Pricing (above) is the messaging layer that model will need; it is not
the blocker.

## What is / isn't affected by place order

Endpoint-derived miles don't change from a reorder: a day's `miles`/`driveHours`
come from its **endpoint cities** (`corridorCities` start/end = the overnight),
not the intermediate cards. So pricing is an *advisory* on top of unchanged day
miles; only a routed (Tier-2) pass would fold a backtrack into the official
number. Never a routing-cost block — only a rendering one.

## What was built vs. left

- **Built:** place-card **grip** (dotted `GripVertical`, 47px Select/Drag lane,
  `editMode`-gated, inert) + the **backtrack detector** (`backtrack.ts`, tested).
- **Blocked / deferred:** place-card reorder UI (needs the node-stack render);
  Tier-2 authoritative recompute; cross-day moves. The node-stack model is the
  gating prerequisite.
