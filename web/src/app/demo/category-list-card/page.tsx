import { CategoryListCard } from "@/components/trip/category-list-card";
import type { BrowseCardCategory } from "@/lib/trip-browse/palette";

/**
 * Showcase for CategoryListCard — the 9 category variants of Paper
 * "Category 400 List-varaints" (`EBD-0`), stacked. Placeholder copy is the
 * board's; photos are omitted (the hero falls back to the category color) to
 * keep the demo free of image deps.
 */

type Variant = {
  category: BrowseCardCategory;
  title: string;
  status: string;
  rating: number;
  reviewCount: number;
};

const VARIANTS: Variant[] = [
  { category: "scenic", title: "Griffith Observatory & Mount Hollywood Trail", status: "Open · 6a–10p", rating: 4.7, reviewCount: 9300 },
  { category: "camping", title: "Kirk Creek Campground", status: "Open · 24h", rating: 4.8, reviewCount: 1800 },
  { category: "urban", title: "Pike Place Market", status: "Open · 9a–6p", rating: 4.6, reviewCount: 18400 },
  { category: "food", title: "Tartine Bakery", status: "Open · 8a–5p", rating: 4.5, reviewCount: 12200 },
  { category: "fuel", title: "Shell — Highway 1", status: "Open · 24h", rating: 4.1, reviewCount: 640 },
  { category: "hotel", title: "Timberline Lodge", status: "Open · 24h", rating: 4.7, reviewCount: 5200 },
  { category: "oddity", title: "Trees of Mystery", status: "Open · 9a–5p", rating: 4.4, reviewCount: 3100 },
  { category: "attraction", title: "Astoria Column", status: "Open · 8a–6p", rating: 4.6, reviewCount: 6400 },
  { category: "interest", title: "Roadside Viewpoint", status: "Open · 24h", rating: 4.2, reviewCount: 210 },
];

export default function CategoryListCardDemo() {
  return (
    <main
      className="min-h-screen flex flex-col items-center gap-4 py-10"
      style={{ backgroundColor: "var(--bg-panel)" }}
    >
      {VARIANTS.map((v) => (
        <CategoryListCard
          key={v.category}
          category={v.category}
          status={v.status}
          place={{
            title: v.title,
            photoAlt: v.title,
            rating: v.rating,
            reviewCount: v.reviewCount,
          }}
        />
      ))}
    </main>
  );
}
