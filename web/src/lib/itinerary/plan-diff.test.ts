/**
 * Locks the diff summary against the real before/after from the proven
 * Salmon Glacier re-plan (2026-07-16): +3 Cassiar park nights, −2 layovers
 * (Smithers, Lytton rest days gone), Whitehorse layover survived, endpoints
 * held. Run with: npx tsx --test src/lib/itinerary/plan-diff.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanDiff } from "./plan-diff";

const d = (date: string, miles: number, label: string) => ({ date, miles, label });

// The original 14-day plan (abridged labels, real shape).
const BEFORE = [
  d("2026-07-13", 332, "Dawson City, Yukon — Whitehorse, YT"),
  d("2026-07-14", 0, "Whitehorse, YT — Whitehorse, YT"),
  d("2026-07-15", 272, "Whitehorse, YT — Watson Lake, YT"),
  d("2026-07-16", 159, "Watson Lake, YT — Dease Lake, BC"),
  d("2026-07-17", 244, "Dease Lake, BC — Stewart, British Columbia"),
  d("2026-07-18", 56, "Stewart, British Columbia — Stewart, British Columbia"),
  d("2026-07-19", 204, "Stewart, British Columbia — Smithers, BC"),
  d("2026-07-20", 0, "Smithers, BC — Smithers, BC"),
  d("2026-07-21", 231, "Smithers, BC — Prince George, BC"),
  d("2026-07-22", 149, "Prince George, BC — Williams Lake, BC"),
  d("2026-07-23", 181, "Williams Lake, BC — Lytton, BC"),
  d("2026-07-24", 40, "Lytton, BC — Lytton, BC"),
  d("2026-07-25", 68, "Lytton, BC — Hope, BC"),
  d("2026-07-26", 93, "Hope, BC — Vancouver, British Columbia"),
];

// The re-planned 14 days (Stewart pinned to 7/19).
const AFTER = [
  d("2026-07-13", 332, "Dawson City, Yukon — Whitehorse, YT"),
  d("2026-07-14", 0, "Whitehorse, YT — Whitehorse, YT"),
  d("2026-07-15", 272, "Whitehorse, YT — Watson Lake, YT"),
  d("2026-07-16", 68, "Watson Lake, YT — Boya Lake Provincial Park"),
  d("2026-07-17", 176, "Boya Lake Provincial Park — Kinaskan Lake Provincial Park"),
  d("2026-07-18", 125, "Kinaskan Lake Provincial Park — Meziadin Lake Provincial Park"),
  d("2026-07-19", 38, "Meziadin Lake Provincial Park — Stewart, British Columbia"),
  d("2026-07-20", 90, "Stewart, British Columbia — Stewart, British Columbia"),
  d("2026-07-21", 204, "Stewart, British Columbia — Smithers, BC"),
  d("2026-07-22", 231, "Smithers, BC — Prince George, BC"),
  d("2026-07-23", 149, "Prince George, BC — Williams Lake, BC"),
  d("2026-07-24", 181, "Williams Lake, BC — Lytton, BC"),
  d("2026-07-25", 68, "Lytton, BC — Hope, BC"),
  d("2026-07-26", 93, "Hope, BC — Vancouver, British Columbia"),
];

test("Salmon Glacier re-plan diff: parks added, rest days traded, endpoints held", () => {
  const diff = computePlanDiff(BEFORE, AFTER, {
    place: "Stewart, British Columbia",
    date: "2026-07-19",
  });

  assert.deepEqual(diff.endpointsHeld, { start: true, end: true });
  // Whitehorse + Stewart out-and-back + Smithers + Lytton = 4 before;
  // Whitehorse + Stewart excursion = 2 after.
  assert.deepEqual(diff.layovers, { before: 4, after: 2 });
  assert.deepEqual(
    [...diff.stopsAdded].sort(),
    [
      "Boya Lake Provincial Park",
      "Kinaskan Lake Provincial Park",
      "Meziadin Lake Provincial Park",
    ],
  );
  assert.deepEqual(diff.stopsRemoved, ["Dease Lake, BC"]);
  assert.equal(diff.days.length, 14);
  // The pin is visible in the after-table: a Stewart arrival on 7/19.
  const pinnedDay = diff.days.find((day) => day.date === "2026-07-19");
  assert.ok(pinnedDay?.label.endsWith("Stewart, British Columbia"));
});
