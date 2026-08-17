/**
 * Unit tests for blm-rec.ts pure helpers (no network/DB).
 *
 * Covers buildRow across: a real-named row, a placeholder/numeric-code name
 * (kept as-is), a missing-geometry row (skipped), and the OR-office case where
 * LAT/LONG attribute columns are null but SHAPE geometry is present — the
 * geometry path must be used, never the null attribute columns. Also asserts
 * the defensive subtype gate rejects a leaked developed/generic row.
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../lib/geojson.ts";
import { _internals } from "./blm-rec.ts";

const { buildRow, extractPoint, bestName, normalize, PRIMITIVE_SUBTYPE } = _internals;

const pointGeom = (lng: number, lat: number): GeoJsonFeature["geometry"] =>
  ({ type: "Point", coordinates: [lng, lat] }) as unknown as GeoJsonFeature["geometry"];

const feature = (
  properties: Record<string, unknown>,
  geometry: GeoJsonFeature["geometry"] = pointGeom(-118.5, 37.2),
): GeoJsonFeature =>
  ({ type: "Feature", geometry, properties }) as unknown as GeoJsonFeature;

const basic = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  FET_NAME: "Baker Hot Springs",
  FET_SUBTYPE: PRIMITIVE_SUBTYPE,
  ADMIN_ST: "UT",
  Original_GlobalID: "{2DFAED51-B9B2-45D8-9D54-34F32D1A9749}",
  ...over,
});

describe("extractPoint", () => {
  it("reads [lng, lat] from GeoJSON Point geometry", () => {
    expect(extractPoint(pointGeom(-118.5, 37.2))).toEqual([-118.5, 37.2]);
  });
  it("rejects (0,0) and absent geometry", () => {
    expect(extractPoint(pointGeom(0, 0))).toBeNull();
    expect(extractPoint(null)).toBeNull();
  });
});

describe("bestName — FET_NAME as-is, no synthesis", () => {
  it("keeps a real name", () => {
    expect(bestName({ FET_NAME: "Baker Hot Springs" })).toBe("Baker Hot Springs");
  });
  it("keeps a numeric / river-mile code verbatim", () => {
    expect(bestName({ FET_NAME: "J75.40R" })).toBe("J75.40R");
    expect(bestName({ FET_NAME: "Campsite 91" })).toBe("Campsite 91");
  });
  it("returns null when empty/whitespace", () => {
    expect(bestName({ FET_NAME: "   " })).toBeNull();
    expect(bestName({})).toBeNull();
  });
});

describe("buildRow", () => {
  it("builds a row from a real-named feature (external_id, category, geometry, provenance)", () => {
    const { row, skipReason } = buildRow(feature(basic()));
    expect(skipReason).toBeNull();
    expect(row).not.toBeNull();
    expect(row!.source_id).toBe("blm");
    expect(row!.external_id).toBe("blm:recpt:{2DFAED51-B9B2-45D8-9D54-34F32D1A9749}");
    expect(row!.name).toBe("Baker Hot Springs");
    expect(row!.inferred_category).toBe("dispersed_camping");
    expect(row!.geometry).toBe("SRID=4326;POINT(-118.5 37.2)");
    expect(row!.source_quality_score).toBe(0.5);
    const np = row!.normalized_payload as {
      overlander_tags: string[];
      dispersed_camping: string;
      provenance: { admin_st: string; fet_subtype: string; original_global_id: string };
    };
    expect(np.overlander_tags).toEqual(["federal_land", "blm", "dispersed_camping_likely"]);
    expect(np.dispersed_camping).toBe("likely_allowed");
    expect(np.provenance.admin_st).toBe("UT");
    expect(np.provenance.fet_subtype).toBe(PRIMITIVE_SUBTYPE);
  });

  it("keeps a placeholder/numeric-code name as-is (no synthesis)", () => {
    const { row, skipReason } = buildRow(feature(basic({ FET_NAME: "J75.40R" })));
    expect(skipReason).toBeNull();
    expect(row!.name).toBe("J75.40R");
  });

  it("skips a feature with no geometry", () => {
    const { row, skipReason } = buildRow(feature(basic(), null));
    expect(row).toBeNull();
    expect(skipReason).toBe("no_geometry");
  });

  it("uses SHAPE geometry for an OR-office row with null LAT/LONG columns", () => {
    const orOffice = basic({
      FET_NAME: "J138.70L",
      ADMIN_ST: "OR",
      LAT: null,
      LONG: null,
    });
    const { row, skipReason } = buildRow(feature(orOffice, pointGeom(-120.13, 44.71)));
    expect(skipReason).toBeNull();
    expect(row).not.toBeNull();
    expect(row!.geometry).toBe("SRID=4326;POINT(-120.13 44.71)");
    const np = row!.normalized_payload as { provenance: { admin_st: string } };
    expect(np.provenance.admin_st).toBe("OR");
  });

  it("skips a row missing Original_GlobalID", () => {
    const { row, skipReason } = buildRow(feature(basic({ Original_GlobalID: null })));
    expect(row).toBeNull();
    expect(skipReason).toBe("no_global_id");
  });

  it("defensive subtype gate rejects a leaked developed/generic row", () => {
    const { row, skipReason } = buildRow(
      feature(basic({ FET_SUBTYPE: "Campsite - Developed - Reservable - Fee" })),
    );
    expect(row).toBeNull();
    expect(skipReason).toBe("subtype_gate:Campsite - Developed - Reservable - Fee");
  });
});

describe("normalize", () => {
  it("emits sparse-attribute nulls rather than fabricating them", () => {
    const np = normalize(
      { FET_NAME: "Baker Hot Springs", ADMIN_ST: "UT", FET_SUBTYPE: PRIMITIVE_SUBTYPE },
      "Baker Hot Springs",
      "{GUID}",
    );
    expect(np.amenities).toBeNull();
    expect(np.hours).toBeNull();
    expect(np.contact).toBeNull();
    expect(np.access).toBeNull();
    expect(np.description).toBeNull();
    expect(np.web_link).toBeNull();
    expect(np.mvum_corridor).toBeNull();
    expect(np.verify_locally).toBe(true);
  });
});
