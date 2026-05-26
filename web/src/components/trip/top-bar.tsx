"use client";

import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Floating header chip for the map-as-background slideup. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md §3 + §5).
 *
 * Default: anchored top-left at (10, 12), top-rounded, bottom-border.
 * Collapsed: docks to bottom-left at (10, bottom-12) — top-radii kept
 * per spec §5 note (radii-swap at bottom is unspecified).
 *
 * Contents (left → right):
 *   - Title + dates stacked over amber metadata row
 *   - Inline search input
 *   - Chevron (ChevronDown in Default → collapse; ChevronUp in Collapsed → expand)
 */
export function TopBar({
  trip,
  collapsed = false,
  onToggleCollapsed,
}: {
  trip: Trip;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const totalMiles = trip.days.reduce((sum, d) => sum + (d.miles ?? 0), 0);
  const dateRange = formatDateRange(trip.startDate, trip.endDate);
  const ChevronIcon = collapsed ? ChevronUp : ChevronDown;

  return (
    <div
      className={`absolute ${collapsed ? "bottom-3" : "top-3"} left-[10px] z-30 flex items-stretch w-[660px] h-[60px] rounded-tl-[15px] rounded-tr-[15px] overflow-hidden`}
      style={{
        background: "#162029",
        borderBottom: collapsed ? undefined : "1px solid rgba(255,255,255,0.14)",
        borderTop: collapsed ? "1px solid rgba(255,255,255,0.14)" : undefined,
      }}
    >
      {/* Title (line 1) + dates · days · miles meta (line 2) */}
      <div className="flex flex-col justify-center flex-1 min-w-0 pl-[18px] pr-3">
        <span className="font-sans text-[18px] leading-[22px] font-semibold text-[#E9E9E7] truncate">
          {trip.title}
        </span>
        <div
          className="font-sans text-[13px] leading-[18px] font-light text-amber shrink-0"
          style={{ letterSpacing: "0.06em" }}
        >
          {dateRange} • {trip.days.length} Days •{" "}
          {totalMiles.toLocaleString()} mi
        </div>
      </div>

      {/* Inline search input — right side */}
      <button
        type="button"
        aria-label="Search"
        className="flex items-center gap-2 self-center mr-2 h-[44px] w-[248px] px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
      >
        <Search className="w-[14px] h-[14px] text-[#6381A8] shrink-0" />
        <span className="font-sans text-[14px] text-[#B3B3B3] truncate">
          Search for anything
        </span>
      </button>

      {/* Chevron — toggles Collapsed */}
      <button
        type="button"
        aria-label={collapsed ? "Expand" : "Collapse"}
        aria-pressed={collapsed}
        onClick={onToggleCollapsed}
        className="flex items-center justify-center w-[53px] h-full border-l border-white/[0.05] text-[#888888] hover:text-[#E9E9E7] transition-colors"
      >
        <ChevronIcon className="w-5 h-5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function formatDateRange(startISO: string, endISO: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  return `${fmt(startISO)}-${fmt(endISO)}`;
}
