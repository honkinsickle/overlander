/**
 * Tests for the /api/places/details pure helper.
 * Run with: npx tsx --test src/app/api/places/details/batch.test.ts
 *
 * The load-bearing one is "returns every id" — that is the defect being fixed.
 * It is mutation-checked: restoring `.slice(0, N)` to the end of `parsePlaceIds`
 * must fail it. A test that passes under both shapes proves nothing.
 *
 * The `chunk` / `BATCH_SIZE` tests were removed 2026-09-03 with those helpers,
 * when the route cut over to `enrichByGoogleId()` (which owns its own batching).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaceIds } from "./batch";

const ids = (n: number, prefix = "id") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("returns EVERY id — no truncation", () => {
  // day 1 of la-to-deadhorse: 91 eligible ids, of which 51 were once dropped.
  const body = { placeIds: ids(91) };
  const out = parsePlaceIds(body);
  assert.equal(out?.length, 91);
  assert.equal(out?.[90], "id90"); // the last id survives, not just the count
});

test("dedupes, keeping first-occurrence order", () => {
  const out = parsePlaceIds({ placeIds: ["b", "a", "b", "c", "a"] });
  assert.deepEqual(out, ["b", "a", "c"]);
});

test("rejects a malformed body with null (caller answers 400)", () => {
  assert.equal(parsePlaceIds(null), null);
  assert.equal(parsePlaceIds("nope"), null);
  assert.equal(parsePlaceIds({}), null);
  assert.equal(parsePlaceIds({ placeIds: "not-an-array" }), null);
  assert.equal(parsePlaceIds({ placeIds: ["ok", 42] }), null);
  assert.equal(parsePlaceIds({ placeIds: ["ok", ""] }), null);
});

test("an empty list is valid and yields an empty list", () => {
  assert.deepEqual(parsePlaceIds({ placeIds: [] }), []);
});
