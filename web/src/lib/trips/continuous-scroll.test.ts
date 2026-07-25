/**
 * Pure helpers for the continuous day-detail scroll (Design A, presentation
 * layer only). Run: npx tsx --test src/lib/trips/continuous-scroll.test.ts
 *
 * These cover the two bits of the windowed scroll that are pure math and where
 * the bugs hide: the never-mounted height estimate (so placeholders don't jump
 * the scroll) and the centered-day pick WITH hysteresis (so the map/rail signal
 * doesn't flap while a day boundary sits near the viewport center).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateDayHeight, pickCenteredDay, type DaySlotSpan } from "./continuous-scroll";

// ── estimateDayHeight ──────────────────────────────────────────────────────
test("estimateDayHeight: base with an empty pool", () => {
  // A 0-item day still occupies the header + hero + footer chrome.
  assert.equal(estimateDayHeight(0), 520);
});

test("estimateDayHeight: grows one row-height per pool item", () => {
  assert.equal(estimateDayHeight(1), 520 + 96);
  assert.equal(estimateDayHeight(5), 520 + 96 * 5);
});

test("estimateDayHeight: never negative / clamps a nonsense count", () => {
  assert.equal(estimateDayHeight(-3), 520);
});

// ── pickCenteredDay ────────────────────────────────────────────────────────
// Slots are laid out in content coordinates (top/bottom = offset within the
// scrolled content). viewportCenter = scrollTop + viewportHeight/2.
const slots: DaySlotSpan[] = [
  { id: "d1", top: 0, bottom: 1000 },
  { id: "d2", top: 1000, bottom: 2000 },
  { id: "d3", top: 2000, bottom: 3000 },
];
const DZ = 120; // ~15% of an 800px viewport

test("pickCenteredDay: no prior — picks the slot containing the center", () => {
  assert.equal(pickCenteredDay(slots, 500, null, DZ), "d1");
  assert.equal(pickCenteredDay(slots, 1500, null, DZ), "d2");
  assert.equal(pickCenteredDay(slots, 2500, null, DZ), "d3");
});

test("pickCenteredDay: hysteresis holds prev while center stays within its dead zone", () => {
  // Center has crossed into d2's span, but only just — within DZ of the d1/d2
  // boundary (1000). Hold d1.
  assert.equal(pickCenteredDay(slots, 1050, "d1", DZ), "d1");
  // Symmetric: center just above the boundary, prev d2 → hold d2.
  assert.equal(pickCenteredDay(slots, 950, "d2", DZ), "d2");
});

test("pickCenteredDay: flips once the center clears the boundary by more than the dead zone", () => {
  // 1000 + 120 = 1120 is the flip threshold coming down from d1.
  assert.equal(pickCenteredDay(slots, 1121, "d1", DZ), "d2");
  // 1000 - 120 = 880 is the flip threshold going up from d2.
  assert.equal(pickCenteredDay(slots, 879, "d2", DZ), "d1");
});

test("pickCenteredDay: can skip more than one day on a fast jump (raw pick, not neighbor-only)", () => {
  // Center jumps deep into d3 while prev is d1 — must land on d3, not d2.
  assert.equal(pickCenteredDay(slots, 2500, "d1", DZ), "d3");
});

test("pickCenteredDay: center above all content clamps to the first slot", () => {
  assert.equal(pickCenteredDay(slots, -50, null, DZ), "d1");
});

test("pickCenteredDay: center below all content clamps to the last slot", () => {
  assert.equal(pickCenteredDay(slots, 99999, null, DZ), "d3");
});

test("pickCenteredDay: empty slots → null (nothing mounted yet)", () => {
  assert.equal(pickCenteredDay([], 500, "d1", DZ), null);
});

test("pickCenteredDay: prev no longer present (day removed) falls back to the raw pick", () => {
  assert.equal(pickCenteredDay(slots, 1500, "gone", DZ), "d2");
});
