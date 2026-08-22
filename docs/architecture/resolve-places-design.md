# `resolvePlaces()` — design

**Status:** Designed + built as an ADDITIVE service, 2026-08-22. **Nothing is cut over to it.**
`/api/search-area`, `/api/trip-browse/:tripId/:dayId` and `POST /api/places/details` are
untouched and remain the live paths.
**Implements:** step 2 of `docs/decisions/2026-08-21-place-data-resolver-consolidation.md`
(step 1 — the nullable `master_place` columns — merged as #247, `4f2a6af`).

Evidence convention per `trip-resolution.md`. Every claim about current behaviour below
is tagged `[read source]` and was re-read in full during this session, not recalled.

---

## 0. What this session did and did not do

| | |
|---|---|
| Built | `web/src/lib/places/place-id.ts` (id normalization), `web/src/lib/places/resolve-places.ts` (the service) |
| Tested | id normalization exhaustively; merge/dedupe and scope-branching behaviourally, through a dependency seam |
| **Not** done | no route changes, no component changes, no `Day.waypoints` change, no shared client cache, no deletion or modification of the three endpoints |

`resolvePlaces()` is callable and has zero importers in `src/app` or `src/components`
— deliberately. It is correct in isolation, not yet load-bearing.

---

## 1. The three endpoints as they stand

### 1a. `GET /api/search-area?bbox=W,S,E,N&q=&categories=` `[read source]`

Corpus-wide "search this area", no day context.

- **LIVE.** Two mutually exclusive paths. `q` present → `discover()` with
  `[googleTextSearchSource]` **only** (the comment states FSQ has no text path).
  Otherwise → `discover()` with `[googlePlacesSource, foursquareSource, recGovSource,
  usfsSource, blmSource]`, over slide keys derived from the requested corpus categories
  through `LIVE_SLIDE_FOR_PRIMARY`.
- **FEDERATED.** Typesense `search({query, categories, bbox, limit: LIMIT})` → ids →
  `hydratePlacesByIds()`, which reads `master_place` **and**
  `master_place_search_export` with the **service-role** client and merges them by id.
- **Merge.** Concatenate live-then-federated, keep first occurrence per `id`. The
  comment asserts the id namespaces are distinct so no cross-source dedupe is needed.
- Constants: `LIMIT = 24`; `hydratePlacesByIds` caps at `MAX_IDS = 50`.
- Response: `{ source, places, counts: {live, federated}, failedSources, sourceErrors? }`.
  `sourceErrors` is gated behind `?debug=1` / `SEARCH_DEBUG_ERRORS=1` because a Supabase
  error can name table internals.
- Cache: in-process LRU, 15 min, 200 entries, keyed on rounded bbox + q + sorted
  categories. **Only caches when `failedSources` is empty.**

### 1b. `GET /api/trip-browse/:tripId/:dayId?category=|categories=` `[read source]`

Browse-the-day, corridor-scoped.

- Loads the trip via `getTrip(tripId)`, finds the day, derives `dayStart` (previous
  day's `coords`, or `trip.startCoords` on day 1) and `dayEnd = day.coords`.
- Fixture fast path for `la-to-portland`, **single-category requests only**.
- **LIVE.** One `discover()` per requested slide key, each over per-endpoint bboxes
  sized by `RADIUS_KM_BY_CATEGORY` (food 5 km … camping 50 km), sources
  `[googlePlacesSource, recGovSource, foursquareSource, usfsSource, blmSource]`.
- **FEDERATED.** Behind `USE_FEDERATED_POIS` (env, default off). `fetchFederatedPois()`
  → `pois_along_corridor` **SECURITY DEFINER RPC** via the anon+JWT server client,
  `p_buffer_m = FEDERATED_BUFFER_M = 16000`, categories from
  `SLIDE_TO_PRIMARY_CATEGORY`. Any RPC error → `[]` (falls back to live, never breaks).
- **Post-filter.** Cross-category dedupe by `id`, then drop anything further than
  `CORRIDOR_MI = 10` from the two-point day segment, then sort ascending by haversine
  from `dayStart`.
- Response: `{ source: "fixture" | "discovery", places }`.
- Cache: 15 min, 200 entries, keyed tripId + dayId + sorted categories. **Caches
  unconditionally**, unlike search-area.

### 1c. `POST /api/places/details  { placeIds: string[] }` `[read source]`

- Batches ids `BATCH_SIZE` at a time, batches sequential, ids within a batch concurrent.
- Per-id 15-min LRU, 1000 entries, keyed by Google place_id.
- Returns `{ details: Record<placeId, PlaceRich> }` where
  `PlaceRich = {rating?, reviewCount?, priceTier?, photoUrl?, hours?, category?}`.
- A resolved-but-empty `{}` is deliberately returned (a real place Google has nothing
  to add about); only `null` — missing key, network error, non-OK HTTP — is withheld,
  **and `null` is cached**, which is the documented 15-minute negative-cache trap.

---

## 2. ⚠ Divergences — flagged, NOT silently reconciled

The ADR says "one signature replaces three endpoints". These are the places where that
cannot be a mechanical merge because the endpoints genuinely disagree. **Each is called
out here and left as an explicit decision for cutover, not resolved by `resolvePlaces()`
picking a winner.** Where the built service had to do *something*, it does the
conservative thing and the choice is named.

### D1. The two endpoints speak different category vocabularies, and the maps are not inverses

`search-area` takes **corpus `primary_category`** (`campground`, `gas_station`).
`trip-browse` takes **`SlideCategoryKey`** (`camping`, `fuel`).

They translate through two *different, hand-maintained* maps that are not round-trip
equivalent: `LIVE_SLIDE_FOR_PRIMARY` (search-area, route-local) is deliberately a
**subset** — "only where Google has honest type coverage", so overland-only primaries
run federated-only — while `SLIDE_TO_PRIMARY_CATEGORY` (`trip-browse/federated.ts`) is
the full canonical map. `campground → camping` one way; `camping → [dispersed_camping,
campground, recreation_area, facility, rv_park, camping_cabin]` the other.

**Not reconcilable by picking one.** `resolvePlaces()` therefore keeps both vocabularies
in the scope discriminator: `bbox` scope takes `primary_category[]`, `day-corridor` scope
takes `SlideCategoryKey[]`, exactly as the endpoints do now. **Collapsing them to one
vocabulary is a real product decision** — it changes which places a given chip returns —
and is deferred.

### D2. There are THREE different doors into `master_place`, with different membership rules

| path | door | filters |
|---|---|---|
| search-area | service-role read of `master_place` + `master_place_search_export` | `is_searchable`, `≠ land_status`, `isSuppressedCategory()` client-side |
| trip-browse | `pois_along_corridor` SECURITY DEFINER RPC | searchable, non-land_status, **`source_count > 0`**, **excludes template-only descriptions**, **excludes `needs_review`** |
| places/details | none — pure Google | — |

**The RPC excludes template-only-description rows and `needs_review` rows
(`20260821050000`); the search-hydrate path does not.** So the same place can be
corridor-invisible and search-visible. That is a live corpus-membership divergence, not
a style difference, and it is **not** something a resolver should paper over — whichever
rule wins changes what users see. Flagged; unresolved.

### D3. `POST /api/places/details` does not return places at all

It returns **enrichment fragments keyed by Google place_id**, to be grafted onto tiles
that already exist client-side. It is a `Record<string, PlaceRich>`, not a
`BrowsePlace[]`.

Folding it into a `BrowsePlace[]`-returning resolver is **not** a like-for-like
substitution — the caller's contract is "patch what I already have", not "give me
places". `resolvePlaces()` models this as *enrichment applied during resolution* (§4c):
a federated place carrying a `placeId` can have live Google rich fields merged onto it
before it is returned. **That is a behaviour change relative to the endpoint**, because
the endpoint lets the client decide when to hydrate and the resolver decides for it.
Whether Date Detail can accept that is a cutover question. Enrichment is therefore
**opt-in and off by default** (`enrich: false`).

### D4. Live source list ORDER differs, and order is load-bearing

search-area: `[google, foursquare, recGov, usfs, blm]`.
trip-browse: `[google, recGov, foursquare, usfs, blm]`.

`discover()` flat-maps sources → results in array order, and `dedupe()` keeps the **first**
result of a group as the canonical one for title/coords/description
(`toBrowsePlace` uses `results[0]`). So when Google has no result for a place, whether
Foursquare or Recreation.gov supplies the title depends on which endpoint asked. A
one-line difference with a user-visible effect. `resolvePlaces()` takes the source list
as a parameter with a named default rather than silently standardising.

### D5. Nothing paginates, in three different ways

search-area bounds the corpus half at 24 (then 50 inside hydrate) and leaves the live
half unbounded. trip-browse bounds nothing and instead filters by corridor distance.
places/details serves every id, in batches. **There is no cursor, offset, or total count
anywhere.** So "unify pagination" has no existing behaviour to preserve — introducing
one is new surface area, and this design does not. `limit` is a plain post-merge cap.

### D6. Cache grain differs and cannot be one cache

Response-level (bbox+q+categories) vs response-level (trip+day+categories) vs
**per-id** (place_id). The third is a different key space entirely and is what makes the
15-minute negative cache observable. `resolvePlaces()` deliberately has **no cache of its
own** — ADR step 4 puts the shared cache on the client (React Query, keyed by canonical
id). Adding a server cache here would be a second, competing cache.

### D7. `BrowsePlace.source` is inconsistently populated today

trip-browse tags `source: "live"` **only when `USE_FEDERATED_POIS` is on**; flag-off
results are untagged. search-area never tags live results, but `mapMasterPlaceRow` always
tags federated ones `"master_place"`. `resolvePlaces()` tags **every** place
unconditionally. This is a deliberate divergence from both endpoints, made because a
provenance field that is sometimes absent is exactly the branch the ADR is trying to
delete. Named here because it changes the payload.

### D8. `interest` and `urban` are reachable in one endpoint and not the other

Both are members of `SlideCategoryKey` and both have entries in
`SLIDE_TO_PRIMARY_CATEGORY`, but `trip-browse`'s `SLIDE_CATEGORIES` excludes them ("their
live query sets are empty"). So they are corpus-reachable via search-area and not via day
browse. `resolvePlaces()` accepts them in `day-corridor` scope and routes them
federated-only. Divergence named.

### D9. Corridor geometry is a two-point line, not the day's real polyline

Both the client-side filter and the RPC use `[dayStart, dayEnd]`
— `fetchFederatedPois`'s comment says this is "exact parity with the current corridor,
not the real per-day polyline (deferred)". Preserved as-is; not fixed here.

---

## 3. Id normalization

### 3a. The three (really eight) id forms in play `[read source]`

| form | example | where |
|---|---|---|
| `master_place.id` | `531b1c71-…` bare uuid | the DB column; `SearchResult.id`; `hydratePlacesByIds` input |
| tile id | `mp:531b1c71-…` | applied at `federated.ts` in `mapMasterPlaceRow`, **never stored** |
| Google place_id | `ChIJ…` | `BrowsePlace.placeId` (bare) and the `POST /api/places/details` key |
| live Google id | `gpl/ChIJ…` | `BrowsePlace.id` from `googlePlacesSource` |
| live Foursquare | `fsq/…` | `foursquare.ts` |
| live Recreation.gov | `ridb/…` | `rec-gov.ts` |
| live USFS | `usfs/…` | `usfs.ts` |
| live BLM | `blm/…` | `blm.ts` |
| live OSM | `node/…` | `overpass.ts` |

Two things this table makes obvious and the ADR's "add a normalization step" phrasing
does not:

1. **Federated uses `:` and live uses `/`.** `mp:<uuid>` vs `gpl/<id>`. Not one scheme
   with different prefixes — two schemes.
2. **The live prefix is NOT the `SourceId`.** `SourceId` is `google` / `foursquare` /
   `rec-gov` / `osm`; the prefixes are `gpl` / `fsq` / `ridb` / `node`. An explicit map
   is required; deriving one from the other would be wrong for four of six sources.

### 3b. The model

```ts
type CanonicalPlaceId =
  | { kind: "master_place"; uuid: string }          // canonical: `mp:<uuid>`
  | { kind: "live"; source: LiveIdSource; externalId: string } // canonical: `<prefix>/<externalId>`
  | { kind: "google_place"; placeId: string }       // canonical: `gpl/<placeId>`
  | { kind: "opaque"; raw: string };                // unrecognised — preserved verbatim
```

Rules, each pinned by a test:

- **`mp:<uuid>` and a bare `<uuid>` parse to the SAME canonical id.** This is the
  round-trip the ADR needs: `Day.waypoints` may hold either form today, and the tile
  projection adds `mp:` only at render.
- **UUIDs normalize to lowercase**; `MP:` / `mp:` prefix is case-insensitive. UUID hex is
  case-insensitive and Postgres emits lowercase, so `MP:ABC…` must equal `abc…`.
- **Live external ids are NEVER case-folded.** Google place ids and Foursquare ids are
  opaque case-sensitive tokens. Only the *prefix* is matched case-insensitively.
- **A Google place id stays distinct from a `master_place`.** `gpl/ChIJ…` never collides
  with `mp:<uuid>`, and a federated place carrying `placeId: "ChIJ…"` keeps its
  `mp:` identity — the Google id is an *attribute*, not the identity. This is the exact
  case the ADR calls out.
- **`google_place` is only reachable via an explicit constructor**
  (`googlePlaceId(raw)`), never by guessing at a bare string. A bare non-uuid with no
  known prefix is `opaque`, not "probably Google".
- **Malformed input never throws.** `mp:not-a-uuid`, `""`, `"   "`, `mp:` alone,
  `gpl/` alone → `opaque` (or `null` from the strict parser), preserved verbatim so a
  bad id degrades to "not found" rather than crashing a merge.
- **Idempotent.** `toCanonicalString(parse(toCanonicalString(parse(x)))) === toCanonicalString(parse(x))`.

---

## 4. The signature

```ts
resolvePlaces(input: ResolvePlacesInput): Promise<ResolvePlacesResult>
```

### 4a. Scope — one discriminated union, three shapes

```ts
type ResolveScope =
  | { kind: "ids"; ids: string[] }
  | { kind: "bbox"; bbox: [w,s,e,n]; query?: string; categories?: string[] }   // primary_category
  | { kind: "day-corridor"; start: Coord; end: Coord;
      categories: SlideCategoryKey[]; bufferMeters?; corridorMi?; radiusKmByCategory? }
```

`day-corridor` takes **coordinates, not a `tripId`/`dayId`**. The endpoint resolves the
trip itself; making the resolver do that would couple a place service to the trip
repository and to RLS. The caller resolves the day and passes its endpoints. Named as a
deliberate difference from 1b.

### 4b. Branching to LIVE vs FEDERATED

| scope | LIVE | FEDERATED |
|---|---|---|
| `ids` | Google Place Details for ids that are `google_place`/`gpl/` | `hydratePlacesByIds()` for `master_place` ids |
| `bbox` + `query` | `discover([googleTextSearchSource], textQuery)` | Typesense `search()` → `hydratePlacesByIds()` |
| `bbox` + `categories` | `discover(defaultBboxSources)` over slide keys mapped via `LIVE_SLIDE_FOR_PRIMARY` | Typesense `search()` → `hydratePlacesByIds()` |
| `day-corridor` | one `discover()` per slide key over per-endpoint bboxes | `fetchFederatedPois()` → `pois_along_corridor` per slide key |

Both halves run concurrently and **independently fail soft**: a thrown half contributes
`[]` and its source name lands in `failedSources`, mirroring search-area's posture
(the stricter of the two — trip-browse silently swallows). Either half can be disabled
via `include: { live?, federated? }`, which is how a caller reproduces
`USE_FEDERATED_POIS = false` without the resolver reading env.

### 4c. Enrichment (the `places/details` role) — opt-in, default OFF

When `enrich: true`, after the merge, every place carrying a `placeId` is looked up
through the same `placeDetails()` the endpoint uses, batched the same way, and the rich
fields are grafted on **without overwriting a value the place already has** (`??`, not
`=`). Off by default because of D3.

### 4d. Merge, dedupe, order

1. Concatenate live, then federated — matching search-area's order, so live wins ties.
2. Dedupe on **canonical id**, not raw `id`. This is stronger than either endpoint: it
   catches `mp:<uuid>` colliding with a bare `<uuid>`, which raw-string dedupe misses.
3. Then `sameSpot()` dedupe (the existing category + ~80 m + fuzzy-name heuristic,
   reused, not reimplemented) across the live/federated boundary. **Neither endpoint does
   this today** — search-area's comment explicitly says distinct namespaces make it
   unnecessary. It is opt-in via `crossSourceDedupe` (default **off**) so the default
   path stays behaviourally close to today.
4. `day-corridor` only: corridor filter then distance-from-start sort, as 1b.
5. `limit` caps post-merge.

### 4e. Return shape

```ts
type ResolvePlacesResult = {
  places: BrowsePlace[];           // unchanged type — no new card shape
  counts: { live: number; federated: number; deduped: number };
  failedSources: string[];
  sourceErrors?: Record<string, string>;  // only when includeErrorDetail
};
```

`BrowsePlace` is used **as-is**. Every place gets `id` = canonical string and `source`
set (D7). Step 1's new `master_place` columns (`rating`, `review_count`, `price_tier`,
`photo_url`) are **not** read here — `hydratePlacesByIds` and `pois_along_corridor` do
not select them yet, and widening either is a separate change to shared code that other
callers use. Flagged as the natural next step, deliberately out of scope.

---

## 5. Known gaps

1. **Web tests do not run in CI.** `.github/workflows/ci.yml`'s `test` job runs
   `npm run -w data test` only, and `web/package.json` has no `test` script
   `[read source]`. The tests added here run via `npx tsx --test` per the RUNBOOK and are
   **not** enforced on merge. Pre-existing, not introduced here, but it means "verified by
   tests" holds only for whoever runs them.
2. **No live end-to-end run.** The service is verified through a dependency seam with
   fakes. It has not been executed against TEST Supabase, Typesense, or Google — nothing
   imports it, and standing it up would require the cutover this session is forbidden to
   do.
3. **Step 1's columns are unread** (§4e).
4. **D1–D9 are all unresolved by construction.**
