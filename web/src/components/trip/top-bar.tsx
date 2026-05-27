"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Floating header chip for the map-as-background slideup. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md §3 + §5) plus the Search
 * Active state (Paper frame 5WK-0).
 *
 * Default: anchored top-left at (10, 12), top-rounded, bottom-border.
 * Collapsed: docks to bottom-left at (10, bottom-12) — top-radii kept
 * per spec §5 note (radii-swap at bottom is unspecified).
 *
 * Contents (left → right):
 *   - Title + dates stacked over amber metadata row (hidden when search
 *     expanded)
 *   - Inline search input (expands leftward over the title slot on focus
 *     or when it holds text; collapses on blur with empty value)
 *   - Right-edge button: ChevronDown/Up while search collapsed (toggles
 *     slideup Collapsed state); morphs to ✕ while search expanded
 *     (exits search — clears, blurs, closes Find Nearby panel).
 *
 * Width budget (660 total):
 *   - Right-edge button: 53 (anchored right:0)
 *   - Search container: anchored right:61 (= chevron 53 + margin 8);
 *     left transitions 351 (collapsed) → 18 (expanded, flush with the
 *     panel's left padding).
 *   - Title block: left:18 right:309 (= 660 − 351). Opacity transitions
 *     0/1 when search expands; pointer-events drop when hidden.
 */
export function TopBar({
  trip,
  collapsed = false,
  onToggleCollapsed,
  onOpenSearch,
  onCloseSearch,
}: {
  trip: Trip;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Fired when the search input gains focus. Slideup body uses this to
   *  mount the Find Nearby panel. */
  onOpenSearch?: () => void;
  /** Fired when the user explicitly exits search via the right-edge ✕
   *  (clears + blurs + closes Find Nearby). Escape also clears + blurs
   *  the input but does NOT call this — the slideup body has its own
   *  keydown listener that closes the panel on Escape. */
  onCloseSearch?: () => void;
}) {
  const totalMiles = trip.days.reduce((sum, d) => sum + (d.miles ?? 0), 0);
  const dateRange = formatDateRange(trip.startDate, trip.endDate);
  const ChevronIcon = collapsed ? ChevronUp : ChevronDown;

  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const expanded = focused || value.length > 0;

  const exitSearch = () => {
    setValue("");
    setFocused(false);
    // Blur any focused element inside the top bar (i.e. the input)
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    onCloseSearch?.();
  };

  return (
    <div
      className={`absolute ${collapsed ? "bottom-3" : "top-3"} left-[10px] z-30 w-[660px] h-[60px] rounded-tl-[15px] rounded-tr-[15px] overflow-hidden`}
      style={{
        background: "#162029",
        borderBottom: collapsed ? undefined : "1px solid rgba(255,255,255,0.14)",
        borderTop: collapsed ? "1px solid rgba(255,255,255,0.14)" : undefined,
      }}
    >
      {/* Title (line 1) + dates · days · miles meta (line 2).
       *  Hidden (opacity 0 + pointer-events: none) while search expanded.
       *  Stays in absolute layout so its space is preserved. */}
      <div
        aria-hidden={expanded}
        className="absolute top-0 bottom-0 left-[18px] flex flex-col justify-center min-w-0 transition-opacity duration-200 ease-out motion-reduce:transition-none"
        style={{
          right: 309,
          opacity: expanded ? 0 : 1,
          pointerEvents: expanded ? "none" : "auto",
        }}
      >
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

      {/* Inline search input — absolute, anchored right:61 (clears the
       *  chevron + its left margin). `left` transitions 351 → 18 to
       *  expand leftward over the title slot. */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-[44px] transition-[left] duration-200 ease-out motion-reduce:transition-none"
        style={{
          right: 61,
          left: expanded ? 8 : 351,
        }}
      >
        <label
          className={`flex items-center gap-2 h-full px-3 rounded-md rounded-tl-[8px] transition-colors ${
            expanded ? "bg-white/[0.06]" : "bg-white/[0.04] hover:bg-white/[0.06]"
          }`}
          style={{
            outline: expanded ? "1px solid rgba(255,255,255,0.16)" : "none",
            outlineOffset: 0,
          }}
        >
          <Search
            className={`w-[14px] h-[14px] shrink-0 ${expanded ? "text-white" : "text-[#6381A8]"}`}
          />
          <input
            type="text"
            value={value}
            placeholder="Search for anything"
            aria-label="Search"
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onOpenSearch?.();
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setValue("");
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={`flex-1 min-w-0 bg-transparent border-0 outline-none font-sans text-[14px] text-white ${expanded ? "placeholder:text-white" : "placeholder:text-[#B3B3B3]"}`}
          />
          {value.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => {
                // Prevent the input from blurring before our click handler.
                e.preventDefault();
              }}
              onClick={() => setValue("")}
              className="shrink-0 flex items-center justify-center w-[20px] h-[20px] text-[#888888] hover:text-[#E9E9E7] transition-colors"
            >
              <X className="w-[14px] h-[14px]" strokeWidth={2} />
            </button>
          )}
        </label>
      </div>

      {/* Right-edge button — dual role:
       *  - Search collapsed: ChevronDown/Up toggles slideup Collapsed state.
       *  - Search expanded:  ✕ exits search (clear + blur + close panel). */}
      <button
        type="button"
        aria-label={
          expanded
            ? "Exit search"
            : collapsed
              ? "Expand"
              : "Collapse"
        }
        aria-pressed={expanded ? undefined : collapsed}
        onClick={expanded ? exitSearch : onToggleCollapsed}
        className="absolute top-0 right-0 flex items-center justify-center w-[53px] h-full border-l border-white/[0.05] text-[#888888] hover:text-[#E9E9E7] transition-colors"
      >
        {expanded ? (
          <X className="w-5 h-5" strokeWidth={1.75} />
        ) : (
          <ChevronIcon className="w-5 h-5" strokeWidth={1.75} />
        )}
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
