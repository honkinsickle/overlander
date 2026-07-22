/**
 * Tests for classifyCuratedPicks — the read-spine pin/rank split.
 * Run: npx tsx --test src/lib/corridor/curated-placement.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCuratedPicks } from "./curated-placement";
import { scopeRankKey } from "./stretches";

type Pick = { id: string; milesFromStart?: number };
const pick = (id: string, mile?: number): Pick => ({ id, milesFromStart: mile });

test("an explicit override to a present node → pinnedByNode (relocated)", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    // applyPlaceOverrides would have appended bear-glacier into the target cluster.
    cities: [{ id: "dease-lake", placeIds: ["bear-glacier"] }, { id: "stewart", placeIds: [] }],
    placeOverrides: [{ placeId: "bear-glacier", nodeId: "dease-lake" }],
  });
  assert.deepEqual(pinnedByNode.get("dease-lake")?.map((p) => p.id), ["bear-glacier"]);
  assert.deepEqual(rest, []);
});

// THE LOCK: the trigger is an explicit signal (override OR authored rank), NOT
// placeIds membership. A curated pick that geometry buckets under a node — but
// has neither signal — must STAY on the timeline (rest), or the Key Stops
// treatment silently vanishes and every curated pick snaps to a node.
test("a curated pick bucketed under a node with NO override and NO rank stays on the timeline", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    // bear-glacier IS in stewart's placeIds by geometry, but there's no override
    // and no rank for it — it must not be relocated.
    curatedPicks: [pick("bear-glacier", 315)],
    cities: [{ id: "dease-lake", placeIds: [] }, { id: "stewart", placeIds: ["bear-glacier"] }],
    placeOverrides: [],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]); // on the timeline
});

test("a DANGLING override (target node absent this day) falls back to the timeline", () => {
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    cities: [{ id: "dease-lake", placeIds: [] }, { id: "stewart", placeIds: [] }],
    placeOverrides: [{ placeId: "bear-glacier", nodeId: "some-other-days-node" }],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]);
});

test("a node group follows cluster order — for unranked overrides that is pin (append) order", () => {
  // Order is the node's cluster order (sortClusterByRank), the exact order the
  // edit spine renders. With no ranks this reduces to server placeIds order — and
  // because applyPlaceOverrides APPENDS an override to the cluster (it does not
  // insert by mile), that is pin order, NOT mile order (miles 300/120/200 → mile
  // order would be early/mid/late). This is a consequence of that append, not an
  // intended ordering rule; see BACKLOG (insert-by-mile) to make server order == mile.
  const { pinnedByNode } = classifyCuratedPicks({
    curatedPicks: [pick("late", 300), pick("early", 120), pick("mid", 200)],
    cities: [{ id: "n", placeIds: ["late", "early", "mid"] }],
    placeOverrides: [
      { placeId: "late", nodeId: "n" },
      { placeId: "early", nodeId: "n" },
      { placeId: "mid", nodeId: "n" },
    ],
  });
  assert.deepEqual(pinnedByNode.get("n")?.map((p) => p.id), ["late", "early", "mid"]);
});

test("a non-curated override is irrelevant here (only curated picks are classified)", () => {
  // The pool passed in is the curated set; a placeOverride for some non-curated
  // place simply matches nothing → no relocation, no throw.
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("bear-glacier", 315)],
    cities: [{ id: "dease-lake", placeIds: [] }],
    placeOverrides: [{ placeId: "some-waypoint", nodeId: "dease-lake" }],
  });
  assert.equal(pinnedByNode.size, 0);
  assert.deepEqual(rest.map((p) => p.id), ["bear-glacier"]);
});

// ── Rank as the second trigger (Hop B) ──────────────────────────────────────

test("an authored node-scoped rank pins the pick and orders the group by rank", () => {
  // The live Day 7 case: a same-node reorder wrote ranks (Ksan dragged to top),
  // no override. All three are curated and in kitwanga's placeIds (mile order).
  const cities = [{ id: "kitwanga", placeIds: ["gitwangak", "seven", "ksan"] }];
  const rankKey = scopeRankKey(cities, new Map([
    ["ksan", { nodeId: "kitwanga", rank: -1 }],
    ["gitwangak", { nodeId: "kitwanga", rank: 0 }],
    ["seven", { nodeId: "kitwanga", rank: 1 }],
  ]));
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("gitwangak", 130), pick("seven", 134), pick("ksan", 158)],
    cities,
    placeOverrides: [],
    rankKey,
  });
  // Grouped under the node, ordered by rank — NOT mile (which would be 130/134/158).
  assert.deepEqual(pinnedByNode.get("kitwanga")?.map((p) => p.id), ["ksan", "gitwangak", "seven"]);
  assert.deepEqual(rest, []);
});

test("a foreign-scoped rank is inert here — that pick keeps its timeline slot", () => {
  const cities = [{ id: "kitwanga", placeIds: ["gitwangak", "seven"] }];
  // Seven Sisters carries a rank scoped to a DIFFERENT node (Stewart); scopeRankKey
  // drops it, so it never becomes a pin trigger on the read spine.
  const rankKey = scopeRankKey(cities, new Map([
    ["gitwangak", { nodeId: "kitwanga", rank: 0 }],
    ["seven", { nodeId: "stewart", rank: -99 }],
  ]));
  const { pinnedByNode, rest } = classifyCuratedPicks({
    curatedPicks: [pick("gitwangak", 130), pick("seven", 134)],
    cities,
    placeOverrides: [],
    rankKey,
  });
  assert.deepEqual(pinnedByNode.get("kitwanga")?.map((p) => p.id), ["gitwangak"]); // only in-scope pins
  assert.deepEqual(rest.map((p) => p.id), ["seven"]); // foreigner stays on the timeline
});

test("mixed under one node: ranked pick first, override-without-rank follows in cluster order", () => {
  // 'ranked' has an authored rank; 'pinned' has only an override (added-waypoint /
  // pre-rank pin). Server placeIds order is ["pinned","ranked"] (override appended).
  const cities = [{ id: "n", placeIds: ["pinned", "ranked"] }];
  const rankKey = new Map([["ranked", 0]]);
  const { pinnedByNode } = classifyCuratedPicks({
    curatedPicks: [pick("pinned", 100), pick("ranked", 200)],
    cities,
    placeOverrides: [{ placeId: "pinned", nodeId: "n" }],
    rankKey,
  });
  // sortClusterByRank(["pinned","ranked"], {ranked:0}) = ["ranked","pinned"] —
  // one rule: ranked first, unranked appended in server order.
  assert.deepEqual(pinnedByNode.get("n")?.map((p) => p.id), ["ranked", "pinned"]);
});
