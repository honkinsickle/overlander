/**
 * Tests for classifyCuratedPicks — the read-spine override split.
 * Run: npx tsx --test src/lib/corridor/curated-placement.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCuratedPicks } from "./curated-placement";

type Pick = { id: string; milesFromStart?: number };
const pick = (id: string, mile?: number): Pick => ({ id, milesFromStart: mile });

test("an explicit override to a present node → pinnedByNode (relocated)", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    presentNodeIds: new Set(["dease-lake", "stewart"]),
    placeOverrides: [{ placeId: "bear-glacier", nodeId: "dease-lake" }],
  });
  assert.deepEqual(pinnedByNode.get("dease-lake")?.map((p) => p.id), ["bear-glacier"]);
  assert.deepEqual(rest, []);
});

// THE LOCK: the trigger is the explicit override list, NOT placeIds membership.
// A curated pick that geometry buckets under a node — but has NO override —
// must STAY on the timeline (rest), or the Key Stops treatment silently
// vanishes and every curated pick snaps to a node.
test("a curated pick bucketed under a node with NO override stays on the timeline", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    // bear-glacier is (conceptually) in stewart's placeIds by geometry, but the
    // classifier is given NO override for it — it must not be relocated.
    curatedPicks: [pick("bear-glacier", 315)],
    presentNodeIds: new Set(["dease-lake", "stewart"]),
    placeOverrides: [],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]); // on the timeline
});

test("a DANGLING override (target node absent this day) falls back to the timeline", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    presentNodeIds: new Set(["dease-lake", "stewart"]),
    placeOverrides: [{ placeId: "bear-glacier", nodeId: "some-other-days-node" }],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]);
});

test("multiple picks pinned to one node are mile-ordered", () => {
  const { pinnedByNode } = classifyCuratedPicks({
    curatedPicks: [pick("late", 300), pick("early", 120), pick("mid", 200)],
    presentNodeIds: new Set(["n"]),
    placeOverrides: [
      { placeId: "late", nodeId: "n" },
      { placeId: "early", nodeId: "n" },
      { placeId: "mid", nodeId: "n" },
    ],
  });
  assert.deepEqual(pinnedByNode.get("n")?.map((p) => p.id), ["early", "mid", "late"]);
});

test("a non-curated override is irrelevant here (only curated picks are classified)", () => {
  // The pool passed in is the curated set; a placeOverride for some non-curated
  // place simply matches nothing → no relocation, no throw.
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    presentNodeIds: new Set(["dease-lake"]),
    placeOverrides: [{ placeId: "some-waypoint", nodeId: "dease-lake" }],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]);
});
