/**
 * Tests for resolveSeeds() — cross-day node-seed arbitration
 * (spec § node-stack model). Run with:
 *   npx tsx --test src/lib/corridor/seeds.test.ts
 *
 * Equator fixtures: 1° lng = 69.09318 mi, 1° lat = 69.09318 mi, so a seed
 * offset N degrees north of a lat-0 line sits N·69.09 mi off-route.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSeeds } from "./seeds";
import type { NodeSeed } from "@/lib/trips/types";

const MI_PER_DEG = ((6371 * Math.PI) / 180) / 1.609344; // 69.09318…

/** Straight equator polyline lng `from`→`to` at latitude `lat`, step 0.25°. */
function line(from: number, to: number, lat = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let d = from; d <= to + 1e-9; d += 0.25) out.push([d, lat]);
  return out;
}

function seed(id: string, lng: number, lat = 0): NodeSeed {
  return { id, name: id, coords: [lng, lat], createdAt: "2026-07-20T00:00:00Z" };
}

test("seed on a day's line resolves to it, positioned by along-route mile", () => {
  const { byDay, resolutions } = resolveSeeds({
    days: [{ id: "d1", line: line(0, 2) }],
    seeds: [seed("s", 1)],
  });
  assert.equal(resolutions.length, 1);
  const r = resolutions[0];
  assert.equal(r.resolved, true);
  if (r.resolved) {
    assert.equal(r.dayId, "d1");
    assert.ok(Math.abs(r.milesFromStart - MI_PER_DEG) < 0.5); // ~1° in
    assert.ok(r.offsetMi < 0.01); // dead on the line
  }
  assert.equal(byDay.get("d1")?.length, 1);
  assert.equal(byDay.get("d1")?.[0].id, "s");
});

test("out-and-back within one day yields ONE node (nearest = outbound pass)", () => {
  // Day 6 shape: Stewart(0) → Salmon Glacier(1) → Stewart(0). A seed near the
  // turnaround projects onto both legs; resolveSeeds must not double it.
  const outAndBack = [...line(0, 1), ...line(1, 0).slice(1)];
  const { byDay, resolutions } = resolveSeeds({
    days: [{ id: "d6", line: outAndBack }],
    seeds: [seed("glacier", 0.75)],
  });
  assert.equal(resolutions[0].resolved, true);
  assert.equal(byDay.get("d6")?.length, 1); // exactly one node, not two
  // Outbound pass (scanned first) wins → mile ≈ 0.75°, not the return leg.
  assert.ok(Math.abs((byDay.get("d6")![0].milesFromStart) - 0.75 * MI_PER_DEG) < 1);
});

test("loop: seed attaches to the day whose route it sits closest to", () => {
  // Two passes over the same lng span on different days/latitudes.
  const dayA = { id: "A", line: line(0, 2, 0) };
  const dayB = { id: "B", line: line(0, 2, 0.1) }; // ~6.9 mi north
  // Seed near A's latitude → A wins on min offset.
  const near = resolveSeeds({ days: [dayA, dayB], seeds: [seed("x", 1, 0.02)] });
  assert.equal((near.resolutions[0] as { dayId: string }).dayId, "A");
  // Seed near B's latitude → B wins.
  const far = resolveSeeds({ days: [dayA, dayB], seeds: [seed("y", 1, 0.08)] });
  assert.equal((far.resolutions[0] as { dayId: string }).dayId, "B");
  assert.equal(near.byDay.has("A"), true);
  assert.equal(far.byDay.has("B"), true);
});

test("exact offset tie breaks to the EARLIER day", () => {
  const dayA = { id: "A", line: line(0, 2, 0) };
  const dayB = { id: "B", line: line(0, 2, 0.1) };
  // Equidistant (0.05° from each) → earliest (A) wins.
  const { resolutions } = resolveSeeds({
    days: [dayA, dayB],
    seeds: [seed("mid", 1, 0.05)],
  });
  assert.equal((resolutions[0] as { dayId: string }).dayId, "A");
});

test("dormant: a seed off every day's corridor is reported, not dropped", () => {
  const { byDay, resolutions } = resolveSeeds({
    days: [{ id: "d1", line: line(0, 2) }],
    seeds: [seed("faraway", 1, 5)], // ~345 mi north of the line
  });
  assert.equal(byDay.size, 0);
  assert.deepEqual(resolutions, [
    { seedId: "faraway", resolved: false, reason: "off-corridor" },
  ]);
});

test("no sliceable days → every seed reported no-days", () => {
  const { resolutions } = resolveSeeds({ days: [], seeds: [seed("a", 1)] });
  assert.deepEqual(resolutions, [
    { seedId: "a", resolved: false, reason: "no-days" },
  ]);
});

test("no seeds → empty resolution, empty byDay (the no-op path)", () => {
  const { byDay, resolutions } = resolveSeeds({
    days: [{ id: "d1", line: line(0, 2) }],
    seeds: [],
  });
  assert.equal(byDay.size, 0);
  assert.equal(resolutions.length, 0);
});
