/**
 * Tests for the shared per-day corridor helpers. The point of the module is
 * that the backfill AUDIT and the render (bake) derive corridor cities the SAME
 * per-day way — so a city on the day spine but dropped from the coarse
 * whole-route spine is still a valid backfill anchor.
 *
 * Run: cd web && npx tsx --test src/lib/corridor/day-corridor.test.ts
 *
 * Fixtures sit on the equator so distances are hand-verifiable:
 * 1° of longitude = 69.09318 mi.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCorridorCities, type GazetteerCity } from "./derive";
import { deriveDayCorridor, dayCorridorAnchors } from "./day-corridor";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

function makeLine(degLen: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= degLen + 1e-9; d += 0.25) out.push([d, 0]);
  if (out[out.length - 1][0] < degLen) out.push([degLen, 0]);
  return out;
}
function city(name: string, lngDeg: number, pop: number): GazetteerCity {
  return { name, admin: "CA", lat: 0, lng: lngDeg, pop, tier: 2 };
}

// Cities strung along a 0°→10° route. "Midtown" sits on the first short day
// segment (mile ~41); "Big Six" sits far up the route (mile ~415), near the
// WHOLE route but nowhere near day 1's polyline.
const BIG = [city("Big Two", 2, 200_000), city("Big Four", 4, 200_000), city("Big Six", 6, 200_000), city("Big Eight", 8, 200_000)];
const MIDTOWN = city("Midtown", 0.6, 20_000); // ~41mi from a 0° start
const GAZ = [MIDTOWN, ...BIG];

const near = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * MI_PER_DEG, (a[1] - b[1]) * MI_PER_DEG);

test("dayCorridorAnchors scopes to the DAY's polyline, not the whole route", () => {
  // The whole-route spine has every on-route city (strict proximity, no
  // suppression). Day 1 (0°→2°) must include only cities near ITS segment —
  // Midtown — and NOT a city far up the route (Big Six), which is what wiring
  // the audit to the per-day derivation (#295) buys.
  const whole = deriveCorridorCities({
    line: makeLine(10),
    start: { name: "Start, CA", coords: [0, 0] },
    end: { name: "End, CA", coords: [10, 0] },
    gazetteer: GAZ,
  });
  assert.ok(whole, "expected a whole-route spine");
  assert.ok(whole!.some((c) => c.name.startsWith("Midtown")), "whole route includes Midtown");
  assert.ok(whole!.some((c) => c.name.startsWith("Big Six")), "whole route includes Big Six");

  const anchors = dayCorridorAnchors(
    { line: makeLine(2), startCoord: [0, 0], endCoord: [2, 0], startPlace: "Start, CA", endPlace: "Big Two, CA", nearMi: 25 },
    GAZ,
  );
  assert.equal(anchors[0].kind, "start", "start anchor leads");
  assert.equal(anchors[0].label, "Start, CA");
  assert.ok(
    anchors.some((a) => a.kind === "corridor" && a.label.startsWith("Midtown")),
    "day-1 anchors include the on-segment Midtown",
  );
  assert.ok(
    !anchors.some((a) => a.label.startsWith("Big Six")),
    "day-1 anchors exclude the far-up-route city",
  );
});

test("a mid-corridor city within nearMi of the day's END is excluded by the endpoint rule, not absent (the Arvin case)", () => {
  // "Arvinish" at 1.75° is ~17mi before the 2° end: beyond deriveCorridorCities'
  // 10mi anchor guard (so it IS in the raw spine) but within the 25mi endpoint
  // rule (so dayCorridorAnchors drops it).
  const gaz = [city("Arvinish", 1.75, 50_000)];
  const raw = deriveDayCorridor(makeLine(2), { name: "Start, CA", coords: [0, 0] }, { name: "Bakersfield, CA", coords: [2, 0] }, gaz);
  assert.ok(raw.some((c) => c.kind === "corridor" && c.name.startsWith("Arvinish")), "Arvinish IS present in the raw per-day spine");
  assert.ok(near([1.75, 0], [2, 0]) < 25, "sanity: Arvinish is within 25mi of the end");

  const anchors = dayCorridorAnchors(
    { line: makeLine(2), startCoord: [0, 0], endCoord: [2, 0], startPlace: "Start, CA", endPlace: "Bakersfield, CA", nearMi: 25 },
    gaz,
  );
  assert.ok(!anchors.some((a) => a.label.startsWith("Arvinish")), "Arvinish is excluded by the endpoint rule, not by absence from the spine");
});

test("no polyline (or no end coord) yields just the start anchor", () => {
  const base = { startCoord: [0, 0] as [number, number], startPlace: "Start, CA", endPlace: "End, CA", nearMi: 25 };
  assert.deepEqual(
    dayCorridorAnchors({ ...base, line: null, endCoord: [2, 0] }, GAZ),
    [{ coords: [0, 0], label: "Start, CA", kind: "start" }],
  );
  assert.deepEqual(
    dayCorridorAnchors({ ...base, line: makeLine(2), endCoord: null }, GAZ),
    [{ coords: [0, 0], label: "Start, CA", kind: "start" }],
  );
});
