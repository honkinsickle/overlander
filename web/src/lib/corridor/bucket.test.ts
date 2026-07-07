/**
 * Tests for bucketPlacesIntoCorridor() — place→node bucketing (spec §2.3,
 * with the nearest-node-by-along-route-mile rule decided 2026-07-06).
 * Run with: npx tsx --test src/lib/corridor/bucket.test.ts
 *
 * Equator fixtures: 1° = 69.09318 mi (matching point-to-polyline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketPlacesIntoCorridor } from "./bucket";
import type { CorridorCity } from "@/lib/trips/types";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

/** Equator polyline 0→degLen, vertex every 0.25°. */
function line(degLen: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= degLen + 1e-9; d += 0.25) out.push([d, 0]);
  return out;
}

/** Spine: start@0, one corridor node @1°, end @2° — miles from the helper. */
function spine(): CorridorCity[] {
  return [
    { id: "start", name: "Start", kind: "start", coords: [0, 0], milesFromStart: 0, placeIds: [] },
    { id: "mid", name: "Mid", kind: "corridor", coords: [1, 0], milesFromStart: MI_PER_DEG, placeIds: [] },
    { id: "end", name: "End", kind: "end", coords: [2, 0], milesFromStart: 2 * MI_PER_DEG, placeIds: [] },
  ];
}

const at = (lngDeg: number, latDeg = 0) => ({ id: `p@${lngDeg}`, coords: [lngDeg, latDeg] as [number, number] });

function ids(cities: CorridorCity[], nodeId: string): string[] {
  return cities.find((c) => c.id === nodeId)!.placeIds;
}

test("place attaches to the nearest node by along-route mile", () => {
  // 0.9° ≈ 62 mi → nearest is Mid@69 (7 mi) over Start@0 (62 mi).
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(0.9)], line: line(2) });
  assert.deepEqual(ids(r, "mid"), ["p@0.9"]);
  assert.deepEqual(ids(r, "start"), []);
});

test("place near start attaches to start", () => {
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(0.1)], line: line(2) });
  assert.deepEqual(ids(r, "start"), ["p@0.1"]);
});

test("equidistant place tie-breaks upstream (smaller mile)", () => {
  // 1.5° is exactly midway between Mid@69 and End@138 (34.5 mi each).
  // Upstream wins → Mid. maxAttachMi widened so the gate doesn't drop it.
  const r = bucketPlacesIntoCorridor({
    cities: spine(),
    places: [at(1.5)],
    line: line(2),
    params: { maxAttachMi: 50 },
  });
  assert.deepEqual(ids(r, "mid"), ["p@1.5"]);
  assert.deepEqual(ids(r, "end"), []);
});

test("off-corridor place (offset > buffer_mi) does not bucket", () => {
  // 0.3° of latitude ≈ 20.7 mi off route > buffer_mi 15.
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(0.9, 0.3)], line: line(2) });
  assert.deepEqual(ids(r, "mid"), []);
  assert.deepEqual(ids(r, "start"), []);
  assert.deepEqual(ids(r, "end"), []);
});

test("place farther than max_attach_mi from every node does not bucket", () => {
  // 0.5° ≈ 34.5 mi — nearest node is 34.5 mi away > default maxAttachMi 25.
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(0.5)], line: line(2) });
  assert.deepEqual(ids(r, "start"), []);
  assert.deepEqual(ids(r, "mid"), []);
  assert.deepEqual(ids(r, "end"), []);
});

test("multiple places on one node order by placeMi ascending", () => {
  // Both within 25 mi of Mid@69: 0.95° (~66) and 0.85° (~59). Given out of
  // order; expect placeMi-ascending → 0.85 before 0.95.
  const r = bucketPlacesIntoCorridor({
    cities: spine(),
    places: [at(0.95), at(0.85)],
    line: line(2),
  });
  assert.deepEqual(ids(r, "mid"), ["p@0.85", "p@0.95"]);
});

test("place at a node's exact mile attaches to that node", () => {
  // 1.0° sits exactly on Mid@69 (offset 0, distance 0).
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(1.0)], line: line(2) });
  assert.deepEqual(ids(r, "mid"), ["p@1"]);
});

test("place past the end attaches to the end node", () => {
  // 1.95° ≈ 134.7 mi, within 25 of End@138.
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [at(1.95)], line: line(2) });
  assert.deepEqual(ids(r, "end"), ["p@1.95"]);
});

test("empty places leaves every node's placeIds empty", () => {
  const r = bucketPlacesIntoCorridor({ cities: spine(), places: [], line: line(2) });
  for (const c of r) assert.deepEqual(c.placeIds, []);
});

test("returns nodes unchanged when the line is unusable", () => {
  const s = spine();
  const r = bucketPlacesIntoCorridor({ cities: s, places: [at(0.9)], line: [[0, 0]] });
  assert.deepEqual(r, s);
});
