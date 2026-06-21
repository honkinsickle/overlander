import type { SlideCategoryKey } from "./places";
import type { Category } from "@/components/primitives/detail-card";

// Browse Location Card v2 — category metadata (labels + slide-key bridges).
// Per-role COLOR now lives in the canonical design tokens
// (`--cat-{name}-{role}` in web/src/app/globals.css; source of truth = the
// Paper "Category Type" artboard). Consumers read those tokens directly via
// `var(--cat-${category}-title|badge-bg|badge-border|cta-bg|cta-border)`.

/** Browse-card category === the canonical `Category` (9 members). The browse
 *  filter row now renders all 9 chips, so the type is the full `Category`, not
 *  a subset. Kept as a named alias so the browse layer reads intentionally. */
export type BrowseCardCategory = Category;

/** The 9 browse-filter chips, in the order the filter row renders them:
 *  outdoors first, then services, then the `interest` catch-all last. */
export const BROWSE_CARD_CATEGORIES: readonly BrowseCardCategory[] = [
  "camping",
  "scenic",
  "attraction",
  "oddity",
  "food",
  "fuel",
  "hotel",
  "urban",
  "interest",
];

export type BrowseCardPalette = {
  /** Uppercase label used in aria-labels and tooltips. */
  label: string;
};

export const browseCardPalette: Record<BrowseCardCategory, BrowseCardPalette> = {
  camping: { label: "CAMPING" },
  scenic: { label: "SCENIC" },
  attraction: { label: "ATTRACTION" },
  oddity: { label: "ODDITY" },
  food: { label: "FOOD" },
  fuel: { label: "FUEL" },
  hotel: { label: "HOTEL" },
  urban: { label: "URBAN" },
  interest: { label: "POINT OF INTEREST" },
};

/** Slide-fetch key → browse-card category. Isomorphic except `overnight` (the
 *  data-fetch key) ↔ `hotel` (the display category); all other 8 are identity. */
export function slideCategoryToBrowseCategory(
  key: SlideCategoryKey,
): BrowseCardCategory {
  if (key === "overnight") return "hotel";
  return key;
}

/** Inverse of `slideCategoryToBrowseCategory`: browse-card category → the
 *  slide-fetch key. Every chip now maps to a real slide key (`hotel →
 *  overnight`; all others identity), so this is total — no null. */
export function browseCategoryToSlide(
  c: BrowseCardCategory,
): SlideCategoryKey {
  if (c === "hotel") return "overnight";
  return c;
}
