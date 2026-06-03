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
