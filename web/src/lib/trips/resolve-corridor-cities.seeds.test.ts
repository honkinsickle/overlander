/**
 * End-to-end tests for the two-pass resolveCorridorCities() refactor
 * (spec § node-stack model): the seedless path is unchanged, a seed appears as
 * a corridor node, and a dormant seed is reported. Run with:
 *   npx tsx --test src/lib/trips/resolve-corridor-cities.seeds.test.ts
 *
 * Equator fixture on an empty gazetteer band → a clean 2-node baseline
 * (start+end), so a seed is the only thing that can add a mid node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCorridorCities } from "./resolve-corridor-cities";
import type { Trip, NodeSeed } from "./types";

/** Encode `[lng,lat][]` as a precision-5 Google polyline (inverse of
 *  decodePolyline in point-to-polyline.ts) so the fixture round-trips. */
function encodePolyline(coords: [number, number][]): string {
  const enc = (v: number): string => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let out = "";
    while (s >= 0x20) {
      out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return out + String.fromCharCode(s + 63);
  };
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += enc(la - lastLat) + enc(ln - lastLng);
    lastLat = la;
    lastLng = ln;
  }
  return out;
}

// Straight equator line lng 0→2 (~138 mi), a lat-0 band with no gazetteer
// cities, so the baseline corridor is exactly [start, end].
const LINE: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1.5, 0],
  [2, 0],
];

function baseTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t",
    title: "T",
    startDate: "2026-07-20",
    endDate: "2026-07-20",
    startLocation: "Alpha",
    endLocation: "Beta",
    startCoords: [0, 0],
    routePolyline: encodePolyline(LINE),
    weatherHiF: 70,
    weatherLoF: 50,
    days: [
      {
        id: "d1",
        dayNumber: 1,
        date: "2026-07-20",
        label: "Alpha, AA — Beta, AA",
        startCoord: [0, 0],
        coords: [2, 0],
        miles: 138,
        waypoints: [],
      },
    ],
    ...over,
  };
}

function seed(id: string, coords: [number, number]): NodeSeed {
  return { id, name: id, coords, createdAt: "2026-07-20T00:00:00Z" };
}

test("seedless: corridor is the 2-node baseline, no seedResolutions stamped", () => {
  const out = resolveCorridorCities(baseTrip());
  const cc = out.days[0].corridorCities;
  assert.equal(cc?.length, 2);
  assert.deepEqual(cc?.map((n) => n.kind), ["start", "end"]);
  assert.equal(out.seedResolutions, undefined);
});

test("a seed on the route becomes a corridor node and is reported resolved", () => {
  const out = resolveCorridorCities(
    baseTrip({ nodeSeeds: [seed("mid-pin", [1, 0])] }),
  );
  const cc = out.days[0].corridorCities;
  assert.equal(cc?.length, 3);
  assert.equal(cc?.[1].kind, "corridor");
  assert.equal(cc?.[1].id, "mid-pin");

  assert.equal(out.seedResolutions?.length, 1);
  const r = out.seedResolutions![0];
  assert.equal(r.resolved, true);
  if (r.resolved) assert.equal(r.dayId, "d1");
});

test("a dormant seed is reported, not silently dropped", () => {
  const out = resolveCorridorCities(
    baseTrip({ nodeSeeds: [seed("faraway", [1, 5])] }), // ~345 mi off-route
  );
  assert.equal(out.days[0].corridorCities?.length, 2); // no mid node
  assert.deepEqual(out.seedResolutions, [
    { seedId: "faraway", resolved: false, reason: "off-corridor" },
  ]);
});
