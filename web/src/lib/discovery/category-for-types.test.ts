/**
 * Locks categoryForGoogleTypes — including the urban branch that fixes town
 * key stops (locality/political → urban instead of the "interest" grey/pin
 * default), and that specific venues still win over the town branch.
 * Run with: npx tsx --test src/lib/discovery/category-for-types.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryForGoogleTypes } from "./google-places";
import type { SlideCategoryKey } from "@/lib/trip-browse/places";

const ALL = new Set<SlideCategoryKey>([
  "oddity", "food", "scenic", "camping", "overnight", "fuel", "attraction", "interest", "urban",
]);
const cat = (types: string[]) => categoryForGoogleTypes(types, ALL);

test("towns (locality/political) → urban — the reported fix", () => {
  assert.equal(cat(["locality", "political"]), "urban"); // 100 Mile House, Quesnel, …
  assert.equal(cat(["administrative_area_level_2", "political"]), "urban");
  assert.equal(cat(["sublocality"]), "urban");
});

test("a town that's ALSO a specific venue keeps the venue (urban checked last)", () => {
  assert.equal(cat(["locality", "political", "restaurant"]), "food");
  assert.equal(cat(["locality", "gas_station"]), "fuel");
});

test("venues still map as before", () => {
  assert.equal(cat(["coffee_shop", "cafe", "food"]), "food");
  assert.equal(cat(["campground", "rv_park"]), "camping");
  assert.equal(cat(["gas_station"]), "fuel");
  assert.equal(cat(["tourist_attraction", "park"]), "scenic");
});

test("urban only fires when 'urban' is in the wanted set (the gate that broke it)", () => {
  const withoutUrban = new Set<SlideCategoryKey>(["food", "scenic", "fuel"]);
  // Mirrors the original placeDetails bug: wanted omits urban → towns → null.
  assert.equal(categoryForGoogleTypes(["locality", "political"], withoutUrban), null);
  // With urban wanted (the fix), the town maps.
  assert.equal(categoryForGoogleTypes(["locality", "political"], ALL), "urban");
});

test("a genuinely unmapped type → null → render falls to the clean interest default", () => {
  // e.g. a bare point_of_interest — the mapper returns null, and the render's
  // interest fallback is now the warm-sand diamond, not the red-pin/grey.
  assert.equal(cat(["establishment", "point_of_interest"]), null);
});
