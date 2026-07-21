/**
 * Tests for the stretch-assignment pure functions (spec § node-stack, drive as
 * container). Run: npx tsx --test src/lib/corridor/stretches.test.ts
 *
 * Equator fixtures: 1° lng = 69.09318 mi (matching point-to-polyline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayStartMiles,
  positionPlacesOnDay,
  assignPlacesToStretches,
  type PositionedPlace,
} from "./stretches";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

function line(fromDeg: number, toDeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = fromDeg; d <= toDeg + 1e-9; d += 0.25) out.push([d, 0]);
  return out;
}

function pos(
  entries: [string, number, boolean][],
): Map<string, PositionedPlace> {
  return new Map(
    entries.map(([id, dayMile, onCorridor]) => [
      id,
      { id, dayMile, offsetMi: onCorridor ? 0 : 99, onCorridor },
    ]),
  );
}

// ── dayStartMiles ──────────────────────────────────────────────────────────
test("dayStartMiles sums NET route progress — round-trip days make none", () => {
  assert.deepEqual(
    dayStartMiles([
      { miles: 332, label: "Dawson City — Whitehorse, YT" },
      { miles: 50, label: "Stewart — Stewart" }, // out-and-back: 50 driving mi, 0 net
      { miles: 313, label: "Whitehorse — Boya Lake" },
      { miles: 0, label: "Boya Lake — Boya Lake" }, // dwell
    ]),
    [0, 332, 332, 645], // day 2's 50 excursion mi does NOT advance the cumulative
  );
});

// ── positionPlacesOnDay ────────────────────────────────────────────────────
test("positionPlacesOnDay projects coords → day-relative mile + offset", () => {
  const m = positionPlacesOnDay({
    line: line(0, 3),
    places: [
      { id: "on", coords: [1, 0] }, // 1° along, on the line
      { id: "off", coords: [1, 1] }, // 1° north → ~69 mi off
      { id: "nocoords" },
    ],
    dayStartMile: 0,
  });
  assert.ok(Math.abs(m.get("on")!.dayMile - MI_PER_DEG) < 0.5);
  assert.equal(m.get("on")!.onCorridor, true);
  assert.equal(m.get("off")!.onCorridor, false); // offset ~69 > 15mi buffer
  assert.equal(m.has("nocoords"), false); // no coords → skipped
});

test("positionPlacesOnDay subtracts the day's cumulative start mile", () => {
  // Day starts at route-mile 100; a place at route-mile ~169 → dayMile ~69.
  const m = positionPlacesOnDay({ line: line(0, 3), places: [{ id: "p", coords: [1, 0] }], dayStartMile: MI_PER_DEG });
  assert.ok(Math.abs(m.get("p")!.dayMile - 0) < 0.5); // 69 − 69 ≈ 0
});

// ── assignPlacesToStretches ────────────────────────────────────────────────
test("a place within maxAttachMi of a node clusters UNDER it, not in the stretch", () => {
  // maxAttach 25: at 10 mi it's within the start node's radius; at 60 it's mid-drive.
  const { nodeClusters, stretches } = assignPlacesToStretches({
    nodeMiles: [0, 200],
    positioned: pos([["near", 10, true], ["mid", 60, true]]),
  });
  assert.deepEqual(nodeClusters[0], ["near"]);
  assert.deepEqual(stretches[0].placeIds, ["mid"]);
});

test("a place just PAST the last node clusters under it (the arrival case)", () => {
  // The Whitehorse overnight at 333 on a 332-mi day: within 25 of the end node.
  const { nodeClusters, stretches } = assignPlacesToStretches({
    nodeMiles: [0, 332],
    positioned: pos([["klondike", 331, true], ["camp", 333, true]]),
  });
  assert.deepEqual(nodeClusters[1], ["klondike", "camp"]); // mile-ordered, under end node
  assert.deepEqual(stretches[0].placeIds, []);
});

test("cluster ties keep the upstream node", () => {
  // Equidistant (100) from nodes at 0 and 200 — but 100 > maxAttach 25, so it's
  // mid-drive; move it to 25 from each impossible, so test the near-tie at a
  // coincident-node (dwell) case: both nodes at 0, place at 10 → upstream node 0.
  const { nodeClusters } = assignPlacesToStretches({
    nodeMiles: [0, 0],
    positioned: pos([["x", 10, true]]),
  });
  assert.deepEqual(nodeClusters[0], ["x"]);
  assert.deepEqual(nodeClusters[1], []);
});

test("mid-drive: >maxAttach from every node → the stretch, mile-ordered", () => {
  const { stretches, nodeClusters } = assignPlacesToStretches({
    nodeMiles: [0, 400],
    positioned: pos([["c", 267, true], ["a", 37, true], ["b", 155, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["a", "b", "c"]);
  assert.deepEqual(nodeClusters, [[], []]);
});

test("a mid-drive place beyond the last node (and far from it) clamps into the final stretch", () => {
  const { stretches } = assignPlacesToStretches({
    nodeMiles: [0, 100],
    positioned: pos([["over", 200, true]]), // 100 mi past the end node, >25 → not a cluster
  });
  assert.deepEqual(stretches[0].placeIds, ["over"]);
});

test("off-corridor is the ONLY thing in Along the way", () => {
  const { stretches, alongTheWay } = assignPlacesToStretches({
    nodeMiles: [0, 300],
    positioned: pos([["a", 37, true], ["detour", 155, false], ["b", 267, true]]),
  });
  assert.deepEqual(stretches[0].placeIds, ["a", "b"]);
  assert.deepEqual(alongTheWay, ["detour"]);
});

test("1-node day: near clusters under it; beyond its radius → Along the way", () => {
  const near = assignPlacesToStretches({ nodeMiles: [0], positioned: pos([["a", 5, true]]) });
  assert.deepEqual(near.nodeClusters[0], ["a"]);
  assert.deepEqual(near.alongTheWay, []);
  const far = assignPlacesToStretches({ nodeMiles: [0], positioned: pos([["b", 80, true]]) });
  assert.equal(far.stretches.length, 0);
  assert.deepEqual(far.alongTheWay, ["b"]);
});

// ── assignPlacesToStretches: HYBRID MODE (serverClusters) ───────────────────
test("hybrid: clusters come from serverClusters verbatim, residual → stretch", () => {
  // Server bucketed "near" under node 0; "mid" is in no cluster → geometry
  // positions it into the drive stretch.
  const { nodeClusters, stretches } = assignPlacesToStretches({
    nodeMiles: [0, 200],
    positioned: pos([["near", 10, true], ["mid", 60, true]]),
    serverClusters: [["near"], []],
  });
  assert.deepEqual(nodeClusters, [["near"], []]);
  assert.deepEqual(stretches[0].placeIds, ["mid"]);
});

test("hybrid: a pinned-FAR place stays in its server cluster (override wins geometry)", () => {
  // "bell2" projects at mile 5 (near node 0) but the server pinned it under
  // node 1 (an override). Hybrid honors the server: it clusters under node 1
  // and never leaks into node 0 or a stretch.
  const { nodeClusters, stretches } = assignPlacesToStretches({
    nodeMiles: [0, 240],
    positioned: pos([["bell2", 5, true]]),
    serverClusters: [[], ["bell2"]],
  });
  assert.deepEqual(nodeClusters, [[], ["bell2"]]);
  assert.deepEqual(stretches[0].placeIds, []);
});

test("hybrid: residual off-corridor → Along the way; server cluster order preserved", () => {
  const { nodeClusters, stretches, alongTheWay } = assignPlacesToStretches({
    nodeMiles: [0, 300],
    // node 1 cluster order is the server's (manual pin appended last, not re-sorted)
    positioned: pos([["mid", 155, true], ["detour", 200, false]]),
    serverClusters: [[], ["arrival", "pinned"]],
  });
  assert.deepEqual(nodeClusters, [[], ["arrival", "pinned"]]);
  assert.deepEqual(stretches[0].placeIds, ["mid"]);
  assert.deepEqual(alongTheWay, ["detour"]);
});

test("hybrid: empty serverClusters (fallback day) → every place is residual", () => {
  // A fallback 2-node day carries empty placeIds; hybrid must reproduce the
  // pure-geometry stretch placement for the whole pool.
  const { nodeClusters, stretches } = assignPlacesToStretches({
    nodeMiles: [0, 400],
    positioned: pos([["c", 267, true], ["a", 37, true], ["b", 155, true]]),
    serverClusters: [[], []],
  });
  assert.deepEqual(nodeClusters, [[], []]);
  assert.deepEqual(stretches[0].placeIds, ["a", "b", "c"]);
});
