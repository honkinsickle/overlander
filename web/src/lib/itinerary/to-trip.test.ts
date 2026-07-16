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
