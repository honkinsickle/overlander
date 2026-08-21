/**
 * Unit tests for state-parks.ts pure helpers (no network/DB).
 *
 * Covers: extractPoint, aggregateAzCampsites (with park-name resolution),
 * aggregateWaCampsites, dissolveBoundaries, buildAzAggRow (name + park_id),
 * buildWaAggRow (park_id), buildPointParkRow, buildCampgroundRow,
 * classifyFacility (NV category mapping).
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../lib/geojson.ts";
import { _internals } from "./state-parks.ts";

const {
  extractPoint,
  isYes,
  classifyFacility,
  buildAzParkLookup,
  findNearestPark,
  aggregateAzCampsites,
  aggregateWaCampsites,
  dissolveBoundaries,
  buildAzAggRow,
  buildWaAggRow,
  buildPointParkRow,
  buildCampgroundRow,
  SOURCE_ID,
  SOURCE_QUALITY_SCORE,
  AZ_CAMPSITE_QUALITY_SCORE,
} = _internals;

const pointGeom = (lng: number, lat: number): GeoJsonFeature["geometry"] =>
  ({ type: "Point", coordinates: [lng, lat] }) as unknown as GeoJsonFeature["geometry"];

const polyGeom = (coords: number[][][]): GeoJsonFeature["geometry"] =>
  ({ type: "Polygon", coordinates: coords }) as unknown as GeoJsonFeature["geometry"];

const feature = (
  properties: Record<string, unknown>,
  geometry: GeoJsonFeature["geometry"] = pointGeom(-111.5, 33.5),
): GeoJsonFeature =>
  ({ type: "Feature", geometry, properties }) as unknown as GeoJsonFeature;

// ── extractPoint ─────────────────────────────────────────────────────────

describe("extractPoint", () => {
  it("reads [lng, lat] from GeoJSON Point", () => {
    expect(extractPoint(pointGeom(-111.5, 33.5))).toEqual([-111.5, 33.5]);
  });
  it("rejects (0,0) and null", () => {
    expect(extractPoint(pointGeom(0, 0))).toBeNull();
    expect(extractPoint(null)).toBeNull();
  });
});

// ── isYes ────────────────────────────────────────────────────────────────

describe("isYes", () => {
  it("matches 'Yes' case-insensitively", () => {
    expect(isYes("Yes")).toBe(true);
    expect(isYes("yes")).toBe(true);
    expect(isYes(" Yes ")).toBe(true);
  });
  it("rejects No, blank, null", () => {
    expect(isYes("No")).toBe(false);
    expect(isYes(" ")).toBe(false);
    expect(isYes(null)).toBe(false);
  });
});

// ── NV facility classification ───────────────────────────────────────────

describe("classifyFacility", () => {
  it("classifies NV Campground as campground", () => {
    const { recordType, category } = classifyFacility("NV", "Campground");
    expect(recordType).toBe("campground");
    expect(category).toBe("campground");
  });

  it("classifies NV Non-motorized Trailhead as trailhead", () => {
    const { category } = classifyFacility("NV", "Non-motorized Trailhead");
    expect(category).toBe("trailhead");
  });

  it("classifies NV Trailhead as trailhead", () => {
    const { category } = classifyFacility("NV", "Trailhead");
    expect(category).toBe("trailhead");
  });

  it("classifies NV Scenic View as park_feature", () => {
    const { recordType, category } = classifyFacility("NV", "Scenic View");
    expect(recordType).toBe("facility");
    expect(category).toBe("park_feature");
  });

  it("classifies NV Ranger Station as park_feature", () => {
    const { category } = classifyFacility("NV", "Ranger Station");
    expect(category).toBe("park_feature");
  });

  it("classifies NV Toilet as park_feature", () => {
    const { category } = classifyFacility("NV", "Toilet");
    expect(category).toBe("park_feature");
  });

  it("non-NV states always get campground", () => {
    const { recordType, category } = classifyFacility("CA", "Anything");
    expect(recordType).toBe("campground");
    expect(category).toBe("campground");
  });

  it("null type in NV gets park_feature", () => {
    const { category } = classifyFacility("NV", null);
    expect(category).toBe("park_feature");
  });
});

// ── AZ park lookup ───────────────────────────────────────────────────────

describe("buildAzParkLookup + findNearestPark", () => {
  const parkFeatures = [
    feature({ Name: "Lost Dutchman State Park", GlobalID: "ldsp-guid" }, pointGeom(-111.48, 33.46)),
    feature({ Name: "Catalina State Park", GlobalID: "cata-guid" }, pointGeom(-110.92, 32.43)),
  ];

  it("builds a lookup from park features", () => {
    const lookup = buildAzParkLookup(parkFeatures);
    expect(lookup.length).toBe(2);
    expect(lookup[0].name).toBe("Lost Dutchman State Park");
    expect(lookup[0].globalId).toBe("ldsp-guid");
  });

  it("finds the nearest park by distance", () => {
    const lookup = buildAzParkLookup(parkFeatures);
    const nearest = findNearestPark(-111.5, 33.5, lookup);
    expect(nearest?.name).toBe("Lost Dutchman State Park");
  });

  it("returns null for an empty lookup", () => {
    expect(findNearestPark(-111.5, 33.5, [])).toBeNull();
  });
});

// ── AZ campsite aggregation ──────────────────────────────────────────────

describe("aggregateAzCampsites", () => {
  const parkLookup = [
    { name: "Lost Dutchman State Park", globalId: "ldsp-guid", lng: -111.48, lat: 33.46 },
    { name: "Catalina State Park", globalId: "cata-guid", lng: -110.92, lat: 32.43 },
  ];

  const azSite = (parkCode: string, overrides: Record<string, unknown> = {}, coords: [number, number] = [-111.5, 33.5]) =>
    feature({
      PARK_ABBR4: parkCode,
      SITE_ID: "1",
      TYPE: "RV_Tent",
      ELECTRICAL: "Yes",
      WATER: "No",
      SEWER: "No",
      ADA: "No",
      ACCESS_TYP: "Back_in",
      SHADED: "Yes",
      RESERVABLE: "Yes",
      FIREPIT: "Yes",
      GRILL: "No",
      PICNIC_TAB: "Yes",
      DOUBLE_WID: "No",
      SURFACE: "Gravel",
      ...overrides,
    }, pointGeom(coords[0], coords[1]));

  it("groups by PARK_ABBR4 and resolves park name via nearest-point", () => {
    const features = [
      azSite("LDSP", {}, [-111.48, 33.46]),
      azSite("LDSP", {}, [-111.49, 33.47]),
      azSite("CATA", {}, [-110.92, 32.43]),
    ];
    const result = aggregateAzCampsites(features, parkLookup);
    expect(result.length).toBe(2);

    const ldsp = result.find((r) => r.parkAbbr4 === "LDSP")!;
    expect(ldsp.parkName).toBe("Lost Dutchman State Park");
    expect(ldsp.parkGlobalId).toBe("ldsp-guid");
    expect(ldsp.siteCount).toBe(2);

    const cata = result.find((r) => r.parkAbbr4 === "CATA")!;
    expect(cata.parkName).toBe("Catalina State Park");
    expect(cata.parkGlobalId).toBe("cata-guid");
  });

  it("sets parkName null when no park lookup is available (no-match case)", () => {
    const features = [azSite("XXXX", {}, [-150, 60])];
    const result = aggregateAzCampsites(features, []);
    expect(result.length).toBe(1);
    expect(result[0].parkName).toBeNull();
    expect(result[0].parkGlobalId).toBeNull();
  });

  it("computes amenity fractions correctly", () => {
    const features = [
      azSite("LDSP", { ELECTRICAL: "Yes", WATER: "Yes", ADA: "Yes" }),
      azSite("LDSP", { ELECTRICAL: "No", WATER: "No", ADA: "No" }),
    ];
    const result = aggregateAzCampsites(features, parkLookup);
    const ldsp = result[0];
    expect(ldsp.amenities.pct_electrical).toBe(0.5);
    expect(ldsp.amenities.pct_water).toBe(0.5);
    expect(ldsp.amenities.pct_ada).toBe(0.5);
  });

  it("skips features with no geometry or no park code", () => {
    const features = [
      feature({ PARK_ABBR4: null, ELECTRICAL: "Yes" }),
      feature({ PARK_ABBR4: "LDSP" }, null),
    ];
    const result = aggregateAzCampsites(features, parkLookup);
    expect(result.length).toBe(0);
  });

  it("tallies TYPE and SURFACE distributions", () => {
    const features = [
      azSite("LDSP", { TYPE: "RV_Tent", SURFACE: "Paved" }),
      azSite("LDSP", { TYPE: "Tent", SURFACE: "Gravel" }),
      azSite("LDSP", { TYPE: "RV_Tent", SURFACE: "Paved" }),
    ];
    const result = aggregateAzCampsites(features, parkLookup);
    const ldsp = result[0];
    expect(ldsp.types).toEqual({ RV_Tent: 2, Tent: 1 });
    expect(ldsp.surfaces).toEqual({ Paved: 2, Gravel: 1 });
  });
});

// ── WA campsite aggregation ──────────────────────────────────────────────

describe("aggregateWaCampsites", () => {
  const waSite = (parkName: string, filter: string | null = "active") =>
    feature({ ParkName: parkName, Filter: filter, Name: "Site 1" });

  it("groups by ParkName and counts active sites", () => {
    const features = [
      waSite("Deception Pass"),
      waSite("Deception Pass"),
      waSite("Deception Pass", "inactive"),
      waSite("Potlatch"),
    ];
    const result = aggregateWaCampsites(features);
    expect(result.length).toBe(2);

    const dp = result.find((r) => r.parkName === "Deception Pass")!;
    expect(dp.activeSiteCount).toBe(2);
    expect(dp.totalSiteCount).toBe(3);

    const pot = result.find((r) => r.parkName === "Potlatch")!;
    expect(pot.activeSiteCount).toBe(1);
  });

  it("excludes parks with zero active sites", () => {
    const features = [waSite("Closed Park", "inactive")];
    const result = aggregateWaCampsites(features);
    expect(result.length).toBe(0);
  });

  it("treats null Filter as non-active", () => {
    const features = [waSite("Mystery Park", null)];
    const result = aggregateWaCampsites(features);
    expect(result.length).toBe(0);
  });

  it("computes centroid from active-only records", () => {
    const features = [
      feature({ ParkName: "Test Park", Filter: "active", Name: "S1" }, pointGeom(-120, 48)),
      feature({ ParkName: "Test Park", Filter: "active", Name: "S2" }, pointGeom(-122, 48)),
      feature({ ParkName: "Test Park", Filter: null, Name: "S3" }, pointGeom(-200, 48)),
    ];
    const result = aggregateWaCampsites(features);
    expect(result[0].centroidLng).toBe(-121);
    expect(result[0].activeSiteCount).toBe(2);
  });
});

// ── Boundary dissolve ────────────────────────────────────────────────────

describe("dissolveBoundaries", () => {
  const ring = [[-120, 40], [-119, 40], [-119, 41], [-120, 41], [-120, 40]];

  it("dissolves features sharing a groupBy key into one unit", () => {
    const features = [
      feature({ UNITNBR: "207", UNITNAME: "Fort Ross SHP", GlobalID: "aaa" }, polyGeom([ring])),
      feature({ UNITNBR: "207", UNITNAME: "Fort Ross SHP", GlobalID: "bbb" }, polyGeom([ring])),
    ];
    const result = dissolveBoundaries(features, "UNITNBR", "GlobalID");
    expect(result.length).toBe(1);
    expect(result[0].groupKey).toBe("207");
    expect(result[0].stableKeys.size).toBe(2);
    expect(result[0].members.length).toBe(2);
  });

  it("keeps distinct groupBy keys separate", () => {
    const features = [
      feature({ UNITNBR: "207", GlobalID: "aaa" }, polyGeom([ring])),
      feature({ UNITNBR: "231", GlobalID: "bbb" }, polyGeom([ring])),
    ];
    const result = dissolveBoundaries(features, "UNITNBR", "GlobalID");
    expect(result.length).toBe(2);
  });

  it("treats null groupBy as singletons", () => {
    const features = [
      feature({ UNITNBR: null, GlobalID: "aaa" }, polyGeom([ring])),
      feature({ UNITNBR: null, GlobalID: "bbb" }, polyGeom([ring])),
    ];
    const result = dissolveBoundaries(features, "UNITNBR", "GlobalID");
    expect(result.length).toBe(2);
  });
});

// ── buildAzAggRow ────────────────────────────────────────────────────────

describe("buildAzAggRow", () => {
  it("uses resolved park name, includes park_id linkage", () => {
    const agg: Parameters<typeof buildAzAggRow>[0] = {
      parkAbbr4: "LDSP",
      parkName: "Lost Dutchman State Park",
      parkGlobalId: "ldsp-guid-123",
      siteCount: 73,
      centroidLng: -111.48,
      centroidLat: 33.46,
      amenities: {
        pct_electrical: 0.5, pct_water: 0.3, pct_sewer: 0.1, pct_ada: 0.05,
        pct_pull_through: 0.2, pct_shaded: 0.4, pct_reservable: 0.9,
        pct_firepit: 0.8, pct_grill: 0.6, pct_picnic_table: 0.95, pct_double_wide: 0.15,
      },
      types: { RV_Tent: 50, Tent: 23 },
      surfaces: { Gravel: 40, Paved: 33 },
    };
    const row = buildAzAggRow(agg);
    expect(row.name).toBe("Lost Dutchman State Park Campground");
    expect(row.external_id).toBe("state_parks:AZ:campground:LDSP");
    expect(row.source_quality_score).toBe(AZ_CAMPSITE_QUALITY_SCORE);

    const np = row.normalized_payload as Record<string, unknown>;
    expect(np.canonical_name).toBe("Lost Dutchman State Park Campground");
    expect(np.park_id).toBe("state_parks:AZ:park:ldsp-guid-123");
    expect(np.park_name).toBe("Lost Dutchman State Park");
    expect(np.data_vintage).toBe("2016");
    expect((np.capacity as Record<string, unknown>).site_count).toBe(73);
  });

  it("falls back to PARK_ABBR4 code when park name is null", () => {
    const agg: Parameters<typeof buildAzAggRow>[0] = {
      parkAbbr4: "XXXX",
      parkName: null,
      parkGlobalId: null,
      siteCount: 10,
      centroidLng: -111, centroidLat: 33,
      amenities: {
        pct_electrical: 0, pct_water: 0, pct_sewer: 0, pct_ada: 0,
        pct_pull_through: 0, pct_shaded: 0, pct_reservable: 0,
        pct_firepit: 0, pct_grill: 0, pct_picnic_table: 0, pct_double_wide: 0,
      },
      types: {}, surfaces: {},
    };
    const row = buildAzAggRow(agg);
    expect(row.name).toBe("XXXX Campground");

    const np = row.normalized_payload as Record<string, unknown>;
    expect(np).not.toHaveProperty("park_id");
    expect((np.provenance as Record<string, unknown>).unresolved_code).toBe(true);
  });
});

// ── buildWaAggRow ────────────────────────────────────────────────────────

describe("buildWaAggRow", () => {
  it("produces correct external_id, active site count, and park_id", () => {
    const agg: Parameters<typeof buildWaAggRow>[0] = {
      parkName: "Deception Pass",
      activeSiteCount: 143,
      totalSiteCount: 150,
      centroidLng: -122.65,
      centroidLat: 48.40,
    };
    const row = buildWaAggRow(agg);
    expect(row.source_id).toBe(SOURCE_ID);
    expect(row.external_id).toBe("state_parks:WA:campground:Deception Pass");
    expect(row.source_quality_score).toBe(SOURCE_QUALITY_SCORE);

    const np = row.normalized_payload as Record<string, unknown>;
    expect((np.capacity as Record<string, unknown>).site_count).toBe(143);
    expect(np.park_id).toBe("state_parks:WA:park:Deception Pass");
    expect(np.park_name).toBe("Deception Pass");
    expect(np).not.toHaveProperty("amenities");
  });
});

// ── buildPointParkRow ────────────────────────────────────────────────────

describe("buildPointParkRow", () => {
  it("builds a park row from an AZ State_Park_Points feature", () => {
    const f = feature({
      Name: "Lost Dutchman State Park",
      GlobalID: "3c4fc77e-6074-4769-ad7d-06195826357c",
      County: "Maricopa",
      YearOpened: 1977,
    });
    const config = { url: "https://example.com/FeatureServer/0", stableKey: "GlobalID" };
    const row = buildPointParkRow("AZ", f, config);
    expect(row).not.toBeNull();
    expect(row!.external_id).toBe("state_parks:AZ:park:3c4fc77e-6074-4769-ad7d-06195826357c");
    expect(row!.name).toBe("Lost Dutchman State Park");
    expect(row!.inferred_category).toBe("recreation_area");
    expect(row!.source_quality_score).toBe(SOURCE_QUALITY_SCORE);
  });

  it("skips when missing geometry or stable key", () => {
    const noGeom = feature({ Name: "Test", GlobalID: "abc" }, null);
    expect(buildPointParkRow("AZ", noGeom, { url: "", stableKey: "GlobalID" })).toBeNull();

    const noKey = feature({ Name: "Test" });
    expect(buildPointParkRow("AZ", noKey, { url: "", stableKey: "GlobalID" })).toBeNull();
  });
});

// ── buildCampgroundRow ───────────────────────────────────────────────────

describe("buildCampgroundRow", () => {
  it("builds a CA campground row with park_id linkage", () => {
    const f = feature({
      Campground: "Ritchey Creek Campground",
      GISID: "GIS0006395",
      TYPE: "Developed Family Camp Area",
      SUBTYPE: "Tent Only",
      UNITNBR: "240",
      UNITNAME: "Bothe-Napa Valley SP",
    });
    const parentLookup = new Map([["240", "state_parks:CA:park:240"]]);
    const config = { url: "https://example.com/Campgrounds/FeatureServer/0", stableKey: "GISID" };
    const row = buildCampgroundRow("CA", f, config, parentLookup);
    expect(row).not.toBeNull();
    expect(row!.external_id).toBe("state_parks:CA:campground:GIS0006395");
    expect(row!.inferred_category).toBe("campground");

    const np = row!.normalized_payload as Record<string, unknown>;
    expect(np.park_id).toBe("state_parks:CA:park:240");
    expect(np.park_name).toBe("Bothe-Napa Valley SP");
  });

  it("classifies NV Campground-type records as campground, not park_feature", () => {
    const f = feature({
      poiname: "Cathedral Gorge Campground",
      guid: "{SOME-GUID}",
      type: "Campground",
    });
    const config = { url: "https://example.com/FeatureServer/0", stableKey: "guid" };
    const row = buildCampgroundRow("NV", f, config);
    expect(row).not.toBeNull();
    expect(row!.inferred_category).toBe("campground");
    expect(row!.external_id).toMatch(/^state_parks:NV:campground:/);
  });

  it("classifies NV Trailhead-type records as trailhead", () => {
    const f = feature({
      poiname: "Eagle Point Trailhead",
      guid: "{ANOTHER-GUID}",
      type: "Non-motorized Trailhead",
    });
    const config = { url: "https://example.com/FeatureServer/0", stableKey: "guid" };
    const row = buildCampgroundRow("NV", f, config);
    expect(row).not.toBeNull();
    expect(row!.inferred_category).toBe("trailhead");
    expect(row!.external_id).toMatch(/^state_parks:NV:facility:/);
  });

  it("classifies NV Scenic View as park_feature", () => {
    const f = feature({
      poiname: "Valley Overlook",
      guid: "{VIEW-GUID}",
      type: "Scenic View",
    });
    const config = { url: "https://example.com/FeatureServer/0", stableKey: "guid" };
    const row = buildCampgroundRow("NV", f, config);
    expect(row).not.toBeNull();
    expect(row!.inferred_category).toBe("park_feature");
    expect(row!.external_id).toMatch(/^state_parks:NV:facility:/);
  });
});
