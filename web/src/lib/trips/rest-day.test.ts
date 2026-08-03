/**
 * Add-a-rest-day (layover insert) — drives the REAL pure functions
 * (buildRestDayStructure, rankNearbySuggestions, rescopeTripOverlays) through the
 * same composition the repository orchestrator (`insertRestDay`) uses, minus the DB.
 * Covers the invariants the guarded write must preserve. Run with:
 *   npx tsx --test src/lib/trips/rest-day.test.ts
 *
 * The FIRST test is a PRECONDITION guard, not a live-bug regression. The #182
 * hazard (rescoping over a day whose corridorCities aren't present drops its
 * overlays) is NOT live in the rest-day op: `insertRestDay` never recomputes or
 * clears any existing day's nodes, so there is no wrong order to get wrong. This
 * test locks the precondition rescope depends on — every existing day keeps its
 * nodes through the insert — so a FUTURE change that reintroduced node-clearing
 * would be caught here rather than shipping as a silent overlay drop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip, Day, CorridorCity } from "./types";
import { buildRestDayStructure, rankNearbySuggestions, isRestDay } from "./rest-day";
import { rescopeTripOverlays } from "./split-day";
import type { LngLat } from "@/lib/routing/route-between";
import type { BrowsePlace } from "@/lib/trip-browse/places";

const LA: LngLat = [-118.2437, 34.0522];
const VEGAS: LngLat = [-115.1398, 36.1699];
const SLC: LngLat = [-111.891, 40.7608];

function tile(id: string, coords?: LngLat): BrowsePlace {
  // Minimal BrowsePlace — only id/coords matter to the rest-day op.
  return { id, title: id, coords } as unknown as BrowsePlace;
}

function node(
  id: string,
  name: string,
  kind: CorridorCity["kind"],
  coords: LngLat,
): CorridorCity {
  return { id, name, kind, coords, milesFromStart: 0, placeIds: [] };
}

/** Two-day trip. Day 1 (LA→Vegas) carries a real corridor spine and an overlay
 *  (placeRank + placeOverride) on `tile-A1`, pinned to its START node — so the
 *  overlay has a valid home BEFORE any insert and its survival is a real check. */
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
    waypoints: [],
    overnight: {
      selected: { id: "on-1", name: "Vegas KOA", type: "rv", detourMiles: 0, cost: "$40" },
      alternatives: [],
    },
    description: "Mojave transit, brutally hot.",
    weather: { arrival: "105F" },
    notes: ["Fuel at Baker."],
    heroImage: "https://example/hero.jpg",
    segmentSuggestions: [tile("tile-A1", [-117.8, 34.4])],
    corridorCities: [
      node("los-angeles-ca", "Los Angeles, CA", "start", LA),
      node("las-vegas-nv", "Las Vegas, NV", "end", VEGAS),
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
    corridorCities: [
      node("las-vegas-nv", "Las Vegas, NV", "start", VEGAS),
      node("salt-lake-city-ut", "Salt Lake City, UT", "end", SLC),
    ],
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
    placeOverrides: [{ placeId: "tile-A1", nodeId: "los-angeles-ca" }],
    placeRanks: { "tile-A1": { nodeId: "los-angeles-ca", rank: 1 } },
  } as Trip;
}

/** Corpus rows spread EAST of Vegas at strictly increasing distance (index k → k
 *  steps of ~1.8 km), plus one coord-less row that must be dropped by the rank. */
function corpusNearVegas(count: number): BrowsePlace[] {
  const rows: BrowsePlace[] = [];
  for (let k = count; k >= 1; k--) {
    // built far→near on purpose so the rank has to REORDER, not pass through.
    rows.push(tile(`mp:${k}`, [VEGAS[0] + k * 0.02, VEGAS[1]]));
  }
  rows.push(tile("mp:nocoord")); // coord-less → dropped
  return rows;
}

/** The exact composition `insertRestDay` runs inside its guarded write, minus DB:
 *  build structure → fill the layover's suggestions (ranked) → rescope overlays. */
function doInsertRestDay(trip: Trip, dayId: string, corpus: BrowsePlace[]) {
  const s = buildRestDayStructure(trip, dayId);
  assert.ok(s, "buildRestDayStructure returned null");
  const stop = trip.days.find((d) => d.id === dayId)!.coords as LngLat;
  const rd = s.trip.days.find((d) => d.id === s.restDayId)!;
  rd.segmentSuggestions = rankNearbySuggestions(stop, corpus);
  const withOverlays = rescopeTripOverlays(s.trip);
  return { trip: withOverlays, restDayId: s.restDayId };
}

test("PRECONDITION: the insert leaves existing nodes intact, so rescope keeps overlays", () => {
  const before = baseTrip();
  const { trip } = doInsertRestDay(before, "day-1", corpusNearVegas(12));

  // The op leaves the anchor day's nodes untouched, so the overlay on tile-A1
  // keeps its home and survives the insert + renumber.
  assert.ok(trip.placeRanks?.["tile-A1"], "placeRank on tile-A1 survived");
  assert.ok(
    (trip.placeOverrides ?? []).some((o) => o.placeId === "tile-A1"),
    "placeOverride on tile-A1 survived",
  );

  // The load-bearing precondition: buildRestDayStructure does NOT clear any
  // existing day's corridorCities. This assert is what a future regression
  // (someone making the insert touch neighbor nodes) would trip on.
  const structured = buildRestDayStructure(baseTrip(), "day-1")!;
  const anchorAfter = structured.trip.days.find((d) => d.id === "day-1")!;
  assert.ok(
    anchorAfter.corridorCities?.some((n) => n.id === "los-angeles-ca"),
    "anchor day keeps its corridor nodes through the insert",
  );

  // Illustrates WHY the precondition matters (not a hazard the op can hit on its
  // own): were the anchor's nodes absent when rescope runs, the overlay drops —
  // the #182 failure shape. Documented here so the precondition assert above
  // reads as load-bearing, not incidental.
  const broken = structured.trip;
  delete broken.days.find((d) => d.id === "day-1")!.corridorCities;
  const dropped = rescopeTripOverlays(broken);
  assert.equal(
    dropped.placeRanks?.["tile-A1"],
    undefined,
    "overlay DROPS when the anchor's node is missing at rescope time",
  );
});

test("the day AFTER the insert renumbers +1, redates +1, endpoints byte-identical", () => {
  const before = baseTrip();
  const origDay2 = before.days[1];
  const { trip } = doInsertRestDay(before, "day-1", []);
  const after = trip.days.find((d) => d.label === origDay2.label)!;
  assert.deepEqual(after.startCoord, origDay2.startCoord, "startCoord unchanged");
  assert.deepEqual(after.coords, origDay2.coords, "coords unchanged");
  assert.equal(after.id, "day-3", "renumbered day-2 → day-3");
  assert.equal(after.dayNumber, 3);
  assert.equal(after.date, "2026-08-03", "date shifted +1");
});

test("the layover carries start === end, miles 0, driveHours 0, no spine", () => {
  const { trip, restDayId } = doInsertRestDay(baseTrip(), "day-1", []);
  const rd = trip.days.find((d) => d.id === restDayId)!;
  assert.equal(rd.id, "day-2", "layover slots into the vacated N+1");
  assert.equal(rd.dayNumber, 2);
  assert.equal(rd.date, "2026-08-02", "layover dated anchor +1");
  assert.deepEqual(rd.startCoord, VEGAS, "start is the anchor's overnight");
  assert.deepEqual(rd.coords, VEGAS, "end === start (the layover invariant)");
  assert.deepEqual(rd.startCoord, rd.coords, "start and end are byte-identical");
  assert.equal(rd.miles, 0, "miles 0 — no driving");
  assert.equal(rd.driveHours, 0, "driveHours 0 — honest zero, not null");
  assert.equal(rd.corridorCities, undefined, "no line → no spine");
  assert.equal(rd.label, "Rest day — Las Vegas, NV", "label names the stop");
});

test("the layover is SPARSE — no authored prose fabricated", () => {
  const { trip, restDayId } = doInsertRestDay(baseTrip(), "day-1", []);
  const rd = trip.days.find((d) => d.id === restDayId)!;
  assert.equal(rd.description, undefined);
  assert.equal(rd.weather, undefined);
  assert.equal(rd.notes, undefined);
  assert.equal(rd.overnight, undefined);
  assert.equal(rd.heroImage, undefined);
  assert.deepEqual(rd.waypoints, [], "no waypoints");
});

test("suggestions are distance-ranked nearest-first, capped, coord-less dropped", () => {
  const { trip, restDayId } = doInsertRestDay(baseTrip(), "day-1", corpusNearVegas(12));
  const rd = trip.days.find((d) => d.id === restDayId)!;
  const ids = (rd.segmentSuggestions ?? []).map((p) => p.id);
  assert.equal(ids.length, 10, "capped at REST_DAY_SUGGESTION_CAP (10)");
  // Nearest is mp:1 (k=1, closest to Vegas); order ascends to mp:10. mp:11/mp:12
  // are past the cap; mp:nocoord is dropped.
  assert.deepEqual(
    ids,
    ["mp:1", "mp:2", "mp:3", "mp:4", "mp:5", "mp:6", "mp:7", "mp:8", "mp:9", "mp:10"],
    "nearest-first, capped, coord-less excluded",
  );
});

test("rankNearbySuggestions: pure unit — ordering, cap, coord-less drop", () => {
  const rows = corpusNearVegas(3); // mp:3, mp:2, mp:1 (far→near) + mp:nocoord
  const ranked = rankNearbySuggestions(VEGAS, rows, 2);
  assert.deepEqual(ranked.map((p) => p.id), ["mp:1", "mp:2"], "closest two, in order");
  // A coord-less-only input yields nothing rankable.
  assert.deepEqual(rankNearbySuggestions(VEGAS, [tile("mp:x")]).map((p) => p.id), []);
});

test("isRestDay: true for a bare layover; false for excursion / normal / spined day", () => {
  assert.equal(isRestDay({ startCoord: LA, coords: LA, miles: 0 } as Day), true, "bare layover");
  // Round-trip EXCURSION: same start/end but it drove → not a rest day.
  assert.equal(isRestDay({ startCoord: LA, coords: LA, miles: 40 } as Day), false, "excursion drove");
  // Normal driving day: start !== end.
  assert.equal(isRestDay({ startCoord: LA, coords: VEGAS, miles: 270 } as Day), false, "normal day");
  // A same-stop day that carries a spine is not the bare rest-day shape.
  assert.equal(
    isRestDay({ startCoord: LA, coords: LA, miles: 0, corridorCities: [{ id: "x" }] } as unknown as Day),
    false,
    "has a spine",
  );
});

test("the anchor day is untouched — id, number, date, and content preserved", () => {
  const before = baseTrip();
  const { trip } = doInsertRestDay(before, "day-1", corpusNearVegas(5));
  const anchor = trip.days.find((d) => d.id === "day-1")!;
  assert.equal(anchor.dayNumber, 1);
  assert.equal(anchor.date, "2026-08-01");
  assert.equal(anchor.label, "Los Angeles, CA — Las Vegas, NV");
  assert.deepEqual(anchor.coords, VEGAS);
  assert.ok(anchor.description && anchor.overnight, "authored content intact");
  assert.ok(
    anchor.corridorCities?.some((n) => n.id === "los-angeles-ca"),
    "corridor nodes intact",
  );
});
