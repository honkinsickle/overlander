/**
 * Tests for the stretch-assignment pure functions (spec § node-stack, drive as
 * container). Run: npx tsx --test src/lib/corridor/stretches.test.ts
 *
 * Equator fixtures: 1° lng = 69.09318 mi (matching point-to-polyline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayStartMiles,
  positionPlacesOnDay,
  assignPlacesToStretches,
  type PositionedPlace,
} from "./stretches";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

function line(fromDeg: number, toDeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = fromDeg; d <= toDeg + 1e-9; d += 0.25) out.push([d, 0]);
  return out;
}

function pos(
  entries: [string, number, boolean][],
): Map<string, PositionedPlace> {
  return new Map(
    entries.map(([id, dayMile, onCorridor]) => [
      id,
      { id, dayMile, offsetMi: onCorridor ? 0 : 99, onCorridor },
    ]),
  );
}

// ── dayStartMiles ──────────────────────────────────────────────────────────
test("dayStartMiles is the cumulative sum of prior day miles (dwell = 0)", () => {
  assert.deepEqual(
    dayStartMiles([{ miles: 332 }, { miles: 0 }, { miles: 313 }, { miles: 0 }]),
    [0, 332, 332, 645],
  );
});

// ── positionPlacesOnDay ────────────────────────────────────────────────────
test("positionPlacesOnDay projects coords → day-relative mile + offset", () => {
  const m = positionPlacesOnDay({
    line: line(0, 3),
    places: [
      { id: "on", coords: [1, 0] }, // 1° along, on the line
      { id: "off", coords: [1, 1] }, // 1° north → ~69 mi off
      { id: "nocoords" },
    ],
    dayStartMile: 0,
  });
  assert.ok(Math.abs(m.get("on")!.dayMile - MI_PER_DEG) < 0.5);
  assert.equal(m.get("on")!.onCorridor, true);
  assert.equal(m.get("off")!.onCorridor, false); // offset ~69 > 15mi buffer
  assert.equal(m.has("nocoords"), false); // no coords → skipped
});

test("positionPlacesOnDay subtracts the day's cumulative start mile", () => {
  // Day starts at route-mile 100; a place at route-mile ~169 → dayMile ~69.
  const m = positionPlacesOnDay({ line: line(0, 3), places: [{ id: "p", coords: [1, 0] }], dayStartMile: MI_PER_DEG });
  assert.ok(Math.abs(m.get("p")!.dayMile - 0) < 0.5); // 69 − 69 ≈ 0
});

// ── assignPlacesToStretches ────────────────────────────────────────────────
test("half-open interval: upstream node wins a tie at the boundary", () => {
  const { stretches } = assignPlacesToStretches({
    nodeMiles: [0, 100, 200],
    positioned: pos([["at100", 100, true], ["at150", 150, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["at100"]); // 100 → upstream stretch [0,100]
  assert.deepEqual(stretches[1].placeIds, ["at150"]); // 150 → [100,200]
});

test("a place past the last node clamps into the final stretch", () => {
  const { stretches, alongTheWay } = assignPlacesToStretches({
    nodeMiles: [0, 100],
    positioned: pos([["over", 120, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["over"]);
  assert.deepEqual(alongTheWay, []);
});

test("off-corridor is the ONLY thing in Along the way", () => {
  const { stretches, alongTheWay } = assignPlacesToStretches({
    nodeMiles: [0, 300],
    positioned: pos([["a", 37, true], ["detour", 155, false], ["b", 267, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["a", "b"]); // on-corridor, mile-ordered
  assert.deepEqual(alongTheWay, ["detour"]);
});

test("places within a stretch are ordered by mile ascending", () => {
  const { stretches } = assignPlacesToStretches({
    nodeMiles: [0, 400],
    positioned: pos([["c", 267, true], ["a", 37, true], ["b", 155, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["a", "b", "c"]);
});

test("a 1-node day has no stretch → on-corridor places fall to Along the way", () => {
  const { stretches, alongTheWay } = assignPlacesToStretches({
    nodeMiles: [0],
    positioned: pos([["a", 5, true]]),
  });
  assert.equal(stretches.length, 0);
  assert.deepEqual(alongTheWay, ["a"]);
});
