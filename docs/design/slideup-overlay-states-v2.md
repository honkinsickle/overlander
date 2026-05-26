# Slideup overlay states v2 — six-frame spec

Source: Paper file "Overlander Trip Planning". Six frames, all **1133 × 744**, 14 px outer border-radius, 1 px `#3D3D3D` outline:

| Paper node | Name | Status |
|---|---|---|
| `33Y-0` | **1RA9-0 Slideup · Default** | Updated from v1 |
| `3CO-0` | **1RA9-0 Slideup · Search Active** | Updated from v1 |
| `3KF-0` | **1RA9-0 Slideup · Collapsed** | Updated from v1 |
| `4JK-0` | **1RA9-0 Slideup · Directions Active** | New in v2 |
| `4SO-0` | **1RA9-0 Slideup · Offline Panel Open** | New in v2 |
| `51S-0` | **1RA9-0 Slideup · Nav Active** | New in v2 |

Plus a scratch component artboard `Slideup · Components (scratch)` (`3S7-0`) containing the Right-Edge Toolbar, Day Pill (two variants), and Trip Action FAB.

Written 2026-05-23. Builds on `docs/design/slideup-overlay-states.md` (v1 — three drawn states) and `docs/design/slideup-overlay-layout.md` (foundational map-as-background spec). This doc documents the post-decision state of all six frames and how they differ from each other; it does not repeat the foundational layout description from the prior docs.

---

## 1. Summary

These six frames capture the full state machine of the trip-detail slideup overlay after a round of design decisions baked into Paper. Three new floating-chrome components are introduced and rolled out across the states: a **Right-Edge Toolbar** (always-present cluster of map controls), a **Day Pill** (active-day indicator, only visible when the Day Column is hidden), and a **Trip Action FAB** ("Add stop here" — Default only). Two new panel surfaces are added: a **Directions Panel** that takes over the Day Column + Day Detail footprint following the same pattern as the search dropdown, and an **OfflinePanel drawer** that slides in from the right while the toolbar z-stacks above it. A sixth **Nav Active** state shows the layout during turn-by-turn driving, with the Day Column auto-collapsed, a 3-icon reduced toolbar (Nav becomes a red Stop), and a bottom-anchored Nav Directions Panel.

---

## 2. Cross-state design decisions baked in

Ten decisions applied across the six frames, ordered by the brief:

1. **No "Quick action FAB" at top-right** — confirmed; no such surface exists in any frame. The only top-right element is the Close ✕.
2. **Right-Edge Toolbar** — vertical column of 60 × 60 buttons at `left: 1065`, anchored to the right edge with 8 px margin, ordered top-to-bottom: **Nav · Directions · Locate · Fullscreen · Search**. Ordering reflects use-frequency during driving (highest at top). Present in all six states; reduced to 3 icons (Nav-as-Stop / Locate / Fullscreen) in Nav Active.
3. **Trip Action FAB** — labeled action "Add stop here", icon `map-pin-plus`, blue `#1F5E8E` (matches "Add to Day N" CTAs in the Suggestion Card v2 reference; original brief said amber but that conflicted with the system convention where amber = measurement chip, not action). Visible in Default; hidden in Search Active, Collapsed, Directions Active, Offline Panel Open, Nav Active.
4. **Search results add to currently-active day** — tap a row to add; whole row is the tap target (no per-row "Add" CTA). The "where it adds to" affordance lives in an inline `ADDING TO Day 1 · Fri, May 29 ▼` header at the top of the search-results dropdown.
5. **Collapsed = fullscreen-map mode** — hides all body overlays except Map, Close ✕, Right-Edge Toolbar, and the Top Bar (which docks to the bottom of the canvas — same as v1). The Fullscreen toolbar icon renders in its active variant (`#FDBA74` at 15 % bg + 40 % outline, full-amber icon stroke) in Collapsed.
6. **Directions Active** — Directions Panel takes over the same footprint as the search dropdown (left 10, top 72, 658 × 662). Day Column + Day Detail remain in the layer tree, visually obscured. The Right-Edge Toolbar stays visible to the right; Trip Action FAB hidden.
7. **Offline Panel Open** — Drawer slides in from the right, 440 px wide, full-height, opaque `#161819`. The Right-Edge Toolbar is z-stacked above the drawer. Day Column dimmed (opacity 0.5); Day Detail stays at default opacity (the drawer doesn't overlap it horizontally). FAB hidden.
8. **Nav Active** — Day Column auto-hidden, Day Detail hidden, Location Detail removed. Nav Directions Panel docks at the bottom (1133 × 223, ~30 % of canvas height). Toolbar reduced to 3 icons: Nav rendered as a red **Stop** button (`#DC2626` fill, white square glyph, faint red glow), then Locate, then Fullscreen. Day Pill at top-center showing the day being driven.
9. **Quick action FAB removal** — see #1.
10. **Day Pill** — active-day-context indicator. Rendered only when the Day Column is fully hidden (currently: Nav Active only). In states where the Day Column is visible (Default, Directions Active, Offline Panel Open), the active-day amber-edge highlight on the day card serves as the indicator. In Search Active where the column is obscured by the search dropdown, an inline `ADDING TO Day N ▼` header inside the dropdown replaces the pill (more compact than a floating chip; same day-switching affordance via the chevron). The original brief had the pill visible in Default and Search Active; reviewer feedback during the build reduced the pill's footprint to "only when Day Column is hidden."

---

## 3. Default state (`33Y-0`)

The map-as-background layout with the full chrome cluster, no active panel.

### Visible elements (back → front in z-order)

| # | Element | Layer name | Notes |
|---|---|---|---|
| 1 | Map background (3 tiled raster rectangles, designer artifact) | `Coastal map` × 3 | |
| 2 | Day Column Planner overlay | `Day Column Planner` | Active-day highlight on Day 01 card |
| 3 | Day Detail overlay | `Day Detail` | Trip hero + Day 1 itinerary + waypoints |
| 4 | Location Detail card *(in tree, hidden)* | `Location Detail · Food (Trapper's)` | |
| 5 | Top Bar | `Top Bar` | Title + metadata + search input + arrow + kebab |
| 6 | Close Button | `Close Button` | Top-right ✕ |
| 7 | Right-Edge Toolbar | `Right-Edge Toolbar` | 5 buttons, all neutral |
| 8 | Trip Action FAB | `Trip Action FAB` | Blue pill, "Add stop here", bottom-right |

### Positions & sizes

- **Top Bar:** `660 × 60` at `left: 10, top: 12`. Opaque `#162029`. Border-radius 15 px on top corners.
- **Close Button:** `60 × 60` at `left: 1063, top: 12`. `#1D1E1F8F` (~56 % alpha) with asymmetric 8/12/8/8 radius and `margin-right: -12 px` for the overhang.
- **Day Column Planner:** `217 × 663` at `left: 10, top: 72`. `#0C0D0F96` (~59 %), 14 px bottom-left radius.
- **Day Detail:** `445 × 663` at `left: 225, top: 72`. `#161819C7` (~78 %), 15 px bottom-right radius.
- **Right-Edge Toolbar:** `60 × 316` at `left: 1065, top: 214` (vertically centered on the canvas). Container is a flex column with 4 px gap between buttons.
  - Each button: `60 × 60`, `#1D1E1F8F`, 8 px radius, 1 px `#FFFFFF2E` outline. Icon stroke `#E9E9E7`, 22 × 22.
- **Trip Action FAB:** auto-sized ~161 × 56 (extended-FAB pill), positioned at `left: 952, top: 664` (~24 px from bottom + right edges). Background `#1F5E8E`, 28 px radius (full pill), drop shadow `0 6px 16px rgba(0,0,0,0.35) + 0 2px 4px rgba(0,0,0,0.25)`. Icon `#FFFFFF` 20 × 20 `map-pin-plus`. Text "Add stop here" — Barlow SemiBold 14 px white.

### Background treatment

Layers from back to front:
1. Map (3 raster rectangles)
2. Day Column overlay tints map heavily (`#0C0D0F96`)
3. Day Detail overlay tints map lightly (`#161819C7`)
4. Bare-map strip on right (x ≈ 670 to 1133, ~465 px) — full visibility
5. Top Bar opaque
6. Close Button translucent
7. Toolbar buttons translucent
8. FAB opaque

### Text content

- **Top Bar:** title `Los Angeles to Portland:` (Barlow SemiBold 18 px `#E9E9E7`) + ` 5/31-6/05` (Barlow Light 18 px `#E9E9E7`, 0.06 em tracking). Metadata row ` 6 Days • 2,518 mi • 9 Overnights` (Barlow Light 13 px amber `#FDBA74`, 0.06 em tracking). Inline search input with `Search for anything` placeholder (Barlow 14 px `#B3B3B3`) + magnifier glyph `#6381A8`. Down-arrow button (rotation 270 deg) + kebab.
- **Day Column:** `Itinerary` section header. 5 day cards: `Day 01 / Sun 5/31 / Yakima, WA — Hood River, OR` (and similar for Day 02–04, with Day 04 appearing twice for Tue 6/3 and Tue 6/4 — a mock artifact carried from v1).
- **Day Detail:** trip hero (`Los Angeles to Portland` · `5/31-6/05` · weather chip), then `Itinerary` section, Day 1 header card (`Seattle, WA — Mount Rainier NP / Day 1 — Fri, May 29` + kebab), then `Banff Townsite` waypoint card with description + amber tip.
- **Trip Action FAB:** `Add stop here`.

### What's hidden compared to other states

- vs. Search Active: no inline `ADDING TO` header, no obscuring dropdown.
- vs. Collapsed: column overlays + FAB are present.
- vs. Directions Active: no obscuring Directions Panel; FAB is present.
- vs. Offline Panel Open: no drawer; Day Column is not dimmed; FAB is present.
- vs. Nav Active: Day Column / Day Detail visible; FAB visible; full 5-icon toolbar.

### Visible state indicators

- **Active day** = the amber left-edge highlight on the Day 01 card in the Day Column (no separate Day Pill in this state).
- **All toolbar buttons neutral** (no icon in active state).

---

## 4. Search Active state (`3CO-0`)

Top-bar search input expanded with a large opaque dropdown that obscures the Day Column + Day Detail combined footprint. Search results render in the dropdown; tapping a row adds it to the currently-active day.

### Visible elements (back → front in z-order)

| # | Element | Notes |
|---|---|---|
| 1 | Map background (3 × `Coastal map`) | |
| 2 | Day Column Planner *(in tree, obscured)* | |
| 3 | Day Detail *(in tree, obscured)* | |
| 4 | Location Detail *(in tree, hidden)* | |
| 5 | Top Bar with expanded search input | Title/metadata hidden, search input takes center |
| 6 | Close Button | |
| 7 | Right-Edge Toolbar | Search icon in active state |
| 8 | Search Results | Inline `ADDING TO` header + 4 result rows, rendered as a sibling overlay anchored at `left: 10, top: 72, width: 658` |

Trip Action FAB hidden.

### Positions & sizes

- **Top Bar** — same geometry as Default (`660 × 60` at `left: 10, top: 12`), but internal layout swapped: leading magnifier icon (53 × 59, `#1B2A32`, white `#F7FAFF` glyph), then expanded search input (607 × 58, `#1A1F28`, 4 px radius, placeholder `Search for anything!`), then down-arrow, then kebab. Title and metadata text are not rendered.
- **Search Results overlay** — `left: 10, top: 72, width: 658`. Visually overlaps the same footprint as the obscuring dropdown rectangle (`#1A1F28`) that lives inside the Top Bar's search-input subtree.
  - **Inline `ADDING TO` header** — top of the overlay. `ADDING TO` label (Space Grotesk Medium 10 px, 0.16 em tracking, `#888888`) + `Day 1 · Fri, May 29` (Barlow SemiBold 13 px, amber `#FDBA74`) + dropdown chevron (amber, 10 × 10) + right-aligned hint `tap any result to add` (Barlow Regular 11 px, muted `#6B6B6B`). 1 px bottom border `#FFFFFF12`.
  - **Result rows** — four rows, each 14 px vertical / 18 px horizontal padding, 14 px gap. Layout: 40 × 40 category badge (round, category-colored 1.5 px outline + 8 % fill) → text column (small uppercase category label in category color + Barlow SemiBold 16 px title + Barlow Regular 13 px description) → trailing detour chip (Space Grotesk SemiBold 13 px amber `#FDBA74` `+X.X MI` over Space Grotesk Regular 11 px muted `+X MIN`).
  - Sample rows: `URBAN · Banff Townsite (+3.2 MI / +14 MIN)`, `FOOD · Lake Agnes Tea House (+5.4 MI / +28 MIN)`, `OVERNIGHT · Tumalo State Park (+8.1 MI / +22 MIN)`, `SCENIC · Columbia Icefield (+12.0 MI / +44 MIN)`.
- **Right-Edge Toolbar** — same position as Default (`left: 1065, top: 214`). The Search button is in active state: background `#FDBA7426`, outline `#FDBA7466`, icon stroke `#FDBA74` (full amber).

### What's hidden compared to other states

- Day Column and Day Detail content (visually obscured under the search overlay; still in the layer tree).
- Trip title and metadata in the Top Bar (replaced by expanded search input).
- Trip Action FAB (hidden — design rule: FAB only in Default).

### Visible state indicators

- Search icon in toolbar in active amber state.
- Inline `ADDING TO` header confirms which day the active-day binding goes to.
- The amber dropdown chevron next to the day name telegraphs the day-switcher.

---

## 5. Collapsed state (`3KF-0`)

Fullscreen map mode. All body overlays hidden; only map, Close ✕, Right-Edge Toolbar, and the bottom-docked Top Bar remain.

### Visible elements

| # | Element | Notes |
|---|---|---|
| 1 | Map background (single `Coastal map` rectangle, 1141 × 1704) | |
| 2 | Top Bar | Docked at `left: 10, top: 667` (bottom of canvas) |
| 3 | Close Button | Top-right, unchanged from Default |
| 4 | Right-Edge Toolbar | Fullscreen icon in active state |

Day Column, Day Detail, Location Detail, Trip Action FAB, Day Pill — all absent.

### Positions & sizes

- **Top Bar** — same internal layout as Default but at `left: 10, top: 667` (bottom-anchored). Content identical to Default (title + metadata + search input + arrow + kebab). The arrow icon glyph is rotated 90 deg (up — "expand") instead of the 270 deg (down — "collapse") used in Default and Search Active.
- **Close Button** — `60 × 60` at `left: 1063, top: 12`. Does **not** move with the Top Bar; remains anchored to the top-right corner.
- **Right-Edge Toolbar** — same position as Default (`left: 1065, top: 214`). The Fullscreen button is in active state (`#FDBA7426` bg, `#FDBA7466` outline, full-amber icon stroke); all other buttons neutral.

### State indicators

- Toolbar **Fullscreen icon = amber active** — only colored button in the toolbar.
- Top Bar arrow rotated up-90 deg (expand cue) vs. down-270 deg in Default/Search Active.

### Notes

- Tapping the Fullscreen icon again is the documented return-to-prior-state affordance (Decision 5). The mock doesn't show transitional state.
- Top Bar `border-top-radius: 15 px` is inherited from Default — at the bottom of the canvas, this means the rounded corners are on top of the bar. Whether the radii should swap to bottom corners in this state is unspecified (flagged in §11).

---

## 6. Directions Active state (`4JK-0`) — NEW

The Directions Panel takes over the same rectangular footprint as the Search Active dropdown. Day Column and Day Detail remain in the layer tree but are visually obscured. The Right-Edge Toolbar stays visible to the right; the Directions button is in active state. Trip Action FAB hidden.

### Visible elements (back → front)

| # | Element | Notes |
|---|---|---|
| 1 | Map background (3 × `Coastal map`) | |
| 2 | Day Column Planner *(obscured)* | |
| 3 | Day Detail *(obscured)* | |
| 4 | Location Detail *(in tree, hidden)* | |
| 5 | Top Bar | Default layout (title + metadata + search input + arrow + kebab) |
| 6 | Close Button | |
| 7 | Right-Edge Toolbar | Directions icon in active state |
| 8 | Directions Panel | `left: 10, top: 72, 658 × 662`, opaque `#1A1F28`, bottom corners 15 px |

### Directions Panel content

- **Header row** (`16 px / 20 px / 14 px / 20 px` padding, 1 px bottom border `#FFFFFF12`):
  - Left: small caps `DIRECTIONS · DAY 01` (Space Grotesk Medium 10 px `#888888` 0.16 em) over `Yakima — Hood River` (Barlow SemiBold 16 px `#E9E9E7`).
  - Right: small caps `84 MI · 2.3 HRS` (Space Grotesk SemiBold 14 px amber `#FDBA74` 0.04 em) over `arrives 4:42 PM` (Space Grotesk Regular 11 px muted).
  - Trailing: 36 × 36 close-panel button (✕), `#1D1E1F8F`.
- **Active Maneuver card** (`20 px / 24 px` padding, 1 px bottom border):
  - Left: 64 × 64 amber-tinted maneuver icon (`#FDBA7426` bg, `#FDBA7466` outline, 36 × 36 turn-right glyph in amber).
  - Middle: `IN 0.3 MI` small caps amber + `Turn right onto US-101 N` (Barlow SemiBold 22 px `#E9E9E7`, -0.01 em tracking).
  - Right: countdown `0:18` (Space Grotesk SemiBold 18 px `#E9E9E7`) over `to turn` (Space Grotesk Regular 11 px muted).
- **`UP NEXT` section label** (`16 px / 24 px / 8 px / 24 px` padding).
- **4 upcoming maneuver rows**, each `12 px / 24 px` padding, 1 px bottom border `#FFFFFF0A`:
  - 40 × 40 small maneuver icon (neutral `#1D1E1F8F` chrome) → text column (`IN X.X mi` small caps + instruction Barlow Regular 14 px) → trailing distance/time chip Space Grotesk SemiBold 13 px muted.
  - Last row (arrival) uses amber-tinted icon + amber labels: `IN 84 MI · DAY 1 END` / `Arrive at Hood River, OR` / `4:42 PM`.

### State indicators

- Toolbar **Directions icon = amber active** (matches the active treatment used on Search-in-Search-Active and Fullscreen-in-Collapsed).
- Amber accents in the Active Maneuver card pull the eye to the immediate-next turn.

### What's hidden compared to other states

- Day Column / Day Detail visually obscured (in tree).
- Trip Action FAB hidden.

---

## 7. Offline Panel Open state (`4SO-0`) — NEW

OfflinePanel slides in from the right edge as a 440 px drawer. Day Column dimmed (opacity 0.5); Day Detail stays at default opacity (the drawer doesn't overlap it). Right-Edge Toolbar z-stacks **above** the drawer with its translucent chrome partially revealing the drawer content behind. Trip Action FAB hidden.

### Visible elements (back → front)

| # | Element | Notes |
|---|---|---|
| 1 | Map background | |
| 2 | Day Column Planner | Opacity 0.5 (dimmed) |
| 3 | Day Detail | Default opacity |
| 4 | Location Detail *(in tree, hidden)* | |
| 5 | Top Bar | Default layout |
| 6 | Close Button | Top-right, z above drawer |
| 7 | Offline Panel Drawer | `left: 693, top: 0, 440 × 744`, opaque `#161819`, 14 px top-right + bottom-right radius |
| 8 | Right-Edge Toolbar | z above drawer (`left: 1065`, inside drawer footprint) |

### Drawer content

- **Drawer Header** (24 px top / 24 px sides / 18 px bottom, 1 px bottom border):
  - `OFFLINE MAPS` small caps label
  - `Los Angeles to Portland` (Barlow SemiBold 18 px `#E9E9E7`)
  - `2 phases · 6 days · 2,518 mi` (Barlow Regular 13 px muted)
  - 36 × 36 close-drawer button (✕)
- **`PHASES` section header** with right-aligned `+ ADD PHASE` action (Space Grotesk Medium 10 px amber).
- **Phase 01 · Primed** row (16 / 24 padding, 1 px borders top + bottom):
  - Header row: `PHASE 01` small caps `#B3B3B3` + status pill `● Primed` (cyan/teal `#6CAEAA` accent, 14 % fill + 40 % outline, 6 px dot) + kebab.
  - Title: `Days 1–3 · Yakima → Mt Hood` (Barlow SemiBold 15 px).
  - Stats row: `1,247 TILES · 142 MB` (Space Grotesk Medium 12 px muted) + right-aligned `primed 2 days ago`.
- **Phase 02 · Priming** row (16 / 24 padding, 1 px bottom border):
  - Header row: `PHASE 02` + status pill `● Priming · 47%` (amber `#FDBA74` accent) + kebab.
  - Title: `Days 4–6 · Mt Hood → Portland`.
  - Progress bar: full-width 4 px tall, `#FFFFFF12` track + 47 % amber fill.
  - Stats row: `580 / 1,240 TILES · 64 / 138 MB` + right-aligned `~2 min left`.
- **Storage Footer** (20 / 24 padding, 1 px bottom border):
  - `STORAGE` label + right-aligned `206 / 4,096 MB` (Space Grotesk SemiBold 13 px).
  - Sub-line: `Persistent storage granted · this trip uses 5% of your budget.`

### State indicators

- **Day Column dimmed** at opacity 0.5 (still visible, less prominent).
- **Toolbar visible alongside drawer** — z-stacked above. Toolbar icons remain tappable. The translucent toolbar chrome (`#1D1E1F8F`) lets some drawer content show through behind it.
- **Phase status pills** use cyan for primed (matches the `OVERNIGHT` category color from the result-row palette), amber for priming. No toolbar icon is in active state — Offline isn't a toolbar action.

### What's hidden

- Trip Action FAB.
- Day Pill (Day Column is technically visible, even if dimmed).

---

## 8. Nav Active state (`51S-0`) — NEW

Turn-by-turn navigation in progress. Day Column and Day Detail auto-collapsed and removed from the tree. Nav Directions Panel docks full-width at the bottom (1133 × 223). The toolbar reduces to 3 icons with Nav rendered as a red Stop button. Day Pill shows the day being driven.

### Visible elements (back → front)

| # | Element | Notes |
|---|---|---|
| 1 | Map background (3 × `Coastal map`) | Map gets ~70 % of viewport |
| 2 | Top Bar | Default layout (per the slideup-chrome-consistency rule) |
| 3 | Close Button | |
| 4 | Right-Edge Toolbar · Nav variant | 3 icons: Stop / Locate / Fullscreen |
| 5 | Day Pill · Driving | Top-center, `Driving Day 1 · Fri, May 29` |
| 6 | Nav Directions Panel | `left: 0, top: 521, 1133 × 223`, opaque `#161819`, 14 px top corners |

Day Column, Day Detail, Location Detail, Trip Action FAB — all absent (not in the layer tree).

### Positions & sizes

- **Right-Edge Toolbar · Nav variant** — `60 × 188` at `left: 1065, top: 278` (vertically centered against the same midpoint as the 5-icon toolbar). Three buttons stacked, 4 px gap:
  1. **Stop button** — `60 × 60`, background `#DC2626` (red), 8 px radius, white `#FFFFFF26` outline, faint red glow `box-shadow: 0 0 0 3px #DC262626`. Icon: filled white rounded square (stop glyph).
  2. **Locate** — same as default (`#1D1E1F8F`, target/crosshair icon).
  3. **Fullscreen** — same as default.
- **Day Pill · Driving** — at `left: 478, top: 90` (top-center area below Top Bar). Auto-sized, height 40. Same chrome as the search-variant pill (dark `#161819E6`, 3 px amber left border, 6 px radius) but with amber prefix word `Driving` instead of `Add to`. Format: `Driving Day 1 · Fri, May 29`. Calendar glyph leads; no chevron (no day-switching mid-drive). 
- **Nav Directions Panel** — full-width at the bottom. Background opaque `#161819`, 14 px top corners, 1 px outline `#FFFFFF14`.
  - **Active Maneuver row** (28 / 36 / 20 / 36 padding):
    - Left: 88 × 88 amber-tinted maneuver icon, 18 px radius, 52 × 52 turn-right glyph in `#FDBA74`.
    - Center-left: small caps `IN 0.3 MI · 0:18 TO TURN` (Space Grotesk Medium 11 px amber) over `Turn right onto US-101 N` (Barlow SemiBold **32 px** `#E9E9E7`, line-height 36, -0.01 em tracking) over `Then continue 12 mi to exit 247` (Barlow Regular 13 px muted).
    - Right: vertical divider, then `4:42 PM` (Space Grotesk Bold 28 px) over small caps `ARRIVAL · HOOD RIVER`, then a stats row with two metrics: `84 MI · REMAINING` (amber) and `2.3 HRS · DRIVE` (white) separated by a 1 px divider.

### State indicators

- **Stop button is the only red surface in the entire system** — vivid red `#DC2626` with a faint glow. Clearly reads as "kill switch" rather than a regular toolbar button.
- **Day Pill `Driving` prefix** in amber — analogous to the `Add to` prefix in Search Active, signaling the active-day context.
- **Massive turn instruction text** (32 px, the largest text in any state) — designed to be readable at a glance during driving.
- **Right-side stats use amber for the dwindling-resource value** (`84 MI · REMAINING`) — consistent with the route-deviation-chip convention from Suggestion Card v2.

### What's hidden

- Day Column Planner, Day Detail, Location Detail, Trip Action FAB.
- The full 5-icon toolbar (replaced by 3-icon Nav variant).

---

## 9. Transitions / state changes

Triggers and visible behaviors. Where the frame is silent on the animation, "not specified" is the truthful answer.

| From → To | Trigger | Trigger location | Visible behavior |
|---|---|---|---|
| Default → Collapsed | Tap Top Bar down-arrow OR tap toolbar Fullscreen | Top Bar arrow at relative `left: 589` inside Top Bar; OR right-edge toolbar Fullscreen button (4th from top) | Not specified. End state: Day Column + Day Detail + FAB hidden; Top Bar moves from `top: 12` to `top: 667`; arrow flips 270 → 90 deg; toolbar Fullscreen icon becomes amber-active. |
| Collapsed → Default | Tap Top Bar up-arrow OR tap toolbar Fullscreen-active | Top Bar arrow at `top: 667`; OR Fullscreen toolbar button | Not specified. Inverse of above. |
| Default → Search Active | Tap toolbar Search OR tap Top Bar search input | Toolbar Search button (5th from top) OR search-input region in Top Bar | Not specified. End state: Top Bar internal layout swaps (expanded input), search dropdown appears overlaying the Day Column + Day Detail footprint, toolbar Search icon becomes amber-active. Trip Action FAB disappears. |
| Search Active → Default | Tap toolbar Search-active (toggle off) OR tap outside dropdown | Toolbar Search-active button | Not specified. The mock doesn't show an explicit "cancel search" button inside the Top Bar. |
| Default → Directions Active | Tap toolbar Directions | Toolbar Directions button (2nd from top) | Not specified. End state: Directions Panel takes over the Day Column + Day Detail footprint (same rectangle as the search dropdown), toolbar Directions icon becomes amber-active. Trip Action FAB disappears. |
| Directions Active → Default | Tap toolbar Directions-active OR tap close-panel ✕ in panel header | Toolbar Directions-active button OR 36 × 36 ✕ at panel header top-right | Not specified. |
| Default → Offline Panel Open | Tap kebab → "Offline maps" entry | Top Bar kebab (60 × 60 at right end of Top Bar) | Not specified. End state: Drawer slides in from the right (440 wide), Day Column dims to opacity 0.5, toolbar stays on top of drawer. |
| Offline Panel Open → Default | Tap close-drawer ✕ OR tap outside drawer | 36 × 36 ✕ in drawer header | Not specified. |
| Default → Nav Active | Tap toolbar Nav | Toolbar Nav button (1st from top) | Not specified. End state: Day Column / Day Detail / Location Detail removed from tree, FAB hidden, toolbar reduces to 3 icons (Nav becomes red Stop), Nav Directions Panel docks at bottom, Day Pill appears top-center. |
| Nav Active → Default | Tap red Stop button | Toolbar Stop (1st icon, red) | Not specified. End state: full layout restored. |
| Any → close slideup | Tap Close ✕ at top-right | `left: 1063, top: 12` | `SlideupShell` calls `router.back()`. |

The frames do not draw in-progress transitions; direction, easing, and duration are not specified in Paper.

---

## 10. Comparison table

Coordinates in frame-local pixels. "—" = not in the layer tree for that state. "Obscured" = in tree but rendered hidden by another layer. "Dimmed" = opacity reduced.

| Element | Default | Search Active | Collapsed | Directions Active | Offline Panel Open | Nav Active |
|---|---|---|---|---|---|---|
| **Map background** | 3 tiles | 3 tiles | 1 tile | 3 tiles | 3 tiles | 3 tiles |
| **Top Bar** | Top, 660 × 60 | Top, expanded search | Bottom (`top: 667`) | Top, default | Top, default | Top, default |
| **Close Button** | `1063, 12` | same | same | same | same, z above drawer | same |
| **Day Column** | Visible | Obscured | — | Obscured | Dimmed (opacity 0.5) | — |
| **Day Detail** | Visible | Obscured | — | Obscured | Visible | — |
| **Location Detail** | In tree (hidden) | In tree (hidden) | — | In tree (hidden) | In tree (hidden) | — |
| **Right-Edge Toolbar** | 5 icons, all neutral | 5 icons, Search active | 5 icons, Fullscreen active | 5 icons, Directions active | 5 icons, all neutral, z above drawer | **3 icons:** Stop / Locate / Fullscreen |
| **Trip Action FAB** | Visible (blue) | — | — | — | — | — |
| **Day Pill** | — | — (replaced by inline header in dropdown) | — | — | — | Visible, top-center, `Driving` prefix |
| **Search Results overlay** | — | `10, 72, 658×~360` | — | — | — | — |
| **Directions Panel (takeover)** | — | — | — | `10, 72, 658×662` | — | — |
| **Offline Panel Drawer** | — | — | — | — | `693, 0, 440×744` | — |
| **Nav Directions Panel (dock)** | — | — | — | — | — | `0, 521, 1133×223` |

---

## 11. Unanswered design questions

Things the frames don't resolve.

1. **Top Bar in Collapsed has top-corner radii instead of bottom.** Inherited from Default. Visually reads as a bottom-anchored bar with curved top corners. Whether the radii should swap to bottom corners when the Top Bar docks at the bottom is unspecified.
2. **Search dismiss affordance.** No explicit "cancel search" or ✕ inside the expanded search input. Returning from Search Active to Default presumably happens by toggling the Search toolbar button (which is in active state) or tapping outside the dropdown. Not drawn.
3. **Directions Panel close affordance.** A 36 × 36 ✕ in the panel header is drawn. Whether tapping the active Directions toolbar button also closes the panel (toggle) is unspecified but implied.
4. **Day Pill in Nav Active is non-dismissible.** No chevron on the driving variant (vs. the search variant which has one). Whether switching driving day mid-trip is even allowed is unspecified. Probably correct to forbid it — but worth confirming.
5. **Toolbar Nav button in Default state.** Default shows the Nav button neutral. Whether tapping it goes straight to Nav Active or first opens a confirm dialog ("Start navigation for Day 1?") is unspecified.
6. **OfflinePanel `+ ADD PHASE` action.** Text-only; no button chrome. Tap target is ambiguous (the whole header row? Just the text?). Could read as a tappable action or a static label.
7. **Phase row kebab menu contents.** Each phase row has a 3-dot kebab. Menu actions not drawn.
8. **Drawer behavior on FAB tap.** FAB is hidden in Offline Panel Open. Whether tapping the kebab on a waypoint card in Day Detail (which is still visible) opens a new floating panel above the drawer, or is suppressed, is unspecified.
9. **Day Column dim treatment in Offline Panel Open.** Reduced to opacity 0.5 — this also dims the day cards' content (text, miles, hours all fade together). Alternative: tint with a dark scrim that uniformly darkens but keeps text legible. The current choice may make active-day highlights too faint.
10. **Toolbar z behavior in Offline Panel Open.** Toolbar is z-above drawer. The translucent toolbar chrome (`#1D1E1F8F`) lets some drawer content show through. Whether this is intentional ("you can see what's behind the toolbar") or should be opaque-blocked ("toolbar is on top, hide the drawer behind it") is a small but visible design call.
11. **Trip Action FAB color is blue.** Resolved during this build (originally amber per brief; switched to blue to match Suggestion Card v2's "Add to Day N" CTAs). Worth confirming with whoever owns the design system that this matches the canonical `--button-primary` token.
12. **Nav Active stop confirmation.** Tapping the red Stop button presumably ends navigation. Whether it shows a confirm ("End navigation?") or stops immediately is unspecified.
13. **Top Bar in Nav Active is full chrome.** Title + metadata + search + arrow + kebab all visible. During active driving, the search input and metadata may be visual noise. The brief's "slideup chrome (back X, kebab) consistent across all states" rule keeps it visible, but a stripped-down Top Bar variant for nav (title only + kebab) could be considered.
14. **Mobile responsiveness.** All six frames are 1133 × 744 — desktop only. No mobile-width variants are drawn.
15. **Frame canvas size.** Carried over from v1: all frames are 1133 × 744, larger than the 1112 × 721 documented in `slideup-overlay-layout.md`. Whether the slideup body has actually been resized or whether the new frames are intended to be cropped to 1112 × 721 on render is unspecified.

---

## 12. What's implied but not shown

State surfaces or behaviors the layout creates as new decisions but which none of the six drawn states address.

- **Empty trip state.** All frames render `Los Angeles to Portland` with 6 days, ~2,500 mi, full waypoints. Zero-day, zero-waypoint, no-`routePolyline`, no-`startCoords` cases are not drawn.
- **Reference-trip vs. user-trip differences.** No `MakeItMineCta` is drawn in any state.
- **Hover / focus / pressed / loading states** for any control. All chrome is in resting state.
- **Search empty state.** Results dropdown shows 4 populated rows. The placeholder state (no query typed) or zero-results state is not drawn.
- **Day Pill day-switcher expansion.** The chevron telegraphs a dropdown, but the dropdown itself isn't drawn. (Note: the Driving variant in Nav Active has no chevron.)
- **Nav Active off-route state.** Active maneuver is drawn as if on-route. Off-route / rerouting visual is unspecified.
- **Off-cache banner (`OffCacheBanner`, per PR #47).** Not drawn in any of the six states. Whether it persists in Nav Active or only appears in Default/Directions Active is unspecified.
- **Browse / category panel** (the `1RI0-0 Slideup · Browse 2-up` frame) is not redrawn against any of the new states.

---

## Appendix A — Component reference

Three reusable components defined on `Slideup · Components (scratch)` (`3S7-0`), positioned outside the state frames for reference. These components are duplicated into the state frames in their context-specific positions.

### Right-Edge Toolbar

5 buttons, 60 × 60 each, 4 px gap, total 60 × 316. Each button:
- Background `#1D1E1F8F` (~56 % alpha) — same as Close ✕
- 8 px border-radius (symmetric — Close ✕'s asymmetric `8/12/8/8` is reserved for the overhang)
- 1 px `#FFFFFF2E` outline
- Icon: 22 × 22, stroke `#E9E9E7`, stroke-width 1.75

Active state (used by Search-in-SearchActive, Fullscreen-in-Collapsed, Directions-in-DirectionsActive):
- Background `#FDBA7426` (amber at 15 %)
- Outline `#FDBA7466` (amber at 40 %)
- Icon stroke `#FDBA74` (full amber)

Nav-only Stop variant (Nav Active):
- Background `#DC2626` (red)
- Outline `#FFFFFF26` (white at 15 %)
- Glow: `box-shadow: 0 0 0 3px #DC262626`
- Icon: filled white rounded square

### Day Pill

Auto-sized chip, 40 tall. Chrome:
- Background `#161819E6` (`--bg-card` at 90 %)
- 6 px border-radius
- 3 px solid `#FDBA74` left border (active-day-context accent)
- Padding `0 14 0 13` (left padding accounts for the 3 px border)
- 10 px gap between elements

Three text variants used across states:
- **Default (in tree but not currently used):** `Day 1 · Fri, May 29` — calendar glyph (amber) + Barlow Regular 14 px white + dropdown chevron (`#888888`).
- **Search Active inline header** (replaces the floating pill in Search Active): `ADDING TO Day 1 · Fri, May 29 ▼` — small caps `ADDING TO` (Space Grotesk Medium 10 px muted) + amber day name + amber chevron + right-aligned hint.
- **Driving (Nav Active):** `Driving Day 1 · Fri, May 29` — amber prefix `Driving` + white day name. No chevron (no mid-drive day-switching).

### Trip Action FAB

Extended-FAB pill, auto-sized ~161 × 56:
- Background `#1F5E8E` (blue — matches `Add to Day N` CTAs from Suggestion Card v2)
- 28 px radius (full pill)
- Padding `0 22 0 18`, 10 px gap
- Drop shadow: `0 6px 16px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.25)`
- Icon: 20 × 20 `map-pin-plus`, white stroke 2.25
- Label: `Add stop here` (Barlow SemiBold 14 px white, 0.02 em tracking)

---

## Appendix B — Layer naming inventory

Top-level layer names across all six frames (post-rename pass). All states use the same vocabulary where the layer exists, per the consistency pass earlier in this session.

| Layer | Default | Search Active | Collapsed | Directions Active | Offline Panel Open | Nav Active |
|---|---|---|---|---|---|---|
| `Coastal map` × 3 | ✓ | ✓ | (×1) | ✓ | ✓ | ✓ |
| `Day Column Planner` | ✓ | ✓ | — | ✓ | ✓ (dimmed) | — |
| `Day Detail` | ✓ | ✓ | — | ✓ | ✓ | — |
| `Location Detail · Food (Trapper's)` *(hidden)* | ✓ | ✓ | — | ✓ | ✓ | — |
| `Top Bar` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Close Button` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Right-Edge Toolbar` | ✓ (5 btn) | ✓ (5 btn) | ✓ (5 btn) | ✓ (5 btn) | ✓ (5 btn, z above drawer) | ✓ (`Right-Edge Toolbar · Nav (3 icons)`) |
| `Trip Action FAB` | ✓ | — | — | — | — | — |
| `Search Results` | — | ✓ | — | — | — | — |
| `Directions Panel` | — | — | — | ✓ | — | — |
| `Offline Panel Drawer` | — | — | — | — | ✓ | — |
| `Day Pill · Driving` | — | — | — | — | — | ✓ |
| `Nav Directions Panel` | — | — | — | — | — | ✓ |
