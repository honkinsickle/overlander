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
  stitchDays,
  stitchPolyline,
  resolveEffectiveNow,
  type CompletedThrough,
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
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-18" });
  assert.equal(c.resumeIdx, 9); // day-10 (PG→Wells) is the resume day
  assert.equal(c.completedDays.length, 9);
  assert.equal(endPlaceOf(c.completedDays[8]), "Prince George, BC");
  assert.ok(c.syntheticStart);
  assert.equal(c.syntheticStart!.place, "Prince George, BC");
  assert.equal(c.syntheticStart!.role, "start");
  assert.equal(c.syntheticStart!.datePin, "fixed");
  assert.equal(c.resumeDate, "2026-07-18"); // reality (today), NOT the planned 7/22
  assert.equal(c.plannedResumeDate, "2026-07-22"); // day-10's planned date — plan-time only
  assert.equal(c.syntheticStart!.date, "2026-07-18");
});

test("cleave by date: today 2026-07-21 → resume day 9 (first date >= today)", () => {
  const c = cleaveTrip(DAYS, { today: "2026-07-21" });
  assert.equal(c.resumeIdx, 8); // day-9 (2026-07-21) is first date >= today
  assert.equal(c.resumeDate, "2026-07-21");
  assert.equal(c.syntheticStart!.place, "Smithers, BC"); // end of day 8
});

test("cleave by day number: 'I'm on day 10' → resume idx 9, resumeDate = today (not planned)", () => {
  const c = cleaveTrip(DAYS, { atDay: 10, today: "2026-07-18" });
  assert.equal(c.resumeIdx, 9);
  assert.equal(c.syntheticStart!.place, "Prince George, BC");
  assert.equal(c.resumeDate, "2026-07-18"); // day number is POSITION; date is today
  assert.equal(c.plannedResumeDate, "2026-07-22");
});

test("tail input at PG: synthetic start + Vancouver held, Stewart dropped (positionally passed)", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-18" });
  const tail = buildTailInput(INPUT, c);
  const places = tail.anchors.map((a) => a.place);
  // Stewart is dropped by PLAN-TIME position (planned 7/18 < plannedResume 7/22)
  // — even though its planned date EQUALS today (7/18), the ahead-of-schedule
  // trap. Barkerville (flexible, ahead) + Vancouver (7/26) remain after PG.
  assert.deepEqual(places, ["Prince George, BC", "Barkerville", "Vancouver, British Columbia"]);
  assert.equal(tail.anchors[0].role, "start");
  assert.equal(tail.anchors[tail.anchors.length - 1].role, "end");
  assert.equal(tail.anchors[tail.anchors.length - 1].place, "Vancouver, British Columbia");
  assert.equal(tail.params.startDate, "2026-07-18"); // real resume date, NOT planned 7/22
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
  const atPG = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-18" }); // resumeIdx 9
  assert.deepEqual(isEditInFuture(atPG, { kind: "add-stop", insertDayIndex: 9 }), { ok: true });

  // "at Wells" matches the first day ENDING at Wells (day 10 → resume day 11).
  const afterWells = cleaveTrip(DAYS, { atPlace: "Wells", today: "2026-07-18" });
  assert.equal(afterWells.resumeIdx, 10);
  const check = isEditInFuture(afterWells, { kind: "add-stop", insertDayIndex: 9 });
  assert.equal(check.ok, false); // 9 < 10 → the PG→Wells insert is behind you (position)
});

test("edit-in-future: arrive-by date before the REAL resume date is rejected", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-22" }); // on schedule
  assert.equal(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-19" }).ok, false); // before today
  assert.deepEqual(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-24" }), { ok: true });
});

test("no prefix completed → full re-plan (null synthetic start, input unchanged)", () => {
  const c = cleaveTrip(DAYS, { atDay: 1, today: "2026-07-13" });
  assert.equal(c.resumeIdx, 0);
  assert.equal(c.syntheticStart, null);
  assert.equal(buildTailInput(INPUT, c), INPUT); // returns the full input
});

test("stitchDays: completed kept verbatim, tail renumbered to continue", () => {
  const completed = DAYS.slice(0, 9); // days 1–9 (through PG)
  const tail: Day[] = [
    mk(1, "2026-07-22", "Prince George, BC — Wells, BC", 113),
    mk(2, "2026-07-23", "Wells, BC — Clinton, BC", 224),
  ];
  const stitched = stitchDays(completed, tail);
  assert.equal(stitched.length, 11);
  // Completed prefix is byte-identical (same objects).
  assert.equal(stitched[8], completed[8]);
  assert.equal(stitched[8].label, "Smithers, BC — Prince George, BC");
  // Tail renumbered to continue the sequence.
  assert.equal(stitched[9].dayNumber, 10);
  assert.equal(stitched[9].id, "day-10");
  assert.equal(stitched[9].label, "Prince George, BC — Wells, BC");
  assert.equal(stitched[10].dayNumber, 11);
  assert.equal(stitched[10].id, "day-11");
});

test("stitchPolyline: truncates at the resume point, grafts the tail", () => {
  // A simple west→east line at lat 50, mile-spaced-ish by degrees.
  const full: [number, number][] = [
    [-125, 50], [-124, 50], [-123, 50], [-122, 50], [-121, 50],
  ];
  // Resume near [-123,50] (~the middle); tail heads NORTH from there.
  const tail: [number, number][] = [[-123, 50], [-123, 51], [-123, 52]];
  const out = stitchPolyline(full, [-123, 50], tail);
  // Prefix up to ~[-123,50] + the northward tail, boundary deduped.
  assert.deepEqual(out[0], [-125, 50]); // starts at the trip origin
  assert.deepEqual(out[out.length - 1], [-123, 52]); // ends at the new tail end
  // The eastern part of the old line ([-122],[-121]) is GONE (recalculated away).
  assert.ok(!out.some((c) => c[0] === -121 || c[0] === -122));
  // No consecutive duplicate at the graft boundary.
  for (let i = 1; i < out.length; i++) {
    assert.ok(!(out[i][0] === out[i - 1][0] && out[i][1] === out[i - 1][1]));
  }
});

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION: cleaveTrip must not conflate POSITION with DATE. The real
// failure — at Prince George on Sat 7/18 (4 days AHEAD of the plan, which has
// PG on 7/22), "move Barkerville to Sun 7/19" was rejected as "already passed"
// because resumeDate was the planned 7/22 instead of today.
// ─────────────────────────────────────────────────────────────────────────

test("REGRESSION (ahead of schedule): at PG on 7/18 (planned 7/22) → resumeDate = today 7/18, and arrive-by 7/19 is LEGAL", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-18" });
  assert.equal(c.resumeIdx, 9); // position from the place — day 10
  assert.equal(c.resumeDate, "2026-07-18"); // WHEN = reality, NOT the planned 7/22
  assert.equal(c.plannedResumeDate, "2026-07-22"); // plan-time reference kept separate
  // The exact edit that was wrongly rejected: move Barkerville to Sun 7/19.
  assert.deepEqual(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-19" }), { ok: true });
});

test("behind schedule (today AFTER the planned date): at PG on 7/25 → resumeDate 7/25; a 7/23 arrive-by is correctly past", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-25" });
  assert.equal(c.resumeIdx, 9);
  assert.equal(c.resumeDate, "2026-07-25"); // reality, later than planned 7/22
  assert.equal(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-23" }).ok, false); // < today
  assert.deepEqual(isEditInFuture(c, { kind: "arrive-by", date: "2026-07-26" }), { ok: true });
});

test("atDay is POSITION only: 'day 10' with today 7/18 → resumeDate = today, never day 10's planned 7/22", () => {
  const c = cleaveTrip(DAYS, { atDay: 10, today: "2026-07-18" });
  assert.equal(c.resumeIdx, 9);
  assert.equal(c.resumeDate, "2026-07-18");
  assert.equal(c.syntheticStart!.date, "2026-07-18");
  assert.equal(c.plannedResumeDate, "2026-07-22");
});

test("frozen prefix keeps its ORIGINAL historical dates — ahead AND behind schedule", () => {
  for (const today of ["2026-07-18", "2026-07-25"]) {
    const c = cleaveTrip(DAYS, { atPlace: "Prince George", today });
    // Days 1..9 are sliced verbatim — their planned dates are untouched.
    assert.deepEqual(
      c.completedDays.map((d) => d.date),
      DAYS.slice(0, 9).map((d) => d.date),
    );
    assert.equal(c.completedDays[0].date, "2026-07-13"); // day 1 original
    assert.equal(c.completedDays[8].date, "2026-07-21"); // day 9 original
    assert.equal(c.resumeDate, today); // only the resume date reflects reality
  }
});

test("ahead-of-schedule tail has SLACK, not compression: PG 7/18 → Vancouver 7/26 = a 4-day leg with 8 days to run it", () => {
  const c = cleaveTrip(DAYS, { atPlace: "Prince George", today: "2026-07-18" });
  const tail = buildTailInput(INPUT, c);
  assert.equal(tail.params.startDate, "2026-07-18"); // tail starts today
  assert.equal(tail.params.endDate, "2026-07-26"); // Vancouver fixed end held
  // The window is 7/18 → 7/26 = 8 days for a leg the plan plotted in 4 → slack,
  // not the false compression the buggy 7/22 resumeDate would have implied.
  assert.deepEqual(tail.anchors.map((a) => a.place), [
    "Prince George, BC",
    "Barkerville",
    "Vancouver, British Columbia",
  ]);
});

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT CLEAVE: completedThrough is the trip's standing state, so a
// position-less edit ("add 2 days at the end") cleaves at the recorded point
// instead of regenerating already-driven days. resolveEffectiveNow picks the
// effective cleave spec: explicit > completedThrough > full/date-derived.
// ─────────────────────────────────────────────────────────────────────────

// The marker the earlier partial re-plan recorded: 9 days driven, through PG.
const CT: CompletedThrough = { dayNumber: 9, date: "2026-07-22", endPlace: "Prince George, BC" };

test("default cleave: completedThrough + a position-LESS edit → cleave at day 9, tail starts at PG, days 1-9 frozen", () => {
  // No explicit position in the utterance → the standing marker is the default.
  const eff = resolveEffectiveNow(DAYS.length, CT, undefined, "2026-07-18");
  assert.deepEqual(eff, { atDay: 10, today: "2026-07-18" }); // position from marker, date = today

  const c = cleaveTrip(DAYS, eff!);
  assert.equal(c.resumeIdx, 9);
  assert.equal(c.completedDays.length, 9);
  assert.equal(c.syntheticStart!.place, "Prince George, BC");
  // Days 1-9 are the frozen prefix, byte-for-byte.
  assert.deepEqual(c.completedDays, DAYS.slice(0, 9));
  // The tail regenerates from PG onward, not the whole 14 days.
  const tail = buildTailInput(INPUT, c);
  assert.equal(tail.anchors[0].place, "Prince George, BC");
  assert.equal(tail.params.startDate, "2026-07-18"); // real today, NOT the marker's 7/22
});

test("explicit position in the utterance OVERRIDES completedThrough", () => {
  // "I'm at Smithers" (day 8) must win over the recorded day-9 marker.
  const eff = resolveEffectiveNow(DAYS.length, CT, { atPlace: "Smithers", today: "2026-07-18" }, "2026-07-18");
  assert.deepEqual(eff, { atPlace: "Smithers", today: "2026-07-18" }); // explicit-wins, marker ignored
  const c = cleaveTrip(DAYS, eff!);
  assert.equal(endPlaceOf(c.completedDays[c.completedDays.length - 1]), "Smithers, BC");
  assert.equal(c.syntheticStart!.place, "Smithers, BC"); // day 8 end, not PG
});

test("no completedThrough → full re-plan (undefined) / date-derived preserved", () => {
  // Composer's position-less edit on a fresh trip → undefined → full re-plan.
  assert.equal(resolveEffectiveNow(DAYS.length, null, undefined, "2026-07-18"), undefined);
  // Replan-sheet's bare {today} (date-derived intent) is passed through untouched.
  assert.deepEqual(
    resolveEffectiveNow(DAYS.length, null, { today: "2026-07-18" }, "2026-07-18"),
    { today: "2026-07-18" },
  );
  // A stale marker past the (now shorter) trip is ignored, not thrown on.
  assert.equal(resolveEffectiveNow(5, CT, undefined, "2026-07-18"), undefined);
});

test("default cleave resumeDate is TODAY, never the marker's date — ahead AND behind", () => {
  for (const today of ["2026-07-18", "2026-07-25"]) {
    const eff = resolveEffectiveNow(DAYS.length, CT, undefined, today);
    assert.equal(eff!.today, today); // never CT.date (7/22)
    const c = cleaveTrip(DAYS, eff!);
    assert.equal(c.resumeDate, today);
    assert.equal(c.plannedResumeDate, "2026-07-22"); // plan-time kept separate
  }
});
