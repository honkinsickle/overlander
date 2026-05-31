/**
 * Unit tests for the alberta-parks ingester — pure helpers only.
 *
 * Network + DB paths (ESRI REST fetch, upsert) are exercised via the
 * Kananaskis smoke test, an integration concern that runs against the live
 * GeoDiscover Alberta FeatureServer. This file covers the transformation
 * surface: the PASITES_ID external_id normalizer, canonical-name building
 * (designation suffix + disambiguation), polygon extraction, centroid, and
 * the normalizer field mapping.
 *
 * Attribute shapes reflect the actual responses observed 2026-05-31 from
 * boundary/parks_protected_areas_alberta/FeatureServer/0 (f=geojson):
 * SCREAMING_SNAKE props, PASITES_ID as a Double (10655.0), bare NAME
 * ("Peter Lougheed"), TYPE codes (PP / PRA / WPP), native EPSG:3400
 * reprojected to 4326 server-side.
 */

import { describe, expect, it } from "vitest";

import { _internals } from "./alberta-parks.ts";

const {
  bboxCentroid,
  buildCanonicalName,
  extractPolygon,
  inferParkCategory,
  normalizePark,
  normalizePasitesId,
  TYPE_WHERE,
} = _internals;

describe("normalizePasitesId — external_id seed", () => {
  it("truncates the Double the layer serves to an integer string", () => {
    expect(normalizePasitesId(10655)).toBe("10655");
    expect(normalizePasitesId(10655.0)).toBe("10655");
    expect(normalizePasitesId(1041)).toBe("1041");
  });

  it("accepts string input and truncates any fractional tail", () => {
    expect(normalizePasitesId("10655")).toBe("10655");
    expect(normalizePasitesId("10655.0")).toBe("10655");
    expect(normalizePasitesId("  386 ")).toBe("386");
  });

  it("returns '' for missing / non-numeric / non-finite values", () => {
    expect(normalizePasitesId(null)).toBe("");
    expect(normalizePasitesId(undefined)).toBe("");
    expect(normalizePasitesId("")).toBe("");
    expect(normalizePasitesId("ABC")).toBe("");
    expect(normalizePasitesId(NaN)).toBe("");
    expect(normalizePasitesId(Infinity)).toBe("");
  });
});

describe("buildCanonicalName — bare NAME + designation label", () => {
  it("appends the designation label for each ingested TYPE", () => {
    expect(buildCanonicalName("Peter Lougheed", "PP", "x")).toBe(
      "Peter Lougheed Provincial Park",
    );
    expect(buildCanonicalName("Bow Valley", "PRA", "x")).toBe(
      "Bow Valley Provincial Recreation Area",
    );
    expect(buildCanonicalName("Don Getty", "WPP", "x")).toBe(
      "Don Getty Wildland Provincial Park",
    );
  });

  it("disambiguates same-named sites of different designations", () => {
    // "Bow Valley" exists as both a PP and a PRA — the designation makes
    // the two canonical names (and thus master_places) distinct.
    expect(buildCanonicalName("Bow Valley", "PP", "x")).toBe(
      "Bow Valley Provincial Park",
    );
    expect(buildCanonicalName("Bow Valley", "PRA", "x")).toBe(
      "Bow Valley Provincial Recreation Area",
    );
  });

  it("does not double the suffix when NAME already carries it in full", () => {
    expect(
      buildCanonicalName("Writing-on-Stone Provincial Park", "PP", "x"),
    ).toBe("Writing-on-Stone Provincial Park");
    expect(
      buildCanonicalName("Bow Valley Wildland Provincial Park", "WPP", "x"),
    ).toBe("Bow Valley Wildland Provincial Park");
  });

  it("absorbs partial word overlap — WPP names already ending in 'Wildland'", () => {
    // Real data: WPP NAME values end with "Wildland" but not the full
    // "Wildland Provincial Park" label — a naive append doubled the word
    // ("Bow Valley Wildland Wildland Provincial Park"), caught at smoke.
    expect(buildCanonicalName("Bow Valley Wildland", "WPP", "x")).toBe(
      "Bow Valley Wildland Provincial Park",
    );
    expect(buildCanonicalName("Don Getty Wildland", "WPP", "x")).toBe(
      "Don Getty Wildland Provincial Park",
    );
    expect(buildCanonicalName("Elbow-Sheep Wildland", "WPP", "x")).toBe(
      "Elbow-Sheep Wildland Provincial Park",
    );
  });

  it("trims NAME and falls back when NAME is missing", () => {
    expect(buildCanonicalName("  Spray Valley ", "PP", "x")).toBe(
      "Spray Valley Provincial Park",
    );
    expect(buildCanonicalName("", "PP", "Alberta Parks protected area 7")).toBe(
      "Alberta Parks protected area 7",
    );
    expect(
      buildCanonicalName(null, "PP", "Alberta Parks protected area 7"),
    ).toBe("Alberta Parks protected area 7");
  });

  it("returns the bare NAME for an unrecognized TYPE", () => {
    expect(buildCanonicalName("Some Reserve", "ER", "x")).toBe("Some Reserve");
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

describe("inferParkCategory", () => {
  it("is always park_boundary (reuses the Parks Canada / BC Parks category)", () => {
    expect(inferParkCategory()).toBe("park_boundary");
  });
});

describe("TYPE_WHERE — server-side scope filter", () => {
  it("filters to the three park-like designations (NP excluded by omission)", () => {
    expect(TYPE_WHERE).toBe("TYPE IN ('PP','PRA','WPP')");
  });
});

describe("normalizePark — boundary-only shape (no enrichment data)", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  it("maps a park to the canonical payload with empty live fields", () => {
    const out = normalizePark({
      name: "Peter Lougheed Provincial Park",
      polygon,
      designation: "Provincial Park",
      parkType: "PP",
      pasitesId: "1041",
    });
    expect(out).toMatchObject({
      canonical_name: "Peter Lougheed Provincial Park",
      description: null,
      overlander_tags: ["provincial_land", "alberta_parks"],
      contact: null,
      access: null,
      amenities: null,
      hours: null,
      geometry_polygon: polygon,
      park_designation: "Provincial Park",
      park_type: "PP",
      pasites_id: "1041",
    });
  });
});
