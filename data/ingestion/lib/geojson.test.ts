/**
 * Unit tests for the shared GeoJSON envelope schemas + geometry helpers.
 */

import { describe, expect, it } from "vitest";

import {
  GeoJsonFeatureCollectionSchema,
  bboxCentroid,
  extractPolygon,
} from "./geojson.ts";

describe("GeoJsonFeatureCollectionSchema — envelope validation", () => {
  it("accepts an ESRI-style FeatureCollection with exceededTransferLimit", () => {
    const parsed = GeoJsonFeatureCollectionSchema.safeParse({
      type: "FeatureCollection",
      exceededTransferLimit: true,
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: { NAME: "x", PASITES_ID: 1 },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.features).toHaveLength(1);
  });

  it("accepts a WFS-style FeatureCollection with numberReturned/numberMatched", () => {
    const parsed = GeoJsonFeatureCollectionSchema.safeParse({
      type: "FeatureCollection",
      numberReturned: 1,
      numberMatched: "12",
      features: [
        { type: "Feature", geometry: null, properties: { ORCS_PRIMARY: "0385" } },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("retains unknown feature properties via passthrough", () => {
    const parsed = GeoJsonFeatureCollectionSchema.safeParse({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 2], extra: "kept" },
          properties: { a: 1, b: "two" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.features[0].properties).toEqual({ a: 1, b: "two" });
    }
  });

  it("rejects a non-FeatureCollection body (schema-mismatch guard)", () => {
    expect(
      GeoJsonFeatureCollectionSchema.safeParse({ type: "Nope", features: [] }).success,
    ).toBe(false);
    expect(GeoJsonFeatureCollectionSchema.safeParse({ error: "boom" }).success).toBe(
      false,
    );
  });
});

describe("extractPolygon", () => {
  it("returns Polygon / MultiPolygon shapes verbatim", () => {
    const poly = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(extractPolygon(poly)).toEqual(poly);
    const mp = { type: "MultiPolygon" as const, coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
    expect(extractPolygon(mp)).toEqual(mp);
  });

  it("returns null for Point / null geometry", () => {
    expect(extractPolygon({ type: "Point", coordinates: [0, 1] })).toBeNull();
    expect(extractPolygon(null)).toBeNull();
  });
});

describe("bboxCentroid", () => {
  it("returns the midpoint of a polygon's bounding box", () => {
    expect(
      bboxCentroid({
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
      }),
    ).toEqual([5, 10]);
  });

  it("spans all members for a MultiPolygon", () => {
    expect(
      bboxCentroid({
        type: "MultiPolygon",
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
        ],
      }),
    ).toEqual([6, 6]);
  });

  it("returns null for empty geometry", () => {
    expect(bboxCentroid({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});
