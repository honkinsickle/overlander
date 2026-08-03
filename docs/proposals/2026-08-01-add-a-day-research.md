# Add-a-day — what it means to the model

**Point-in-time: 2026-08-01.** Read-only research pass. Nothing was written to
code or either database. No decision is made here — this establishes what exists
and what an insert would cost, so a decision can be made against evidence rather
than against a screen.

## Why this doc states its evidence

Same discipline as [`trip-resolution.md`](../architecture/trip-resolution.md):
every claim states how it was verified — `[read]` source, `[grep]`, `[git]` —
and anything inferred but not confirmed is `[UNVERIFIED]`. Gaps stay gaps.

---

## 1. What already exists

**There is no add-day write path.** Established by enumeration, not inference.

The only writes to a `days` array in `web/src` are two **removals**
`[read: repository.ts:185, :195]`.

| Layer | Day operations | Add? |
|---|---|---|
| `lib/trips/repository.ts` | `renameDay:149`, `removeDay:176`, `addWaypoint:212`, `removeWaypoint:255` | none |
| `lib/trips/actions.ts` | `renameDayAction:27`, `deleteDayAction:44` | none |
| API routes | `/api/trips/[id]` GET; waypoints GET; fork POST | none |

`[grep: addDay|insertDay|createDay|days.push|days.splice over web/src]` — no hits
beyond removal, `reorderDays` (permutes, never grows), and `stitchDays`
(renumbers a regenerated tail). No tRPC, no edge functions, nothing in `bin/`,
nothing across the 57 scripts.

Corroborated by `[read: docs/decisions/2026-07-24-cross-day-stop-movement.md:95-97, :134-136]`:
"**No `moveWaypointToDay`, no `addDay` write path**" and "**Add-a-day is not
UI-only** — no `repo.addDay`/action exists; the write path (insert day +
renumber + recompute) must be built. UI is designed (Paper `LC-0` '+ ADD DAY' /
'Insert Day Above/Below')."

### The one path that increases day count is not an insert

`addStopAction` with `mode: "add-days"` `[read: edit-actions.ts:660-736]`:

1. `applyAddStop` pushes the end anchor and `params.endDate` by N via `addDaysISO` `[read: edit.ts:413-420]`
2. `runGateStage` re-runs the whole pipeline: `preComputeFacts` → `generateAndAudit` → `bakeGeneratedDays` → `itineraryToTrip` `[read: edit-actions.ts:473-489]`
3. The entire regenerated payload is upserted `[read: edit-actions.ts:948-955]`

The `days` array is discarded and re-minted `[read: to-trip.ts:149]`. Regeneration,
not insertion; no day identity survives.

Triple-gated `[read: rails.ts:42-82]`: `NEXT_PUBLIC_NL_EDIT` unset everywhere
(`[read: STATE.md:57-60]` "**DO NOT set it**"), `checkNotFrozen` refuses
`dawson-vancouver-cassiar`, and a TEST-Supabase-ref-only phase guard. UI exists
behind the same flag `[read: replan-sheet.tsx:340-352]`.

### `dayAssignment` — settled vs open

**Zero code hits** `[grep: dayAssignment over web/src, data, supabase → 0]`. Docs only.

**Settled:**
1. A durable **overlay**, not an array splice; the #131 splice is under Rejected `[read: cross-day-stop-movement.md:205-210]`
2. Shape: sparse `Record<placeId, dayId>` on `Trip`, parallel to `placeRanks` `[read: :12, :165-166]`
3. **Authoritative over geography** `[read: :19-20, :157-158]`
4. Read at **pool assembly** (`resolve-corridor-cities.ts:181-191`), not at bucketing `[read: :169-171]`
5. Mileage honesty: a geographically-foreign assigned POI renders under "Along the way" with **no mile**, "honest, never a synthesized distance" `[read: :17-19]`
6. Gesture is a picker, not a drag `[read: :20]` — but see staleness note
7. **Two candidate keys killed.** Anchor-seed-uuid: seed ids are coord-deduped (`SEED_DEDUPE_MI=0.25`) so a revisited city collides, and `nodeSeeds` is empty on a fresh trip `[read: :214-226]`. End-city/coords anchor: ambiguous on revisit `[read: :227-231]`

**Open:**
1. **The day-key.** `[read: STATE.md:502]` "**`dayAssignment` — DESIGN OPEN, NOT built.**" `[read: STATE.md:525]` "decide the day-key, then build. Mint a per-day uuid vs accept regen orphan-drop."
2. Regen survival — "remains a separate open problem" `[read: STATE.md:504]`
3. `rescopeOverlays` extension: "On a positional key, reorder/insert requires **remap**, not just drop" `[read: cross-day-stop-movement.md:175-177]`
4. The add-to case (one place on two days) — "deferred, not forgotten" `[read: :44-47]`

> **Contradiction inside the decision doc.** Its "Chosen design" header `:12-13`
> claims the key **is** settled as a uuid. Its blocker section `:182-186` calls the
> same thing "**Recommended:**". `STATE.md:502` sides with OPEN, and so does the
> code: `Day.id` is still `string` `[read: types.ts:214-215]`, still minted
> `day-${n}` `[read: to-trip.ts:149, partial-replan.ts:283, alaska.ts:3691]`.
> **Treat the key as open.**

> **Staleness.** `[read: BACKLOG.md:493-499]` ranks that decision doc the most
> misleading stale doc in the repo — its "no windowing, Design A never built"
> claims were falsified the next day by #146. Its "single-day mount → therefore
> picker not drag" reasoning is obsolete. Everything in it re-verified against
> code this pass (no addDay, `rescopeOverlays` merged, `dayAssignment` absent,
> `Day.id` positional) still holds.

**No add-day entry in `BACKLOG.md`** `[grep over 1296 lines → zero matches]`.
`docs/proposals/` and `docs/specs/` each held one unrelated file before this one.

---

## 2. The three shapes — ranked, and a fourth that beats all of them

Geometry cost and identity cost are **independent axes**. The cheapest shape wins
on both and is not in the original three.

### Cheapest: append a **layover** (start == end)

A round-trip day contributes **nothing to `Trip.routePolyline`**. Measured: on
`expedition-ms28y793` the line runs 899 mi against 1,200 mi of `day.miles`, and
"the 301-mi shortfall is exactly the six round-trip days' 300"
`[read: itinerary-model.md:126-135]`. `concatDayRouteCoords` "skips days with no
`polyline` (layover/unroutable)" `[read: to-trip.ts:41-51]`.

Cost: **no polyline change, no routing call, no geocode.** `coords` and
`startCoord` both equal the previous day's `coords`; `miles`/`driveHours` = 0;
`corridorCities` needs no re-derive because round-trip days claim no mile by
design `[read: itinerary-model.md:118-124]`. Appended at the end, nothing
downstream renumbers.

Layovers are already first-class in the geometry layer. Nothing new is invented.

### Second: split an existing day **at an existing node**

**`Trip.routePolyline` does not change.** This is not adding geometry, it is
re-cutting the same line at one more boundary; the advancing-cursor slicer simply
receives one more day `[read: resolve-corridor-cities.ts:147-169]`.
`assembleRoutePolyline` never runs, which matters because it consumes `dayRoutes`,
which are transient (§4).

Constrain the split point to an existing `CorridorCity` and the boundary already
carries persisted `coords` and `milesFromStart`:

- `coords` / `startCoord`: already stored, **zero calls**
- `miles`: arithmetic on the existing slice; `alongRouteMiles` is shipped `[read: bake.ts:139-147]`
- `corridorCities`: `resolveCorridorCities` is pure and synchronous `[read: :67-235]`
- `segmentSuggestions`: existing tiles carry coords, partitionable in pure code

**One genuinely new decision remains: the overnight for the first half.** It has
no preimage. It is the only thing a split cannot derive.

Split still changes day count mid-array, so it inherits the full identity cost (§4).

### Third: append a travel day

New geometry plus `trip.endDate` / `endLocation` / `endCoords` changes, but
nothing downstream to renumber.

### Fourth: insert a travel day mid-trip

Everything above, **plus** the bridging problem, **plus** duplicate-id risk (§4),
**plus** silent corruption of the freeze marker (§5). Most expensive by a distance.

---

## 3. What a Day actually is

There is **no days table**. A Day is a JSON object inside one jsonb column:
`public.trips (… payload jsonb not null …)`
`[read: supabase/migrations/20260513000000_init_identity.sql:58-68]`.
`grep 'create table'` across all 40 migrations finds no `day`, `waypoint`,
`corridor_city`, or `segment_suggestion` object. The read is a bare cast, no zod:
`return data.payload as Trip` `[read: user-trips.ts:47]`.

20 fields `[read: types.ts:214-271]`. The six that matter for insert:

| Field | Level | Class | Free on insert? |
|---|---|---|---|
| `startCoord` | Day | BAKED, cheaply re-derivable | **Yes, pure.** `day.startCoord ?? (i===0 ? trip.startCoords : days[i-1].coords)` — already implemented twice `[read: resolve-corridor-cities.ts:143-145, recompute-day.ts:56-57]` |
| `corridorCities` | Day | BAKED, re-derivable | **Yes, conditionally.** `resolveCorridorCities` is pure `[read: :67-235]`. **Circular caveat:** the slice end-cap is bounded by `day.miles` `[read: :157-160]`, so a day with no `miles` widens to `line.length-1`; and it no-ops entirely without `routePolyline` `[read: :68]` |
| `coords` | Day | BAKED | **No — routing/geocode.** `resolveEndpoint` tries `facts.anchorsResolved`, else Google `places:searchText`, else Mapbox geocode `[read: audit.ts:289-314]`. Free only when the endpoint is an already-resolved anchor — **which is exactly the split-at-existing-node case** |
| `miles` / `driveHours` | Day | BAKED | **No — `routeBetween`** `[read: audit.ts:357-359]`. No haversine fallback exists |
| `routePolyline` | **Trip** | BAKED | **No.** `assembleRoutePolyline(dayRoutes)` `[read: to-trip.ts:55-60, :213]`. Escape hatch: waypoint mutations set it `undefined` `[read: repository.ts:236,254,289,304]` and the client pays live Mapbox Directions at render `[read: map-column.tsx:556-600]`. `splicePolylineCoords` also exists `[read: reorder-days.ts:190-199]` |
| `segmentSuggestions` | Day | BAKED | **No, two ways.** Corpus half = `supabase.rpc("pois_along_corridor")` `[read: bake-corridors.ts:105-124]`. Curated half (`curated` / `keyStopNote`) = **full generation pass** `[read: bake.ts:113-128]` |

**The reasoned layer has no persisted preimage.** `description` (LLM `rationale`),
`notes` (composed from overnight + logistics + obligations + audit flags
`[read: to-trip.ts:92-110]`), `overnight.{name,type,rationale}`, `weather`,
`label`, `keyStops`. For a day that never existed there is nothing to recompute
them from.

Two latent defects surfaced en route, recorded not fixed:

- `overnight.selected.detourMiles: 0` and `cost: ""` are **hardcoded literals** `[read: to-trip.ts:170-171]`. `detourMiles` renders as a measurement and is not one.
- `applyDerivedToDay` deliberately writes `corridorCities: undefined` when recompute succeeds but derivation fails `[read: repository.ts:65-70]`, so one waypoint add can silently drop a day to the 2-node fallback.

---

## 4. What breaks downstream

### Day identity is positional at mint, never re-derived, uniqueness unenforced

`Day.id` is `day-${n}`, 1-based `[read: itinerary-model.md:20-24]`, minted at
`to-trip.ts:149`, `partial-replan.ts:283`, `alaska.ts:3691`.

It is derived from position **at mint** and never re-derived on mutation, and
nothing validates uniqueness. `id`, `dayNumber`, and array index can all diverge:

- `reorderDays` **keeps `id` stable** while reassigning `dayNumber`/`date` by position `[read: reorder-days.ts:88, :103-106]`
- `removeDay` splices with **no renumbering of anything** `[read: repository.ts:176-197]` — delete day 4 of 10 and ids read `1,2,3,5…10` with a `dayNumber` hole

**Minting a new day as `day-4` at position 4 creates a duplicate id, and every
consequence is silent:**

| Holder | Outcome |
|---|---|
| `?day=` readers (5 sites) | **Silently wrong.** `.find`/`.some` return first match; existing links to old day 4 open the new day `[read: trip-slideup-body.tsx:154, map-column.tsx:359, day-sidebar.tsx:44]` |
| `/api/trip-browse/[tripId]/[dayId]` | **Silently wrong + poisoned cache.** Key `` `${tripId}|${dayId}|${categories}` `` with TTL+LRU `[read: route.ts:91-97, :184-190]` |
| repository mutations | **Silently wrong.** `removeDay` deletes the wrong day |
| `continuous-day-stack` | React dup-key; `slotEls.set(id, el)` overwrites, one day unobservable `[read: :109-119, :186]` |
| dnd-kit planner | `dayIds.indexOf` returns first index; dragging either moves the wrong one `[read: day-column-planner.tsx:146-147]` |

**With a fresh unique id most of that survives — but one failure is worse,
because it is invisible and safety-relevant.**

**`OfflinePhase.dayIds: string[]` is the only durable day-id foreign reference in
the product** `[read: types.ts:189-195, :77]`. An inserted day appears in **no**
phase; `offline-phase-geometry.ts:36` filters it out and the panel still shows the
phase ready `[read: offline-panel.tsx:649]`. There is no runtime coverage
assertion — the exhaustive check exists only in a dev script over freshly
*suggested* phases `[read: scripts/check-offline-phases.ts:47-59]`, never over
persisted ones.

**An offline user in the field gets a hole in map coverage behind a green UI.**

Worse and already live: **`offlinePhases` is dropped by regeneration.**
`carryUserAuthored` carries only `nodeSeeds`/`placeOverrides`/`placeRanks`
`[read: carry-forward.ts:16-26]`, `itineraryToTrip` never emits `offlinePhases`,
and `assertUserAuthoredCarried` does not guard it `[read: carry-forward.ts:36-40]`.
So the shipped regen-based "add a day" wipes offline phase definitions while
orphaned IndexedDB rows linger `[read: prime-status-db.ts:1-14]`. `[UNVERIFIED]`
whether any persist path merges the prior payload before write.

Also silently stale: `waypoint-card.tsx:50-51` recovers a day number by
**regex-parsing the waypoint subtitle**, `waypoint.subtitle?.match(/Day\s+(\d+)/)`.
Same pattern at `change-trip-composer.tsx:80`, `replan-sheet.tsx:98`.

**Overlays survive by design.** `placeOverrides` / `placeRanks` / `nodeSeeds` key
on name slugs, never `day-${index}` `[read: itinerary-model.md:195-207,
rescope-overlays.ts:6-12]` — called out there as "the single fact most likely to
be mis-assumed."

### Correction: why `bakeGeneratedDays` can't be re-run

A prior finding held that `bakeGeneratedDays` is un-re-runnable because `audited`
and `dayRoutes` are transient. **Transience confirmed, causation wrong.**

Transience: `[read: audit.ts:205-207]` "TRANSIENT… **Not persisted**",
`[read: audit.ts:220-222]`, no `dayRoutes` in any migration, and
`itineraryToTrip`'s Day literal has no `audit` key. Note the column is `jsonb` and
*permits* any key — transience is established by the **producer**, not the DDL.

But `bakeGeneratedDays` does **not** hard-require `dayRoutes`. Every use of `dr`
is guarded: `geocode()` for missing endpoints `[read: bake.ts:87-88]`,
`routeBetween()` for a missing line `[read: bake.ts:93-102]`. Pass `[]` and it
bakes, at the cost of N geocodes + N routing calls.

**The binding constraint is the first parameter, `audited: ItineraryOutput`.** The
bake keys on `day.audit?.resolvedPlaces`, `day.keyStops[].name/.note`, and
`day.startPlace/endPlace` `[read: bake.ts:81-82, :115, :122-127]`, none of which
have a reconstructible persisted form.

Partial mitigation, `[UNVERIFIED as a reconstruction path — no code does this]`:
`startPlace`/`endPlace` are recoverable from `day.label` (`"${start} — ${end}"`,
`to-trip.ts:152`) and `resolveCorridorCities` **already parses label halves**
`[read: :104-118]`; `resolvedPlaces` partially survive as `google:`-prefixed tiles
carrying `curated`/`keyStopNote`; two polyline slicers are shipped.

**Net: geometry is fully recomputable from persisted state. The reasoned layer is
not, for a day that never existed.**

---

## 5. The freeze model

### #146 is not what it is often cited as

**#146 is "Continuous day-detail scroll (Design A)"** `[git: e8c5d7f]`,
`[read: LOG.md:688]`. It **restates** day-as-freeze-unit as a pre-existing
constraint it must not break:

> "Each day remains its own regeneration/freeze unit (that is what lets day 5
> re-plan without touching day 1). The scroll is a PRESENTATION LAYER ONLY"
> `[read: docs/decisions/2026-07-25-continuous-day-detail-scroll.md:15-18]`

That is the **only occurrence of the phrase in the repo** `[grep → 1 hit]`.
**No decision record establishes days as the regen/freeze unit.**

### Three distinct things are called "freeze"

- **(A) Trip-level**, implemented: `FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"])`, a **literal in source**, not the DB `[read: rails.ts:23-36]`
- **(B) Day-level cleave**, implemented and pure: frozen prefix `days[0…resumeIdx-1]` kept verbatim, tail regenerated, `stitchDays` reconcatenates `[read: partial-replan.ts:278-286]`. State persists as `completedThrough` **inside `trip.generationInput`**, untyped, read via `(input as unknown as {…}).completedThrough` `[read: edit-actions.ts:92-98]`
- **(C) Blast radius**, an observation from a manual verify run, not a guard `[read: continuous-day-detail-scroll.md:127-129]`

**No `frozen` field on `Day` or `Trip`, no DB column** `[grep]`.

### The tripwire is prose, not code

`[grep -ri "tripwire"]` → **3 files, all markdown**. Zero hits in any `.ts`,
`.tsx`, `.yml`, or script. `.git/hooks/` has no non-sample hooks; no `.husky/`.
CI runs three jobs and **`npm run -w web` is never run — only
`npm run -w data test`** `[read: .github/workflows/ci.yml:37-49]`.

It has real social teeth (it forced the seed-id fix out of #146 into its own PR
`[read: BACKLOG.md:659-661]`) but nothing fires automatically, and BACKLOG records
a shipped fix that violated its own tripwire's assumptions `[read: BACKLOG.md:1063-1065]`.

**The strongest lock on freeze semantics, `partial-replan.byte-identical.test.ts`,
does not run in CI.**

### Days can be edited without regeneration, and freeze gates none of it

Three paths: repository mutations (`renameDay`, `removeDay`, `addWaypoint`,
`removeWaypoint`), overlay writes, and local unpersisted `reorderDays`.

`isEditInFuture` is consulted only on the replan path; `repository.removeDay` and
`addWaypoint` never read `completedThrough`
`[grep: completedThrough → only partial-replan.ts, edit-actions.ts, change-trip-composer.tsx]`.
**A day inside the frozen prefix can currently be mutated through the manual surface.**

### How insert breaks freeze

`completedThrough.dayNumber` is a **positional completed-day count** =
`cleave.resumeIdx` `[read: partial-replan.ts:129-132, edit-actions.ts:544]`,
consumed as `{atDay: ct.dayNumber + 1}` then `idx = now.atDay - 1`
`[read: partial-replan.ts:92-99, :164]`.

**Concrete failure:** `completedThrough.dayNumber = 5`, insert at position 3. Days
1–6 are now driven. `resolveEffectiveNow` still returns `atDay: 6`, so `cleaveTrip`
freezes only `days[0..4]` and **the sixth, already-driven day falls into the
re-plannable tail and gets regenerated and renumbered.** Inserting after the
marker symmetrically leaves an undriven day inside the frozen prefix. Nothing
remaps `completedThrough` `[grep → no writer besides edit-actions.ts:543]`.
`[UNVERIFIED]` — derived by reading the call chain; no insert path exists to run
it against.

Insert does not invalidate frozen neighbours' **content**. It invalidates the
**marker that defines which days are frozen**.

---

## 6. Minimum user input per shape

| Shape | User must specify | Derivable without input |
|---|---|---|
| Append layover | Nothing, or which position to rest at | Everything. `coords`/`startCoord` = prior day's `coords`, `miles` = 0, no polyline change |
| Split at existing node | The split point, as a **pick from that day's `corridorCities`** — no free text, no geocode | All geometry. `routePolyline` unchanged, `corridorCities` pure re-derive, `miles` from slice arithmetic |
| Append travel day | A destination (resolve/geocode) | `startCoord` = prior `coords`. Rest needs calls, plus `endDate`/`endLocation`/`endCoords` |
| Insert travel day | A destination **plus a bridging policy**: fit between existing endpoints, or push everything downstream | Least of any shape |

**In every shape the reasoned layer has no preimage** — `overnight` + rationale,
`description`, `notes`, `weather`, `label`, `keyStops`. Either the new day ships
blank and manual, or it costs a generation pass: 1 LLM call (`claude-opus-4-8`,
32k max tokens, up to 3 with `REGEN_BUDGET = 2`)
`[read: generate.ts:19, :150, :179]` plus per-day `routeBetween`, corpus RPC, and
Wikipedia hero fetch.

**Split needs exactly one new overnight. A new travel day needs a full day's worth.**

---

## Doc drift found (recorded, not fixed)

1. `itinerary-model.md:21` cites `src/lib/plan/actions.ts:237` as a `Day.id` mint site. **That file does not exist** `[read: dir listing of web/src/lib/plan/]`
2. `itinerary-model.md:382-388` (the 30-cap rung) cites `routing/day-suggestions.ts` and `MAX_SEGMENT_SUGGESTIONS = 30`. **Both are gone** `[grep → 0 hits in web/src]`. That rung has no live producer
3. `itinerary-model.md:52` — `derive.ts` line anchors not re-verified this pass `[UNVERIFIED]`

## Not covered (not verified this pass — do not infer)

The Paper `LC-0` UI design and whether it survives the Design-A change; whether
any persist path merges a prior payload before write (bears on the `offlinePhases`
loss); `expedition-actions.ts`'s own insert target; corpus/federated-supply
internals.

## Related

- [`docs/architecture/itinerary-model.md`](../architecture/itinerary-model.md) — the day/waypoint/overlay model
- [`docs/architecture/generation-pipeline.md`](../architecture/generation-pipeline.md) — how a trip is written
- [`docs/decisions/2026-07-24-cross-day-stop-movement.md`](../decisions/2026-07-24-cross-day-stop-movement.md) — `dayAssignment` scope and rejected alternatives (see staleness note, §1)
