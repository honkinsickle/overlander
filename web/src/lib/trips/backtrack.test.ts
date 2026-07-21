/**
 * Backtrack detector — pricing an arbitrary place visit order by along-route
 * position. Run: npx tsx --test src/lib/trips/backtrack.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBacktracks } from "./backtrack";

// Real day-9 key stops: Burns Lake @ 372 mi, Nancy O's @ 514 mi.

test("clean forward order — no backtracks", () => {
  const r = detectBacktracks([
    { id: "a", milesFromStart: 10 },
    { id: "burns", milesFromStart: 372 },
    { id: "nancy", milesFromStart: 514 },
  ]);
  assert.equal(r.segments.length, 0);
  assert.equal(r.extraMiles, 0);
  assert.equal(r.positioned, 3);
});

test("single inversion — one segment, ~2×delta", () => {
  // Visit Nancy O's (514) before Burns Lake (372).
  const r = detectBacktracks([
    { id: "nancy", milesFromStart: 514 },
    { id: "burns", milesFromStart: 372 },
  ]);
  assert.equal(r.segments.length, 1);
  assert.deepEqual(
    [r.segments[0].fromId, r.segments[0].toId, r.segments[0].extraMiles],
    ["nancy", "burns", 284], // 2 × (514 − 372)
  );
  assert.equal(r.extraMiles, 284);
});

test("multiple inversions — each backward step priced and summed", () => {
  // 100→10 (back 90 ⇒ 180), 10→80 (forward), 80→20 (back 60 ⇒ 120).
  const r = detectBacktracks([
    { id: "a", milesFromStart: 100 },
    { id: "b", milesFromStart: 10 },
    { id: "c", milesFromStart: 80 },
    { id: "d", milesFromStart: 20 },
  ]);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(
    r.segments.map((s) => [s.fromId, s.toId, s.extraMiles]),
    [
      ["a", "b", 180],
      ["c", "d", 120],
    ],
  );
  assert.equal(r.extraMiles, 300);
});

test("place without milesFromStart is projected onto the day polyline", () => {
  // North–south day line (~69 mi for 1° latitude); a coords-only place sits
  // ~7 mi in (0.1°) and must be projected, not dropped.
  const dayLine: [number, number][] = [
    [0, 0],
    [0, 1],
  ];
  const r = detectBacktracks(
    [
      { id: "far", milesFromStart: 60 },
      { id: "proj", coords: [0, 0.1] }, // no miles — must project
    ],
    dayLine,
  );
  assert.equal(r.positioned, 2, "the projected place counts as positioned");
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].fromId, "far");
  assert.equal(r.segments[0].toId, "proj");
  // proj ≈ 6.9 mi → extra ≈ 2 × (60 − 6.9) ≈ 106.
  assert.ok(
    r.segments[0].toMiles > 4 && r.segments[0].toMiles < 10,
    `projected ~7 mi, got ${r.segments[0].toMiles}`,
  );
  assert.ok(
    r.extraMiles > 100 && r.extraMiles < 112,
    `~106, got ${r.extraMiles}`,
  );
});

test("fewer than 2 positioned places — empty report", () => {
  // Only one positioned.
  assert.deepEqual(detectBacktracks([{ id: "a", milesFromStart: 10 }]), {
    segments: [],
    extraMiles: 0,
    positioned: 1,
  });
  // Coords-only but NO polyline given → can't project → unpositioned.
  assert.deepEqual(
    detectBacktracks([
      { id: "a", coords: [0, 0] },
      { id: "b", coords: [0, 1] },
    ]),
    { segments: [], extraMiles: 0, positioned: 0 },
  );
  // Empty input.
  assert.deepEqual(detectBacktracks([]), {
    segments: [],
    extraMiles: 0,
    positioned: 0,
  });
});
