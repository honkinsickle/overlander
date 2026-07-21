/**
 * Node/card dedup predicate — the merge must be confident. A place is a node OR
 * a card, never both; when uncertain, it renders twice (visible), never silently
 * replaces a different place.
 * Run: npx tsx --test src/lib/corridor/node-identity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNodeIdentical, stripNodeIdentical } from "./node-identity";
import type { CorridorCity } from "@/lib/trips/types";

const node = (over: Partial<CorridorCity>): CorridorCity => ({
  id: "dease-lake-bc",
  name: "Dease Lake, BC",
  kind: "corridor",
  coords: [-130.024167, 58.433333],
  milesFromStart: 94,
  placeIds: [],
  ...over,
});

test("exact id match ⇒ node-identical (seed promoted from a POI)", () => {
  const n = node({ id: "google:abc" });
  assert.equal(isNodeIdentical({ id: "google:abc", coords: [0, 0] }, [n]), true);
});

test("~1mi cross-source drift + same name ⇒ node-identical (real Dease Lake case)", () => {
  // The persisted corpus 'Dease Lake' POI sits 0.94mi from the CGNDB centroid —
  // same town, two coordinate sources. Must merge (else it renders twice).
  const twin = { id: "mp:1", title: "Dease Lake", coords: [-129.999378, 58.43741] as [number, number] };
  assert.equal(isNodeIdentical(twin, [node({})]), true);
});

test("close coords but DIFFERENT name ⇒ NOT identical (renders twice, not vanish)", () => {
  // A real distinct POI a few hundred metres from the town centre.
  const poi = { id: "mp:2", title: "Dease Lake Super A Foods", coords: [-130.021, 58.435] as [number, number] };
  assert.equal(isNodeIdentical(poi, [node({})]), false);
});

test("same name but FAR ⇒ NOT identical (name never merges alone — two 'Springfields')", () => {
  const far = { id: "mp:3", title: "Dease Lake", coords: [-122.0, 49.0] as [number, number] };
  assert.equal(isNodeIdentical(far, [node({})]), false);
});

test("no coords + different id ⇒ NOT identical", () => {
  assert.equal(isNodeIdentical({ id: "mp:4", title: "Dease Lake" }, [node({})]), false);
});

test("stripNodeIdentical drops only the node-identical places", () => {
  const nodes = [node({})];
  const pool = [
    { id: "mp:1", title: "Dease Lake", coords: [-130.024, 58.4335] as [number, number] }, // twin → dropped
    { id: "mp:2", title: "Bear Glacier Provincial Park", coords: [-129.9, 56.0] as [number, number] }, // kept
  ];
  const kept = stripNodeIdentical(pool, nodes);
  assert.deepEqual(kept.map((p) => p.id), ["mp:2"]);
});
