import type { SlideCategoryKey } from "./places";

// Browse Location Card palette — Paper-aligned colors for the new card
// chrome (artboard 1PZX-0, page "Browse Slide In"). Keyed by a local
// category name that mirrors Paper's category set, decoupled from
// `SlideCategoryKey` so the existing browse/discovery code that uses
// `Record<SlideCategoryKey, X>` doesn't break when we add new buckets
// (Hotel, Urban) here ahead of the data layer catching up.

export type BrowseCardCategory =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity";

export type BrowseCardPalette = {
  /** Solid bg behind the circular category icon badge on the hero. */
  iconBg: string;
  /** Border + stroke color for the icon badge. Also used for the
   *  uppercase CATEGORY label on the hero. */
  accent: string;
  /** Lighter shade of the accent, used for the card title in the body. */
  titleLight: string;
  /** Uppercase label rendered on the hero next to the icon. */
  label: string;
};

export const browseCardPalette: Record<BrowseCardCategory, BrowseCardPalette> = {
  camping: {
    iconBg: "#0F2E1F",
    accent: "#4D9A6E",
    titleLight: "#B5E0C5",
    label: "CAMPING",
  },
  urban: {
    iconBg: "#3A2F14",
    accent: "#E5BD3D",
    titleLight: "#F2E0A0",
    label: "URBAN",
  },
  scenic: {
    iconBg: "#163E3A",
    accent: "#5DD4C5",
    titleLight: "#B5EBE3",
    label: "SCENIC",
  },
  food: {
    iconBg: "#3E2A14",
    accent: "#F4C95D",
    titleLight: "#F4DAA0",
    label: "FOOD",
  },
  fuel: {
    iconBg: "#2E1414",
    accent: "#E26F6F",
    titleLight: "#F0B5B5",
    label: "FUEL",
  },
  // Hotel shares Camping's green per the design system — both are
  // overnight-bucket categories; the icon disambiguates (bed vs tent).
  hotel: {
    iconBg: "#0F2E1F",
    accent: "#4D9A6E",
    titleLight: "#B5E0C5",
    label: "HOTEL",
  },
  oddity: {
    iconBg: "#2A1A3E",
    accent: "#B589F0",
    titleLight: "#D8C4F8",
    label: "ODDITY",
  },
};

/** Translates a `SlideCategoryKey` into a `BrowseCardCategory`. The
 *  data layer still uses the older key set (incl. `overnight`); cards
 *  resolve to a Paper palette via this map. `overnight` maps to
 *  `hotel` since the design uses hotel/bed as the overnight icon. */
export function slideCategoryToBrowseCategory(
  key: SlideCategoryKey,
): BrowseCardCategory {
  if (key === "overnight") return "hotel";
  return key;
}
