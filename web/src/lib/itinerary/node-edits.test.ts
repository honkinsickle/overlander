/**
 * Tests for the pure node-model edit logic (spec § node-stack model). Run:
 *   npx tsx --test src/lib/itinerary/node-edits.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintSeedId,
  addNodeSeed,
  pinPlaceToNode,
  removeSeed,
  unpinPlace,
  findNodeInTrip,
  type PinTarget,
} from "./node-edits";
import type { Trip, NodeSeed, PlaceNodeOverride, CorridorCity } from "@/lib/trips/types";

/** Deterministic suffix generator for id minting. */
function counter(): () => string {
  let i = 0;
  return () => `x${i++}`;
}

function seed(id: string, coords: [number, number]): NodeSeed {
  return { id, name: id, coords, createdAt: "2026-07-20T00:00:00Z" };
}

// ── mintSeedId ───────────────────────────────────────────────────────────
test("mintSeedId builds seed-<slug>-<suffix> and re-rolls on collision", () => {
  const gen = (() => {
    const vals = ["dup", "dup", "fresh"];
    let i = 0;
    return () => vals[i++];
  })();
  const existing = new Set(["seed-wells-bc-dup"]);
  const id = mintSeedId("Wells, BC", existing, gen);
  assert.equal(id, "seed-wells-bc-fresh"); // skipped the colliding "dup"
});

// ── addNodeSeed ──────────────────────────────────────────────────────────
test("addNodeSeed appends a fresh seed", () => {
  const res = addNodeSeed([], { name: "Wells, BC", coords: [-121.6, 53.1], createdAt: "t" }, counter());
  assert.equal(res.created, true);
  assert.equal(res.seeds.length, 1);
  assert.equal(res.id, res.seeds[0].id);
  assert.match(res.id, /^seed-wells-bc-/);
});

test("addNodeSeed dedupes a coincident place — returns the existing id, no twin", () => {
  const existing = [seed("seed-wells-bc-x0", [-121.6, 53.1])];
  const res = addNodeSeed(existing, { name: "Wells, BC", coords: [-121.6001, 53.1001], createdAt: "t" }, counter());
  assert.equal(res.created, false);
  assert.equal(res.id, "seed-wells-bc-x0");
  assert.equal(res.seeds.length, 1); // unchanged
});

// ── pinPlaceToNode ───────────────────────────────────────────────────────
const gazTarget: PinTarget = { id: "teslin-yt", kind: "corridor", name: "Teslin, YT", coords: [-132.7, 60.2] };
const endTarget: PinTarget = { id: "beta-city", kind: "end", name: "Beta City", coords: [-135, 64] };

test("pin to a gazetteer node PROMOTES it to a seed; override points at the new id", () => {
  const res = pinPlaceToNode({ nodeSeeds: [], placeOverrides: [] }, gazTarget, "barkerville", "t", counter());
  assert.equal(res.nodeSeeds.length, 1); // promoted
  assert.match(res.nodeSeeds[0].id, /^seed-teslin-yt-/);
  assert.equal(res.nodeId, res.nodeSeeds[0].id);
  assert.deepEqual(res.placeOverrides, [{ placeId: "barkerville", nodeId: res.nodeId }]);
});

test("pin to a start/end node does NOT promote — override points at it directly", () => {
  const res = pinPlaceToNode({ nodeSeeds: [], placeOverrides: [] }, endTarget, "p", "t", counter());
  assert.equal(res.nodeSeeds.length, 0);
  assert.equal(res.nodeId, "beta-city");
  assert.deepEqual(res.placeOverrides, [{ placeId: "p", nodeId: "beta-city" }]);
});

test("pin to an already-seed node does not double it", () => {
  const s = seed("seed-teslin-yt-x0", [-132.7, 60.2]);
  const seedTarget: PinTarget = { id: s.id, kind: "corridor", name: s.name, coords: s.coords };
  const res = pinPlaceToNode({ nodeSeeds: [s], placeOverrides: [] }, seedTarget, "p", "t", counter());
  assert.equal(res.nodeSeeds.length, 1); // reused, not doubled
  assert.equal(res.nodeId, s.id);
});

test("one home per place: re-pinning REPLACES the existing override", () => {
  const start: { nodeSeeds: NodeSeed[]; placeOverrides: PlaceNodeOverride[] } = {
    nodeSeeds: [],
    placeOverrides: [{ placeId: "p", nodeId: "old-node" }],
  };
  const res = pinPlaceToNode(start, endTarget, "p", "t", counter());
  const forP = res.placeOverrides.filter((o) => o.placeId === "p");
  assert.equal(forP.length, 1); // not two
  assert.equal(forP[0].nodeId, "beta-city");
});

// ── removeSeed / unpinPlace ──────────────────────────────────────────────
test("removeSeed drops the seed and prunes overrides that pointed at it", () => {
  const state = {
    nodeSeeds: [seed("s1", [0, 0]), seed("s2", [1, 1])],
    placeOverrides: [
      { placeId: "a", nodeId: "s1" },
      { placeId: "b", nodeId: "s2" },
    ],
  };
  const res = removeSeed(state, "s1");
  assert.deepEqual(res.nodeSeeds.map((s) => s.id), ["s2"]);
  assert.deepEqual(res.placeOverrides, [{ placeId: "b", nodeId: "s2" }]);
});

test("unpinPlace removes just that place's override", () => {
  const out = unpinPlace(
    { nodeSeeds: [], placeOverrides: [{ placeId: "a", nodeId: "n" }, { placeId: "b", nodeId: "n" }] },
    "a",
  );
  assert.deepEqual(out.placeOverrides, [{ placeId: "b", nodeId: "n" }]);
  assert.deepEqual(out.nodeSeeds, []);
});

test("unpinPlace GCs a PROMOTED seed once its last override is gone", () => {
  const s: NodeSeed = { id: "seed-x", name: "X", coords: [0, 0], createdAt: "t", origin: "promoted" };
  const out = unpinPlace({ nodeSeeds: [s], placeOverrides: [{ placeId: "a", nodeId: "seed-x" }] }, "a");
  assert.deepEqual(out.placeOverrides, []);
  assert.deepEqual(out.nodeSeeds, []); // promoted-only seed GC'd
});

test("unpinPlace KEEPS a promoted seed still referenced by another pin", () => {
  const s: NodeSeed = { id: "seed-x", name: "X", coords: [0, 0], createdAt: "t", origin: "promoted" };
  const out = unpinPlace(
    { nodeSeeds: [s], placeOverrides: [{ placeId: "a", nodeId: "seed-x" }, { placeId: "b", nodeId: "seed-x" }] },
    "a",
  );
  assert.deepEqual(out.nodeSeeds.map((x) => x.id), ["seed-x"]); // still hosts "b"
});

test("unpinPlace never GCs a MANUAL seed (nor a legacy origin-less one)", () => {
  const manual: NodeSeed = { id: "seed-m", name: "M", coords: [0, 0], createdAt: "t", origin: "manual" };
  const legacy: NodeSeed = { id: "seed-l", name: "L", coords: [1, 1], createdAt: "t" }; // no origin
  const outM = unpinPlace({ nodeSeeds: [manual], placeOverrides: [{ placeId: "a", nodeId: "seed-m" }] }, "a");
  assert.deepEqual(outM.nodeSeeds.map((x) => x.id), ["seed-m"]);
  const outL = unpinPlace({ nodeSeeds: [legacy], placeOverrides: [{ placeId: "a", nodeId: "seed-l" }] }, "a");
  assert.deepEqual(outL.nodeSeeds.map((x) => x.id), ["seed-l"]);
});

test("addNodeSeed defaults origin to manual; pin-promotion marks it promoted", () => {
  const manual = addNodeSeed([], { name: "Wells, BC", coords: [-121.6, 53.1], createdAt: "t" }, counter());
  assert.equal(manual.seeds[0].origin, "manual");
  const pin = pinPlaceToNode({ nodeSeeds: [], placeOverrides: [] }, gazTarget, "p", "t", counter());
  assert.equal(pin.nodeSeeds[0].origin, "promoted");
});

// ── findNodeInTrip ───────────────────────────────────────────────────────
test("findNodeInTrip resolves a node by (dayId, nodeId), null on miss", () => {
  const node: CorridorCity = { id: "teslin-yt", name: "Teslin, YT", kind: "corridor", coords: [-132.7, 60.2], milesFromStart: 100, placeIds: [] };
  const trip = { days: [{ id: "d1", corridorCities: [node] }] } as unknown as Trip;
  assert.deepEqual(findNodeInTrip(trip, "d1", "teslin-yt"), {
    id: "teslin-yt",
    kind: "corridor",
    name: "Teslin, YT",
    coords: [-132.7, 60.2],
  });
  assert.equal(findNodeInTrip(trip, "d1", "nope"), null);
  assert.equal(findNodeInTrip(trip, "dX", "teslin-yt"), null);
});
