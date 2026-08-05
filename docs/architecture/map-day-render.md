# Map Day Render — how the active day draws on the map, and how the camera frames it

**Why this doc exists / where it sits.** The two-layer place map (#192) and the
day-bounds camera (#194) had **no architecture home** — they lived only in
`STATE.md`/`LOG.md`/`BACKLOG.md`. This is that home. It covers the MAP render for the
active day; the READ/render path for a single place's *data* (card + slideup) is a
different doc, `place-render-model.md`. Evidence tags per `trip-resolution.md`:
`[read]` source, `[grep]`, `[measured]` (browser, headless-Chrome + CDP this session),
`[UNVERIFIED]`. Everything below is in `web/src/components/trip/map-column.tsx` and
`web/src/lib/trips/place-layer.ts` unless noted.

---

## 1. The layers — one source, two symbol layers (#192)

The active day's `placePool` is plotted as ONE GeoJSON source, `active-day-places`,
read by TWO symbol layers `[read]`:

- **POOL** (`active-day-places-pool`), below — the browse-dot glyph (filled
  `CategoryIconV2` in a rounded square).
- **PROMINENT** (`active-day-places-prominent`), above — the waypoint-pin glyph
  (stroke `CAT_SVG` in a tailed disc), `icon-anchor: "bottom"`.

Add-order gives the stack. The split is a **complementary filter** on a
render-computed `prominent` property (`placesToFeatureCollection`):
`prominent = curated OR fromWaypoints` — `curated` is the generation-bake flag on
`segmentSuggestions`; `fromWaypoints` is detected via `placePool`'s `removable`
marker `[read]`. Pool filters `prominent == false`, prominent `== true`, so no
feature renders twice. Category toggles AND a second clause onto both filters. **No
schema change** — the discriminator is computed at render, `lib/trips/types.ts`
untouched.

**Collision (decided by looking, #192):** per-layer, not one flag. Pool
`icon-allow-overlap: false` (declutters a dense day); prominent `true` +
`icon-ignore-placement` (always renders — the important, always-small set is never
the icon Mapbox culls). Icons are **fixed ~30px, no zoom scaling** (authored 2×,
registered `pixelRatio: 2`). These are the first point layers on this map; every
other point is a DOM `Marker` and paints ABOVE the canvas.

**Consequence that motivated #194:** fixed 30px icons + pool declutter means that at
a zoom where the day's places are *tighter than ~30px apart*, most pool icons
collide and vanish. See §2.

---

## 2. The camera — fit the day's plottable PLACES (#194)

### 2.1 The bug it fixes (present-but-suppressed, not absent)

On day-activation the camera used a fixed `flyTo({ zoom: 8 })` — built for the old
day-pin view, before places were on the map `[read: the pre-#194 effect]`. At zoom 8
a Portland rest day's 10 tiles span **~66px on screen**, so of **8 pool features in
the viewport only 2 rendered** `[measured 2026-08-05]` — the source was populated,
both layers were in the style, and the filters passed. The failure looked like a
broken layer and was a **visibility interaction** (fixed icon size × too-far zoom ×
pool declutter × DOM-marker occlusion). Established by measuring in-viewport vs
rendered counts, not by reading code.

### 2.2 Fit to PLACES — not endpoints, not their union (the reasoning, not just the choice)

`placeBounds(placePool(day))` → `[[minLng,minLat],[maxLng,maxLat]] | null`, fed to
`map.fitBounds` `[read]`. The bounds come from the day's plottable **places**:

- **Endpoints-only is disqualified.** A day's start/end degenerate to a *single
  point* on the two shapes the bug affected most — a **rest day** (`start == end` at
  the stop) and a **round-trip day** (`start == end`, drove) — producing a max
  zoom-in, not a fit.
- **Union(places ∪ endpoints) is disqualified.** Whenever an endpoint sits far from
  the cluster (a long driving day whose stops bunch at one end), union stretches the
  frame back toward the zoom-8 failure — re-introducing the collapse on the clustered
  days the fix is *for*.
- **Places-only serves all three shapes** (rest / round-trip / driving). Its one
  accepted cost: on a long driving day whose stops cluster at the destination, the
  **start pin can leave frame** — accepted, because the route line keeps visual
  continuity. `[measured: on the one driving day tested the start stayed in frame
  because its stops reached the start; one day is not a general result — UNVERIFIED
  as a general claim.]`

### 2.3 Fit on EVERY day, including day 1

The old init rationale — frame Day 1's *start* to match the highlighted card and the
hero image — **predated places being on the map**, so #194 fits day 1 like every
other day (consistency), and updates that stale init comment `[read]`. First paint
now frames the day's stops, not a bare origin point.

### 2.4 Lives in the same `[activeDay]` effect — deliberate

The fit REPLACED the `flyTo` inside the existing `[activeDay, startCoords]` effect,
so it **inherits the settle signal for free** (`?day=` is written on settle,
`SETTLE_MS 140` / `MAX_WAIT_MS 400`, `continuous-day-stack.tsx`) — fly-by days never
move the camera. This was deliberate, not incidental: a new effect on a different
signal would have re-derived (or fought) the settle debounce. Same `duration: 1500`,
`essential: true` as the old `flyTo`, so motion is unchanged. `[read]`

### 2.5 The guards

- **Zero plottable places** (coordless-waypoint days on de-linked reference trips,
  e.g. `la-to-portland`) → `placeBounds` returns `null` → fall back to the prior
  `flyTo(start, zoom 8)`. `[measured: la-to-portland day 1 → source 0, zoom 8.]`
- **One place / all-same-coord** → a valid **zero-extent** bbox. Mapbox `fitBounds`
  would otherwise zoom to the map max (~22); clamped by **`maxZoom: 14`** so it lands
  at a neighborhood, not the street. `[read; Mapbox behavior UNVERIFIED beyond the
  clamp working in the measured runs.]`
- **Panel padding** — a naïve `fitBounds` centers on the full viewport, so a tight
  cluster lands under the left overlays (day rail + corridor, ~670px). Padding is
  measured intrinsically from the DOM — `offsetLeft/offsetWidth`, **not**
  `getBoundingClientRect`, which reads mid-transition-wrong while the panels animate
  (the gotcha `user-location-layer.tsx` documents) — via a `data-map-occludes-left`
  marker on the corridor overlay (`trip-slideup-body.tsx`) plus the top filter
  harness. Clamped so a narrow window keeps a **≥160px** visible strip; collapsed
  (fullscreen map) → the overlay is absent → zero padding. `[read]`

### 2.6 What it fixes, measured

`[measured 2026-08-05, synthetic 5-shape TEST fixture, inserted+deleted]`:

| shape | before | after (fit) |
|---|---|---|
| rest day (10 tiles, ~66px @ z8) | z8, 2 of 8 render | **z10.37, 10 / 10 render** |
| round-trip (13 tiles) | — | z9.93, 13 / 13 |
| driving day (LA→St George) | — | z6.72, frames the whole day |
| coordless | — | fallback `flyTo(start, z8)`, 0 features |

**Does NOT solve a genuinely dense day.** 263 tiles tight in downtown LA go from
**2 → 124** rendered — a substantial improvement (the fit zooms in) and the measured
*floor* for the clustering gap. The pool declutter still hides ~half; a dense cluster
is tight at any zoom. Clustering/expansion is the open follow-up — `docs/BACKLOG.md`.

---

## 3. The shared coords guard

`isPlottableCoord(c): c is [number, number]` is the ONE predicate for "is this tile
plottable" — a real `[lng, lat]` (elevation tolerated), rejecting absent/NaN/short.
It backs **both** `placesToFeatureCollection` (what draws) and `placeBounds` (what the
camera fits), so the fit and the draw can never disagree about which tiles exist.
Unit-tested in `place-layer.test.ts`. `[read]`
