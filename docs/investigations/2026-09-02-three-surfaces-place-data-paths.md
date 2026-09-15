# Investigation — how three UI surfaces get their place data

**Date:** 2026-09-02
**Branch:** `port-louis`
**Mode:** READ-ONLY. No code changed, nothing run against TEST or PROD, no live
index or DB queried.

**Diagram:** [Three-Surface Place-Data Investigation](https://app.paper.design/file/01M1J6KY3S5MNZM3P2ZF7WJG3A)
(Paper) — visual walk of the three call chains below, the two flag forks, and
the two deduced-not-reproduced annotations. Built with `paper-desktop`
code-to-design from this doc, styled against `web/src/app/globals.css`
tokens.

## Scope and method

Adam supplied screenshots of three surfaces and asked for the *actual* code
paths, not guesses. Every claim below is from reading source at the commit
`9d936af` tree. **No runtime measurement was taken** — where a conclusion is a
code-path deduction rather than an observation, it says so.

Numbers in this doc are counts derived by reading the cited source in this
investigation (enumerating literals in a list). None are measurements of live
data, and none are quoted from a prior session.

**Where the flags stand.** All four cutover/data flags read `process.env` and
default OFF:
`SEARCH_AREA_USE_RESOLVER`, `TRIP_BROWSE_USE_RESOLVER`,
`DATE_DETAIL_USE_RESOLVER`, `USE_FEDERATED_POIS`. **None of them is set in
`web/.env.local` or `web/.env.development.local`** `[grepped 2026-09-02]`, so
locally all three surfaces run their legacy paths. **The deployed Vercel
environment is not readable from the repo — this doc does not claim what the
flags are in production.**

---

## Surface 1 — "Explore N more near [City], CA →"

### Component

`web/src/components/trip/day-detail-corridor.tsx:1112-1124`, inside the
`CityNode` sub-component. The label is built at line 1120:

```tsx
{expanded ? `Hide ${rest.length} more ↑`
          : `Explore ${rest.length} more near ${city.name} →`}
```

`city.name` is `CorridorCity.name`, documented as a display label of the form
`"Los Angeles, CA"` (`web/src/lib/trips/types.ts:286-287`) — which is where the
`, CA` in the screenshot comes from.

Note there are **two** similar links in this file. The other one
(`day-detail-corridor.tsx:1049-1058`, `"Explore more {city.name} →"`, no count)
renders only when `curatedMode` is false and is wired to `noop` — an
unimplemented stub. The screenshot's link carries a count, so it is the
`curatedMode` one at line 1120.

### Data-fetching call

**None. This control fetches nothing.**

Its `onClick` is `setExpanded((e) => !e)` — a local `useState` toggle in
`CityNode`. It reveals `rest`, an array already computed from the component's
`places` prop. `DayDetailCorridor` is declared PURE PRESENTATIONAL in its own
header comment (`day-detail-corridor.tsx:26-42`) and does no I/O.

The places themselves come from the persisted trip payload, not a fetch:
`DayDetailCorridorColumn` builds them with `hydratePlaces(d)` →
`placePool(day)` (`day-detail-corridor-column.tsx:826-827`, `:1251`), which
reads `day.segmentSuggestions` and `day.suggestions` out of
`public.trips.payload`.

### The enrichment that *does* touch Google — and why it isn't this link

`day-detail-corridor-column.tsx:308-351` runs a `useEffect` that POSTs to
`/api/places/details` with the place_ids of the mounted day set. Two things
matter:

1. Its dependency array is `[hydrateKey]` — a join of the **mounted day ids**
   (`:294-299`). Expanding a city node does not change it.
2. Its input is `placePool(d)` — the **whole** day pool, including the tiles
   still collapsed behind this link (`:315`).

So the collapsed tiles are hydrated at day-mount, before the user ever clicks.
**Clicking "Explore N more" issues zero network requests; it reveals cards
whose enrichment already completed (or already failed).**

A second, distinct `/api/places/details` call exists at
`day-detail-corridor-column.tsx:787` — a fetch-on-open fallback for a single
place when the Details overlay opens on a tile the batch hydrate missed. That
fires from `onOpenPlace`, i.e. clicking a **card**, not the explore link.

### Ultimate upstream

`POST /api/places/details` → `fetchDetailsMap` (`handler.ts:55`) → either
`placeDetails()` (`lib/discovery/google-places.ts:309`,
`https://places.googleapis.com/v1/places/{placeId}`) when
`DATE_DETAIL_USE_RESOLVER` is OFF, or `enrichByGoogleId()`
(`lib/places/resolve-places.ts:544`) when ON — which calls the same
`placeDetails`. **Both branches are Google Place Details.** Results sit in a
15-minute in-process cache (`route.ts:38`) and are never persisted.

### resolvePlaces() or legacy?

The link: neither — no resolver involved, no fetch at all.
The enrichment behind it: **`enrichByGoogleId()` is a `resolve-places.ts`
export, but it is not `resolvePlaces()`.** It's the enrich-by-id capability
carved out of the same module. And it's only reached with
`DATE_DETAIL_USE_RESOLVER=true`; default is the legacy inline loop
(`handler.ts:67-90`).

### Path mapping — **correcting the guess**

Adam's guess: Surface 1 → path D (place-details enrichment).

**Partly right, and the mismatch matters.** The *cards* in this corridor view
are enriched by path D. **The "Explore N more" control itself maps to no path
A–E**, because it makes no data call of any kind. It is a pure client-side
disclosure toggle over data already in hand.

If the intent behind the question was "does dismantling Google break this
link?" — the link keeps working. What degrades is the photos/ratings/hours on
the cards it reveals, and that degradation is already present before the click.

---

## Surface 2 — day-scoped browse ("Browsing today Day N within 10 miles of route")

**Diagram:** [Surface 2 Data Flow](https://app.paper.design/file/01M1J899REAQ46Z068V3W9Z1ZW)
(Paper) — flowchart of this surface's call chain alone: chip tap → the route
call below → the `TRIP_BROWSE_USE_RESOLVER` fork (active `viaLegacy()` vs.
dormant `viaResolver()`) → the per-category Mapbox/Google split → the
deduced-not-reproduced urban/interest 400 risk → render. A separate dashed box
covers the unrelated `USE_FEDERATED_POIS` flag. Built with `paper-desktop`
code-to-design from this section, styled against `web/src/app/globals.css`
tokens.

### Components

- `web/src/components/trip/category-browse-panel.tsx` — the panel. Header
  string at `:179-183`; the `10 miles` is a hardcoded literal in the JSX, and
  matches `CORRIDOR_MI = 10` in the handler
  (`app/api/trip-browse/[tripId]/[dayId]/handler.ts:52`).
- `web/src/components/trip/category-filter-row.tsx` — the icon row. It renders
  `BROWSE_CARD_CATEGORIES` (`lib/trip-browse/palette.ts:17-27`), **9 chips**:
  camping, scenic, attraction, oddity, food, fuel, hotel, urban, interest.
  That matches the 9 icons in the screenshot.
- `web/src/components/trip/location-browse-card.tsx` — the POI cards. The CTA
  label is `` `Add to Day ${dayNumber}` `` at `:139` (uppercased by styling).
  Useful disambiguator: Find Nearby (Surface 3) overrides this to
  `addLabel="Add to a day"` (`find-nearby-panel.tsx:815`), so an
  "ADD TO DAY N" button confirms the screenshot is this surface.

### Data-fetching call

`category-browse-panel.tsx:314-343`:

```
GET /api/trip-browse/{tripId}/{dayId}?categories={csv}
```

`categories` is built at `:306-312` from the active chip set — comma-joined
slide keys, or the literal `all` when no chip is selected.

### The chain

`route.ts` (thin wrapper: validate → 15-min LRU cache → fixture fast path →
resolve day geometry) → `produceBrowsePlaces()` (`handler.ts:96`), which forks
on `TRIP_BROWSE_USE_RESOLVER`:

- **OFF (`viaLegacy`, `handler.ts:140`)** — one `discover()` per category over
  `LIVE_SOURCES` (`handler.ts:58-65`), bboxes built around the day's two
  endpoints, then a `CORRIDOR_MI` filter and a distance-from-day-start sort.
- **ON (`viaResolver`, `handler.ts:107`)** — `resolvePlaces()` with
  `scope.kind = "day-corridor"`, explicitly **no** `enrich` (`:132`). Falls
  back to `viaLegacy` when either day endpoint is missing (`:116`).

The federated half is gated separately by `USE_FEDERATED_POIS` and, when on,
calls the `pois_along_corridor` SECURITY DEFINER RPC
(`lib/trip-browse/federated.ts:327`) — the corpus/master_place half.

### Ultimate upstreams

Live sources, in list order (`handler.ts:58-65`, mirrored in
`resolve-places.ts`'s `DEFAULT_CORRIDOR_LIVE_SOURCES`):
`mapboxSearchBoxSource`, `googlePlacesSource`, `recGovSource`,
`foursquareSource`, `usfsSource`, `blmSource`.

- **Google** — `https://places.googleapis.com/v1/places:searchNearby`
  (`lib/discovery/google-places.ts:19`). Per `TYPES_BY_CATEGORY` (`:41-63`)
  Google still serves food, scenic, attraction, camping, overnight.
- **Mapbox** — `https://api.mapbox.com/search/searchbox/v1/category`
  (`lib/discovery/mapbox-search-box.ts:41`). Fuel only:
  `TYPES_BY_CATEGORY.fuel` was emptied to `[]` (`google-places.ts:59`) in the
  2026-08-25 compliance swap.
- **Corpus** — `pois_along_corridor` RPC, when `USE_FEDERATED_POIS=true`.

### resolvePlaces() or legacy?

**Dual-path, flag-selected.** Legacy discover-fanout by default; `resolvePlaces()`
day-corridor scope under `TRIP_BROWSE_USE_RESOLVER=true`. The cutover is built
and tested (`handler.test.ts` drives all four flag combinations, including one
case through the real `resolvePlaces`), but the flag is not enabled locally.

### Path mapping — **confirming the guess**

Adam's guess: Surface 2 → path B (day-scoped browse). **Confirmed.** This is
exactly `/api/trip-browse/:tripId/:dayId`, and Google `searchNearby` sits in
both flag branches.

One qualification: since the 2026-08-25 swap, **fuel on this surface is Mapbox,
not Google.** Path B's remaining Google dependency is the non-fuel categories.

### Incidental finding — the `urban` / `interest` chips look like they 400

Flagged because it is directly about how this surface gets its data. **Deduced
from code reading; NOT reproduced at runtime.**

`browseCategoryToSlide` is now total — it returns `"urban"` for `urban` and
`"interest"` for `interest`, never null (`palette.ts:58-63`, and its own comment
says so). But the panel's `apiCategories` still filters on `k !== null`
(`category-browse-panel.tsx:310`), which can no longer drop anything, and the
route validates the incoming set against `SLIDE_CATEGORIES`
(`route.ts:16-24`) — a 7-key list that deliberately **excludes** `urban` and
`interest` because their live query sets are empty.

So selecting the urban or the interest chip appears to send
`?categories=urban`, hit the `bad` branch at `route.ts:133-141`, and return
**400** — which the panel surfaces as an `HTTP 400` error box, not the empty
state its comment at `:302-305` predicts. The route is using one constant as
both "what `all` expands to" and "what is a legal request", and those two want
to differ for corpus-backed buckets.

Needs a runtime check before anyone acts on it.

---

## Surface 3 — "Find on: Current Location" category picker

### Component

`web/src/components/trip/find-nearby-panel.tsx`.

- `FindScopeHeader` (`:839-890`) renders `Find on:` + the `Current Location`
  pill. Read the comment at `:840-842` carefully: **"Current Location" does not
  mean GPS.** It is the current **map viewport**, refreshed as the user
  pans/zooms. The `aria-label` says so explicitly.
- `BUCKETS` (`:84-236`) is a hardcoded literal: **6 buckets** — CAMP & EXPLORE,
  FUEL & REPAIR, FOOD, SUPPLY, SERVICE, STAY — holding **13 tiles**.
- `SearchAreaResults` (`:507`) does the fetching.

### Data-fetching call

`find-nearby-panel.tsx:557-610`, 200 ms debounced:

```
GET /api/search-area?bbox={W,S,E,N}&(q={text} | categories={csv})
```

The bbox is read at fetch time via `getViewportBbox()` (`:561`); with no bbox
the panel refuses to search and shows *"Map isn't ready yet"* (`:569-572`).
Free-text wins over a tile; otherwise `categories` is the tile's
`primaryCategories` joined (`:575-576`). Re-fires on Enter (`submitNonce`) and
on map `moveEnd` (`moveNonce`).

### The chain

`app/api/search-area/route.ts` → `resolveSearchArea()`
(`app/api/search-area/handler.ts:82`), forking on `SEARCH_AREA_USE_RESOLVER`:

- **OFF (`viaLegacy`, `:122`)** — two halves in parallel:
  - **live**: free-text → `googleTextSearchSource` alone (`:143`); category
    tiles → `discover()` over `[mapboxSearchBoxSource, googlePlacesSource,
    foursquareSource, recGovSource, usfsSource, blmSource]` (`:167-174`), but
    **only after mapping each requested `primary_category` through
    `LIVE_SLIDE_FOR_PRIMARY`; unmapped ones drop out and the live half returns
    `[]`** (`:151-158`).
  - **corpus**: `search()` (`lib/search.ts`) against the Typesense `places`
    collection, faceted on `primary_category` and geo-filtered by bbox, then
    `hydratePlacesByIds()` (`lib/trip-browse/hydrate.ts`) to project rows into
    cards.
- **ON (`viaResolver`, `:93`)** — `resolvePlaces()` with `scope.kind = "bbox"`,
  no `limit` and no `enrich` (`:105-110`). Its federated half
  (`resolve-places.ts:485-497`) calls the **same** `search()` +
  `hydratePlacesByIds()`.

### Ultimate upstreams

- **Google** — `places:searchText` (`google-places.ts:20`) for free text;
  `places:searchNearby` (`:19`) for tiles whose primaries map into
  `LIVE_SLIDE_FOR_PRIMARY`.
- **Mapbox Search Box** — fuel only.
- **Corpus** — Typesense `places` → `master_place` + `master_place_search_export`
  via the service-role read in `hydrate.ts`.

### resolvePlaces() or legacy?

**Dual-path, flag-selected**, same shape as Surface 2. Legacy by default.

### Path mapping — **confirming the guess**

Adam's guess: Surface 3 → path C (search-area browse). **Confirmed.** This is
`/api/search-area`, and it retains two distinct Google dependencies: the
free-text `searchText` path and the category `searchNearby` fanout.

Worth naming: the free-text path is the one BACKLOG.md §"Fuel × Google" calls
out as still classifying `gas_station` results as `"fuel"` via
`categoryForGoogleTypes` — so typing "Chevron" here still returns a
Google-sourced fuel tile even though the *tile* path was moved to Mapbox.

---

## Question 5 — what is actually new about the "NEW" badges?

**Answer: the badge is UI-only, and it is decorative rather than derived. It is
also, in three cases, attached to a tile that cannot return a result.**

### The badge is a hardcoded design literal

`isNew?: boolean` is declared on `Tile` (`:68`) and set on **8 of the 13
tiles** (`:94, :101, :108, :115, :135, :197, :211, :218`) — Dispersed,
Campgrounds, Trailheads, Viewpoints, Auto/Repair, Water fill, Showers, Dump
stations. That is the same 8 in the screenshot.

`isNew` has **exactly one consumer in the file**: the badge render at `:1000`.
It touches no query, no param, no source selection.

Its provenance settles the question. `isNew` arrived in
`6c9d3e3` (**2026-05-26**), *"feat(slideup): Find Nearby panel — 13 chips, 6
grouped buckets"*, whose own commit message ends: *"Chip clicks emit
`trip:findNearbySelect` — actual category-fetch wiring is a follow-up."* The
`primaryCategories` field — the thing that makes a tile query anything — was
added later, in `a65d7b7` (**2026-06-08**). **The NEW badges predate the data
wiring by roughly two weeks; they were transcribed from the Paper design frame
(5WK-0), not derived from anything about the data.**

Corroborating: **Groceries** (`grocery`, `grocery_store`) is corpus-only, has
no live path, and carries **no** NEW badge. The badge does not track any data
property.

### What genuinely differs under those tiles

The real distinction — visible nowhere in the UI — is whether a tile's
`primaryCategories` appear in `LIVE_SLIDE_FOR_PRIMARY`
(`resolve-places.ts:220-237`). Cross-referencing `BUCKETS` against that map and
against `SUPPRESSED_PRIMARY_CATEGORIES` (`federated.ts:72-75`):

| NEW tile | `primaryCategories` | Live half | Corpus half |
|---|---|---|---|
| Dispersed | `dispersed_camping` | none — unmapped | yes |
| Campgrounds | `campground`, `rv_park`, `camping_cabin` | yes → `camping` | yes |
| Trailheads | `trailhead`, `hiking_area` | none — unmapped | yes |
| Viewpoints | `viewpoint`, `peak`, `mountain_peak`, `scenic_spot` | yes → `scenic` | yes |
| Auto / Repair | `car_repair`, `car_wash` | none — unmapped | yes |
| Water fill | `water` | none — unmapped | **suppressed** |
| Showers | `shower` | none — unmapped | **suppressed** |
| Dump stations | `dump_station` | none — unmapped | **suppressed** |

**6 of the 8 NEW tiles are corpus-only** — they issue no live call at all,
because `LIVE_SLIDE_FOR_PRIMARY` has no entry and the live half short-circuits
to `[]` (`handler.ts:158`; the identical guard is at `resolve-places.ts:441`).
Only Campgrounds and Viewpoints reach a live source.

So: **new UI only, over a query mechanism that already existed** — with one
real caveat below.

### ⚠️ Three NEW tiles appear structurally unable to return anything

`hydratePlacesByIds` drops every row whose `primary_category` is in
`SUPPRESSED_PRIMARY_CATEGORIES` — `{dump_station, water, toilet, fire_pit,
shower, picnic_area, picnic_ground}` (`hydrate.ts:140`, set defined at
`federated.ts:72-75`). The rationale in `federated.ts:18-20` is deliberate:
standalone amenities are "suppressed from browse entirely… not cards in their
own right."

**Water fill (`water`), Showers (`shower`) and Dump stations (`dump_station`)
target exactly those suppressed values.** Their live half is unmapped, so it
returns `[]`; their corpus half can match in Typesense but every hit is
filtered out at hydration. Both flag states go through `hydratePlacesByIds`
for the bbox federated half (`handler.ts:194` legacy, `resolve-places.ts:497`
resolver), so the flag does not change this.

**Deduced from code reading; NOT reproduced in a browser or against a live
index.** The tile-list comment at `find-nearby-panel.tsx:80-83` claims the
values were "verified against the live Typesense `primary_category` facet" —
which would be true of the *index* and still leave these three empty, because
suppression happens downstream in hydration, not in Typesense.

Recommend a runtime confirmation before treating it as a defect. If it holds,
it is a UX honesty problem sharpened by the badge: three amenity tiles are
advertised as NEW and return an empty state by construction.

---

## Summary table

| | Surface 1 — Explore N more | Surface 2 — day browse | Surface 3 — Find on |
|---|---|---|---|
| Component | `day-detail-corridor.tsx:1120` | `category-browse-panel.tsx` | `find-nearby-panel.tsx` |
| Call | **none** (local `setExpanded`) | `GET /api/trip-browse/:trip/:day` | `GET /api/search-area?bbox=…` |
| Scope | already-loaded day pool | day corridor, `CORRIDOR_MI = 10` | map viewport bbox |
| Google | via day-mount enrich, not this click | `searchNearby` (non-fuel) | `searchText` + `searchNearby` |
| Mapbox | — | fuel only | fuel only |
| Corpus | payload only | `pois_along_corridor` RPC (flagged) | Typesense → `hydratePlacesByIds` |
| `resolvePlaces()` | no | flagged (`TRIP_BROWSE_USE_RESOLVER`) | flagged (`SEARCH_AREA_USE_RESOLVER`) |
| Path A–E | **none** (cards = D) | **B** ✓ | **C** ✓ |

**Two of three guesses confirmed; Surface 1 corrected** — the link itself maps
to no path, though the cards it reveals are enriched by D.

Paths **A** (`itinerary/fuel-live-resolve.ts`, audit-time) and **E** (the
`data/ingestion/sources/google-places.ts` corpus ingester) are **not reachable
from any of these three surfaces.** A is generation-time, behind
`FUEL_LIVE_RESOLVE`; E is offline ingestion. Neither appeared in any trace.

## Open items this raised (not acted on)

1. **`urban` / `interest` chips on Surface 2 → likely HTTP 400.** Needs a
   runtime check. If real, split `SLIDE_CATEGORIES` into an "expands-from-`all`"
   list and a separate validation allowlist.
2. **Water fill / Showers / Dump stations return nothing by construction.**
   Needs a runtime check. Fix is a product call, not obviously a code call:
   drop the tiles, or narrow `SUPPRESSED_PRIMARY_CATEGORIES` for the
   search-area path only.
3. **Nothing in the UI distinguishes a corpus-only tile from a live-backed
   one**, and the NEW badge does not correlate with the difference. Worth a
   look if the Google-dependency reduction proceeds, since the corpus-only
   tiles are exactly the ones that would be unaffected by it.
