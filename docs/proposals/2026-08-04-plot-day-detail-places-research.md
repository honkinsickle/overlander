# SCOPING — plot day-detail places on the map

> **UPDATE 2026-08-05 — SHIPPED (both halves).** This is the pre-build scoping
> record; the feature shipped in #187 (scoping + harnesses), #188 (tile layer),
> #189 (marker→card). Current position: `STATE.md` §2026-08-04 → 08-05; follow-ups
> (expand-on-focus, and the deliberately-unwired reverse direction): `BACKLOG.md`.
> The research below stands as written — read it for the *why*, not current state.
>
> **UPDATE 2026-08-05 (late) — DIRECTION UNDER RECONSIDERATION.** A premise here is
> partly invalidated: this doc scoped a GeoJSON layer on the assumption that **pool
> count** was the binding constraint (up to 263–386 tiles), but the *visible* count
> is **≤ 4** — the scroll shows only curated tiles inline, the rest collapse behind
> "Explore more". That reopened layer-vs-DOM-markers, then category filtering
> reopened it the other way. Do NOT take this doc's layer reasoning as settled —
> see `STATE.md` §2026-08-05 late and `BACKLOG.md` §Open direction.

**Status: RESEARCH ONLY — nothing built.** Read-only pass. No component, event,
or layer was designed; this records what exists, what a build would cost, and
what must not move. Evidence tags per `docs/architecture/trip-resolution.md`
(`` `[read source]` ``, `` `[measured YYYY-MM-DD]` ``, `` `[UNVERIFIED]` `` …).

**The goal it scopes:** the places a user sees in the day-detail scroll should
appear on the map. Today the map plots endpoints + waypoints only — intra-day
tiles are not plotted. Two decisions were fixed going in and are NOT re-opened
here: (a) intra-day tiles go in a **GeoJSON source with symbol/circle layers**,
not DOM `Marker`s (a day can carry 263 tiles); (b) the map follows the **active
day (`?day=`)**, not the IntersectionObserver-mounted set.

**Harnesses that produced every figure below** — both now in `web/scripts/`,
run-instructions in the last section:
- `web/scripts/scoping-daydetail-pool.mjs` — per-day pool + placeId coverage.
- `web/scripts/scoping-daydetail-coords.mjs` — coords coverage by source/shape,
  enumerates all trips on both databases.

---

## The load-bearing four

1. **Corridor cards carry no `data-place-id` and no stable DOM id.** Tiles render
   through `CategoryListCard`, a plain `<div onClick={onOpen} …>` with no
   `id`/`data-*` keyed on place id `[read category-list-card.tsx:78-83]`; the only
   id is the React key `key={p.id}`, unqueryable `[read
   day-detail-corridor.tsx:562, 619, 713, 848, 937, 997]`. **Marker→card is the
   real cost of this feature** — dots are cheap, addressing a card from a marker
   click is not, today.
2. **Every plotted point on the map is a DOM `mapboxgl.Marker`; only the two lines
   are GeoJSON layers.** Day pins `[read map-column.tsx:442-458]`, waypoint pins
   `[489-548]`, browse/suggested dots `[146-221]`, and the user-location dot `[read
   user-location-layer.tsx:91]` are all DOM markers. `trip-route` `[633-651]` and
   `active-day-leg` `[654-672]` are the only GeoJSON layers, both `LineString`. So
   the tile layer would be the **first point layer** and a **second
   point-rendering approach**, sitting **beneath** every existing pin (see §Costs).
3. **The map already follows the 140/400 ms settle signal.** `activeDay` derives
   from `?day=` `[read map-column.tsx:327-363]` and `flyTo` fires on its change
   `[738-752]`; `?day=` is written only on settle (`SETTLE_MS = 140`,
   `MAX_WAIT_MS = 400`) `[read continuous-day-stack.tsx:31-35, 122-173]`. A tile
   layer keyed on `activeDay` inherits that signal for free — no new debounce;
   fly-by days never become active, so their tiles never build.
4. **The coords gap is confined to editorially-authored reference waypoints.** See
   §Coords — the causal variable is **waypoint-share in the pool, NOT the
   `generated` flag**.

---

## What the map plots today

All point features are DOM markers (item 2 above). The polyline IS a GeoJSON
layer, so the source+layer pattern exists here — but **only for `LineString`;
there is no point layer today.** On PROD `4534add5` the map plots **up to 12
day-pins** (start pin — `startCoords` confirmed present `[queried PROD]` — plus
one per day with `coords`; not all 11 verified) and **0 waypoint pins** (its pool
is 770 `segmentSuggestions`, 0 waypoints).

### Costs of a GeoJSON point layer alongside DOM markers
- **Z-order:** Mapbox canvas layers always paint *below* DOM-overlay markers, so a
  tile layer renders **beneath** every waypoint pin, day pin, browse dot, and the
  user-location dot `[architectural; UNVERIFIED on-screen]`.
- **A third copy of the category vocabulary:** it is already duplicated as DOM SVG
  strings — `DOT_BADGE_BY_CATEGORY` (6 keys) `[read map-column.tsx:117-124]` and
  waypoint `CAT_SVG` (**9 keys** — `fuel, camping, scenic, urban, food, oddity,
  attraction, interest, hotel`) `[read map-column.tsx:468-488]`. A layer needs a
  third copy as Mapbox paint / `icon-image` expressions. (Note: 4 of the 9
  `BrowseCardCategory` values — `attraction, hotel, urban, interest` — have no
  `DOT_BADGE` entry and fall to the default badge `[palette.ts:17-33 vs
  map-column.tsx:117-129]`.)
- **Click handling:** DOM markers use `addEventListener("click")`
  `[map-column.tsx:204]`; a layer needs `map.on("click", layerId)` +
  `queryRenderedFeatures`.
- **Selection state:** DOM markers mutate `dataset`/inline style directly
  (`pulseDot`, `dataset.pinned`) `[map-column.tsx:137-144, 946]`; a layer needs
  `feature-state` or a data-driven paint property.

---

## The interaction — what exists as EVIDENCE (not a design)

**Beyond `trip:openDetail`, the day-detail corridor has no card↔map highlight.**
Its tile clicks dispatch `trip:openDetail` only `[read
day-detail-corridor-column.tsx:651-760]`.

**But the marker↔card mechanism already exists in-repo, on a *separate* surface —
find-nearby / area-search.** Recorded as evidence the pattern is present, NOT as a
proposed design:
- Cards carry `data-place-id={place.id}` + a `focusedId` highlight `[read
  find-nearby-panel.tsx:784-794]`.
- Marker→card: `trip:areaResultFocus` does
  `gridRef.current?.querySelector('[data-place-id="${id}"]')` → `scrollIntoView`
  `[find-nearby-panel.tsx:670-685]`.
- Map side: link-mode markers set `dataset.placeId` and dispatch/consume
  `trip:areaResultFocus` / `trip:areaCardFocus` `[map-column.tsx:163, 204-212,
  1054-1065]`.

So the "what adding card addressing would touch" answer is concrete:
`CategoryListCard` (or its wrapper in `day-detail-corridor.tsx`) gains a
`data-place-id`; the query/scroll/highlight half already exists on find-nearby.
The continuous-stack rail-click `scrollIntoView` is **day-level** (keyed
`data-day-id`, `programmaticUntil` guard) `[continuous-day-stack.tsx:262-274]` —
the guard pattern is reusable, the target resolution is not; corridor cards emit
no hover/select signal `[category-list-card.tsx:78-214]`.

---

## Pool distribution — a mean is meaningless

`placePool(day) = segmentSuggestions ∪ Object.values(suggestions) ∪ waypoints`
`[read day-detail-corridor-column.tsx:1148-1198]`. Measured
`[web/scripts/scoping-daydetail-pool.mjs, 2026-08-04]`:

| Trip | days | pool min / median / max | sum | composition |
|---|---|---|---|---|
| PROD `4534add5` | 11 | 4 / 31 / **263** | 770 | 770 seg · `curatedMode=true` |
| TEST `expedition-ms28y793` | 15 | 2 / 3 / 7 | 48 | 48 seg · `curatedMode=true` |
| TEST fork `05b346df` | 66 | 0 / 2 / 5 | 135 | 43 sug / 92 wp · `curatedMode=false` |

`4534add5` per-day: **263, 164, 61, 114, 31, 93, 4, 4, 7, 14, 15** — **day 1 is
263, day 7 is 4**, ~66× lopsided; **do not quote its mean.** The max is the count
a point layer must survive during scroll updates — the reason DOM markers were
ruled out. **Rest day:** none persisted on any reachable trip; the cap is
`REST_DAY_SUGGESTION_CAP = 10` `[read rest-day.ts:124]` via `rankNearbySuggestions`
`[142-157]`, so a layover plots ≤10 dots ringing one point (`isRestDay` is a pure
`(day)=>boolean` `[rest-day.ts:110-118]`, reachable in `MapColumn`).

---

## Coords — the gap is dying, and here is why

A tile with no `coords` cannot be plotted: `Waypoint.coords` is `coords?:
[number, number]`, commented *"when present, a marker is dropped on the map at"*
`[read types.ts:325-327]`. Across **all 35 reachable trips on both databases**
`[web/scripts/scoping-daydetail-coords.mjs, 2026-08-04]`, coverage **per source**:

| Source | tiles | with coords | coverage |
|---|---|---|---|
| `segmentSuggestions` | 9,567 | 9,567 | **100%** |
| `day.suggestions` | 172 | 172 | **100%** |
| `waypoints` | 400 | 81 | **20%** |

**Every coordless tile is a waypoint** (319 = 400 − 81; seg and sug have zero
coordless). **Verified non-artifactual:** all 70 coordless waypoints on the fork
have `coords: undefined`, no alternative location key — coord-bearing vs coordless
waypoints share an identical key set except the literal `coords` array `[node
keys-dump, 2026-08-04]`. They are editorial reference stops authored without a
coordinate (e.g. `"Sweetgrass / Coutts Border Crossing"`). This is *"waypoints
structurally lack coords,"* NOT *"old trips are patchy."*

**The causal variable is waypoint-share, not the `generated` flag.** Generated
trips carry zero waypoints (pool = pure seg) so they land at 100%; but
`segmentSuggestions` are **not exclusive to generated trips** — two `gen=n` trips
(`50f18000`, `24f14ecc`) are seg-only and 100% `[PROD trips]`. **No claim is made
that the flag mislabels any trip** — only that pool composition, not the flag,
predicts coverage. Per shape: **generated — 18 trips, 7,519/7,519 seg = 100%**
`[script aggregate, spot-checked]`, no waypoints. Other (reference-derived +
drafts) — 17 trips, seg 100% / sug 100% / **wp 20%**; heterogeneous, spanning
`la-to-portland` at **0%** (14 coordless waypoints → plots nothing, both DBs) to
the `la-to-deadhorse` reference at **97%** (seg-dominated), so only its per-source
cut is meaningful. **8 of the 35 are empty PROD drafts** (days=0 or 0 tiles) that
plot nothing for lack of a pool — a different reason from missing coords.

**Structural strengthening:** `segmentSuggestions` are 100% coords across **all
9,567 tiles on every trip regardless of shape** (generated and the two `gen=n`
seg-bearing trips alike) — consistent with their being corpus rows carrying
PostGIS geometry. This makes "generated pools plot at 100%" a **structural
expectation, not an 18/18 coincidence** — but see UNVERIFIED: it is measured, not
read out of `bake.ts`.

**Consequence for the build.** Trip creation is generated-only (#178); the
reference trips were de-linked (#177) with generated `4534add5` adopted as the
instrument. **Every trip a user can now create plots at 100% coords** — the 48% is
confined to legacy reference-derived trips (out of region, de-linked, still
URL-renderable). A build must **still** skip coordless tiles (reference trips
remain reachable directly), but on the trips that matter, coverage is complete.

---

## Tripwire

**A build would touch:** `web/src/components/trip/map-column.tsx` (tile GeoJSON
source + circle/symbol layers + an `activeDay`-keyed effect);
`web/src/components/trip/category-list-card.tsx` **or** `day-detail-corridor.tsx`
(`data-place-id`); possibly `day-detail-corridor-column.tsx` (plumb the active
day's pool).

**Must show ZERO diff:** `web/src/lib/itinerary/` (the data model); the hydration
effect's dependency array (`[hydrateKey]`, `day-detail-corridor-column.tsx:307-350`
— the map keys off the active day, NOT the mounted set, so `mountedIds`/`hydrateKey`
stay untouched); the scroll windowing (`continuous-day-stack.tsx` IO
mount/unmount, `heights` cache, settle writer).

---

## UNVERIFIED (kept as UNVERIFIED)

- **No browser render.** `NEXT_PUBLIC_MAPBOX_TOKEN` is absent from
  `.env.development.local`; `4534add5` is RLS-scoped (DOM measurement needs a
  minted session). Everything here is source reading + service-role payload reads.
- **Z-order is architectural, not observed on this map** — a tile layer *should*
  render beneath the DOM markers; not confirmed on screen.
- **"Generated ⇒ 100% coords" is measured across 9,567 tiles, not proven from
  `bake.ts`** — I did not read the bake path to confirm a `segmentSuggestion` can
  never be emitted without `coords`.
- **Cause of the missing waypoint coords** is editorial authoring; the mechanism
  is otherwise unestablished.

---

## Corrections (recorded so they don't recur)

- **The "86% cannot hydrate" figure is wrong and was mis-sourced.** It came from
  the scoping *handoff prompt*, not from CLAUDE.md, and it is **not a constant**:
  the un-hydratable (no `placeId`) fraction is **8%–100% by trip** — 78% on
  `4534add5`, 8% on `expedition-ms28y793`, 100% on the fork `[measured
  2026-08-04]`. It **never propagated to any doc** `[grep docs/ + CLAUDE.md,
  2026-08-04]`, so there is nothing to hunt down elsewhere. The #6 conclusion is
  unaffected: a marker leans on `coords`+`category`+`title`, never enrichment.
- **`CAT_SVG` has 9 keys, not 8** (an earlier draft miscounted).
- **"All point features are DOM markers"** was asserted before `UserLocationLayer`
  was read; it survived verification `[read user-location-layer.tsx:91]`.

---

## Harnesses — how to run (environment-specific)

Both read `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` from env files
(no hardcoded credentials): **`web/.env.local` → PROD**, **`web/.env.development.local`
→ TEST**. Both are READ-ONLY; `scoping-daydetail-coords.mjs` reads all rows on
**both databases including PROD** (a read, never a write). Env-file paths are
**relative to the working directory**, and the two scripts differ — run each from
its own cwd:

- **`web/scripts/scoping-daydetail-pool.mjs`** — env paths `.env.local` /
  `.env.development.local`, so **run from `web/`**:
  `cd web && node scripts/scoping-daydetail-pool.mjs`.
- **`web/scripts/scoping-daydetail-coords.mjs`** — env paths `web/.env.local` /
  `web/.env.development.local`, so **run from the repo root**:
  `node web/scripts/scoping-daydetail-coords.mjs`.

Trip ids used by the pool harness (`4534add5…`, `expedition-ms28y793`,
`05b346df…`) are hardcoded; the coords harness enumerates every trip and needs no
ids.
