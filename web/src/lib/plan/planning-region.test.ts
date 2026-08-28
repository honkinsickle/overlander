/**
 * Tests for the planning-region constraint.
 * Run with: npx tsx --test src/lib/plan/planning-region.test.ts
 *
 * The load-bearing case is "an out-of-region code is refused" — mutation-check
 * it by making `isInPlanningRegion` return true unconditionally; the Idaho and
 * British Columbia cases must fail. A test that passes with the constraint
 * removed proves nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANNING_REGION_CODES,
  PLANNING_REGION_NAMES,
  isInPlanningRegion,
} from "./planning-region";
import { validateExpeditionForm, type ExpeditionForm } from "./expedition";
import { DEFAULT_RIG } from "@/lib/vehicles/types";

// ── isInPlanningRegion ─────────────────────────────────────────────────────

test("every code in the exported list is in region", () => {
  for (const c of PLANNING_REGION_CODES) {
    assert.equal(isInPlanningRegion(c), true, `${c} should be in region`);
  }
  assert.equal(PLANNING_REGION_CODES.length, 6);
});

test("out-of-region states are refused — including the ones a bbox would admit", () => {
  // ID / MT / WY are exactly what a bounding box over the six states leaks:
  // Idaho sits entirely inside it. This is why the constraint is code-based.
  for (const c of ["ID", "MT", "WY", "CO", "NM", "TX", "NY"]) {
    assert.equal(isInPlanningRegion(c), false, `${c} should be out of region`);
  }
});

test("Canadian provinces are refused — the geocoder queries country=us,ca", () => {
  for (const c of ["BC", "AB", "YT", "ON"]) {
    assert.equal(isInPlanningRegion(c), false, `${c} should be out of region`);
  }
});

test("a missing region is NOT in region — unproven is refused, not assumed", () => {
  assert.equal(isInPlanningRegion(null), false);
  assert.equal(isInPlanningRegion(undefined), false);
  assert.equal(isInPlanningRegion(""), false);
});

test("full state NAMES are refused — there is deliberately no name→code table", () => {
  // The label's `?? region.name` fallback is display-only. If this ever needs
  // to pass, that is a mapping table and a deliberate decision, not a tweak.
  assert.equal(isInPlanningRegion("California"), false);
  assert.equal(isInPlanningRegion("Oregon"), false);
});

test("matching is exact — no case-folding, no prefixes", () => {
  assert.equal(isInPlanningRegion("ca"), false);
  assert.equal(isInPlanningRegion("US-CA"), false);
  assert.equal(isInPlanningRegion("CA "), false);
});

test("the display name string lists all six states", () => {
  for (const n of ["California", "Nevada", "Utah", "Arizona", "Washington", "Oregon"]) {
    assert.ok(PLANNING_REGION_NAMES.includes(n), `${n} missing from the copy`);
  }
});

// ── the backstop, through the shared validator ─────────────────────────────

const base = (
  destinations: ExpeditionForm["destinations"],
): ExpeditionForm => ({
  destinations,
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  objective: "",
  budget: "mid",
  maxDailyDriveMi: 350,
  bufferDays: 0,
  avoid: [],
  returnRouting: "shortest",
  vehicleId: "v1",
  vehicleTitle: "Truck",
  // The real default, not a hand-written shape. A literal here needs an `as`
  // to compile, and that assertion hid a wrong `groupSize` (it is a string,
  // "1–2 travelers", not a number) past `next build` — which does not
  // type-check this file. CI's separate `typecheck` step does.
  rig: DEFAULT_RIG,
});

const dest = (place: string, region: string | null, manualCoords = false) => ({
  place,
  coords: [-120, 40] as [number, number],
  region,
  manualCoords,
  datePin: "flexible" as const,
  date: null,
  dwell: 0,
  note: null,
});

test("an all-in-region form passes validation", () => {
  const err = validateExpeditionForm(
    base([dest("Portland, OR", "OR"), dest("Bend, OR", "OR")]),
  );
  assert.equal(err, null);
});

test("ONE out-of-region destination fails, and the message names it", () => {
  const err = validateExpeditionForm(
    base([dest("Portland, OR", "OR"), dest("Boise, ID", "ID")]),
  );
  assert.ok(err, "expected a validation error");
  assert.match(err, /Boise, ID/);
  assert.match(err, /California/); // the region list is surfaced to the user
});

test("a destination with coords but NO region fails the backstop, unless manualCoords exempts it", () => {
  // Without the exemption, this is the shape a hand-crafted POST would have —
  // the autocomplete path cannot produce it, since coords are only ever set by
  // picking a filtered suggestion.
  const err = validateExpeditionForm(
    base([dest("Portland, OR", "OR"), dest("Somewhere", null)]),
  );
  assert.ok(err, "expected a validation error");
});

test("manualCoords exempts a hand-entered destination from the region backstop", () => {
  const err = validateExpeditionForm(
    base([
      dest("Portland, OR", "OR"),
      dest("Custom Point (40.0000, -120.0000)", null, true),
    ]),
  );
  assert.equal(err, null);
});

test("the coords check still runs BEFORE the region check", () => {
  // Ordering matters for the message the user sees: an unresolved destination
  // should be told to pick from the list, not told it is out of region.
  const err = validateExpeditionForm(
    base([
      dest("Portland, OR", "OR"),
      { ...dest("typed text", null), coords: null },
    ]),
  );
  assert.match(err ?? "", /Pick each destination/);
});
