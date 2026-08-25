import { test } from "node:test";
import assert from "node:assert/strict";
import { GUARANTEE_CHIP_CATEGORIES } from "./guarantee-categories";
import { GUARANTEE_CATEGORIES } from "@/lib/itinerary/anchor-backfill";

// The chip row is the UI face of the backend guarantee gate. These tests lock
// the two together so a category added to (or removed from) the backend gate
// can't silently drift out of sync with what the wizard offers.

test("chip keys exactly match the backend GUARANTEE_CATEGORIES gate", () => {
  const chipKeys = new Set(GUARANTEE_CHIP_CATEGORIES.map((c) => c.key));
  assert.deepEqual(
    [...chipKeys].sort(),
    [...GUARANTEE_CATEGORIES].sort(),
    "GUARANTEE_CHIP_CATEGORIES must offer exactly the categories the backend honors",
  );
});

test("fuel / overnight / interest get no chip (backend no-ops or separate path)", () => {
  const chipKeys = GUARANTEE_CHIP_CATEGORIES.map((c) => c.key);
  // `fuel` has its own checkbox + live-resolve path; `overnight` (= display
  // `hotel`) and `interest` are excluded from the backend gate — a chip for
  // any of them would silently do nothing.
  for (const excluded of ["fuel", "overnight", "interest"]) {
    assert.ok(
      !chipKeys.includes(excluded as (typeof chipKeys)[number]),
      `${excluded} must not have a chip`,
    );
  }
});

test("every chip has a non-empty label", () => {
  for (const c of GUARANTEE_CHIP_CATEGORIES) {
    assert.ok(c.label.trim().length > 0, `${c.key} needs a label`);
  }
});
