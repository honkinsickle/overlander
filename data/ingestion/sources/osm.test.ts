/**
 * Unit tests for osm.ts pure helpers — focused on the Phase 2 (PR-B)
 * dispersed-camping classification split. No network/DB.
 */

import { describe, expect, it } from "vitest";

import { _internals } from "./osm.ts";

const { inferCategory, normalizeOsm } = _internals;

describe("inferCategory — dispersed-camping split (PR-B)", () => {
  it("camp_site + backcountry=yes → dispersed_camping", () => {
    expect(inferCategory({ tourism: "camp_site", backcountry: "yes" })).toBe("dispersed_camping");
  });
  it("camp_site + informal=yes → dispersed_camping", () => {
    expect(inferCategory({ tourism: "camp_site", informal: "yes" })).toBe("dispersed_camping");
  });
  it("plain camp_site → campground (unchanged)", () => {
    expect(inferCategory({ tourism: "camp_site" })).toBe("campground");
    expect(inferCategory({ tourism: "camp_site", backcountry: "no" })).toBe("campground");
  });
  it("caravan_site stays campground even with backcountry=yes (RV-oriented, not dispersed)", () => {
    expect(inferCategory({ tourism: "caravan_site", backcountry: "yes" })).toBe("campground");
  });
  it("non-camping tags are unaffected by the split", () => {
    expect(inferCategory({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(inferCategory({ natural: "peak", backcountry: "yes" })).toBe("peak");
    expect(inferCategory({ amenity: "fuel" })).toBe("gas_station");
  });
});

describe("inferCategory — dump_station tag correction", () => {
  it("amenity=sanitary_dump_station → dump_station (RV sanitary dumps, the intended target)", () => {
    expect(inferCategory({ amenity: "sanitary_dump_station" })).toBe("dump_station");
  });
  it("amenity=waste_disposal → NOT categorized as dump_station (municipal trash bin, not RV)", () => {
    // waste_disposal was previously mis-mapped to dump_station and produced
    // 1,723 false-positive rows on PROD. It's no longer in the mapping.
    expect(inferCategory({ amenity: "waste_disposal" })).toBeNull();
  });
});

describe("normalizeOsm — dump_station amenity boolean tracks sanitary_dump_station only", () => {
  it("sanitary_dump_station node lights the dump_station amenity flag", () => {
    const n = normalizeOsm({ amenity: "sanitary_dump_station" }, "Unnamed dump station", "dump_station");
    expect((n.amenities as Record<string, unknown> | null)?.dump_station).toBe(true);
  });
  it("waste_disposal node does NOT light the dump_station amenity flag", () => {
    const n = normalizeOsm({ amenity: "waste_disposal" }, "Unnamed waste_disposal", null);
    // With waste_disposal removed from the mapping, its category is null and
    // the amenity flag is not set either — the row wouldn't even ingest via
    // persistElement's category-null guard, but the pure normalizer should
    // still refuse to falsely flag it as a dump_station.
    expect(n.amenities).toBeNull();
  });
});

describe("normalizeOsm — dispersed advisory payload", () => {
  it("sets likely_allowed + verify_locally + mvum stub for dispersed_camping", () => {
    const n = normalizeOsm(
      { tourism: "camp_site", backcountry: "yes", name: "Coon Creek" },
      "Coon Creek",
      "dispersed_camping",
    );
    expect(n.dispersed_camping).toBe("likely_allowed");
    expect(n.verify_locally).toBe(true);
    expect(n.mvum_corridor).toBeNull();
    expect(n.canonical_name).toBe("Coon Creek");
  });
  it("does NOT set the advisory for a developed campground", () => {
    const n = normalizeOsm({ tourism: "camp_site", name: "Belle" }, "Belle", "campground");
    expect(n.dispersed_camping).toBeUndefined();
    expect(n.verify_locally).toBeUndefined();
    expect(n.mvum_corridor).toBeUndefined();
  });
});
