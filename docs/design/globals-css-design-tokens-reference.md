# globals.css — Design Tokens (Paper artboard reference)

> Faithful snapshot of the Paper artboard **"globals.css — Design Tokens"** (`1-0`) in the
> "Design Tokens" file — header *"CANONICAL :root SYSTEM — DARK THEME · SINGLE SOURCE OF TRUTH"*.
> Counts shown on the board: **56 color tokens · 4 type families · 5 radius steps.**
>
> ⚠️ **Canonical/current reference is [`/DESIGN.md`](../DESIGN.md)** (+ `web/src/app/globals.css :root`).
> This artboard depicts the **original flat token layout**; DESIGN.md supersedes it with the
> 5-ramp primitive system (Grounds/Steel/Forest/Amber/Type) + semantic aliases. The *values* below
> are still accurate — they're the literals the ramp aliases now resolve to — but the **organization**
> here is the pre-refactor one. Use this doc to read the board; use DESIGN.md to write code.

Theme: **dark only.**

## Backgrounds (10)

| Token | Value |
|---|---|
| `--bg-base` | `#0a0b0c` |
| `--bg-panel` | `#111214` |
| `--bg-card` | `#161819` |
| `--bg-topbar` | `#161819` |
| `--bg-nav-btn` | `#1b2c3e` |
| `--bg-tab-active` | `#59472e` |
| `--bg-tab-idle` | `#1b2c3e` |
| `--bg-day-active` | `rgb(28,58,32)` |
| `--bg-detail` | `rgba(65,65,65,.80)` |
| `--bg-map` | `#1e2a1e` |

## Borders (3)

| Token | Value |
|---|---|
| `--border-subtle` | `rgba(255,255,255,.07)` |
| `--border-mid` | `rgba(255,255,255,.14)` |
| `--nav-border` | `#46586a` |

## Amber — brand / active (3)

| Token | Value |
|---|---|
| `--amber` | `#c8a96e` |
| `--amber-dark` | `#c77429` |
| `--amber-light` | `#e8c98e` |

## Text (3)

| Token | Value |
|---|---|
| `--text-primary` | `#eceae4` |
| `--text-muted` | `#888888` |
| `--text-dim` | `#888888` (alias of muted) |

## Primary CTA — blue (5)

| Token | Value |
|---|---|
| `--button-primary` | `rgba(61,162,221,.70)` |
| `--button-primary-hover` | `rgba(61,162,221,.88)` |
| `--button-primary-pressed` | `#2A6D94` |
| `--button-primary-border` | `#4DAAFF` |
| `--button-primary-ring` | `rgba(77,170,255,.25)` |

## Form Fields — blue family (16)

| Token | Value |
|---|---|
| `--input-surface` | `#1A1F28` |
| `--input-surface-filled` | `#2B3B52` |
| `--input-surface-hover` | `#32455F` |
| `--input-surface-disabled` | `#242F42` |
| `--input-border` | `#475C78` |
| `--input-border-filled` | `#7E98BF` |
| `--input-border-hover` | `#8AA2C4` |
| `--input-border-focus` | `#A7CCFD` |
| `--input-border-disabled` | `#3E516C` |
| `--input-focus-ring` | `rgba(167,204,253,.18)` |
| `--input-accent` | `#92BEFD` |
| `--input-placeholder` | `#B3B3B3` |
| `--input-value` | `#EDF1F6` |
| `--input-disabled-text` | `#556984` |
| `--input-error` | `#E08872` |
| `--input-success` | `#7ACEA1` |

## Category palette — FG / BG (8)

| Category | FG | BG | Note |
|---|---|---|---|
| `--cat-fuel` | `#FA9C9D` | `#4E252F` | |
| `--cat-camping` | `#6ECECE` | `#304B4B` | |
| `--cat-mountain` | `#2CB5FF` | `#1A4A42` | |
| `--cat-urban` | `#A7CCFD` | `#24354F` | |
| `--cat-food` | `#FDBA74` | `#3A2A1E` | |
| `--cat-oddity` | `#D8B4FE` | `#2A1A3E` | |
| `--cat-attraction` | `#c8a96e` | `#3A2E17` | = amber |
| `--cat-neutral` | `#888888` | `#26292B` | |

> This is the **canonical `--cat-*` palette** (per `globals.css`/DESIGN.md). It is distinct from the
> v2 browse-card chrome palette in `lib/trip-browse/palette.ts` (see
> [browse-card-category-type-reference.md](browse-card-category-type-reference.md)) — the two overlap
> in places but are maintained separately.

## Semantic aliases — shadcn → ours

Header on the board reads **19**; the board renders **17** rows (the 16 mappings + `--radius`).
`globals.css` actually defines **18** alias vars + `--radius`; the board omits `--secondary-foreground`
and `--accent-foreground` (both → `--text-primary`).

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
| `--muted` | `--bg-card` |
| `--muted-foreground` | `--text-muted` |
| `--accent` | `--bg-nav-btn` |
| `--destructive` | `--input-error` |
| `--border` | `--border-subtle` |
| `--input` | `--input-surface` |
| `--ring` | `--input-border-focus` |
| `--radius` | `0.25rem · 4px` |

## Typography — 4 families

| Token | Family | Role (board annotation) | Sample on board |
|---|---|---|---|
| `--ff-sans` | Barlow | body / UI | "Overland the unpaved route" |
| `--ff-display` | Space Grotesk | labels | "EXPLORE · ITINERARY" |
| `--ff-mono` | Space Mono | data / hex | "64.8331, -147.7164" |
| `--ff-serif` | Crimson Text | Georgia fallback | "Field notes from the trail" |

> Note: the board shows 4 families. The code (`layout.tsx`) actually loads **5** — Barlow Condensed
> is also loaded/used (card titles) and is tokenized as `--ff-display-condensed` in DESIGN.md, but it
> does not appear on this artboard. **Inter** is not used (stray).

## Radius — base 0.25rem

Header reads **5** steps; the board renders **4** swatches (the 5th is the `--radius` alias).

| Token | Multiplier | px |
|---|---|---|
| `--radius-sm` | 0.6× | 2.4px |
| `--radius-md` | 0.8× | 3.2px |
| `--radius-lg` (= `--radius`) | 1.0× | 4px (base) |
| `--radius-xl` | 1.4× | 5.6px |

## Known board quirks (carried from the original inventory)

- **`--text-dim` == `--text-muted`** (`#888888`) — board labels it "alias of muted."
- **Duplicate values:** `--bg-card` == `--bg-topbar` (`#161819`); `--bg-nav-btn` == `--bg-tab-idle` (`#1b2c3e`).
- **Count mismatches:** Semantic aliases header "19" vs 17 rows; Radius "5" vs 4 swatches (both explained above).
- **Not on the board (exists in code/DESIGN.md):** `--ff-display-condensed`; the `--secondary-foreground`/`--accent-foreground` aliases; the **added scales** (spacing base-4, `--radius-full`, border-width, shadows, full type scale, `--warning`); and the saturated-blue semantic roles (`--action*`, `--link*`, `--focus`, `--pin`/`--marker`, `--success`, `--error`).

## Source of truth

- **Canonical (current):** [`/DESIGN.md`](../DESIGN.md) and `web/src/app/globals.css` `:root`.
- **Visual:** Paper file "Design Tokens" → artboard `1-0` "globals.css — Design Tokens".
- **Topology:** `globals.css` primitives are the editable master → `--color-*` `@theme` mirror is generated → DESIGN.md is the doc → Paper is the visual surface (reconciled on demand).
