/**
 * Unit tests for parks-canada ingester — pure helpers only.
 *
 * Network + DB paths are exercised via the Banff smoke test (an
 * integration concern that runs against real ESRI endpoints). This file
 * focuses on the transformation surface: geometry parsing, bilingual
 * name preference, `Principal_type` splitting, category inference,
 * normalizer field mapping.
 *
 * Attribute field names reflect the actual ESRI response shapes
 * observed 2026-05-30:
 *
 *   - NPLB boundaries (NRCan MapServer): camelCase + Eng/Fra
 *     (adminAreaNameEng, distributionTypeEng, adminAreaId)
 *   - Accommodation + Interest Points (ArcGIS Online): _e/_f suffix
 *     (Name_e, Nom_f, Descr_e, Site_Num_Site)
 *   - Interest Points Principal_type: combined "EN//FR" string
 *     requiring `splitBilingual` before category inference.
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
  splitBilingual,
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

describe("splitBilingual", () => {
  it("splits on the default // separator", () => {
    expect(splitBilingual("Trailhead//Sentier de randonnée")).toEqual({
      en: "Trailhead",
      fr: "Sentier de randonnée",
    });
  });

  it("trims whitespace on both halves", () => {
    expect(splitBilingual("Camp // Campement")).toEqual({
      en: "Camp",
      fr: "Campement",
    });
  });

  it("returns the whole string as `en` when no separator is present", () => {
    expect(splitBilingual("Trailhead")).toEqual({ en: "Trailhead", fr: "" });
  });

  it("supports a custom separator", () => {
    expect(splitBilingual("a|b", "|")).toEqual({ en: "a", fr: "b" });
  });

  it("handles empty halves", () => {
    expect(splitBilingual("//Campement")).toEqual({ en: "", fr: "Campement" });
    expect(splitBilingual("Camp//")).toEqual({ en: "Camp", fr: "" });
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

describe("inferInterestPointCategory — combined Principal_type strings", () => {
  it.each([
    // Real-shape "EN//FR" inputs that the live ESRI layer returns.
    ["Trailhead//Sentier de randonnée", "trailhead"],
    ["Viewpoint//Belvédère", "viewpoint"],
    ["Scenic Lookout//Belvédère panoramique", "viewpoint"],
    ["Picnic Area//Aire de pique-nique", "picnic_area"],
    ["Visitor Centre//Centre d'accueil", "visitor_center"],
    ["Interpretive Trail//Sentier d'interprétation", "visitor_center"],
    ["National Historic Site//Lieu historique national", "national_historic_site"],
    // Surfaced in Banff smoke iteration 2: Parks Canada uses
    // "Historic point of interest" (not "Historic site") for many records.
    // Broaden regex from /historic\s?site/ to /historic/ catches both.
    ["Historic point of interest//Lieu historique d'intérêt", "national_historic_site"],
    ["Historic landmark//Monument historique", "national_historic_site"],
    ["Marine Park//Parc marin", "national_marine_conservation_area"],
    ["Camp//Campement", "campground"],
    // Plain-English inputs (no //) still work — splitBilingual returns
    // the whole string as `en` when no separator present.
    ["Trailhead", "trailhead"],
    ["TRAIL HEAD", "trailhead"],
    ["Vista", "viewpoint"],
  ])("%s → %s", (input, expected) => {
    expect(inferInterestPointCategory(input)).toBe(expected);
  });

  it("defaults to park_feature for unknown types", () => {
    expect(inferInterestPointCategory("Something Brand New")).toBe(
      "park_feature",
    );
    expect(inferInterestPointCategory("Brand New//Tout nouveau")).toBe(
      "park_feature",
    );
    expect(inferInterestPointCategory(null)).toBe("park_feature");
    expect(inferInterestPointCategory(undefined)).toBe("park_feature");
    expect(inferInterestPointCategory(42)).toBe("park_feature");
  });
});

describe("inferBoundaryCategory + inferAccommodationCategory — constant mappings", () => {
  it("boundary category is always park_boundary", () => {
    expect(inferBoundaryCategory("National Park of Canada")).toBe(
      "park_boundary",
    );
    expect(inferBoundaryCategory("National Marine Conservation Area")).toBe(
      "park_boundary",
    );
    expect(inferBoundaryCategory(null)).toBe("park_boundary");
  });

  it("accommodation category is always campground", () => {
    expect(inferAccommodationCategory("Camping")).toBe("campground");
    expect(inferAccommodationCategory("oTENTik")).toBe("campground");
    expect(inferAccommodationCategory(null)).toBe("campground");
  });
});

describe("normalizers — real ESRI attribute shapes", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  it("normalizeBoundary surfaces canonical_name, polygon, distribution_type, federal tag", () => {
    const out = normalizeBoundary(
      {
        OBJECTID: 376,
        adminAreaId: "BANF",
        adminAreaNameEng: "BANFF NATIONAL PARK OF CANADA",
        adminAreaNameFra: "PARC NATIONAL BANFF DU CANADA",
        distributionTypeEng: "National Park of Canada",
        distributionTypeFra: "Parc national du Canada",
      },
      polygon,
      "BANFF NATIONAL PARK OF CANADA",
    );
    expect(out).toMatchObject({
      canonical_name: "BANFF NATIONAL PARK OF CANADA",
      overlander_tags: ["federal_land", "parks_canada"],
      geometry_polygon: polygon,
      distribution_type: "National Park of Canada",
      description: null,
      contact: null,
      amenities: null,
      hours: null,
    });
  });

  it("normalizeAccommodation: name, accommodation_type into amenities, URL_e into contact.website", () => {
    const out = normalizeAccommodation(
      {
        OBJECTID: 7,
        Site_Num_Site: "BAN-TMV1-D19",
        Name_e: "Tunnel Mountain Village I",
        Nom_f: "Mont-Tunnel (Village I)",
        Accommodation_Type: "Camping",
        URL_e: "https://parks.canada.ca/pn-np/ab/banff/activ/camping",
      },
      "Tunnel Mountain Village I",
    );
    expect(out).toMatchObject({
      canonical_name: "Tunnel Mountain Village I",
      overlander_tags: ["federal_land", "parks_canada"],
      description: null,
      amenities: { accommodation_type: "Camping" },
      contact: {
        website: "https://parks.canada.ca/pn-np/ab/banff/activ/camping",
      },
    });
  });

  it("normalizeAccommodation: drops non-http URL_e (the layer occasionally puts site codes in URL_f or URL_e)", () => {
    const out = normalizeAccommodation(
      {
        OBJECTID: 7,
        Site_Num_Site: "BAN-TMV1-D19",
        Name_e: "Some CG",
        Accommodation_Type: "Camping",
        URL_e: "BAN-TMV1-D19", // not a URL — ignore
      },
      "Some CG",
    );
    expect(out.contact).toBeNull();
  });

  it("normalizeAccommodation: collapses missing accommodation_type to null amenities", () => {
    const out = normalizeAccommodation(
      { OBJECTID: 1, Name_e: "Some Campground", Accommodation_Type: null },
      "Some Campground",
    );
    expect(out.amenities).toBeNull();
  });

  it("normalizeInterestPoint: Descr_e into description, English half of Principal_type into amenities", () => {
    const out = normalizeInterestPoint(
      {
        OBJECTID: 28,
        Name_e: "Bow Falls Viewpoint",
        Nom_f: "Belvédère des chutes Bow",
        Principal_type: "Viewpoint//Belvédère",
        Descr_e: "Iconic Banff overlook above the Bow River",
        Descr_f: "Belvédère emblématique de Banff au-dessus de la rivière Bow",
      },
      "Bow Falls Viewpoint",
    );
    expect(out).toMatchObject({
      canonical_name: "Bow Falls Viewpoint",
      description: "Iconic Banff overlook above the Bow River",
      amenities: { interest_type: "Viewpoint" },
      overlander_tags: ["federal_land", "parks_canada"],
      contact: null,
    });
  });

  it("normalizeInterestPoint: URL_e populates contact.website when valid", () => {
    const out = normalizeInterestPoint(
      {
        OBJECTID: 5,
        Name_e: "Sawback Slidepath",
        Principal_type: "Camp//Campement",
        URL_e: "https://parks.canada.ca/pn-np/ab/banff/sawback",
      },
      "Sawback Slidepath",
    );
    expect(out.contact).toMatchObject({
      website: "https://parks.canada.ca/pn-np/ab/banff/sawback",
    });
  });
});
