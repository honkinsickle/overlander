# Generation pipeline — how a trip is WRITTEN

**Point-in-time: 2026-07-26.** First deliberate end-to-end trace of the
generation (WRITE) path. Everything recorded about generation before this was
found incidentally while investigating something else.

## Why this is its own file

The two prior architecture traces
([`place-render-model.md`](place-render-model.md)) cover the **READ** path —
how a stored tile becomes a card, and how a card becomes a detail slideup. That
file is scoped to rendering, and its two parts share one subject: a payload that
already exists.

Generation is the opposite direction: it is the subsystem that **produces** that
payload, it runs server-side behind a feature gate, it calls an LLM and two
external APIs, and it terminates at a database write. It shares almost no code
with the read path. Appending it as a "Part 3" would put two opposed concerns in
one 1,000-line file and make the read-path doc's framing false.

So: separate file, cross-linked. Specifically **not** duplicated here:

- **The stored payload's SHAPE** (tile counts, `curated` ratios, provenance
  split, the 30-cap rung) — that is
  [`itinerary-model.md` §7](itinerary-model.md), which is the single home for
  trip shapes. This doc covers how the shape gets *made*.
- **How tiles and details RENDER** — [`place-render-model.md`](place-render-model.md).
- **How a stored trip is SERVED** — [`trip-resolution.md`](trip-resolution.md).

## Why this doc states its evidence

Same rule as [`trip-resolution.md`](trip-resolution.md): every claim states how
it was verified — `[read source]`, `[grep]`, `[queried TEST]`, `[queried PROD]`,
`[observed in browser]`. Claims not verified this session are marked
`[UNVERIFIED]` and stay that way. Do not fill gaps here with plausible
narrative.

**Instrument:** `expedition-ms28y793` on TEST — 15 days, Los Angeles, CA → Moab,
UT, produced by the wizard and therefore the artifact of exactly this pipeline.
Every `[queried TEST]` tag below is a read of `reference_trips.payload` for that
id, served by the TEST project `znldzjdatkogdktymtvi` (the project ref was
asserted in-script, not assumed). No trip was generated for this trace; no LLM
call was made; no failure was induced.

---

## 1. The pipeline, stage by stage

Entry point: `generateExpeditionTripAction` in
`web/src/lib/plan/expedition-actions.ts` — a `"use server"` action, the wizard's
only door into the pipeline `[read source]`.

### Stage 0 — gates and form intake

Three refusals run before any work, in order `[read source: expedition-actions.ts,
expedition.ts]`:

1. **Feature gate** — `isExpeditionWizardEnabled()` requires
   `ENABLE_PLANNER_WIZARD === "true"`. Off by default; prod never sets it.
2. **TEST-only guard** — `currentProjectRef()` parses the project ref out of
   `NEXT_PUBLIC_SUPABASE_URL` and the action refuses unless the label is
   `"TEST"`. `KNOWN_PROJECT_REFS` hard-codes both refs, so a generation
   **cannot** write to PROD even if the route were reached with a prod env.
3. **Form validation** — `validateExpeditionForm` returns the first failure
   message. Notably it requires **every destination to carry `coords`** ("Pick
   each destination from the suggestions"), because a freeform label can
   fuzzy-geocode to the wrong place.

Then `expeditionToGenerationInput` maps the form → `GenerationInput`
(`anchors`, `params`, `rig`, `objective`). Pure, no I/O `[read source]`.

### Stage 1 — `preComputeFacts` (the ENGINE block)

`web/src/lib/itinerary/facts.ts`. Takes `GenerationInput`, produces
`EngineFacts` — the ground truth handed to the LLM. Throws if fewer than 2
anchors `[read source]`.

| Step | Call | Produces |
|---|---|---|
| 1 | anchor coords used **verbatim** when the user picked one; `geocode(a.place)` only as fallback | `coords[]` |
| 2 | `routeBetween(coords)` through the full anchor chain | route + geometry |
| 3 | `segmentByPace(route, { maxDistanceM })` | `baselineDriveDays` (a pacing seed, not the final day count) |
| 4 | `deriveCorridorCities(...)` over the bundled `gazetteer` | `corridorCities` (city spine) |
| 5 | **two** corpus folds, merged and deduped by `id` | `poolPOIs` |

The two folds in step 5 are additive `[read source]`:
`fetchCorpusForSegment` per baseline segment (2-point chord), **plus**
`fetchCorpusForPolyline` along the actual route geometry downsampled to ~250
points. The second exists because a straight chord's 16 km buffer misses POIs
where the road curves away by more than that. Dedup is first-write-wins into a
`Map` keyed on `p.id`.

`objective` is **not** a `preComputeFacts` input — it rides along to the prompt
as tone context only `[read source: facts.ts GenerationInput docstring]`.

### Stage 2 — `generateAndAudit` (the LLM block + the audit)

`web/src/lib/itinerary/generate.ts` `[read source]`.

**The LLM call** (`generateItinerary`): model `claude-opus-4-8`,
`max_tokens: 32000`, `thinking: { type: "adaptive" }`,
`output_config.effort: "high"`, and a `json_schema` format constraint set to
`ITINERARY_OUTPUT_SCHEMA` (`web/src/lib/itinerary/schema.ts`). The system prompt
is `SYSTEM_PROMPT`; the user turn is `buildFactsMessage(input, facts)`
(`master-prompt.ts`). The Anthropic SDK is imported dynamically via a
non-literal specifier so it is not a static build dependency.

**The audit** (`auditItinerary`, `web/src/lib/itinerary/audit.ts`) runs after,
in three tiers `[read source]`:

- **Tier 1 — silently correct.** Re-measures each day's leg with `routeBetween`
  on chained endpoints and snaps `distanceMi`/`driveHours` to the measurement.
  A gap over `DISTANCE_SNAP_TOLERANCE_MI = 15` adds an *info* flag. Fuel gaps
  are **replaced wholesale** with `computeFuelGaps(...)` output — the LLM's
  `fuelGaps` are discarded, kept only as `report.fuel.claimed`.
- **Tier 2 — ground or drop.** Every `keyStops[].name` and `overnight.name` goes
  through `groundReference`: **pool-first** (exact normalized-name match against
  `poolPOIs`, no Google spend), else **live-resolve** via `PlaceResolver`, else
  **drop + flag**. A resolved place must additionally pass the corridor guard
  (below) or it is dropped. A dropped overnight is *critical* and rewrites
  `overnight.name = null` with `UNVERIFIED_OVERNIGHT_DESC`.
- **Tier 3 — structural.** A leg over `maxDailyDriveMi + 15`, or a FIXED anchor
  not landing on its pinned date, is returned as a `StructuralIssue`.

**The regen loop** lives in `generateAndAudit`, not the audit: while
`outcome.structural.length > 0 && attempts < REGEN_BUDGET` (**`REGEN_BUDGET = 2`**),
it formats the violations into `regenFeedback` and regenerates the **full**
itinerary `[read source]`.

**Does audit failure block persistence? No — it is advisory.** When the budget
is exhausted with issues outstanding, `generateAndAudit` returns them as
`unresolved` and the action **persists anyway**, surfacing only a soft `note`:
*"Generated, but some anchors couldn't be fully reconciled — review the plan."*
`[read source: expedition-actions.ts]` The only hard aborts are thrown
`ItineraryGenerationError`s (§7).

The caller persists `outcome.audited`, never the raw LLM output `[read source]`.

### Stage 3 — `bakeGeneratedDays`

`web/src/lib/itinerary/bake.ts`. Per day, in parallel across days `[read source]`:

1. Endpoints: reuse the audit's `dayRoutes` coords; `geocode` only as fallback.
2. Polyline: reuse the audit's, **unless** the day has excursion vias — then
   re-route `start → vias → end` so the spur is on the line. `vias` are the
   day's `resolvedPlaces` coords.
3. Corpus fold for the day (`fetchCorpusForSegment(start, end)`).
4. Build `tiles` = corpus tiles ∪ `resolvedPlaces.map(resolvedToTile)`, flagging
   `curated: true` + `keyStopNote` on entries whose ref matches a `day.keyStops`
   name.
5. Project every tile onto the day polyline with `alongRouteMiles`; keep
   `milesFromStart` only when `offsetMi <= DEFAULT_CORRIDOR_PARAMS.bufferMi`.
6. `deriveCorridorCities` → spine; `stripNodeIdentical(tiles, spine)` →
   `cardTiles`; `bucketPlacesIntoCorridor` buckets `cardTiles` under nodes.

Returns `{ n, corridorCities, segmentSuggestions: cardTiles }`.

### Stage 4 — `itineraryToTrip`, hero photos, persist

`web/src/lib/itinerary/to-trip.ts` projects `EngineFacts` + audited
`ItineraryOutput` + `BakedDay[]` → a normal `Trip` `[read source]`. Then, still
inside the action `[read source: expedition-actions.ts]`:

- `tripId = \`expedition-${Date.now().toString(36)}\``
- `attachHeroPhotos(trip)` — per-day and trip hero images resolved from
  **Wikipedia/Wikimedia Commons** by destination name
  (`web/src/lib/imagery/destination-photo.ts`). This is a **network call that
  mutates the payload after `itineraryToTrip`** and before persist.
- `supabase.from("reference_trips").upsert({ id, title, payload: trip,
  source_version: \`yotrippin-wizard@<YYYY-MM-DD>\` })` with the **service**
  client.

Verified on the instrument: `source_version` = `yotrippin-wizard@2026-07-26`
`[queried TEST]`.

### Stage 5 — corpus feedback (after persist, non-fatal)

`enqueueResolvedPlaces(resolvedPlaces, supabase)`
(`web/src/lib/itinerary/ingest.ts`) upserts each tier-2 resolved place as a
`source_record` under `SOURCE_ID = "google_resolved"` via the
`upsert_source_record` RPC — idempotent on `(source_id, external_id)`
`[read source]`. It does **not** trigger entity resolution; promotion into
`master_place` is a deliberate manual `npm run -w data materialize`. Wrapped in
`try/catch` and logged with `console.warn` — *"a corpus-write failure must never
fail the user's generation"* `[read source: expedition-actions.ts]`.

> **Correction to the recorded fragment.** The previously-recorded pipeline
> (`form → preComputeFacts → generateAndAudit → bakeGeneratedDays →
> itineraryToTrip → persist`) is **accurate but incomplete**: it omits
> `attachHeroPhotos` between `itineraryToTrip` and the upsert, and
> `enqueueResolvedPlaces` after it. The `expedition-<base36>` id form is
> correct `[read source]`.

---

## 2. The two tile sources — a union, with no precedence

**It is a true union, not corpus-preferred-with-tier-2-filling-gaps.**
`bake.ts` builds `tiles` as a flat concatenation of the day's corpus fold and
its `resolvedPlaces`, with **no comparison between the two sets** — no id match,
no name match, no coordinate proximity check `[read source: bake.ts]`.

Precedence exists **one stage earlier and for a different purpose**: in the
audit, `groundReference` is pool-first, so a name the LLM emits that exactly
matches a pooled POI resolves to the corpus row and **never becomes a
`resolvedPlace` at all** `[read source: audit.ts]`. That is what keeps the two
sets mostly disjoint. It is name-matching in the audit, not deduplication in the
bake.

### The dedup that does exist, and the gap it leaves

Three mechanisms, none of which cross the corpus/tier-2 boundary:

| Mechanism | Where | Scope |
|---|---|---|
| `PlaceResolver` name cache | `resolve.ts` | one generation, keyed on lowercased name |
| `matchPool` exact-normalized-name | `audit.ts` | LLM name → pooled POI |
| `stripNodeIdentical` | `bake.ts` | removes tiles that ARE a spine node |

`matchPool` is **exact-only** by deliberate decision — fuzzy/token-subset
matching was tried and removed because it mis-bound "Cedar City" →
"Cedar City Field Office" `[read source: audit.ts matchPool docstring]`.

`stripNodeIdentical` requires **same normalized name AND coords within
`NODE_COINCIDENCE_MI = 2`**; a name mismatch always blocks the merge, and its
own header states the intended failure mode is *"renders twice (visible,
fixable), never the wrong place silently disappears"*
`[read source: corridor/node-identity.ts]`.

**Observed consequence on the instrument.** Day 6 persists **5**
`segmentSuggestions`, of which **two are byte-identical ids**
(`google:ChIJLevDAsZrNYcRBm2svvvY6Ws`, Bryce Canyon National Park)
`[queried TEST]`:

- index 0 — no `curated`, no `keyStopNote` → the **endpoint**-resolved instance
- index 2 — `curated: true`, note *"first overlooks at Bryce/Inspiration Point…"*
  → the **keyStop**-resolved instance

Both survive because nothing dedupes `resolvedPlaces` by `placeId` before
`resolvedToTile` runs, and `stripNodeIdentical` does not remove them: the spine
node is named *"Bryce Canyon, UT"* and the tile is *"Bryce Canyon National
Park"*, so the name test fails. The same id also appears **twice** in that
node's `placeIds` `[queried TEST]`. This is the documented "renders twice"
failure mode occurring in stored data, not a new class of bug.

### Where Google is called during generation, and what is asked for

**One place only: `PlaceResolver.resolve` in
`web/src/lib/itinerary/resolve.ts`** `[read source; grep for `FieldMask`
confirms only three call sites repo-wide, the other two being the
discovery/browse path]`.

- Endpoint: `POST https://places.googleapis.com/v1/places:searchText`
- Body: `{ textQuery, maxResultCount: 1, locationBias.circle` with
  `BIAS_RADIUS_M = 50_000` `}`, `AbortSignal.timeout(8000)`
- Mask: `RESOLVE_FIELD_MASK` = `places.id, places.displayName, places.location,
  places.formattedAddress, places.types, places.primaryType`

**Shape vs render-time enrichment: different, and deliberately so.** Both masks
are **module constants fixed server-side** — neither is client-influenced, so
the "server-fixed mask" property established by the render-path trace holds here
too. But the **field sets are disjoint in the fields that matter**
`[read source: discovery/google-places.ts]`:

| | generation (`RESOLVE_FIELD_MASK`) | render-time (`DETAILS_FIELD_MASK`) |
|---|---|---|
| endpoint | `places:searchText` (POST, by NAME) | `places/{id}` (GET, by ID) |
| identity | `id`, `displayName`, `location` | `id`, `displayName` |
| category | `types`, `primaryType` | `types` |
| **`rating`** | ✗ | ✓ |
| **`userRatingCount`** | ✗ | ✓ |
| **`priceLevel`** | ✗ | ✓ |
| **`photos`** | ✗ | ✓ |
| **`regularOpeningHours`** | ✗ | ✓ |

Generation **never asks Google for rating, photo, price, or hours.** That is the
upstream reason generated tiles persist without them (§5) — not a stripping step
later. `RESOLVE_FIELD_MASK` is the cheaper Google SKU tier; `DETAILS_FIELD_MASK`
deliberately buys the Pro-tier fields
`[read source: google-places.ts FIELD_MASK docstring]`.

**The resolution cap is not `RESOLVE_CAP`.** `resolve.ts` exports
`RESOLVE_CAP = 15` as the *default*, but `auditItinerary` constructs
`new PlaceResolver(Math.max(80, output.days.length * 8))` — **120** for a 15-day
trip — explicitly *"a runaway guard, not a budget throttle"*
`[read source: audit.ts]`. A `capped` status drops the place and flags the day;
it is **not** cached, so a later dedupe hit is free.

### What the union actually produced

All 48 tiles across the instrument are `google:` **except 4**, and all four
`mp:` tiles sit on **day 1** `[queried TEST]`. The corpus fold contributed
essentially nothing on this route because TEST's corpus footprint barely
overlaps LA→Moab. Counts and the coverage caveat are recorded once in
[`itinerary-model.md` §7](itinerary-model.md) — not repeated here.

---

## 3. The LLM boundary — field provenance

**Bounded per the trace scope: day 6 of `expedition-ms28y793`** (Cedar City, UT
— Bryce Canyon, UT; 81 mi; 5 tiles), plus one tile on it. Day 1 was excluded as
atypical (it holds all four corpus tiles) and the last day as an endpoint.

### Day-level fields

Every key present on the stored day `[queried TEST]`, traced to its setter in
`itineraryToTrip` `[read source: to-trip.ts]`:

| Field | Day-6 value (abbrev.) | Origin |
|---|---|---|
| `id` | `"day-6"` | **computed** — `` `day-${dp.n}` `` |
| `dayNumber` | `6` | **LLM-authored** (`dp.n`) |
| `date` | `"2026-08-08"` | **LLM-authored** (`dp.date`), bounded by user `startDate`/`endDate` |
| `label` | `"Cedar City, UT — Bryce Canyon, UT"` | **computed** from LLM-authored `startPlace`/`endPlace` |
| `startCoord` | `[-113.0617…, 37.6773…]` | **computed** — audit `dayRoutes[].startCoord` (chained; Google- or Mapbox-resolved) |
| `coords` | `[-112.1870…, 37.5930…]` | **computed** — audit `dayRoutes[].endCoord` |
| `miles` | `81` | **computed (engine-measured)** — `routeBetween` re-measurement, snapped over the LLM's stated value |
| `driveHours` | `1.7` | **computed (engine-measured)** — same |
| `description` | *"Cross Hwy 14 and drop through Red Canyon's orange spires…"* | **LLM-authored** (`dp.rationale`) |
| `weather` | `{ arrival: "Cooler at elevation (Bryce ~8,000 ft, 75°F day / 45°F night); afternoon thunderstorms likely." }` | **LLM-authored** — see §4 |
| `notes` | 3 entries (overnight / logistics / a BOOK obligation) | **LLM-authored**, composed by `dayNotes` |
| `overnight` | `{ selected: { name: "Ruby's Inn", type: "lodge", … } }` | **LLM-authored**, name **audit-validated** (pool-hit or Google-resolved, else dropped) |
| `heroImage` | a `upload.wikimedia.org` Commons URL | **source-derived** — `attachHeroPhotos`, Wikipedia/Commons by destination name |
| `corridorCities` | 2 nodes | **computed** — `deriveCorridorCities` over route geometry + bundled gazetteer |
| `segmentSuggestions` | 5 tiles | **source-derived** — corpus rows and/or Google responses (§2) |
| `waypoints` | `[]` | **literal** — `itineraryToTrip` always sets `[]` |

Two fields inside `overnight` deserve the distinction: `overnight.selected.name`
is a real place the audit verified, but `overnight.selected.notes` is the LLM's
`rationale` verbatim, and `detourMiles: 0` / `cost: ""` are **hardcoded
literals**, not measurements `[read source: to-trip.ts]`. `detourMiles: 0` is a
value that *looks* computed and is not.

### One tile — `segmentSuggestions[0]`

`google:ChIJLevDAsZrNYcRBm2svvvY6Ws` (Bryce Canyon National Park), minted by
`resolvedToTile` `[read source: bake.ts]`, values `[queried TEST]`:

| Field | Value | Origin |
|---|---|---|
| `id` | `google:ChIJLevDAsZrNYcRBm2svvvY6Ws` | **computed** — `` `google:${rp.placeId}` `` |
| `placeId` | `ChIJLevDAsZrNYcRBm2svvvY6Ws` | **source-derived** — Google `places.id` |
| `title` | `"Bryce Canyon National Park"` | **source-derived** — Google `displayName` |
| `photoAlt` | `"Bryce Canyon National Park"` | **source-derived** — same value reused |
| `coords` | `[-112.1870…, 37.5930…]` | **source-derived** — Google `location` |
| `pills` | `[{ label: "live-resolved" }]` | **literal** constant |
| `milesFromStart` | `81` | **computed** — `alongRouteMiles` against the day polyline |
| `stats`, `mention`, `description`, `pullquote`, `placeInfo`, `cta` | `[]` / `""` | **literal** empties |

**Nothing on this tile is LLM-authored.** The LLM supplied the *name* that was
looked up; every persisted value is Google's or computed. On a keyStop tile one
LLM-authored field is added — `keyStopNote` (index 1: *"scenic — vivid red
hoodoos and arch tunnels on Hwy 12, a great teaser"*) alongside `curated: true`
`[queried TEST]`.

### Verdict on the grounding question

**For tiles, the grounding rule holds.** No tile field looks sourced but is
LLM-authored; the LLM contributes names and notes, and names are audit-verified
before they persist.

**For day-level fields there is one clear violation and two soft spots:**

- `day.weather` — **fabricated**, see §4.
- `overnight.selected.detourMiles: 0` — a hardcoded literal in a numeric field
  that reads as a measurement `[read source: to-trip.ts]`.
- `trip.weatherHiF` / `weatherLoF` — hardcoded `70` / `45`, see §4.

### One measured inconsistency worth recording

Day 6 persists `miles: 81`, but its tiles carry `milesFromStart` of **81, 113,
81, 149, 153** `[queried TEST]` — three values exceeding the day's own length.

`day.miles` is the audit's **direct** `start → end` measurement
`[read source: audit.ts]`, whereas `milesFromStart` is projected onto the
polyline `bake.ts` re-routed **through the day's excursion vias**
(`start → vias → end`), which is a strictly longer line `[read source: bake.ts]`.
The two numbers are measured against different geometry, so a tile can sit
"further along" than the day is long. Both are computed, neither is invented —
but they are not on a common scale, and the day-detail column shows both.
**Whether any surface renders them adjacently in a way that reads as
contradictory was not investigated** `[UNVERIFIED]` — tracing render behaviour is
out of scope here.

---

## 4. `day.weather` and the temperature pill — DIFFERENT origins, both ungrounded

### `day.weather` is LLM-authored end to end

**There is no weather or climate data source anywhere in this repository** —
verified by an exhaustive sweep of source, all three `package.json` files,
`package-lock.json`, all 15 `.env*` files (names only), all 38
`supabase/migrations/`, every external hostname literal in `web/src`,
`web/scripts`, `data/`, and `supabase/`, and every local CSV/NDJSON/GeoJSON
`[grep + read]`. No weather HTTP client, no weather env var, no climate column,
no climate dataset, and no function deriving temperature from latitude,
elevation, or date. The nearest miss is `master_place.seasonality`, documented in
the seed migration as `open_year_round / season_start / season_end` — facility
operating season, not weather.

`docs/BACKLOG.md` corroborates this independently: its *"Live-weather
integration — RESCUABLE from PR #24"* entry records that the OpenMeteo forecast
+ climatology fallback is **absent from main** and only the `Day.weather`
placeholder field exists `[read]`.

The full chain `[read source]`:

1. **`schema.ts`** — `weather: string` is a property of `DAY_PLAN_SCHEMA` and is
   listed in its `required` array. It is part of the **LLM's structured-output
   contract**. Its TypeScript docstring reads *"Typical/climate weather note
   (advisory until a live source backs it)."*
2. **`master-prompt.ts`** — the output contract instructs the model to emit
   `- weather (typical/climate, advisory)`. The `buildFactsMessage` payload
   handed to the model contains `params`, `rig`, `anchors`, `route`,
   `corridorCities`, `poolPOIs` — **no weather input of any kind**.
3. **`audit.ts`** — `auditItinerary` never reads or writes `weather`. The
   audited day is built as `{ ...day, keyStops, overnight, distanceMi,
   driveHours, audit }`, so `weather` **rides through the entire audit
   untouched**. No tier checks it.
4. **`to-trip.ts`** — `weather: dp.weather ? { arrival: dp.weather } : undefined`.
   The string is placed in the `arrival` slot; `departure` is never populated on
   this path.

**It reaches the user under a WEATHER heading, carrying specific temperatures.**
Confirmed on the running app, TEST, day 3 of the instrument:

> **WEATHER**
> Arrive · Hot desert, 95–105°F; the Virgin River Gorge is dramatic and
> shadeless at midday.

`[observed in browser: localhost:3210, day-detail briefing, 2026-07-26]`.
Rendered by `day-briefing-card.tsx` as a `Depart ·` / `Arrive ·` row.

Every one of the 15 days carries such a string, most with explicit numeric
ranges — day 1 *"Brutally hot Mojave transit — 100–110°F midday at
Barstow/Baker"*, day 12 *"Hot, 95–105°F in Moab"* `[queried TEST]`.

**Stated plainly: `day.weather` is model-generated prose presented as
measurement.** Specific Fahrenheit ranges appear under a WEATHER heading with no
advisory marker, no provenance tag, and no verification step anywhere in the
pipeline. The field's own docstring calls it advisory, the prompt asks for it as
advisory, and the `FactConfidence` union even has an `"advisory"` member — but
that tag is only ever attached to `distanceConfidence`
`[read source: schema.ts DayAudit]`. Nothing marks weather as advisory in the
payload, and nothing marks it in the UI. This is a fabricated field in
user-visible UI.

### The temperature pill is a different origin — and does not currently render

Traced separately, because the two could have differed. They do.

`Trip.weatherHiF` / `Trip.weatherLoF` are **trip-level** fields; there is **no
day-level high/low anywhere** — `Day` carries only
`weather?: { departure?: string; arrival?: string }`
`[read source: trips/types.ts]`.

On the generated path, `itineraryToTrip` sets them as **hardcoded literals**:

```ts
weatherHiF: 70,
weatherLoF: 45,
```

`[read source: to-trip.ts]` — confirmed in the stored payload: the instrument, a
15-day August LA→Moab trip whose own LLM prose says 95–105°F, persists
`weatherHiF: 70, weatherLoF: 45` `[queried TEST]`. Every generated trip gets the
same two numbers regardless of route, season, or latitude. `edit-actions.ts`
re-stamps them on every living-plan re-plan `[read source]`. Nothing anywhere
updates them after creation `[grep: no write site in `trips/repository.ts`,
`recompute-day.ts`, `carry-forward.ts`, or any server action]`.

Other creation paths use different constants — wizard finalize `72`/`55`,
`createUserWizardTrip` `0`/`0`, the `la-to-deadhorse` reference `60`/`38`
`[grep]`. All literals; none derived.

**But the pill has no live render surface.** The only component in the repo that
renders `{weatherHiF}° / {weatherLoF}°F` is
`web/src/components/trip/trip-detail-header.tsx`, and **nothing imports it**
`[grep: three hits repo-wide — the definition, plus two stale doc comments in
`day-detail-corridor-column.tsx` and `imagery/mapbox-static.ts` that reference it
without importing]`. The slideup mounts `TripSlideupBody`, which imports
`DayColumnPlanner`, `DayDetailCorridorColumn`, `MapColumn` and others but not
`TripDetailHeader`; the overview state is served by `DayDetailOverview`, whose
hero has no weather pill `[read source]`.

Confirmed empirically: with day 3 open on the instrument, the only `°` character
on the page is the one inside the LLM weather prose — there is no hi/lo pill
`[observed in browser, 2026-07-26]`.

> **Correction to the handoff premise.** The trace was asked to check a temp
> pill *"in the day-detail header."* No such pill renders on that surface, or
> any live surface. `TripDetailHeader` is **dead code superseded by
> `DayDetailOverview`**. Its origin is nonetheless established and recorded
> above, because the hardcoded `70`/`45` **is** in the persisted payload and
> would become user-visible the moment anything mounted that component.

**Summary:** `day.weather` and the temp pill do **not** share an origin.
`day.weather` is LLM-authored and **is** user-visible. The pill is a hardcoded
constant and is **not** currently user-visible. Both are ungrounded; only one is
currently a live defect.

---

## 5. What persists, and what is thrown away

### Persisted — `reference_trips` row

`{ id, title, payload: <full Trip>, source_version }` `[read source]`. Top-level
payload keys on the instrument `[queried TEST]`: `days`, `endDate`,
`endLocation`, `foodThread`, `generated`, `generationInput`, `heroImage`, `id`,
`kicker`, `routePolyline`, `startCoords`, `startDate`, `startLocation`, `title`,
`weatherHiF`, `weatherLoF`.

Two are load-bearing beyond rendering:

- **`generationInput`** — the *full* `GenerationInput` is persisted with the
  output. This is what makes the trip re-plannable (living-plan: edit anchors →
  re-run). Typed loosely on `Trip` to avoid a circular import
  `[read source: to-trip.ts]`; locked by a test
  `[read: to-trip.test.ts "persists the full GenerationInput on the Trip"]`.
- **`routePolyline`** — `assembleRoutePolyline(dayRoutes)` concatenates the
  audit's per-day geometry, skipping layover days and dropping duplicate
  boundary vertices, so the map draws the real road **with no network call**
  (the offline case). 44,891 chars on the instrument `[queried TEST]`.

### Computed and thrown away

| Discarded | Where it existed | Note |
|---|---|---|
| **`AuditReport`** | returned by `generateAndAudit` | Never persisted. Confirmed: no `auditReport` key on the payload `[queried TEST]`. Distance snaps, dropped POIs, fuel corroboration, and the resolver's Google call count are all operator-only and lost after the request. |
| **`DayAudit`** (per-day `audit`) | on `ItineraryOutput.days[]` | Explicitly *"TRANSIENT"*. `itineraryToTrip` reads `dp.audit.flags` to compose `notes` and then drops the object. No `audit` key on any stored day `[queried TEST]`. Provenance — `distanceConfidence`, `statedDistanceMi` — does **not** survive. |
| **`DayRoute[]`** | audit → bake → `to-trip` | Docstring: *"TRANSIENT… Not persisted."* Survives only compressed into `routePolyline` and per-day `startCoord`/`coords`. |
| **`EngineFacts.poolPOIs`** | stage 1 | Only pooled POIs that a day's own fold re-fetched, or that the LLM named, reach the payload. On the bake path the pool is never persisted wholesale. |
| **LLM `fuelGaps`** | raw output | Replaced by `computeFuelGaps`; the claimed set survives only in the discarded report. |
| **LLM `distanceMi` / `driveHours`** | raw output | Overwritten by the measurement; the stated values survive only in the discarded `DayAudit`. |
| **`usage` (token counts)** | `GenerationResult` | Returned by `generateItinerary`, never read by `generateAndAudit`. |

`ItineraryOutput`'s `routeSummary`, `phases`, `variants`, `permits`, `borders`
and `anchorsHonored` are **also not projected** onto the `Trip` —
`itineraryToTrip` reads only `days` and `foodThread` `[read source]`. The model
is asked for six sections that are generated, paid for, and dropped.

### Tiles persist essentials-only — confirmed

**Confirmed.** Every one of day 6's five tiles carries exactly:
`coords, cta, description, id, mention, milesFromStart, photoAlt, pills,
placeId, placeInfo, pullquote, stats, title` (+ `curated`, `keyStopNote` on the
three keyStop tiles). **No `rating`, no `photoUrl`, no `userRatingCount`, no
`priceTier`, on any tile** `[queried TEST]`.

This is structural, not incidental, and now has a traced upstream cause:
`resolvedToTile` never sets those fields, and — the deeper reason — **generation
never requests them from Google** (§2). Rating and photo are grafted at render
by `/api/places/details`, which uses the richer `DETAILS_FIELD_MASK`
`[read source; render-side behaviour: place-render-model.md]`.

`source` is likewise absent on every `google:` tile `[queried TEST]`, confirming
the recorded fragment: **`source` is not a reliable provenance discriminator on
generated trips — the id prefix is.**

---

## 6. Failure modes

**From source only.** No failure was induced, no trip generated, no LLM called.

### Hard aborts — nothing persists

`ItineraryGenerationError` propagates out of `generateItinerary` and is caught by
the action, which returns `{ ok: false, error }` **before any DB write**
`[read source]`:

| `code` | Trigger |
|---|---|
| `missing_key` | `ANTHROPIC_API_KEY` unset |
| `missing_sdk` | `@anthropic-ai/sdk` dynamic import fails |
| `api_error` | any throw from `client.messages.stream(...)` / `finalMessage()` |
| `refusal` | `message.stop_reason === "refusal"` |
| `bad_output` | no text block, **or `JSON.parse` throws** |

**Malformed LLM output → hard abort, no partial trip.** The `json_schema`
constraint makes it unlikely, but the parse is guarded and a failure aborts.
Note the guard is `JSON.parse` **only** — the result is cast
`as ItineraryOutput` with **no runtime shape validation**. Syntactically valid
JSON that is structurally wrong (missing `days`, wrong field types) would pass
this check and fail later, wherever it is first dereferenced. **Which stage
would throw, and whether that throw lands before or after the upsert, was not
traced** `[UNVERIFIED]`.

`preComputeFacts` throws on fewer than 2 anchors and propagates route/geocode
failures — *"a generation with no route is meaningless"* `[read source]`. Caught
by the generic `catch`, returned as `{ ok: false }`, nothing persists.

A **persist failure** returns `{ ok: false, error: "Persist failed: …" }`; the
corpus feedback is skipped because it sits after the early return
`[read source]`.

### Soft degradations — the trip persists anyway

This is where a silently-degraded trip can be produced. Every one of these fails
**open**:

| Stage | Failure | Behaviour |
|---|---|---|
| Corpus fold (facts) | RPC error | `fetchCorpusForPolyline` returns `[]` on error *or* throw. Docstring: *"Fails soft — returns [] on any RPC error."* A `poolPOIs: []` pool still yields *"a valid (if sparse) grounding"*, and the LLM is then free-running on its own knowledge for every name. |
| Corpus fold (bake) | RPC error | same `[]` — the day's tiles come from tier-2 only |
| Tier-2 resolve | no key / not-found / capped / off-corridor | place **dropped**, day flagged. keyStop → *warning*; overnight → **critical**, name nulled, `desc` replaced with `UNVERIFIED_OVERNIGHT_DESC` |
| Tier-2 resolve | `GOOGLE_PLACES_API_KEY` unset | `status: "no-key"`, cached — **every** name silently drops, whole trip, no error surfaced to the user |
| Day endpoint | unresolvable | `dayEndCoord = null`; `currentPos` **stays put**; day unmeasured, `distanceConfidence: "advisory"` |
| Day route | `routeBetween` throws | `measuredMi = null`; the stated distance is kept |
| Bake polyline | `routeBetween` throws | `catch { /* keep whatever we had */ }` — silently reuses the audit polyline |
| Bake spine | `deriveCorridorCities` returns null | `corridorCities` undefined → day renders the degraded 2-node fallback |
| Hero photos | Wikipedia miss | `heroImage` omitted |
| Corpus feedback | RPC error / throw | `console.warn` only, after persist |
| Audit tier-3 | unresolved after `REGEN_BUDGET` | **persists**, soft note only |

**Anything that silently produces a degraded trip?** Yes — three, ranked:

1. **A missing `GOOGLE_PLACES_API_KEY` degrades every generated trip
   invisibly.** `resolve()` returns `no-key` and caches it; every name that is
   not an exact pool match is dropped with a per-day flag, but the *action*
   still returns `ok: true`. On a route with thin corpus coverage — which is
   exactly the instrument's situation, where 44 of 48 tiles came from tier-2 —
   this would silently yield a nearly tile-less trip. No distinct error code
   separates "no key" from "genuinely not found" at the action boundary.
2. **`dropped-poi` and `distance-snapped` flags are deliberately hidden from the
   reader.** `SILENT_FLAG_KINDS` in `to-trip.ts` filters `dropped-poi`,
   `dropped-overnight`, and `distance-snapped` out of `notes` — *"the gold
   standard never shows sausage-making."* Since the `AuditReport` is also not
   persisted (§5), **a dropped key stop leaves no trace in the stored payload at
   all.** (`dropped-overnight` still surfaces via the rewritten `overnight.desc`,
   so the critical case is not fully silent.) This is a deliberate product
   decision, recorded here as a consequence, not flagged as a bug.
3. **Structural violations survive into persisted trips.** After two failed
   regens the trip is stored with a leg over the user's own mileage cap. A
   *critical* flag does reach `notes`, and the action returns a soft `note`, so
   this is surfaced — but it is surfaced as prose, not as a blocking state.

### Not settled by reading

- Whether a structurally-invalid-but-parseable LLM response aborts before or
  after the upsert `[UNVERIFIED]`.
- Whether `attachHeroPhotos` can throw (rather than returning null) and thereby
  abort a generation between `itineraryToTrip` and the upsert. Its internals were
  not traced `[UNVERIFIED]`.
- Real-world tier-2 drop rates, and whether the `Math.max(80, days * 8)` cap is
  ever actually reached `[UNVERIFIED]`.

---

## Related

- [`itinerary-model.md` §7](itinerary-model.md) — **the** home for trip payload
  shapes, including this pipeline's measured output profile and the 30-cap rung.
- [`place-render-model.md`](place-render-model.md) — the READ path: how tiles
  render as cards and how the detail slideup is dispatched and enriched.
- [`trip-resolution.md`](trip-resolution.md) — how a stored trip is served.
- `docs/BACKLOG.md` — Live-weather integration (rescuable from PR #24).
