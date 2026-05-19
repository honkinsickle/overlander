import type { SlideCategoryKey } from "./places";

// Browse Location Card v2 palette — Paper-aligned tokens for the new
// card chrome (artboards "Location Card · 300w / 354w · category
// variants (v2)", page "Browse Slide In"). Source of truth in Paper;
// hex values copied via get_computed_styles.

export type BrowseCardCategory =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity";

export type BrowseCardPalette = {
  titleColor: string;
  badgeBg: string;
  badgeBorder: string;
  ctaBg: string;
  ctaBorder: string;
  /** Uppercase label used in aria-labels and tooltips. */
  label: string;
};

export const browseCardPalette: Record<BrowseCardCategory, BrowseCardPalette> = {
  camping: {
    titleColor: "#6ECECE",
    badgeBg: "#0F2E1F",
    badgeBorder: "#4D9A6E",
    ctaBg: "#304C4B",
    ctaBorder: "#6ECECE",
    label: "CAMPING",
  },
  urban: {
    titleColor: "#E8CF4D",
    badgeBg: "#3A2F14",
    badgeBorder: "#E5BD3D",
    ctaBg: "#67562A",
    ctaBorder: "#E8CF4D",
    label: "URBAN",
  },
  scenic: {
    titleColor: "#A6C9F9",
    badgeBg: "#24354F",
    badgeBorder: "#A6C9F9",
    ctaBg: "#24354F",
    ctaBorder: "#A6C9F9",
    label: "SCENIC",
  },
  food: {
    titleColor: "#F38666",
    badgeBg: "#773D2C",
    badgeBorder: "#F38666",
    ctaBg: "#773D2C",
    ctaBorder: "#F38666",
    label: "FOOD",
  },
  fuel: {
    titleColor: "#FA9D9D",
    badgeBg: "#2E1414",
    badgeBorder: "#E26F6F",
    ctaBg: "#4E252F",
    ctaBorder: "#FA9D9D",
    label: "FUEL",
  },
  hotel: {
    titleColor: "#6ECECE",
    badgeBg: "#304C4B",
    badgeBorder: "#6ECECE",
    ctaBg: "#304C4B",
    ctaBorder: "#6ECECE",
    label: "HOTEL",
  },
  oddity: {
    titleColor: "#BC97F0",
    badgeBg: "#2A1A3E",
    badgeBorder: "#B589F0",
    ctaBg: "#2D2039",
    ctaBorder: "#BC97EF",
    label: "ODDITY",
  },
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
