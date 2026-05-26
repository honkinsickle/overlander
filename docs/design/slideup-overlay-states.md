# Slideup overlay states — three-frame spec

Source: Paper file "Overlander Trip Planning", three frames:

- `33Y-0` — **1RA9-0 Slideup · Default**
- `3CO-0` — **1RA9-0 Slideup · Search Active**
- `3KF-0` — **1RA9-0 Slideup · Collapsed**

All three frames are **1133 × 744**, 14 px outer border-radius, 1 px `#3D3D3D` outline. (Note: the prior layout spec at `docs/design/slideup-overlay-layout.md` documented `33Y-0` as 1112 × 721 — either the frame has been resized since that doc was written, or all three new states now share a slightly larger canvas. The three states are now consistent with each other at 1133 × 744.)

Written 2026-05-22. Builds on `docs/design/slideup-overlay-layout.md` (the single-frame spec for the new map-as-background layout). This doc focuses on the differences between the three drawn states and does not repeat the foundational layout description from the prior doc.

---

## 1. Summary

These three frames capture three states of the new map-as-background slideup layout: the **Default** view (full chrome — top bar, day column, day detail, close button, with the map peeking through translucent overlays and a bare-map strip on the right), the **Search Active** view (top-bar search input expanded with a large dark dropdown panel that visually obscures the day column and day detail), and the **Collapsed** view (full-canvas map with only the top bar — repositioned to the bottom edge — and the close button remaining). All three retain the same Top Bar (660 × 60, opaque `#162029`) and Close Button (60 × 60, translucent `#1D1E1F` at 56%) as floating chrome; what changes between states is which overlays are present and where the Top Bar is anchored.

---

## 2. Default state (`33Y-0`)

The map-as-background layout with all overlays visible. Functionally a refinement of the frame already documented in the prior layout spec.

### What's visible (back → front in z-order)

| # | Element | Layer name |
|---|---|---|
| 1 | Map background (3 tiled raster rectangles, designer artifact) | `Coastal map` × 3 |
| 2 | Day Column Planner overlay | `Day Column Planner` |
| 3 | Day Detail overlay | `Day Detail` |
| 4 | Location Detail card *(present in tree but hidden)* | `Location Detail · Food (Trapper's)` |
| 5 | Top Bar | `Top Bar` |
| 6 | Close Button | `Close Button` |

### Position, size, and background per element

**Top Bar** — `660 × 60`, anchored top-left, `left: 10`, `top: 12`. Opaque `#162029`. Border-radius 15 px on both top corners, 0 on bottom corners. Bottom border 1 px `#FFFFFF24` (~14 % white). Internal flex row, gap 15 px, padding `0 16 0 18` (top/right/bottom/left).

**Close Button** — `60 × 60`, anchored top-right, `left: 1063`, `top: 12` (with `margin-right: -12 px` for a slight overhang). Background `#1D1E1F` at `8F` alpha (~56 %). Asymmetric radius: `8 / 12 / 8 / 8` (top-right corner is 12 px, the others are 8 px). No outline.

**Day Column Planner** — `217 × 663`, `left: 10`, `top: 72` (i.e. flush below the Top Bar with no gap). Background `#0C0D0F` at `96` alpha (~59 %) — heavy dark tint over the map. Border-right 0.5 px `#4A4848D4`. Border-radius 14 px on bottom-left only (top corners square against Top Bar). `overflow: clip`, `flex-direction: column`.

**Day Detail** — `445 × 663`, `left: 225`, `top: 72` (flush right of Day Column, with the column's 0.5 px border-right as the seam). Background `#161819` at `C7` alpha (~78 %) — lighter than the Day Column tint. Border-right 1 px `#FFFFFF12` (~7 % white). Border-radius 15 px on bottom-right only. `overflow: clip`, `flex-direction: column`, `align-items: center`.

> The Day Detail width here is **445 px** (vs. 459 px in the prior layout spec). Total left-overlays width is `217 + 445 = 662 px`, with the column-to-detail seam at x = 225 (i.e. an 8 px visual gap between column right edge at x = 227 and detail left edge at x = 225 — actually a 2 px *overlap* given the day column ends at 227 and detail starts at 225; the 0.5 px border-right on the column sits inside that overlap).

**Location Detail card** *(hidden in this state but present in tree)* — `448 × fit-content`, `left: 659`, `top: 456`. Opaque `#1A1A1A`, 1 px outline `#383636`, border-radius 10 px. Distinct treatment from the translucent column overlays — this is a solid floating card.

**Map background** — three `Coastal map` rectangles tiled across the canvas (456 × 744 at `left: -63`, 458 × 748 at `left: 226`, 501 × 748 at `left: 683`). A designer's mocking artifact, not a layout feature.

### Z-order

Map (back) → Day Column Planner → Day Detail → Location Detail (hidden) → Top Bar → Close Button (front). Top Bar and Close Button are coplanar in z and don't overlap each other (Top Bar ends at x = 670; Close Button starts at x = 1063, with the 5 px right-side overhang from `margin-right: -12 px`).

### Text content visible

- **Top Bar:** `Los Angeles to Portland:` (Barlow SemiBold 18 px, `#E9E9E7`) + ` 5/31-6/05` (Barlow Light 18 px, `#E9E9E7`, 0.06 em tracking). Second row: ` 6 Days • 2,518 mi • 9 Overnights` (Barlow Light 13 px, **amber `#FDBA74`**, 0.06 em tracking). To the right: a 53 × 59 button with a downward-pointing arrow glyph (`#888888` stroke), then a 216 × 59 search box with placeholder `Search for anything` (Barlow Regular 14 px, `#B3B3B3`) and a trailing 14 × 14 magnifier glyph (`#6381A8`), then a 60 × 60 kebab button (three `#888888` dots).
- **Day Column Planner header:** `Itinerary` (Barlow SemiBold-ish, 97 × 33) with a 36 × 36 chevron control.
- **Day Column day cards** (five visible, each 215 × 112): `84 mi | 2.3 hrs / Day 01 / Sun 5/31 / Yakima, WA — Hood River, OR`, `58 mi | 1.5 hrs / Day 02 / Mon 6/1 / Hood River, OR — Mt Hood`, `63 mi | 1.7 hrs / Day 03 / Tue 6/2 / Mt Hood — Portland, OR`, `63 mi | 1.7 hrs / Day 04 / Tue 6/3 / Mt Hood — Portland, OR`, `63 mi | 1.7 hrs / Day 04 / Tue 6/4 / Mt Hood — Portland, OR`. The last card visibly clips at the bottom of the column (overflow: clip), implying internal scroll. Two cards both carry the `Day 04` tag (Tue 6/3 and Tue 6/4) — this is what the mock shows.
- **Day Detail trip-hero:** rocky coastal sunset image (420 × 335 frame), then `Los Angeles to Portland` title with a calendar glyph + `5/31-6/05` and a weather chip `● 84° / 64°F`.
- **Day Detail itinerary header card:** `Seattle, WA — Mount Rainier NP` / `Day 1 — Fri, May 29` with a trailing kebab. Day-detail day label (`Day 1 — Fri, May 29`) does not match the Day Column's first card (`Day 01 / Sun 5/31`) — the mock shows two different active-day states layered in the same frame.
- **Day Detail waypoint card:** `Banff Townsite` with description `Stock up on supplies, grab a proper coffee, and catch a last hot shower before backcountry.` and amber tip `↳ Park at the Hi-Alpine lot. Meters don't run past 5pm.` plus a trailing `→` affordance.

### What's hidden compared to other states

Nothing hidden relative to Search Active (same layer set). Relative to Collapsed: Day Column Planner, Day Detail, and Location Detail are absent in Collapsed.

### Visible state indicators

- The Day Column's `Itinerary` header has a chevron — visually present but no expanded/collapsed indicator is drawn.
- No day card in the Day Column shows an active-day highlight (no selected/focused/active treatment is rendered, despite the Day Detail showing Day 1 content).
- No tab system is drawn (the prior layout spec's `OVERVIEW / Explore / Places to visit` tabs are absent in this frame).
- The Top Bar's down-arrow icon (rotation 270 deg from horizontal `←` → arrow points **down**) is the visual cue for the transition to Collapsed (see §5).

---

## 3. Search Active state (`3CO-0`)

The top-bar search input expanded into a "search mode" with a large dropdown panel beneath it.

### What's visible (back → front in z-order)

Same layer list as Default: `Coastal map` × 3 → `Day Column Planner` → `Day Detail` → `Location Detail · Food (Trapper's)` (hidden) → `Top Bar` → `Close Button`.

Critically: the Day Column Planner and Day Detail are **still in the layer tree with the same content as Default**, but they are **visually obscured** by an absolutely-positioned dark panel that lives inside the Top Bar's search-input subtree (see "search dropdown panel" below).

### Position, size, and background per element

**Top Bar** — same geometry as Default: `660 × 60`, `left: 10`, `top: 12`, opaque `#162029`, top-corners 15 px. **The Top Bar's internal layout is different from Default** — it shows a leading magnifier icon, a wide search input box, and a trailing kebab; the title/metadata text is *not* visible.

  - Leading search icon — `53 × 59`, dark `#1B2A32` ground, white `#F7FAFF` magnifier glyph.
  - Search input — `607 × 58`, background `#1A1F28`, 4 px border-radius. Placeholder text `Search for anything!` (Barlow Regular 14 px, `#FFFFFF`, **with an exclamation mark** — Default uses `Search for anything` without one). Inside the input at left, a 20 × 20 magnifier glyph (`#F7FAFF`).
  - Trailing 53 × 59 button with a downward-pointing arrow glyph (same rotation 270 deg as Default → points down).
  - Trailing 60 × 60 kebab (three `#888888` dots, `#1B2A32` ground).

**Search dropdown panel** — `658 × 662`, opaque `#1A1F28`, border-radius `0 / 0 / 15 / 15` (square top, rounded bottom). Positioned `top: 59` inside the search-input wrapper. In frame coordinates this places it from roughly `(x ≈ 10, y ≈ 72)` extending down to `(x ≈ 668, y ≈ 734)` — i.e. it occupies the same rectangular footprint as **Day Column Planner + Day Detail combined**, plus a slight extension to the bottom-right.

  - This panel is empty in the mock. No results, no filters, no category chips, no "add to day" CTAs are drawn inside it.
  - The panel sits above Day Column and Day Detail in z-order (because it's inside Top Bar, which is rendered after both), so it visually covers them.
  - The panel's opaque fill is what makes the left-and-center area read as a single uniform dark surface in the rendered screenshot, despite Day Column and Day Detail still being present underneath.

**Close Button** — identical to Default: `60 × 60`, `left: 1063`, `top: 12`, `#1D1E1F8F`. Unchanged.

**Day Column Planner** — *present, same geometry and content as Default* (`217 × 663` at `left: 10, top: 72`), but obscured by the search dropdown.

**Day Detail** — *present, same geometry and content as Default* (`445 × 663` at `left: 225, top: 72`), but obscured by the search dropdown.

**Location Detail card** — `448 × fit-content`, `left: 659`, `top: 456`, opaque `#1A1A1A`, hidden in this state (same as Default).

**Map background** — same three tiled `Coastal map` rectangles. Visible to the right of the search dropdown (from x ≈ 668 to x = 1133).

### Z-order

Map → Day Column Planner → Day Detail → Location Detail (hidden) → Top Bar (which contains the dropdown panel as a descendant, so the dropdown is rendered above Day Column and Day Detail) → Close Button.

### Text content visible

- Top Bar: only `Search for anything!` placeholder + the magnifier glyph + the arrow + the kebab dots. The trip title and metadata that appear in Default's Top Bar are not rendered in this state.
- Day Column and Day Detail content: still in the tree, but visually obscured. Not visible to the viewer.
- Search dropdown: empty. No text content.

### What's hidden compared to other states

- All Day Column and Day Detail content is visually hidden (though it remains in the layer tree). Relative to Default, the layered content is the same; only the rendered visibility differs because of the dropdown panel.
- The trip title and metadata that appear in the Default Top Bar are not visible.

### Visible state indicators

- The search input is rendered in a wider, more prominent form than in Default (607 px wide vs. 216 px in Default).
- The search input's leading magnifier glyph is bright white (`#F7FAFF`) here vs. a smaller blue-gray (`#6381A8`) in Default.
- No filter chips, category controls, recent-search rows, or empty-state copy are drawn in the dropdown.

---

## 4. Collapsed state (`3KF-0`)

The full-canvas map view. Day Column, Day Detail, and Location Detail are all removed. Top Bar relocates to the bottom of the canvas.

### What's visible (back → front in z-order)

| # | Element | Layer name |
|---|---|---|
| 1 | Map background (a single `1141 × 1704` `Coastal map` rectangle filling the canvas) | `Coastal map` |
| 2 | Top Bar | `Top Bar` |
| 3 | Close Button | `Close Button` |

### Position, size, and background per element

**Map background** — `1141 × 1704`, `left: 0`, `top: -318`. A single oversized rectangle providing the full-canvas map view. The 3-tile mocking technique used in Default and Search Active is replaced by one large rectangle here.

**Top Bar** — `660 × 60`, **`left: 10`, `top: 667`** (vs. `top: 12` in Default and Search Active). This is the most significant geometric change between states: the Top Bar relocates to the bottom of the canvas, with its bottom edge at y = 727 (i.e. 17 px from the canvas bottom edge of y = 744). All other Top Bar styling (opaque `#162029`, top-corners 15 px, bottom border) is identical to Default.

  - Internal content of the Top Bar is identical to Default: title `Los Angeles to Portland:` + date ` 5/31-6/05` + metadata ` 6 Days • 2,518 mi • 9 Overnights` (amber `#FDBA74`) + 53 × 59 arrow button + 216 × 59 search box `Search for anything` + 60 × 60 kebab.
  - **The arrow button glyph is rotated 90 deg (points up)** instead of 270 deg (points down) as in Default and Search Active. This is the only visual difference in the Top Bar's content between Default and Collapsed.

**Close Button** — `60 × 60`, `left: 1063`, `top: 12`. **Unchanged from Default** — remains at the top-right corner even though the Top Bar moves to the bottom.

### Z-order

Map → Top Bar → Close Button.

### Text content visible

Same as Default's Top Bar content (title, date, metadata, search-box placeholder, kebab dots).

### What's hidden compared to other states

Relative to Default and Search Active: Day Column Planner, Day Detail, and Location Detail are all absent (not in the layer tree). The map is fully visible across the whole canvas except for the Top Bar at the bottom and the Close Button at the top-right.

### Visible state indicators

- The arrow glyph rotation (90 deg / up) signals "expand" — the inverse of Default's 270 deg / down "collapse" affordance.
- No other state indicators are drawn.

---

## 5. Transitions / state changes

| From → To | Trigger | Trigger location | Visible behavior |
|---|---|---|---|
| Default → Collapsed | Click the down-arrow button in the Top Bar | Top Bar, x ≈ 599 (relative to frame; left 589 inside the 660-wide Top Bar). Arrow glyph rotated 270 deg (points down). | Not specified. Frame shows the after-state but not the animation. Inferred: Day Column / Day Detail dismiss (slide down? fade?); Top Bar moves from `top: 12` to `top: 667`; arrow glyph flips from 270 deg to 90 deg. |
| Collapsed → Default | Click the up-arrow button in the Top Bar (same position, glyph rotated 90 deg) | Top Bar, x ≈ 599 (now at `top: 667`). | Not specified. Inverse of the above. |
| Default → Search Active | Click the search input box in the Top Bar | Top Bar, search-box region (216 px wide at x ≈ 375 relative to frame). | Not specified. Frame shows the after-state. Inferred: the search input grows from 216 × 59 to 607 × 58 (laterally taking over the title/metadata slot inside the Top Bar); the dropdown panel (658 × 662) appears below the input, occluding Day Column and Day Detail. |
| Search Active → Default | Not specified | No explicit dismiss control drawn inside the Top Bar in Search Active. The down-arrow and kebab are still present. | Not specified. The Close Button (top-right) closes the slideup entirely, not the search state. |
| Search Active → Collapsed | Not specified | Not drawn. | Not specified. |
| Default → (close slideup) | Click the Close Button (top-right ✕) | Frame top-right, `left: 1063, top: 12`. | Behavior owned by `SlideupShell` (`router.back()` per the prior layout spec). |

The frames do not draw transitional states (no in-progress animations are shown). Direction, easing, and duration are not specified anywhere in Paper.

---

## 6. Search Active — specific details

- **Search input position.** Inside the Top Bar, leading-aligned after the magnifier-icon affordance. The input wrapper is at `left: 0, top: 1` relative to the Top Bar (essentially flush with the Top Bar's left edge once the Top Bar's 18 px left padding is counted). The input itself is `607 × 58`, with internal 13 px left padding and 14 px right padding, and a 20 × 20 magnifier glyph at the leading edge of the input. The Top Bar itself remains at `left: 10, top: 12` — same as Default.
- **Where results render.** Inside the same dark dropdown panel that lives as a child of the search-input wrapper. Panel is `658 × 662`, positioned `top: 59` relative to the input (i.e. flush with the Top Bar's bottom edge). Frame-coordinate footprint ≈ `x: 10 → 668, y: 72 → 734`. **No results are drawn in the mock** — the panel is empty.
- **Persistent or modal.** Neither pure-modal nor purely-persistent in the way Paper draws it. The panel is fixed to the Top Bar's search-input region and obscures the Day Column + Day Detail content area, but it isn't a separate full-screen modal — the Close Button and map remain interactive (or at least visible) around it.
- **Filter / category controls.** None drawn. The dropdown panel is empty in the mock.
- **Day Detail state during search.** The prior decision summary in this conversation expected "search takes over the Day Detail slot." The Paper frame instead shows that **search covers the combined Day Column + Day Detail footprint** (658 × 662 dropdown panel) — not just the Day Detail. Both Day Column and Day Detail remain in the layer tree with their Default content, but are visually obscured. So: confirm the underlying-content-stays-mounted half of the prior decision, but correct the geometry — search obscures both left overlays, not just Day Detail.
- **"Add to day" or result-row CTAs.** None drawn. The panel contains no result rows of any kind.
- **Trip metadata in Top Bar.** Not rendered when search is active. The Top Bar contains only the magnifier icon, the expanded input (with `Search for anything!` placeholder), the down-arrow, and the kebab.

---

## 7. Collapsed — specific details

- **Hidden overlays.** Day Column Planner, Day Detail, and Location Detail are not in the layer tree for this state (vs. present-but-possibly-hidden in Default / Search Active).
- **Remaining overlays.** Top Bar and Close Button.
- **Way to expand back.** The Top Bar's arrow button is rotated 90 deg (up-arrow) in this state, signaling "expand." It sits in the same x-position as Default's down-arrow (at the right end of the Top Bar's main content row, before the kebab). No other expand affordance is drawn.
- **Is this the "fullscreen map" state?** Yes, in effect — the map fills the entire canvas, with only two pieces of floating chrome remaining (Top Bar at the bottom, Close Button at the top-right). The Top Bar still contains the same content as Default's (title, metadata, search box, kebab), so this isn't a true "all chrome dismissed" mode; it's "all body overlays dismissed, top-bar relocated to bottom-of-canvas."

---

## 8. Comparison table

Coordinates are in frame-local pixels. "—" = not in the layer tree for that state. "Hidden" = in the tree but rendered hidden (zero height / clipped / under another layer).

| Element | Default (`33Y-0`) | Search Active (`3CO-0`) | Collapsed (`3KF-0`) |
|---|---|---|---|
| **Frame size** | 1133 × 744 | 1133 × 744 | 1133 × 744 |
| **Map background** | 3 × `Coastal map` rectangles tiled | 3 × `Coastal map` rectangles tiled | 1 × `Coastal map` (1141 × 1704) |
| **Top Bar** | `660 × 60` at `left: 10, top: 12`. `#162029` opaque. Shows title + metadata + search-box + down-arrow + kebab. | `660 × 60` at `left: 10, top: 12`. `#162029` opaque. Shows magnifier-icon + expanded-search-input + down-arrow + kebab. Title/metadata hidden. | `660 × 60` at `left: 10, top: **667**` (bottom of canvas). `#162029` opaque. Same content as Default but arrow glyph rotated 90 deg (up). |
| **Search input** | `216 × 59` inside Top Bar at relative left 365. Placeholder `Search for anything`. Trailing magnifier glyph (`#6381A8`). | `607 × 58` inside Top Bar at relative left 0. Placeholder `Search for anything!` (with `!`). Leading magnifier glyph (`#F7FAFF`). | Same as Default: `216 × 59` inside Top Bar. |
| **Search dropdown panel** | — | `658 × 662` opaque `#1A1F28`, positioned below the search input. Empty (no content drawn). | — |
| **Close Button** | `60 × 60` at `left: 1063, top: 12`. `#1D1E1F8F` (~56 % opacity). | Same as Default. | Same as Default — does **not** move with the Top Bar. |
| **Day Column Planner** | `217 × 663` at `left: 10, top: 72`. `#0C0D0F96` (~59 % opacity). Header `Itinerary` + chevron + 5 day cards (Day 01–04, last duplicated). | Present in tree with same geometry/content. Visually obscured by search dropdown. | — |
| **Day Detail** | `445 × 663` at `left: 225, top: 72`. `#161819C7` (~78 % opacity). Trip-hero + itinerary + Day 1 header + `Banff Townsite` waypoint. | Present in tree with same geometry/content. Visually obscured by search dropdown. | — |
| **Location Detail card** | `448 × fit-content` at `left: 659, top: 456`. Hidden in this state. | Hidden in this state. | — |
| **Bare-map area** | Right ≈ 465 px (from x ≈ 668 to x = 1133) | Right ≈ 465 px, visible | Entire canvas minus Top Bar (footprint at bottom) and Close Button (top-right) |

---

## 9. Unanswered design questions

Items the three frames don't address.

1. **Day Column / Day Detail dismissal affordance.** Default and Search Active both keep Day Column + Day Detail in the layer tree. Collapsed removes them. The trigger between these states is the down-arrow button in the Top Bar, but the frames don't show whether the arrow individually dismisses the body overlays (Default → Collapsed) or whether some other affordance (e.g. Search Active → Default → Collapsed) is also possible.
2. **Search-state dismiss.** No explicit "cancel search" affordance is drawn inside the Search Active Top Bar (no ✕ on the input, no "Cancel" button). The down-arrow and kebab are still there; the Close Button still closes the slideup. The way back to Default is not shown.
3. **Search results UI.** The Search Active dropdown is empty. No examples of result rows, empty states ("type to search…"), recent searches, filter chips, category tabs, or "add to day" CTAs are drawn.
4. **Search dropdown bounds.** The dropdown is `658 × 662` — slightly wider than the Day Column + Day Detail combined (`217 + 445 = 662`, with a 0.5 px column-border-right seam) and roughly the same height. Whether this is intentional (snap to combined overlay bounds) or coincidental geometry is unspecified.
5. **Day 04 duplication in Day Column.** Two day cards in the Day Column carry the `Day 04` tag (Tue 6/3 and Tue 6/4). The mock shows this as-is; whether it's a designer artifact or an intentional state (e.g. inserted day, layover) is not annotated.
6. **Mismatch between Day Column active day and Day Detail header.** Day Column shows Day 01 Sun 5/31; Day Detail header shows `Day 1 — Fri, May 29`. The two are inconsistent in the mock. No active-day highlight is drawn in either overlay.
7. **Arrow direction semantics.** Default has the arrow rotated 270 deg (down); Collapsed has it rotated 90 deg (up); Search Active has it rotated 270 deg (down) — same as Default. Whether the arrow in Search Active does the same thing as in Default (Default → Collapsed) or whether it does something else when search is active is not specified.
8. **Kebab in Search Active.** Same `#1B2A32` 60 × 60 kebab button is rendered in the Search Active Top Bar. Whether its menu differs in this state (e.g. search-specific actions) is not drawn.
9. **Map interaction under the search dropdown.** The dropdown is opaque `#1A1F28` and fully obscures the map underneath the Day Column / Day Detail footprint. Whether the bare-map area to the right of the dropdown (≈ 465 px) remains interactive during search is not specified.
10. **Location Detail card on Collapsed state.** Not in the Collapsed layer tree. Whether map-pin taps in Collapsed surface the same Location Detail card, or use a different surface, is unspecified.
11. **Up-arrow vs down-arrow visual difference.** The only difference between Default and Collapsed top-bar content is the arrow rotation. No additional visual treatment (color, weight, background) differentiates the two states beyond the rotation.
12. **Top Bar at the bottom in Collapsed — radius behavior.** The Top Bar's `border-top-left-radius: 15 px` and `border-top-right-radius: 15 px` are inherited from Default. In Collapsed, the Top Bar sits at the bottom of the canvas with its rounded corners on top. The visual effect is that the Top Bar appears as a bottom bar with curved top edges — whether this is intentional or whether the radii should swap to bottom-corners is unspecified.
13. **Title length in Collapsed and Default.** Title `Los Angeles to Portland:` + ` 5/31-6/05` fits within the title row in the Top Bar. Truncation behavior for longer titles is not drawn.
14. **Frame canvas size.** All three frames are 1133 × 744, larger than the 1112 × 721 documented in the prior layout spec for `33Y-0`. Whether the slideup body has actually been resized (and the prior spec is now stale) or whether the new frames are intended to be cropped to 1112 × 721 on render is unspecified.
15. **Search trigger affordance in Collapsed.** The Collapsed Top Bar contains the same `Search for anything` box as Default. Tapping it presumably enters Search Active — but the frames don't explicitly chain Collapsed → Search Active, so whether Collapsed → Search Active first restores Default + opens search, or jumps directly to Search Active, is unspecified.

---

## 10. What's implied but not shown across all three frames

State surfaces the layout creates as new decisions but which none of the three drawn states address.

- **Empty state (no trip open).** All three frames render the same trip (`Los Angeles to Portland`). What the slideup looks like with a trip that has zero days, zero waypoints, no `routePolyline`, or no `startCoords` is not drawn.
- **Active turn-by-turn navigation.** The current code has a nav layer that takes over `MapColumn` when engaged. None of the three frames show how that layer relates to the new overlays — whether Day Column / Day Detail / Top Bar are hidden, dimmed, or retained during nav is unspecified.
- **`OfflinePanel` drawer open.** The kebab on the Top Bar (and the kebab on the day-header card inside Day Detail in Default) presumably opens `OfflinePanel`. None of the three frames show the drawer's slide direction, width, or z-order relative to the new overlays.
- **`DirectionsPanel` open.** Triggered today by `DirectionsButton` floating on `MapColumn`. The button's position in any of the three new frames is not drawn, and the panel's geometry over the new layout is unspecified.
- **Hover / focus / pressed / loading states.** No interactive states are drawn for any control. The Top Bar buttons (down-arrow, kebab), the day cards in the Day Column, the search input, the kebab on the day-header card inside Day Detail, and the Close Button all show only a single resting state.
- **Mobile vs. desktop sizing.** All three frames are 1133 × 744 — desktop only. No mobile-width variants, no breakpoints, no responsive behavior are drawn.
- **Browse / category panel** (the `1RI0-0 Slideup · Browse 2-up` frame in the file) is not drawn against the new map-as-background layout in any of these three frames.
- **Off-cache banner** (`OffCacheBanner`, top of `MapColumn` per PR #47). Not drawn in any of the three states. Whether it persists in Collapsed (where it would float on the bare-map canvas) or only appears in Default / Search Active is unspecified.
- **NavGo button.** Not drawn in any of the three states. Its position relative to the new layout is unspecified.
- **Reference-trip vs. user-trip differences.** None of the three frames render a `MakeItMineCta` or any reference-trip-specific affordance. Whether reference trips show a different state is unspecified.

---

## Appendix — Layer naming (post-rename, current as of 2026-05-22)

Top-level layer names were normalized across the three frames during this session. The names below are now consistent across all states where the layer exists.

| Frame | Top-level layers |
|---|---|
| `33Y-0` Default | `Coastal map` × 3, `Day Column Planner`, `Day Detail`, `Location Detail · Food (Trapper's)` *(hidden)*, `Top Bar`, `Close Button` |
| `3CO-0` Search Active | `Coastal map` × 3, `Day Column Planner`, `Day Detail`, `Location Detail · Food (Trapper's)` *(hidden)*, `Top Bar`, `Close Button` |
| `3KF-0` Collapsed | `Coastal map` × 1, `Top Bar`, `Close Button` |
