/**
 * Locks the pre-flight feasibility check: obvious arithmetic impossibility →
 * free refuse; tight-but-fittable → passes to the full gate. The lower-bound
 * (straight-line) property guarantees NO false-refuse. Run:
 * npx tsx --test src/lib/itinerary/preflight.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightFeasibility } from "./edit";
import type { Anchor } from "./facts";

// Real-ish coords: Dawson City ~[-139.4,64.06], Stewart ~[-129.99,55.94],
// Vancouver ~[-123.12,49.28]. Dawson→Stewart is ~630 mi straight-line.
const DAWSON: [number, number] = [-139.43, 64.06];
const STEWART: [number, number] = [-129.99, 55.94];
const VAN: [number, number] = [-123.12, 49.28];

const mk = (place: string, date: string | null, pin: "fixed" | "flexible"): Anchor => ({
  place, role: "waypoint", datePin: pin, date, dwell: 0, note: null,
});

test("IMPOSSIBLE: Stewart fixed 1 day after Dawson → refused free (crow-flies > cap)", () => {
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", "2026-07-14", "fixed"), // 1 day for ~630mi straight-line
    mk("Vancouver", "2026-07-26", "fixed"),
  ];
  const r = preflightFeasibility(anchors, 350, [DAWSON, STEWART, VAN]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not reachable/);
});

test("FITTABLE: Stewart fixed 5 days after Dawson → passes (let the gate decide)", () => {
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", "2026-07-18", "fixed"), // 5 days × 350 = 1750mi >> 630 straight-line
    mk("Vancouver", "2026-07-26", "fixed"),
  ];
  assert.deepEqual(preflightFeasibility(anchors, 350, [DAWSON, STEWART, VAN]), { ok: true });
});

test("BORDERLINE not over-rejected: crow-flies just under budget passes", () => {
  // ~630 straight-line over 2 days × 350 = 700 budget → passes (road may be
  // tighter, but that's the gate's call, not the pre-flight's).
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", "2026-07-15", "fixed"),
    mk("Vancouver", "2026-07-26", "fixed"),
  ];
  assert.deepEqual(preflightFeasibility(anchors, 350, [DAWSON, STEWART, VAN]), { ok: true });
});

test("dates out of order → refused", () => {
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", "2026-07-12", "fixed"), // before Dawson
  ];
  const r = preflightFeasibility(anchors, 350, [DAWSON, STEWART]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /out of order/);
});

test("flexible anchors between fixed ones accumulate into the lower bound", () => {
  // Dawson (fixed 7/13) → Stewart (flexible) → Vancouver (fixed 7/14): the
  // full Dawson→Stewart→Vancouver straight-line in 1 day is wildly impossible.
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", null, "flexible"),
    mk("Vancouver", "2026-07-14", "fixed"),
  ];
  const r = preflightFeasibility(anchors, 350, [DAWSON, STEWART, VAN]);
  assert.equal(r.ok, false);
});

test("no fixed-date spans → nothing to check → ok", () => {
  const anchors = [
    mk("Dawson City", "2026-07-13", "fixed"),
    mk("Stewart", null, "flexible"),
    mk("Vancouver", null, "flexible"),
  ];
  assert.deepEqual(preflightFeasibility(anchors, 350, [DAWSON, STEWART, VAN]), { ok: true });
});
