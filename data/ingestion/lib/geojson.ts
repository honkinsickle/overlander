/**
 * Shared GeoJSON envelope schemas + geometry helpers.
 *
 * All three boundary/POI sources consume GeoJSON FeatureCollections —
 * Parks Canada and Alberta Parks via ESRI `f=geojson`, BC Parks via WFS
 * `outputFormat=application/json`. The envelope/feature/geometry schemas
 * and the polygon → centroid helpers were defined verbatim in all three;
 * this module is the single home (confirmed shared by three concrete
 * implementations).
 *
 * Out of scope here (stays per-source): point parsing (Parks Canada only),
 * multi-parcel polygon merge (BC Parks only), and every field-shape /
 * normalizer concern.
 */

import { z } from "zod";

// ───── Envelope schemas ────────────────────────────────────────────────
//
// `.passthrough()` on Feature + Geometry preserves the source-specific
// attribute/coordinate payloads. The FeatureCollection carries optional
// pagination metadata from both vendor families: ESRI's
// `exceededTransferLimit`, WFS's `numberReturned` / `numberMatched`. Only
// `features` and `exceededTransferLimit` are read by consumers; the rest
// are validated-but-unused so a superset schema serves every source.

export const GeoJsonGeometrySchema = z
  .object({ type: z.string(), coordinates: z.unknown() })
  .passthrough();

export const GeoJsonFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: GeoJsonGeometrySchema.nullable(),
    properties: z.record(z.unknown()),
  })
  .passthrough();

export const GeoJsonFeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(GeoJsonFeatureSchema),
    exceededTransferLimit: z.boolean().optional(),
    numberReturned: z.number().optional(),
    numberMatched: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export type GeoJsonFeature = z.infer<typeof GeoJsonFeatureSchema>;

// ───── Geometry helpers ────────────────────────────────────────────────

/** Return the Polygon/MultiPolygon shape verbatim, or null for any other
 * (Point) or absent geometry. */
export function extractPolygon(
  geom: GeoJsonFeature["geometry"],
): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null {
  if (!geom) return null;
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return { type: geom.type, coordinates: geom.coordinates };
  }
  return null;
}

/** Midpoint of a polygon's bounding box, as [lng, lat]. Returns null when
 * the geometry yields no parseable coordinates. */
export function bboxCentroid(geom: {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}): [number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (node: unknown): void => {
    if (
      Array.isArray(node) &&
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
      const [lng, lat] = node as [number, number];
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    if (Array.isArray(node)) for (const child of node) walk(child);
  };
  walk(geom.coordinates);
  if (!Number.isFinite(west)) return null;
  return [(west + east) / 2, (south + north) / 2];
}
