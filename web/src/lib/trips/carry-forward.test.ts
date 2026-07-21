/**
 * Locks the regeneration carry-forward contract (spec § node-stack model):
 * node seeds + POI overrides MUST survive a regeneration cycle intact. This is
 * the guard the plan called for — "one explicit line in the regen action" is
 * exactly how routePolyline and per-day coords were lost by omission before, so
 * the survival is a test, not discipline. Run with:
 *   npx tsx --test src/lib/trips/carry-forward.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  carryUserAuthored,
  assertUserAuthoredCarried,
  finalizeUserAuthored,
} from "./carry-forward";
import type { Trip, NodeSeed, PlaceNodeOverride } from "./types";

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t",
    title: "T",
    startDate: "2026-07-20",
    endDate: "2026-07-27",
    startLocation: "A",
    endLocation: "B",
    weatherHiF: 70,
    weatherLoF: 50,
    days: [],
    ...over,
  };
}

const seeds: NodeSeed[] = [
  { id: "seed-wells-bc", name: "Wells, BC", coords: [-121.6, 53.1], createdAt: "2026-07-20T12:00:00Z" },
];
const overrides: PlaceNodeOverride[] = [
  { placeId: "barkerville", nodeId: "seed-wells-bc" },
];
const ranks: Record<string, { nodeId: string; rank: number }> = {
  barkerville: { nodeId: "seed-wells-bc", rank: 0 },
};

test("seeds + overrides survive a regeneration cycle intact", () => {
  const prev = trip({
    nodeSeeds: seeds,
    placeOverrides: overrides,
    days: [{ id: "old", dayNumber: 1, date: "2026-07-20", label: "A — B", waypoints: [] }],
  });
  // A fresh regenerated body: different days, no user overlays (the generator
  // never emits them).
  const regenerated = trip({
    days: [
      { id: "new1", dayNumber: 1, date: "2026-07-20", label: "A — X", waypoints: [] },
      { id: "new2", dayNumber: 2, date: "2026-07-21", label: "X — B", waypoints: [] },
    ],
  });

  const out = carryUserAuthored(prev, regenerated);

  // Generated content wins…
  assert.equal(out.days.length, 2);
  assert.equal(out.days[0].id, "new1");
  // …but the user overlays are carried forward byte-for-byte.
  assert.deepEqual(out.nodeSeeds, seeds);
  assert.deepEqual(out.placeOverrides, overrides);
});

test("placeRanks survive a regeneration cycle (authored order carries)", () => {
  const prev = trip({ nodeSeeds: seeds, placeOverrides: overrides, placeRanks: ranks });
  const out = carryUserAuthored(prev, trip());
  assert.deepEqual(out.placeRanks, ranks);
});

test("guard: throws loud when regeneration drops placeRanks", () => {
  const original = trip({ placeRanks: ranks });
  assert.throws(() => assertUserAuthoredCarried(original, trip()), /placeRanks/);
});

test("carry does not mutate the regenerated trip's other fields", () => {
  const prev = trip({ nodeSeeds: seeds });
  const regenerated = trip({ title: "Regenerated", routePolyline: "abc" });
  const out = carryUserAuthored(prev, regenerated);
  assert.equal(out.title, "Regenerated");
  assert.equal(out.routePolyline, "abc");
  assert.deepEqual(out.nodeSeeds, seeds);
});

test("no prior overlays → nothing invented (both stay undefined)", () => {
  const out = carryUserAuthored(trip(), trip());
  assert.equal(out.nodeSeeds, undefined);
  assert.equal(out.placeOverrides, undefined);
});

test("guard: seedless trips pass (dormant today — the current state)", () => {
  assert.doesNotThrow(() => assertUserAuthoredCarried(trip(), trip()));
});

test("guard: throws loud when regeneration drops overlays", () => {
  const original = trip({ nodeSeeds: seeds, placeOverrides: overrides });
  const dropped = trip(); // regenerated body with the overlays lost
  assert.throws(
    () => assertUserAuthoredCarried(original, dropped),
    /nodeSeeds \+ placeOverrides/,
  );
});

test("guard: passes when the overlays were carried forward", () => {
  const original = trip({ nodeSeeds: seeds, placeOverrides: overrides });
  const carried = carryUserAuthored(original, trip());
  assert.doesNotThrow(() => assertUserAuthoredCarried(original, carried));
});

test("finalizeUserAuthored carries overlays AND passes the guard (wired unit)", () => {
  const original = trip({ nodeSeeds: seeds, placeOverrides: overrides });
  const regenerated = trip({
    title: "Regenerated",
    days: [{ id: "new1", dayNumber: 1, date: "2026-07-20", label: "A — B", waypoints: [] }],
  });
  const out = finalizeUserAuthored(original, regenerated);
  assert.equal(out.title, "Regenerated"); // generated content wins
  assert.deepEqual(out.nodeSeeds, seeds); // overlays carried
  assert.deepEqual(out.placeOverrides, overrides);
});

test("finalizeUserAuthored is a no-op for a seedless trip", () => {
  const out = finalizeUserAuthored(trip(), trip({ title: "R" }));
  assert.equal(out.title, "R");
  assert.equal(out.nodeSeeds, undefined);
});
