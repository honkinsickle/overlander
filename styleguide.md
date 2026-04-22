# Overlander Style Guide

The design system for the Overlander app. Tokens live in `index.html :root`. Component specs live in the Paper file `overlander_1`, Page 1 — artboard IDs are referenced below.

This document is the source of truth for **what exists and how to use it**. For session-specific notes (what shipped, what's open), see the adjacent `handoff.md` if present.

---

## Semantic role split

| Family | Role | Where used |
|---|---|---|
| **Blue** — `--input-*`, `--button-primary-*`, `#4DAAFF` | Forms, CTAs, interactive focus — the "active conversation" surface | Every form field, primary CTA, focus ring |
| **Amber** — `--amber`, `--amber-dark`, `--amber-light` | Brand identity, active state | Chats nav active tab, "Automagically" italic, day-card dates, `--amber-dark` alerts |
| **Green** — `--bg-day-active` | Active/selected day card background | Day card in sidebar when its day is current |
| **Category** — `--cat-*` | Waypoint category identity | Waypoint cards, Location Detail accents, Interests chips |

Rule of thumb: **if the user is acting, use blue. If the system is telling them what this is, use amber or a category color.**

---

## Color tokens

### Backgrounds

```css
--bg-base:       #0a0b0c;   /* page ground */
--bg-panel:      #111214;   /* panels, sheets */
--bg-card:       #161819;   /* cards */
--bg-topbar:     #161819;   /* top nav */
--bg-nav-btn:    #1b2c3e;
--bg-tab-active: #59472e;   /* amber-tinted active tab */
--bg-tab-idle:   #1b2c3e;
--bg-day-active: rgb(28,58,32);   /* selected day card */
--bg-detail:     rgba(65,65,65,0.80);
--bg-map:        #1e2a1e;
```

### Text

```css
--text-primary: #eceae4;   /* body and headings */
--text-muted:   #888888;   /* secondary text */
--text-dim:     #888888;   /* captions, meta */
```

### Amber (brand)

```css
--amber:       #c8a96e;
--amber-dark:  #c77429;
--amber-light: #e8c98e;
```

### Borders

```css
--border-subtle: rgba(255,255,255,0.07);
--border-mid:    rgba(255,255,255,0.14);
--nav-border:    #46586a;
```

### Primary button (CTA)

```css
--button-primary:         rgba(61,162,221,0.70);
--button-primary-hover:   rgba(61,162,221,0.88);
--button-primary-pressed: #2A6D94;
--button-primary-border:  #4DAAFF;
--button-primary-ring:    rgba(77,170,255,0.25);
```

### Form fields

Blue family. Surface + border split into empty (default) and filled variants so tokens can drive state without helper classes.

```css
/* Surfaces */
--input-surface:          #1A1F28;   /* empty / unfocused */
--input-surface-filled:   #2B3B52;   /* filled or active */
--input-surface-hover:    #32455F;
--input-surface-disabled: #242F42;

/* Borders */
--input-border:           #475C78;   /* empty / unfocused */
--input-border-filled:    #7E98BF;   /* filled or active */
--input-border-hover:     #8AA2C4;
--input-border-focus:     #A7CCFD;
--input-border-disabled:  #3E516C;

/* Accents */
--input-focus-ring:    rgba(167,204,253,0.18);
--input-accent:        #92BEFD;   /* checkbox tick, radio dot */
--input-placeholder:   #B3B3B3;
--input-value:         #EDF1F6;
--input-disabled-text: #556984;

/* Feedback */
--input-error:   #E08872;   /* coral */
--input-success: #7ACEA1;   /* mint */
```

### Waypoint category palette

Accent + matching background, one pair per category. `--cat-attraction` is a deliberate alias for `--amber`.

```css
--cat-fuel:          #FA9C9D;   --cat-fuel-bg:       #4E252F;
--cat-camping:       #6ECECE;   --cat-camping-bg:    #304B4B;
--cat-mountain:      #2CB5FF;   --cat-mountain-bg:   #1A4A42;
--cat-urban:         #A7CCFD;   --cat-urban-bg:      #24354F;
--cat-food:          #FDBA74;   --cat-food-bg:       #3A2A1E;
--cat-oddity:        #D8B4FE;   --cat-oddity-bg:     #2A1A3E;
--cat-attraction:    #c8a96e;   --cat-attraction-bg: #3A2E17;   /* = --amber */
--cat-neutral:       #888888;   --cat-neutral-bg:    #26292B;
```

Usage: background fills the chip/thumbnail circle; accent color is used for the icon and any typography that names the category.

---

## Typography

```css
--ff-sans:    'Barlow', sans-serif;                  /* body, titles, labels */
--ff-display: 'Space Grotesk', system-ui, sans-serif;/* section labels */
--ff-mono:    'Space Mono', monospace;               /* IDs, hex, timestamps, callouts, asides */
```

### Scale

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Hero / H1 | Barlow | varies by screen | 600–700 | -0.01em on large |
| Body | Barlow | 14 / 18 | 400 | normal |
| Section label | Space Grotesk | 13 / 16 | 500 | 0.46em (≈ 6px at 13px), uppercase, white |
| Meta / ID / callout | Space Mono | 12 / 16 | 400 | normal |
| Button | Barlow | 14 / 18 | 500 | normal |
| Input value | Barlow | 14 / 18 | 400 | normal |

Asides and meta-pointers use the `↳` glyph in Space Mono.

"Automagically" is set in **Barlow italic**, amber, as a brand term.

---

## Form fields — primitive spec

All text-like inputs (text input, search, select, textarea) inherit this shape:

| Property | Value |
|---|---|
| Height | 46px |
| Radius | 4px |
| Padding | 14px horizontal |
| Gap (icon ↔ text) | 10px |
| Border | 1px |
| Font | Barlow 400, 14 / 18 |
| Icon | 14×14, stroke 2 |
| Focus ring | 1px `--input-border-focus` + 0 0 0 3px `--input-focus-ring` |
| Tap target | 44×44 minimum (enforce via padding on small controls) |

### State matrix

| State | Surface | Border | Notes |
|---|---|---|---|
| Default | `--input-surface` | `--input-border` | — |
| Hover | `--input-surface-hover` | `--input-border-hover` | one step brighter |
| Focused | surface unchanged | `--input-border-focus` | + 3px ring |
| Filled | `--input-surface-filled` | `--input-border-filled` | value in `--input-value` |
| Disabled | `--input-surface-disabled` | `--input-border-disabled` | text in `--input-disabled-text`, 40% opacity overall |
| Error | surface unchanged | `--input-error` | coral; no ring; icon + helper text |
| Success | surface unchanged | `--input-success` | mint |

Focused + Error both target the border. When combined, Error wins; the focus ring is suppressed so the error color reads cleanly.

### Non-color rules

- Labels are always visible — never placeholder-only.
- Error state is never color-only — always paired with icon + helper text.
- Focus rings are present on every interactive control, keyboard or pointer.

---

## Spacing & radii

```
Section padding:   14px 16px (top/sides), 10px (bottom)
Card internal:     10px 12px
Column gap:        10px (stats row), 14px (phase-header elements)
Vertical gap in cards: 3px (label → value → detail)

Border radius:
  4px   cards, inputs, buttons
  6px   alerts
  20px  pills
  50%   circular icon frames
```

---

## Components

All components specified in Paper file `overlander_1`, Page 1.

| Component | Artboard | Notes |
|---|---|---|
| Vertical Nav | `AEP-0` | 80w column, amber-dark active |
| Day Card | `AH0-0` | 3 states + sidebar stack |
| Waypoint Card | `ALI-0` | 420w row, uses `--cat-*` palette |
| Slideup Header | `ANC-0` | 1113×68, 3 variants |
| Day Section Header | `B3Q-0` | 440×80, Space Grotesk label |
| Location Detail Panel | `B6O-0` | 457w; hero + description + places + index |
| Search Input — Blue | `9WP-0` | 8 states incl. file uploads |
| Search Input — Amber | `BKU-0` | legacy brand variant |
| Text Input | `A5F-0` | 15 state variants |
| Checkbox | `BWL-1` | 10 states + composition |
| Radio | `CDU-0` | 9 states + vertical + card-group |
| Toggle (iOS) | `CHL-0` | 51×31, 9 states + settings row |
| Button | `C61-1` | 3 variants × 3 sizes + 6 states + icon variants |
| Icon Library — outline | `DZB-1` | 50 icons, 6 categories |
| Icon Library — button style | `ECY-0` | same 50 icons, filled-frame variant |

### Planning v3 flow

All steps overlay the Entry screen as modals.

| Step | Artboard |
|---|---|
| Entry | `978-0` |
| Detail (Keys View) | `DM5-1` |
| v3-2 Destination | `98E-0` |
| v3-3 Vehicle | `9BF-0` |
| v3-5 Interests | `9ES-0` |
| v3-6 Planned Stops | `9I8-0` |
| v3-7 Loader | `9M6-0` |
| v3-8 Results | `9P9-0` |

---

## Accessibility baseline

WCAG 2.1 AA. Enforced:

- Every interactive control has a visible focus ring.
- Tap targets ≥ 44×44.
- Text contrast checked against its actual background — not assumed from the nearest panel token.
- Error state signaled by icon + text in addition to color.
- Form labels always present (no placeholder-only).

Contrast targets:

- Text ≥ 4.5:1 (body), ≥ 3:1 (large, 18px+ or 14px bold).
- Non-text (borders, icons, button edges) ≥ 3:1 against adjacent surface.

---

## Layout grid

Design canvas is **1133 × 744** (iPad Mini landscape). The primary split is:

- Vertical nav: 80px
- Chat / planning column: flexible (left)
- Map / detail column: flexible (right)

See Style Guide artboard `7US-0` for the visual grid overlay.

---

## Reference

- Paper file: `overlander_1`, Page 1 (`01KNTTXWMSGRKMFXS30V1HW3GS`)
- Style Guide artboard: `7US-0`
- Token source: `index.html :root`
