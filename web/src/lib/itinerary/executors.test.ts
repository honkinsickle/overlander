/**
 * Locks the reschedule / skip / stay-longer pure anchor-set mutations. Free —
 * no LLM, no routing. Run: npx tsx --test src/lib/itinerary/executors.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReschedule,
  applyStayLonger,
  applySkip,
  findAnchorIndex,
} from "./edit";
import type { GenerationInput } from "./facts";

const base = (): GenerationInput => ({
  anchors: [
    { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null },
    { place: "Stewart, British Columbia", role: "waypoint", datePin: "fixed", date: "2026-07-18", dwell: 1, note: null },
    { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null },
  ],
  params: {
    startDate: "2026-07-13", endDate: "2026-07-26", budget: "mid",
    maxDailyDriveMi: 350, bufferDays: 0, avoid: [], returnRouting: "shortest",
  },
  rig: { vehicle: "GX470", build: [], fuelRangeMi: 400, capability: "moderate", groupSize: "1", skill: "intermediate", preferences: [] },
});
const C: [number, number] = [-127.17, 54.78]; // Smithers-ish

test("findAnchorIndex: loose match on anchor names", () => {
  const a = base().anchors;
  assert.equal(findAnchorIndex(a, "Stewart"), 1); // first-word substring match
  assert.equal(findAnchorIndex(a, "Stewart, British Columbia"), 1); // exact
  assert.equal(findAnchorIndex(a, "Smithers"), -1); // pacing city, not an anchor
});

test("reschedule an EXISTING anchor: sets its date, no insert", () => {
  const r = applyReschedule(base(), "Stewart, British Columbia", C, "2026-07-19", 2);
  assert.equal(r.inserted, false);
  assert.equal(r.input.anchors.length, 3);
  assert.equal(r.input.anchors[1].date, "2026-07-19");
  assert.equal(r.input.anchors[1].datePin, "fixed");
});

test("reschedule a PACING CITY: inserts it as a fixed-date waypoint", () => {
  const r = applyReschedule(base(), "Smithers, BC", C, "2026-07-20", 2);
  assert.equal(r.inserted, true);
  assert.equal(r.input.anchors.length, 4);
  const s = r.input.anchors[2];
  assert.equal(s.place, "Smithers, BC");
  assert.equal(s.role, "waypoint");
  assert.equal(s.datePin, "fixed");
  assert.equal(s.date, "2026-07-20");
});

test("stay-longer on an anchor: bumps dwell", () => {
  const r = applyStayLonger(base(), "Stewart, British Columbia", C, 2, 2);
  assert.equal(r.inserted, false);
  assert.equal(r.input.anchors[1].dwell, 3); // was 1, +2
});

test("stay-longer on a pacing city: inserts a dwelled flexible waypoint", () => {
  const r = applyStayLonger(base(), "Smithers, BC", C, 1, 2);
  assert.equal(r.inserted, true);
  const s = r.input.anchors[2];
  assert.equal(s.dwell, 1);
  assert.equal(s.datePin, "flexible");
});

test("skip an anchor: removes it (never the endpoints)", () => {
  const r = applySkip(base(), ["Stewart, British Columbia"]);
  assert.deepEqual(r.removed, ["Stewart, British Columbia"]);
  assert.equal(r.input.anchors.length, 2); // Dawson + Vancouver
  assert.deepEqual(r.input.anchors.map((a) => a.role), ["start", "end"]);
});

test("skip pacing cities: adds them to avoid, anchors untouched", () => {
  const r = applySkip(base(), ["Green Lake Provincial Park", "Marble Canyon Provincial Park"]);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.avoided, ["Green Lake Provincial Park", "Marble Canyon Provincial Park"]);
  assert.deepEqual(r.input.params.avoid, ["Green Lake Provincial Park", "Marble Canyon Provincial Park"]);
  assert.equal(r.input.anchors.length, 3);
});

test("skip refuses to remove start/end → routes them to avoid instead", () => {
  const r = applySkip(base(), ["Vancouver, British Columbia"]);
  assert.deepEqual(r.removed, []); // end anchor NOT removed
  assert.equal(r.input.anchors.length, 3);
  assert.ok(r.avoided.includes("Vancouver, British Columbia"));
});

test("all applies are pure — original untouched", () => {
  const input = base();
  applyReschedule(input, "Stewart, British Columbia", C, "2026-07-19", 2);
  applySkip(input, ["Stewart, British Columbia"]);
  assert.equal(input.anchors.length, 3);
  assert.equal(input.anchors[1].date, "2026-07-18");
  assert.deepEqual(input.params.avoid, []);
});
