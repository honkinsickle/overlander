/**
 * Tests for deriveCorridorCities() — the §2.1.2 six-step corridor filter
 * (docs/corridor-cities-spec.md). Run with:
 *   npx tsx --test src/lib/corridor/derive.test.ts
 *
 * Fixtures sit on the equator so distances are hand-verifiable:
 * 1° of longitude = 69.09318 mi (matching point-to-polyline's EARTH_KM).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCorridorCities,
  DEFAULT_CORRIDOR_PARAMS,
  type GazetteerCity,
} from "./derive";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

/** Straight equator polyline from lng 0 to `degLen`, vertex every 0.25°. */
function makeLine(degLen: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= degLen + 1e-9; d += 0.25) out.push([d, 0]);
  if (out[out.length - 1][0] < degLen) out.push([degLen, 0]);
  return out;
}

function city(
  name: string,
  admin: string,
  lngDeg: number,
  pop: number,
  latDeg = 0,
  tier = 2,
): GazetteerCity {
  return { name, admin, lat: latDeg, lng: lngDeg, pop, tier };
}

function derive(
  degLen: number,
  gazetteer: GazetteerCity[],
  params?: Partial<typeof DEFAULT_CORRIDOR_PARAMS>,
) {
  return deriveCorridorCities({
    line: makeLine(degLen),
    start: { name: "Start City, CA", coords: [0, 0] },
    end: { name: "End City, CA", coords: [degLen, 0] },
    gazetteer,
    params,
  });
}

function gaps(nodes: { milesFromStart: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < nodes.length; i++) {
    out.push(nodes[i].milesFromStart - nodes[i - 1].milesFromStart);
  }
  return out;
}

test("basic corridor: start + one intermediate + end, ordered, correct miles", () => {
  // ~96.7 mi day with Ventura-like city at 0.94° (~64.9 mi), just off-route.
  const r = derive(1.4, [city("Ventura", "CA", 0.94, 96769, 0.01)]);
  assert.ok(r, "expected a corridor");
  assert.equal(r.length, 3);
  assert.equal(r[0].kind, "start");
  assert.equal(r[0].milesFromStart, 0);
  assert.equal(r[0].id, "start-city-ca");
  assert.equal(r[1].kind, "corridor");
  assert.equal(r[1].name, "Ventura, CA");
  assert.equal(r[1].id, "ventura-ca");
  assert.ok(Math.abs(r[1].milesFromStart - 0.94 * MI_PER_DEG) < 0.5, "intermediate mile");
  assert.deepEqual(r[1].placeIds, []);
  assert.equal(r[2].kind, "end");
  assert.ok(Math.abs(r[2].milesFromStart - 1.4 * MI_PER_DEG) < 0.5, "end mile");
});

test("buffer gate: city beyond buffer_mi excluded, city inside included", () => {
  const r = derive(1.4, [
    city("Far Off", "CA", 0.7, 500000, 0.3), // ~20.7 mi off-route -> out
    city("Near", "CA", 0.7, 50000, 0.1), // ~6.9 mi off-route -> in
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Near, CA"), "in-buffer city present");
  assert.ok(!names.includes("Far Off, CA"), "out-of-buffer city absent");
});

test("population floor holds on a short day with no gap violation", () => {
  // 96.7 mi day, only a sub-floor town available, no 150-mi gap -> no intermediates.
  const r = derive(1.4, [city("Tinyville", "CA", 0.7, 4000)]);
  assert.ok(r);
  assert.equal(r.length, 2, "start + end only");
});

test("spacing: of two clustered cities, the higher-population one wins", () => {
  // 13.8 mi apart (< 50 mi spacing) -> keep pop 80k, drop pop 50k.
  const r = derive(1.4, [
    city("Smaller", "CA", 0.5, 50000),
    city("Bigger", "CA", 0.7, 80000),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Bigger, CA"));
  assert.ok(!names.includes("Smaller, CA"));
});

test("admin-seat tier beats higher population within a spacing cluster", () => {
  // The Ventura case: county seat (tier 3, 97k) vs bigger generic
  // neighbor (tier 2, 200k), 13.8 mi apart — the seat wins the cluster.
  const r = derive(1.4, [
    city("Big Generic", "CA", 0.7, 200000, 0, 2),
    city("County Seat", "CA", 0.5, 97000, 0, 3),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("County Seat, CA"), "seat selected");
  assert.ok(!names.includes("Big Generic, CA"), "generic dropped");
});

test("gap-fill prefers the higher-tier candidate", () => {
  // ~166 mi day, both candidates sub-floor and mid-gap; one fill
  // resolves the gap. Tier 3 seat (pop 6.8k) must beat tier 2 (pop 20k).
  const r = derive(2.4, [
    city("Generic Town", "AK", 1.15, 9000, 0, 2), // sub-floor
    city("Borough Seat", "AK", 1.25, 6800, 0, 3),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Borough Seat, AK"), "higher tier fills the gap");
  assert.ok(!names.includes("Generic Town, AK"), "lower tier not chained in");
});

test("one-fill-per-gap: an uncured unspaced fill does not chain", () => {
  // Mid-cluster seat geometry that tier ranking ALONE doesn't prevent:
  // the seat wins the spaced fill, then the unspaced fallback grabs ONE
  // neighbor — the rule stops the walk upstream through the rest of the
  // cluster (the gap it can't cure is accepted open).
  const r = derive(5.8, [
    city("Outer Suburb", "AK", 4.4, 8000, 0, 2), // ~304 mi
    city("Near Suburb", "AK", 4.5, 8500, 0, 2), // ~311 mi
    city("Mid Seat", "AK", 4.55, 6800, 0, 3), // ~314 mi
    city("Upper Suburb", "AK", 4.6, 9000, 0, 2), // ~318 mi
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Mid Seat, AK"), "seat selected");
  assert.ok(!names.includes("Outer Suburb, AK"), "upstream walk stopped");
  const intermediates = r.filter((n) => n.kind === "corridor");
  assert.ok(
    intermediates.length <= 2,
    `chain capped: got ${intermediates.length} intermediates`,
  );
});

test("top-N: caps at max_nodes intermediates when gaps stay legal", () => {
  // ~311 mi day, 5 qualifying cities every 0.8° (~55 mi). Lowest-pop one
  // (at 4.0°) must be dropped by the cap; resulting max gap ~90 mi < 150.
  const r = derive(4.5, [
    city("Alpha", "CA", 0.8, 90000),
    city("Bravo", "CA", 1.6, 80000),
    city("Charlie", "CA", 2.4, 70000),
    city("Delta", "CA", 3.2, 60000),
    city("Echo", "CA", 4.0, 50000),
  ]);
  assert.ok(r);
  const intermediates = r.filter((n) => n.kind === "corridor");
  assert.equal(intermediates.length, DEFAULT_CORRIDOR_PARAMS.maxNodes);
  assert.ok(!r.map((n) => n.name).includes("Echo, CA"), "lowest-pop dropped");
});

test("adaptive fallback: floor relaxes on an empty 400-mi stretch", () => {
  // ~400 mi day, only a pop-800 town at the midpoint. Gap 400 > 150 ->
  // floor relaxes and the town anchors the corridor.
  const r = derive(5.8, [city("Dusty", "NV", 2.9, 800)]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Dusty, NV"), "sub-floor town selected");
});

test("gap guarantee wins over max_nodes on a very long day", () => {
  // ~898 mi day. Four big cities cluster in the first half; small
  // qualifying cities dot the second half. Honoring max_gap_mi=150 must
  // exceed the 4-node cap.
  const r = derive(13, [
    city("Big1", "CA", 1.5, 95000),
    city("Big2", "CA", 3.0, 90000),
    city("Big3", "CA", 4.5, 85000),
    city("Big4", "CA", 6.0, 80000),
    city("Small1", "NV", 7.5, 20000),
    city("Small2", "NV", 9.0, 25000),
    city("Small3", "NV", 10.5, 30000),
    city("Small4", "NV", 12.0, 35000),
  ]);
  assert.ok(r);
  const intermediates = r.filter((n) => n.kind === "corridor");
  assert.ok(
    intermediates.length > DEFAULT_CORRIDOR_PARAMS.maxNodes,
    `cap yields: got ${intermediates.length} intermediates`,
  );
  for (const g of gaps(r)) {
    assert.ok(
      g <= DEFAULT_CORRIDOR_PARAMS.maxGapMi + 1,
      `no gap over max_gap_mi, saw ${g.toFixed(1)}`,
    );
  }
  // Ordering invariant: milesFromStart monotonically non-decreasing.
  const miles = r.map((n) => n.milesFromStart);
  for (let i = 1; i < miles.length; i++) {
    assert.ok(miles[i] >= miles[i - 1], "monotonic milesFromStart");
  }
});

test("anchor guard: candidate within 3 mi of start is not a duplicate node", () => {
  // The start city itself sits in the gazetteer ~0.7 mi along the route.
  const r = derive(1.4, [city("Start City", "CA", 0.01, 4000000)]);
  assert.ok(r);
  assert.equal(r.length, 2, "no duplicate start node");
});

test("slug ids strip diacritics", () => {
  const r = derive(5.8, [city("Montréal", "QC", 2.9, 1762949)]);
  assert.ok(r);
  const node = r.find((n) => n.kind === "corridor");
  assert.ok(node, "intermediate expected");
  assert.equal(node.id, "montreal-qc");
  assert.equal(node.name, "Montréal, QC");
});

test("unusable line returns null", () => {
  const r = deriveCorridorCities({
    line: [],
    start: { name: "A, CA", coords: [0, 0] },
    end: { name: "B, CA", coords: [1, 0] },
    gazetteer: [],
  });
  assert.equal(r, null);
});
