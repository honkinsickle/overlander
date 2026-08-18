import { test } from "node:test";
import assert from "node:assert/strict";
import { browsePlaceToWaypoint, type CardCtx, type CardStats } from "./card-stats";
import type { BrowsePlace } from "./places";

/** Minimal valid BrowsePlace — every required field filled, every optional
 *  field left off unless a case needs it. */
function place(extra: Partial<BrowsePlace> = {}): BrowsePlace {
  return {
    id: "mp:11111111-1111-1111-1111-111111111111",
    coords: [-122.68, 45.52],
    photoAlt: "Test Place",
    title: "Test Place",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "Add to day",
    ...extra,
  };
}

const ctx: CardCtx = {
  category: "camping",
  dayNumber: 3,
  dayRelative: true,
};

const stats: CardStats = {
  dayTag: "Day 3 / 2.0 mi off",
  cost: { hero: "Adds 12m" },
};

// Task 3 — logistics.hours: per docs/architecture/place-render-model.md §9
// and the pipeline-trace addendum, this is already fetched (PlaceRich.hours)
// and grafted onto the synthesized Waypoint's logistics.hours by
// day-detail-corridor-column.tsx's synth() (:739-741, not touched by this
// pass — already correct). This test locks in browsePlaceToWaypoint's own
// half: hours sourced from a place.stats HOURS entry (the pre-graft value
// synth() starts from before layering the live rich.hours on top).
test("logistics.hours sourced from place.stats HOURS entry", () => {
  const wp = browsePlaceToWaypoint(
    place({ stats: [{ label: "HOURS", value: "Mon-Fri 9a-5p" }] }),
    ctx,
    stats,
  );
  assert.equal(wp.logistics?.hours, "Mon-Fri 9a-5p");
});

test("no HOURS stat → logistics.hours undefined (no fabrication)", () => {
  const wp = browsePlaceToWaypoint(place(), ctx, stats);
  assert.equal(wp.logistics?.hours, undefined);
});

// Task 4 — priceTier: this proves the DOWNSTREAM half (browsePlaceToWaypoint
// already correctly turns place.priceTier into logistics.entry /
// simulator.entryCost via priceTierToEntry — it always did). The bug this
// task fixes is upstream of this function: day-detail-corridor-column.tsx's
// synth() and hydratePlaces() never grafted rich.priceTier onto the
// BrowsePlace/CorridorPlace in the first place, so `place.priceTier` here
// was always undefined for a real corpus tile. See
// docs/architecture/place-pipeline-trace.md §3.
test("priceTier → logistics.entry as repeated $ signs", () => {
  const wp = browsePlaceToWaypoint(place({ priceTier: 2 }), ctx, stats);
  assert.equal(wp.logistics?.entry, "$$");
});

test("priceTier → simulator.entryCost (day-relative only)", () => {
  const wp = browsePlaceToWaypoint(place({ priceTier: 3 }), ctx, stats);
  assert.equal(wp.simulator?.entryCost, "$$$");
});

test("no priceTier → no entry line (never a fabricated price)", () => {
  const wp = browsePlaceToWaypoint(place(), ctx, stats);
  assert.equal(wp.logistics?.entry, undefined);
  assert.equal(wp.simulator?.entryCost, undefined);
});
