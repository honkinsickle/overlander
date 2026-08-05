import { test } from "node:test";
import assert from "node:assert/strict";
import { placesToFeatureCollection } from "./place-layer";
import type { CorridorPlace } from "@/components/trip/day-detail-corridor";

/** Minimal CorridorPlace with optional coords — only the fields the layer reads. */
function tile(id: string, coords?: [number, number]): CorridorPlace {
  return { id, title: `T-${id}`, category: "scenic", photoAlt: "", coords };
}

test("empty pool → empty FeatureCollection", () => {
  const fc = placesToFeatureCollection([]);
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 0);
});

test("coords-guard: coordless tiles are skipped, not errored", () => {
  const places = [
    tile("a", [-122, 45]),
    tile("b"), // coordless
    tile("c", [-121, 46]),
    tile("d"), // coordless
  ];
  const fc = placesToFeatureCollection(places);
  assert.equal(fc.features.length, 2);
  assert.deepEqual(
    fc.features.map((f) => f.properties.id),
    ["a", "c"],
  );
});

test("entirely coordless (la-to-portland analog) → 0 features, no throw", () => {
  const fc = placesToFeatureCollection([tile("a"), tile("b"), tile("c")]);
  assert.equal(fc.features.length, 0);
});

test("dense day (263) → 263 features; coords + props preserved", () => {
  const places = Array.from({ length: 263 }, (_, i) =>
    tile(String(i), [-120 + i * 0.001, 40 + i * 0.001]),
  );
  const fc = placesToFeatureCollection(places);
  assert.equal(fc.features.length, 263);
  assert.deepEqual(fc.features[0].geometry.coordinates, [-120, 40]);
  assert.equal(fc.features[0].properties.title, "T-0");
  assert.equal(fc.features[0].properties.category, "scenic");
});

test("sparse day (4) → 4 features", () => {
  const places = Array.from({ length: 4 }, (_, i) => tile(String(i), [-120, 40 + i]));
  assert.equal(placesToFeatureCollection(places).features.length, 4);
});

test("malformed coords (NaN, wrong length) are skipped", () => {
  const places: CorridorPlace[] = [
    tile("ok", [-122, 45]),
    { ...tile("nan"), coords: [NaN, 45] as [number, number] },
    { ...tile("short"), coords: [-122] as unknown as [number, number] },
  ];
  const fc = placesToFeatureCollection(places);
  assert.deepEqual(
    fc.features.map((f) => f.properties.id),
    ["ok"],
  );
});
