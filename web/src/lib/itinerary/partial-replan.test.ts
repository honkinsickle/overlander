/**
 * Locks the partial-replan cleave / tail-input / future-guard against a
 * SNAPSHOT of the TEST copy dawson-cassiar-livingplan-test (2026-07-17). Pure
 * — no LLM, no DB, no spend. Proves: cleaving at Prince George yields the
 * right synthetic start + resume date, drops passed anchors (Stewart) and
 * keeps the fixed end (Vancouver 7/26); an add-stop validates future-legal at
 * PG but past-illegal after Wells; a behind-schedule resumeDate (later than
 * the planned day date) is honored.
 * Run: npx tsx --test src/lib/itinerary/partial-replan.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleaveTrip,
  buildTailInput,
  isEditInFuture,
  endPlaceOf,
} from "./partial-replan";
import type { Day } from "@/lib/trips/types";
import type { GenerationInput } from "./facts";

// Snapshot: the 14-day table (Barkerville-via-Wells, Vancouver 7/26). Prince
// George is day 9 (index 8) in this reference pacing — the mechanism is
// day-number-agnostic.
const mk = (n: number, date: string, label: string, miles: number): Day => ({
  id: `day-${n}`,
  dayNumber: n,
  date,
  label,
  miles,
  waypoints: [],
});
const DAYS: Day[] = [
  mk(1, "2026-07-13", "Dawson City, Yukon — Whitehorse, YT", 332),
  mk(2, "2026-07-14", "Whitehorse, YT — Watson Lake, YT", 272),
  mk(3, "2026-07-15", "Watson Lake, YT — Dease Lake, BC", 159),
  mk(4, "2026-07-16", "Dease Lake, BC — Bell II, BC", 149),
  mk(5, "2026-07-17", "Bell II, BC — Meziadin Lake Provincial Park, BC", 57),
  mk(6, "2026-07-18", "Meziadin Lake Provincial Park, BC — Stewart, British Columbia", 38),
  mk(7, "2026-07-19", "Stewart, British Columbia — Stewart, British Columbia", 60),
  mk(8, "2026-07-20", "Stewart, British Columbia — Smithers, BC", 204),
  mk(9, "2026-07-21", "Smithers, BC — Prince George, BC", 231),
  mk(10, "2026-07-22", "Prince George, BC — Wells, BC", 113),
  mk(11, "2026-07-23", "Wells, BC — Wells, BC", 15),
  mk(12, "2026-07-24", "Wells, BC — Clinton, BC", 224),
  mk(13, "2026-07-25", "Clinton, BC — Hope, BC", 145),
  mk(14, "2026-07-26", "Hope, BC — Vancouver, British Columbia", 93),
];

const INPUT: GenerationInput = {
  anchors: [
    { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null },
    { place: "Stewart, British Columbia", role: "waypoint", datePin: "fixed", date: "2026-07-18", dwell: 1, note: null },
    { place: "Barkerville", role: "waypoint", datePin: "flexible", date: null, dwell: 0, note: null, coords: [-121.5, 53.07] },
    { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null },
  ],
  params: {
    startDate: "2026-07-13", endDate: "2026-07-26", budget: "mid",
    maxDailyDriveMi: 350, bufferDays: 0, avoid: [], returnRouting: "shortest",
  },
  rig: { vehicle: "GX470", build: [], fuelRangeMi: 400, capability: "moderate", groupSize: "1", skill: "intermediate", preferences: [] },
};

test("cleave by explicit place: 'I'm at Prince George' → completed through day 9, synthetic start = PG", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George" });
  assert.equal(c.resumeIdx, 9); // day-10 (PG→Wells) is the resume day
  assert.equal(c.completedDays.length, 9);
  assert.equal(endPlaceOf(c.completedDays[8]), "Prince George, BC");
  assert.ok(c.syntheticStart);
  assert.equal(c.syntheticStart!.place, "Prince George, BC");
  assert.equal(c.syntheticStart!.role, "start");
  assert.equal(c.syntheticStart!.datePin, "fixed");
  assert.equal(c.resumeDate, "2026-07-22"); // day-10's planned date (no today given)
  assert.equal(c.syntheticStart!.date, "2026-07-22");
});

test("cleave by date: today 2026-07-21 → resume day 9 (first date >= today)", () => {
  const c = cleaveTrip(DAYS, { today: "2026-07-21" });
  assert.equal(c.resumeIdx, 8); // day-9 (2026-07-21) is first date >= today
  assert.equal(c.resumeDate, "2026-07-21");
  assert.equal(c.syntheticStart!.place, "Smithers, BC"); // end of day 8
});

test("cleave by day number: 'I'm on day 10' → resume idx 9", () => {
  const c = cleaveTrip(DAYS, { atDay: 10 });
  assert.equal(c.resumeIdx, 9);
  assert.equal(c.syntheticStart!.place, "Prince George, BC");
});

test("tail input at PG: synthetic start + Vancouver held, Stewart dropped (date passed)", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George" });
  const tail = buildTailInput(INPUT, c);
  const places = tail.anchors.map((a) => a.place);
  // Stewart (fixed 7/18 < resume 7/22) is gone; Barkerville (flexible, ahead)
  // and Vancouver (fixed 7/26) remain, after the PG synthetic start.
  assert.deepEqual(places, ["Prince George, BC", "Barkerville", "Vancouver, British Columbia"]);
  assert.equal(tail.anchors[0].role, "start");
  assert.equal(tail.anchors[tail.anchors.length - 1].role, "end");
  assert.equal(tail.anchors[tail.anchors.length - 1].place, "Vancouver, British Columbia");
  assert.equal(tail.params.startDate, "2026-07-22"); // resume date
  assert.equal(tail.params.endDate, "2026-07-26"); // fixed end HELD
});

test("behind schedule: at PG but today is 2026-07-23 → resumeDate = reality (7/23), not planned 7/22", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-23" });
  assert.equal(c.resumeIdx, 9); // position from the place
  assert.equal(c.resumeDate, "2026-07-23"); // date from reality — the crux
  assert.equal(c.syntheticStart!.date, "2026-07-23");
  const tail = buildTailInput(INPUT, c);
  assert.equal(tail.params.startDate, "2026-07-23");
  assert.equal(tail.params.endDate, "2026-07-26"); // still must hit Vancouver 7/26 → tail compresses
});

test("edit-in-future: add Barkerville is legal at PG, illegal after Wells", () => {
  // Barkerville insert falls at ~day index 9 (the Wells days).
  const atPG = cleaveTrip(DAYS, { atPlace: "Prince George" }); // resumeIdx 9
  assert.deepEqual(isEditInFuture(atPG, { kind: "add-stop", insertDayIndex: 9 }), { ok: true });

  // "at Wells" matches the first day ENDING at Wells (day 10 → resume day 11).
  const afterWells = cleaveTrip(DAYS, { atPlace: "Wells" });
  assert.equal(afterWells.resumeIdx, 10);
  const check = isEditInFuture(afterWells, { kind: "add-stop", insertDayIndex: 9 });
  assert.equal(check.ok, false); // 9 < 10 → the PG→Wells insert is behind you
});

test("edit-in-future: arrive-by date in the past is rejected", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George" }); // resumeDate 7/22
  assert.equal(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-19" }).ok, false); // Stewart glacier, passed
  assert.deepEqual(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-24" }), { ok: true });
});

test("no prefix completed → full re-plan (null synthetic start, input unchanged)", () => {
  const c = cleaveTrip(DAYS, { atDay: 1 });
  assert.equal(c.resumeIdx, 0);
  assert.equal(c.syntheticStart, null);
  assert.equal(buildTailInput(INPUT, c), INPUT); // returns the full input
});
