/**
 * Tests for the shared spatial pre-link containment logic.
 *
 * The case that matters is `chooseContaining` with OVERLAPPING polygons — the
 * bug that made first-match-wins disagree with CA's recorded links on 3 of 181
 * records. The "picks by name, not by order" and "order-independent" tests are
 * the ones that would have caught it.
 */
import { describe, expect, it } from "vitest";
import {
  chooseContaining,
  containingPolygons,
  pointInPolygon,
  type ParkPolygon,
} from "./spatial-prelink.ts";

/** Axis-aligned square as a GeoJSON Polygon ring. */
function square(minX: number, minY: number, maxX: number, maxY: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  };
}

describe("pointInPolygon", () => {
  it("is true strictly inside a Polygon", () => {
    expect(pointInPolygon([5, 5], square(0, 0, 10, 10))).toBe(true);
  });

  it("is false outside a Polygon", () => {
    expect(pointInPolygon([50, 50], square(0, 0, 10, 10))).toBe(false);
  });

  it("handles MultiPolygon by testing every member", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [square(0, 0, 10, 10).coordinates, square(100, 100, 110, 110).coordinates],
    };
    expect(pointInPolygon([105, 105], multi)).toBe(true);
    expect(pointInPolygon([50, 50], multi)).toBe(false);
  });

  it("returns false for a non-polygon geometry rather than throwing", () => {
    expect(pointInPolygon([5, 5], { type: "Point" })).toBe(false);
  });
});

describe("chooseContaining", () => {
  const bigPark: ParkPolygon = {
    mpId: "aaaa-0000",
    canonicalName: "Brush Creek/Lagoon Lake Wetlands and Coastal Dunes NP",
    polygon: square(0, 0, 100, 100),
  };
  const smallPark: ParkPolygon = {
    mpId: "bbbb-1111",
    canonicalName: "Manchester SP",
    polygon: square(40, 40, 60, 60),
  };

  it("returns null when nothing contains the point", () => {
    expect(chooseContaining([500, 500], "Manchester State Park", [bigPark, smallPark])).toBeNull();
  });

  it("returns the sole container when only one matches", () => {
    const r = chooseContaining([5, 5], "Manchester State Park", [bigPark, smallPark]);
    expect(r?.chosen.mpId).toBe("aaaa-0000");
    expect(r?.among).toHaveLength(1);
  });

  it("picks the name-matching park when polygons OVERLAP, not the first one", () => {
    // [50,50] is inside both. bigPark is first in input order, so plain
    // first-match-wins would return it — the exact CA bug.
    const r = chooseContaining([50, 50], "Manchester State Park", [bigPark, smallPark]);
    expect(r?.among).toHaveLength(2);
    expect(r?.chosen.mpId).toBe("bbbb-1111");
    expect(r?.chosen.canonicalName).toBe("Manchester SP");
  });

  it("is order-independent — reversing the input does not change the choice", () => {
    const forward = chooseContaining([50, 50], "Manchester State Park", [bigPark, smallPark]);
    const reverse = chooseContaining([50, 50], "Manchester State Park", [smallPark, bigPark]);
    expect(forward?.chosen.mpId).toBe(reverse?.chosen.mpId);
  });

  it("breaks exact-tie on mpId so the result is deterministic", () => {
    const twinA: ParkPolygon = { mpId: "zzzz-9999", canonicalName: "Twin Park", polygon: square(0, 0, 10, 10) };
    const twinB: ParkPolygon = { mpId: "aaaa-0001", canonicalName: "Twin Park", polygon: square(0, 0, 10, 10) };
    const forward = chooseContaining([5, 5], "Twin Park", [twinA, twinB]);
    const reverse = chooseContaining([5, 5], "Twin Park", [twinB, twinA]);
    expect(forward?.chosen.mpId).toBe("aaaa-0001");
    expect(reverse?.chosen.mpId).toBe("aaaa-0001");
  });

  it("reproduces the Point Dume shape — beach point inside both SB and NP", () => {
    const naturalPreserve: ParkPolygon = {
      mpId: "cccc-2222",
      canonicalName: "Point Dume NP",
      polygon: square(0, 0, 20, 20),
    };
    const stateBeach: ParkPolygon = {
      mpId: "dddd-3333",
      canonicalName: "Point Dume SB",
      polygon: square(5, 5, 15, 15),
    };
    const r = chooseContaining([10, 10], "Point Dume State Beach", [naturalPreserve, stateBeach]);
    expect(r?.among).toHaveLength(2);
    expect(r?.chosen.canonicalName).toBe("Point Dume SB");
  });
});

describe("containingPolygons", () => {
  it("returns every container, preserving input order", () => {
    const a: ParkPolygon = { mpId: "a", canonicalName: "A", polygon: square(0, 0, 100, 100) };
    const b: ParkPolygon = { mpId: "b", canonicalName: "B", polygon: square(0, 0, 50, 50) };
    expect(containingPolygons([10, 10], [a, b]).map((p) => p.mpId)).toEqual(["a", "b"]);
  });
});
