# Location Detail — Food category (Trapper's)

Spec for the **Location Detail** panel that opens inside the trip slideup when a result (chip / map pin / browse card) is tapped. This document covers the **Food** category variant, illustrated with the "Trapper's Diner & Coffee" instance.

**Source of truth:** Paper artboard `6JF-0` "Location Detail · Food (Trapper's)" (448w × ~1430h scrollable).

> **Project rules** (per `web/AGENTS.md`):
> - Build and verify in the `@modal/(.)trip/[id]` slideup overlay, **not** on the legacy `/trip/[id]` full-page route. Verify by opening `/trips` → click a trip card → click a result inside the slideup.
> - Design tokens live in `web/src/app/globals.css`. Reference via `var(--token-name)`. Don't hard-code values that exist as tokens.
> - No new npm packages without approval. Lucide is already a dep (`lucide-react`).

---

## 1. Surface + entry

- **Component**: new `LocationDetailPanel` in `web/src/components/trip/location-detail-panel.tsx`.
- **Mount point**: replaces or extends `MapDetailOverlay` (`web/src/components/trip/map-detail-overlay.tsx`), which already listens for `trip:openDetail` and opens a slide-in.
- **Trigger event**: `trip:openDetail` CustomEvent with `{ place: { id, title, photoUrl, dayNumber, dayId, coords, description, waypoint } }` — already dispatched by `category-browse-panel.tsx` and `map-column.tsx` pin handlers.
- **Dismiss**: ✕ button (top-right of panel), Escape key, backdrop click, route change.
- **Width**: `448px`. Slides in from the right edge of the slideup body, anchored under the Top Bar (`top: 72px`).
- **Background**: `#1A1A1A` with `1px solid #383636` outline, `border-radius: 10px`.
- **Scroll**: internal scroll inside the panel — the panel itself fills the slideup vertically (~672px) and the body scrolls.

---

## 2. Layout — top to bottom

| # | Block | Notes |
|---|---|---|
| 1 | **Hero Photo** | 458w × 200h. Photo + bottom-fade gradient. Bleeds full panel width. |
| 2 | **Header Block** | Title + description + tab row + Route row. 400w inner. |
| 3 | **Simulator Card** | "If you stop here" — stop sim with schedule bars + primary CTA. 410w. |
| 4 | **Divider** | 1px hairline, 400w. |
| 5 | **Description Section** | Historic Context callout (when category supplies one). |
| 6 | **Divider** | |
| 7 | **Logistics Section** | Hours, Fee, Phone, Website — 2×2 grid. |
| 8 | **Divider** | |
| 9 | **Community Section** | Rating bar + count, tips list, last-verified caption. |
| 10 | **Divider** | |
| 11 | **Amenities Section** | Inline pill tags. |
| 12 | **Divider** | |
| 13 | **Data Sources Section** | Inline pill tags (provenance). |

Padding around body content: `padding: 0 24px` (yields 400w inner). Simulator card sits at `padding: 0 19px` (yields 410w — wider than the body by 10).

---

## 3. Section specs

### 3.1 Hero Photo

- `458 × 200` image, top corners follow the panel's `10px` radius.
- Bottom 19px gradient overlay (`linear-gradient(to top, #1A1A1A, transparent)`) so the title doesn't sit on a busy photo edge.
- Image source: `place.photoUrl`. If missing, fall back to a category-tinted placeholder (food → orange wash).

### 3.2 Header Block

| Element | Style |
|---|---|
| **Title** | `Trapper's Diner & Coffee` — `Barlow Condensed Bold 26/26`, letter-spacing `0.01em`, color `#FDBA74` (= `--cat-food`). Category-tinted. Use the matching `--cat-*` token for other categories. |
| **Description** | `Barlow Regular 13/21`, color `#A89C90` (warm muted). 3-line max in this frame; allow wrap. |
| **Tab row** | `ABOUT · REVIEWS · PHOTOS` — Space Grotesk SemiBold ~11px caps, letter-spaced `0.18em`, muted color. Active tab gets amber underline (`#C8A96E`, 2px). |
| **Route row** | Eyebrow `ROUTE` (Space Mono uppercase, muted) over `Day 14 · 0.4 mi on route` (Barlow Regular 13). The day number + on-route distance come from `place.dayNumber` + waypoint detour computation already in `lib/trip-browse/card-stats.ts`. |

### 3.3 Simulator Card

The hero block of the panel. Frames the user's decision: "if I stop here, what happens?"

- **Card surface**: `410w × 301h`, `border-radius: 4`, padding `22`, `gap: 8`, bg `#59615D36` (translucent olive-green — reads as a recommended/positive surface).
- **Eyebrow** `IF YOU STOP HERE` — Space Mono uppercase, letter-spaced, muted (`#B7B4B2`).
- **Cost cells** (single line): `Stop time: 25min  |  Hours 6am–9pm` — Space Mono 12/16, muted divider `|`. Stop time comes from a category default (food = 25min, fuel = 8min, etc.); hours from data source.
- **Hero metric**: `Adds 25m` — Space Grotesk SemiBold `24/30`, letter-spacing `0.02em`, `#FFFFFF`. This is the same number as Stop time, restated as a delta to ETA. Visual anchor of the card.
- **ETA caption**: `new ETA at Klamath Falls` — Space Mono Regular 12, muted. "Klamath Falls" is the day's end-of-route label (`day.label`'s second half).
- **Schedule bars** — 3 rows:
  - **Planned** — gray bar, `8:18pm` right-aligned.
  - **With stop** — amber bar (`#C8A96E`), `8:43pm` right-aligned.
  - **Sunset** — no bar, just `9:02pm` right-aligned. Acts as the constraint marker.
- **Day-15 chip** — small sage-green dot (`#98AC64`, 6×6, fully round) + `Day 15 unaffected` label. Reassurance that the stop doesn't cascade into the next day. If it WOULD push Day 15, copy flips to amber/red with explicit minutes.
- **Primary CTA** — `Add to Day 14`. `233 × 40`, `border-radius: 4`, bg `#3A2A1E` (= `--cat-food-bg`), border `#996422` (warm orange). Text Space Grotesk SemiBold 14, letter-spacing `0.08em`, uppercase, `#ECEAE4`. **The CTA tints to the category color** (food = orange-brown, fuel = coral, camping = green, etc.).

### 3.4 Description Section

Currently shows only a **Historic Context** callout when the place has one (Trapper's has it because the building is on a historic registry). Other places skip this section.

- **Callout container**: bg `#232323`, border `1px solid #5A5A5A`, `border-radius: 4`, padding `10 / 12`, gap `5`.
- **Label**: `HISTORIC CONTEXT` — Space Mono Regular 12/14, letter-spacing `0.14em`, uppercase, color `#B7B4B2`.
- **Body**: 3-line description — Barlow Regular 13, muted warm.

Other category-specific callouts that may appear in this slot (handled the same way structurally):
- Scenic → `WHY IT'S WORTH STOPPING`
- Camping → `SITE CONDITIONS`
- Fuel → `STATION NOTES`

### 3.5 Logistics Section

Header `LOGISTICS` (Space Mono uppercase, muted). Below it, a 2×2 grid of label/value pairs:

| Hours | Fee |
|---|---|
| `Mon–Sun · 6:00 AM – 9:00 PM` | `$$ · avg $14/person` |
| **Phone** | **Website** |
| `(541) 882-7227` | `trappersdiner.com` |

Each cell: label Space Mono uppercase muted; value Barlow Regular 13. Cell width 195, row gap ~12, column gap ~10. Phone is `tel:` link, website is `https://` link — both opened in a new tab on click.

### 3.6 Community Section

Header `COMMUNITY`. Rows:

- **Rating bar** — 64w × 4h amber-fill (`#C8A96E`), proportional to 4.5/5. Followed by `4.5` (Barlow Regular 13, slightly emphasized) and `(320)` review count (Space Mono, muted).
- **Tips list** — 2 items (max 3). Each item: small triangular bullet (`▸`, muted) + tip text Barlow Regular 13.
- **Last verified** — `Last verified: Apr 2026` — Space Mono Regular 12, muted, italic-feel.

### 3.7 Amenities Section

Header `AMENITIES`. Below: inline row of small pill tags.

- **Tag style**: bg `#141A14` (deep green-tinted black), border `1px solid #2A2A2A`, `border-radius: 2`, padding `2 / 8`.
- **Tag text**: Space Mono Regular 12/16, color `#6A8A6A` (muted sage — semantic "amenity").
- **Tag content** (Trapper's): `Indoor`, `Patio`, `Wi-Fi`, `Parking`. Comes from `place.amenities[]` (currently freeform strings in the fixture).

### 3.8 Data Sources Section

Header `DATA SOURCES`. Below: inline row of provenance tags.

- **Tag style**: bg `#141414`, border `1px solid #222222`, `border-radius: 2`, padding `1 / 5` (slightly tighter than amenities).
- **Tag text**: Space Mono Regular 12/16, letter-spacing `0.06em`, color `#888888`.
- **Tag content** (Trapper's): `Yelp`, `Google`, `OSM`. Comes from `place.sources[]` — should match the upstream `discovery` modules that contributed to this record (Foursquare, RIDB, BLM, USFS, Overpass, Mapillary, Wikipedia, Google Places).

---

## 4. Design tokens — what to reuse

From `web/src/app/globals.css`:

- **Title color (category-tinted)**: `--cat-food` (`#FDBA74`). Swap for `--cat-mountain` / `--cat-camping` / `--cat-oddity` / `--cat-attraction` for other categories.
- **CTA bg + border (category-tinted)**: `--cat-food-bg` (`#3A2A1E`) + warm border. Same pattern per category.
- **Body text muted**: `--text-muted`.
- **Body text primary**: `--text-primary`.
- **Amber accent (rating bar, active tab underline)**: `--amber` (`#C8A96E`).
- **Fonts**: `--ff-sans` (Barlow), `--ff-display` (Space Grotesk), `--ff-mono` (Space Mono). Note: title specifically calls for **Barlow Condensed Bold** — `--ff-sans` is regular Barlow, so the title may need a dedicated `--ff-condensed` token added to `globals.css`. **Flag this; don't invent silently.**

Inline values (no current token):
- Panel bg `#1A1A1A` (matches `--bg-panel` if `--bg-panel: #1A1A1A` — verify; otherwise use literal)
- Panel outline `#383636`
- Simulator card bg `#59615D36` (translucent olive)
- Day-chip dot color `#98AC64` (sage = "unaffected"). Semantic — consider adding `--state-unaffected` if reused.
- Historic-context callout bg `#232323` + border `#5A5A5A`
- Amenity tag colors (bg `#141A14`, text `#6A8A6A`) — semantic green for "has amenity"
- Data-source tag colors (bg `#141414`, text `#888888`) — neutral provenance

---

## 5. Behavior

| Interaction | Result |
|---|---|
| Tap any chip / map pin / browse card | Dispatches `trip:openDetail` → panel slides in from right |
| ✕ button / Escape / backdrop click | Panel slides out; map and slideup body unchanged |
| Tap **Add to Day N** | Dispatches `trip:toggleAdded` with `{ placeId, dayId, dayNumber, place }`. Existing handler in `trip-slideup-body` (or whichever owns `addedIds`). On success, CTA flips to `Added to Day N · Undo` |
| Tap Phone | `tel:` link |
| Tap Website | Open in new tab |
| Tap a tab (`ABOUT` / `REVIEWS` / `PHOTOS`) | Switches body content. Out of scope for v1 — wire as static `ABOUT` only and log clicks on the other two |
| Scroll inside panel | Body scrolls; hero photo sticks to top of panel |

---

## 6. Data wiring

Most fields already exist on the synthesized `Waypoint` shape via `browsePlaceToWaypoint` (`lib/trip-browse/card-stats.ts`). The Location Detail consumes the same shape:

| Field | Source |
|---|---|
| `title`, `description`, `photoUrl`, `coords` | `place.*` (already populated) |
| Day number, on-route distance, ETA delta | Existing `computeCardStats` in `card-stats.ts` |
| `hours`, `fee`, `phone`, `website` | New — extend the Foursquare / Google Places adapter to surface these (already present in upstream responses; just unmapped). Flag if absent for a given record. |
| `rating`, `reviewCount`, `tips` | Foursquare + Yelp adapters. Tips: take the top 2 from the response. |
| `amenities` | Foursquare `categories` + OSM `tags` — normalize a small whitelist (`Indoor`, `Patio`, `Wi-Fi`, `Parking`, `Restrooms`, `Pets`, `EV`). |
| `sources` | The set of discovery modules that contributed to this record. Add a `sources: string[]` field to the merged record at the discovery-aggregation step. |
| `historicContext` | New optional field on `Waypoint`. Initially nullable — only Wikipedia-backed places populate it. |
| `lastVerified` | New field — set at the moment a record is fetched from a live source. Format: `Apr 2026`. |

When a field is missing, **omit the row/section entirely** — never render a placeholder like "Unknown" or "—".

---

## 7. Other category variants

This spec is the **Food** instance. Same structural shape applies to the other categories with these substitutions:

| Aspect | Food | Camping | Fuel | Scenic | Hotel |
|---|---|---|---|---|---|
| Title color | `--cat-food` | `--cat-camping` | `--cat-fuel` (coral) or `--cat-mountain` (blue) — TBD | `--cat-mountain` | `--cat-oddity` (purple) |
| CTA bg/border | `--cat-food-bg` + warm | green pair | coral pair | blue pair | purple pair |
| Stop-time default | 25 min | overnight | 8 min | 15 min | overnight |
| Description callout | `HISTORIC CONTEXT` (if any) | `SITE CONDITIONS` | `STATION NOTES` | `WHY IT'S WORTH STOPPING` | `STAY NOTES` |
| Amenities semantic color | sage `#6A8A6A` | sage | coral | teal | purple |

The fuel-color question (coral `--cat-fuel` vs blue `--cat-mountain`) parallels the same conflict surfaced in the Find Nearby spec — defer to the visual designer.

---

## 8. Out of scope for v1

- Tabs (REVIEWS / PHOTOS bodies) — render the tab row but only ABOUT is wired.
- Editable Add-to-Day with day picker (e.g. "add to Day 12 instead") — v1 always uses the current day context.
- Multi-photo gallery for the hero — single `photoUrl` only.
- Real-time hours / "Open now" badge — show static hours from the data layer.
- Reviews body, photos body — log clicks; build in follow-ups.

---

## 9. Open questions — flag, don't silently decide

1. **Barlow Condensed**: not a current font dep. The title needs it. Either add `Barlow Condensed` as a font import + `--ff-condensed` token, or substitute regular Barlow Bold and lose the condensed register. Default: ask before deciding — the condensed character is part of the brand voice in headers and shouldn't be silently lost.
2. **Panel mount target**: `MapDetailOverlay` currently exists as a stub for opening details. Either extend it to render `LocationDetailPanel` directly, or have `MapDetailOverlay` delegate based on `place.category`. Default: extend, single panel for v1.
3. **Add-to-Day idempotency**: if the place is already added to the day, the CTA copy + behavior is undefined in the frame. Default: show `Added to Day N · Undo` and the click reverses the add. Confirm before shipping.
4. **Sunset row when sunset is before the planned arrival**: the frame shows sunset after planned + with-stop. If the planned arrival is already after sunset, do we still show sunset (as a "you're already driving after dark" warning), or suppress it? Default: keep showing — it's important context.
5. **Section presence rules**: which sections are mandatory vs hide-when-empty? Default: Header + Simulator + CTA always present; everything else hides when its data is empty. Confirm.

---

## 10. Verification

Open `/trips` → click a trip card → click any result inside the slideup (chip, map pin, or browse card). Confirm:

- Panel slides in from right, 448px wide, anchored under Top Bar
- Hero photo + gradient renders correctly with title overlapping the bottom of the photo
- Title is in the category color (orange `#FDBA74` for food)
- Simulator card renders with all 5 sub-elements: eyebrow, cost cells, hero metric, ETA caption, 3 schedule bars, Day-N chip, CTA
- CTA is amber/orange-toned for food; tap → place gets added to the day; CTA flips to "Added"
- Historic Context callout appears for Trapper's (and other Wikipedia-backed places); absent for others
- Logistics 2×2 grid renders with `tel:` and `https:` links live
- Community rating bar fills proportionally to the rating value; tips visible
- Amenities + Data Sources tags render in correct semantic colors
- Tap ✕ / Escape / backdrop → panel slides out cleanly
- `preview_console_logs <serverId> level=error` shows only the benign `Source layer "land"` warning

Commit message: `feat(slideup): Location Detail panel — Food variant (Trapper's spec)`.
