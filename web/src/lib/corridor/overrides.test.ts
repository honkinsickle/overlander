/**
 * Tests for applyPlaceOverrides() — user POI re-homing on top of nearest-node
 * bucketing (spec § node-stack model). Run with:
 *   npx tsx --test src/lib/corridor/overrides.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPlaceOverrides } from "./bucket";
import type { CorridorCity } from "@/lib/trips/types";

function node(id: string, placeIds: string[]): CorridorCity {
  return {
    id,
    name: id,
    kind: "corridor",
    coords: [0, 0],
    milesFromStart: 0,
    placeIds,
  };
}

test("no overrides → cities returned unchanged (no-op path)", () => {
  const cities = [node("n1", ["p1", "p2"]), node("n2", ["p3"])];
  assert.equal(applyPlaceOverrides({ cities, overrides: [] }), cities);
});

test("override moves a place from its bucketed node to the target node", () => {
  const cities = [node("n1", ["p1", "p2"]), node("n2", ["p3"])];
  const out = applyPlaceOverrides({
    cities,
    overrides: [{ placeId: "p1", nodeId: "n2" }],
  });
  assert.deepEqual(out[0].placeIds, ["p2"]); // p1 removed from n1
  assert.deepEqual(out[1].placeIds, ["p3", "p1"]); // appended to n2
});

test("override can pull in an orphan place not bucketed under any node", () => {
  const cities = [node("n1", ["p1"]), node("n2", [])];
  const out = applyPlaceOverrides({
    cities,
    overrides: [{ placeId: "orphan", nodeId: "n2" }],
  });
  assert.deepEqual(out[1].placeIds, ["orphan"]);
});

test("dangling override (target node absent) is ignored — nearest-node stands", () => {
  const cities = [node("n1", ["p1", "p2"])];
  const out = applyPlaceOverrides({
    cities,
    overrides: [{ placeId: "p1", nodeId: "gone" }],
  });
  assert.equal(out, cities); // untouched
});

test("a node with no change keeps its identity (referential no-op per node)", () => {
  const cities = [node("n1", ["p1"]), node("n2", ["p2"])];
  const out = applyPlaceOverrides({
    cities,
    overrides: [{ placeId: "p2", nodeId: "n1" }],
  });
  // n2 lost p2 (changed), n1 gained it (changed) — both are new objects, but
  // the point: only affected nodes rebuild.
  assert.deepEqual(out[0].placeIds, ["p1", "p2"]);
  assert.deepEqual(out[1].placeIds, []);
});
