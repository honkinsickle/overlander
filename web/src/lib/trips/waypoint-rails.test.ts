/**
 * Regression: the shipped waypoint actions must call checkNotFrozen BEFORE any
 * repo write, so the frozen PROD trip is refused even though it's a user-trip
 * path (no phase guards). A frozen id must return the frozen refusal — NOT a
 * repo-level error ("Could not add/remove stop"), which would prove the repo
 * ran first. Run: npx tsx --test src/lib/trips/waypoint-rails.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addWaypointAction, removeWaypointAction } from "./actions";
import type { AddedPlace } from "./added-place";

const FROZEN = "dawson-vancouver-cassiar";
const FROZEN_MSG = "This trip is live and cannot be re-planned.";

test("removeWaypointAction refuses the frozen trip before touching the repo", async () => {
  const r = await removeWaypointAction(FROZEN, "day-1", "wp-x");
  assert.deepEqual(r, { ok: false, error: FROZEN_MSG });
});

test("addWaypointAction refuses the frozen trip before touching the repo", async () => {
  // A fully-valid place — the frozen guard must fire ahead of the place check
  // AND ahead of the repo write.
  const place: AddedPlace = {
    id: "google:test",
    title: "Test Place",
    coords: [-129, 56],
  } as AddedPlace;
  const r = await addWaypointAction(FROZEN, "day-1", place);
  assert.deepEqual(r, { ok: false, error: FROZEN_MSG });
});

test("a NON-frozen id passes the guard and reaches the repo (guard is frozen-only)", async () => {
  // The guard must NOT block legitimate ids — it falls through to the repo,
  // which (with no configured DB in the test) reports its own error, NOT the
  // frozen refusal. This is what keeps the shipped user-trip path working.
  const r = await removeWaypointAction("some-user-trip-id", "day-1", "wp-x");
  assert.equal(r.ok, false);
  assert.notEqual((r as { error: string }).error, FROZEN_MSG);
});
