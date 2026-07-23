/**
 * Locks the primaryType → corpus primary_category mapping (inferCategory).
 * This switch is the TWIN of data/ingestion/sources/google-places.ts's
 * inferCategory — see the comment on both. Run with:
 *   npx tsx --test src/lib/itinerary/resolve.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCategory } from "./resolve";

test("inferCategory: explicit switch arms", () => {
  assert.equal(inferCategory("gas_station"), "gas_station");
  assert.equal(inferCategory("lodging"), "lodging");
  assert.equal(inferCategory("restaurant"), "restaurant");
  assert.equal(inferCategory("car_repair"), "car_repair");
  assert.equal(inferCategory("supermarket"), "grocery");
  assert.equal(inferCategory("convenience_store"), "grocery");
});

test("inferCategory: passthrough for unmapped primaryType", () => {
  // Categories the matcher DOES know — passed straight through.
  assert.equal(inferCategory("campground"), "campground");
  assert.equal(inferCategory("viewpoint"), "viewpoint");
  // A category the matrix doesn't key on still passes through verbatim (it just
  // won't auto-link — see docs/BACKLOG.md).
  assert.equal(inferCategory("tourist_attraction"), "tourist_attraction");
});

test("inferCategory: null/undefined primaryType → null", () => {
  assert.equal(inferCategory(null), null);
  assert.equal(inferCategory(undefined), null);
});
