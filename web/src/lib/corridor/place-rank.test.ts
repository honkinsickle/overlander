/**
 * Tests for insertRank — the fractional-rank sequencing core (spec Option B).
 * Run: npx tsx --test src/lib/corridor/place-rank.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertRank } from "./place-rank";

const R = (o: Record<string, number>) => new Map(Object.entries(o));

// ── Rule 1: materialize on first touch ──────────────────────────────────────
test("first touch (nothing ranked) → reseed ALL to integers in the given order", () => {
  // Cluster displayed a·b·c (by mile/near→far); user drags c to the front.
  const writes = insertRank(["c", "a", "b"], 0, new Map());
  assert.deepEqual([...writes], [["c", 0], ["a", 1], ["b", 2]]);
});

test("a newcomer (some ranked, one not) → reseed ALL, folding the newcomer in", () => {
  // a,b ranked; d re-bucketed in and dropped between them.
  const writes = insertRank(["a", "d", "b"], 1, R({ a: 0, b: 1 }));
  assert.deepEqual([...writes], [["a", 0], ["d", 1], ["b", 2]]);
});

// ── Fully materialized: single fractional write ─────────────────────────────
test("move within a materialized cluster → single midpoint, others untouched", () => {
  // 0:a 1:b 2:c 3:d ; move d between a and b (index 1).
  const writes = insertRank(["a", "d", "b", "c"], 1, R({ a: 0, b: 1, c: 2, d: 3 }));
  assert.deepEqual([...writes], [["d", 0.5]]); // only d changes
});

test("boundary: drop at the front → one spacing below the first rank", () => {
  const writes = insertRank(["c", "a", "b"], 0, R({ a: 0, b: 1, c: 2 }));
  assert.deepEqual([...writes], [["c", -1]]); // right neighbor a=0 → -1
});

test("boundary: drop at the end → one spacing above the last rank", () => {
  const writes = insertRank(["a", "b", "c"], 2, R({ a: 0, b: 1, c: 5 }));
  assert.deepEqual([...writes], [["c", 2]]); // left neighbor b=1 → 2
});

test("singleton cluster → rank 0", () => {
  assert.deepEqual([...insertRank(["a"], 0, new Map())], [["a", 0]]);
  assert.deepEqual([...insertRank(["a"], 0, R({ a: 7 }))], [["a", 0]]);
});

// ── Cross-cluster arrival ───────────────────────────────────────────────────
test("mover arriving with a STALE rank into a materialized cluster → midpoint (overwrites)", () => {
  // x carries rank 99 from its old cluster; dropped between a and b here.
  const writes = insertRank(["a", "x", "b"], 1, R({ a: 0, b: 1, x: 99 }));
  assert.deepEqual([...writes], [["x", 0.5]]); // fresh midpoint, old 99 replaced on merge
});

test("mover arriving UNRANKED into a materialized cluster → reseed (materializes it in)", () => {
  const writes = insertRank(["a", "x", "b"], 1, R({ a: 0, b: 1 }));
  assert.deepEqual([...writes], [["a", 0], ["x", 1], ["b", 2]]);
});

// ── Rule 2: exhaustion self-heals ───────────────────────────────────────────
test("underflow (gap between adjacent doubles) → reseed instead of a colliding rank", () => {
  const left = 1;
  const right = 1 + Number.EPSILON; // the very next representable double
  // m is ranked (so we reach the fractional path); its midpoint rounds back to
  // `left` → no distinct value fits → materialize instead of colliding.
  const writes = insertRank(["a", "m", "b"], 1, R({ a: left, m: 99, b: right }));
  assert.deepEqual([...writes], [["a", 0], ["m", 1], ["b", 2]]);
});

test("nested bisection stays exact when fully materialized (nowhere near the ~50 bound)", () => {
  // materialized a:0, m:0.5, b:1 ; move n (stale rank) between a and m.
  const w = insertRank(["a", "n", "m", "b"], 1, R({ a: 0, m: 0.5, b: 1, n: 9 }));
  assert.deepEqual([...w], [["n", 0.25]]); // exact, distinct
});

test("empty cluster → no writes", () => {
  assert.deepEqual([...insertRank([], 0, new Map())], []);
});
