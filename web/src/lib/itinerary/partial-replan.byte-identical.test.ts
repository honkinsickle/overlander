/**
 * Locks the STRONGEST guarantee of partial re-plan: cleaving at day N and
 * re-planning the tail leaves days 1..N-1 BYTE-IDENTICAL, and never sends them
 * to the LLM. This was proven ONCE on 2026-07-17 via a since-deleted temp
 * script (the manual paid proof: 9 completed days, sha256=c2f8a6d1233881c7,
 * matching before the run and on the applied trip). This test makes that proof
 * a committed regression lock — pure, no LLM, no DB, no spend.
 *
 * The guarantee has two halves, mirroring the real pipeline in
 * `runGateStage` (edit-actions.ts):
 *   1. STITCH byte-identity — `stitchDays(completedDays, tailDays)` spreads the
 *      frozen prefix verbatim; a sha256 of the prefix is unchanged across a
 *      tail swap, and the prefix's ids/dates/dayNumbers are untouched while the
 *      tail is renumbered. Same for `stitchPolyline`: leading vertices (and the
 *      leading BYTES of the encoded line) match the stored geometry.
 *   2. NEVER SENT — `buildTailInput` produces the input we hand the LLM; it
 *      references ONLY resume→end, so no completed day can reach the model.
 *      Asserted on the input we'd send (not a real call), per the plan.
 *
 * Run: npx tsx --test src/lib/itinerary/partial-replan.byte-identical.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cleaveTrip,
  buildTailInput,
  stitchDays,
  stitchPolyline,
  endPlaceOf,
} from "./partial-replan";
import { encodePolyline } from "@/lib/routing/polyline";
import { decodePolyline } from "@/lib/routing/point-to-polyline";
import { FIXTURE_DAYS, FIXTURE_INPUT, FIXTURE_ROUTE_POLYLINE } from "./partial-replan.fixture";
import type { Day } from "@/lib/trips/types";

const sha256 = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** A DIFFERENT tail than the fixture's — proves the prefix hash is isolated
 *  from whatever the re-plan produces. Barkerville woven in, new coords/miles. */
function makeTail(specs: { date: string; label: string; miles: number }[]): Day[] {
  return specs.map((s, i) => ({
    // Deliberately mis-numbered from 1 — stitchDays must renumber to continue.
    id: `gen-${i}`,
    dayNumber: i + 1,
    date: s.date,
    label: s.label,
    startCoord: [-122 + i * 0.3, 53 - i * 0.4],
    coords: [-122.1 + i * 0.3, 52.9 - i * 0.4],
    miles: s.miles,
    driveHours: s.miles / 48,
    description: `Re-planned tail leg ${i + 1}.`,
    waypoints: [],
  }));
}

// Pinned once against the checked-in fixture (the sha256 of the frozen prefix,
// like the manual proof's c2f8a6d1233881c7). If the fixture prefix ever changes
// byte-for-byte, these fail loudly rather than silently drifting.
const SHA_PREFIX_9 = "cc1f04bb4dc4d53f9d3d6d0e10c1bf242cfea19685f77366b0575cc5c8c1a19c";
const SHA_PREFIX_13 = "92da9d4f1fe7cf9a541ce966231445742ab646c149fad94d34a5c2eb7959ade0";

test("PAID-PROOF LOCK: 9 completed days are BYTE-IDENTICAL across a tail re-plan (sha256)", () => {
  const cleave = cleaveTrip(FIXTURE_DAYS, { atPlace: "Prince George", today: "2026-07-22" });
  assert.equal(cleave.resumeIdx, 9);
  assert.equal(cleave.completedDays.length, 9);

  // Hash the frozen prefix BEFORE the run (captured from the baseline).
  const before = sha256(FIXTURE_DAYS.slice(0, 9));

  // Re-plan the tail into something DIFFERENT (5 fresh days) and stitch.
  const newTail = makeTail([
    { date: "2026-07-22", label: "Prince George, BC — Barkerville, BC", miles: 128 },
    { date: "2026-07-23", label: "Barkerville, BC — Clinton, BC", miles: 210 },
    { date: "2026-07-24", label: "Clinton, BC — Lillooet, BC", miles: 60 },
    { date: "2026-07-25", label: "Lillooet, BC — Hope, BC", miles: 130 },
    { date: "2026-07-26", label: "Hope, BC — Vancouver, British Columbia", miles: 93 },
  ]);
  const stitched = stitchDays(cleave.completedDays, newTail);

  // Hash the prefix of the APPLIED trip — must match the baseline byte-for-byte.
  const after = sha256(stitched.slice(0, 9));
  assert.equal(after, before, "frozen prefix hash drifted across the tail re-plan");
  assert.equal(before, SHA_PREFIX_9, "fixture prefix bytes changed — re-pin if intentional");

  // Same bytes, not "looks the same": every prefix object is untouched.
  for (let i = 0; i < 9; i++) {
    assert.deepEqual(stitched[i], FIXTURE_DAYS[i]);
  }
});

test("renumbering never mutates the frozen prefix; ids regenerated only on the tail", () => {
  const cleave = cleaveTrip(FIXTURE_DAYS, { atPlace: "Prince George", today: "2026-07-22" }); // resumeIdx 9
  // A SHORTER tail (3 days) than the original 5 — the prefix must not shift.
  const newTail = makeTail([
    { date: "2026-07-22", label: "Prince George, BC — Clinton, BC", miles: 240 },
    { date: "2026-07-23", label: "Clinton, BC — Hope, BC", miles: 145 },
    { date: "2026-07-24", label: "Hope, BC — Vancouver, British Columbia", miles: 93 },
  ]);
  const stitched = stitchDays(cleave.completedDays, newTail);
  assert.equal(stitched.length, 12);

  // Prefix ids / dates / dayNumbers untouched.
  for (let i = 0; i < 9; i++) {
    assert.equal(stitched[i].id, FIXTURE_DAYS[i].id);
    assert.equal(stitched[i].date, FIXTURE_DAYS[i].date);
    assert.equal(stitched[i].dayNumber, FIXTURE_DAYS[i].dayNumber);
  }
  // Tail ids regenerated to continue the sequence (day-10, 11, 12), NOT gen-*.
  assert.equal(stitched[9].id, "day-10");
  assert.equal(stitched[9].dayNumber, 10);
  assert.equal(stitched[11].id, "day-12");
  assert.equal(stitched[11].dayNumber, 12);
  // Tail dates are the generated ones (prefix dates are the frozen ones).
  assert.equal(stitched[9].date, "2026-07-22");
  assert.equal(stitched[9].label, "Prince George, BC — Clinton, BC");
});

test("NEVER SENT: the tail input references only resume→end; no completed day reaches the LLM", () => {
  const cleave = cleaveTrip(FIXTURE_DAYS, { atPlace: "Prince George", today: "2026-07-22" });
  const tail = buildTailInput(FIXTURE_INPUT, cleave);

  // The synthetic start is PG (the resume point); the end is Vancouver.
  assert.equal(tail.anchors[0].role, "start");
  assert.equal(tail.anchors[0].place, "Prince George, BC");
  assert.equal(tail.anchors[tail.anchors.length - 1].role, "end");
  assert.equal(tail.anchors[tail.anchors.length - 1].place, "Vancouver, British Columbia");
  assert.equal(tail.params.startDate, cleave.resumeDate);

  // Every dated anchor in the tail is at/after the resume date — nothing behind.
  for (const a of tail.anchors) {
    if (a.date) assert.ok(a.date >= cleave.resumeDate, `${a.place} (${a.date}) is behind resume`);
  }

  // The whole serialized input we'd hand the model contains NO completed-only
  // place — Stewart (a dropped fixed anchor) and the earlier legs are absent.
  const wire = JSON.stringify(tail);
  for (const gone of ["Dawson", "Whitehorse", "Watson Lake", "Dease Lake", "Bell II", "Meziadin", "Stewart", "Smithers"]) {
    assert.ok(!wire.includes(gone), `completed-only place "${gone}" leaked into the tail input`);
  }

  // Structural proof the completed DAYS can't influence the input: emptying the
  // completedDays on the cleave yields an IDENTICAL tail input. buildTailInput
  // reads anchors/params, never the frozen day payloads.
  const tailNoPrefix = buildTailInput(FIXTURE_INPUT, { ...cleave, completedDays: [] });
  assert.deepEqual(tailNoPrefix, tail);
});

test("stitchPolyline: leading vertices AND leading encoded bytes match the stored geometry", () => {
  const full = decodePolyline(FIXTURE_ROUTE_POLYLINE);
  const cleave = cleaveTrip(FIXTURE_DAYS, { atPlace: "Prince George", today: "2026-07-22" });
  // Resume at PG — the start of the resume day (a real spine vertex).
  const resumeCoords = FIXTURE_DAYS[cleave.resumeIdx].startCoord!;
  // A recalculated tail heading somewhere new from PG.
  const tailCoords: [number, number][] = [
    resumeCoords, [-122.2, 53.3], [-122.4, 52.6], [-123.12, 49.2827],
  ];

  const out = stitchPolyline(full, resumeCoords, tailCoords);

  // Find the leading run where the stitched line equals the source line.
  let k = 0;
  while (k < out.length && k < full.length && out[k][0] === full[k][0] && out[k][1] === full[k][1]) k++;

  assert.ok(k >= 1, "no frozen prefix survived the stitch");
  // Byte-identical coordinates for the whole prefix.
  assert.deepEqual(out.slice(0, k), full.slice(0, k));
  // The cut lands at/before PG, and the source keeps going past it (diverges).
  assert.ok(k < full.length, "stitch kept the entire source — nothing recalculated");
  // Everything after the cut is the recalculated tail (boundary vertex deduped).
  assert.deepEqual(out.slice(k), tailCoords.slice(tailCoords.length - (out.length - k)));

  // BYTE-LEVEL: because the polyline is delta-encoded from the origin, an
  // identical coordinate prefix ⇒ identical leading bytes. The stored string
  // and the re-encoded stitch share those exact leading bytes.
  const encPrefix = encodePolyline(full.slice(0, k));
  assert.ok(FIXTURE_ROUTE_POLYLINE.startsWith(encPrefix), "stored polyline prefix bytes differ");
  assert.ok(encodePolyline(out).startsWith(encPrefix), "stitched polyline prefix bytes differ");
});

test("edge — cleave at day 1: full re-plan, no frozen prefix", () => {
  const cleave = cleaveTrip(FIXTURE_DAYS, { atDay: 1, today: "2026-07-13" });
  assert.equal(cleave.resumeIdx, 0);
  assert.equal(cleave.completedDays.length, 0);
  assert.equal(cleave.syntheticStart, null);
  // buildTailInput returns the FULL input unchanged (a normal whole-trip run).
  assert.equal(buildTailInput(FIXTURE_INPUT, cleave), FIXTURE_INPUT);
  // stitchDays from an empty prefix = the tail IS the whole trip, renumbered.
  const tail = makeTail([{ date: "2026-07-13", label: "Dawson City, Yukon — Whitehorse, YT", miles: 332 }]);
  const stitched = stitchDays(cleave.completedDays, tail);
  assert.equal(stitched.length, 1);
  assert.equal(stitched[0].id, "day-1");
  assert.equal(stitched[0].dayNumber, 1);
});

test("edge — cleave at the last day: 13 frozen, only day 14 regenerates (byte-identical)", () => {
  const cleave = cleaveTrip(FIXTURE_DAYS, { atDay: 14, today: "2026-07-26" });
  assert.equal(cleave.resumeIdx, 13);
  assert.equal(cleave.completedDays.length, 13);
  assert.equal(cleave.syntheticStart!.place, "Hope, BC"); // end of day 13

  const before = sha256(FIXTURE_DAYS.slice(0, 13));
  assert.equal(before, SHA_PREFIX_13, "fixture 13-day prefix bytes changed — re-pin if intentional");

  const newTail = makeTail([{ date: "2026-07-26", label: "Hope, BC — Vancouver, British Columbia", miles: 100 }]);
  const stitched = stitchDays(cleave.completedDays, newTail);
  assert.equal(stitched.length, 14);
  assert.equal(sha256(stitched.slice(0, 13)), before);
  assert.equal(stitched[13].id, "day-14");
  assert.equal(stitched[13].dayNumber, 14);

  // Tail input starts at Hope (synthetic) and ends at Vancouver. Barkerville
  // (flexible/undated) rides along — buildTailInput keeps flexible anchors in
  // the MVP; the action layer prunes already-passed ones via route position.
  const tail = buildTailInput(FIXTURE_INPUT, cleave);
  assert.equal(tail.anchors[0].place, "Hope, BC");
  assert.equal(tail.anchors[0].role, "start");
  assert.equal(tail.anchors[tail.anchors.length - 1].place, "Vancouver, British Columbia");
  assert.equal(tail.anchors[tail.anchors.length - 1].role, "end");
});

test("edge — layover day at the boundary (last-frozen and first-resumed)", () => {
  // (a) Day 7 (Stewart→Stewart layover) is the LAST frozen day: cleave at day 8.
  const atDay8 = cleaveTrip(FIXTURE_DAYS, { atDay: 8, today: "2026-07-20" });
  assert.equal(atDay8.resumeIdx, 7);
  assert.equal(atDay8.completedDays.length, 7);
  // The layover is in the frozen prefix, verbatim.
  assert.equal(endPlaceOf(atDay8.completedDays[6]), "Stewart, British Columbia");
  assert.deepEqual(atDay8.completedDays[6], FIXTURE_DAYS[6]);
  // Synthetic start = the layover day's end (Stewart).
  assert.equal(atDay8.syntheticStart!.place, "Stewart, British Columbia");
  const before7 = sha256(FIXTURE_DAYS.slice(0, 7));
  const stitched = stitchDays(atDay8.completedDays, makeTail([{ date: "2026-07-20", label: "Stewart, British Columbia — Smithers, BC", miles: 204 }]));
  assert.equal(sha256(stitched.slice(0, 7)), before7); // layover survives byte-for-byte

  // (b) Day 7 is the FIRST resumed (re-plannable) day: cleave at day 7.
  const atDay7 = cleaveTrip(FIXTURE_DAYS, { atDay: 7, today: "2026-07-19" });
  assert.equal(atDay7.resumeIdx, 6);
  assert.equal(atDay7.completedDays.length, 6);
  // The layover is NOT frozen — it's re-plannable, so it's outside the prefix.
  assert.equal(atDay7.completedDays.length, 6);
  assert.equal(endPlaceOf(atDay7.completedDays[5]), "Stewart, British Columbia"); // day 6 end
  assert.equal(atDay7.syntheticStart!.place, "Stewart, British Columbia"); // end of day 6
  assert.deepEqual(atDay7.completedDays, FIXTURE_DAYS.slice(0, 6));
});
