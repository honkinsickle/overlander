/**
 * Locks the step-0 living-plan invariant: `itineraryToTrip` persists the FULL
 * GenerationInput (anchors + params + rig + objective) onto the Trip payload.
 * That field is what makes a generated trip EDITABLE — the living-plan loop
 * recovers these anchors, edits them, and re-runs the pipeline. If this test
 * fails, newly generated trips silently regress to output-only (uneditable).
 * Run with: npx tsx --test src/lib/itinerary/to-trip.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { itineraryToTrip } from "./to-trip";
import type { EngineFacts, GenerationInput } from "./facts";
import type { ItineraryOutput } from "./schema";
import type { DayRoute } from "./audit";

const INPUT: GenerationInput = {
  anchors: [
    { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null },
    { place: "Stewart, British Columbia", role: "waypoint", datePin: "flexible", date: null, dwell: 1, note: "Salmon Glacier excursion" },
    { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null },
  ],
  params: {
    startDate: "2026-07-13",
    endDate: "2026-07-26",
    budget: "mid",
    maxDailyDriveMi: 350,
    bufferDays: 0,
    avoid: [],
    returnRouting: "shortest",
  },
  rig: {
    vehicle: "2004 Lexus GX 470",
    build: [],
    fuelRangeMi: 400,
    capability: "moderate",
    groupSize: "1–2 travelers",
    skill: "intermediate",
    preferences: [],
  },
  objective: "test objective",
};

const FACTS: EngineFacts = {
  anchorsResolved: [
    { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null, coords: [-139.43, 64.06] },
    { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null, coords: [-123.12, 49.28] },
  ],
  route: { totalMi: 1500, totalDriveHours: 30, baselineDriveDays: 5, segments: [] },
  corridorCities: [],
  poolPOIs: [],
};

const OUTPUT: ItineraryOutput = {
  days: [
    {
      n: 1,
      date: "2026-07-13",
      startPlace: "Dawson City, Yukon",
      endPlace: "Whitehorse, YT",
      type: "drive",
      distanceMi: 332,
      driveHours: 6,
      weather: "clear",
      rationale: "test",
      keyStops: [],
      overnight: { name: null, desc: "test", type: "camp", rationale: "test" },
      logistics: "test",
      obligations: [],
    },
  ],
  foodThread: "test",
} as unknown as ItineraryOutput;

test("itineraryToTrip persists the full GenerationInput on the Trip", () => {
  const trip = itineraryToTrip("test-id", INPUT, FACTS, OUTPUT);
  assert.ok(trip.generationInput, "generationInput must be present on generated trips");
  // Deep-equal the whole input — anchors, params, rig, objective all survive.
  assert.deepEqual(trip.generationInput, INPUT);
});

// A 3-day trip whose middle day is an OUT-AND-BACK (start === end): day 1
// drives Dawson→Whitehorse, day 2 is a Whitehorse day-trip, day 3 drives on to
// Vancouver. Locks that EVERY day's endpoints are persisted from dayRoutes —
// not just day 1's start and the last day's end (the discarded-coords bug).
const WH: [number, number] = [-135.06, 60.72];
const OUTPUT_MULTI: ItineraryOutput = {
  days: [
    { ...OUTPUT.days[0], n: 1, startPlace: "Dawson City, Yukon", endPlace: "Whitehorse, YT" },
    { ...OUTPUT.days[0], n: 2, startPlace: "Whitehorse, YT", endPlace: "Whitehorse, YT", distanceMi: 50 },
    { ...OUTPUT.days[0], n: 3, startPlace: "Whitehorse, YT", endPlace: "Vancouver, British Columbia", distanceMi: 900 },
  ],
  foodThread: "test",
} as unknown as ItineraryOutput;

const DAY_ROUTES: DayRoute[] = [
  { n: 1, startCoord: [-139.43, 64.06], endCoord: WH, polyline: [[-139.43, 64.06], WH] },
  // Out-and-back: the audit sets end === start (no forward progress).
  { n: 2, startCoord: WH, endCoord: WH, polyline: null },
  { n: 3, startCoord: WH, endCoord: [-123.12, 49.28], polyline: [WH, [-123.12, 49.28]] },
];

test("itineraryToTrip persists per-day start/end coords from dayRoutes (incl. round-trip day)", () => {
  const trip = itineraryToTrip("test-id", INPUT, FACTS, OUTPUT_MULTI, undefined, DAY_ROUTES);

  assert.deepEqual(trip.days[0].startCoord, [-139.43, 64.06]);
  assert.deepEqual(trip.days[0].coords, WH);

  // The round-trip day is fully populated — start and end both the base city,
  // not undefined (the old stub left every intermediate day blank).
  assert.deepEqual(trip.days[1].startCoord, WH, "round-trip day keeps a start coord");
  assert.deepEqual(trip.days[1].coords, WH, "round-trip day end === start");

  assert.deepEqual(trip.days[2].startCoord, WH);
  assert.deepEqual(trip.days[2].coords, [-123.12, 49.28]);

  // Chain integrity: each day starts where the previous ended.
  assert.deepEqual(trip.days[1].startCoord, trip.days[0].coords);
  assert.deepEqual(trip.days[2].startCoord, trip.days[1].coords);
});

test("itineraryToTrip without dayRoutes: only first-day start + last-day end (backward-safe fallback)", () => {
  const trip = itineraryToTrip("test-id", INPUT, FACTS, OUTPUT_MULTI);
  assert.deepEqual(trip.days[0].startCoord, [-139.43, 64.06], "day 1 falls back to first anchor");
  assert.equal(trip.days[1].startCoord, undefined, "intermediate day has no coord without dayRoutes");
  assert.equal(trip.days[1].coords, undefined);
  assert.deepEqual(trip.days[2].coords, [-123.12, 49.28], "last day falls back to last anchor");
});
