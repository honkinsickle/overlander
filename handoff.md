# Design System Handoff

A summary of the design-system work done in this session — what shipped to code, what lives in Paper, and what's still open.

## TL;DR

- **[PR #3](https://github.com/honkinsickle/overlander/pull/3)** adds 22 new design tokens to `index.html :root` (buttons, form fields, display font) on branch `claude/silly-mccarthy`.
- The Paper file `overlander_1` now contains a complete style guide, 14 component artboards, an icon library in two styles, and an aligned Planning v3 flow (7 screens).
- All new form components use a **blue `--input-*` palette** and all CTA buttons use a **blue `--button-primary-*` palette**; amber is reserved for brand/active-state identity (Chats nav, "Automagically" italic, day-card dates, `--amber-dark` alert).

---

## Code changes shipped

### PR #3 — Add design tokens for buttons, inputs, and display font

Branch: `claude/silly-mccarthy` → `main`
Commit: `f3d5bb8`
File: `index.html` (+29 / −3, all inside `:root`)

**Google Fonts import updated** to include Barlow 500 and Space Grotesk (400/500/700).

**New tokens (`:root`):**

```css
/* Display font for section labels */
--ff-display: 'Space Grotesk', system-ui, sans-serif;

/* CTA (Primary Button) — blue */
--button-primary:         rgba(61,162,221,0.70);
--button-primary-hover:   rgba(61,162,221,0.88);
--button-primary-pressed: #2A6D94;
--button-primary-border:  #4DAAFF;
--button-primary-ring:    rgba(77,170,255,0.25);

/* Form fields — blue family */
--input-surface:          #1A1F28;  /* empty / unfocused */
--input-surface-filled:   #2B3B52;  /* filled or active */
--input-surface-hover:    #32455F;
--input-surface-disabled: #242F42;
--input-border:           #475C78;  /* empty / unfocused */
--input-border-filled:    #7E98BF;
--input-border-hover:     #8AA2C4;
--input-border-focus:     #A7CCFD;
--input-border-disabled:  #3E516C;
--input-focus-ring:       rgba(167,204,253,0.18);
--input-accent:           #92BEFD;
--input-placeholder:      #B3B3B3;
--input-value:            #EDF1F6;
--input-disabled-text:    #556984;
--input-error:            #E08872;
--input-success:          #7ACEA1;
```

**Backwards compatible:** purely additive. Nothing in existing CSS references these yet.

### Pre-existing tokens (unchanged, listed for context)

```css
--bg-base, --bg-panel, --bg-card, --bg-topbar, --bg-nav-btn,
--bg-tab-active, --bg-tab-idle, --bg-day-active, --bg-detail, --bg-map
--border-subtle, --border-mid, --nav-border
--amber, --amber-dark, --amber-light
--text-primary, --text-muted, --text-dim
--ff-mono, --ff-sans
```

---

## Design language rules

### Semantic role split

| Color family | Role |
|---|---|
| **Blue** `--input-*` + `--button-primary-*` + `#4DAAFF` | Forms, CTAs, interactive focus — the "active conversation" surface |
| **Amber** `--amber`, `--amber-dark`, `--amber-light` | Brand identity, active sidebar tab, day-card date, alert callout, "Automagically" feature name, `↳` Space Mono asides |
| **Green** `--bg-day-active` | Active/selected day card background |
| **Category palette** `--cat-*` (proposed, not in code) | Waypoint categories: fuel, camping, mountain, urban, food, oddity, attraction, neutral |

### Form Fields primitive

All form components inherit:
- **Height** 46px · **Radius** 4px · **Padding** 14px · **Gap** 10px · **Border** 1px
- **Font** Barlow 400 · 14/18
- **Icon** 14×14 · stroke 2
- **Focus ring** `1px --input-border-focus` + `0 0 0 3px --input-focus-ring`
- **Tap target** 44×44 min

### Typography

- `--ff-sans` Barlow — body, titles, labels
- `--ff-display` Space Grotesk — section labels (13px, letter-spacing 6px, uppercase, white)
- `--ff-mono` Space Mono — IDs, hex, timestamps, callouts, meta

### Component states

Documented in the Style Guide Form Fields state matrix. Common pattern:

| State | Convention |
|---|---|
| Default | bg + border neutral |
| Hover | border one step brighter |
| Focused | `--input-border-focus` + 3px ring |
| Filled | `--input-surface-filled`, `--input-border-filled`, value in `--input-value` |
| Disabled | `--input-surface-disabled` + 40% opacity |
| Error | `--input-error` border (no ring); coral `#E08872` |
| Success | `--input-success` border; green `#7ACEA1` |

---

## Paper artboards

All work is in Paper file **`overlander_1`**, page `Page 1`.

### Style Guide — `7US-0`

13 sections:
1. Header
2. Backgrounds (10 swatches)
3. Text Colors (3)
4. Amber Accents (3)
5. Borders (3)
6. Category Palette (8 — proposed, not in code yet)
7. Typography (Barlow + Space Grotesk + Space Mono)
8. **Form Fields** — primitive spec + palette + state matrix
9. **Components Index** — thumbnails + references to component artboards
10. Layout Grid (1133 × 744)
11. CSS Variable Reference
12. Spacing Tokens
13. Component Examples

### Component artboards (code-aligned)

| Component | Artboard ID | Notes |
|---|---|---|
| Vertical Nav | `AEP-0` | 80w column, amber-dark active |
| Day Card | `AH0-0` | 3 states + sidebar stack |
| Waypoint Card | `ALI-0` | 420w row, `--cat-*` palette |
| Slideup Header | `ANC-0` | 1113×68, 3 variants |
| Day Section Header | `B3Q-0` | 440×80, Space Grotesk label |
| Location Detail Panel | `B6O-0` | 457w, hero + description + places + index |
| Search Input — States | `9WP-0` (blue), `BKU-0` (amber) | 8 states incl. file uploads |
| Text Input — States | `A5F-0` | 15 variants |
| Checkbox | `BWL-1` | 10 states + composition |
| Radio | `CDU-0` | 9 states + vertical + card group |
| Toggle (iOS) | `CHL-0` | 51×31, 9 states + settings row |
| Button | `C61-1` | 3 variants × 3 sizes + 6 states + icon variants |
| Icon Library | `DZB-1` (outline tiles), `ECY-0` (button style) | 50 icons in 6 categories |

### Planning v3 flow (all modals overlay Entry)

| Step | Artboard | Notes |
|---|---|---|
| v3-1 Entry | `978-0` | Split layout: chat column + map column |
| v3-1 Detail | `DM5-1` | Chat column + Location Detail panel (Keys View) |
| v3-2 Destination | `98E-0` | Modal over Entry; blue inputs, thumbs-up radio |
| v3-3 Vehicle | `9BF-0` | Vehicle card as blue selected radio, tip card |
| v3-5 Interests | `9ES-0` | Widened to 720w; 3 category cards with chip groups |
| v3-6 Planned Stops | `9I8-0` | Search input + waypoint-style stops list |
| v3-7 Loader | `9M6-0` | Blue spinner + step progress (done/active/pending) |
| v3-8 Results | `9P9-0` | Trip summary grid + top picks list + Save Trip CTA |

---

## Accessibility

WCAG 2.1 AA contrast audit run and all critical fails fixed:

| Fix | Before | After |
|---|---|---|
| Primary button (amber era) | 2.92:1 ❌ | Migrated to blue; white on `rgba(61,162,221,.70)` ≈ 4.8:1 ✓ |
| Input default border | 2.80:1 ❌ | Lightened `#6381A8` → `#7E98BF` (but see ⚠️ below) |
| Mountain chip title | 2.89:1 ❌ | Darkened bg `#24695F` → `#1A4A42` |
| Neutral chip border | 2.03:1 ❌ | Solid `#888888` |

### ⚠️ Token value discrepancy to resolve

During the AA audit I lightened `--input-border` from `#6381A8` → `#7E98BF` to pass 3:1 against `--input-surface #2B3B52`.

Later, we reinterpreted the tokens so `--input-surface` means the **empty** state (`#1A1F28`) and `--input-surface-filled` holds the brighter `#2B3B52`. The border token split followed: `--input-border` is now `#475C78` (empty) and `--input-border-filled` is `#7E98BF` (filled).

Re-check contrast of these final values before relying on them:
- `#475C78` border on `#1A1F28` surface — **needs verification**
- `#7E98BF` border on `#2B3B52` surface — ✓ (previously verified ~3.4:1)

If `#475C78` on `#1A1F28` fails 3:1, lighten `--input-border` slightly.

### Non-color

- Focus ring primitive documented and used everywhere
- Tap targets 44×44 minimum
- Form labels always visible (not placeholder-only)
- Error state not color-only (icon + helper text)

---

## Proposed tokens not yet in code

These live in the Style Guide Category Palette section, marked **"proposed · not yet in :root"**. They're used as literals in Waypoint Card, Location Detail, and Interests screens.

```css
/* Category palette — ready to land when needed */
--cat-fuel:       #FA9C9D;   --cat-fuel-bg:       #4E252F;
--cat-camping:    #6ECECE;   --cat-camping-bg:    #304B4B;
--cat-mountain:   #2CB5FF;   --cat-mountain-bg:   #1A4A42;
--cat-urban:      #A7CCFD;   --cat-urban-bg:      #24354F;
--cat-food:       #FDBA74;   --cat-food-bg:       #3A2A1E;
--cat-oddity:     #D8B4FE;   --cat-oddity-bg:     #2A1A3E;
--cat-attraction: #c8a96e;   --cat-attraction-bg: #3A2E17;   /* = --amber */
--cat-neutral:    #888888;   --cat-neutral-bg:    #26292B;
```

Safe to add in a follow-up PR when waypoint/category-related screens get implemented.

---

## Open items / Next steps

1. **Verify `#475C78` on `#1A1F28` contrast** (see AA note above). Adjust if needed.
2. **Decide on `--cat-*` tokens** — land them before implementing waypoint cards in code.
3. **Implement components** — Paper artboards are the specs; none of the components exist in the codebase yet. Start with Button and Form Fields since their tokens are now available.
4. **Icon Library** — 50 icons drawn in Paper. Consider converting to an SVG sprite or a React/Svelte icon component file for use in code.
5. **Space Grotesk usage** — the font loads now, but `.dd-section-label` was the only class using it. Audit any other places that should use `--ff-display`.
6. **Planning v3 flow** — entire flow exists only in Paper. Build screens into the app using the aligned patterns.
7. **Scheduled review** — if a reviewer lands PR #3, follow up with a short PR introducing `--cat-*` tokens so that waypoint-related work can land cleanly.

---

## Quick reference

- PR: https://github.com/honkinsickle/overlander/pull/3
- Branch: `claude/silly-mccarthy` (based on `main`)
- Paper file: `overlander_1`, Page 1 (`01KNTTXWMSGRKMFXS30V1HW3GS`)
- Style Guide artboard: `7US-0` (top-left of the canvas, search for "Style Guide")
