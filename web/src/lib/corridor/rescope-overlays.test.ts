/**
 * Tests for rescopeOverlays — the pure keep/drop core for overlays across a
 * day-structure change (cross-day move; later add/remove-day).
 * Run: npx tsx --test src/lib/corridor/rescope-overlays.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rescopeOverlays,
  type Overlays,
  type OverlayDayLayout,
} from "./rescope-overlays";

/** Build an overlay set from a compact `{ placeId: nodeId }` spec (one override
 *  and one matching rank per entry, so both maps are exercised together). */
function overlays(spec: Record<string, string>): Overlays {
  const placeOverrides = Object.entries(spec).map(([placeId, nodeId]) => ({
    placeId,
    nodeId,
  }));
  const placeRanks = Object.fromEntries(
    Object.entries(spec).map(([placeId, nodeId], i) => [
      placeId,
      { nodeId, rank: i },
    ]),
  );
  return { placeOverrides, placeRanks };
}

const day = (
  placeIds: string[],
  nodeIds: string[],
): OverlayDayLayout => ({ placeIds, nodeIds });

/** placeIds that still carry an override (== that carry a rank, by construction). */
const overridePlaceIds = (o: Overlays) =>
  o.placeOverrides.map((x) => x.placeId).sort();
const rankPlaceIds = (o: Overlays) => Object.keys(o.placeRanks).sort();

// ── 1. Moved to an adjacent existing day that hosts the node → survives ──────
test("stop moved to an adjacent day whose layout hosts its node → overlay survives", () => {
  // p1 pinned to node n-b; after the move p1 sits in dayB, and dayB has n-b.
  const before = overlays({ p1: "n-b" });
  const after = rescopeOverlays(before, [
    day([], ["n-a"]), // dayA — no longer holds p1
    day(["p1"], ["n-b"]), // dayB — now holds p1, has the pin's node
  ]);
  assert.deepEqual(overridePlaceIds(after), ["p1"]);
  assert.deepEqual(rankPlaceIds(after), ["p1"]);
  // Unchanged, not rewritten: nodeId passes through verbatim.
  assert.equal(after.placeOverrides[0].nodeId, "n-b");
  assert.equal(after.placeRanks.p1.nodeId, "n-b");
});

// ── 2. Moved to a day that can't host the node → dropped ────────────────────
test("stop present but its pinned node isn't on its new home day → overlay dropped", () => {
  // p1 is pinned to n-x, but the day now holding p1 only has n-a.
  const after = rescopeOverlays(overlays({ p1: "n-x" }), [
    day(["p1"], ["n-a"]),
  ]);
  assert.deepEqual(overridePlaceIds(after), []);
  assert.deepEqual(rankPlaceIds(after), []);
});

// ── 3. Day removed → that day's overlays drop; LATER days survive ───────────
test("day removed → its overlays drop, later-day overlays are NOT orphaned", () => {
  // Three days, one overlay each; remove the MIDDLE day (day2 / p2).
  const before = overlays({ p1: "n1", p2: "n2", p3: "n3" });
  const after = rescopeOverlays(before, [
    day(["p1"], ["n1"]), // day1 unchanged
    // day2 removed → p2 is in no pool
    day(["p3"], ["n3"]), // day3 unchanged (name-based node id, no index shift)
  ]);
  // p2 dropped; p1 AND p3 survive — the removeDay-orphan case.
  assert.deepEqual(overridePlaceIds(after), ["p1", "p3"]);
  assert.deepEqual(rankPlaceIds(after), ["p1", "p3"]);
});

// ── 4. Day inserted → overlays on shifted days survive ──────────────────────
test("day inserted → overlays on later (shifted) days survive", () => {
  // Insert a brand-new day between day1 and day2; p1/p2 keep their pools+nodes.
  const before = overlays({ p1: "n1", p2: "n2" });
  const after = rescopeOverlays(before, [
    day(["p1"], ["n1"]), // day1
    day(["pNew"], ["nNew"]), // inserted day — no overlay of its own
    day(["p2"], ["n2"]), // day2, now at a shifted index — still valid
  ]);
  assert.deepEqual(overridePlaceIds(after), ["p1", "p2"]);
  assert.deepEqual(rankPlaceIds(after), ["p1", "p2"]);
});

// ── 5. Overlay for a placeId gone everywhere → dropped ──────────────────────
test("overlay for a placeId no longer present in any day → dropped", () => {
  const after = rescopeOverlays(overlays({ pGone: "n1" }), [
    day(["p1"], ["n1"]), // pGone is in no pool
  ]);
  assert.deepEqual(overridePlaceIds(after), []);
  assert.deepEqual(rankPlaceIds(after), []);
});

// ── 5b. Cross-day pull-in guard: same node id on a NON-holding day ≠ host ────
test("node id present only on a day that does NOT hold the stop → dropped (pull-in guard)", () => {
  // p1 pinned to n-a. n-a exists — but on day1, which no longer holds p1.
  // p1's home is day2, which lacks n-a. Honoring n-a here is the old-day pull-in.
  const after = rescopeOverlays(overlays({ p1: "n-a" }), [
    day([], ["n-a"]), // day1 — has n-a, but does NOT hold p1
    day(["p1"], ["n-b"]), // day2 — holds p1, no n-a
  ]);
  assert.deepEqual(overridePlaceIds(after), []);
  assert.deepEqual(rankPlaceIds(after), []);
});

// ── 6. No-op: unchanged layout returns the SAME object (byte-identical) ──────
test("identical/valid layout → overlays returned unchanged, referentially identical", () => {
  const before = overlays({ p1: "n1", p2: "n2" });
  const after = rescopeOverlays(before, [
    day(["p1"], ["n1"]),
    day(["p2"], ["n2"]),
  ]);
  assert.equal(after, before); // same object — no allocation on a no-op
  assert.equal(after.placeOverrides, before.placeOverrides);
  assert.equal(after.placeRanks, before.placeRanks);
});

// ── 7. Empty overlays in → empty out ────────────────────────────────────────
test("empty overlays in → empty out", () => {
  const before: Overlays = { placeOverrides: [], placeRanks: {} };
  const after = rescopeOverlays(before, [day(["p1"], ["n1"])]);
  assert.deepEqual(after.placeOverrides, []);
  assert.deepEqual(after.placeRanks, {});
  assert.equal(after, before); // no-op path holds for empties too
});
