/**
 * Tests for topPlacesForTrip() — trip-level "Top Places to Visit"
 * aggregation for the Overview state (Phase A). Run with:
 *   npx tsx --test src/lib/trips/top-places.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { topPlacesForTrip, TOP_PLACES_N } from "./top-places";
import type { Trip, Day, Waypoint } from "./types";
import type { BrowsePlace } from "@/lib/trip-browse/places";

function sug(id: string, over: Partial<BrowsePlace> = {}): BrowsePlace {
  return {
    id,
    coords: [-119, 34],
    title: id,
    photoAlt: id,
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: `${id} desc`,
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
    category: "scenic",
    ...over,
  };
}

function wp(id: string, over: Partial<Waypoint> = {}): Waypoint {
  return {
    id,
    slug: id,
    category: "attraction",
    title: id,
    subtitle: "",
    description: `${id} wp desc`,
    stats: [],
    coords: [-119, 34],
    ...over,
  };
}

function trip(days: Partial<Day>[]): Trip {
  return {
    id: "t",
    title: "T",
    startDate: "2026-05-30",
    endDate: "2026-05-31",
    startLocation: "A",
    endLocation: "B",
    weatherHiF: 70,
    weatherLoF: 50,
    days: days.map((d, i) => ({
      id: `day-${i + 1}`,
      dayNumber: i + 1,
      date: "2026-05-30",
      label: "A — B",
      waypoints: [],
      ...d,
    })),
  };
}

test("aggregates segmentSuggestions AND waypoints across all days", () => {
  const t = trip([
    { segmentSuggestions: [sug("s1")], waypoints: [wp("w1")] },
    { segmentSuggestions: [sug("s2")] },
  ]);
  const ids = topPlacesForTrip(t).map((p) => p.id).sort();
  assert.deepEqual(ids, ["s1", "s2", "w1"]);
});

test("dedupes by id (added suggestion lives in both pools)", () => {
  const t = trip([
    { segmentSuggestions: [sug("shared")], waypoints: [wp("shared")] },
  ]);
  const hits = topPlacesForTrip(t).filter((p) => p.id === "shared");
  assert.equal(hits.length, 1);
});

test("ranks by rating desc, then reviewCount desc; unrated sort last", () => {
  const t = trip([
    {
      segmentSuggestions: [
        sug("mid", { rating: 4.5, reviewCount: 100 }),
        sug("unrated"),
        sug("top", { rating: 4.9, reviewCount: 10 }),
        sug("tieHi", { rating: 4.5, reviewCount: 900 }),
      ],
    },
  ]);
  const ids = topPlacesForTrip(t).map((p) => p.id);
  assert.deepEqual(ids.slice(0, 3), ["top", "tieHi", "mid"]);
  assert.equal(ids.at(-1), "unrated", "unrated sinks to the bottom");
});

test("reference-fallback: populates from waypoints when there are no suggestions", () => {
  // The la-to-deadhorse case — no segmentSuggestions, editorial waypoints
  // carrying community ratings.
  const t = trip([
    {
      waypoints: [
        wp("eggslut", { community: { rating: 4.2, reviewCount: 1200 } }),
        wp("broad", { community: { rating: 4.6, reviewCount: 9100 } }),
      ],
    },
  ]);
  const top = topPlacesForTrip(t);
  assert.deepEqual(top.map((p) => p.id), ["broad", "eggslut"]);
  assert.equal(top[0].rating, 4.6);
  assert.equal(top[0].reviewCount, 9100);
});

test("caps at TOP_PLACES_N", () => {
  const many = Array.from({ length: TOP_PLACES_N + 5 }, (_, i) =>
    sug(`s${i}`, { rating: 5 - i * 0.1, reviewCount: 100 }),
  );
  const t = trip([{ segmentSuggestions: many }]);
  assert.equal(topPlacesForTrip(t).length, TOP_PLACES_N);
});

test("normalizes category: slide 'overnight' → 'camping'; waypoint keeps its Category", () => {
  const t = trip([
    { segmentSuggestions: [sug("camp", { category: "overnight", rating: 4 })] },
    { waypoints: [wp("hotelwp", { category: "hotel", community: { rating: 5, reviewCount: 1 } })] },
  ]);
  const byId = new Map(topPlacesForTrip(t).map((p) => [p.id, p]));
  assert.equal(byId.get("camp")?.category, "camping");
  assert.equal(byId.get("hotelwp")?.category, "hotel");
});

test("carries id/title/photo/description/rating for Details + rendering", () => {
  const t = trip([
    {
      waypoints: [
        wp("w", {
          title: "Eggslut",
          photoUrl: "http://x/p.jpg",
          description: "eggs",
          community: { rating: 4.2, reviewCount: 1200 },
        }),
      ],
    },
  ]);
  const p = topPlacesForTrip(t)[0];
  assert.equal(p.id, "w");
  assert.equal(p.title, "Eggslut");
  assert.equal(p.photoUrl, "http://x/p.jpg");
  assert.equal(p.description, "eggs");
  assert.equal(p.photoAlt, "Eggslut"); // waypoint has no photoAlt → title
  assert.equal(p.rating, 4.2);
});
