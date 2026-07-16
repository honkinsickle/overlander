# BrowseCardCategory — type reference

> Reference for the `BrowseCardCategory` union and its per-category palette.
> **Source of truth:** `web/src/lib/trip-browse/palette.ts` (hex values copied from Paper).
> **Visual reference:** Paper file "Design Tokens" → artboard *"BrowseCardCategory — type reference"* (`1C7-0`).
> Mirrors the Browse Location Card v2 chrome (Paper page "Browse Slide In", artboards "Location Card · 300w / 354w · category variants (v2)").

## The type

```ts
// web/src/lib/trip-browse/palette.ts
export type BrowseCardCategory =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity";
```

A string union of **7 members**. Each member maps to a `BrowseCardPalette` (5 colors + an uppercase label) used to skin a browse/location card: the title text, the category badge (bg + border), and the "Add to day" CTA (bg + border).

```ts
export type BrowseCardPalette = {
  titleColor: string;   // place-name title text
  badgeBg: string;      // category icon badge fill
  badgeBorder: string;  // category icon badge border
  ctaBg: string;        // "Add to Day N" button fill
  ctaBorder: string;    // "Add to Day N" button border
  label: string;        // UPPERCASE label for aria-labels / tooltips
};
```

## Members & palette

| Member | Icon | TITLE (`titleColor`) | BADGEBG (`badgeBg`) | BADGEBORDER (`badgeBorder`) | CTABG (`ctaBg`) | CTABORDER (`ctaBorder`) | Label | Sample status |
|---|---|---|---|---|---|---|---|---|
| `"camping"` | tent | `#6ECECE` | `#0F2E1F` | `#4D9A6E` | `#304C4B` | `#6ECECE` | `CAMPING` | Reserved · $25/night |
| `"urban"` | buildings | `#E8CF4D` | `#3A2F14` | `#E5BD3D` | `#67562A` | `#E8CF4D` | `URBAN` | Open · 9a–11p |
| `"scenic"` | mountain | `#A6C9F9` | `#24354F` | `#A6C9F9` | `#24354F` | `#A6C9F9` | `SCENIC` | Open · 8a–7p |
| `"food"` | burger | `#F38666` | `#773D2C` | `#F38666` | `#773D2C` | `#F38666` | `FOOD` | Open · 7a–10p |
| `"fuel"` | pump | `#FA9D9D` | `#2E1414` | `#E26F6F` | `#4E252F` | `#FA9D9D` | `FUEL` | Open · 24/7 |
| `"hotel"` | bed | `#6ECECE` | `#304C4B` | `#6ECECE` | `#304C4B` | `#6ECECE` | `HOTEL` | Check in · 3 PM |
| `"oddity"` | eye | `#BC97F0` | `#2A1A3E` | `#B589F0` | `#2D2039` | `#BC97EF` | `ODDITY` | Open · 9a–5p |

Notes on the palette shape:
- **`scenic`** and **`food`** reuse the same hex for `badgeBg`/`ctaBg` and for `titleColor`/`badgeBorder`/`ctaBorder` (flat, single-tone treatment).
- **`hotel`** intentionally shares `camping`'s teal family (it's the overnight/bed variant).
- **`oddity`** is the only one whose `titleColor` (`#BC97F0`) and `ctaBorder` (`#BC97EF`) differ by one byte — both light purple.
- These are **raw hex, copied from Paper** — they are *not* the canonical `--cat-*` design tokens in `globals.css` (the two palettes overlap in places but are maintained separately; this one is the v2 browse-card chrome).

## Chip render order

```ts
export const BROWSE_CARD_CATEGORIES: readonly BrowseCardCategory[] = [
  "camping", "urban", "scenic", "food", "fuel", "hotel", "oddity",
];
```

The order the Paper filter row renders the 7 chips (top-to-bottom in the reference table).

## Slide-key ↔ category mapping

`BrowseCardCategory` is the **presentation** layer. The **data** layer uses `SlideCategoryKey` (`./places`). Two helpers bridge them:

```ts
// SlideCategoryKey → BrowseCardCategory
slideCategoryToBrowseCategory(key)
//   "overnight" → "hotel"
//   else        → identity

// BrowseCardCategory → SlideCategoryKey | null
browseCategoryToSlide(c)
//   "hotel" → "overnight"
//   "urban" → null   (no backing data today — can't be fetched)
//   else    → identity
```

Key implications:
- **`hotel`** is a presentation alias for the `overnight` data category (bed icon).
- **`urban`** has **no backing data** — `browseCategoryToSlide("urban")` returns `null`, so it renders as a chip/skin but the API can't fetch results for it yet.
- Every other member round-trips as identity.

## Where it's used

`BrowseCardCategory` / `browseCardPalette` are consumed by:
`location-browse-card.tsx`, `category-filter-row.tsx`, `category-browse-panel.tsx`, `place-search.tsx`, `find-nearby-panel.tsx`, `suggested-section.tsx`.
