/**
 * Tests for the node-seed force-include path in deriveCorridorCities()
 * (spec § node-stack model). Run with:
 *   npx tsx --test src/lib/corridor/derive-seeds.test.ts
 *
 * Equator fixtures: 1° lng = 69.09318 mi (matching point-to-polyline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCorridorCities,
  type GazetteerCity,
  type PositionedSeed,
} from "./derive";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

function makeLine(degLen: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= degLen + 1e-9; d += 0.25) out.push([d, 0]);
  return out;
}

function derive(
  degLen: number,
  gazetteer: GazetteerCity[],
  seeds?: PositionedSeed[],
) {
  return deriveCorridorCities({
    line: makeLine(degLen),
    start: { name: "Start City, CA", coords: [0, 0] },
    end: { name: "End City, CA", coords: [degLen, 0] },
    gazetteer,
    seeds,
  });
}

function seed(id: string, mile: number): PositionedSeed {
  return { id, name: id, coords: [mile / MI_PER_DEG, 0], milesFromStart: mile };
}

test("no seeds → spine is the gazetteer-only result (behavior preserved)", () => {
  const nodes = derive(4, []);
  assert.equal(nodes?.length, 2); // start + end only
  assert.deepEqual(nodes?.map((n) => n.kind), ["start", "end"]);
});

test("a seed is force-included as a corridor node with its durable id", () => {
  const nodes = derive(4, [], [seed("seed-wells-bc", 2 * MI_PER_DEG)]);
  assert.equal(nodes?.length, 3);
  const mid = nodes![1];
  assert.equal(mid.kind, "corridor");
  assert.equal(mid.id, "seed-wells-bc"); // id copied verbatim, not re-slugified
  assert.ok(Math.abs(mid.milesFromStart - 2 * MI_PER_DEG) < 0.01);
});

test("a seed bypasses the population floor (empty gazetteer still yields it)", () => {
  // No gazetteer candidates at all, yet the user pin lands.
  const nodes = derive(4, [], [seed("pin", 1.5 * MI_PER_DEG)]);
  assert.equal(nodes?.some((n) => n.id === "pin"), true);
});

test("a seed within anchorGuardMi of an endpoint is dropped as redundant", () => {
  // Guard default 10 mi; a seed 5 mi in coincides with the start node.
  const nodes = derive(4, [], [seed("edge", 5)]);
  assert.equal(nodes?.length, 2); // no mid node
});

test("a seed WINS over a gazetteer pick within minSpacing (user intent dominant)", () => {
  const gaz: GazetteerCity[] = [
    { name: "Bigtown", admin: "CA", lat: 0, lng: 2, pop: 500_000, tier: 4 },
  ];
  // Gazetteer would select Bigtown at ~2°; a seed at the same mile suppresses it.
  const nodes = derive(4, gaz, [seed("my-node", 2 * MI_PER_DEG)]);
  const mids = nodes!.filter((n) => n.kind === "corridor");
  assert.equal(mids.length, 1);
  assert.equal(mids[0].id, "my-node"); // the seed, not "bigtown-ca"
});

test("seed and a well-separated gazetteer pick coexist, mile-ordered", () => {
  const gaz: GazetteerCity[] = [
    { name: "Farville", admin: "CA", lat: 0, lng: 3, pop: 500_000, tier: 4 },
  ];
  const nodes = derive(4, gaz, [seed("early-seed", 1 * MI_PER_DEG)]);
  const mids = nodes!.filter((n) => n.kind === "corridor");
  assert.equal(mids.length, 2);
  assert.deepEqual(
    mids.map((n) => n.id),
    ["early-seed", "farville-ca"],
  ); // sorted by milesFromStart
});
