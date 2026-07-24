# Itinerary model — how a trip is built

How the trip/itinerary data model is actually assembled in the web client, traced
to the code. Written from the code as it is, not as it should be. Paths are under
`web/src/`. Where something is in flux or only partly wired, it says so.

**Status note.** The core shape (`Trip`/`Day`/`Waypoint`, corridor spine,
overlays) is on `main`. The curated-POI *move/remove* mechanism
(`lib/trips/curated-place.ts`) and its kebab UI are in flight on
`feat/curated-poi-kebab` (PR #131), not yet merged. The generation pipeline
(`lib/itinerary/*`) exists and runs behind API-key/flag gates; the partial-replan
functions are a pure core with the paid re-run/confirm/stitch wired on top
"later" per their own header. Those gaps are called out inline.

---

## 1. The persisted shape

Canonical types: `lib/trips/types.ts`. Persistence is a single jsonb column,
`public.trips.payload`, holding the whole `Trip` — normalized tables are an
explicit non-goal (`web/CLAUDE.md` → Data model).

**`Trip`** (`types.ts` `Trip`): `id`, `title`, `days: Day[]`, `startCoords`
(`[lng,lat]` of the origin — each day's `coords` is the day's *end*, so without
this the route line would start at Day 1's destination), a pre-baked
`routePolyline` (Google polyline; set to `undefined` after a mutation to force a
live re-fetch), and flags: `generated?` (produced by the itinerary generator),
`referenceId?` (slug-as-FK to `reference_trips`, or null for wizard-from-scratch
trips). Two loosely-typed `Record<string, unknown>` escape hatches avoid circular
imports: `wizard?` (shape follows `WizardSlices` in `lib/plan/types.ts`) and
`generationInput?` (shape follows `GenerationInput` in `lib/itinerary/facts.ts`) —
the latter is persisted so a generated trip is re-editable (the living-plan loop
edits those anchors and re-runs the pipeline).

**`Day`** (`types.ts` `Day`): `id`, `dayNumber`, `date`, `label`
(`"Start — End"`), and two distinct coordinates that must not be derived from each
other: `coords` is the **end** of the day (overnight), `startCoord` is the
**start**; the map flies to `startCoord` when the day becomes active. A day carries
four place-bearing collections that are the crux of the model:

- `waypoints: Waypoint[]` — routed stops (see §2).
- `segmentSuggestions?: BrowsePlace[]` — the flat pool of places discovered along
  the day's segment (curated POIs; see §2). Type is `BrowsePlace`
  (`lib/trip-browse/places.ts`).
- `suggestions?: Partial<Record<SlideCategoryKey, BrowsePlace>>` — one pre-resolved
  top photo-bearing place per browse category, picked from `segmentSuggestions`.
- `corridorCities?: CorridorCity[]` — the day's ordered node spine (see §3).

**`Waypoint`** (`types.ts` `Waypoint`): `id`, `slug`, `category`, `title`,
`subtitle`, `description`, `stats[]`, plus a large block of **optional**
detail-panel fields (`photoUrl`, `coords`, `tags`, `reliability`, `routeOffsetMi`,
`simulator`, `factualNote`, `logistics`, `community`, `amenities`, `dataSources`,
`bookingStatus`). The comment on `simulator` states the intent that governs the
whole block: "absent = hidden, never fabricated" (`types.ts`, `Waypoint.simulator`
docstring). Whether that intent actually holds is §6.

**`CorridorCity`** (`types.ts` `CorridorCity`): one node in a day's spine — `id`
(a stable **name slug**), `name`, `kind` (`start | corridor | end`), `coords`,
`milesFromStart` (**along-route** cumulative miles, not straight-line, not the
perpendicular `Waypoint.routeOffsetMi`), and `placeIds: string[]` — ids clustered
under this node, **by reference**: they point at `BrowsePlace.id`
(`segmentSuggestions`) and/or `Waypoint.id` (`waypoints`), resolved against the
day's pool at render.

---

## 2. Two kinds of stop: curated POI vs trip waypoint

This is the distinction the rest of the model turns on.

- A **trip waypoint** is a `Day.waypoints` entry (`Waypoint`). It is **routed**:
  `recomputeDay` reroutes a day `start → waypoints (in order) → end`
  (`lib/trips/recompute-day.ts`, header + the `orderedWaypoints`/`routeBetween`
  block). Adding, removing, or reordering a waypoint changes the drive geometry.

- A **curated POI** is a `Day.segmentSuggestions` entry (`BrowsePlace`). It is an
  **overlay**: routing runs only over waypoints, so moving or removing a curated
  POI changes **no** drive geometry. This is stated verbatim at the top of
  `lib/trips/curated-place.ts` and is why `moveCuratedPlace`/`removeCuratedPlace`
  do a plain array splice with no Mapbox call.

**Generated trips start with zero waypoints.** `toTrip`/the generated-day builder
sets `waypoints: []` and puts every discovered place in `segmentSuggestions`
(`lib/itinerary/to-trip.ts`, the Day literal — `waypoints: []`,
`segmentSuggestions: baked ? … : facts.poolPOIs.map(…)`). So on a fresh generated
trip, **all stops are curated POIs**; there is nothing routed beyond
start→end.

**A place can be BOTH, by shared id.** When a user "Add to day"s a browse result,
`addedPlaceToWaypoint` mints a `Waypoint` with the **same id** as the source place
(`lib/trips/added-place.ts`), and the suggestion may remain in
`segmentSuggestions`. `recomputeDay` dedups the bucketing pool by id precisely
because "adding a suggested place mints a waypoint with the SAME id while the
suggestion stays in segmentSuggestions" (`recompute-day.ts`, the dedup-by-id pool
loop). So id-equality — not object identity — is how the two collections relate.
(Note: `addedPlaceToWaypoint` pins `category: "scenic"` regardless of the source
slot — a known simplification, commented in that file.)

**In-flight:** `curated-place.ts` (`moveCuratedPlace`, `removeCuratedPlace`) is the
pure core for cross-day move/delete of a curated POI. It splices
`segmentSuggestions` between days and then calls `rescopeOverlays` (§3) to drop the
moved stop's now-orphaned overlays; it does **not** re-bake `corridorCities` (the
repository wrapper does that inside the guarded write). This file and its kebab UI
live on PR #131; they are not on `main`. `curated-place.ts` cites this document
(`§3`) for node-identity invariance.

---

## 3. The corridor spine, node identity, and overlays

**Node ids are names, not indices.** `deriveCorridorCities`
(`lib/corridor/derive.ts`) mints each `CorridorCity.id` as `slugify(name + admin)`
(e.g. `los-angeles-ca`), or copies a `NodeSeed`'s minted-once id verbatim. Because
identity is name/coords-derived, a day insert/remove/reorder does **not** invalidate
a node by index — the geometry re-resolves node positions itself
(`rescope-overlays.ts` header, "WHY DROP, NOT REWRITE").

**A place is a node or a card, never both.** `isNodeIdentical`
(`lib/corridor/node-identity.ts`) strips a place that *is* a node (same id, or same
normalized name **and** coords within `NODE_COINCIDENCE_MI = 2` mi) from both the
bucketing pool and the served/persisted `segmentSuggestions`. Applied at the two
resolver chokepoints, `resolveCorridorCities` (serve) and `bakeGeneratedDays`
(persist). The name requirement is the safety guarantee: the failure mode is
"renders twice" (visible), never "the wrong place silently disappears."

**Three user overlays, all trip-level and placeId-keyed** (`types.ts`):

- `nodeSeeds?: NodeSeed[]` — user-authored corridor nodes. A seed feeds
  `deriveCorridorCities` **only**, never `routeBetween`, so pinning a node names a
  place on the route **without detouring to it** (`types.ts`, `Trip.nodeSeeds`
  docstring). `origin: "manual" | "promoted"` governs GC (a promoted seed exists
  only to host a pin and is collected when no override references it).
- `placeOverrides?: PlaceNodeOverride[]` — re-home a place under a specific node
  (`{ placeId, nodeId }`), overriding nearest-node bucketing. One home per place.
- `placeRanks?: Record<placeId, { nodeId, rank }>` — authored order among
  siblings, **scoped to a node**: the rank is read only when `nodeId` equals the
  place's current cluster node, so a rank that survives into a cluster that no
  longer holds the place is inert.

**`rescopeOverlays` is the keep/drop core across a day-structure change**
(`lib/corridor/rescope-overlays.ts`). The home-day rule: an overlay
`{ placeId, nodeId }` survives **iff some day that holds `placeId` also contains
`nodeId`**. A node with the same id on a *different* day does not count — honoring
it is exactly the cross-day "pull-in from nowhere" bug
(`bucket.ts` `applyPlaceOverrides`). It drops orphans and **never rewrites a
nodeId**; an unchanged layout returns the same object referentially. It was landed
as a pure primitive (function + 8 tests, no wiring) in PR #130; `curated-place.ts`
is its first consumer.

---

## 4. How a plan is generated

Pipeline lives in `lib/itinerary/`. The shape is: input → precomputed facts → one
grounded LLM pass → deterministic audit → mapped onto `Trip`.

1. **Input & facts.** `GenerationInput` (anchors + params + rig + objective, in
   `facts.ts`) is precomputed into `EngineFacts` (geocoding, the fed corpus pool,
   fuel model, etc.). The fact-precompute path runs even without the Anthropic SDK
   installed (`generate.ts` header).

2. **One grounded pass.** `generateItinerary` (`lib/itinerary/generate.ts`) makes a
   single streaming call — system prompt = the adapted Master Prompt, user turn =
   the engine facts — constrained by `ITINERARY_OUTPUT_SCHEMA` (`schema.ts`).
   `MODEL = "claude-opus-4-8"`. The contract (`schema.ts` header): **the LLM
   reasons but never originates facts.** `keyStops[].name` and `overnight.name` are
   plain place **names** (never model-authored ids — nothing to fabricate);
   `distanceMi`/`driveHours` are the model's **stated** values, audited before
   display. The strict itinerary grammar is near a "grammar ceiling"
   (`interpret.ts` notes its own tiny schema is "nowhere near the itinerary grammar
   ceiling").

3. **Stage-2 audit — the grounding gate** (`lib/itinerary/audit.ts` header). The
   LLM proposes; the fact layer disposes, in three tiers:
   - **Tier 1 (silently correct):** re-measure each day's leg with `routeBetween`
     and snap `distanceMi`/`driveHours` to the measurement; recompute fuel gaps.
   - **Tier 2 (flag/drop):** any `keyStop`/`overnight` not in the fed corpus pool
     is **dropped** and the day flagged (a fabricated stop can strand someone; a
     missing one is safe). Seasonal claims → advisory-tagged.
   - **Tier 3 (structural):** a leg over the max-daily-drive cap, or a fixed anchor
     off its date, is returned for **bounded regeneration** (the caller loops).

   The **audited** itinerary — corrected distances, fabricated POIs removed,
   per-day confidence + flags — is what gets stored and shown, never the raw LLM
   output. Confidence is one of `measured | corpus-backed | google-resolved |
   advisory` (`schema.ts` `FactConfidence`); a tier-2 name that resolves live to a
   real Google `place_id` whose coords sit on the day's route is `google-resolved`
   (`schema.ts` `ResolvedPlace`, `resolve.ts`).

4. **Map onto `Trip`.** `toTrip` (`lib/itinerary/to-trip.ts`) turns each audited
   `DayPlan` into a `Day`: `label = "start — end"`, `waypoints: []`,
   `corridorCities` + `segmentSuggestions` from `bakeGeneratedDays` (`bake.ts`),
   falling back to the whole unbucketed pool only when the bake is absent (the
   degraded two-node view).

---

## 5. Partial re-plan (a trip in progress)

`lib/itinerary/partial-replan.ts`. Cleave the trip at "now" into a **frozen
completed prefix** and a **re-plannable tail**, then derive the tail's input so the
same pipeline regenerates only the remaining days. The functions are **pure** (no
I/O, LLM, or DB); the header states the paid tail re-run, confirm step, and stitch
are "wired on top later" — so this is a pure core, not a fully-wired feature.

- **Position and date are independent** (`NowSpec`). `atDay`/`atPlace` (or, absent
  both, `today`) select the resume **position**; `today` is always the real resume
  **date** and is **never** derived from the plan (being ahead of schedule is as
  normal as being behind). `cleaveTrip` freezes `days[0 … resumeIdx-1]` verbatim
  with their original dates; the resume day is re-plannable.
- **The cleave is the trip's default state, not a per-utterance opt-in.** After a
  partial re-plan applies, a `CompletedThrough` marker is stored on
  `generationInput.completedThrough`; `resolveEffectiveNow` makes it the default
  position for every later edit (explicit `atDay`/`atPlace` still wins), so a
  position-less edit never regenerates driven days.
- **Tail input.** `buildTailInput` prepends a synthetic `start` anchor (last
  completed day's end, dated to the real resume date) to the anchors still ahead
  (`anchorAhead` uses a plan-time-vs-plan-time comparison so an ahead-of-schedule
  just-passed stop isn't resurrected), sets `params.startDate = resumeDate`, and
  leaves `endDate` unchanged (the fixed end still binds).
- **Stitch.** `stitchDays` concatenates the frozen prefix with the renumbered tail;
  `stitchPolyline` truncates the stored geometry at the resume point and grafts the
  recalculated tail — a "recalculate" scoped to what's ahead.
- **MVP boundaries stated in the code:** cleave only at day boundaries (no
  mid-dwell split); a flexible/undated anchor already physically passed can't be
  detected from the day table alone (intermediate days carry no coords), so the
  action layer refines that later with route geometry.

---

## 6. Living-plan edits: one interpreter, N executors

`lib/itinerary/interpret.ts`. Free-text edits go through **one** Sonnet call
(`MODEL = "claude-sonnet-5"`) that returns a discriminated intent — an `edit`
(with params + position/now hints), a single `clarify` question, or `unsupported`.
The `EditType`s are `arrive-by | add-stop | reschedule | skip | stay-longer |
change-end`; the header frames the design as "ONE interpreter → N executors, not a
router above N parsers." Parse-only: no generation, no grounding, no spend beyond
the one small call. NL editing is behind its own dark flag `NEXT_PUBLIC_NL_EDIT`
(unset = off in prod — see `docs/STATE.md`), split from the manual-edit flag.

**Node-model writes** (`lib/itinerary/node-actions.ts`) — create a node seed, pin a
POI to a node (with seed promotion), reorder, and their removals — dispatch on
`isUserTripId(tripId)`: UUID user trips write `public.trips` through
`updateUserTripPayload` (the SSR/RLS optimistic-concurrency envelope, re-running the
pure edit against fresh payload each attempt and re-baking `corridorCities`); slug
reference trips write `reference_trips` via the service client. **Payload shape
diverges by table by design** — UUID rows carry baked `corridorCities`, slug rows
carry them stripped — because the two serve paths differ; the header says not to
"fix" one to match the other.

---

## 7. The grounding invariant — where it holds and where it doesn't

The standing rule (`CLAUDE.md` STANDING RULES): **"every field real or absent,
never invented."**

**Enforced:**

- **Generated trips** — the Stage-2 audit (§4) drops any POI not in the fed corpus
  pool before persist/render (`audit.ts` tier 2).
- **Browse/search detail panel** — `browsePlaceToWaypoint`
  (`lib/trip-browse/card-stats.ts`) projects a `BrowsePlace` onto a `Waypoint`
  carrying "only real, source-backed fields; everything unbacked is omitted"; data
  sources come from real provenance (`mention.secondary`), rating only when the
  source has one.
- **Discovery / federated rows** — `toBrowsePlace`
  (`lib/discovery/to-browse-place.ts`) carries rating/reviewCount/price only when a
  source provided them ("never fabricated"); `mapMasterPlaceRow`
  (`lib/trip-browse/federated.ts`) derives DATA SOURCES from `attribution`, absent →
  no section.

**Not enforced — a known, recorded exception:**

- **Trip-waypoint detail panel** — `enrichWaypoint` (`lib/trips/enrich.ts`) still
  **fabricates**. The same detail panel, opened from a trip waypoint rather than a
  browse card, is backfilled from category-canned constants and slug hashes: the
  reliability score is `75 + hash(slug…)` (not "computed from N sources"), and
  tags, factual prose, tips, entry cost, planned/with-stop ETAs, "Day N unaffected",
  and DATA SOURCES all come from `*_BY_CATEGORY` maps keyed by a slug hash. This
  path was deliberately left untouched by the browse/search honesty pass and is
  recorded as a carried backlog item (`docs/BACKLOG.md`; PR #129). So the invariant
  holds on the browse/search surface and on generated content, but **not** on the
  trip-waypoint enrichment path — that is the one live surface that violates it
  today.

---

## 8. Open / in-flux (as of this writing)

- **Curated-POI move/remove** (`curated-place.ts`, kebab UI) is unmerged (PR #131);
  v1 lands a moved stop **unranked + unpinned** on the new day (overlays drop, per
  `rescopeOverlays`).
- **Partial re-plan** is a pure core; the paid tail re-run / confirm / stitch are
  wired on top separately (`partial-replan.ts` header). Treat §5 as the model, not
  a shipped end-to-end flow.
- **`enrich.ts` honesty** — the §7 exception is open; the fork (strip vs rebuild on
  real routing) is recorded in `docs/BACKLOG.md`, not decided.
- **`addedPlaceToWaypoint` category** is hardcoded `"scenic"` (`added-place.ts`) —
  a known simplification, not a modeled decision.
