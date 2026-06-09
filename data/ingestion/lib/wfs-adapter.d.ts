// Type declarations for the hand-authored WFS adapter (wfs-adapter.js).
// Covers the exports run-canada consumes; types-only, the JS runtime is
// unchanged. The module also exports `toEWKT` / `featureCentroid`, which
// nothing imports today — declared here only as needed.

/** Minimal GeoJSON geometry shape read by `geojsonToWkt` (it inspects
 *  `type` and `coordinates`). */
export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

/** Convert a GeoJSON geometry to a WKT string. */
export declare function geojsonToWkt(g: GeoJsonGeometry): string;

/** Async-generator that streams WFS feature rows for a source config,
 *  clipped to the corridor polygon. Each yielded row is a flat attribute
 *  object (consumed as `Src` by run-canada via `row as Src`). */
export declare function wfsFeatures(
  config: Record<string, unknown>,
  corridorGeoJSON: unknown,
  opts?: { pageSize?: number },
): AsyncGenerator<Record<string, unknown>, void, unknown>;
