"use client";

import { ChevronDown, Search } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Floating header chip for the map-as-background slideup. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md §3 — Default state).
 *
 * Position: anchored top-left at (10, 12), `660 × 60`.
 * Background: opaque #162029 with 15px top corners + 1px white-24% bottom border.
 *
 * Contents (left → right):
 *   - Title + dates stacked over amber metadata row
 *   - Inline search input
 *   - Down-arrow (toggle Collapsed — not wired this round)
 *   - Kebab (opens OfflinePanel for user trips via `trip:openOfflinePanel`)
 */
export function TopBar({ trip }: { trip: Trip }) {
  const totalMiles = trip.days.reduce((sum, d) => sum + (d.miles ?? 0), 0);
  const overnights = trip.days.filter((d) => d.overnight !== undefined).length;
  const dateRange = formatDateRange(trip.startDate, trip.endDate);

  return (
    <div
      className="absolute top-3 left-[10px] z-30 flex items-stretch w-[660px] h-[60px] rounded-tl-[15px] rounded-tr-[15px] overflow-hidden"
      style={{
        background: "#162029",
        borderBottom: "1px solid rgba(255,255,255,0.14)",
      }}
    >
      {/* Title + dates + metadata (left, flex-1) */}
      <div className="flex flex-col justify-center flex-1 min-w-0 pl-[18px] pr-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-sans text-[18px] leading-[22px] font-semibold text-[#E9E9E7] truncate">
            {trip.title}:
          </span>
          <span
            className="font-sans text-[18px] leading-[22px] font-light text-[#E9E9E7] shrink-0"
            style={{ letterSpacing: "0.06em" }}
          >
            {dateRange}
          </span>
        </div>
        <div
          className="font-sans text-[13px] leading-[18px] font-light text-amber shrink-0"
          style={{ letterSpacing: "0.06em" }}
        >
          {trip.days.length} Days • {totalMiles.toLocaleString()} mi •{" "}
          {overnights} {overnights === 1 ? "Overnight" : "Overnights"}
        </div>
      </div>

      {/* Inline search input — right side */}
      <button
        type="button"
        aria-label="Search"
        className="flex items-center gap-2 self-center mr-2 h-[44px] w-[216px] px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
      >
        <Search className="w-[14px] h-[14px] text-[#6381A8] shrink-0" />
        <span className="font-sans text-[14px] text-[#B3B3B3] truncate">
          Search for anything
        </span>
      </button>

      {/* Down-arrow — toggles Collapsed (not wired this round) */}
      <button
        type="button"
        aria-label="Collapse"
        disabled
        className="flex items-center justify-center w-[53px] h-full border-l border-white/[0.05] opacity-50"
      >
        <ChevronDown
          className="w-5 h-5 text-[#888888]"
          strokeWidth={1.75}
        />
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
