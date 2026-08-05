"use client";

import {
  BROWSE_CARD_CATEGORIES,
  browseCardPalette,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";

/**
 * ⚠️ TEMPORARY TEST HARNESS — NOT a proposed UI surface. ⚠️
 *
 * Nine plain checkboxes to exercise the two-layer map's category filters on real
 * trips without ceremony. Deliberately unstyled beyond the minimum. The real
 * category-filter UX is a separate decision; delete this component (and its mount
 * in `map-column.tsx`) when that lands. See the two-layer category map PR.
 */
export function PlaceCategoryToggles({
  enabled,
  onToggle,
}: {
  enabled: Set<BrowseCardCategory>;
  onToggle: (cat: BrowseCardCategory) => void;
}) {
  return (
    <div
      // Intentionally raw inline styles — this is throwaway test chrome.
      style={{
        // Center-top of the map: the itinerary panel overlays the left ~half,
        // so top-left is occluded. This is throwaway harness placement.
        position: "absolute",
        top: 8,
        left: "50%",
        zIndex: 20,
        background: "rgba(10,11,12,0.85)",
        border: "1px solid #444",
        borderRadius: 4,
        padding: "6px 8px",
        font: "11px/1.5 monospace",
        color: "#eee",
        maxWidth: 150,
      }}
      aria-label="Category filter test harness"
    >
      <div style={{ opacity: 0.6, marginBottom: 4 }}>filters (temp)</div>
      {BROWSE_CARD_CATEGORIES.map((cat) => (
        <label
          key={cat}
          style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={enabled.has(cat)}
            onChange={() => onToggle(cat)}
          />
          {browseCardPalette[cat].label.toLowerCase()}
        </label>
      ))}
    </div>
  );
}
