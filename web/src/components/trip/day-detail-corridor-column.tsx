"use client";

import { TripDetailHeader } from "@/components/trip/trip-detail-header";
import {
  DayDetailCorridor,
  type CorridorPlace,
} from "@/components/trip/day-detail-corridor";
import type { CorridorCity, Day, Trip } from "@/lib/trips/types";

/**
 * Slideup center column for the corridor integration (Phase 1) —
 * replaces the old all-days-stacked DayDetail with a SINGLE-DAY model:
 *
 *   selectedDayId === null → Overview state: the trip-level hero
 *     (TripDetailHeader), which previously sat at the top of DayDetail's
 *     scroll, lives here now.
 *   selectedDayId → that day's DayDetailCorridor (v4), fed real
 *     Day.corridorCities with the spec-§4 degraded two-node fallback for
 *     trips finalized before the corridor engine.
 *
 * Display-only in Phase 1: v4's interactions stay stubbed; editing +
 * recompute surfacing is Phase 3.
 */
export function DayDetailCorridorColumn({
  trip,
  selectedDayId,
}: {
  trip: Trip;
  selectedDayId: string | null;
}) {
  const day = selectedDayId
    ? trip.days.find((d) => d.id === selectedDayId)
    : undefined;

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      {day ? (
        <DayDetailCorridor
          dayLabel={`Day ${day.dayNumber} — ${formatDayDate(day.date)}`}
          dayNumber={day.dayNumber}
          routeLabel={day.label}
          heroImageUrl={day.heroImage}
          heroAlt={day.label}
          cities={day.corridorCities ?? fallbackCorridor(day)}
          places={placePool(day)}
        />
      ) : (
        <TripDetailHeader trip={trip} />
      )}
    </div>
  );
}

/** "2026-05-30" → "Sat, May 30th" (matches the v4 board's day label). */
function formatDayDate(iso: string): string {
  const at = new Date(`${iso}T00:00:00`);
  const weekday = at.toLocaleDateString("en-US", { weekday: "short" });
  const month = at.toLocaleDateString("en-US", { month: "long" });
  const d = at.getDate();
  const suffix =
    d % 10 === 1 && d !== 11
      ? "st"
      : d % 10 === 2 && d !== 12
        ? "nd"
        : d % 10 === 3 && d !== 13
          ? "rd"
          : "th";
  return `${weekday}, ${month} ${d}${suffix}`;
}

/** Spec §4 degraded corridor for days without corridorCities (trips
 *  finalized before the engine, or a cleared post-edit corridor):
 *  Start (label first half, 0 mi) → End (label last half, Day.miles).
 *  No tiles — bucketing needs geometry the client doesn't have. */
function fallbackCorridor(day: Day): CorridorCity[] {
  const parts = day.label.split(" — ");
  const startName = parts[0] || day.label;
  const endName = parts.length > 1 ? parts[parts.length - 1] : day.label;
  const start: CorridorCity = {
    id: `${day.id}-start`,
    name: startName,
    kind: "start",
    coords: day.startCoord ?? day.coords ?? [0, 0],
    milesFromStart: 0,
    placeIds: [],
  };
  if (parts.length < 2 && day.miles === undefined) return [start];
  return [
    start,
    {
      id: `${day.id}-end`,
      name: endName,
      kind: "end",
      coords: day.coords ?? start.coords,
      milesFromStart: day.miles ?? 0,
      placeIds: [],
    },
  ];
}

/** Resolve the day's place pool (spec §1.4: segmentSuggestions ∪
 *  waypoints) into the tile shape v4 renders. BrowsePlace maps by
 *  field-pick; Waypoint shims photoAlt from its title and lifts
 *  rating/reviewCount out of `community`. The one category-union
 *  mismatch: BrowsePlace's "overnight" slide key has no card palette —
 *  render those tiles with the camping treatment. */
function placePool(day: Day): CorridorPlace[] {
  const fromSuggestions: CorridorPlace[] = (day.segmentSuggestions ?? []).map(
    (p) => ({
      id: p.id,
      title: p.title,
      category:
        p.category === "overnight" ? "camping" : (p.category ?? "interest"),
      photoUrl: p.photoUrl,
      photoAlt: p.photoAlt,
      rating: p.rating,
      reviewCount: p.reviewCount,
    }),
  );
  const fromWaypoints: CorridorPlace[] = day.waypoints.map((wp) => ({
    id: wp.id,
    title: wp.title,
    category: wp.category,
    photoUrl: wp.photoUrl,
    photoAlt: wp.title,
    rating: wp.community?.rating,
    reviewCount: wp.community?.reviewCount,
  }));
  return [...fromSuggestions, ...fromWaypoints];
}
