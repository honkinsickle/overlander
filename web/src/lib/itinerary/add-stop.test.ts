/**
 * Locks add-stop position inference + the two-mode apply against the real
 * Barkerville probe (mile 1470 between Stewart 978 and Vancouver 1896, offset
 * 34.8mi). Run: npx tsx --test src/lib/itinerary/add-stop.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferAddStopPosition,
  applyAddStop,
  ADD_STOP_OFFSET_FLAG_MI,
} from "./edit";
import type { Anchor, GenerationInput } from "./facts";

const anchors: Anchor[] = [
  { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null },
  { place: "Stewart, British Columbia", role: "waypoint", datePin: "fixed", date: "2026-07-18", dwell: 1, note: null },
  { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null },
];
const anchorMiles = [0, 978, 1896]; // from the probe

const INPUT: GenerationInput = {
  anchors,
  params: {
    startDate: "2026-07-13", endDate: "2026-07-26", budget: "mid",
    maxDailyDriveMi: 350, bufferDays: 0, avoid: [], returnRouting: "shortest",
  },
  rig: { vehicle: "GX470", build: [], fuelRangeMi: 400, capability: "moderate", groupSize: "1", skill: "intermediate", preferences: [] },
};

test("position inference: Barkerville slots between Stewart and Vancouver", () => {
  const pos = inferAddStopPosition(anchors, anchorMiles, { miles: 1470, offsetMi: 34.8 });
  assert.equal(pos.insertAt, 2);
  assert.equal(pos.prevAnchor, "Stewart, British Columbia");
  assert.equal(pos.nextAnchor, "Vancouver, British Columbia");
  assert.equal(pos.farOffRoute, false); // 34.8 < 100 → legit spur
});

test("offset threshold: a place 240mi off-route is flagged, not silently inserted", () => {
  const pos = inferAddStopPosition(anchors, anchorMiles, { miles: 1470, offsetMi: 240 });
  assert.equal(pos.farOffRoute, true);
  assert.ok(240 > ADD_STOP_OFFSET_FLAG_MI);
});

test("position clamps: a place past the end never becomes an endpoint move", () => {
  const pos = inferAddStopPosition(anchors, anchorMiles, { miles: 5000, offsetMi: 5 });
  assert.equal(pos.insertAt, 2); // clamped to last-1, inserts before the end anchor
});

test("apply mode 'adjust': inserts waypoint, dates + endDate UNCHANGED", () => {
  const r = applyAddStop(INPUT, "Barkerville, BC", [-121.5, 53.07], 0, 2, "adjust");
  assert.equal(r.input.anchors.length, 4);
  assert.equal(r.input.anchors[2].place, "Barkerville, BC");
  assert.equal(r.input.anchors[2].role, "waypoint");
  assert.equal(r.input.params.endDate, "2026-07-26"); // held
  assert.equal(r.input.anchors[3].date, "2026-07-26"); // Vancouver held
  assert.equal(r.newEndDate, null);
});

test("apply mode 'add-days': inserts waypoint AND pushes end +1 day", () => {
  const r = applyAddStop(INPUT, "Barkerville, BC", [-121.5, 53.07], 0, 2, "add-days");
  assert.equal(r.input.anchors.length, 4);
  assert.equal(r.input.params.endDate, "2026-07-27"); // pushed +1
  assert.equal(r.input.anchors[3].date, "2026-07-27"); // Vancouver +1
  assert.equal(r.newEndDate, "2026-07-27");
  // Start + Stewart untouched.
  assert.equal(r.input.anchors[0].date, "2026-07-13");
  assert.equal(r.input.anchors[1].date, "2026-07-18");
});

test("apply is pure — original input untouched", () => {
  applyAddStop(INPUT, "Barkerville, BC", [-121.5, 53.07], 0, 2, "add-days");
  assert.equal(INPUT.anchors.length, 3);
  assert.equal(INPUT.params.endDate, "2026-07-26");
});
