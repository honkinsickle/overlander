/**
 * Tests for the /api/places/details pure helpers.
 * Run with: npx tsx --test src/app/api/places/details/batch.test.ts
 *
 * The load-bearing one is "returns every id" — that is the defect being fixed.
 * It is mutation-checked: restoring `.slice(0, BATCH_SIZE)` to the end of
 * `parsePlaceIds` must fail it. A test that passes under both shapes proves
 * nothing about the change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BATCH_SIZE, chunk, parsePlaceIds } from "./batch";

const ids = (n: number, prefix = "id") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// ── parsePlaceIds ──────────────────────────────────────────────────────────

test("returns EVERY id — no truncation at BATCH_SIZE", () => {
  // day 1 of la-to-deadhorse: 91 eligible ids, of which 51 were dropped.
  const body = { placeIds: ids(91) };
  const out = parsePlaceIds(body);
  assert.equal(out?.length, 91);
  assert.equal(out?.[90], "id90"); // the last id survives, not just the count
});

test("a request exactly at BATCH_SIZE is unchanged", () => {
  const out = parsePlaceIds({ placeIds: ids(BATCH_SIZE) });
  assert.equal(out?.length, BATCH_SIZE);
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

// ── chunk ──────────────────────────────────────────────────────────────────

test("91 ids split into 40 / 40 / 11, in order, losing nothing", () => {
  const batches = chunk(ids(91), BATCH_SIZE);
  assert.deepEqual(batches.map((b) => b.length), [40, 40, 11]);
  assert.deepEqual(batches.flat(), ids(91));
});

test("a list at or under BATCH_SIZE is exactly ONE batch", () => {
  // The no-regression property: alaska-south-final peaks at 28 ids, so it must
  // behave identically to the pre-chunking single Promise.all.
  assert.equal(chunk(ids(28), BATCH_SIZE).length, 1);
  assert.equal(chunk(ids(BATCH_SIZE), BATCH_SIZE).length, 1);
  assert.equal(chunk(ids(1), BATCH_SIZE).length, 1);
});

test("one over BATCH_SIZE is two batches, the second holding a single id", () => {
  const batches = chunk(ids(BATCH_SIZE + 1), BATCH_SIZE);
  assert.equal(batches.length, 2);
  assert.equal(batches[1].length, 1);
});

test("an empty list yields NO batches, so the caller's loop is a no-op", () => {
  assert.deepEqual(chunk([], BATCH_SIZE), []);
});

test("a non-positive or non-integer size throws rather than looping forever", () => {
  assert.throws(() => chunk(ids(3), 0), RangeError);
  assert.throws(() => chunk(ids(3), -1), RangeError);
  assert.throws(() => chunk(ids(3), 1.5), RangeError);
});

test("BATCH_SIZE is unchanged at 40 — the fan-out ceiling is preserved", () => {
  // Raising this is a separate decision: the number is undocumented (see
  // batch.ts). If this fails, someone changed the ceiling, not the batching.
  assert.equal(BATCH_SIZE, 40);
});
