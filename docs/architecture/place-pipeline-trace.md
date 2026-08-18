# Place pipeline trace — manifest completeness check

Investigation-only pass, 2026-08-18. Traces the place-card field manifest
(`docs/architecture/place-card-data-requirements.md`,
`docs/architecture/place-data-field-manifest.md`) against the FULL pipeline —
trip creation → day assembly → place-pool population → corridor bucketing →
day-detail-column render — rather than the card widget or placement mechanism
in isolation. No code or docs other than this file were modified.

Sources read, in the order specified: `docs/architecture/generation-pipeline.md`,
`docs/architecture/itinerary-model.md` §7, `docs/architecture/place-render-model.md`
(Parts 1 and 2), `docs/architecture/trip-resolution.md`, plus mechanism-level
reads of `web/src/lib/trips/resolve-corridor-cities.ts`,
`web/src/lib/corridor/bucket.ts`, `web/src/components/trip/day-detail-corridor-column.tsx`,
`web/src/components/trip/day-detail-corridor.tsx`, `web/src/lib/itinerary/bake.ts`,
`web/src/lib/trip-browse/federated.ts`, `web/src/lib/trip-browse/hydrate.ts`,
and the `pois_along_corridor` SQL definitions under `supabase/migrations/`.

CURRENT FIELD MANIFEST (as given, not re-derived):
REQUIRED — coords (hard, silent drop), title, photoAlt.
NICE-TO-HAVE, degrades gracefully — rating/reviewCount, capacity,
EV-socket-family, land_manager/designation/gap_status, ele, tents/caravans,
narrative fields, address, category, status/Verified badge.

---

## 1. End-to-end trace — `expedition-ms28y793`

TEST `reference_trips`, 15-day LA→Moab, generated 2026-07-26, fully baked
(`corridorCities` on 15/15 days), predates the #160 persist-target change so
still lives in `reference_trips` rather than `public.trips`.

**Write (generation-pipeline.md).** Gates → `preComputeFacts` (corpus fold via
`pois_along_corridor` + geocoding) → `generateAndAudit` (LLM proposes day
key-stop names + a 3-tier audit/regen loop; a name either matches a pool tile
by name or gets a live Google resolve, capped at 15 resolves/generation) →
`bakeGeneratedDays` (`web/src/lib/itinerary/bake.ts`): tiles = corpus tiles ∪
`resolved.map(resolvedToTile)`, key-stop names are flagged `curated: true` with
a `keyStopNote`, `alongRouteMiles` computes `milesFromStart` for every tile
against the day's own polyline, `deriveCorridorCities` builds the spine, then
`bucketPlacesIntoCorridor` buckets tiles under spine nodes by nearest-node
mileage → `itineraryToTrip` + `attachHeroPhotos` + persist. `enqueueResolvedPlaces`
feeds resolved places back to the corpus, non-fatally.

Two Google calls, disjoint field masks: generation-time `RESOLVE_FIELD_MASK`
(id/displayName/**location**/formattedAddress/types/primaryType — no rating,
photo, price, hours) vs render-time `DETAILS_FIELD_MASK` (adds those). This is
the structural, upstream reason a generated tile can never carry rating/photo
at write time — not a stripping step later.

**Shape (itinerary-model.md §7).** Measured on this trip: `segmentSuggestions`
on 15/15 days (min 2/max 7/median 3, 48 total), 41/48 (85%) `curated`, 44/48
carry `placeId`, **0 carry `photoUrl`, 0 carry `rating`**. Provenance: 44
`google:`-sourced, 4 `mp:`-sourced (corpus pool hits, day 1 only). Every tile
carries exactly `coords, cta, description, id, mention, milesFromStart,
photoAlt, pills, placeId, placeInfo, pullquote, stats, title` (+ `curated`,
`keyStopNote` where applicable). Day-membership itself is geometrically
derived — `foldFederatedCorridorSupply`/`fetchCorpusForSegment` runs a
16km-buffer PostGIS spatial query, so a corpus-sourced tile cannot lack
geometry by construction.

**Stored payload.** The above, persisted as `reference_trips.payload` jsonb —
baked, so `corridorCities` (spine + `placeIds` per node) is already computed
and stored, not deferred to serve time.

**Served (trip-resolution.md).** `getTrip` → both reference readers apply
`withCorridors(await withFederatedCorridorSupply(fromDb))`. **A baked payload
short-circuits both steps** — `expedition-ms28y793` is fully baked, so serve
performs no further transformation. Served output is generation's stored
output verbatim.

**Rendered day-detail card (place-render-model.md Part 1).** `placePool(day)`
(`day-detail-corridor-column.tsx:1182`) merges `segmentSuggestions ∪
day.suggestions ∪ waypoints` into `CorridorPlace[]` — unconditionally, with no
coords filter (see §4 below). `hydratePlaces(d)` grafts live
rating/reviewCount/photoUrl/category from the `/api/places/details`
client-side hydrate cache (keyed by `placeId`, one POST per newly-mounted day,
never persisted). `day-detail-corridor.tsx` then splits the pool: curated
picks that clear `canPosition` render in-spine at their mile; the rest of each
node's pool renders as `CategoryListCard`s under that node, sourced strictly
from `cities[].placeIds` (i.e. from server-side bucketing, not from the raw
pool). The card component itself
(`Pick<BrowsePlace, "title"|"photoUrl"|"photoAlt"|"rating"|"reviewCount">`,
place-render-model.md §3.1) accepts only those five fields.

**Rendered detail slideup (place-render-model.md Part 2).** Opened via
`dispatchPlaceDetail` (`day-detail-corridor-column.tsx:683`): a waypoint
passes its full record; a `segmentSuggestion` is synthesized into a `Waypoint`
via `browsePlaceToWaypoint` + `computeCardStats`, with `rating`, `reviewCount`,
`photoUrl` grafted from the same `hydrated` cache (`rich?.x ?? sug.x`), and
`logistics.hours` grafted separately when the hydrate response carries `hours`
(not part of the lossy `rich.x ?? t.x` merge — a distinct graft site,
place-render-model.md §4/§10). `priceTier` is fetched by the endpoint but
never grafted at either merge site.

---

## 2. Does generation's write path touch the "nice-to-have, unfed" fields?

Answer differs by field — the three named fields sit at three different
pipeline depths, not one:

- **`capacity` — YES, fetched, dropped at the TS mapper.** The
  `pois_along_corridor` RPC (`supabase/migrations/20260809130000_pois_along_corridor_ridb_photo.sql`)
  selects `mp.capacity` and returns it (`capacity jsonb` in the RETURNS TABLE,
  confirmed in the SQL). `MasterPlaceRow` (`web/src/lib/trip-browse/federated.ts:117`)
  types it. But `mapMasterPlaceRow` — the function generation's own corpus
  fold calls to turn an RPC row into the `BrowsePlace` tile — never reads
  `row.capacity` anywhere in its body (`federated.ts:147-216`). The value
  crosses the wire during generation and is discarded at that one mapping
  function. This is the "different, easier fix" case the task named: no new
  ingestion, no new RPC column, no schema work — `mapMasterPlaceRow` needs one
  more field on its return object.

- **`EV-socket-family` — NOT FOUND anywhere in the current pipeline.** No
  match for `ev_socket` in any migration or in `web/src/lib`. It is not a
  column on the RPC's RETURNS TABLE, not on `MasterPlaceRow`, and not
  referenced by any mapper. Unlike `capacity`, there is no evidence it is even
  materialized on `master_place` today — it may be folded, unlabeled, inside
  the untyped `amenities`/`access` jsonb blobs, or it may not exist in the
  corpus at all. This is a materially different (and unverified) claim than
  the manifest's "same [unfed] as capacity" framing — confirming its actual
  storage location would need a `data/` or DB-level check outside this
  investigation's scope (web code + docs only).

- **`land_manager`/`designation`/`gap_status` — present, but on a different
  table with no merge path to `master_place`.** `designation` (plus
  `legality_status`, `tenure_type`) exists on a PAD-US-fed overlay table
  defined in `supabase/migrations/20260606120000_phase3_legality_overlay.sql`
  — a staging/overlay shape (`source, source_id, geom, legality_status,
  designation, tenure_type, status, attrs`), not `master_place` itself. No
  `field_precedence`/`resolve_field()` path was found bringing it onto
  `master_place`, so it structurally cannot reach `pois_along_corridor`'s
  output (which only selects from `master_place` + a lateral `source_record`
  join) — confirming the manifest's characterization exactly, and locating
  the actual table. This is an earlier, deeper-pipeline-stage gap than
  `capacity`'s: a merge/precedence job is needed before there is anything for
  the RPC or the TS mapper to select.

None of the three is touched by the LLM or the generation-time Google call —
consistent with `RESOLVE_FIELD_MASK` (§1) not including any of them.

---

## 3. Slideup-specific fields not in the current manifest

Two fields, both in the same "plumbing exists, unfed" class already used for
`capacity`/`EV-socket-family` in the manifest — flagged as gaps, not proposed
as fixes:

- **`logistics.hours`** — fetched live by `/api/places/details`
  (`PlaceRich.hours`), grafted onto the synthesized slideup `Waypoint` at
  `day-detail-corridor-column.tsx:739-741`, rendered on the slideup. Entirely
  absent from the current manifest (not listed as required, nice-to-have, or
  otherwise) despite having a real, working data path and a real render
  consumer.
- **`priceTier`** (→ `logistics.entry`/`simulator.entryCost` via
  `priceTierToEntry`) — fetched by the same endpoint into `PlaceRich`, has a
  live downstream consumer, but is never grafted at either merge site
  (`day-detail-corridor-column.tsx`'s `synth()`, or the card's
  `rich.x ?? t.x` merge in place-render-model.md §4) — structurally the same
  "unfed" shape as `capacity`, just discovered on the slideup path rather than
  the card path.

Everything else the slideup shows beyond the card's five fields
(`reliability`, `amenities` (Waypoint-shaped), `factualNote`, `bookingStatus`,
`community.tips`, `community.lastVerified`, `simulator.stopTime`) is
Waypoint-fixture-only per place-render-model.md §10 — never sourced from the
corpus/generation pipeline for any placeId-bearing tile, so these are not
manifest gaps in the sense of "data the pipeline could deliver but doesn't
reach the card" — there is no pipeline path to them at all today.

---

## 4. Coords-filtering — single gate, or multiple failure points?

**Multiple, and they differ by whether the place is a curated key stop.**
This refines (does not simply confirm) both the original claim and
`itinerary-model.md` §2c-i's "unprojectable (no coords)" case.

**Ordinary (non-curated) pool places — one hard, silent gate, upstream of
bucketing.** `resolveCorridorCities`'s pool-assembly loop
(`resolve-corridor-cities.ts:181-191`) drops any place with `!p.coords` before
`bucketPlacesIntoCorridor` ever runs:
```
for (const p of [...segmentSuggestions, ...Object.values(suggestions), ...waypoints]) {
  if (!p.coords || seen.has(p.id)) continue;
  ...
}
```
A place dropped here never enters any city's `placeIds`, and `bucket.ts`
itself has no independent coords check (its `BucketPlace.coords` is typed
non-optional, so a coords-less place could never even be passed to it — the
filtering has to happen before that call, which is exactly what this loop
does). Separately, `day-detail-corridor.tsx`'s render only pulls
non-curated tiles from `cities[].placeIds` (`sortClusterByRank(item.city.placeIds, ...)`)
— never from the raw pool. Client-side `placePool()`
(`day-detail-corridor-column.tsx:1182`) has **no coords filter at all** and
still includes such a place in `places`/`byId`, but nothing in the render tree
ever looks it up by anything other than `city.placeIds` membership for a
non-curated tile. **Net effect: present in memory, referenced nowhere,
genuinely silent** — matching the original "hard requirement, silent drop"
characterization, for this population.

Is this reachable at all? For a **generated** trip, no — corpus tiles are
PostGIS-derived (geometry-guaranteed) and `resolvedToTile` (`bake.ts:48-54`)
sets `coords: rp.coords` from Google's resolved location, so a generated
trip's tiles cannot lack coords by construction; `resolveCorridorCities` isn't
even in this trip's path (baked trips short-circuit it at serve, per §1). For
a **reference/hand-authored** trip, yes — `Waypoint.coords` is optional
(place-render-model.md §1.1), so an authored waypoint genuinely can be stored
without coords, and `resolveCorridorCities`'s pool filter is exactly the gate
that then silently excludes it at serve time. **So: one gate, but it is
real only on the reference-trip path, not the generation path.**

**Curated key stops — a different, render-time gate with an explicit
fallback.** Curated picks (`curated: true`) are never subject to the pool
filter above — they reach the client already coords-complete (same
construction guarantee: pool-hit picks are corpus tiles, live-resolved picks
get coords from `resolvedToTile`). What can still exclude one from the spine
is a **geometric positionability check**, not a null-coords check:
`canPosition(p) = roundTrip ? !!p.coords && !!cities[0]?.coords :
positioned.has(p.id)`, where `positioned = positionPlacesOnDay({line:
routeLine, places: curatedPicks, dayStartMile})` (`day-detail-corridor.tsx:447-458`).
A pick fails this when the day/trip has no usable `routePolyline` to decode
(an unbaked or pre-corridor-engine trip) or the projection algorithm can't
place it against that line — not literally "coords is undefined" for a
generated trip's curated pick, since that value is structurally guaranteed
present. A pick that fails renders in the **"Today's Key Stops" fallback
block** (`day-detail-corridor.tsx:586-615`) instead of in-spine — visible, not
dropped. This is the mechanism `itinerary-model.md` §2c-i describes; its
"(no coords)" phrasing is the rarer of the two real triggers (a genuinely
coords-less curated pick could only arise from a hand-authored reference
waypoint flagged curated, which is possible but unmeasured here) — "no
positionable polyline" is the one actually exercised by the generation path.

**Bottom line for task #4:** the coords requirement is real and hard, but it
is enforced at **two different points for two different populations** —
silently at pool-assembly for ordinary places (real risk only on
hand-authored/reference trips, since generation can't produce a coords-less
tile), and visibly-with-fallback at render for curated key stops. A
coords-less place is never written to the DB and left to "vanish only at
render time" with no trace anywhere — the worse failure mode the task asked
about does not occur on either path; the failure, where it happens at all, is
at pool-assembly (before bucketing), consistently, not scattered across
render.

---

## 5. Verdict

**The current manifest is materially correct on its REQUIRED/NICE-TO-HAVE
split and on its characterization of `capacity` and `land_manager`, but it has
two gaps surfaced by tracing the full pipeline instead of the card in
isolation:**

1. **Add to the manifest (slideup-specific, both "nice-to-have, unfed"
   class):**
   - `logistics.hours` — real fetch, real render consumer (slideup), zero
     manifest presence today.
   - `priceTier`/`logistics.entry` — real fetch, real downstream consumer
     (`priceTierToEntry`), never grafted at either merge site.
2. **Sharpen, don't just repeat, the existing "unfed" entries** — the
   generic "DB column + precedence exist, unfed" framing collapses three
   distinct situations that this trace found to have different fixes at
   different layers:
   - `capacity`: fetched over the wire during generation, dropped at
     `mapMasterPlaceRow` — a single-file TS change.
   - `land_manager`/`designation`/`gap_status`: sitting on a separate
     PAD-US overlay table with no merge path onto `master_place` — needs
     `field_precedence`/`resolve_field()` work before the RPC or mapper have
     anything to select.
   - `EV-socket-family`: not located anywhere in the current pipeline code at
     all (not the RPC, not the row type, not any mapper) — its manifest entry
     currently asserts a specific "unfed but present" state this trace could
     not confirm; it may need re-verification against `data/` ingestion code
     or the DB schema directly before the entry's wording is trusted.
3. **No new gap on the coords/REQUIRED side.** The trace confirms coords is
   the right hard requirement, refines exactly where/how it's enforced (§4),
   and finds no additional failure mode beyond what the manifest already
   implies with "silent drop, not degrade."

No other manifest field's classification was contradicted by this trace.
