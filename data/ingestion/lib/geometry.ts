/**
 * Geometry utilities. Turf for app-side computation; PostGIS for anything
 * that touches stored data.
 */

import { bbox as turfBbox, bboxPolygon, lineString } from "@turf/turf";

/** [west, south, east, north] in WGS84. */
export type BoundingBox = [number, number, number, number];

/**
 * Tile a bbox into roughly square cells of `cellSizeKm`. Returns child bboxes
 * covering the parent. Used by sources whose APIs cap result counts per query
 * (Overpass, Google Places searchNearby).
 *
 * Note: this is naive — it uses degrees as if they were equal everywhere on earth.
 * Good enough for tiling within a single corridor that spans ~50° of latitude;
 * for global tiling we'd switch to a projected coordinate system.
 */
export function tileBbox(bbox: BoundingBox, cellSizeKm: number): BoundingBox[] {
  const [west, south, east, north] = bbox;
  const latDeg = cellSizeKm / 111.32; // km per degree of latitude.
  const midLat = (south + north) / 2;
  const lonDeg = cellSizeKm / (111.32 * Math.cos((midLat * Math.PI) / 180));

  const out: BoundingBox[] = [];
  for (let lat = south; lat < north; lat += latDeg) {
    for (let lon = west; lon < east; lon += lonDeg) {
      out.push([
        lon,
        lat,
        Math.min(lon + lonDeg, east),
        Math.min(lat + latDeg, north),
      ]);
    }
  }
  return out;
}

/** Parse a comma-separated bbox string (`west,south,east,north`). */
export function parseBboxString(input: string): BoundingBox {
  const parts = input.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid bbox: "${input}". Expected "west,south,east,north".`);
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) {
    throw new Error(`Invalid bbox: "${input}". west<east and south<north required.`);
  }
  return [west, south, east, north];
}

/** Build a GeoJSON polygon from a bbox (turf wrapper, re-exported for convenience). */
export function bboxToPolygon(bbox: BoundingBox) {
  return bboxPolygon(bbox);
}

/** Build a GeoJSON LineString from an array of [lng, lat] points. */
export function pointsToLineString(points: [number, number][]) {
  return lineString(points);
}

/** Compute a tight bbox around a GeoJSON feature. */
export function featureBbox(feature: Parameters<typeof turfBbox>[0]): BoundingBox {
  const result = turfBbox(feature);
  return [result[0], result[1], result[2], result[3]];
}
