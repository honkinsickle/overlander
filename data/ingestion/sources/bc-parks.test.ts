/**
 * Unit tests for the bc-parks ingester — pure helpers only.
 *
 * Network + DB paths (WFS boundary fetch, REST enrichment, upsert) are
 * exercised via the Mount Robson smoke test, an integration concern that
 * runs against the live DataBC WFS + BC Parks REST API. This file covers
 * the transformation surface: the ORCS join-key normalizer, amenity
 * prefix stripping, HTML cleanup, polygon merge, point selection, amenity
 * summary building, name preference, and the normalizer field mapping.
 *
 * Attribute shapes reflect the actual responses observed 2026-05-31:
 *
 *   - WFS WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW: SCREAMING_SNAKE props
 *     (ORCS_PRIMARY zero-padded "0385", PROTECTED_LANDS_NAME ALL-CAPS).
 *   - BC Parks REST API (Strapi v5 flat): orcs unpadded (385), title-case
 *     protectedAreaName, parkFacilities/parkCampingTypes as flat arrays
 *     of { name: "<n>:Label" }.
 */

import { describe, expect, it } from "vitest";

import { _internals } from "./bc-parks.ts";

const {
  bboxCentroid,
  buildAmenities,
  cleanText,
  extractPolygon,
  httpUrl,
  inferParkCategory,
  mergePolygons,
  normalizeOrcs,
  normalizePark,
  pickParkName,
  restPoint,
  stripAmenityPrefix,
} = _internals;

describe("normalizeOrcs — WFS↔REST join key", () => {
  it("strips WFS zero-padding to match REST's unpadded code", () => {
    // The crux: WFS "0385" must equal REST 385, WFS "0002" must equal 2.
    expect(normalizeOrcs("0385")).toBe("385");
    expect(normalizeOrcs("0002")).toBe("2");
    expect(normalizeOrcs("5043")).toBe("5043");
  });

  it("accepts numeric input (REST serves orcs as a number)", () => {
    expect(normalizeOrcs(385)).toBe("385");
    expect(normalizeOrcs(2)).toBe("2");
    expect(normalizeOrcs(5043)).toBe("5043");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrcs("  5043 ")).toBe("5043");
  });

  it("returns '' for non-numeric / missing values (caller skips)", () => {
    expect(normalizeOrcs("")).toBe("");
    expect(normalizeOrcs("   ")).toBe("");
    expect(normalizeOrcs("ABC")).toBe("");
    expect(normalizeOrcs("38A")).toBe("");
    expect(normalizeOrcs(null)).toBe("");
    expect(normalizeOrcs(undefined)).toBe("");
    expect(normalizeOrcs(NaN)).toBe("");
  });

  it("padded and unpadded forms of the same code converge", () => {
    expect(normalizeOrcs("0385")).toBe(normalizeOrcs(385));
    expect(normalizeOrcs("0002")).toBe(normalizeOrcs("2"));
  });
});

describe("stripAmenityPrefix", () => {
  it("strips the '<digits>:' park-code prefix", () => {
    expect(stripAmenityPrefix("2:EV Charging")).toBe("EV Charging");
    expect(stripAmenityPrefix("235:Picnic areas")).toBe("Picnic areas");
    expect(stripAmenityPrefix("9781:Wilderness camping")).toBe("Wilderness camping");
    expect(stripAmenityPrefix("122:RV-accessible camping")).toBe("RV-accessible camping");
  });

  it("leaves already-clean labels untouched", () => {
    expect(stripAmenityPrefix("Group camping")).toBe("Group camping");
    expect(stripAmenityPrefix("Pit or flush toilets")).toBe("Pit or flush toilets");
  });

  it("tolerates incidental whitespace around the prefix", () => {
    expect(stripAmenityPrefix("  2 : EV Charging")).toBe("EV Charging");
  });
});

describe("cleanText — REST description rich text", () => {
  it("strips HTML tags and collapses whitespace", () => {
    expect(cleanText("<p>This park has a day-use and picnic area.</p>")).toBe(
      "This park has a day-use and picnic area.",
    );
  });

  it("decodes common entities", () => {
    expect(cleanText("Camping &amp; hiking")).toBe("Camping & hiking");
    expect(cleanText("a&nbsp;b")).toBe("a b");
  });

  it("returns null for empty / non-string input", () => {
    expect(cleanText("")).toBeNull();
    expect(cleanText("<p></p>")).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(42)).toBeNull();
  });

  it("passes plain text through, trimmed", () => {
    expect(cleanText("  Mount Robson  ")).toBe("Mount Robson");
  });
});

describe("httpUrl", () => {
  it("returns trimmed http(s) URLs", () => {
    expect(httpUrl("https://bcparks.ca/mount-robson-park/")).toBe(
      "https://bcparks.ca/mount-robson-park/",
    );
    expect(httpUrl("  http://example.com  ")).toBe("http://example.com");
  });

  it("rejects non-URL strings and non-strings", () => {
    expect(httpUrl("mount-robson-park")).toBeNull();
    expect(httpUrl("")).toBeNull();
    expect(httpUrl(null)).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
  });
});

describe("extractPolygon", () => {
  it("returns Polygon / MultiPolygon shapes verbatim", () => {
    const poly = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };
    expect(extractPolygon(poly)).toEqual(poly);
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

describe("mergePolygons — multi-parcel parks", () => {
  const polyA = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
  };
  const polyB = {
    type: "Polygon" as const,
    coordinates: [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
  };

  it("returns a single parcel's geometry unchanged", () => {
    expect(mergePolygons([polyA])).toEqual(polyA);
  });

  it("combines multiple Polygons into one MultiPolygon", () => {
    expect(mergePolygons([polyA, polyB])).toEqual({
      type: "MultiPolygon",
      coordinates: [polyA.coordinates, polyB.coordinates],
    });
  });

  it("flattens member polygons when a parcel is itself a MultiPolygon", () => {
    const mp = {
      type: "MultiPolygon" as const,
      coordinates: [polyB.coordinates],
    };
    expect(mergePolygons([polyA, mp])).toEqual({
      type: "MultiPolygon",
      coordinates: [polyA.coordinates, polyB.coordinates],
    });
  });

  it("returns null for an empty parcel list", () => {
    expect(mergePolygons([])).toBeNull();
  });
});

describe("bboxCentroid", () => {
  it("returns the midpoint of a polygon's bounding box", () => {
    const poly = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
    };
    expect(bboxCentroid(poly)).toEqual([5, 10]);
  });

  it("spans all members for a MultiPolygon", () => {
    const mp = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
      ],
    };
    expect(bboxCentroid(mp)).toEqual([6, 6]);
  });

  it("returns null for empty geometry", () => {
    expect(bboxCentroid({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("restPoint — REST lat/lng scalars", () => {
  it("returns [lng, lat] from valid coordinates", () => {
    expect(restPoint(53.050806, -119.361587)).toEqual([-119.361587, 53.050806]);
  });

  it("returns null for (0,0), NaN, or non-numbers", () => {
    expect(restPoint(0, 0)).toBeNull();
    expect(restPoint(NaN, -119)).toBeNull();
    expect(restPoint(53, "x" as unknown as number)).toBeNull();
    expect(restPoint(null, null)).toBeNull();
  });
});

describe("pickParkName — REST title-case preferred over ALL-CAPS WFS", () => {
  it("prefers the REST title-case name", () => {
    expect(pickParkName("Mount Robson Park", "MOUNT ROBSON PARK", "x")).toBe(
      "Mount Robson Park",
    );
  });

  it("Title-Cases the WFS name when REST is missing", () => {
    expect(pickParkName(null, "REARGUARD FALLS PARK", "x")).toBe(
      "Rearguard Falls Park",
    );
    expect(pickParkName("", "MOUNT ROBSON PROTECTED AREA", "x")).toBe(
      "Mount Robson Protected Area",
    );
  });

  it("falls back to the ORCS-stamped default when both are missing", () => {
    expect(pickParkName(null, null, "BC Parks protected area 2")).toBe(
      "BC Parks protected area 2",
    );
  });
});

describe("buildAmenities — camping-type + facility summary", () => {
  it("produces sorted, prefix-stripped, deduplicated lists", () => {
    const out = buildAmenities(
      [{ name: "2:Picnic areas" }, { name: "2:Pit or flush toilets" }, { name: "2:EV Charging" }],
      [{ name: "2:Group camping" }, { name: "2:RV-accessible camping" }],
    );
    expect(out).toEqual({
      camping_types: ["Group camping", "RV-accessible camping"],
      facilities: ["EV Charging", "Picnic areas", "Pit or flush toilets"],
    });
  });

  it("omits an absent category and dedupes repeats", () => {
    expect(
      buildAmenities([], [{ name: "9781:Wilderness camping" }, { name: "9781:Wilderness camping" }]),
    ).toEqual({ camping_types: ["Wilderness camping"] });
  });

  it("returns null when the park has no facilities or camping types", () => {
    expect(buildAmenities([], [])).toBeNull();
    expect(buildAmenities([{ name: null }], [{ name: "" }])).toBeNull();
  });
});

describe("inferParkCategory", () => {
  it("is always park_boundary (reuses the Parks Canada category)", () => {
    expect(inferParkCategory()).toBe("park_boundary");
  });
});

describe("normalizePark — real combined WFS + REST shape", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  it("maps a fully-enriched park (Mount Robson)", () => {
    const out = normalizePark({
      name: "Mount Robson Park",
      description: "Iconic park anchoring the Yellowhead corridor.",
      website: "https://bcparks.ca/mount-robson-park/",
      amenities: {
        camping_types: ["Group camping", "RV-accessible camping"],
        facilities: ["Picnic areas"],
      },
      polygon,
      designation: "Park",
      parkClass: "Class A",
      orcs: "2",
    });
    expect(out).toMatchObject({
      canonical_name: "Mount Robson Park",
      description: "Iconic park anchoring the Yellowhead corridor.",
      overlander_tags: ["provincial_land", "bc_parks"],
      contact: { website: "https://bcparks.ca/mount-robson-park/" },
      access: null,
      amenities: {
        camping_types: ["Group camping", "RV-accessible camping"],
        facilities: ["Picnic areas"],
      },
      hours: null,
      geometry_polygon: polygon,
      park_designation: "Park",
      park_class: "Class A",
      orcs: "2",
    });
  });

  it("collapses a geometry-only park (REST enrichment missing)", () => {
    const out = normalizePark({
      name: "BC Parks protected area 385",
      description: null,
      website: null,
      amenities: null,
      polygon,
      designation: "Provincial Park",
      parkClass: null,
      orcs: "385",
    });
    expect(out).toMatchObject({
      canonical_name: "BC Parks protected area 385",
      description: null,
      contact: null,
      amenities: null,
      geometry_polygon: polygon,
      park_designation: "Provincial Park",
      park_class: null,
      orcs: "385",
    });
  });
});
