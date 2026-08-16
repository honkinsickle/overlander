/**
 * Unit tests for usfs.ts pure helpers (no network/DB).
 *
 * Rewritten 2026-08-15 for the INFRA rewrite: the ingester's source of
 * record moved from EDW_RecreationOpportunities_01 to
 * EDW_RecInfraRecreationSites_02. The old RecOpp-shape helpers
 * (`inferReservable`, RecOpp-specific `normalize`) are gone; these tests
 * exercise the INFRA-shape helpers (`inferCategoryV1`, `bestName`,
 * `extractPoint`, `normalize` with the new 5-arg signature).
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../lib/geojson.ts";
import { _internals } from "./usfs.ts";

const { extractPoint, inferCategoryV1, bestName, normalize, SITE_TYPE_TOKENS, DEFAULT_SITE_TYPE_TOKENS } = _internals;

const pointGeom = (lng: number, lat: number): GeoJsonFeature["geometry"] =>
  ({ type: "Point", coordinates: [lng, lat] }) as unknown as GeoJsonFeature["geometry"];

describe("extractPoint", () => {
  it("prefers GeoJSON Point geometry as [lng, lat]", () => {
    expect(extractPoint(pointGeom(-118.5, 37.2), {})).toEqual([-118.5, 37.2]);
  });
  it("falls back to latitude/longitude string fields when geometry is absent", () => {
    expect(extractPoint(null, { latitude: "37.2", longitude: "-118.5" })).toEqual([-118.5, 37.2]);
  });
  it("accepts latitude/longitude as numbers (the INFRA schema declares them as Double)", () => {
    expect(extractPoint(null, { latitude: 37.2, longitude: -118.5 })).toEqual([-118.5, 37.2]);
  });
  it("rejects (0,0) and unparseable coords", () => {
    expect(extractPoint(pointGeom(0, 0), {})).toBeNull();
    expect(extractPoint(null, { latitude: "abc", longitude: "-118" })).toBeNull();
    expect(extractPoint(null, {})).toBeNull();
  });
});

describe("bestName", () => {
  it("prefers public_site_name when populated", () => {
    expect(bestName({ public_site_name: "Prewitt Ridge", site_name: "PREWITT001" })).toBe("Prewitt Ridge");
  });
  it("falls back to site_name when public_site_name is missing", () => {
    expect(bestName({ public_site_name: null, site_name: "FS1302-03" })).toBe("FS1302-03");
    expect(bestName({ site_name: "MONTURE 006" })).toBe("MONTURE 006");
  });
  it("returns null when both are empty/whitespace", () => {
    expect(bestName({ public_site_name: "  ", site_name: "" })).toBeNull();
    expect(bestName({})).toBeNull();
  });
});

describe("inferCategoryV1 — six site_types, dispersed scale gate", () => {
  it("TRAILHEAD → trailhead", () => {
    expect(inferCategoryV1("TRAILHEAD", "0")).toEqual({ category: "trailhead", keep: true });
    expect(inferCategoryV1("TRAILHEAD", "3")).toEqual({ category: "trailhead", keep: true });
  });
  it("CAMPGROUND + GROUP CAMPGROUND → campground", () => {
    expect(inferCategoryV1("CAMPGROUND", "2")).toEqual({ category: "campground", keep: true });
    expect(inferCategoryV1("GROUP CAMPGROUND", "3")).toEqual({ category: "campground", keep: true });
  });
  it("CAMPING AREA at scale 0 or 1 → dispersed_camping (keep)", () => {
    expect(inferCategoryV1("CAMPING AREA", "0")).toEqual({ category: "dispersed_camping", keep: true });
    expect(inferCategoryV1("CAMPING AREA", "1")).toEqual({ category: "dispersed_camping", keep: true });
  });
  it("CAMPING AREA at scale 2+ → dispersed_camping (drop) — the scoping gate", () => {
    expect(inferCategoryV1("CAMPING AREA", "2")).toEqual({ category: "dispersed_camping", keep: false });
    expect(inferCategoryV1("CAMPING AREA", "3")).toEqual({ category: "dispersed_camping", keep: false });
    expect(inferCategoryV1("CAMPING AREA", null)).toEqual({ category: "dispersed_camping", keep: false });
    expect(inferCategoryV1("CAMPING AREA", "")).toEqual({ category: "dispersed_camping", keep: false });
  });
  it("PICNIC SITE + GROUP PICNIC SITE → picnic_area", () => {
    expect(inferCategoryV1("PICNIC SITE", null)).toEqual({ category: "picnic_area", keep: true });
    expect(inferCategoryV1("GROUP PICNIC SITE", null)).toEqual({ category: "picnic_area", keep: true });
  });
  it("HORSE CAMP / BOATING SITE / DAY USE AREA / anything else → unknown, drop", () => {
    expect(inferCategoryV1("HORSE CAMP", "1")).toEqual({ category: "unknown", keep: false });
    expect(inferCategoryV1("BOATING SITE", "2")).toEqual({ category: "unknown", keep: false });
    expect(inferCategoryV1("DAY USE AREA", "3")).toEqual({ category: "unknown", keep: false });
  });
});

describe("SITE_TYPE_TOKENS mapping", () => {
  it("all six default tokens map to a real INFRA site_type", () => {
    for (const t of DEFAULT_SITE_TYPE_TOKENS) {
      expect(SITE_TYPE_TOKENS[t]).toBeTruthy();
    }
  });
  it("token vocabulary matches the six-type v1 mapping (order-independent)", () => {
    expect(new Set(DEFAULT_SITE_TYPE_TOKENS)).toEqual(new Set([
      "trailhead", "campground", "group_campground",
      "camping_area", "picnic_site", "group_picnic_site",
    ]));
  });
});

describe("normalize", () => {
  const infraProps: Record<string, unknown> = {
    site_cn: "5210.002991",
    site_id: "3016",
    site_name: "TUMALO FALLS TH",
    public_site_name: "Tumalo Falls Trailhead",
    site_type: "TRAILHEAD",
    development_scale: "3",
    recarea_name: "Tumalo Falls Area",
    recarea_description: "Popular trailhead near Bend, OR.",
    recarea_enable: "Y",
    parent_recarea: null,
    fee_charged: "N",
    total_capacity: 25,
    minimum_elevation: "5000",
    operated_by: "US Forest Service",
    pack_in_out: "Yes",
    closest_towns: "Bend, OR",
    directions: "Drive west on Skyliners Rd…",
    usda_portal_url: "https://www.fs.usda.gov/recarea/deschutes/recarea/?recid=999",
  };
  it("populates canonical_name, description, tags, INFRA-native fields; no RecOpp block when unmatched", () => {
    const n = normalize(infraProps, "trailhead", "Tumalo Falls Trailhead", "5210.002991", null);
    expect(n.canonical_name).toBe("Tumalo Falls Trailhead");
    expect(n.description).toBe("Popular trailhead near Bend, OR.");
    expect(n.overlander_tags).toEqual(["federal_land", "usfs"]);
    expect(n.site_cn).toBe("5210.002991");
    expect(n.site_type).toBe("TRAILHEAD");
    expect(n.development_scale).toBe(3);
    expect(n.recopp).toBeNull();
    expect((n.provenance as { recopp_matched: boolean }).recopp_matched).toBe(false);
    expect(n.dispersed_camping).toBeUndefined();
  });
  it("plumbs total_capacity as a raw integer (no bucketing, no normalization)", () => {
    // Small-pull-off default value
    const n1 = normalize({ ...infraProps, total_capacity: "5" }, "trailhead", "Tumalo Falls Trailhead", "5210.002991", null);
    expect(n1.total_capacity).toBe(5);
    // Realistic large capacity
    const n2 = normalize({ ...infraProps, total_capacity: 250 }, "dispersed_camping", "Giant Gap Ridge", "184382010602", null);
    expect(n2.total_capacity).toBe(250);
    // Zero preserved as 0 (some INFRA rows carry it)
    const n3 = normalize({ ...infraProps, total_capacity: "0" }, "dispersed_camping", "Tule Meadow", "2549271010602", null);
    expect(n3.total_capacity).toBe(0);
    // Missing → null
    const { total_capacity: _drop, ...noCap } = infraProps;
    const n4 = normalize(noCap, "trailhead", "n", "cn", null);
    expect(n4.total_capacity).toBeNull();
  });
  it("plumbs recarea_enable both at top-level and in provenance", () => {
    const yes = normalize({ ...infraProps, recarea_enable: "Y" }, "trailhead", "n", "cn", null);
    expect(yes.recarea_enable).toBe("Y");
    expect((yes.provenance as { recarea_enable: string }).recarea_enable).toBe("Y");
    const no = normalize({ ...infraProps, recarea_enable: "N" }, "trailhead", "n", "cn", null);
    expect(no.recarea_enable).toBe("N");
    expect((no.provenance as { recarea_enable: string }).recarea_enable).toBe("N");
    const { recarea_enable: _drop, ...blank } = infraProps;
    const n = normalize(blank, "trailhead", "n", "cn", null);
    expect(n.recarea_enable).toBeNull();
    expect((n.provenance as { recarea_enable: string | null }).recarea_enable).toBeNull();
  });
  it("passes minimum_elevation through as-is (unreliable field — 'feet' string case)", () => {
    const bug = normalize({ ...infraProps, minimum_elevation: "feet" }, "trailhead", "n", "cn", null);
    expect(bug.minimum_elevation).toBe("feet");
    const real = normalize({ ...infraProps, minimum_elevation: "7,300 feet" }, "trailhead", "n", "cn", null);
    expect(real.minimum_elevation).toBe("7,300 feet");
  });
  it("emits the dispersed advisory (likely_allowed + verify_locally + mvum stub + tag) for dispersed_camping category", () => {
    const dispersed = { ...infraProps, site_type: "CAMPING AREA", development_scale: "0" };
    const n = normalize(dispersed, "dispersed_camping", "Prewitt Ridge", "5581.002731", null);
    expect(n.dispersed_camping).toBe("likely_allowed");
    expect(n.verify_locally).toBe(true);
    expect(n.mvum_corridor).toBeNull();
    expect(n.overlander_tags).toContain("dispersed_camping_likely");
  });
  it("merges RecOpp enrichment when provided and records provenance", () => {
    const n = normalize(infraProps, "trailhead", "Tumalo Falls Trailhead", "5210.002991", {
      recareaurl: "https://www.fs.usda.gov/recarea/deschutes/recarea/?recid=999",
      markeractivity: "Trailhead",
      markeractivitygroup: "Trailhead",
    });
    expect((n.recopp as any).url).toContain("fs.usda.gov");
    expect((n.recopp as any).marker_activity).toBe("Trailhead");
    expect((n.recopp as any).marker_activity_group).toBe("Trailhead");
    expect((n.provenance as { recopp_matched: boolean }).recopp_matched).toBe(true);
  });
  it("access bag surfaces operated_by + pack_in_out when either is populated", () => {
    const n = normalize(infraProps, "trailhead", "Tumalo Falls Trailhead", "5210.002991", null);
    expect(n.access).toEqual({ operated_by: "US Forest Service", pack_in_out: "Yes" });
  });
});
