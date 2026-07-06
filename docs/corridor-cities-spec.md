# Corridor-Cities on `Day` — Data-Model Spec

**Scope:** web client data model (`web/src/lib/trips`) — one additive `Day` field + a finalize-time derivation step. No schema DDL (rides in `trips.payload` jsonb).
**Status:** Draft — **spec only**. No code, no type change, no schema, no migration in this document. §5-B (gazetteer source + prominence filter) resolved 2026-07-06.
**Owner:** Adam (ACW Creative)
**Consumes:** `Trip.routePolyline` (day slice), `Day.startCoord` / `Day.coords` / `Day.label`, the day's place pool (`Day.segmentSuggestions` + `Day.waypoints`).
**Feeds:** the v4 itinerary view — a day rendered as an ordered corridor of geographic city nodes, each anchoring a cluster of place tiles.
**Companion docs:**
- [`docs/phase-3-corridor-expansion-spec.md`](phase-3-corridor-expansion-spec.md) — corridor geometry (buffered route), `prominence_score`, the LA→Deadhorse corridor definition.
- [`docs/decisions/2026-05-21-offline-tile-caching-architecture.md`](decisions/2026-05-21-offline-tile-caching-architecture.md) — the offline-first, precompute-and-travel-with-the-trip philosophy this field follows.
- Recon (2026-07-01 session, `Diary/2026-07-01.md`) — confirmed none of this structure exists today.

> **Note on references.** The originating request named `docs/specs/corridor-ranking.md` and `docs/specs/geospatial-layers.md`. Neither exists in the repo (there is no `docs/specs/` directory). Where this spec would have cited "corridor-ranking," it instead cites the *actual* ranking artifact — `master_place.prominence_score` (Phase 1 `data/`, see phase-3 spec) — which is a **scalar prominence score, not an along-route distance.** That distinction is load-bearing for §2.4.

---

## 0. Mission

Give the v4 itinerary view a real backing shape for the "day = ordered corridor of cities" model:

> Day 1 · Start·Los Angeles (0 mi) → 40 mi → 65 mi·Ventura → 95 mi·Santa Barbara, with 2–3 place tiles clustered under each city.

Recon confirmed the data model exposes **none** of this: `Day` has a flat `waypoints: Waypoint[]` (added stops, category-typed — not geographic city anchors) and a flat `segmentSuggestions: BrowsePlace[]`, with **no** city nodes, **no** along-route cumulative mileage (only `Day.miles`, a day total; `Waypoint.routeOffsetMi` is perpendicular offset, not along-route position), and **no** place→city grouping key. This spec defines the `Day.corridorCities` structure and how it is computed **once, at finalize**, and persisted in `trips.payload`.

**Critical framing:** the leaf tiles already bind cleanly (`BrowsePlace` → `CategoryListCard`, details-only). What is new is the *spine* — ordered city nodes, along-route cumulative miles, and place→city clustering. This spec is about that spine.

**Out of scope:** the v4 component itself; wiring `CategoryListCard.onOpen`; the "Explore more [city]" / "Explore more of Day 01" actions (net-new, tracked in §5); any change to `prominence_score` or ranking.

---

## 1. The data shape — `Day.corridorCities`

### 1.1 The field

```ts
// web/src/lib/trips/types.ts — Day (ADDITIVE, optional)
corridorCities?: CorridorCity[];
```

```ts
export type CorridorCity = {
  /** Stable slug, e.g. "los-angeles-ca". Identity for placeId grouping,
   *  cross-day references, and city-scoped "Explore more" discovery. */
  id: string;
  /** Display label, e.g. "Los Angeles, CA". */
  name: string;
  /** Role of this node in the day's corridor. */
  kind: "start" | "corridor" | "end";
  /** `[lng, lat]` anchor — the node's point projected onto (or geocoded
   *  near) the day's route slice. Same [lng, lat] convention as everywhere. */
  coords: [number, number];
  /** ALONG-ROUTE cumulative distance from the day's START node, in miles.
   *  0 for the start node. See §2.2 — this is projected onto the route
   *  polyline, NOT straight-line and NOT Waypoint.routeOffsetMi. */
  milesFromStart: number;
  /** Ids of places clustered under this node, in display order. References
   *  BrowsePlace.id (from Day.segmentSuggestions) and/or Waypoint.id (from
   *  Day.waypoints). See §1.4 — reference, not nest. */
  placeIds: string[];
};
```

### 1.2 Field-by-field

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable slug. **Recommended over name-only** (§5-A): placeId grouping and the future city-scoped "Explore more [city]" need a stable key that survives a display-name edit; `name` is not safe as a key. Slug from `name` at derivation time. |
| `name` | `string` | Human display ("Ventura, CA"). |
| `kind` | `"start" \| "corridor" \| "end"` | Discriminates the day's origin (0 mi), intermediate pass-through cities, and the overnight/end city. Lets v4 style Start/End differently and lets bucketing rules special-case the ends. |
| `coords` | `[number, number]` | `[lng, lat]` anchor of the node on/near the route slice. |
| `milesFromStart` | `number` | Along-route cumulative miles from the start node (§2.2). Monotonically non-decreasing across the ordered array. |
| `placeIds` | `string[]` | Cluster membership by reference (§1.4). Empty array is valid (a city with no tiles). |

### 1.3 Start vs intermediate vs end

- **Start** (`kind:"start"`, `milesFromStart: 0`): the day's origin. `coords` = `Day.startCoord` (fallback `Trip.startCoords` for Day 1, else previous day's `coords`); `name` = first half of `Day.label`. Always exactly one, always first in the array.
- **Corridor** (`kind:"corridor"`): intermediate pass-through cities (Ventura, Santa Barbara), ordered by `milesFromStart`. Zero or more. Their *source* is **resolved** (§5-B): GeoNames populated places, filtered per §2.1.2.
- **End** (`kind:"end"`): the overnight/destination city. `coords` = `Day.coords`; `name` = second half of `Day.label`; `milesFromStart` ≈ the day's total along-route length (should reconcile with `Day.miles`, §2.2). **Recommended: yes, the end city is a node** (§5-C) so a place near the overnight has an anchor and v4 can render the terminal marker. Exactly one, always last.

### 1.4 `placeIds` reference, not nest

Places are **referenced by id**, not embedded under the node.

- **Why reference:** `Day.segmentSuggestions` / `Day.waypoints` remain the single source of truth for place bodies. Nesting would duplicate full `BrowsePlace` objects into `trips.payload`, bloating the jsonb (and the offline payload every client downloads) and creating a two-copy consistency hazard on any place edit.
- **Resolution rule:** a `placeId` resolves against the union of `Day.segmentSuggestions` (by `BrowsePlace.id`) and `Day.waypoints` (by `Waypoint.id`). Ids are already unique within a day. v4 looks up the body and feeds `CategoryListCard`.
- **Trade-off:** callers must join `placeIds` → place pool at render. Cheap (a `Map` over ≤ a few dozen places per day) and worth it for a lean, non-duplicated payload.

### 1.5 `trips.payload` jsonb contract fit

`CorridorCity` is pure JSON — strings, a number, a string-literal union (serializes as string), a `[number, number]` tuple (already the repo's coord convention), and a `string[]`. It nests under each `Day`, which already lives in `trips.payload` (the single jsonb column; normalized tables are an explicit non-goal per `web/CLAUDE.md`). It is **additive and optional**, so it is backward-compatible with the web↔iPad↔Supabase contract in `web/src/lib/trips/types.ts`: existing payloads without the field deserialize unchanged; the iPad mirrors the type from `types.ts` as usual. **No DDL** — adding it is a `types.ts` edit plus a data backfill (§4), not a schema migration.

---

## 2. The derivation algorithm (finalize-time)

Computed in the same finalize pass that builds `Day.suggestions` / `Day.segmentSuggestions` today — i.e. alongside [`buildDaySuggestions`](../web/src/lib/routing/day-suggestions.ts) operating on a [`DaySegment`](../web/src/lib/routing/segment-by-pace.ts) (which already carries the day's `coordinates: LngLat[]` polyline slice, `distanceM`, `startCoord`, `endCoord`).

### 2.1 City-node identification & ordering

Inputs: the day's route slice (`DaySegment.coordinates`, or the `Trip.routePolyline` sub-slice between `Day.startCoord` and `Day.coords`) and the day's place pool.

1. **Anchor the ends deterministically.** Start node from `Day.startCoord`/`Day.label`; end node from `Day.coords`/`Day.label`. These never depend on discovery.
2. **Identify intermediate cities — ✅ RESOLVED (§5-B): GeoNames gazetteer intersection.** Intermediate nodes come from a GeoNames populated-places gazetteer (§2.1.1) intersected against the day's route slice with the prominence filter in §2.1.2. The previously listed alternatives are **rejected**: route-step mining (`DaySegment.steps` locality names — uneven coverage/quality) and place-pool clustering (approximate names; empty stretches yield no node, which the adaptive fallback in §2.1.2 exists specifically to prevent).
3. **Order** all nodes (start + intermediates + end) by `milesFromStart` (§2.2), ascending. Assert monotonicity as a final invariant. (The `min_spacing_mi` rule in §2.1.2 already prevents near-collisions among intermediates; the < 3 mi de-dupe tolerance remains only as a guard between an intermediate and the start/end anchors.)

#### 2.1.1 Gazetteer source — GeoNames (resolved)

- **Dataset:** [GeoNames](https://www.geonames.org/) populated places. Free, CC-licensed, flat-file — no SDK, no API contract.
- **Base extract:** `cities5000` **recommended** — the balance point: small enough to bundle offline, granular enough that small towns on empty stretches are available for the adaptive fallback (§2.1.2 step 6). Flag `cities1000` as the escalation if the fallback needs finer granularity on very empty stretches. This extract choice is itself a decision — see §5-B.
- **Region filter:** trimmed to the operating region (North America / US + Canada) to keep the bundle small.
- **Fields consumed per row:** name, lat/lng, population, admin region. **Population drives the prominence filter** (§2.1.2).
- **Offline-bundled, NOT a runtime API.** The gazetteer is bundled into the app/DB; the intersection runs **once at finalize** and the result persists on the record (§3), read offline thereafter — the same pattern as the land_agency / coverage / bortle enrichments. Clients never query GeoNames.
- **Refresh cadence:** static dataset; refresh ~annually (cities don't move).

#### 2.1.2 Prominence filter — top-N with population floor, adaptive fallback, and spacing

Given a day's route polyline, produce the **ordered intermediate city nodes** between the fixed Start and End nodes (Start/End are always nodes per §5-C). All parameters are **tunable** — see §2.1.3.

1. **Buffer.** Candidates are gazetteer cities whose perpendicular projection onto the day's route polyline is within `buffer_mi` (~15 mi). Uses the shared `alongRouteMiles()` projection helper (§2.4 — still to be built): its `offsetMi` output is this gate; its `miles` output feeds step 2.
2. **Along-route order.** Order candidates by cumulative along-route distance from day start (`alongRouteMiles().miles`).
3. **Population floor (preferred, not hard).** Prefer cities with population ≥ `pop_floor` (10,000). A preference, not a gate — see step 6.
4. **Spacing.** No two nodes within `min_spacing_mi` (~50 route-miles) of each other; when candidates cluster, keep the higher-population one.
5. **Top-N.** Cap intermediate nodes at `max_nodes` (4) per day, selecting by population among spacing-valid candidates.
6. **Adaptive fallback (critical for empty overland stretches).** Guarantee at least one intermediate node per `max_gap_mi` (~150 route-miles): if no city clears `pop_floor` in a segment that long, **relax the floor** and take the most prominent (highest-population) available city — even a small town — so long empty stretches (remote NV, or AK on the LA→Deadhorse run) still get corridor anchors rather than a 300-mile gap with nothing. This is why the base extract must include sub-10k towns (§2.1.1).

#### 2.1.3 Tunable parameters

Every value below is a starting point, explicitly **TUNABLE** — to be adjusted against real routes once the derivation is running. None is load-bearing for the data shape (§1), so tuning is a derivation-only change.

| Parameter | Default | Meaning |
|---|---|---|
| `buffer_mi` | 15 | Max perpendicular offset from the route polyline for a gazetteer city to be a candidate. |
| `pop_floor` | 10,000 | Preferred minimum population — soft; relaxed by the adaptive fallback. |
| `min_spacing_mi` | 50 | Minimum along-route distance between nodes; higher population wins within a cluster. |
| `max_nodes` | 4 | Cap on intermediate nodes per day. |
| `max_gap_mi` | 150 | Longest along-route gap allowed without a node before the population floor relaxes. |

### 2.2 `milesFromStart` — along-route cumulative distance (MUST)

`milesFromStart` **must** be along-route cumulative distance projected onto the day's route polyline. **Not** straight-line (great-circle) distance between coords. **Not** `Waypoint.routeOffsetMi` (that is perpendicular distance *off* the route).

Exact method, per node:

1. Take the day's polyline slice `L` (`DaySegment.coordinates`, a `LngLat[]`).
2. Project the node's `coords` to the **nearest point on `L`** (`P`) — `@turf/nearest-point-on-line` (line-locate), giving the location of `P` along `L`.
3. `milesFromStart` = the length of `L` from its start vertex to `P` (`@turf/line-slice` start→`P`, then `@turf/length` in miles). This is the accumulated segment distance up to the projection.
4. Start node = 0 by definition. End node ≈ `@turf/length(L)` and **should reconcile with `Day.miles`** (both are the day's along-route length; if they differ materially, `Day.miles` is the display authority and the delta is logged, not silently reconciled).

Units: store miles (matches `Day.miles`, the v4 label, and `Waypoint.subtitle` mileage). Turf works in configurable units — request miles directly.

### 2.3 Place → node bucketing + edge cases

For each place in the pool, compute its own along-route position `placeMi` by the **same §2.2 projection** (project `place.coords` onto `L`). Then assign:

- **Primary rule — "last city passed" (upstream anchor):** attach the place to the node with the greatest `milesFromStart` that is still `≤ placeMi`. Intuition: as you drive, a place clusters under the city you most recently passed. This matches the v4 mental model ("cluster under each city").
- **Edge — place before the first intermediate / near start** (`placeMi` < first corridor node): attach to the **start** node.
- **Edge — equidistant / tie** between two candidate nodes: tie-break to the **upstream** (earlier, smaller-mile) node. Deterministic, no coin-flip.
- **Edge — far off-corridor:** compute the projection **offset** (perpendicular distance from `place.coords` to `P`). If offset > a cluster radius (recommend reusing the discovery **25-mi** segment radius, or a tighter value — §5-D), **exclude** the place from all nodes (it is not really "on" this corridor). Excluded places simply don't appear in v4's clustered view; they remain in `segmentSuggestions`.
- **Edge — past the end** (`placeMi` > end node mile): attach to the **end** node.
- **Ordering within a node:** by `placeMi` ascending (then by `prominence_score` desc as a stable tiebreak, if present).

### 2.4 Reconciliation with corridor ranking (CRITICAL)

The request requires `milesFromStart` to reconcile with "whatever along-route distance corridor-ranking already uses." **Finding: corridor ranking uses no along-route distance.**

- "Corridor ranking" in this codebase = **`master_place.prominence_score`**, a **scalar** prominence value computed in `data/` (Phase 1) and read by web via `search.ts` / `trip-browse/hydrate.ts` / `federated.ts`. It is a *ranking weight*, not a position along the route.
- The **only** project-onto-route math that exists is in [`web/src/lib/directions/current-step.ts`](../web/src/lib/directions/current-step.ts), and it is **nav-progress-specific** (where am I along the active route, for turn-by-turn), not a reusable corridor-position helper.
- Therefore: **there is nothing in ranking to align to, and no shared helper to reuse.** This spec's decision (§5-E): **create one shared along-route helper** — e.g. `web/src/lib/routing/along-route.ts` exporting `alongRouteMiles(line: LngLat[], point: LngLat): { miles: number; offsetMi: number }` — and have **all** its consumers sit on it: the §2.1.2 gazetteer filter (buffer gate via `offsetMi`, candidate ordering via `miles`), the §2.2 `milesFromStart` computation, the §2.3 place bucketing, and any *future* ranking/position need. Do **not** duplicate the projection math, and do **not** fork a second definition from `current-step.ts`. If `current-step.ts` can be refactored to sit on the shared helper, prefer that; if not, leave nav alone and build the helper fresh for the corridor domain.

---

## 3. Where it's computed & persisted

**Precompute-at-finalize, persist-in-payload, read offline-first — never derived client-side at render.** Same philosophy as the enrichments the request cited (land_agency / coverage / bortle-style precompute) and, in this codebase concretely, the same philosophy as `Day.suggestions` / `Day.segmentSuggestions` (built once at finalize by `buildDaySuggestions`) and `master_place` enrichment (`mvum_corridor`, `overlander_tags`, `prominence_score` computed at ingestion). Rationale: the web client targets a degraded offline read mode and the iPad targets real offline (see the [offline-tile-caching ADR](decisions/2026-05-21-offline-tile-caching-architecture.md)); render-time projection over a polyline per day would be wasted, non-deterministic across clients, and unavailable offline.

**Hook point:** the wizard-finalize path that already calls `buildDaySuggestions` per day (`web/src/lib/routing/day-suggestions.ts`, invoked from the finalize server action in `lib/plan/actions.ts`, mirroring `resolve-suggestions.ts` for reference trips). Add a sibling step — sketch: `buildCorridorCities(segment, placePool)` — that runs **after** the place pool for the day is known (it depends on the places, to bucket them), and writes its result into `Day.corridorCities` before the trip is persisted to `trips.payload`. Reference trips (`la-to-deadhorse`) get the same treatment via `resolve-suggestions.ts`.

Clients (web + iPad) then **read** `Day.corridorCities` straight from the trip payload. v4 does **no** geometry math.

---

## 4. Migration path

**Recommendation: optional field + client fallback now; backfill later.**

- **Optional (`corridorCities?`).** Additive and non-breaking. Existing trips (and any created before the finalize step ships) simply lack it.
- **Client fallback for absent data.** When `corridorCities` is undefined, v4 renders a **degraded two-node corridor** derived trivially from existing fields — Start (`Day.label` first half, 0 mi) and End (`Day.label` second half, `Day.miles`) — with all places under the start node (or a single flat list). This keeps old trips rendering *something* coherent without any client-side projection. It is explicitly a fallback, not the product.
- **Backfill (LATER — described here, not executed).** A one-time data backfill re-runs the §2 derivation over existing `trips.payload` rows and writes `corridorCities` into each `Day`.
  - **Nature:** this is a **jsonb data backfill** (`UPDATE public.trips SET payload = …`), **not** schema DDL. It needs the day route slice — so either it reads `Trip.routePolyline` from the payload, or (if a trip lacks a prebaked polyline) it is skipped and left to the fallback.
  - **Environment:** TEST project **`znldzjdatkogdktymtvi`** first. Validate there before any production consideration.
  - **Safety:** the standard Supabase three-gate pre-flight and `db:push-verify` discipline apply before any prod touch (see root `CLAUDE.md` → Migration workflow). ⚠ Caveat: the `db:push-verify` verifier covers **literal `INSERT … VALUES`** only — a payload `UPDATE` backfill is **uncovered** by it and needs its **own** row-level verification (spot-check that N days got N corridors, mileage monotonic, placeIds resolve). Do not rely on a green `db:push-verify` to prove a payload backfill.
  - **Idempotency:** re-running must overwrite, not append — key on `(tripId, dayId)`, recompute the full array.

---

## 5. Open questions / decisions for Adam

Every judgment call this spec makes, for your confirmation:

- **A. `id` vs name-only.** Spec adds a stable `id` (slug) alongside `name`. Rationale: placeId grouping + city-scoped "Explore more" need a key that survives a name edit. **Confirm** we want the `id`, or accept name-only (simpler, but fragile as a key).
- **B. Source of intermediate city nodes. ✅ RESOLVED (2026-07-06): GeoNames gazetteer intersection.** GeoNames populated places, offline-bundled, region-filtered to North America (US + Canada), intersected against the day route at finalize with the §2.1.2 prominence filter — top-N (`max_nodes` 4) with a soft population floor (`pop_floor` 10,000), `min_spacing_mi` 50, and an adaptive fallback (`max_gap_mi` 150) that relaxes the floor on empty stretches. All parameters tunable per §2.1.3. NOT a runtime API — precomputed at finalize, stored on the record, read offline (land_agency/coverage/bortle pattern). Refresh ~annually.
  - **Sub-decision — base extract:** `cities5000` **recommended** (small enough to bundle, granular enough for the adaptive fallback); escalate to `cities1000` only if the fallback proves too coarse on very empty stretches.
  - **New questions raised by this resolution:** (1) **Where the bundle lives** — a DB table (note: new top-level tables need sign-off per root `CLAUDE.md`) vs. a flat file consumed only by the finalize step. (2) **`max_nodes` vs `max_gap_mi` precedence** — on a very long day (≳ 750 route-miles), the ≤ 4-node cap and the ≥ 1-node-per-150-mi guarantee can conflict; decide which yields. (3) **Canadian admin labels** — confirm GeoNames admin-region codes render `name` as expected for Canada (e.g. "Whitehorse, YT").
- **C. Is the END city a node?** Spec says **yes** (`kind:"end"`, so overnight-adjacent places have an anchor and v4 renders a terminal marker). **Confirm**, or make the corridor start-and-intermediates only with the end implied by `Day.coords`.
- **D. Bucketing rule + off-corridor cutoff.** Spec picks **"last city passed" (upstream anchor)** with **upstream tie-break**, and **excludes** places whose projection offset exceeds a cluster radius (default: reuse the **25-mi** discovery radius). **Confirm** the rule and the radius (25 mi may be too loose for tight city clusters — a tighter 5–10 mi may read better).
- **E. Shared along-route helper.** Spec mandates a **new shared** `alongRouteMiles()` helper (§2.4) consumed by both this derivation and any future position-based ranking, because ranking today is a scalar `prominence_score` with **no** along-route definition to reuse, and `current-step.ts` is nav-specific. **Confirm** we create the shared helper (vs. inline the math here and refactor later).
- **F. Optional + fallback vs. backfill-first.** Spec recommends **optional field + client fallback now, backfill later**. **Confirm**, or require a backfill before v4 ships (no fallback path).
- **G. `milesFromStart` vs `Day.miles` authority.** Spec makes `Day.miles` the display authority and logs (not reconciles) a delta against the computed end-node mile. **Confirm** that precedence.
- **H. Reference vs nest for places.** Spec references `placeIds` into the existing pool (no nesting) to keep the payload lean. **Confirm** (nesting would simplify the render join at the cost of a fatter, duplicated payload).

---

## 6. Constraints

- **No new top-level table, no normalized schema.** Rides in `trips.payload` per the deliberate single-jsonb decision.
- **`types.ts` is the contract.** Any change lands in `web/src/lib/trips/types.ts` first; the iPad mirrors it.
- **`[lng, lat]` everywhere.** `coords` follows the repo convention; do not admit `[lat, lng]` from any geocoder without converting.
- **Precompute only.** No client-side projection at render (offline-first).
- **No prominence math client-side** (root `CLAUDE.md`) — `placeIds` ordering may *read* `prominence_score` as a tiebreak but must not recompute it.
- **Spec only.** This document changes nothing. Implementation is a separate, approved step.

---

## Cross-references

- Data model / contract: `web/src/lib/trips/types.ts` (`Trip`, `Day`, `Waypoint`), `web/src/lib/trip-browse/places.ts` (`BrowsePlace`, `SlideCategoryKey`).
- Finalize pipeline: `web/src/lib/routing/day-suggestions.ts` (`buildDaySuggestions`, `DaySuggestions`), `web/src/lib/routing/segment-by-pace.ts` (`DaySegment`), `web/src/lib/trips/resolve-suggestions.ts`.
- Existing projection math (nav): `web/src/lib/directions/current-step.ts`.
- Ranking artifact: `master_place.prominence_score` — [`docs/phase-3-corridor-expansion-spec.md`](phase-3-corridor-expansion-spec.md); read paths `web/src/lib/search.ts`, `web/src/lib/trip-browse/hydrate.ts`, `federated.ts`.
- Leaf render: `web/src/components/trip/category-list-card.tsx` (`CategoryListCard`, details-only).
- Precompute / offline-first philosophy: [`docs/decisions/2026-05-21-offline-tile-caching-architecture.md`](decisions/2026-05-21-offline-tile-caching-architecture.md).
- Gazetteer source: [GeoNames](https://www.geonames.org/) populated-places extracts (`cities5000` recommended, `cities1000` escalation) — §2.1.1, §5-B.
