/**
 * Tests for recomputeDay() — edit-time route recalculation (Phase 0 of
 * the editable-corridor integration; supersedes spec §3.1's deferred
 * status). Run with:
 *   npx tsx --test src/lib/trips/recompute-day.test.ts
 *
 * The Mapbox call is injected so tests run offline: the fake router
 * records the stop list it was called with and returns a canned Route.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recomputeDay } from "./recompute-day";
import type { Trip, Day, Waypoint } from "./types";
import type { Route } from "@/lib/routing/route-between";

const METERS_PER_MILE = 1609.34;

/** Rough US-101 LA→Santa Barbara polyline — same fixture the corridor
 *  smokes use; produces a known spine (Santa Monica / Ventura). */
const LA_SB_LINE: [number, number][] = [
  [-118.24, 34.05],
  [-118.45, 34.03],
  [-118.7, 34.03],
  [-118.92, 34.08],
  [-119.1, 34.17],
  [-119.29, 34.28],
  [-119.48, 34.37],
  [-119.7, 34.42],
];

function fakeRoute(overrides: Partial<Route> = {}) {
  const calls: [number, number][][] = [];
  const route = async (coords: [number, number][]): Promise<Route> => {
    calls.push(coords);
    return {
      coordinates: LA_SB_LINE,
      distanceM: 90 * METERS_PER_MILE,
      durationS: 2.5 * 3600,
      steps: [],
      ...overrides,
    };
  };
  return { calls, route };
}

function wp(id: string, coords?: [number, number]): Waypoint {
  return {
    id,
    slug: id,
    category: "scenic",
    title: id,
    subtitle: "",
    description: "",
    stats: [],
    coords,
  };
}

function makeTrip(day: Partial<Day>, extra: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    title: "Test",
    startDate: "2026-05-30",
    endDate: "2026-05-30",
    startLocation: "Los Angeles, CA",
    endLocation: "Santa Barbara, CA",
    startCoords: [-118.24, 34.05],
    weatherHiF: 75,
    weatherLoF: 55,
    days: [
      {
        id: "day-1",
        dayNumber: 1,
        date: "2026-05-30",
        label: "Los Angeles, CA — Santa Barbara, CA",
        coords: [-119.7, 34.42],
        startCoord: [-118.24, 34.05],
        waypoints: [],
        ...day,
      },
    ],
    ...extra,
  };
}

test("stops = start + coord-bearing waypoints in order + end", async () => {
  const { calls, route } = fakeRoute();
  const trip = makeTrip({
    waypoints: [wp("a", [-118.7, 34.1]), wp("no-coords"), wp("b", [-119.2, 34.3])],
  });
  const r = await recomputeDay(trip, "day-1", { route });
  assert.ok(r, "expected derived values");
  assert.deepEqual(calls[0], [
    [-118.24, 34.05],
    [-118.7, 34.1],
    [-119.2, 34.3],
    [-119.7, 34.42],
  ]);
});

test("reorder semantics: waypoint order changes the stop order", async () => {
  const { calls, route } = fakeRoute();
  const trip = makeTrip({
    waypoints: [wp("b", [-119.2, 34.3]), wp("a", [-118.7, 34.1])],
  });
  await recomputeDay(trip, "day-1", { route });
  assert.deepEqual(
    calls[0].slice(1, 3),
    [
      [-119.2, 34.3],
      [-118.7, 34.1],
    ],
    "stops follow waypoint array order",
  );
});

test("startCoord fallback: day 1 uses trip.startCoords, later days use previous day's end", async () => {
  const { calls, route } = fakeRoute();
  const trip = makeTrip({ startCoord: undefined });
  trip.days.push({
    id: "day-2",
    dayNumber: 2,
    date: "2026-05-31",
    label: "Santa Barbara, CA — Big Sur, CA",
    coords: [-121.8, 36.27],
    waypoints: [],
  });
  await recomputeDay(trip, "day-1", { route });
  assert.deepEqual(calls[0][0], [-118.24, 34.05], "day 1 falls back to trip.startCoords");
  await recomputeDay(trip, "day-2", { route });
  assert.deepEqual(calls[1][0], [-119.7, 34.42], "day 2 falls back to day 1's end");
});

test("derived miles/driveHours use the finalize rounding", async () => {
  const { route } = fakeRoute({
    distanceM: 123.4 * METERS_PER_MILE,
    durationS: 3.27 * 3600,
  });
  const r = await recomputeDay(makeTrip({}), "day-1", { route });
  assert.ok(r);
  assert.equal(r.miles, 123);
  assert.equal(r.driveHours, 3.3);
});

test("corridorCities derived from the rerouted line (known LA→SB spine)", async () => {
  const { route } = fakeRoute();
  const r = await recomputeDay(makeTrip({}), "day-1", { route });
  assert.ok(r?.corridorCities, "expected a corridor");
  const ids = r.corridorCities.map((c) => c.id);
  assert.ok(ids.includes("ventura-ca"), "Ventura on the spine");
  assert.equal(r.corridorCities[0].kind, "start");
  assert.equal(r.corridorCities.at(-1)?.kind, "end");
});

test("waypoints bucket into the recomputed corridor", async () => {
  const { route } = fakeRoute();
  // Waypoint on the route near Ventura's along-route position.
  const trip = makeTrip({ waypoints: [wp("ventura-stop", [-119.28, 34.27])] });
  const r = await recomputeDay(trip, "day-1", { route });
  assert.ok(r?.corridorCities);
  const ventura = r.corridorCities.find((c) => c.id === "ventura-ca");
  assert.ok(ventura?.placeIds.includes("ventura-stop"), "waypoint bucketed under Ventura");
});

test("unsplittable label: miles recompute, corridor comes back undefined", async () => {
  const { route } = fakeRoute();
  const trip = makeTrip({ label: "Port Angeles Buffer" });
  const r = await recomputeDay(trip, "day-1", { route });
  assert.ok(r);
  assert.equal(r.miles, 90);
  assert.equal(r.corridorCities, undefined);
});

test("day without end coords returns null without routing", async () => {
  const { calls, route } = fakeRoute();
  const r = await recomputeDay(makeTrip({ coords: undefined }), "day-1", { route });
  assert.equal(r, null);
  assert.equal(calls.length, 0);
});

test("consecutive duplicate stops are deduped before routing", async () => {
  const { calls, route } = fakeRoute();
  // Waypoint sits exactly on the day start (Mapbox 422s on consecutive dupes).
  const trip = makeTrip({ waypoints: [wp("dupe", [-118.24, 34.05])] });
  await recomputeDay(trip, "day-1", { route });
  assert.deepEqual(calls[0], [
    [-118.24, 34.05],
    [-119.7, 34.42],
  ]);
});

test("more stops than the Mapbox coord cap returns null without routing", async () => {
  const { calls, route } = fakeRoute();
  const many = Array.from({ length: 30 }, (_, i) =>
    wp(`w${i}`, [-118.5 - i * 0.01, 34.1]),
  );
  const r = await recomputeDay(makeTrip({ waypoints: many }), "day-1", { route });
  assert.equal(r, null);
  assert.equal(calls.length, 0);
});
