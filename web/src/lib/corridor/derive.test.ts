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

// Straight-line offset = latDeg * MI_PER_DEG on the equator.
const off = (mi: number) => mi / MI_PER_DEG;

test("corridorMi gate: a city within 3mi is in, beyond 3mi is out — regardless of size", () => {
  const r = derive(1.4, [
    city("On Route", "CA", 0.7, 50000, off(1.4)), // 1.4mi -> in
    city("Off Route", "CA", 0.7, 500000, off(4.1)), // 4.1mi -> out even though huge
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("On Route, CA"), "1.4mi city present");
  assert.ok(!names.includes("Off Route, CA"), "4.1mi city absent despite big population");
});

test("population floor: a sub-floor town on-route is excluded (no fallback pulls it in)", () => {
  const r = derive(1.4, [city("Tinyville", "CA", 0.7, 4000, off(0.5))]);
  assert.ok(r);
  assert.equal(r.length, 2, "start + end only");
});

test("NO SUPPRESSION: two on-route cities close together BOTH appear", () => {
  // ~13.8mi apart — well inside the removed 50mi spacing. The old model kept
  // only the bigger; now both survive, because inclusion is proximity, not
  // prominence.
  const r = derive(1.4, [
    city("Smaller", "CA", 0.5, 50000, off(1.0)),
    city("Bigger", "CA", 0.7, 80000, off(1.0)),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Smaller, CA"), "smaller NOT suppressed");
  assert.ok(names.includes("Bigger, CA"));
});

test("prominence never decides inclusion: a huge on-route city does not hide a small neighbour", () => {
  const r = derive(1.4, [
    city("Metropolis", "CA", 0.5, 2000000, off(0.5), 4),
    city("Little Town", "CA", 0.7, 12000, off(0.5), 2),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Metropolis, CA"));
  assert.ok(names.includes("Little Town, CA"), "small neighbour survives the giant");
});

test("zero corridor cities is a valid spine — no reach-further fallback", () => {
  // The only candidate sits 4mi off-route: excluded, and nothing is forced in.
  const r = derive(1.4, [city("Off", "CA", 0.7, 90000, off(4.0))]);
  assert.ok(r);
  assert.equal(r.length, 2, "start + end only");
  assert.equal(r.filter((n) => n.kind === "corridor").length, 0);
});

test("maxNodes backstop truncates by ALONG-ROUTE order, not prominence", () => {
  // Tiny cap override. Three on-route cities; the cap keeps the FIRST TWO by
  // mile even though the last is by far the most populous — no prominence bias.
  const r = derive(
    2.0,
    [
      city("First", "CA", 0.4, 20000, off(0.5)),
      city("Second", "CA", 0.8, 20000, off(0.5)),
      city("Third Biggest", "CA", 1.2, 900000, off(0.5)),
    ],
    { maxNodes: 2 },
  );
  assert.ok(r);
  const mids = r.filter((n) => n.kind === "corridor").map((n) => n.name);
  assert.deepEqual(mids, ["First, CA", "Second, CA"], "earliest two by mile");
});

test("same-point de-dup collapses co-located rows to the more prominent one", () => {
  // Two rows essentially at one spot (<0.5mi apart): keep the bigger.
  const r = derive(1.4, [
    city("Exit CDP", "CA", 0.7, 12000, off(0.3)),
    city("Exit City", "CA", 0.7005, 90000, off(0.3)),
  ]);
  assert.ok(r);
  const mids = r.filter((n) => n.kind === "corridor").map((n) => n.name);
  assert.deepEqual(mids, ["Exit City, CA"], "one node, the more prominent");
});

// ── Named regression cases (real trips, equator-mapped positions) ──────────

test("regression Concord/Fairfield/Vacaville: dense on-route cluster all survive; the across-the-bay city is excluded", () => {
  // Trip e67d8c1f (Palo Alto→Colusa), real miles/offsets mapped to the equator.
  // All three are <2mi off-route; San Francisco is 11.6mi off (across the Bay)
  // and must be excluded by the 3mi gate — and must NOT suppress the cluster
  // (the original bug).
  const r = derive(2.4, [
    city("San Francisco", "CA", 38 / MI_PER_DEG, 827526, off(11.6), 3),
    city("Concord", "CA", 53 / MI_PER_DEG, 128667, off(1.6), 2),
    city("Fairfield", "CA", 78 / MI_PER_DEG, 112970, off(1.4), 3),
    city("Vacaville", "CA", 86 / MI_PER_DEG, 96803, off(0.4), 2),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Concord, CA"), "Concord present");
  assert.ok(names.includes("Fairfield, CA"), "Fairfield present");
  assert.ok(names.includes("Vacaville, CA"), "Vacaville present");
  assert.ok(!names.includes("San Francisco, CA"), "SF excluded by the 3mi gate");
});

test("regression Davis/Sacramento: Davis is kept; Sacramento is excluded at the 3mi boundary", () => {
  // Trip 898afd34 (San Jose→Reno). Davis 0.4mi off (in); Sacramento measured
  // 3.1mi off (just over 3mi -> out) though it's the far-more-prominent state
  // capital — prominence must not save it, nor let it suppress Davis.
  const r = derive(2.4, [
    city("Davis", "CA", 106 / MI_PER_DEG, 67666, off(0.4), 2),
    city("Sacramento", "CA", 117 / MI_PER_DEG, 524943, off(3.1), 4),
  ]);
  assert.ok(r);
  const names = r.map((n) => n.name);
  assert.ok(names.includes("Davis, CA"), "on-route Davis kept");
  assert.ok(
    !names.includes("Sacramento, CA"),
    "Sacramento excluded: 3.1mi > 3mi gate",
  );
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
