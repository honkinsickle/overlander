# Slideup overlay layout — design spec

Source: Paper file "Overlander Trip Planning", frame `1RA9-0 Slideup · Default` (Paper node id `33Y-0`). Written from a single Paper frame on 2026-05-22. The Paper file contains exactly one frame showing the new layout — no alternate states are drawn. Sections that describe "what happens when X" are based on inference from the single frame plus the existing slideup code's behavior, and any inference is flagged explicitly.

The intent of this document is to give an outside reviewer enough to critique the layout without seeing the Paper file. It documents what the frame shows, what the frame implies, and what the frame does not address.

## 1. Summary

The trip-detail slideup body changes from a three-column flex layout (DayColumnPlanner · DayDetail · MapColumn) to a **map-as-background** layout: the map fills the entire slideup canvas, and two existing surfaces — DayColumnPlanner and DayDetail — are reframed as **floating translucent overlays** anchored to the left side of the canvas above the map. The right ~38% of the canvas (~427 px of the 1112-px-wide body) is the bare map, intended for trip-shape orientation and gesture interaction. Existing surfaces that already live outside the 3-column body (OfflinePanel slide-in drawer, DirectionsPanel, NavGo button, turn-by-turn nav overlay, off-cache banner) are not redrawn in the new frame and are assumed to layer on top of the new layout unchanged.

## 2. What stays the same

Items the new frame does not modify, drawn from the existing code surface. Reviewer should treat these as unchanged unless we explicitly raise them.

- **Slideup shell** — outer `SlideupShell` chrome, mount path (`/trips/[id]` intercept via `@modal/(.)trip/[id]`), backdrop dismissal, ESC handling, `router.back()` from the ✕ button. No change to the intercept architecture.
- **Body width** — 1112 px (was 1113 in earlier briefs; the Paper frame uses 1112). The width itself is unchanged from the current 3-column body.
- **MapColumn rendering pipeline** — Mapbox GL JS map, route polyline source/layer, active-day-leg highlight, marker chrome, waypoint pins, user-location layer, snap-to-route, fly-to-active-day. The map IS the canvas now, but it's still the same `MapColumn` component with the same data and layers.
- **OfflinePanel drawer pattern** — the kebab → "Offline maps" entry continues to open `OfflinePanel` as a slide-in drawer. The drawer's position, animation, content, and dismissal are not redrawn in the new layout.
- **DirectionsPanel** — the directions sheet for the active leg, triggered by `DirectionsButton`, is not redrawn. Assumed to layer on top of the new overlays at the same z-index it currently uses.
- **NavGo button** — the floating CTA to enter turn-by-turn nav is not redrawn. Position and behavior assumed unchanged.
- **Turn-by-turn nav layer** (PR #43) — when nav is active, the map's nav overlay UI is not redrawn for the new layout. Assumed to replace the map chrome / overlays as it currently does.
- **Off-cache banner** (PR #47) — `OffCacheBanner` at the top of `MapColumn` is not redrawn. Assumed to render above the new overlays in the same screen position.
- **Data model** — Trip / Day / Waypoint shapes unchanged. `routePolyline`, `offlinePhases`, `startCoords` etc. continue to drive map content.
- **DayColumnPlanner content** — section labels (`OVERVIEW`, `ITINERARY`), Explore / Places to visit tabs, day cards with miles · hours · day number · day-of-week date · start–end label. Content is identical to the current `DayColumnPlanner`; only its container chrome changes.
- **DayDetail content** — trip hero card (image + title + date range + weather chip), then ITINERARY section with the active day's header card and waypoint list. Content is identical to current `DayDetail`; only the container chrome changes.
- **Waypoint card** — `Banff Townsite` row in the new frame is rendered identically to the current `WaypointCard` component: category-colored circular badge with vehicle icon, title, description, amber `↳ ... ` tip, trailing `→` affordance.
- **Reference vs user trip semantics** — the `MakeItMineCta` ("Make it mine") is not visible in the new frame. Whether it's omitted, repositioned, or absent in this state is unspecified; the frame is a user trip, not a reference trip view.

## 3. What changes

Items the new frame shows or implies as different from the current 3-column body.

- **Body composition** — was a three-column flex container (215 · 440 · 458 = 1113). Becomes a single-layer canvas where the map is the background and DayColumnPlanner + DayDetail are absolutely-positioned overlays. The right ~38% of the canvas is bare map.
- **Day column container chrome** — was an opaque panel on the left side of the body. Becomes a translucent dark overlay (`#0C0D0F` at ~59% alpha) anchored to the bottom-left corner of the canvas, sitting above the map. Width unchanged at 215 px; height reduced from full body height to 632 px (canvas height 721 − 60 header − ~29 px padding ≈ 632).
- **Day detail container chrome** — was an opaque center panel. Becomes a translucent dark overlay (`#161819` at ~78% alpha) anchored immediately to the right of the day column, width 459 px (≈ the prior 440 + minor adjustment), height 632 px. Inherits map background visually through the translucent fill.
- **Map column** — was a separately-rendered right panel at width 458. Becomes the full-canvas background underneath both overlays. The map is visible in three places: behind the translucent day column (heavily tinted), behind the translucent day detail (lightly tinted), and bare to the right of the day detail (full visibility, ~427 px wide).
- **Trip header chip** — was rendered inside the trip-detail header above the body. Becomes a separate floating chip (`#162029` solid, 675 × 60) anchored top-left, containing `<trip title>: <date range>` then `<days> · <miles> · <overnights>` then a kebab affordance.
- **Close ✕ button** — was rendered inline in `SlideupShell` chrome. Becomes a separate floating 60 × 60 button (`#1D1E1F` at ~56% alpha) anchored top-right of the canvas. Visually mirrors the header chip's vertical position.
- **Trip-hero card inside DayDetail** — appears to retain the same content (hero photo, title, date range, weather chip) but the prior `make-it-mine-cta.tsx` overlay treatment isn't visible. Inferred: the trip-hero card still owns this content; the CTA may have moved or been omitted.
- **No center-column scrollbar visible** — the current `DayDetail` panel scrolls. The new frame shows the same content but it isn't clear whether the new translucent center overlay scrolls internally, or whether the entire canvas scrolls (unlikely with map background), or whether content overflow is handled differently. Open question.
- **Right map area exists as a permanent surface** — in the old layout the map was always 458 px on the right. In the new layout, the entire canvas is map; the bare-map area to the right of the day detail (~427 px) becomes a primary surface for trip-shape orientation, gesture interaction, and probable future affordances (search? bookmarks? overlays?). The frame does not show any UI in that area beyond the close ✕.

## 4. Layout states

The Paper file contains **one** drawn state of the new layout. All other states listed below are not present in Paper.

### 4.1 Default — day selected, no detail open (the only drawn state)

Frame: `33Y-0` "1RA9-0 Slideup · Default" (1112 × 721, 14 px border-radius, 1 px #3D3D3D outline).

Visible elements:

- Map background (full canvas). The Paper frame uses three tiled raster rectangles all referencing the same image — this is a designer's artifact of tiling a static image to fake a Mapbox canvas. In code, this is one Mapbox map.
- Header chip (`Los Angeles to Portland: 5/31-6/05 · 6 Days · 2,518 mi · 9 Overnights · ⋮ kebab`) anchored top-left.
- Close ✕ button anchored top-right.
- DayColumnPlanner overlay anchored beneath the header chip on the left side. Shows OVERVIEW (Explore highlighted green, Places to visit), then ITINERARY with day cards Day 01 Sun 5/31 · Day 02 Mon 6/1 · Day 03 Tue 6/2 · Day 04 Tue 6/3 (the day-04 row appears to clip at the bottom of the visible area, suggesting the column scrolls).
- DayDetail overlay anchored immediately to the right of the day column. Shows the trip-hero card (`Los Angeles to Portland` · `5/31-6/05` · `84° / 64°F`), then ITINERARY section, then Day 1 header card with kebab, then the `Banff Townsite` waypoint.
- ~427 px of bare map visible on the right side of the canvas. No UI in that area.
- A `Location Detail · Food (Trapper's)` overlay is present in the layer tree as a hidden sibling at left 659, top 456, width 448. Not shown in this state; intended to surface as a floating card over the bare-map area. See §5.5.

Backgrounds tinting the map:
- Day column: `#0C0D0F` at 59% alpha (≈ very dark slate, heavy tint).
- Day detail: `#161819` at 78% alpha (lighter than day column; still substantial tint).
- Header chip: opaque `#162029`.
- Close button: `#1D1E1F` at 56% alpha (most translucent of the chrome).

### 4.2 Default — no day selected

**Not drawn in Paper.** Whether the day detail overlay is empty / hidden / shows trip-level content when no day is active is unspecified. The current `MapColumn` uses Day 1 as the default active day (per `[map-column.tsx:336-339](../../web/src/components/trip/map-column.tsx)`), so functionally there is always an active day; whether the new layout exposes a "no day" state is an open question.

### 4.3 Day detail overlay — Location Detail card open

The hidden `Location Detail · Food (Trapper's)` overlay (`33Z-0`) is positioned at left 659, top 456, width 448, height fit-content. Its background is opaque `#1A1A1A` with a 1 px `#383636` outline and 10 px border-radius — a distinct treatment from the translucent dark overlays. It anchors to the bottom-right area of the canvas, overlapping the right ~25 px of the DayDetail overlay.

**Not drawn in a visible state.** Whether it opens by clicking a waypoint in DayDetail, by clicking a map pin, or both — and whether it dismisses by clicking outside, by an ✕ on the card, or by re-clicking the source — is unspecified.

### 4.4 DirectionsPanel open

**Not drawn in Paper.** The existing `DirectionsPanel` is assumed to slide in from a side of the canvas (current implementation slides from the right of the `MapColumn`). With the map now full-canvas, where it slides in from and how it relates to the DayColumnPlanner / DayDetail overlays underneath is unspecified.

### 4.5 OfflinePanel drawer open

**Not drawn in Paper.** The existing `OfflinePanel` drawer is triggered from a kebab. With the new layout, the kebab still appears to live on the header chip and on each day-header card inside DayDetail. The drawer's slide direction, width, and z-order relative to the new translucent overlays is unspecified.

### 4.6 Turn-by-turn nav active

**Not drawn in Paper.** When `NavGo` is engaged, the existing nav overlay takes over the map. Whether the DayColumnPlanner and DayDetail overlays remain visible, are dimmed, are dismissed, or behave differently is unspecified.

### 4.7 Browse / category panel

**Not drawn for the new layout.** A separate frame in the file (`K8-0` "1RI0-0 Slideup · Browse 2-up", 1133 × 744) shows a Browse 2-up overlay sitting on top of the OLD 3-column layout. The new map-as-background equivalent is not drawn.

### 4.8 Empty state (no trip open / no waypoints / etc.)

**Not drawn in Paper.** All copy in the drawn state references a live trip with waypoints.

## 5. Overlay specifications

All coordinates are relative to the slideup frame top-left (1112 × 721 canvas).

### 5.1 Header chip

- Paper node: `39U-0`, name "Frame"
- Width × height: **675 × 60** (fixed)
- Position: anchored top-left, 10 px from left edge, 14 px from top edge
- Background: solid `#162029` (opaque)
- Border-radius: 15 px on top-left and top-right corners; bottom corners square (visually flush against the body below it)
- Border-bottom: 1 px solid `#FFFFFF24` (~14% white)
- Padding: 0 vertical, 18 px left, 16 px right
- Content (flex row, 15 px gap): trip title `Los Angeles to Portland:` + date range pill `5/31-6/05` + bullet-separated metadata ` 6 Days • 2,518 mi • 9 Overnights` + 32 × 32 kebab affordance
- Z-order: above map background; coplanar with close ✕ button
- Dismissibility: the chip itself is not dismissible; the kebab opens an unspecified menu (currently OfflinePanel)

### 5.2 Close ✕ button

- Paper node: `39V-0`, name "Frame"
- Width × height: **60 × 60** (fixed)
- Position: anchored top-right, 5 px from right edge (left 1047, top 14)
- Background: `#1D1E1F` at ~56% alpha (`8F` hex)
- Border: 1 px solid `#FFFFFF2E` (~18% white)
- Border-radius: 8 px
- Margin-right: −12 px (visual hang)
- Content: 40 × 40 SVG glyph (×)
- Z-order: above map background; coplanar with header chip
- Dismissibility: clicking it closes the slideup (`router.back()` from `SlideupShell`)

### 5.3 DayColumnPlanner overlay

- Paper node: `3AL-0`, name "Day Column Planner — Component (code-aligned)"
- Width × height: **215 × 632** (fixed width; height is computed-canvas-minus-header)
- Position: anchored top-left of the body area, 10 px from left edge, 74 px from top edge (i.e., immediately below the header chip's bottom)
- Background: `#0C0D0F` at ~59% alpha (`96` hex) — heavy dark tint over map
- Border-right: 0.5 px solid `#4A4848` at ~83% alpha (`D4` hex)
- Border-radius: 14 px on **bottom-left only** (matches the frame's bottom-left corner radius; top is square, flush against the header chip)
- `overflow: clip` — content beyond 632 px clips. In the drawn state, Day 04 is partially clipped, implying internal scroll.
- Content (top to bottom): "OVERVIEW" section header with collapse chevron · Explore tab (highlighted green) · Places to visit tab · "ITINERARY" section header with collapse chevron · day cards (Day 01, 02, 03, 04 visible; more presumably below the fold). Each day card is 215 × 112 with: top row (miles · hrs | Day NN), then day-of-week + date (large Barlow display), then "Start — End" label.
- Z-order: above map background; below DayDetail's right edge (they share the same top edge)
- Dismissibility: not dismissible in the drawn frame. Whether the column can be collapsed via the OVERVIEW / ITINERARY chevrons or hidden entirely is unspecified.

### 5.4 DayDetail overlay

- Paper node: `37H-0`, name "Planning v2-1— Planned Stops (Center Column)"
- Width × height: **459 × 632** (fixed)
- Position: anchored to the right of the day column, 225 px from left edge, 74 px from top edge (a 0 px gap with the day column at left 225 = day column's right edge)
- Background: `#161819` at ~78% alpha (`C7` hex) — lighter tint than the day column
- Border-right: 1 px solid `#FFFFFF12` (~7% white)
- Border-radius: 0 top-left; 15 px bottom-right only (matches frame's bottom-right; top edge is square, right edge implies a visual seam with the bare-map area)
- `overflow: clip`, `align-items: center`
- Content: trip-hero card (Rocky coastal sunset 419 × 290 + caption frame 400 × 99 with `Los Angeles to Portland` title + date row + weather chip), then a centered ITINERARY section, then an active-day header card (`Seattle, WA — Mount Rainier NP` · `Day 1 — Fri, May 29` · kebab), then waypoint cards (`Banff Townsite` visible). Inner frame `37O-0` is 459 × 1217 — content is taller than the overlay, implying internal scroll.
- Z-order: above map background; coplanar with day column on its left edge; below `Location Detail` card on its right edge when that card is open
- Dismissibility: not dismissible in the drawn frame. Whether collapsing to a narrower form or hiding entirely is supported is unspecified.

### 5.5 Location Detail card (hidden in drawn state)

- Paper node: `33Z-0`, name "Location Detail · Food (Trapper's)"
- Width × height: **448 × fit-content** (variable height)
- Position when shown: 659 px from left, 456 px from top. Overlaps the right edge of the DayDetail overlay by ~25 px and floats above the bare-map area.
- Background: solid `#1A1A1A` (opaque — distinct from the translucent overlay treatment used by DayColumnPlanner and DayDetail)
- Border-radius: 10 px (all corners)
- Outline: 1 px solid `#383636`
- `overflow: clip`, `align-items: center`
- Content (when shown): header block (place title + reliability + coords + route offset), simulator card (`+1h 28m`, cost cells, ETA caption, schedule bars, Day N chip, CTA row), divider, description section, divider, logistics section (hours + fee, phone + website), divider, community section (rating + tips + last-verified date), divider, amenities chips, divider, data-source attribution chips. Content is identical to the existing `WaypointDetail` slide-up content (per current `MapColumn`'s `WaypointDetail` block).
- Z-order: above DayDetail and map background; floats over the bare-map area
- Dismissibility: unspecified in Paper. Currently the equivalent surface dismisses via an ✕ icon on the card (per `MapColumn`'s `WaypointDetail` `onClose` prop).

## 6. Interaction model

This section synthesizes from the single drawn frame and existing code behavior. Where Paper is silent, the inference is flagged.

### 6.1 Map gestures

- The map is intended to be interactive at all times beneath the overlays. Pan and zoom on the bare-map area on the right work directly.
- **Open question:** do pan and zoom work *through* the translucent overlays (DayColumnPlanner / DayDetail), or are gestures captured by the overlay surfaces? The translucency suggests visual showthrough but says nothing about gesture passthrough.
- Tapping a map pin presumably opens the Location Detail card (per current `MapColumn` behavior, which dispatches `trip:openDetail`). Whether the card occupies the position drawn in Paper (left 659, top 456) regardless of where the pin sits, or whether the card anchors near the pin, is unspecified.

### 6.2 Dismissing overlays to see the bare map

- The drawn frame does not provide an affordance to collapse or dismiss the DayColumnPlanner or DayDetail overlays.
- No fullscreen-map toggle is drawn.
- The OVERVIEW and ITINERARY section headers inside DayColumnPlanner each have a chevron that visually suggests collapse, but it's unclear whether collapsing them hides the section or just the section's content.
- **Open question:** is there a way to view the full map unobstructed (e.g., minimize the overlays)? If not, the bare-map area on the right is the only place the map is visible without tinting.

### 6.3 Multiple overlays overlapping

- DayColumnPlanner (left 10–225) and DayDetail (left 225–684) are flush against each other with a 1 px right-border seam on each. They do not overlap.
- Location Detail card (left 659–1107) overlaps the right ~25 px of DayDetail. The overlap is small and likely cosmetic (the card extends past DayDetail's right edge into the bare-map area, with its left edge just barely overlapping the column). Whether this is intentional or a positioning artifact is unspecified.
- The header chip (left 10–685) and close ✕ button (left 1047–1107) sit in the top 60 + 14 = 74 px band above the overlays, so they don't overlap any of the column overlays.

### 6.4 OfflinePanel drawer over the new layout

- The kebab in the header chip (and in each day-header card inside DayDetail) presumably still opens the OfflinePanel drawer.
- The drawer's slide direction (currently right-side) and width relative to the new layout is unspecified.
- **Inferred:** the drawer continues to slide in from the right edge of the canvas, sitting above everything (map, column overlays, header chip, close button). With the map now full-canvas, the drawer no longer has a dedicated MapColumn to "originate from"; instead, it overlays the bare-map area + part of DayDetail.

### 6.5 DirectionsPanel over the new layout

- Triggered by `DirectionsButton`, which currently lives floating on the `MapColumn`. The button's position in the new layout is not drawn.
- The panel content (active leg directions) is unchanged. Where it sits and how it relates to the column overlays is unspecified.

### 6.6 Turn-by-turn nav active

- When the user taps `NavGo`, the existing nav layer takes over. The drawn frame does not include a "nav active" state.
- **Inferred:** the column overlays are either hidden or dimmed to reduce occlusion during driving; nav UI sits on the map directly.

### 6.7 Click-through ambiguity

- Several behaviors depend on whether a click on the day card (in the day column) or a click on the waypoint card (in the day detail) just updates content within the overlays, vs. opens a new floating card (Location Detail) on the bare-map area.
- The drawn frame shows a waypoint card (`Banff Townsite`) but does not show what happens when that card is tapped. The existing `DayDetail` opens an in-place detail panel inside the center column; whether the new layout retains that or routes the detail through the Location Detail card overlay is unspecified.

## 7. Unanswered design questions

Items the Paper file does not address that the layout creates as new surfaces or behaviors to define.

1. **No alternate states are drawn.** Only one state of the new layout exists in Paper. All transitions, dismissal modes, empty states, and overlapping-overlay behaviors are undefined.
2. **Does the day column scroll internally?** Day 04 visibly clips at the bottom. Scroll vs. fade vs. expand is not specified.
3. **Does the day detail scroll internally?** Inner content is 1217 px tall in a 632 px container. Internal scroll is implied but not explicitly drawn (no scroll-shadow, no track).
4. **Can the user collapse / dismiss the column overlays to see the full map?** No affordance is drawn for this.
5. **What do the OVERVIEW and ITINERARY chevrons inside the day column do?** They visually suggest collapse but the collapsed state isn't shown.
6. **Does the Location Detail card open in place when a map pin is tapped, or does it always anchor at left 659 / top 456 regardless of pin position?** Both are plausible; Paper is silent.
7. **How does the Location Detail card dismiss?** No ✕ is visible on the card in the drawn (hidden) state.
8. **What's the relationship between waypoint-card-in-DayDetail and the Location Detail card?** Are they alternate surfaces for the same content (one in-column, one floating), or do they show different content?
9. **Does the map respond to gestures through the translucent overlays, or only on the bare-map area?** Translucency suggests showthrough but doesn't specify gesture behavior.
10. **What's the active-day visual treatment in the new day column?** The drawn state highlights "Explore" in green inside the OVERVIEW section but no day card is highlighted as active. The current code highlights the active day; whether that treatment carries over is unspecified.
11. **Where does the trip-shape framing (e.g., zoom-to-trip / zoom-to-day) come from in this layout?** No map-control chrome is drawn.
12. **Is the trip-hero photo's role unchanged?** It's still inside DayDetail as the first card, but with the map now visible behind everything, having a hero image inside an overlay (which is itself over a map) creates layering that the prior 3-column layout didn't.
13. **Reference-trip CTA placement.** `MakeItMineCta` is not drawn. Whether it persists, moves, or is removed for reference trips is unspecified.
14. **Header chip width is fixed at 675 px.** This doesn't account for longer trip titles; truncation / responsive behavior isn't specified.
15. **Does the Location Detail card's slight overlap with DayDetail (25 px) indicate the card is intentionally meant to "tuck under" the DayDetail's right edge, or is this a positioning artifact?**

## 8. What's NOT in the Paper file but needs to be decided

Items the new layout implies as decisions but doesn't directly address.

### 8.1 Search input

- **Where does a search input live?** The current codebase has `lib/routing/geocode.ts` (geocode helper, no UI yet) and search is on the active backlog. With the map now full-canvas, search would naturally surface as a floating input near the top of the canvas — but the bare-map area on the right (~427 px) is the only space not already claimed by the header chip, close ✕, or column overlays.
- Open: which surface, what trigger affordance, what does the result UI look like (dropdown? floating card? populates a new overlay?), and how does an added stop interact with the day cards in the day column.

### 8.2 Header

- The trip header (kebab, close ✕, trip metadata) is split across two floating elements (header chip top-left + close ✕ top-right) with a ~340 px gap of bare map between them.
- Open: do any other chrome elements (back, share, settings, search trigger?) live in that gap? It's the most visually prominent strip of canvas and isn't claimed.
- Open: the kebab on the header chip and the kebab on each day-header card inside DayDetail may show different menus (trip-level vs day-level). The drawn frame doesn't disambiguate them.

### 8.3 Empty state when no trip is open

- The slideup is intercepted from `/trips/[id]` — a trip id is always present when the slideup is mounted. So "no trip open" in the strict sense doesn't occur for this surface.
- But: empty-state edge cases exist. What if a trip has zero days? Zero waypoints in the active day? No `routePolyline`? No `startCoords`? The drawn frame shows none of these.

### 8.4 The bare-map area (right ~427 px)

- This is a primary surface in the new layout but holds no UI in the drawn frame.
- The Location Detail card lives there *when shown*. But what else is intended for that space?
- Likely candidates: search input, suggested stops layer (currently rendered as map markers), offline-region indicator, an off-cache banner (currently spans the full map column top), the DirectionsButton CTA, the NavGo button.
- Open: is the bare-map area meant to stay UI-light by design ("the trip on a map, with details and the day list to the side"), or is it just unstaffed in this single frame because no other state was drawn?

### 8.5 Z-order rules

- The drawn frame implies an order (map → translucent column overlays → opaque header chip / close ✕ / Location Detail). But the existing surfaces not redrawn (OfflinePanel drawer, DirectionsPanel, NavGo button, turn-by-turn nav, off-cache banner, suggested-stops dots, browse-panel dots) need explicit z-order rules against the new overlays.
- Open: a single z-index table for the new layout.

### 8.6 Mobile / responsive behavior

- The drawn frame is 1112 × 721 — desktop body size. No mobile-width variant is drawn.
- The current code lives in `SlideupShell` which is desktop-only (per `2026-05-15 shape brief`).
- Open: does the new layout map cleanly to a mobile equivalent (probably a full-screen map with the column overlays stacking vertically or as bottom sheets), or is mobile a separate layout?

### 8.7 Animations and transitions

- Open / dismiss transitions for the column overlays (translucent fade? slide from left?).
- Open / dismiss transition for the Location Detail card (fade in? slide up? grow from a map pin?).
- State transitions when switching active days — does the DayDetail content cross-fade, slide, or hard-swap?

### 8.8 Active-day highlight on the map

- The current `MapColumn` highlights the active day's leg in blue over the gold route line. With the day column overlay co-existing with the map, the blue highlight presumably still renders. Whether the day card in the day column has a corresponding visual treatment to bind it to the highlighted leg is unspecified.

## Appendix A — Paper file inventory of slideup-related frames

For grep / reference. Only `33Y-0` is the new layout; the others are the existing 3-column layout or unrelated variants.

| Paper node | Name | Size | Layout |
|---|---|---|---|
| `33Y-0` | `1RA9-0  Slideup · Default` | 1112 × 721 | **NEW** — map-as-background with floating overlays |
| `CH-0` | `1RA9-0  Slideup · Default` | 1112 × 721 | OLD — 3-column (opaque columns, map in right pane). Duplicate name, different layout |
| `4Q-0` | `Trip Slide Up` | 1112 × 721 | OLD — 3-column. Visually identical to `CH-0` |
| `K8-0` | `1RI0-0 Slideup · Browse 2-up` | 1133 × 744 | OLD layout + browse-panel overlay (category icons + 2-up location cards) |
| `VN-0` | `Frame` | 1134 × 746 | OLD — 3-column, slightly wider |
| `1-0` | `Frame` | 1133 × 744 | OLD — 3-column variant |

## Appendix B — Computed-style values (from Paper)

Verbatim values extracted via `get_computed_styles` for the eight direct children of frame `33Y-0`. Useful for reproducing exact colors / alphas / radii in code.

```
Frame 33Y-0 (canvas)
  width 1112  height 721  borderRadius 14px  outline 1px solid #3D3D3D

Rectangle 3BR-0 (map tile, leftmost)
  width 456  height 721  left -63  top 0
  background: url(...) cover 50%

Rectangle 3BP-0 (map tile, middle)
  width 458  height 725  left 226  top -4
  background: url(...) cover 50%

Rectangle 3AK-0 (map tile, right)
  width 458  height 725  left 683  top -4
  background: url(...) cover 50%

Frame 3AL-0 (DayColumnPlanner overlay)
  width 215  height 632  left 10  top 74
  background #0C0D0F at ~59% alpha (96 hex)
  border-right 0.5px solid #4A4848D4
  border-bottom-left-radius 14px
  overflow clip  flex-direction column

Frame 37H-0 (DayDetail overlay)
  width 459  height 632  left 225  top 74
  background #161819 at ~78% alpha (C7 hex)
  border-right 1px solid #FFFFFF12
  border-bottom-right-radius 15px
  overflow clip  flex-direction column  align-items center

Frame 33Z-0 (Location Detail · Food — hidden in drawn state)
  width 448  height fit-content  left 659  top 456
  background #1A1A1A (opaque)
  outline 1px solid #383636
  border-radius 10px
  overflow clip  flex-direction column  align-items center

Frame 39U-0 (Header chip)
  width 675  height 60  left 10  top 14
  background #162029 (opaque)
  border-top-left-radius 15px  border-top-right-radius 15px
  border-bottom 1px solid #FFFFFF24
  padding 0 16px 0 18px  flex align-items center  gap 15px

Frame 39V-0 (Close ✕)
  width 60  height 60  left 1047  top 14
  background #1D1E1F at ~56% alpha (8F hex)
  border 1px solid #FFFFFF2E
  border-radius 8px
  margin-right -12px
```

## Appendix C — Note on the three "Coastal map" rectangles

The Paper frame uses three duplicate raster rectangles (all referencing the same PNG asset) stacked at slightly offset positions to fake a continuous map background. This is a designer's tiling artifact; in code there is a single Mapbox GL map filling the canvas. Any reviewer reading the Paper file directly should ignore this multiplicity.
