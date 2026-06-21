import type { SlideCategoryKey } from "./places";
import type { Category } from "@/components/primitives/detail-card";

// Browse Location Card v2 — category metadata (labels + slide-key bridges).
// Per-role COLOR now lives in the canonical design tokens
// (`--cat-{name}-{role}` in web/src/app/globals.css; source of truth = the
// Paper "Category Type" artboard). Consumers read those tokens directly via
// `var(--cat-${category}-title|badge-bg|badge-border|cta-bg|cta-border)`.

/** The 7 browse-filter chips, in the order the Paper filter row renders them.
 *  `as const satisfies readonly Category[]` makes this the single source of
 *  truth for `BrowseCardCategory` while proving every chip is a real
 *  `Category`. Deliberately a SUBSET — excludes `attraction`/`interest`
 *  (waypoint-only) and is the only place `hotel` surfaces as a chip. */
export const BROWSE_CARD_CATEGORIES = [
  "camping",
  "urban",
  "scenic",
  "food",
  "fuel",
  "hotel",
  "oddity",
] as const satisfies readonly Category[];

/** Browse-card category — the 7-member subset of the canonical `Category`,
 *  derived from `BROWSE_CARD_CATEGORIES`. */
export type BrowseCardCategory = (typeof BROWSE_CARD_CATEGORIES)[number];

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
