/**
 * Tests for alongRouteMiles() — the shared along-route projection helper
 * (docs/corridor-cities-spec.md §2.4). Run with:
 *   npx tsx --test src/lib/routing/point-to-polyline.test.ts
 *
 * Fixtures sit on the equator / meridians so expected distances are
 * hand-verifiable: 1° of arc = 6371 km · π/180 = 111.19493 km = 69.09318 mi
 * (matching the module's EARTH_KM constant).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alongRouteMiles } from "./point-to-polyline";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

function assertClose(actual: number, expected: number, tolMi: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolMi,
    `${label}: expected ${expected.toFixed(4)} ±${tolMi}, got ${actual.toFixed(4)}`,
  );
}

// Straight 2-segment line along the equator: [0,0] → [1,0] → [2,0]
const EQUATOR: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 0],
];

test("point exactly on the line: offset ~0, correct cumulative miles", () => {
  const r = alongRouteMiles([1.5, 0], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 1.5 * MI_PER_DEG, 0.1, "miles");
  assertClose(r.offsetMi, 0, 0.01, "offsetMi");
});

test("perpendicular offset from mid-segment: correct miles + nonzero offset", () => {
  const r = alongRouteMiles([0.5, 0.1], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 0.5 * MI_PER_DEG, 0.1, "miles");
  assertClose(r.offsetMi, 0.1 * MI_PER_DEG, 0.05, "offsetMi");
});

test("point near the start: miles ~0", () => {
  const r = alongRouteMiles([0, 0.05], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 0, 0.05, "miles");
  assertClose(r.offsetMi, 0.05 * MI_PER_DEG, 0.05, "offsetMi");
});

test("point near the end: miles ~total length", () => {
  const r = alongRouteMiles([2, 0.05], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 2 * MI_PER_DEG, 0.1, "miles");
  assertClose(r.offsetMi, 0.05 * MI_PER_DEG, 0.05, "offsetMi");
});

test("point beyond the end clamps to the end vertex", () => {
  const r = alongRouteMiles([2.5, 0], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 2 * MI_PER_DEG, 0.1, "miles (clamped to total)");
  assertClose(r.offsetMi, 0.5 * MI_PER_DEG, 0.1, "offsetMi (distance to end vertex)");
});

test("point before the start clamps to the start vertex", () => {
  const r = alongRouteMiles([-0.5, 0], EQUATOR);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 0, 0.01, "miles (clamped to 0)");
  assertClose(r.offsetMi, 0.5 * MI_PER_DEG, 0.1, "offsetMi (distance to start vertex)");
});

test("multi-segment polyline accumulates miles across a turn", () => {
  // East along the equator, then north up the meridian: [0,0] → [1,0] → [1,1].
  // A point abeam the second segment's midpoint must include the full
  // length of segment 1 plus half of segment 2.
  const L: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const r = alongRouteMiles([1.01, 0.5], L);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 1.5 * MI_PER_DEG, 0.1, "miles");
  // 0.01° of longitude at lat 0.5° — cos(0.5°) ≈ 1
  assertClose(r.offsetMi, 0.01 * MI_PER_DEG, 0.05, "offsetMi");
});

test("single-point path: miles 0, offset = haversine to that point", () => {
  const r = alongRouteMiles([1, 0], [[0, 0]]);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 0, 0.001, "miles");
  assertClose(r.offsetMi, MI_PER_DEG, 0.05, "offsetMi");
});

test("empty path returns null", () => {
  assert.equal(alongRouteMiles([0, 0], []), null);
});

test("accepts an encoded polyline string", () => {
  // Google's canonical example decodes to [lng,lat]:
  // [-120.2, 38.5] → [-120.95, 40.7] → [-126.453, 43.252]
  const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
  const r = alongRouteMiles([-120.2, 38.5], encoded);
  assert.ok(r, "expected a result");
  assertClose(r.miles, 0, 0.05, "miles (at first vertex)");
  assertClose(r.offsetMi, 0, 0.05, "offsetMi (on the line)");
});
