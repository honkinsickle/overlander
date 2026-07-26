# Itinerary Model — how the day / waypoint / overlay system is built

Durable structural reference: **how the system IS**, not what to build and not why
a call was made (that's `docs/decisions/`, which is append-only). **This file is
UPDATED as the system changes.** Every claim cites code — if a line drifts, fix
the citation here in the same change.

Read this before modifying days, waypoints, the corridor spine, the overlays
(`placeOverrides` / `placeRanks` / `nodeSeeds`), the trip-slideup render, or any
user-trip mutation.

Paths are relative to `web/` unless noted.

---

## 1. Days — derived from route geometry

- A trip's body is `Trip.days: Day[]`, persisted in the single `public.trips.payload`
  jsonb column (`src/lib/trips/types.ts`; see `web/CLAUDE.md` § Data model —
  normalized tables are an explicit non-goal).
- **`Day.id` is positional** — minted `day-${n}`, 1-based: wizard finalize
  (`src/lib/plan/actions.ts:237`), generation → trip (`src/lib/itinerary/to-trip.ts:149`),
  partial-replan stitch (`src/lib/itinerary/partial-replan.ts:283`). Overlays
  deliberately do **not** reference `Day.id` (see §3) — they key on node slugs, which
  is why renumbering days doesn't orphan them.
- **A day boundary is an overnight anchor.** `Day.coords` is the day's END
  (overnight); `Day.startCoord` is the START (`web/CLAUDE.md` § Known gotchas;
  `src/lib/trips/types.ts`). Day N's start = `day.startCoord ?? (i===0 ? trip.startCoords
  : trip.days[i-1].coords)` (`src/lib/trips/resolve-corridor-cities.ts:141-143`,
  `src/lib/trips/recompute-day.ts:57-58`).
- **The route line is cut into per-day slices by an advancing cursor**
  (`src/lib/trips/resolve-corridor-cities.ts:147-169`): for each day, project its
  start-mile and end-mile onto the whole-trip polyline and take `line.slice(iA, iB+1)`;
  `cursor = iB` so slices are sequential and non-overlapping. `endCapIdx`
  (`:157-160`) bounds the end projection so a repeated destination (a town visited
  more than once) can't project onto a later pass and balloon the slice.
- The drawn geometry itself is the whole-trip `Trip.routePolyline` (encoded), decoded
  per derivation (`src/lib/trips/resolve-corridor-cities.ts:69`) and per client render
  (`src/components/trip/day-detail-corridor-column.tsx:129`); the per-day polyline is
  **not** stored — only `miles` / `driveHours` / `corridorCities` are (see §6, and
  `src/lib/trips/recompute-day.ts:34-42`).

---

## 2. Two-layer model — route waypoints vs curated POIs

### 2a. Base layer: route waypoints + the derived corridor spine

- `Day.waypoints: Waypoint[]` — geometry-bearing points (`Waypoint.coords` is
  `[lng, lat]`), part of the routed line. Stored on the day, in `payload`.
- The **corridor spine** (the towns the route passes) is *derived from geometry*, not
  stored: `deriveCorridorCities` (`src/lib/corridor/derive.ts:102`) walks a bundled
  GeoNames gazetteer against the day's route slice and emits an ordered
  `CorridorCity[]` (start · gazetteer towns · end).
- The day's **place pool** fed to bucketing is
  `day.segmentSuggestions ∪ day.suggestions ∪ day.waypoints`, deduped by id
  (`src/lib/trips/resolve-corridor-cities.ts:181-191`). A stop belongs to a day iff it
  is in that day's pool — day membership is geometric/array-based, not a field on the
  stop.

### 2b. Authored layer: the overlays (attach to the route without being part of it)

Three trip-level, `placeId`/id-keyed maps in `payload`, carried across regeneration
(§5), none of which affect routing:

- **`placeOverrides: PlaceNodeOverride[]`** = `{ placeId, nodeId }` — pin a POI under a
  specific node, overriding nearest-node bucketing
  (`src/lib/trips/types.ts:75-80, 125-132`).
- **`placeRanks: Record<placeId, { nodeId, rank }>`** — authored order among a node's
  cluster, **node-scoped**: the rank applies only in the cluster whose node it names
  (`src/lib/trips/types.ts:81-90`).
- **`nodeSeeds: NodeSeed[]`** — user-authored corridor nodes; feed derivation ONLY,
  never `routeBetween`, so pinning a node never detours the route
  (`src/lib/trips/types.ts:66-74, 98-123`).

### 2c. Composition at render — `assignPlacesToStretches`

Per day, in order:
1. `deriveCorridorCities` builds the spine (`src/lib/corridor/derive.ts:102`).
2. `bucketPlacesIntoCorridor` assigns pool places to nodes by nearest-node
   (called at `src/lib/trips/resolve-corridor-cities.ts:229`).
3. `applyPlaceOverrides` re-homes pinned places, scoped to *this day's* nodes; a
   dangling override (target node absent this day) is ignored
   (`src/lib/corridor/bucket.ts:91-124`).
4. `assignPlacesToStretches` splits into node **CLUSTERS** (a stop's arrival — where
   you eat/sleep) and drive **STRETCHES** (genuinely mid-drive places), honoring
   `rankKey` and `orderKey` (`src/lib/corridor/stretches.ts:183`).

Ordering is one shared rule: `scopeRankKey` keeps a rank only where
`entry.nodeId === cluster.id` (`src/lib/corridor/stretches.ts:110-123`), and
`sortClusterByRank` puts ranked members first, unranked appended
(`src/lib/corridor/stretches.ts:125-139`). The **read spine** and the **edit spine**
(`DayDetailNodeBlocks`, `src/components/trip/day-detail-node-blocks.tsx:187`) call the
SAME functions — surfaces can't drift.

**Why two layers.** The base layer is a deterministic function of geometry (the
generator can rewrite it freely); the overlay is durable user intent that must
outlive regeneration. Keeping them separate is what lets a regenerate replace every
day while the pins/order survive (§5).

### 2d. Which DAY a POI belongs to is geographically DERIVED (not authored)

§2a says day membership is "array-based" — but the array itself is **populated by
geography**, and there is **no durable per-POI day-assignment overlay** today:

- **The corpus fold assigns POIs to days by coordinates.**
  `foldFederatedCorridorSupply` (`src/lib/trips/bake-corridors.ts:68-96`) fills *each
  day's* `segmentSuggestions` from a **per-day-segment** corpus query — a 16 km buffer
  around that day's `start→end` (`fetchCorpusForSegment`, `:105-111`). A POI lands in
  a day's array because its coords are within that day's corridor, nowhere else.
- **For user trips it is BAKED once at fork-create and stored** (`bakeCorridors` →
  fold + `resolveCorridorCities`, `src/app/api/trips/fork/route.ts:67`), then
  **skipped on serve** (`hasBakedCorpusTiles`, `bake-corridors.ts:78`); `getUserTrip`
  does not re-fold or re-bucket. **Reference** trips fold live-at-serve
  (`src/lib/trips/reference.ts:99`). So it is NOT re-run every render for a user
  trip — but it IS re-run on **regeneration** (the generator rebuilds
  `segmentSuggestions` from a fresh fold).
- **`bucketPlacesIntoCorridor` is per-day and coords-based, never cross-day**
  (`src/lib/corridor/bucket.ts:40-79`): it projects each pool place's coords onto
  *this day's* line and buckets to the nearest node; a place >`bufferMi` off the
  route fails gate 1 and falls to **"Along the way"** (off-corridor), it is never
  reassigned to another day.

**Implication.** Day membership is a *geometrically-derived* property, not a durable
user-authored one — unlike `placeOverrides`/`placeRanks`, which `carryUserAuthored`
preserves across regeneration (§5). A manual cross-day move done by mutating the
`segmentSuggestions` arrays therefore **sticks on normal serves but is lost on
regeneration**. Making manual day-assignment authoritative *and* durable requires a
**new overlay** (e.g. `dayAssignment[placeId] → day`) checked at pool-assembly
(`resolve-corridor-cities.ts:181-191`) before per-day bucketing — blocked on a
durable day identity, since `Day.id` is positional `day-N` (§3), not a
geometry-stable key like `nodeId`. Scoped in
`docs/decisions/2026-07-24-cross-day-stop-movement.md`.

---

## 3. nodeIds — name/coords-based, NOT `day-${index}`

- A node's id is a **name slug**: gazetteer node `slugify(\`${city.name} ${city.admin}\`)`
  (`src/lib/corridor/derive.ts:259`); start/end `slugify(start.name)` / `slugify(end.name)`
  (`src/lib/corridor/derive.ts:273, 282`); `slugify` is a plain name→kebab transform
  (`src/lib/corridor/derive.ts:90`).
- A **seed** mints its id once and carries it verbatim across derivations
  (`src/lib/trips/types.ts:101-105`); it re-projects onto a day by COORDS each
  derivation (`:108-111`).
- **Why it matters.** Overlays key on node slugs, which are stable to *geometry* (the
  town's name), not to *position*. A day insert / remove / reorder renumbers `Day.id`
  (`day-N`, §1) but does not change a node's slug, so overlays survive re-derivation
  (§5). This is the single fact most likely to be mis-assumed: overlays are **not**
  keyed on `dayIndex`.
- **Caveat — cross-day slug collision.** A town revisited across days yields the same
  slug on multiple days (`src/lib/trips/resolve-corridor-cities.ts:151-159` handles a
  thrice-visited destination). A raw name-slug override can't distinguish those days;
  promoted seeds disambiguate by coords→day projection.

---

## 4. Scroll / map layer (built) · windowing (NOT built)

> The **rail scroll** (all day cards) and the **one shared map** ARE built and
> working — leave them alone unless you're deliberately reworking them. As of
> **2026-07-25 the day-detail center IS a continuous windowed scroll in VIEW mode**
> (Design A): `ContinuousDayStack` (`src/components/trip/continuous-day-stack.tsx`)
> IntersectionObserver-windows the near-viewport days over the day-detail center,
> writes `?day=` settle-debounced, and the one shared map follows the
> scroll-centered day on settle — built from scratch with IO + ResizeObserver (no
> `react-window`/`react-virtual`). **`editMode` still uses the single-day
> conditional swap** (`day-detail-corridor-column.tsx`) — the bridge, deleted once
> edit mode moves inside the windowed container (PR2). The scroll is a
> **presentation layer only**: the day-partitioned model is untouched. Why +
> mechanics: `docs/decisions/2026-07-25-continuous-day-detail-scroll.md`.

- **Rail — `DayColumnPlanner`** (`src/components/trip/day-column-planner.tsx:52`): a
  single `<nav … overflow-y-auto>` holding ALL day cards mounted at once
  (`:277-285`; edit-mode dnd-kit sortable at `:260-268`). Cards are 112px tall
  (`:454`), the rail 183/229px wide (view/edit, `:185-186`).
- **Detail — `DayDetailCorridorColumn`** (`src/components/trip/day-detail-corridor-column.tsx`)
  now branches three ways: **Overview** (`selectedDayId === null`) → `DayDetailOverview`;
  **edit mode** (a day selected, `editMode`) → the verbatim single-day
  `DayDetailCorridor` swap (the bridge); **view mode** (a day selected, `!editMode`)
  → `ContinuousDayStack` mounting one `DayDetailCorridor` per near-viewport day via
  the shared per-day render helper (`renderViewDay`). The edit spine is
  `DayDetailNodeBlocks` (`src/components/trip/day-detail-node-blocks.tsx:137`). The
  per-day hero is a static IMAGE, not a map.
- **Map — one shared instance.** A single `new mapboxgl.Map`
  (`src/components/trip/map-column.tsx:395`), one `<MapColumn>` mounted
  (`src/components/trip/trip-slideup-body.tsx:233`), full-canvas behind the translucent
  overlays. It reads `?day=` → `activeDay` (`src/components/trip/map-column.tsx:327,
  360-362`) → `flyTo` (`:746`). N days on screen would still be ONE map — there is no
  per-day map.
- **Selection ↔ scroll.** Selection is URL state: `selectDay` writes `?day=` via
  `replaceState` (`src/components/trip/trip-slideup-body.tsx:158-163`); `selectedDayId`
  is derived from `useSearchParams` every render (`:152-157`). The detail swap and the
  map both read it. Scroll-spy (Overview only) is a **passive `scroll` listener, NOT an
  IntersectionObserver** (`src/components/trip/day-detail-corridor-column.tsx:343-373`;
  the comment at `:346` explains why IO's "topmost intersecting" was rejected).
- **Two SEPARATE `DndContext`s.** Rail reorder
  (`src/components/trip/day-column-planner.tsx:253`) and detail repin
  (`src/components/trip/day-detail-node-blocks.tsx:407`) are isolated — not a shared
  context. Unifying them re-enters the auto-scroll / `delta`-absorbs-scroll hazard
  documented at `src/components/trip/day-detail-node-blocks.tsx:88-100`.

---

## 5. Regeneration & overlay survival

- **`generateItinerary(input, facts, regenFeedback?)`** (`src/lib/itinerary/generate.ts:51`)
  is a pure grounded LLM pass returning `ItineraryOutput`. It does **not** carry
  overlays.
- **Overlay survival is a separate wrapper: `carryUserAuthored(prev, regenerated)`**
  (`src/lib/trips/carry-forward.ts:16-26`) — copies `nodeSeeds` / `placeOverrides` /
  `placeRanks` wholesale from the previous trip onto the regenerated one. The
  regeneration persist path MUST route through it; the contract is locked by
  `assertUserAuthoredCarried` (`src/lib/trips/carry-forward.ts:28+`) +
  `carry-forward.test.ts`.
- **Fresh nodeId resolution.** Every derivation rebuilds node slugs from the new
  geometry (`deriveCorridorCities`), then re-applies overlays scoped to whatever node
  now matches (`scopeRankKey` `src/lib/corridor/stretches.ts:110-123`;
  `applyPlaceOverrides` `src/lib/corridor/bucket.ts:91-124`). A carried overlay whose
  place re-buckets to a different node reads **inert** (scope mismatch → treated
  unranked / dangling override ignored), never a crash — which is why carry needs no
  reconciliation pass (`src/lib/trips/carry-forward.ts:21-24`).
- **Partial re-plan / the freeze — the cleave model.** Completed days are frozen
  (history can't change); the re-plannable range is `[resumeIdx … end]`.
  `isEditInFuture` rejects a past edit (`src/lib/itinerary/partial-replan.ts:252-267`);
  `stitchDays` joins the frozen prefix verbatim with the renumbered replanned tail
  (`src/lib/itinerary/partial-replan.ts:278-284`).
- **`rescopeOverlays`** (`src/lib/corridor/rescope-overlays.ts`, PR #130, merged) — the
  pure step that DROPS overlays orphaned by a **day-structure change** (cross-day move,
  add/remove-day), where geometry re-derivation alone isn't enough: a stop whose day
  changed must lose an overlay pinning it to a node its new day doesn't host (the
  cross-day pull-in guard). It keeps survivors unchanged (never rewrites nodeIds); pure,
  keyed on the new day layout only. **WIRED** (corrected 2026-07-24 — an earlier draft
  said "not yet wired"): its first shipped consumer is the curated-POI cross-day move
  `moveCuratedPlace` (`src/lib/trips/curated-place.ts:46`, PR #131), which splices a
  `segmentSuggestions` entry between days then calls `rescopeOverlays` to drop the moved
  stop's now-orphaned pin/rank. (A future durable `dayAssignment` overlay and the
  routed-waypoint `moveWaypointToDay` are separate, not-yet-built consumers — see the
  decision doc.)

---

## 6. Persistence — the guarded single-write model

- User trips (UUID id) live in `public.trips.payload` (jsonb), RLS-scoped; slug trips
  are in-memory fixtures / `reference_trips` (`src/lib/trips/repository.ts:80-87`).
- **Every user-trip mutation goes through `updateUserTripPayload(id, mutate, {onConflict})`**
  (`src/lib/trips/user-trips.ts:228-284`): optimistic-CAS — read `(payload, version)` →
  run `mutate(view)` → `UPDATE … WHERE version = v` (`:266-271`). Zero rows updated
  means the version moved under us; the policy decides: `retry` re-reads fresh and
  re-runs the whole `mutate` (`:278`), `refuse` returns `TRIP_CONFLICT`, `abandon`
  returns the fresh view unwritten (`:276-277`).
- **The mutate closure is the atomic unit** — everything it does lands in one write or
  not at all, and a concurrent edit forces a full re-run on the fresh snapshot. Any new
  mutation MUST be shaped as a closure that recomputes derived state *inside* it so a
  retry composes.
- **Two collapse patterns:**
  - **STEP 3 (geometry):** precompute the Mapbox recompute OUTSIDE the write
    (`deriveAfterDayEdit` → `recomputeDay`, `src/lib/trips/repository.ts:40-59`,
    `src/lib/trips/recompute-day.ts:48-86`), apply the precomputed `DayDerived` INSIDE
    the closure (`applyDerivedToDay`, `src/lib/trips/repository.ts:65-70`) and clear
    `routePolyline`. Used by `addWaypoint` / `removeWaypoint`
    (`src/lib/trips/repository.ts:201-303`), `onConflict: "retry"`.
  - **STEP 4 (pure overlay):** recompute the spine INSIDE the closure
    (`writeEdit` → `resolveCorridorCities(applyOverlay(...))`,
    `src/lib/itinerary/node-actions.ts:145-178`), `onConflict: "retry"`. Used by
    pin / unpin / rank (`src/lib/itinerary/node-actions.ts:211-338`).
- **`retry` requires by-id operations** (splice/push by id, not by index) so they
  compose; index-based position writes are `refuse`-class and were removed (see the
  `reorderWaypoints` note in `docs/BACKLOG.md`).

---

## 7. The payload shapes (fixture-degraded · reference-derived · regenerated · corpus-dense fork)

A trip's day payload arrives in one of several shapes. This matters to the
scroll/windowing layer (§4): each shape renders different per-day content, so a
degraded fixture is not a representative test instrument for dense days.

**This section is the single home for trip shapes** — other docs link here
rather than restating them.

- **Fixture-degraded** — no `corridorCities`, no `segmentSuggestions`; renders the
  two-node fallback (§1). Exercised by **`la-to-portland`**. `[grep fixtures.ts: corridorCities count 0, 2026-07-25]`
- **Reference-derived (baked)** — a persisted `reference_trips` payload carrying
  `corridorCities` (baked at seed time; see §2d). Exercised by the
  **`la-to-deadhorse` family**. `[script: web/scripts/prove-la-to-deadhorse-neutral.ts, 2026-07-25]`
- **Regenerated** — `segmentSuggestions` populated up to
  `MAX_SEGMENT_SUGGESTIONS = 30` per day (§2d fold). `[grep: web/src/lib/routing/day-suggestions.ts]`
  **Which specific test trip exercises the 30-cap rung was NOT confirmed** `[UNVERIFIED]`
  — a regenerated trip was never inspected. (The 66-day user fork is the likely
  instrument but was not inspected.)
- **Corpus-dense fork (PROD) — a DISTINCT profile, not one of the rungs above.**
  Recorded rather than filed under the nearest rung. Exercised by PROD
  `public.trips` row **`24f14ecc-a209-45e7-a414-16ecc816bab0`** ("Tok, AK to
  Dawson, YT"): **63 `mp:` corpus tiles across just 2 days**, `generated`
  **unset**, `routePolyline` present, 2 `corridorCities` per day, and the title
  is **STORED** (both the `trips.title` column and `payload.startLocation` /
  `endLocation`) — *not* derived at render. Dense because PROD carries the real
  corridor corpus, where the equivalent TEST fork carries none.
  `[queried PROD, 2026-07-26]` The exact write path that produced it was not
  traced `[UNVERIFIED]`. What its tiles contain, and how the day-detail card
  renders them, is documented in
  [`place-render-model.md`](place-render-model.md).

How a trip is *served* into one of these shapes (which reader, read-time
derivation, baked-vs-unbaked short-circuit):
[`docs/architecture/trip-resolution.md`](trip-resolution.md).

---

## Related

- `docs/architecture/trip-resolution.md` — how `getTrip` resolves and serves a
  trip (reader split, read-time derivation, caching).
- `docs/decisions/` — why calls were made (append-only). In particular
  `docs/decisions/2026-07-24-cross-day-stop-movement.md` for the in-flight cross-day
  move / add-day feature and its open questions.
- `docs/DATA_INVENTORY.md` — what data exists where (PROD / TEST / Typesense).
- `web/CLAUDE.md`, `web/AGENTS.md` — web conventions, the slideup build-and-verify rule.
