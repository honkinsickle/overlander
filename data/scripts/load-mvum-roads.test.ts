/**
 * Unit tests for the MVUM loader's pure grouping logic (no network/DB).
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../ingestion/lib/geojson.ts";
import { groupRoutesByRteCn } from "./load-mvum-roads.ts";

function line(
  rteCn: unknown,
  coords: number[][],
): GeoJsonFeature {
  return {
    type: "Feature",
    properties: rteCn === undefined ? {} : { rte_cn: rteCn },
    geometry: { type: "LineString", coordinates: coords },
  } as unknown as GeoJsonFeature;
}

describe("groupRoutesByRteCn", () => {
  it("aggregates a route's multiple segments into one MultiLineString", () => {
    const segA = [[-117.0, 34.1], [-117.0, 34.2]];
    const segB = [[-117.0, 34.2], [-117.0, 34.3]];
    const { routes, skippedNoKey, skippedGeom } = groupRoutesByRteCn([
      line("100010338", segA),
      line("100010338", segB),
    ]);
    expect(routes.size).toBe(1);
    const r = routes.get("100010338")!;
    expect(r.segments).toBe(2);
    expect(r.geojson).toEqual({ type: "MultiLineString", coordinates: [segA, segB] });
    expect(skippedNoKey).toBe(0);
    expect(skippedGeom).toBe(0);
  });

  it("keeps distinct rte_cn values as separate routes", () => {
    const { routes } = groupRoutesByRteCn([
      line("100010338", [[-117.0, 34.1], [-117.0, 34.2]]),
      line("102010338", [[-116.9, 34.0], [-116.9, 34.1]]),
    ]);
    expect(routes.size).toBe(2);
    expect(routes.get("100010338")!.geojson.coordinates).toHaveLength(1);
    expect(routes.get("102010338")!.geojson.coordinates).toHaveLength(1);
  });

  it("skips features with null/empty/whitespace rte_cn (never keys on objectid)", () => {
    const seg = [[-117.0, 34.1], [-117.0, 34.2]];
    const { routes, skippedNoKey } = groupRoutesByRteCn([
      line(null, seg),
      line("", seg),
      line("   ", seg),
      line(undefined, seg),
      line("100010338", seg),
    ]);
    expect(routes.size).toBe(1);
    expect(skippedNoKey).toBe(4);
  });

  it("coerces a numeric rte_cn to its string key", () => {
    const { routes } = groupRoutesByRteCn([line(100010338, [[-117, 34], [-117, 35]])]);
    expect([...routes.keys()]).toEqual(["100010338"]);
  });

  it("expands a MultiLineString feature's parts into the route (EDW returns both)", () => {
    const partA = [[-117.0, 34.1], [-117.0, 34.2]];
    const partB = [[-117.0, 34.2], [-117.0, 34.3]];
    const mls = {
      type: "Feature",
      properties: { rte_cn: "100010338" },
      geometry: { type: "MultiLineString", coordinates: [partA, partB] },
    } as unknown as GeoJsonFeature;
    const { routes, skippedGeom } = groupRoutesByRteCn([mls]);
    expect(skippedGeom).toBe(0);
    expect(routes.get("100010338")!.geojson.coordinates).toEqual([partA, partB]);
  });

  it("merges LineString and MultiLineString features under the same rte_cn", () => {
    const segLs = [[-117.0, 34.0], [-117.0, 34.1]];
    const partA = [[-117.0, 34.1], [-117.0, 34.2]];
    const ls = line("100010338", segLs);
    const mls = {
      type: "Feature",
      properties: { rte_cn: "100010338" },
      geometry: { type: "MultiLineString", coordinates: [partA] },
    } as unknown as GeoJsonFeature;
    const { routes } = groupRoutesByRteCn([ls, mls]);
    expect(routes.size).toBe(1);
    expect(routes.get("100010338")!.geojson.coordinates).toEqual([segLs, partA]);
  });

  it("skips geometries that are neither LineString nor MultiLineString", () => {
    const pt = {
      type: "Feature",
      properties: { rte_cn: "100010338" },
      geometry: { type: "Point", coordinates: [-117, 34] },
    } as unknown as GeoJsonFeature;
    const { routes, skippedGeom } = groupRoutesByRteCn([pt]);
    expect(routes.size).toBe(0);
    expect(skippedGeom).toBe(1);
  });
});
