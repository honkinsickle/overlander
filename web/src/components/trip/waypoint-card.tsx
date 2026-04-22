import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { categoryStyle } from "@/components/primitives/detail-card";
import type { Waypoint } from "@/lib/trips/types";

/**
 * Compact waypoint row for the itinerary stack.
 * Clicking navigates to the trip with `?panel=waypoint&id=<slug>`,
 * which the map column watches to open a DetailCard.
 */
export function WaypointCard({
  tripId,
  waypoint,
}: {
  tripId: string;
  waypoint: Waypoint;
}) {
  const cat = categoryStyle[waypoint.category];
  const initial = waypoint.title.charAt(0).toUpperCase();
  const categoryLabel =
    cat.label.charAt(0) + cat.label.slice(1).toLowerCase();
  // Pull the first segment of the subtitle ("Day 1 · 165 mi from LA" → "Day 1").
  const primaryContext = waypoint.subtitle.split("·")[0]?.trim() ?? "";

  return (
    <Link
      href={`/trip/${tripId}?panel=waypoint&id=${waypoint.slug}`}
      scroll={false}
      className="flex items-center gap-3 p-3 bg-bg-card border border-border-subtle rounded hover:border-border-mid"
    >
      <div
        className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center"
        style={{ backgroundColor: cat.bg }}
      >
        <span
          className="font-sans font-bold text-sm"
          style={{ color: cat.accent }}
        >
          {initial}
        </span>
      </div>
      <div className="flex-1 flex flex-col">
        <span
          className="font-sans font-bold text-base"
          style={{ color: cat.accent }}
        >
          {waypoint.title}
        </span>
        <span className="text-xs text-text-muted">
          {categoryLabel}
          {primaryContext ? ` · ${primaryContext}` : ""}
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-input-border-focus shrink-0" />
    </Link>
  );
}
