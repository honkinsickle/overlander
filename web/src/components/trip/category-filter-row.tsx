"use client";

import {
  type BrowseCardCategory,
  BROWSE_CARD_CATEGORIES,
  browseCardPalette,
} from "@/lib/trip-browse/palette";
import { CategoryIconV2 } from "@/components/icons/category-icons-v2";

/**
 * The compact category icon row (the 7 broad chips: camping / urban / scenic /
 * food / fuel / hotel / oddity). Shared between the Add-Waypoints panel
 * (CategoryBrowsePanel) and the top-level Find Nearby results, so both render
 * the identical tiles, per-type colors, and selected state.
 *
 * Multi-select aware: `active` is the set of selected categories; CategoryBrowse
 * uses it multi-select, Find Nearby drives it single-select (a one-element set).
 * Non-active chips dim to 0.4 once anything is selected.
 */
export function CategoryFilterRow({
  active,
  onToggle,
}: {
  active: Set<BrowseCardCategory>;
  onToggle: (c: BrowseCardCategory) => void;
}) {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      role="toolbar"
      aria-label="Filter by category"
      style={{
        gap: 12,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 12,
        paddingBottom: 12,
        backgroundColor: "var(--bg-base)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {BROWSE_CARD_CATEGORIES.map((c) => {
        const palette = browseCardPalette[c];
        const isActive = active.has(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={isActive}
            aria-label={`Filter: ${palette.label}`}
            onClick={() => onToggle(c)}
            className="flex items-center justify-center transition-all"
            style={{
              width: 54,
              height: 54,
              borderRadius: 6,
              backgroundColor: `var(--cat-${c}-badge-bg)`,
              border: `1px solid var(--cat-${c}-badge-border)`,
              opacity: active.size === 0 || isActive ? 1 : 0.4,
              boxShadow: isActive ? `0 0 0 1px var(--cat-${c}-badge-border)` : "none",
            }}
          >
            <CategoryIconV2 category={c} size={28} />
          </button>
        );
      })}
    </div>
  );
}
