/**
 * Unit tests for parks-canada ingester — pure helpers only.
 *
 * Network + DB paths are exercised via the Banff smoke test in milestone 3
 * (an integration concern that runs against real ESRI endpoints, not a
 * unit test). This file focuses on the transformation surface:
 * geometry parsing, bilingual name preference, category inference,
 * normalizer field mapping.
 */

import { describe, expect, it } from "vitest";

import { _internals } from "./parks-canada.ts";

const {
  bboxCentroid,
  extractPolygon,
  inferAccommodationCategory,
  inferBoundaryCategory,
  inferInterestPointCategory,
  normalizeAccommodation,
  normalizeBoundary,
  normalizeInterestPoint,
  parsePoint,
  pickName,
} = _internals;

describe("pickName — bilingual preference", () => {
  it("prefers English when present", () => {
    expect(pickName("Banff National Park", "Parc national Banff", "fallback"))
      .toBe("Banff National Park");
  });

  it("falls back to French when English is null or empty", () => {
    expect(pickName(null, "Parc national Banff", "fallback")).toBe(
      "Parc national Banff",
    );
    expect(pickName("", "Parc national Banff", "fallback")).toBe(
      "Parc national Banff",
    );
    expect(pickName("   ", "Parc national Banff", "fallback")).toBe(
      "Parc national Banff",
    );
  });

  it("falls back to the supplied fallback when both are missing", () => {
    expect(pickName(null, null, "Parks Canada feature 42")).toBe(
      "Parks Canada feature 42",
    );
    expect(pickName(undefined, undefined, "Parks Canada feature 42")).toBe(
      "Parks Canada feature 42",
    );
  });

  it("trims whitespace", () => {
    expect(pickName("  Tunnel Mountain  ", null, "x")).toBe("Tunnel Mountain");
  });
});

describe("parsePoint", () => {
  it("returns [lng, lat] from a valid Point geometry", () => {
    expect(
      parsePoint({ type: "Point", coordinates: [-115.57, 51.18] }),
    ).toEqual([-115.57, 51.18]);
  });

  it("returns null for non-Point geometries", () => {
    expect(
      parsePoint({ type: "LineString", coordinates: [[0, 0], [1, 1]] }),
    ).toBeNull();
    expect(parsePoint({ type: "Polygon", coordinates: [[]] })).toBeNull();
  });

  it("returns null for missing / invalid coordinates", () => {
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint({ type: "Point", coordinates: [] })).toBeNull();
    expect(parsePoint({ type: "Point", coordinates: [0] })).toBeNull();
    expect(
      parsePoint({ type: "Point", coordinates: ["a" as unknown as number, 0] }),
    ).toBeNull();
    expect(
      parsePoint({ type: "Point", coordinates: [NaN, 0] }),
    ).toBeNull();
  });

  it("treats 0,0 as null (sentinel for missing geometry)", () => {
    expect(parsePoint({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });
});

describe("extractPolygon", () => {
  it("returns the polygon shape verbatim", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };
    expect(extractPolygon(polygon)).toEqual(polygon);
  });

  it("returns the multipolygon shape verbatim", () => {
    const mp = {
      type: "MultiPolygon" as const,
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]],
    };
    expect(extractPolygon(mp)).toEqual(mp);
  });

  it("returns null for Point / null", () => {
    expect(extractPolygon({ type: "Point", coordinates: [0, 1] })).toBeNull();
    expect(extractPolygon(null)).toBeNull();
  });
});

describe("bboxCentroid", () => {
  it("returns the midpoint of a polygon's bounding box", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
    };
    expect(bboxCentroid(polygon)).toEqual([5, 10]);
  });

  it("handles MultiPolygon by spanning all polygons' bboxes", () => {
    const mp = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
      ],
    };
    expect(bboxCentroid(mp)).toEqual([6, 6]);
  });

  it("returns null for an empty / malformed geometry", () => {
    expect(
      bboxCentroid({ type: "Polygon", coordinates: [] }),
    ).toBeNull();
  });
});

describe("inferInterestPointCategory", () => {
  it.each([
    ["Trailhead", "trailhead"],
    ["TRAIL HEAD", "trailhead"],
    ["Viewpoint", "viewpoint"],
    ["Scenic Lookout", "viewpoint"],
    ["Vista", "viewpoint"],
    ["Belvédère panoramique", "viewpoint"],
    ["Picnic Area", "picnic_area"],
    ["Visitor Centre", "visitor_center"],
    ["Interpretive Trail", "visitor_center"],
    ["National Historic Site", "national_historic_site"],
    ["Lieu historique national", "national_historic_site"],
    ["Marine Park", "national_marine_conservation_area"],
    ["Group Camping", "campground"],
  ])("%s → %s", (input, expected) => {
    expect(inferInterestPointCategory(input)).toBe(expected);
  });

  it("defaults to park_feature for unknown types", () => {
    expect(inferInterestPointCategory("Something Brand New")).toBe(
      "park_feature",
    );
    expect(inferInterestPointCategory(null)).toBe("park_feature");
    expect(inferInterestPointCategory(undefined)).toBe("park_feature");
    expect(inferInterestPointCategory(42)).toBe("park_feature");
  });
});

describe("inferBoundaryCategory + inferAccommodationCategory — constant mappings", () => {
  it("boundary category is always park_boundary", () => {
    expect(inferBoundaryCategory("National Park")).toBe("park_boundary");
    expect(inferBoundaryCategory("National Marine Conservation Area")).toBe(
      "park_boundary",
    );
    expect(inferBoundaryCategory(null)).toBe("park_boundary");
  });

  it("accommodation category is always campground", () => {
    expect(inferAccommodationCategory("Front-country Campground")).toBe(
      "campground",
    );
    expect(inferAccommodationCategory("oTENTik")).toBe("campground");
    expect(inferAccommodationCategory(null)).toBe("campground");
  });
});

describe("normalizers", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  it("normalizeBoundary surfaces canonical_name, polygon, admin_area_type, federal tag", () => {
    const out = normalizeBoundary(
      {
        OBJECTID: 1,
        AdminAreaNameEn: "Banff National Park",
        AdminAreaNameFr: "Parc national Banff",
        AdminAreaType: "National Park",
      },
      polygon,
      "Banff National Park",
    );
    expect(out).toMatchObject({
      canonical_name: "Banff National Park",
      overlander_tags: ["federal_land", "parks_canada"],
      geometry_polygon: polygon,
      admin_area_type: "National Park",
      description: null,
      contact: null,
      amenities: null,
      hours: null,
    });
  });

  it("normalizeAccommodation prefers EN, stores location as description, accommodation_type into amenities", () => {
    const out = normalizeAccommodation(
      {
        NameEn: "Tunnel Mountain Village I",
        NameFr: "Village du Tunnel Mountain I",
        AccommodationTypeEn: "Front-country Campground",
        LocationEn: "Banff National Park",
      },
      "Tunnel Mountain Village I",
    );
    expect(out).toMatchObject({
      canonical_name: "Tunnel Mountain Village I",
      overlander_tags: ["federal_land", "parks_canada"],
      description: "Banff National Park",
      amenities: { accommodation_type: "Front-country Campground" },
    });
  });

  it("normalizeAccommodation collapses missing accommodation_type to null amenities", () => {
    const out = normalizeAccommodation(
      { NameEn: "Some Campground", AccommodationTypeEn: null },
      "Some Campground",
    );
    expect(out.amenities).toBeNull();
  });

  it("normalizeInterestPoint stores interest_type into amenities, location into description", () => {
    const out = normalizeInterestPoint(
      {
        NameEn: "Bow Falls Viewpoint",
        InterestTypeEn: "Viewpoint",
        LocationEn: "Banff National Park",
      },
      "Bow Falls Viewpoint",
    );
    expect(out).toMatchObject({
      canonical_name: "Bow Falls Viewpoint",
      description: "Banff National Park",
      amenities: { interest_type: "Viewpoint" },
      overlander_tags: ["federal_land", "parks_canada"],
    });
  });
});
