/**
 * Unit tests for the EWKT geometry serializers used by client-side batched
 * upserts. Pure — no DB, no network.
 */

import { describe, expect, it } from "vitest";

import { multiLineStringEwkt, pointEwkt } from "./ewkt.ts";

describe("pointEwkt", () => {
  it("serializes a [lng, lat] to SRID-stamped EWKT POINT", () => {
    expect(pointEwkt([-118.2437, 34.0522])).toBe("SRID=4326;POINT(-118.2437 34.0522)");
  });

  it("preserves coordinate order (lng then lat)", () => {
    expect(pointEwkt([1, 2])).toBe("SRID=4326;POINT(1 2)");
  });
});

describe("multiLineStringEwkt", () => {
  it("serializes a single-line MultiLineString", () => {
    const coords = [[[0, 0], [1, 1], [2, 3]]];
    expect(multiLineStringEwkt(coords)).toBe("SRID=4326;MULTILINESTRING((0 0,1 1,2 3))");
  });

  it("serializes a multi-segment route (multiple lines)", () => {
    const coords = [
      [[0, 0], [1, 0]],
      [[5, 5], [6, 6], [7, 7]],
    ];
    expect(multiLineStringEwkt(coords)).toBe(
      "SRID=4326;MULTILINESTRING((0 0,1 0),(5 5,6 6,7 7))",
    );
  });

  it("throws on an empty MultiLineString", () => {
    expect(() => multiLineStringEwkt([])).toThrow(/empty/);
  });

  it("throws on an empty line within a MultiLineString", () => {
    expect(() => multiLineStringEwkt([[]])).toThrow(/empty/);
  });
});
