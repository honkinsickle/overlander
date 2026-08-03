"use client";

import { BottomSheet } from "@/components/primitives/bottom-sheet";
import type { SplitCandidate, SplitPoint } from "@/lib/trips/split-day";

/**
 * Split-point picker — a BottomSheet listing a day's own stops as the places it
 * can be cut at, each with roughly where along the day it falls. Chosen over a
 * kebab submenu because the list is variable (3–30 stops) and the choice needs
 * room for the stop name + position. Mirrors the existing overnight picker
 * (overnight-section.tsx): a sheet of rows where clicking a row selects it.
 *
 * Presentational + controlled — open state and the split write live in the caller
 * (DayDetailCorridorColumn). Only opened for eligible days, so `candidates` is
 * always non-empty here (splitEligibility gates the kebab item).
 */
export function SplitPointPicker({
  open,
  onOpenChange,
  dayLabel,
  dayMiles,
  candidates,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Day 3 — Los Angeles, CA — Las Vegas, NV" — names the day being split. */
  dayLabel: string;
  /** The day's start→end length, for the "of N mi" context. */
  dayMiles: number;
  candidates: SplitCandidate[];
  onPick: (point: SplitPoint) => void;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Split this day"
      subtitle={dayLabel}
    >
      <div className="flex flex-col px-3 pb-4">
        {candidates.map((c) => (
          <button
            key={`${c.point.coords[0]},${c.point.coords[1]}`}
            type="button"
            onClick={() => onPick(c.point)}
            className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded text-left hover:bg-bg-card border-b border-border-subtle last:border-b-0"
          >
            <span className="font-sans text-sm text-text-primary truncate">
              {c.point.name}
            </span>
            <span className="font-mono text-xs text-text-muted shrink-0">
              ≈ {c.atMile} of {dayMiles} mi
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
