/**
 * Tests for moveCuratedPlace / removeCuratedPlace — the pure geometry-free core.
 * Run: npx tsx --test src/lib/trips/curated-place.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveCuratedPlace, removeCuratedPlace } from "./curated-place";
import type { Trip, Day, CorridorCity } from "./types";

// ── Fixture builders (only the fields the functions read; cast to satisfy the
//    wide Trip/Day types without constructing an entire itinerary). ──────────
function city(id: string): CorridorCity {
  return { id, name: id, kind: "corridor", coords: [0, 0], milesFromStart: 0, placeIds: [] };
}
function sugg(id: string) {
  return { id, title: id, coords: [0, 0] as [number, number] };
}
function day(id: string, opts: { nodes: string[]; suggestions: string[] }): Day {
  return {
    id,
    corridorCities: opts.nodes.map(city),
    segmentSuggestions: opts.suggestions.map(sugg),
    waypoints: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Day;
}
function trip(days: Day[], overlays: {
  placeOverrides?: { placeId: string; nodeId: string }[];
  placeRanks?: Record<string, { nodeId: string; rank: number }>;
} = {}): Trip {
  return {
    id: "trip-uuid",
    days,
    placeOverrides: overlays.placeOverrides ?? [],
    placeRanks: overlays.placeRanks ?? {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Trip;
}

const sIds = (d: Day) => (d.segmentSuggestions ?? []).map((p) => p.id);

// ── Move ─────────────────────────────────────────────────────────────────────
test("move: place leaves day A's suggestions and joins day B's", () => {
  const t = trip([
    day("day-1", { nodes: ["n-a"], suggestions: ["p1", "p2"] }),
    day("day-2", { nodes: ["n-b"], suggestions: ["p3"] }),
  ]);
  const out = moveCuratedPlace(t, "day-1", "day-2", "p1")!;
  assert.deepEqual(sIds(out.days[0]), ["p2"]);
  assert.deepEqual(sIds(out.days[1]), ["p3", "p1"]);
});

test("move: the moved stop's overlays DROP (v1 unranked+unpinned); others survive", () => {
  // p1 pinned+ranked to n-a (day 1); p3 pinned to n-b (day 2). Move p1 → day 2.
  const t = trip(
    [
      day("day-1", { nodes: ["n-a"], suggestions: ["p1"] }),
      day("day-2", { nodes: ["n-b"], suggestions: ["p3"] }),
    ],
    {
      placeOverrides: [
        { placeId: "p1", nodeId: "n-a" },
        { placeId: "p3", nodeId: "n-b" },
      ],
      placeRanks: {
        p1: { nodeId: "n-a", rank: 0 },
        p3: { nodeId: "n-b", rank: 0 },
      },
    },
  );
  const out = moveCuratedPlace(t, "day-1", "day-2", "p1")!;
  // p1's overlay is gone (its n-a home is on day 1, which no longer holds p1;
  // day 2 has no n-a) — dropped. p3 untouched.
  assert.deepEqual(out.placeOverrides, [{ placeId: "p3", nodeId: "n-b" }]);
  assert.deepEqual(out.placeRanks, { p3: { nodeId: "n-b", rank: 0 } });
});

test("move: a stop that happens to keep a matching node on the new day survives", () => {
  // Both days share node n-shared; p1 pinned to n-shared stays valid after move.
  const t = trip(
    [
      day("day-1", { nodes: ["n-shared"], suggestions: ["p1"] }),
      day("day-2", { nodes: ["n-shared"], suggestions: [] }),
    ],
    { placeOverrides: [{ placeId: "p1", nodeId: "n-shared" }] },
  );
  const out = moveCuratedPlace(t, "day-1", "day-2", "p1")!;
  assert.deepEqual(out.placeOverrides, [{ placeId: "p1", nodeId: "n-shared" }]);
});

test("move: a stop with no overlay just moves, overlays untouched", () => {
  const t = trip([
    day("day-1", { nodes: ["n-a"], suggestions: ["p1"] }),
    day("day-2", { nodes: ["n-b"], suggestions: [] }),
  ]);
  const out = moveCuratedPlace(t, "day-1", "day-2", "p1")!;
  assert.deepEqual(sIds(out.days[1]), ["p1"]);
  assert.deepEqual(out.placeOverrides, []);
  assert.deepEqual(out.placeRanks, {});
});

test("move: same day → null; unknown place → null; unknown day → null", () => {
  const t = trip([
    day("day-1", { nodes: ["n-a"], suggestions: ["p1"] }),
    day("day-2", { nodes: ["n-b"], suggestions: [] }),
  ]);
  assert.equal(moveCuratedPlace(t, "day-1", "day-1", "p1"), null);
  assert.equal(moveCuratedPlace(t, "day-1", "day-2", "nope"), null);
  assert.equal(moveCuratedPlace(t, "day-1", "day-9", "p1"), null);
});

test("move: a waypoint id is not a curated tile → null (not found in suggestions)", () => {
  const t = trip([
    day("day-1", { nodes: ["n-a"], suggestions: ["p1"] }),
    day("day-2", { nodes: ["n-b"], suggestions: [] }),
  ]);
  // wp-x lives in waypoints (not modeled here) — never in segmentSuggestions.
  assert.equal(moveCuratedPlace(t, "day-1", "day-2", "wp-x"), null);
});

// ── Remove ───────────────────────────────────────────────────────────────────
test("remove: place leaves suggestions and its overlays drop; others survive", () => {
  const t = trip(
    [day("day-1", { nodes: ["n-a"], suggestions: ["p1", "p2"] })],
    {
      placeOverrides: [
        { placeId: "p1", nodeId: "n-a" },
        { placeId: "p2", nodeId: "n-a" },
      ],
      placeRanks: { p1: { nodeId: "n-a", rank: 0 } },
    },
  );
  const out = removeCuratedPlace(t, "day-1", "p1")!;
  assert.deepEqual(sIds(out.days[0]), ["p2"]);
  assert.deepEqual(out.placeOverrides, [{ placeId: "p2", nodeId: "n-a" }]);
  assert.deepEqual(out.placeRanks, {});
});

test("remove: unknown place/day → null", () => {
  const t = trip([day("day-1", { nodes: ["n-a"], suggestions: ["p1"] })]);
  assert.equal(removeCuratedPlace(t, "day-1", "nope"), null);
  assert.equal(removeCuratedPlace(t, "day-9", "p1"), null);
});
