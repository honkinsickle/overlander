# Place-card order is route-derived — reorder is allowed, but the backtrack is priced

**Status:** Finding + resolution. Place-reorder unblocked via a **free backtrack
advisory (Tier 1)**; being built. Branch `feat/manual-trip-edit`.
**Date:** 2026-07-20 (finding); revised same day (resolution).

Manual-edit added drag-to-reorder for the **day cards** in the rail (a flat
`Day[]`, `arrayMove` + recompute + polyline splice — see `lib/trips/reorder-days.ts`).
The same gesture for the **place cards** in the centre corridor column doesn't
fit the data the same way. This note records why, and how it's resolved without
lying about geography.

---

## The finding

**Within a day, place cards have no stored order to reorder. Their order is
DERIVED from route position.**

- `placePool(day)` (`web/src/components/trip/day-detail-corridor-column.tsx` ~630)
  builds `CorridorPlace[]` from `day.segmentSuggestions ∪ day.waypoints`
  (+ legacy `day.suggestions`). There is no per-day ordered place array.
- `CorridorPlace.milesFromStart` (`day-detail-corridor.tsx`) is the along-route
  distance of a curated key stop, projected onto the day's polyline at bake time.
- `DayDetailCorridor` renders the day as a **spine** (`buildSpineItems`): curated
  key stops at their `milesFromStart` position ordered by mile (`KeyStopNode`);
  pool tiles bucketed under a city node in `corridorCities[].placeIds` order
  (`CityNode`); `MileTick` markers.

So "the order of place cards in a day" is emergent from mile-position + city
bucketing — not a sequence anyone stored.

**Evidence (dawson-cassiar-livingplan-test, day 9, Smithers → Prince George):** the
spine cards are curated key stops — *Burns Lake @ 372 mi*, *Nancy O's @ 514 mi* —
rendered in that order because those are their real along-route distances. All
place cards carry coords; the two spine stops carry `milesFromStart`; the
anchor/overnight tiles (Prince George, Bee Lazee) lack it. 17/17 days have ≥2
positioned places.

## Why a naive reorder was rejected — and the resolution

The original block was against faking an order by **corrupting the markers**:
overriding `milesFromStart`, dropping the mile labels, or rewriting them on drop.
Those let you put Prince George before Burns Lake and *hide* that it's a
backtrack — a lie about the drive.

**The resolution is messaging, not prevention.** Allow any drag; keep the markers
honest; **price the consequence**. A "514 mi" card sitting above a "372 mi" card
*is* the visual of the backtrack — the number stays true and an advisory line
states the cost. A backtrack isn't wrong, it's expensive, and the job is to price
it, not forbid it.

## Resolution: two tiers

- **Tier 1 — free, arithmetic, no network (what we build).** Every place has an
  along-route position: stored `milesFromStart`, or a pure-geometry projection of
  its coords onto the day polyline via `alongRouteMiles` (the same bake-time
  projection; no fetch). Walk the user's order; any **descending step**
  `m_{i+1} < m_i` is a backtrack costing ≈ **2 × (m_i − m_{i+1})**. Sum = extra
  miles. Instant. Powers the "this order backtracks ~N mi" advisory. Markers are
  never rewritten.
- **Tier 2 — optional, one ~560 ms Directions call.** Route the day through its
  places as ordered waypoints (`routeBetween([start, …places, end])`, ≤25 coords →
  one call) for the *exact* new distance/duration/geometry. Only needed if the
  day's official miles should reflect the visit order (authoritative), rather than
  the endpoint-derived miles plus an advisory (see next section).

## What is / isn't affected by place order

Endpoint-derived miles don't change from a reorder: a day's `miles`/`driveHours`
come from its **endpoint cities** (`corridorCities` start/end = the overnight),
not the intermediate cards. So the **advisory** path (Tier 1) recomputes nothing —
the header keeps its endpoint miles and the backtrack shows as a separate
consequence. Only the **authoritative** path (Tier 2) would fold the backtrack
into the day's official mileage. This was never a routing-cost block — only a
data-model one, and Tier 1 answers it with arithmetic.

## The node-stack model (future, authoritative — not required now)

The cleaner long-term model is the **node-stack**: a day is an ordered list of
city **nodes**, POIs hang under nodes, you reorder **nodes**, and geography stays
honest because nodes carry the mileage. That would make Tier 2 the natural default
(reorder = re-sequence nodes = re-route). It is **not a prerequisite** for the
Tier 1 advisory, which prices arbitrary place order today without it.

## What was built vs. left

- **Built:** place-card **grip** — dotted `GripVertical` in the 47px Select/Drag
  lane (`category-list-card.tsx`, `editMode`-gated).
- **Building now:** Tier-1 place-card drag-reorder within a day — honest markers +
  arithmetic backtrack advisory, no routing.
- **Deferred:** Tier-2 authoritative recompute; cross-day moves; the node-stack
  model.
