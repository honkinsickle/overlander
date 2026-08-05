import { test } from "node:test";
import assert from "node:assert/strict";
import {
  placesToFeatureCollection,
  placeBounds,
  isPlottableCoord,
} from "./place-layer";
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

// ── prominent discriminator ─────────────────────────────────────────────────
// prominent = curated OR fromWaypoints, computed at render. curated is set only
// by the generation bake on segmentSuggestions; a waypoint tile is flagged
// `removable: true` in placePool (its only marker of the waypoints source).

test("prominent: a curated tile is prominent", () => {
  const fc = placesToFeatureCollection([
    { ...tile("c", [-122, 45]), curated: true },
  ]);
  assert.equal(fc.features[0].properties.prominent, true);
});

test("prominent: a waypoint tile (removable) is prominent", () => {
  const fc = placesToFeatureCollection([
    { ...tile("w", [-122, 45]), removable: true },
  ]);
  assert.equal(fc.features[0].properties.prominent, true);
});

test("prominent: a plain pool tile (neither curated nor removable) is not prominent", () => {
  const fc = placesToFeatureCollection([tile("p", [-122, 45])]);
  assert.equal(fc.features[0].properties.prominent, false);
});

test("prominent: every feature carries a boolean prominent (complementary partition)", () => {
  const fc = placesToFeatureCollection([
    { ...tile("a", [-122, 45]), curated: true },
    { ...tile("b", [-121, 45]), removable: true },
    tile("c", [-120, 45]),
  ]);
  assert.deepEqual(
    fc.features.map((f) => f.properties.prominent),
    [true, true, false],
  );
});

// ── category normalization (icon-image must always resolve) ──────────────────
test("category: a known category passes through", () => {
  const fc = placesToFeatureCollection([
    { ...tile("s", [-122, 45]), category: "camping" },
  ]);
  assert.equal(fc.features[0].properties.category, "camping");
});

test("category: an unknown category clamps to interest so icon-image resolves", () => {
  const fc = placesToFeatureCollection([
    { ...tile("x", [-122, 45]), category: "gas" as CorridorPlace["category"] },
  ]);
  assert.equal(fc.features[0].properties.category, "interest");
});

// ── isPlottableCoord (the shared guard) ─────────────────────────────────────
// The day-bounds camera fit and placesToFeatureCollection must agree on what is
// plottable, so both read this one predicate.
test("isPlottableCoord: accepts a valid [lng,lat], rejects absent/NaN/short", () => {
  assert.equal(isPlottableCoord([-122, 45]), true);
  assert.equal(isPlottableCoord(undefined), false);
  assert.equal(isPlottableCoord([NaN, 45]), false);
  assert.equal(isPlottableCoord([-122] as unknown), false);
  assert.equal(isPlottableCoord([-122, 45, 100]), true); // elevation tolerated
});

// ── placeBounds (day-bounds camera fit input) ───────────────────────────────
test("placeBounds: no plottable places → null (caller falls back to flyTo)", () => {
  assert.equal(placeBounds([]), null);
  assert.equal(placeBounds([tile("a"), tile("b")]), null); // all coordless
});

test("placeBounds: a single place → a zero-extent bbox at that point", () => {
  assert.deepEqual(placeBounds([tile("a", [-122, 45])]), [
    [-122, 45],
    [-122, 45],
  ]);
});

test("placeBounds: all places at the same coord → zero-extent bbox", () => {
  assert.deepEqual(
    placeBounds([tile("a", [-122, 45]), tile("b", [-122, 45])]),
    [
      [-122, 45],
      [-122, 45],
    ],
  );
});

test("placeBounds: multiple → [[minLng,minLat],[maxLng,maxLat]], coordless skipped, order-independent", () => {
  const b = placeBounds([
    tile("a", [-120, 47]),
    tile("b"), // coordless — skipped
    tile("c", [-122, 45]),
    tile("d", [-121, 48]),
  ]);
  assert.deepEqual(b, [
    [-122, 45],
    [-120, 48],
  ]);
});
