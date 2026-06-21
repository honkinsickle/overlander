"use client";

import type { Day } from "@/lib/trips/types";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import { SuggestionCardV2 } from "@/components/trip/suggestion-card-v2";

/**
 * Phase D #1 "Browse the day" section.
 *
 * Consumes the per-day `segmentSuggestions` already baked at finalize
 * (no live fetch). Groups by SlideCategoryKey and renders a 2-up grid
 * of v2 cards per category. Cards dispatch the same `trip:toggleAdded`
 * and `trip:openDetail` / `trip:flyTo` events the existing browse path
 * already listens for, so adding a place from here drops it into the
 * day's waypoint list and opens the detail panel over the map.
 *
 * Surface decision per brief §13: this lives inside each day's content
 * in DayDetail — not its own drawer or panel.
 */

// Render order across categories. Mood-anchored: scenic first (the
// reason most people road-trip), then food, then sleep, then oddities.
const CATEGORY_ORDER: SlideCategoryKey[] = [
  "scenic",
  "food",
  "camping",
  "oddity",
];

// Per-category section header copy.
const SECTION_LABEL: Record<SlideCategoryKey, string> = {
  scenic: "Sights & Landmarks",
  food: "Food",
  camping: "Camping & Overnights",
  overnight: "Overnights",
  oddity: "Oddities",
  fuel: "Fuel",
  attraction: "Attractions",
  interest: "Points of Interest",
  urban: "Urban",
};

const SECTION_EMOJI: Record<SlideCategoryKey, string> = {
  scenic: "🏔️",
  food: "🍔",
  camping: "⛺",
  overnight: "🌙",
  oddity: "👁️",
  fuel: "⛽",
  attraction: "⭐",
  interest: "📍",
  urban: "🏙️",
};

type Props = {
  tripId: string;
  day: Day;
};

export function BrowseDaySection({ tripId, day }: Props) {
  const suggestions = day.segmentSuggestions ?? [];
  if (suggestions.length === 0) return null;

  const byCategory = groupByCategory(suggestions);

  return (
    <section className="flex flex-col gap-6 px-[15px] pt-6 pb-4">
      <header className="flex items-baseline gap-2">
        <span
          className="font-mono uppercase text-text-muted"
          style={{ fontSize: 13, lineHeight: "18px", letterSpacing: "0.14em" }}
        >
          Browse this day
        </span>
        <span className="font-mono text-text-muted opacity-60 text-[11px] leading-4">
          {suggestions.length} stops
        </span>
      </header>

      {CATEGORY_ORDER.flatMap((key) => {
        const places = byCategory[key];
        if (!places || places.length === 0) return [];
        return [
          <CategoryGroup
            key={key}
            tripId={tripId}
            day={day}
            category={key}
            places={places}
          />,
        ];
      })}
    </section>
  );
}

function CategoryGroup({
  tripId,
  day,
  category,
  places,
}: {
  tripId: string;
  day: Day;
  category: SlideCategoryKey;
  places: BrowsePlace[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-base leading-none">
          {SECTION_EMOJI[category]}
        </span>
        <span
          className="font-sans font-bold text-text-primary"
          style={{ fontSize: 15, lineHeight: "20px" }}
        >
          {SECTION_LABEL[category]}
        </span>
        <span
          className="font-mono text-text-muted opacity-70"
          style={{ fontSize: 11, lineHeight: "16px", letterSpacing: "0.12em" }}
        >
          · {places.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {places.map((place) => (
          <BrowseDayCard
            key={place.id}
            tripId={tripId}
            day={day}
            category={category}
            place={place}
          />
        ))}
      </div>
    </div>
  );
}

function BrowseDayCard({
  tripId,
  day,
  category,
  place,
}: {
  tripId: string;
  day: Day;
  category: SlideCategoryKey;
  place: BrowsePlace;
}) {
  const ctx: CardCtx = {
    category,
    dayCoords: day.coords,
    dayLabel: day.label,
    dayNumber: day.dayNumber,
    // In-day browse: this ctx day IS the result's day, so the detour is real.
    dayRelative: true,
  };

  const onAdd = () => {
    const synthWaypoint = browsePlaceToWaypoint(
      place,
      ctx,
      computeCardStats(place, ctx),
    );
    window.dispatchEvent(
      new CustomEvent("trip:toggleAdded", {
        detail: {
          placeId: place.id,
          dayId: day.id,
          dayNumber: day.dayNumber,
          place,
          waypoint: synthWaypoint,
        },
      }),
    );
  };

  const onOpen = () => {
    const synthWaypoint = browsePlaceToWaypoint(
      place,
      ctx,
      computeCardStats(place, ctx),
    );
    window.dispatchEvent(
      new CustomEvent("trip:flyTo", {
        detail: { coords: place.coords, name: place.title },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("trip:openDetail", {
        detail: {
          place: {
            id: place.id,
            title: place.title,
            photoUrl: place.photoUrl,
            dayNumber: day.dayNumber,
            dayId: day.id,
            coords: place.coords,
            description: place.description,
            waypoint: synthWaypoint,
            // In-day browse: on this day's route → in-app day-directions.
            dayRelative: true,
          },
        },
      }),
    );
  };

  return (
    <SuggestionCardV2
      place={place}
      category={category}
      dayNumber={day.dayNumber}
      onAdd={onAdd}
      onOpen={onOpen}
    />
  );
}

function groupByCategory(
  places: BrowsePlace[],
): Partial<Record<SlideCategoryKey, BrowsePlace[]>> {
  const out: Partial<Record<SlideCategoryKey, BrowsePlace[]>> = {};
  for (const p of places) {
    const key = p.category;
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key]!.push(p);
  }
  return out;
}
