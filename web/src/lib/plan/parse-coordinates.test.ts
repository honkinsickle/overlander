/**
 * Tests for hand-entered coordinate parsing (manual GPS entry in the
 * expedition wizard). Run with:
 *   npx tsx --test src/lib/plan/parse-coordinates.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinateEntry, formatCustomPointLabel } from "./parse-coordinates";

test("both fields blank is empty, not an error", () => {
  assert.deepEqual(parseCoordinateEntry("", ""), { status: "empty" });
  assert.deepEqual(parseCoordinateEntry("  ", " "), { status: "empty" });
});

test("one field filled, the other blank is an error", () => {
  assert.equal(parseCoordinateEntry("34.05", "").status, "error");
  assert.equal(parseCoordinateEntry("", "-118.24").status, "error");
});

test("non-numeric input is an error", () => {
  assert.equal(parseCoordinateEntry("abc", "-118.24").status, "error");
  assert.equal(parseCoordinateEntry("34.05", "xyz").status, "error");
});

test("latitude out of range is refused", () => {
  assert.equal(parseCoordinateEntry("-91", "0").status, "error");
  assert.equal(parseCoordinateEntry("91", "0").status, "error");
});

test("longitude out of range is refused", () => {
  assert.equal(parseCoordinateEntry("0", "-181").status, "error");
  assert.equal(parseCoordinateEntry("0", "181").status, "error");
});

test("boundary values are accepted — -90/90/-180/180 are valid, not off-by-one refused", () => {
  assert.equal(parseCoordinateEntry("90", "180").status, "ok");
  assert.equal(parseCoordinateEntry("-90", "-180").status, "ok");
});

test("a valid pair resolves to [lng, lat], matching the app's coordinate convention", () => {
  assert.deepEqual(
    parseCoordinateEntry("34.0522", "-118.2437"),
    { status: "ok", coords: [-118.2437, 34.0522] },
  );
});

test("formatCustomPointLabel reads lat then lng, 4 decimal places, no reverse geocoding", () => {
  assert.equal(
    formatCustomPointLabel([-118.2437, 34.0522]),
    "Custom Point (34.0522, -118.2437)",
  );
});
