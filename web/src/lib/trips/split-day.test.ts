/**
 * Subdivide-a-leg (day split) — drives the REAL functions (buildSplitStructure,
 * recomputeDay, rebuildRoutePolyline, rescopeTripOverlays) through the injectable
 * `route` seam, no DB / no Mapbox. Covers the invariants the guarded write must
 * preserve. Run with:
 *   npx tsx --test src/lib/trips/split-day.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip, Day } from "./types";
import { buildSplitStructure, rescopeTripOverlays } from "./split-day";
import { recomputeDay, type DayDerived } from "./recompute-day";
import { rebuildRoutePolyline } from "./route-rebuild";
import type { LngLat, Route } from "@/lib/routing/route-between";
import type { BrowsePlace } from "@/lib/trip-browse/places";

const LA: LngLat = [-118.2437, 34.0522];
const VEGAS: LngLat = [-115.1398, 36.1699];
const SLC: LngLat = [-111.891, 40.7608];
const BAKER: LngLat = [-115.95, 35.55]; // the interior cut point M

function tile(id: string, coords?: LngLat): BrowsePlace {
  // Minimal BrowsePlace — only id/coords matter to the split.
  return { id, title: id, coords } as unknown as BrowsePlace;
}

function baseTrip(): Trip {
  const day1: Day = {
    id: "day-1",
    dayNumber: 1,
    date: "2026-08-01",
    label: "Los Angeles, CA — Las Vegas, NV",
    startCoord: LA,
    coords: VEGAS,
    miles: 270,
    driveHours: 4.2,
    waypoints: [
      { id: "wp-early", slug: "wp-early", title: "Early", coords: [-117.3, 34.6] } as Day["waypoints"][number],
      { id: "wp-late", slug: "wp-late", title: "Late", coords: [-115.5, 35.9] } as Day["waypoints"][number],
    ],
    overnight: { selected: { id: "on-1", name: "Vegas KOA", type: "rv", detourMiles: 0, cost: "$40" }, alternatives: [] },
    description: "Mojave transit, brutally hot.",
    weather: { arrival: "105F" },
    notes: ["Fuel at Baker."],
    heroImage: "https://example/hero.jpg",
    segmentSuggestions: [
      tile("tile-A1", [-117.8, 34.4]),
      tile("tile-A2", [-116.5, 35.1]),
      tile("tile-B1", [-115.6, 35.85]),
      tile("tile-B2", [-115.25, 36.05]),
      tile("tile-nocoord"), // no coords → stays with A
    ],
  };
  const day2: Day = {
    id: "day-2",
    dayNumber: 2,
    date: "2026-08-02",
    label: "Las Vegas, NV — Salt Lake City, UT",
    startCoord: VEGAS,
    coords: SLC,
    miles: 420,
    driveHours: 6.3,
    waypoints: [],
    segmentSuggestions: [tile("tile-C1", [-113.5, 38.5])],
  };
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Test",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    startLocation: "Los Angeles, CA",
    endLocation: "Salt Lake City, UT",
    startCoords: LA,
    weatherHiF: 70,
    weatherLoF: 45,
    days: [day1, day2],
    // Overlay on a tile that STAYS in half A (its node is half A's start node).
    placeOverrides: [{ placeId: "tile-A1", nodeId: "los-angeles-ca" }],
    placeRanks: { "tile-A1": { nodeId: "los-angeles-ca", rank: 1 } },
  } as Trip;
}

/** Fake router: straight segments, deterministic distance/duration. */
function fakeRoute(coords: LngLat[]): Promise<Route> {
  return Promise.resolve({
    coordinates: coords,
    distanceM: 150000, // 150 km ≈ 93 mi
    durationS: 9000, // 2.5 h
    steps: [],
  });
}

/** Router that throws for a leg touching a given coord (unroutable). */
function throwingRouteNear(target: LngLat) {
  return (coords: LngLat[]): Promise<Route> => {
    if (coords.some((c) => c[0] === target[0] && c[1] === target[1])) {
      return Promise.reject(new Error("no routes (unroutable)"));
    }
    return fakeRoute(coords);
  };
}

async function doSplit(trip: Trip, route = fakeRoute) {
  const s = buildSplitStructure(trip, "day-1", { coords: BAKER, name: "Baker, CA" });
  assert.ok(s, "buildSplitStructure returned null");
  const rc = { route, unroutableFallback: true } as const;
  const dA = await recomputeDay(s.trip, s.halfAId, rc);
  const dB = await recomputeDay(s.trip, s.halfBId, rc);
  const apply = (id: string, d: DayDerived | null) => {
    if (!d) return;
    const day = s.trip.days.find((x) => x.id === id)!;
    day.miles = d.miles;
    day.driveHours = d.driveHours;
    day.corridorCities = d.corridorCities;
  };
  apply(s.halfAId, dA);
  apply(s.halfBId, dB);
  const withOverlays = rescopeTripOverlays(s.trip);
  const polyline = await rebuildRoutePolyline(withOverlays, { route });
  return { trip: withOverlays, halfAId: s.halfAId, halfBId: s.halfBId, dA, dB, polyline };
}

test("invariant 1: both halves carry real miles + driveHours", async () => {
  const { trip, halfAId, halfBId } = await doSplit(baseTrip());
  const a = trip.days.find((d) => d.id === halfAId)!;
  const b = trip.days.find((d) => d.id === halfBId)!;
  assert.ok((a.miles ?? 0) > 0 && (b.miles ?? 0) > 0, "miles present on both");
  assert.equal(typeof a.driveHours, "number");
  assert.equal(typeof b.driveHours, "number");
});

test("invariant 2: the day AFTER the cut has byte-identical startCoord + coords", async () => {
  const before = baseTrip();
  const origDay2 = before.days[1];
  const { trip } = await doSplit(before);
  // Day-2 (Vegas→SLC) renumbers to day-3 but its endpoints must not move.
  const after = trip.days.find((d) => d.label === origDay2.label)!;
  assert.deepEqual(after.startCoord, origDay2.startCoord, "startCoord unchanged");
  assert.deepEqual(after.coords, origDay2.coords, "coords unchanged");
  assert.equal(after.id, "day-3", "renumbered day-2 → day-3");
  assert.equal(after.dayNumber, 3);
  assert.equal(after.date, "2026-08-03", "date shifted +1");
});

test("invariant 3: segmentSuggestions fully partitioned — union equal, intersection empty", async () => {
  const before = baseTrip();
  const orig = new Set((before.days[0].segmentSuggestions ?? []).map((t) => t.id));
  const { trip, halfAId, halfBId } = await doSplit(before);
  const a = (trip.days.find((d) => d.id === halfAId)!.segmentSuggestions ?? []).map((t) => t.id);
  const b = (trip.days.find((d) => d.id === halfBId)!.segmentSuggestions ?? []).map((t) => t.id);
  assert.equal(a.length + b.length, orig.size, "count in == count out");
  assert.equal(new Set([...a, ...b]).size, orig.size, "no duplication");
  assert.deepEqual(new Set([...a, ...b]), orig, "union equals original");
  assert.equal(a.filter((id) => b.includes(id)).length, 0, "intersection empty");
  // The along-corridor predicate put early tiles on A, late tiles on B.
  assert.ok(a.includes("tile-A1") && a.includes("tile-A2") && a.includes("tile-nocoord"));
  assert.ok(b.includes("tile-B1") && b.includes("tile-B2"));
});

test("invariant 5: overlays on a surviving tile survive the renumber", async () => {
  const { trip } = await doSplit(baseTrip());
  assert.ok(trip.placeRanks?.["tile-A1"], "placeRank on tile-A1 survived");
  assert.ok(
    (trip.placeOverrides ?? []).some((o) => o.placeId === "tile-A1"),
    "placeOverride on tile-A1 survived",
  );
});

test("invariant 6: an unroutable half completes with the Haversine fallback", async () => {
  // Make half B (M→Vegas, touching VEGAS) unroutable.
  const { trip, halfBId, dB } = await doSplit(baseTrip(), throwingRouteNear(VEGAS));
  assert.ok(dB?.fellBack, "half B reported fellBack");
  const b = trip.days.find((d) => d.id === halfBId)!;
  assert.equal(b.driveHours, null, "driveHours is null, never 0");
  assert.ok((b.miles ?? 0) > 0, "miles is a straight-line Haversine estimate");
  assert.equal(b.corridorCities, undefined, "no spine on the fallback");
});

test("invariant 4 (partial): routePolyline rebuilt non-null", async () => {
  const { polyline } = await doSplit(baseTrip());
  assert.equal(typeof polyline, "string");
  assert.ok((polyline ?? "").length > 0, "polyline is a non-empty encoded string");
});

test("authored content stays with A; B is sparse", async () => {
  const { trip, halfAId, halfBId } = await doSplit(baseTrip());
  const a = trip.days.find((d) => d.id === halfAId)!;
  const b = trip.days.find((d) => d.id === halfBId)!;
  assert.ok(a.description && a.weather && a.overnight && a.heroImage, "A keeps authored prose");
  assert.equal(b.description, undefined);
  assert.equal(b.weather, undefined);
  assert.equal(b.overnight, undefined);
  assert.equal(b.heroImage, undefined);
  // Labels reflect real endpoints (necessary deviation from "label stays with A").
  assert.equal(a.label, "Los Angeles, CA — Baker, CA");
  assert.equal(b.label, "Baker, CA — Las Vegas, NV");
});
