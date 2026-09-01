import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PREFERENCE_OPTIONS, normalizePreferences } from "./expedition";

test("scenic is no longer an offered preference", () => {
  // Retired per docs/specs/interest-category-chips.md §7 — it duplicates the
  // Interest Categories chips.
  assert.equal((PREFERENCE_OPTIONS as readonly string[]).includes("scenic"), false);
});

test("normalizePreferences drops a retired value a saved rig still carries", () => {
  // ChipGroup renders only `options`, so without this a retired preference
  // would stay selected-but-invisible AND keep riding into the LLM payload
  // via `rig` in buildFactsMessage.
  assert.deepEqual(normalizePreferences(["scenic", "local-food"]), ["local-food"]);
});

test("normalizePreferences preserves order and every still-offered value", () => {
  const all = [...PREFERENCE_OPTIONS];
  assert.deepEqual(normalizePreferences(all), all);
});

test("normalizePreferences is a no-op on an empty list and drops unknowns", () => {
  assert.deepEqual(normalizePreferences([]), []);
  assert.deepEqual(normalizePreferences(["not-a-preference"]), []);
});
