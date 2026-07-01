# Overlander — Design System

**Single source of truth for styling.** Generated from `web/src/app/globals.css` primitives
(the editable value source) and the Paper "design tokens" board (the visual source).
**Reference this file only. Never hardcode colors or type — use `var(--token)`.**

Topology:
`globals.css :root` primitives = editable master → `--color-*` mirror is **generated** from them
→ **this file** is the single generated reference everyone reads → Paper stays the visual surface
(artboards use `var(--token)`, never raw hex).

Theme: **dark only.** All values are authored for the dark UI.

---

## 1. Primitive token block (canonical)

This is the literal `:root` value source. Five ramps + a category palette + alpha overlays +
the interactive/semantic roles + added scales. Ramp steps are numbered **50 (lightest) → 950
(darkest) by measured relative luminance.**

### 1.1 Ramps

**Grounds** — achromatic neutral structure (panels, cards, base).

| Token | Value | Luma | Was |
|---|---|---|---|
| `--grounds-800` | `#262829` | 40 | **NEW** — rail selected-day card divider |
| `--grounds-850` | `#161819` | 24 | `--bg-card` / `--bg-topbar` |
| `--grounds-900` | `#111214` | 18 | `--bg-panel` |
| `--grounds-950` | `#0a0b0c` | 11 | `--bg-base` |

**Steel** — cool blue-grey chrome (form surfaces, nav, borders). **Grey progression only** —
saturated interactive blues are semantic roles in §1.4, not ramp members.

| Token | Value | Luma | Was |
|---|---|---|---|
| `--steel-50`  | `#8AA2C4` | 159 | `--input-border-hover` |
| `--steel-100` | `#7E98BF` | 149 | `--input-border-filled` |
| `--steel-200` | `#556984` | 103 | `--input-disabled-text` |
| `--steel-300` | `#475C78` | 90  | `--input-border` |
| `--steel-400` | `#46586a` | 86  | `--nav-border` |
| `--steel-500` | `#3E516C` | 79  | `--input-border-disabled` |
| `--steel-600` | `#32455F` | 67  | `--input-surface-hover` |
| `--steel-700` | `#2B3B52` | 57  | `--input-surface-filled` |
| `--steel-750` | `#263847` | 52  | **NEW** — rail selected-day card surface |
| `--steel-800` | `#242F42` | 46  | `--input-surface-disabled` |
| `--steel-850` | `#1b2c3e` | 42  | `--bg-nav-btn` / `--bg-tab-idle` |
| `--steel-900` | `#1A1F28` | 31  | `--input-surface` |

**Forest** — greens (map, active day, success).

| Token | Value | Luma | Was |
|---|---|---|---|
| `--forest-300` | `#7ACEA1` | 185 | `--input-success` (→ `--success`) |
| `--forest-900` | `rgb(28,58,32)` | 50 | `--bg-day-active` |
| `--forest-950` | `#1e2a1e` | 39 | `--bg-map` |

**Amber** — warm brand / active identity. *Accent only* (text, data, active state) — never links or pins.

| Token | Value | Luma | Was |
|---|---|---|---|
| `--amber-100` | `#e8c98e` | 203 | `--amber-light` |
| `--amber-300` | `#c8a96e` | 171 | `--amber` |
| `--amber-500` | `#c77429` | 128 | `--amber-dark` (→ `--warning`) |
| `--amber-900` | `#59472e` | 73  | `--bg-tab-active` |

**Type** — ink / foreground.

| Token | Value | Luma | Was |
|---|---|---|---|
| `--type-50`  | `#EDF1F6` | 240 | `--input-value` |
| `--type-100` | `#eceae4` | 234 | `--text-primary` |
| `--type-300` | `#B3B3B3` | 179 | `--input-placeholder` |
| `--type-500` | `#888888` | 136 | `--text-muted` / `--text-dim` |

### 1.2 Category Type (canonical per-role palette)

The category color system — **source of truth: the Paper "Category Type" artboard.**
9 categories × 5 roles: `title` / `badge-bg` / `badge-border` / `cta-bg` / `cta-border`, named
`--cat-{name}-{role}`. This is the **only** category palette: the legacy flat `--cat-{name}` /
`--cat-{name}-bg` 2-role tokens were retired in design-system pass 2c (all consumers read the
role tokens). The taxonomy keys here (`scenic`, `interest`) are now also the data layer's
canonical `Category`/waypoint keys — the `mountain → scenic` / `neutral → interest` rename
shipped in code and the prod DB migration, so there is no pending key migration.

| Category | title | badge-bg | badge-border | cta-bg | cta-border |
|---|---|---|---|---|---|
| `camping` | `#6ECECE` | `#0F2E1F` | `#4D9A6E` | `#304C4B` | `#6ECECE` |
| `urban` | `#E8CF4D` | `#3A2F14` | `#E5BD3D` | `#67562A` | `#E8CF4D` |
| `scenic` | `#A6C9F9` | `#24354F` | `#A6C9F9` | `#24354F` | `#A6C9F9` |
| `food` | `#F38666` | `#773D2C` | `#F38666` | `#773D2C` | `#F38666` |
| `fuel` | `#FA9D9D` | `#2E1414` | `#E26F6F` | `#4E252F` | `#FA9D9D` |
| `hotel` | `#6ECECE` | `#304C4B` | `#6ECECE` | `#304C4B` | `#6ECECE` |
| `oddity` | `#BC97F0` | `#2A1A3E` | `#B589F0` | `#2D2039` | `#BC97EF` |
| `attraction` | `#DEA2DF` | `#412A5D` | `#DEA2DF` | `#412A5D` | `#DEA2DF` |
| `interest` | `#BAB0AF` | `#262A2B` | `#888888` | `#262A2B` | `#888888` |

Mirrored to Tailwind as `--color-cat-{name}-{role}` in the `@theme` block (e.g. `text-cat-camping-title`,
`bg-cat-camping-badge-bg`, `border-cat-camping-cta-border`).

### 1.3 Alpha overlays (kept literal — alpha, not ramp steps)

| Token | Value | Role |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.07)` | hairline dividers, default border |
| `--border-mid` | `rgba(255,255,255,0.14)` | stronger separators, scrollbar thumb |
| `--border-strong` | `rgba(255,255,255,0.20)` | card outline / raised-surface edge |
| `--bg-detail` | `rgba(65,65,65,0.80)` | detail-panel scrim over map |

### 1.4 Interactive & semantic roles

Saturated interactive blues, pulled out of the Steel ramp into named roles.

| Token | Value | Role |
|---|---|---|
| `--focus` | `#A7CCFD` | focus border (forms, rings) |
| `--action` | `rgba(61,162,221,0.70)` | primary CTA fill |
| `--action-hover` | `rgba(61,162,221,0.88)` | primary CTA hover |
| `--action-pressed` | `#2A6D94` | primary CTA pressed |
| `--action-border` | `#4DAAFF` | primary CTA border |
| `--action-ring` | `rgba(77,170,255,0.25)` | primary CTA focus ring |
| `--input-accent` | `#92BEFD` | form accent (checkbox/slider fill) |
| `--success` | `#7ACEA1` (= `--forest-300`) | success state |
| `--error` | `#E08872` | error / destructive state |
| `--warning` | `#c77429` (= `--amber-500`) | **NEW** — warning state |
| `--link` | `#4DAAFF` (= `--action-border`) | hyperlinks (default) |
| `--link-hover` | `#A7CCFD` (= `--focus`) | hyperlinks (hover) |
| `--pin` | `#FF8E05` | **NEW** — ranking pins / score glyphs (orange-red) |
| `--marker` | `#FF8E05` (= `--pin`) | **NEW** — map location glyphs |
| `--pin-border` | `#F68A0D` | **NEW** — pin/marker outline |

> **Note (pin):** `--pin`/`--marker` collapse the untokenized cluster
> `#FF8E05 · #F88112 · #F68A0D · #EF8B23 · #E8941F` into named roles for all DOM/CSS consumers.
> Mapbox layer-paint and `mapboxgl.Marker` colors in `map-column.tsx` (e.g. `#c8a96e`) are a
> deliberate, permanent exception: Mapbox's GL paint properties can't read CSS custom properties,
> so those values stay as raw hex by necessity — they are not a pending conform target.

### 1.5 Added scales — **not from Paper** (introduced here to fill real gaps)

Everything in §1.5 was absent from both globals.css and the Paper board. Values are new proposals.

**Spacing** (base-4, matches the 4px radius base):

| Token | px |  | Token | px |
|---|---|---|---|---|
| `--space-1` | 4 |  | `--space-6` | 24 |
| `--space-2` | 8 |  | `--space-8` | 32 |
| `--space-3` | 12 |  | `--space-10` | 40 |
| `--space-4` | 16 |  | `--space-12` | 48 |
| `--space-5` | 20 |  | `--space-16` | 64 |

**Radius** (existing `sm/md/lg/xl` + new `--radius-full`):

| Token | Value | px |
|---|---|---|
| `--radius` | `0.25rem` | 4 (base) |
| `--radius-sm` | `calc(var(--radius) * 0.6)` | 2.4 |
| `--radius-md` | `calc(var(--radius) * 0.8)` | 3.2 |
| `--radius-lg` | `var(--radius)` | 4 |
| `--radius-xl` | `calc(var(--radius) * 1.4)` | 5.6 |
| `--radius-full` | `9999px` | pills, pins, avatars — **NEW** |

**Border width:** `--border-width-1: 1px` (default) · `--border-width-2: 2px` (emphasis/focus).

**Shadows / elevation** (dark theme):

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.40)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.45)` |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.55)` |
| `--shadow-inset` | `inset 0 1px 0 rgba(255,255,255,0.04)` |

**Type scale.** Families (5 loaded via `next/font` in `layout.tsx`):

| Token | Family | Role |
|---|---|---|
| `--ff-sans` | Barlow | body / UI (default) |
| `--ff-display` | Space Grotesk | section labels, status/rating |
| `--ff-display-condensed` | Barlow Condensed | **NEW token** — card/place titles (700) |
| `--ff-mono` | Space Mono | data, coordinates, hex |
| `--ff-serif` | Crimson Text | editorial / field notes |

| Sizes (px) | Weights | Line-height | Tracking |
|---|---|---|---|
| `--text-2xs` 10 | `--font-weight-light` 300 | `--leading-tight` 1.1 | `--tracking-tight` -0.02em |
| `--text-xs` 12 | `--font-weight-regular` 400 | `--leading-snug` 1.3 | `--tracking-normal` 0 |
| `--text-sm` 13 | `--font-weight-medium` 500 | `--leading-normal` 1.5 | `--tracking-wide` 0.06em |
| `--text-base` 14 | `--font-weight-semibold` 600 |  | `--tracking-wider` 0.08em |
| `--text-md` 16 | `--font-weight-bold` 700 |  |  |
| `--text-lg` 18 |  |  |  |
| `--text-xl` 20 |  |  |  |
| `--text-2xl` 24 |  |  |  |
| `--text-3xl` 30 |  |  |  |
| `--text-4xl` 40 |  |  |  |

> Base body size is **14px** (`.form-field`, most UI), not 16px — matches the existing app.

### 1.6 Rail (itinerary nav) — Paper "Trip Running" port

Semantic roles for the day-column rail. The selected day card reads as a cool steel
surface (distinct from the green `--bg-day-active` used on section headers); the gutter
timeline is white on the active day, warm-grey otherwise.

| Token | Value | Role |
|---|---|---|
| `--bg-day-selected` | `#263847` (= `--steel-750`) | selected day-card surface |
| `--border-day-selected` | `#262829` (= `--grounds-800`) | selected day-card hairline divider |
| `--timeline-active` | `#ffffff` | active day gutter dot + connector |
| `--timeline-inactive` | `#383736` | inactive day gutter dot + connector |
| `--focus-faint` | `rgba(167,204,253,0.12)` | chevron toggle outline (faint `--focus`) |

---

## 2. Semantic aliases (full mapping)

Every legacy `--bg-*`, `--input-*`, `--button-*`, `--text-*`, `--amber*` name is preserved and now
points at a ramp step or role. **No alias names changed** — only their right-hand side.

**Backgrounds**

| Alias | → |
|---|---|
| `--bg-base` | `--grounds-950` |
| `--bg-panel` | `--grounds-900` |
| `--bg-card` | `--grounds-850` |
| `--bg-topbar` | `--grounds-850` |
| `--bg-nav-btn` | `--steel-850` |
| `--bg-tab-idle` | `--steel-850` |
| `--bg-tab-active` | `--amber-900` |
| `--bg-day-active` | `--forest-900` |
| `--bg-map` | `--forest-950` |
| `--bg-detail` | `rgba(65,65,65,0.80)` (literal overlay) |

**Borders**

| Alias | → |
|---|---|
| `--border-subtle` | `rgba(255,255,255,0.07)` (literal) |
| `--border-mid` | `rgba(255,255,255,0.14)` (literal) |
| `--nav-border` | `--steel-400` |

**Text**

| Alias | → |
|---|---|
| `--text-primary` | `--type-100` |
| `--text-muted` | `--type-500` |
| `--text-dim` | `--type-500` (legacy alias of muted) |

**Amber (brand)**

| Alias | → |
|---|---|
| `--amber` | `--amber-300` |
| `--amber-light` | `--amber-100` |
| `--amber-dark` | `--amber-500` |

**Form fields**

| Alias | → |
|---|---|
| `--input-surface` | `--steel-900` |
| `--input-surface-filled` | `--steel-700` |
| `--input-surface-hover` | `--steel-600` |
| `--input-surface-disabled` | `--steel-800` |
| `--input-border` | `--steel-300` |
| `--input-border-filled` | `--steel-100` |
| `--input-border-hover` | `--steel-50` |
| `--input-border-disabled` | `--steel-500` |
| `--input-border-focus` | `--focus` |
| `--input-focus-ring` | `rgba(167,204,253,0.18)` (literal) |
| `--input-accent` | `#92BEFD` (role) |
| `--input-placeholder` | `--type-300` |
| `--input-value` | `--type-50` |
| `--input-disabled-text` | `--steel-200` |
| `--input-error` | `--error` |
| `--input-success` | `--success` |

**Primary CTA (button)**

| Alias | → |
|---|---|
| `--button-primary` | `--action` |
| `--button-primary-hover` | `--action-hover` |
| `--button-primary-pressed` | `--action-pressed` |
| `--button-primary-border` | `--action-border` |
| `--button-primary-ring` | `--action-ring` |

**shadcn theme slots** — remap shadcn components onto our palette. **`--secondary-foreground` and
`--accent-foreground` are restored** (the Paper board had dropped them; code parity requires them).

| Alias | → |
|---|---|
| `--background` | `--bg-base` |
| `--foreground` | `--text-primary` |
| `--card` | `--bg-card` |
| `--card-foreground` | `--text-primary` |
| `--popover` | `--bg-panel` |
| `--popover-foreground` | `--text-primary` |
| `--primary` | `--button-primary` |
| `--primary-foreground` | `--text-primary` |
| `--secondary` | `--bg-card` |
| `--secondary-foreground` | `--text-primary` *(restored)* |
| `--muted` | `--bg-card` |
| `--muted-foreground` | `--text-muted` |
| `--accent` | `--bg-nav-btn` |
| `--accent-foreground` | `--text-primary` *(restored)* |
| `--destructive` | `--error` |
| `--border` | `--border-subtle` |
| `--input` | `--input-surface` |
| `--ring` | `--input-border-focus` |
| `--radius` | `0.25rem` |

---

## 3. Generated mirror (`--color-*`)

The `@theme inline` block in `globals.css` exposes every token to Tailwind v4 as utilities
(`bg-*`, `text-*`, `border-*`, `ring-*`, `font-*`). **It is generated from the primitives above —
do not hand-edit.** Each `--color-X` is `var(--X)`; each `--font-X` is `var(--ff-X)`. When a
primitive changes, the mirror and this file are regenerated, never edited independently.

---

## 4. Usage rules per token group

- **Grounds** — surfaces only (page, panels, cards). Never text.
- **Steel** — form/nav/chrome surfaces and borders. Never CTAs or links (those are interactive roles).
- **Forest** — map/active-day surfaces; `--success` for positive states.
- **Amber** — brand accent for text, data, and active/selected state **only**. Never links, never pins.
- **Type** — all foreground text. `--type-100` body, `--type-500` muted/captions, `--type-50` input values.
- **Category** — waypoint identity. Each category is a 5-role set (`title` / `badge-bg` + `badge-border` / `cta-bg` + `cta-border`); use the role that fits the element and never mix roles across categories.
- **Interactive roles** — `--action*` for the one primary button; `--link*` for links; `--focus` for focus.
- **`--pin`/`--marker`** — ranking pins and map glyphs only (orange-red).
- **Added scales** — use `--space-*`, `--radius-*`, `--shadow-*`, type tokens instead of literals.

---

## 5. Component conventions

- **Button (primary):** fill `--action` → hover `--action-hover` → pressed `--action-pressed`;
  border `--action-border`; focus ring `0 0 0 3px --action-ring`; radius `--radius-lg` (4px);
  label `--ff-display`, uppercase, `--tracking-wide`. **One spec — no variants.**
- **Card:** bg `--bg-card`; border `1px var(--border-subtle)`; radius `--radius-lg`;
  optional `--shadow-md` when floating over the map.
- **Chip / category tag:** FG `--cat-{x}-title` (or `--cat-{x}-badge-border`) on BG
  `--cat-{x}-badge-bg`, border `--cat-{x}-badge-border`; radius `--radius-full`;
  `--ff-display`, `--text-2xs`, uppercase, `--tracking-wider`.
- **Ranking pin:** circular, fill `--pin`, `2px` border `--pin-border`, `--ff-mono` `700` number,
  radius `--radius-full`. **Orange-red, never amber.**
- **Verified stamp:** `--success` glyph + `--ff-display` uppercase micro-label. **One style only.**
- **Nav states:** idle `--bg-tab-idle` (= `--steel-850`); active `--bg-tab-active` (= `--amber-900`);
  nav button `--bg-nav-btn`; nav border `--nav-border`.
- **Form field:** see `.form-field` in `globals.css` (46h · 4px radius · 14px inline pad · 10px gap ·
  1px border · focus = 1px `--focus` + 3px `--input-focus-ring`).

---

## 6. Drift-killers (do / don't)

- ✅ Reference DESIGN.md / `var(--token)` for every color, type, space, radius.
- ❌ No raw hex in components (`#FF8E05`, `#c8a96e`, …). Add a token instead.
- ✅ Links use `--link` / `--link-hover`. ❌ Links never use amber.
- ✅ Pins/markers use `--pin` / `--marker` (orange-red). ❌ Pins never use amber.
- ✅ Amber is a text/data/active accent only.
- ✅ One verified-stamp style; one `button-primary` spec. ❌ No per-screen button or stamp variants.
- ❌ Don't edit the `--color-*` mirror by hand — change the primitive.

---

## 7. Sync note

```
globals.css :root primitives   ← editable master (only place values change)
        │  generates
        ▼
--color-* @theme mirror         ← generated; never hand-edited
        │  documented by
        ▼
DESIGN.md                       ← regenerated when primitives change; the only style doc read
        │  reconciled into ▲ on demand
Paper "design tokens" board     ← visual surface; artboards use var(--token), never raw hex
```
