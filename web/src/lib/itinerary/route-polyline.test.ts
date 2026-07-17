/**
 * Locks assembleRoutePolyline: concatenate per-day geometry in day order,
 * skip null layover days, dedupe the shared day-boundary vertex, encode.
 * Round-trips through decodePolyline to prove the persisted line is the real
 * road (not straight lines). Run: npx tsx --test src/lib/itinerary/route-polyline.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRoutePolyline } from "./to-trip";
import { decodePolyline } from "@/lib/routing/point-to-polyline";
import type { DayRoute } from "./audit";

const dr = (n: number, polyline: [number, number][] | null): DayRoute => ({
  n,
  startCoord: polyline?.[0] ?? null,
  endCoord: polyline?.[polyline.length - 1] ?? null,
  polyline,
});

test("undefined / empty input → undefined (nothing to draw)", () => {
  assert.equal(assembleRoutePolyline(undefined), undefined);
  assert.equal(assembleRoutePolyline([]), undefined);
  assert.equal(assembleRoutePolyline([dr(1, null), dr(2, null)]), undefined);
});

test("concatenates in day order, dedupes the shared boundary vertex", () => {
  // Day 1 ends at [−123,49]; Day 2 starts at the same point.
  const routes = [
    dr(2, [[-123, 49], [-122.5, 49.2], [-122, 49.4]]),
    dr(1, [[-124, 48.5], [-123.5, 48.8], [-123, 49]]),
  ];
  const enc = assembleRoutePolyline(routes);
  assert.ok(enc && enc.length > 0);
  const decoded = decodePolyline(enc!);
  // 3 + 3 coords, minus the 1 shared boundary point = 5 (not 6).
  assert.equal(decoded.length, 5);
  // Ordered by day (day 1 first): starts at day-1 start, ends at day-2 end.
  assert.deepEqual(decoded[0].map((n) => Math.round(n)), [-124, 49]);
  assert.deepEqual(decoded[decoded.length - 1].map((n) => Math.round(n)), [-122, 49]);
});

test("skips null layover days but keeps the drive days around them", () => {
  const routes = [
    dr(1, [[-124, 48], [-123, 49]]),
    dr(2, null), // layover — no forward geometry
    dr(3, [[-123, 49], [-122, 50]]),
  ];
  const decoded = decodePolyline(assembleRoutePolyline(routes)!);
  // 2 + 2 minus the shared [−123,49] boundary = 3.
  assert.equal(decoded.length, 3);
});

test("real road has intermediate vertices (not just overnight endpoints)", () => {
  // A single day with a curved 5-vertex road → the persisted line keeps all 5,
  // proving we store the ROAD, not a straight overnight-to-overnight segment.
  const road: [number, number][] = [
    [-128.0, 58.0], [-128.2, 58.3], [-128.1, 58.7], [-127.8, 59.0], [-127.5, 59.3],
  ];
  const decoded = decodePolyline(assembleRoutePolyline([dr(1, road)])!);
  assert.equal(decoded.length, 5);
});
