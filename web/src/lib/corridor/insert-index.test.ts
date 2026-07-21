/**
 * Tests for computeInsertIndex — pointer-vs-rect drop index (spec Option B).
 * Run: npx tsx --test src/lib/corridor/insert-index.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsertIndex } from "./insert-index";

/** Minimal DOMRect for the two fields the function reads (top, height). */
const rect = (top: number, height = 80): DOMRect =>
  ({ top, height }) as unknown as DOMRect;

// A 3-card column: mids at 40, 120, 200.
const three = [rect(0), rect(80), rect(160)];

// ── cross-cluster drop (selfIndex null) ─────────────────────────────────────
test("above all midpoints → 0", () => {
  assert.equal(computeInsertIndex(three, 10, null), 0);
});
test("between card 0 and 1 midpoints → 1", () => {
  assert.equal(computeInsertIndex(three, 100, null), 1);
});
test("between card 1 and 2 midpoints → 2", () => {
  assert.equal(computeInsertIndex(three, 150, null), 2);
});
test("below all midpoints → siblings.length", () => {
  assert.equal(computeInsertIndex(three, 250, null), 3);
});
test("pointer exactly on a midpoint inserts ABOVE that card (strict <)", () => {
  assert.equal(computeInsertIndex(three, 40, null), 0); // == card 0 mid → above it
  assert.equal(computeInsertIndex(three, 120, null), 1); // == card 1 mid → above it
});

// ── same-cluster reorder (selfIndex excluded) ───────────────────────────────
test("selfIndex is removed from the comparison set before comparing", () => {
  // Drag card 1 (B). Comparison is [A(mid40), C(mid200)] → max index 2.
  assert.equal(computeInsertIndex(three, 10, 1), 0); // above A
  assert.equal(computeInsertIndex(three, 100, 1), 1); // between A and C
  assert.equal(computeInsertIndex(three, 250, 1), 2); // below both remaining
});
test("dragging the only card → empty comparison → 0", () => {
  assert.equal(computeInsertIndex([rect(0)], 999, 0), 0);
});

// ── degenerate ──────────────────────────────────────────────────────────────
test("empty cluster → 0", () => {
  assert.equal(computeInsertIndex([], 100, null), 0);
});
test("selfIndex out of range → no exclusion (all siblings compared)", () => {
  assert.equal(computeInsertIndex(three, 250, 99), 3);
});
