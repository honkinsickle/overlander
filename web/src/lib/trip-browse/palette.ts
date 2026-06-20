import type { SlideCategoryKey } from "./places";

// Browse Location Card v2 — category metadata (labels + slide-key bridges).
// Per-role COLOR now lives in the canonical design tokens
// (`--cat-{name}-{role}` in web/src/app/globals.css; source of truth = the
// Paper "Category Type" artboard). Consumers read those tokens directly via
// `var(--cat-${category}-title|badge-bg|badge-border|cta-bg|cta-border)`.

export type BrowseCardCategory =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity";

export type BrowseCardPalette = {
  /** Uppercase label used in aria-labels and tooltips. */
  label: string;
};

export const browseCardPalette: Record<BrowseCardCategory, BrowseCardPalette> = {
  camping: { label: "CAMPING" },
  urban: { label: "URBAN" },
  scenic: { label: "SCENIC" },
  food: { label: "FOOD" },
  fuel: { label: "FUEL" },
  hotel: { label: "HOTEL" },
  oddity: { label: "ODDITY" },
};

/** `overnight` slide-category key maps to `hotel` palette (bed icon). */
export function slideCategoryToBrowseCategory(
  key: SlideCategoryKey,
): BrowseCardCategory {
  if (key === "overnight") return "hotel";
  return key;
}

/** Inverse of `slideCategoryToBrowseCategory`. Returns the data-layer key
 *  the API can actually fetch; `urban` has no backing today so returns
 *  null. */
export function browseCategoryToSlide(
  c: BrowseCardCategory,
): SlideCategoryKey | null {
  if (c === "hotel") return "overnight";
  if (c === "urban") return null;
  return c;
}

/** The 7 chips, in the order the Paper filter row renders them. */
export const BROWSE_CARD_CATEGORIES: readonly BrowseCardCategory[] = [
  "camping",
  "urban",
  "scenic",
  "food",
  "fuel",
  "hotel",
  "oddity",
];
