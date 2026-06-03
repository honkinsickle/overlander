/**
 * Unit tests for usfs.ts pure helpers (no network/DB).
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../lib/geojson.ts";
import { _internals } from "./usfs.ts";

const { extractPoint, inferReservable, normalize } = _internals;

const pointGeom = (lng: number, lat: number): GeoJsonFeature["geometry"] =>
  ({ type: "Point", coordinates: [lng, lat] }) as unknown as GeoJsonFeature["geometry"];

describe("extractPoint", () => {
  it("prefers GeoJSON Point geometry as [lng, lat]", () => {
    expect(extractPoint(pointGeom(-118.5, 37.2), {})).toEqual([-118.5, 37.2]);
  });
  it("falls back to latitude/longitude string fields when geometry is absent", () => {
    expect(extractPoint(null, { latitude: "37.2", longitude: "-118.5" })).toEqual([-118.5, 37.2]);
  });
  it("rejects (0,0) and unparseable coords", () => {
    expect(extractPoint(pointGeom(0, 0), {})).toBeNull();
    expect(extractPoint(null, { latitude: "abc", longitude: "-118" })).toBeNull();
    expect(extractPoint(null, {})).toBeNull();
  });
});

describe("inferReservable (positive-signal heuristic on free text)", () => {
  it("'No Reservations…' → false (never keys on the bare 'reserv' substring)", () => {
    expect(inferReservable("No Reservations, Register on site")).toBe(false);
  });
  it("explicit reservation language → true", () => {
    expect(inferReservable("Reservations Required. Reserve at recreation.gov")).toBe(true);
    expect(inferReservable("Reserve at recreation.gov/camping/...")).toBe(true);
    expect(inferReservable("Some sites are reservable")).toBe(true);
  });
  it("no usable signal → null", () => {
    expect(inferReservable(null)).toBeNull();
    expect(inferReservable("Open year-round")).toBeNull();
  });
});

describe("normalize", () => {
  it("emits the dispersed advisory (likely_allowed + verify_locally + mvum stub) and tags", () => {
    const n = normalize(
      {
        recareaname: "Cabresto Lake Campground",
        recareaurl: "https://www.fs.usda.gov/recarea/carson/recarea/?recid=123",
        recareadescription: "Primitive dispersed sites.",
        reservation_info: "No Reservations, Register on site",
        forestname: "Carson National Forest",
        openstatus: "Open",
      },
      "Cabresto Lake Campground",
    );
    expect(n.canonical_name).toBe("Cabresto Lake Campground");
    expect(n.dispersed_camping).toBe("likely_allowed");
    expect(n.verify_locally).toBe(true);
    expect(n.mvum_corridor).toBeNull();
    expect(n.reservable).toBe(false);
    expect(n.overlander_tags).toContain("dispersed_camping_likely");
    expect((n.contact as { website?: string }).website).toContain("fs.usda.gov");
    expect(n.forest_name).toBe("Carson National Forest");
  });
});
