# 2026-07-24 — Cross-day stop movement (feature in flight)

Feature-scoped design record: moving a stop between days, and adding a day. The
durable structural map lives in `docs/architecture/itinerary-model.md`; this doc is
the *reasoning about a feature in flight* — the fork, what the code investigation
found, what's decided so far, and the open questions. Append-only.

## Chosen design (2026-07-24)

Resolves the "durable day identity" blocker at the end of the `dayAssignment`
section below. Manual day-assignment becomes a durable OVERLAY, not an array
splice: a sparse `dayAssignment: Record<placeId, dayAnchorId>` on `Trip`, keyed on
the day's durable **anchor uuid** rather than the positional `day-N`. It is read at
pool assembly (`resolve-corridor-cities.ts:181-191`) before per-day bucketing,
carried across regeneration (added to `carryUserAuthored`, `carry-forward.ts:16-26`),
and dropped by `rescopeOverlays` when its target anchor is gone. A POI assigned to a
geographically-foreign day fails that day's on-corridor buffer (`bucket.ts:55`) and
renders under **"Along the way"** with no mile — honest, never a synthesized
distance. The gesture is a picker, not a drag, and the assignment is AUTHORITATIVE:
geography never silently overrides the chosen day. The "Rejected alternatives"
section at the end records the six paths tried and killed to get here, so the next
session doesn't re-derive them.

## Context

The goal is the full edit loop: create a trip in the wizard, then fully edit it —
add days, move stops between days, delete things, find and add places. Most of the
**stop layer** already works (reorder within a day via the rank arc, pin to a node,
delete, search-and-add). The gap is the **day layer**: adding a day, and moving a
stop from one day to another.

Cross-day movement has no gesture today. Drag only works within one viewport, and on
a 66-day trip day 1 and day 40 are never on screen together.

**Scope note (launch = California-only):** move-to-day is a MOVE, not add-to-day —
`placeOverrides` stays one-home-per-place. The add-to case (a place on two days, e.g.
a return leg through the same town) is real for LA→Deadhorse and is **deferred, not
forgotten**.

## The fork — two candidate gestures (not yet chosen)

- **A. Continuous day column.** The day-detail column becomes one scroll of all days;
  a stop is dragged up/down into another day. Natural for ADJACENT days; questionable
  for distant ones (66 days × 112px ≈ 7,400px; day 1→40 is ~4,400px of held
  auto-scroll — and dnd-kit auto-scroll near the viewport edge is exactly where the
  earlier drop bug lived).
- **B. Kebab picker.** A ⋮ on each stop card opening Delete and "Move to day," which
  presents a day list. Works regardless of distance.

These may both be right for different distances. The choice is deliberately left open;
the investigation below is what makes it informed. (A predecessor Paper artboard
"Trip · Edit — Overlander" `HO4-0` exists; the hypothesized successor
"Trip Edit— aligned v1-1" was searched across all Overlander Paper files and **does
not exist** — only day-level kebab designs ("Phase 2 — Editable Trips" `LC-0`,
"Day — Menu Open" `3HI-0`) were found, neither a per-stop "Move to day".)

## What the code investigation found (informs the fork)

All cite `web/` and are current as of 2026-07-24; see `docs/architecture/itinerary-model.md`
for the durable versions.

- **Mount is a single-day swap, not windowed.** `DayDetailCorridorColumn` renders one
  `{day ? … : …}` at a time (`src/components/trip/day-detail-corridor-column.tsx:637`).
  No virtualization exists. Design A requires building a windowed/stacked column from
  scratch — the per-day leaf (`DayDetailCorridor`) is duplication-safe, but the parent
  (scroll-spy, hydration keyed to `selectedDayId`, optimistic edit state) assumes one
  mounted day.
- **The map is NOT a per-day cliff.** One shared `mapboxgl.Map`
  (`src/components/trip/map-column.tsx:395`); the day hero is an image
  (`:642`). 5 stacked days = 5 images + 1 map. The real question Design A raises is
  *which day drives the one shared map's flyTo* under scroll, not map count.
- **Two separate `DndContext`s** (rail `day-column-planner.tsx:253`, detail
  `day-detail-node-blocks.tsx:407`). Cross-day drag means unifying two working,
  separately-verified systems and re-entering the auto-scroll/`delta` hazard
  (`day-detail-node-blocks.tsx:88-100`).
- **Day membership is geometric** — a stop is on day N because it's in day N's pool
  (`day.segmentSuggestions ∪ day.suggestions ∪ day.waypoints`,
  `src/lib/trips/resolve-corridor-cities.ts:181-191`). Moving = splice from A's array,
  push to B's — NOT an override change.
- **nodeIds are name/coords-based, not `dayIndex`** (`src/lib/corridor/derive.ts:259,
  273, 282`). So a day insert/remove does not index-orphan overlays. What breaks a
  naive move is the trip-level, name-scoped override: after a waypoint-only splice it
  can dangle on day B AND still match a same-named node on day A (the
  `applyPlaceOverrides` pull-in, `src/lib/corridor/bucket.ts:112-123`) — split/ghost
  state.
- **No `moveWaypointToDay`, no `addDay` write path** — only `addWaypoint` /
  `removeWaypoint` / `removeDay` exist (`src/lib/trips/repository.ts`). Day-reorder in
  the rail is currently **local-only/unpersisted**
  (`src/components/trip/trip-slideup-body.tsx:66-69`).

## Decision (so far)

1. **`rescopeOverlays` built as a pure, tested primitive — PR #130** (merged).
   `src/lib/corridor/rescope-overlays.ts`: given the overlays and the NEW day layout,
   DROP overlays whose stop no longer has a valid home (its node isn't on the day that
   now holds it), keep the rest unchanged, never rewrite a nodeId. Signature is
   `(overlays, newDays)` — the proposed `oldDays` was a dead parameter because ids are
   name-based, not index-based (no remap to diff). This is the shared primitive both
   move and add/remove-day need.
2. **Cross-day move = pool splice + two-day geometry recompute + rescope, in ONE
   guarded write.** `moveWaypointToDay` follows the STEP-3 collapse: precompute
   `deriveAfterDayEdit`/`recomputeDay` for BOTH affected days (A loses a stop, B gains
   one — both route geometries change; a half-recompute is the silent-wrong outcome to
   avoid), then inside the `updateUserTripPayload` mutate closure apply both derived,
   splice A→push B (by-id, so `onConflict: "retry"` composes), run `rescopeOverlays`,
   and clear `routePolyline`. Atomic; no torn intermediate.
3. **Build order:** the move ACTION (mechanics, script-verified under the seeded JWT,
   no UI) is one PR; the gesture (kebab picker and/or drag) is a second. Not together —
   the action's first real use of the primitive is isolated from the new UI surface.
4. **`removeDay` is not a live correctness bug** — it leaves inert, un-GC'd ghost
   overlays for the deleted day's own stops (hygiene). Recorded in `docs/BACKLOG.md`;
   folds into the shared adapter opportunistically, not its own milestone.

## Consequences / open questions

- **Which gesture (A / B / both by distance)** is unresolved and deliberately so.
  Evidence leans: B needs no shared drag context and no auto-scroll but has no existing
  design; A collides with the single-day mount, the separate DndContexts, and the
  7,400px auto-scroll hazard. Both hit the same net-new server write regardless.
- **Known v1 UX outcome:** a moved stop **loses its manual pin and ordering** — its
  overlay was scoped to a day-A node absent on day B, so `rescopeOverlays` drops it and
  the stop re-buckets to nearest-node on B, unranked. Acceptable for v1 (MOVE,
  one-home-per-place); worth a small "ordering reset on move" note in the picker PR.
  Not a surprise — a confirmed outcome.
- **Add-a-day is not UI-only** — no `repo.addDay`/action exists; the write path
  (insert day + renumber + recompute) must be built. UI is designed (Paper `LC-0`
  "+ ADD DAY" / "Insert Day Above/Below").
- **Deferred:** the add-to case (a place on two days) for LA→Deadhorse return legs;
  persisting rail day-reorder (today local-only).
- **Leave the RAIL scroll and the shared MAP alone — those ARE built and working**
  (the rail is a plain `overflow-y-auto` list of ALL day cards; one shared Mapbox
  instance the selected day drives). **But there is NO windowing/virtualization** — the
  center is a **single-day conditional swap** (`day-detail-corridor-column.tsx:122`),
  not a continuous windowed scroll. A continuous windowed day-scroll is **Design A —
  scoped but NEVER BUILT** (see the fork above); if you build it, you are building it
  from scratch, not touching an existing thing.
  - **Correction (2026-07-24, direct code check on `main` 8883f97):** an earlier draft
    of this line read "do not touch the scroll/**windowing**/map layer — it is built and
    working (`itinerary-model.md` §4)." That was FALSE — it conflated the real rail+map
    with nonexistent windowing, sourced from an unverified earlier report. Verified: no
    `react-window`/`react-virtual`, no virtualization, no `IntersectionObserver`
    mount/unmount, no scroll-driven mounting anywhere in the trip components. (The
    `itinerary-model.md` reference also dangles — that doc was dropped from main by #133.)

## `dayAssignment` overlay — Adam's decision (2026-07-24)

Manual day-assignment must be **authoritative** ("move to day 3" = day 3 regardless of
geography), same principle as `placeOverrides`/`placeRanks` overriding the geometric
default. This supersedes the splice-based move (#131), which sticks on serve but is
**lost on regeneration** (day membership is geographically derived — see
`itinerary-model.md` §2d). The move should WRITE a durable overlay, not mutate arrays.

Shape scoped (root fact: day membership = geometry, re-derived at bake/regenerate):

1. **Field** — `dayAssignment: Record<placeId, day>` on `Trip`, sparse, parallel to
   `placeRanks` (`types.ts:81-90`). Crux: its TARGET has no stable key —
   `placeOverrides`/`placeRanks` key on `nodeId` (name-slug, re-resolves); `Day.id` is
   positional `day-N` (§3), so a day target is positional and fragile.
2. **Bucketing** — the check goes at **pool assembly** (`resolve-corridor-cities.ts:181-191`),
   NOT in `bucketPlacesIntoCorridor`: `pool(D) = [POIs in D's arrays w/o assignment] +
   [POIs assigned to D from anywhere]`; per-day bucketing then runs unchanged.
3. **Mileage** — a geographically-foreign assigned POI fails day D's on-corridor buffer
   (`bucket.ts:55`) → renders in **"Along the way"** with no mile (honest, per grounding).
   Embrace that, don't synthesize a distance.
4. **rescopeOverlays** — must extend to `dayAssignment`: drop entries whose target day is
   gone. On a positional key, reorder/insert requires **remap**, not just drop (harder
   than the index-independent node overlays).
5. **Regeneration** — add to `carryUserAuthored` (`carry-forward.ts:16-26`); but a
   positional day target does not re-resolve to "the same day" post-regen the way a
   `nodeId` does.

**Blocker to resolve first:** #1/#4/#5 all reduce to *days having no durable,
geometry-stable identity*. Recommended: mint a durable `Day.id` (uuid, carried like
`NodeSeed.id`) so `dayAssignment` behaves like a first-class overlay; alternative is
re-resolving by a durable day anchor (end-city/coords), ambiguous when a trip revisits
a city.

## Rejected alternatives

Tried and killed while getting to the chosen design (top) — recorded so the next
session doesn't re-derive them. Each: what it was, why it's dead.

- **Cross-day DRAG (any distance).** Impossible as the primary gesture: the detail
  column mounts ONE day at a time (single-day conditional swap, no
  virtualization/windowing — `day-detail-corridor-column.tsx:122`), so a distant day
  is never on screen to be a drop target. **That is why the move is a PICKER, not a
  drag** — the reason is the **single-day mount** (no second day to drop into), NOT
  windowing/unmounting (there is none). STILL TRUE on `main` 8883f97, re-verified by
  direct code check 2026-07-24.
- **Moving a ROUTE WAYPOINT between days.** A waypoint is part of the routed line
  (`recompute-day.ts` routes `start → waypoints → end`), so moving it re-cuts trip
  geometry and reshapes every day's mileage — fighting the base regenerator. The
  route is not user-editable; only the user's curated POIs (`segmentSuggestions`)
  move.
- **ARRAY-SPLICE the POI into another day's list** (the in-flight #131 approach).
  Sticks on serve — the corpus fold is baked at fork-create and skipped on serve
  (`bake-corridors.ts:78`, §2d) — but does NOT survive regeneration:
  `carryUserAuthored` doesn't carry a splice (`carry-forward.ts:16-26`) and the
  generator re-buckets geographically. This is why day-membership must be an
  OVERLAY, not an array mutation.
- **Option A — honor geography, `placeOverrides` only.** Let the pin move but keep
  day membership geometric: geography then silently overrides the user's chosen day
  and the move doesn't stick. Rejected — the gesture must be AUTHORITATIVE.
- **Minting a new `Day.id` (uuid).** Unnecessary: key `dayAssignment` on the day's
  durable **anchor uuid** (carried through regen like any `NodeSeed.id`,
  `carry-forward.ts:19`) instead of a parallel positional-id replacement —
  collapsing the blast radius from the ~15 positional `day-N` references to near
  zero. *[Code note, 2026-07-24: `nodeSeeds` today is a sparse, USER-authored list —
  created only via `createNodeSeedAction` (`node-actions.ts:181`) or promoted pins
  (`node-edits.ts:146`), with no per-day overnight anchor stamped at fork-create
  (`types.ts:98-123`). So "the day's anchor uuid already exists" presumes stamping
  one anchor seed per day at fork — a prerequisite to build, not current behavior.
  Flagged for Adam.]*
- **Re-resolving `dayAssignment` by end-city anchor (name/coords).** A durable day
  anchor by city name/coords is ambiguous when a trip revisits a city (the Cassiar
  return leg passes towns twice — cf. §3 cross-day slug collision, and the closing
  note of the `dayAssignment` section above). Rejected in favor of the durable
  anchor uuid.
