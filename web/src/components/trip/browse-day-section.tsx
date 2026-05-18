"use client";

import type { Day } from "@/lib/trips/types";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import {
  SuggestionCardV2,
  type DetourInfo,
} from "@/components/trip/suggestion-card-v2";

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
};

const SECTION_EMOJI: Record<SlideCategoryKey, string> = {
  scenic: "🏔️",
  food: "🍔",
  camping: "⛺",
  overnight: "🌙",
  oddity: "👁️",
  fuel: "⛽",
};

/** Fixed-width Paper variants from the artboards:
 *  - 300px → 2-up in the 655w side panel
 *  - 356px → 3-up in the 1112w expanded view
 *  Rendered via flex-wrap so each card stays at its spec'd width and
 *  the surface decides the column count automatically (1-up at 410w,
 *  2-up at ~640w+, 3-up at ~1110w+). */
export type CardWidthVariant = 300 | 356;

type Props = {
  tripId: string;
  day: Day;
  /** Card width per Paper artboard. Defaults to 300 (2-up width).
   *  Flex-wrap handles the column count from there. */
  cardWidth?: CardWidthVariant;
};

export function BrowseDaySection({ tripId, day, cardWidth = 300 }: Props) {
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
            cardWidth={cardWidth}
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
  cardWidth,
}: {
  tripId: string;
  day: Day;
  category: SlideCategoryKey;
  places: BrowsePlace[];
  cardWidth: CardWidthVariant;
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
      <div className="flex flex-wrap gap-3">
        {places.map((place) => (
          <div
            key={place.id}
            style={{ flex: `0 0 ${cardWidth}px`, maxWidth: "100%" }}
          >
            <BrowseDayCard
              tripId={tripId}
              day={day}
              category={category}
              place={place}
            />
          </div>
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
          },
        },
      }),
    );
  };

  const onMore = () => {
    // Reuse the open flow for now — kebab is a stub until per-place
    // actions land.
    onOpen();
  };

  const detour = computeDetour(place.coords, day.coords, category);

  return (
    <SuggestionCardV2
      place={place}
      category={category}
      dayNumber={day.dayNumber}
      detour={detour}
      onAdd={onAdd}
      onOpen={onOpen}
      onMore={onMore}
    />
  );
}

// ── Detour helper ────────────────────────────────────────────────────
// Mirrors the logic in lib/trip-browse/card-stats.ts so we don't depend
// on its computeCardStats producing a parsed-string output. Haversine
// straight-line × 1.4 road factor; 42 mph average drive; stop time per
// category. Result is the round-trip detour the user would add by
// visiting this place vs. continuing straight to the day's end.

const STOP_MIN_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  scenic: 45,
  food: 60,
  oddity: 30,
  camping: 30,
  overnight: 30,
  fuel: 10,
};

function computeDetour(
  placeCoords: [number, number],
  dayCoords: [number, number] | undefined,
  category: SlideCategoryKey,
): DetourInfo | undefined {
  if (!dayCoords) return undefined;
  const detourMi = haversineMi(placeCoords, dayCoords) * 1.4;
  if (detourMi < 0.25) {
    // Practically on the route.
    return { miles: 0, status: "on-route" };
  }
  const drivingMin = (detourMi / 42) * 60;
  // Round-trip drive + on-site stop time.
  const totalMin = Math.round(drivingMin * 2 + STOP_MIN_BY_CATEGORY[category]);
  // Round to 1 decimal under 10 mi, integer otherwise.
  const miles =
    detourMi < 10
      ? Math.round(detourMi * 10) / 10
      : Math.round(detourMi);
  return { miles, minutes: totalMin, status: "detour" };
}

function haversineMi(
  a: [number, number],
  b: [number, number],
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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
