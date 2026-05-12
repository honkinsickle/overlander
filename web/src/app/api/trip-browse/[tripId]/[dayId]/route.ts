import { NextResponse } from "next/server";
import { getTrip } from "@/lib/trips/repository";
import { BROWSE_PLACES, type SlideCategoryKey } from "@/lib/trip-browse/places";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { overpassSource } from "@/lib/discovery/overpass";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";

const SLIDE_CATEGORIES: SlideCategoryKey[] = [
  "scenic",
  "food",
  "oddity",
  "camping",
  "overnight",
];

/** Per-category search radius around each day endpoint. Camping leans
 *  wider because overlanders detour further for the right site (and
 *  BLM/NFS dispersed sites tend to sit between towns, not in them).
 *  Food stays tight so dense urban bboxes don't time out Overpass. */
const RADIUS_KM_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  food: 5,
  scenic: 15,
  oddity: 25,
  overnight: 15,
  camping: 50,
};

/**
 * Browse-panel data for one day. Returns curated fixture data when
 * present (la-to-portland Day 1 has rich editorial content), otherwise
 * falls through to live discovery against OSM.
 *
 *   GET /api/trip-browse/:tripId/:dayId?category=scenic
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ tripId: string; dayId: string }> },
) {
  const { tripId, dayId } = await context.params;
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  if (!category || !SLIDE_CATEGORIES.includes(category as SlideCategoryKey)) {
    return NextResponse.json(
      { error: `Invalid or missing category. Expected one of: ${SLIDE_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const slideKey = category as SlideCategoryKey;

  const trip = await getTrip(tripId);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const dayIndex = trip.days.findIndex((d) => d.id === dayId);
  if (dayIndex === -1) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }
  const day = trip.days[dayIndex];

  // Fixture wins for trips with curated browse content. The fixture is
  // keyed by `dayNumber` only — gate by `tripId` here so la-to-portland's
  // editorial copy doesn't leak into la-to-deadhorse Day 1 etc.
  const FIXTURE_TRIPS = new Set(["la-to-portland"]);
  if (FIXTURE_TRIPS.has(tripId)) {
    const fixturePlaces = BROWSE_PLACES[day.dayNumber]?.[slideKey];
    if (fixturePlaces && fixturePlaces.length > 0) {
      return NextResponse.json({ source: "fixture", places: fixturePlaces });
    }
  }

  // Live discovery — one ±RADIUS_KM bbox per endpoint of the leg
  // (this day's coord plus the previous day's, falling back to the
  // trip's startCoords for Day 1). Two small bboxes keep dense
  // categories like restaurants from timing out Overpass over the
  // full leg's bounding box.
  const points: Array<[number, number]> = [];
  if (day.coords) points.push(day.coords);
  const prev = trip.days[dayIndex - 1];
  if (prev?.coords) points.push(prev.coords);
  else if (dayIndex === 0 && trip.startCoords) points.push(trip.startCoords);

  if (points.length === 0) {
    return NextResponse.json({ source: "discovery", places: [] });
  }

  const bboxes = points.map((p) =>
    bboxFromCoords(p, RADIUS_KM_BY_CATEGORY[slideKey]),
  );
  const places = await discover({
    bboxes,
    categories: [slideKey],
    sources: [overpassSource, recGovSource, foursquareSource],
    signal: req.signal,
  });

  // Surface photo-bearing places first so the panel's initial viewport
  // shows real imagery. Within each group preserve the discovery order
  // (already roughly distance-sorted upstream).
  const sorted = [
    ...places.filter((p) => p.photoUrl),
    ...places.filter((p) => !p.photoUrl),
  ];

  return NextResponse.json({ source: "discovery", places: sorted });
}
