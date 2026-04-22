import { TreePine, Star, Landmark } from "lucide-react";
import type { Category } from "@/components/primitives/detail-card";

/**
 * Interests taxonomy.
 *
 * 3 Paper-faithful categories, 10 chips total. Each category's `category`
 * field maps to our `--cat-*` token palette so the category icon +
 * selected-chip accent use the existing color system.
 *
 * Chip ids are URL-safe and stable — saved in `draft.interests.selectedChipIds`.
 */

export type InterestChip = {
  id: string;
  label: string;
};

export type InterestCategory = {
  id: string;
  title: string;
  subtitle: string;
  /** Maps to --cat-* token for the category tint. */
  category: Category;
  icon: React.ComponentType<{ className?: string }>;
  chips: InterestChip[];
};

export const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    id: "nature",
    title: "Nature & Parks",
    subtitle: "Protected wilderness, trails, viewpoints",
    category: "mountain",
    icon: TreePine,
    chips: [
      { id: "national-parks",      label: "National Parks" },
      { id: "state-parks",         label: "State Parks" },
      { id: "nature-reserves",     label: "Nature Reserves" },
      { id: "geographic-features", label: "Geographic Features" },
    ],
  },
  {
    id: "attractions",
    title: "Attractions",
    subtitle: "Roadside classics, landmarks, curiosities",
    category: "attraction",
    icon: Star,
    chips: [
      { id: "roadside-attractions", label: "Roadside Attractions" },
      { id: "scenic-points",        label: "Scenic Points" },
      { id: "historic-sites",       label: "Historic Sites" },
    ],
  },
  {
    id: "culture",
    title: "Culture",
    subtitle: "Museums, architecture, local heritage",
    category: "oddity",
    icon: Landmark,
    chips: [
      { id: "museums",           label: "Museums" },
      { id: "architecture",      label: "Architecture" },
      { id: "filming-locations", label: "Filming Locations" },
    ],
  },
];

/** Flat array of every valid chip id — used for validation on save. */
export const ALL_CHIP_IDS: ReadonlySet<string> = new Set(
  INTEREST_CATEGORIES.flatMap((c) => c.chips.map((ch) => ch.id)),
);

export function chipsForCategory(categoryId: string): InterestChip[] {
  return INTEREST_CATEGORIES.find((c) => c.id === categoryId)?.chips ?? [];
}
