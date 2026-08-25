/**
 * Tests for the fuel-live-resolve module.
 *
 * The Interest-Category-Chips feature (`docs/specs/interest-category-chips.md`,
 * PR #287) needs a corpus-independent path for the `fuel` guarantee — because
 * the general backfill selector `pickAnchorStop` is `facts.poolPOIs`-only and
 * never reaches Google (§9 B.1 caveat). This module is that path.
 *
 * `pickFuelAtAnchor` looks at ONE anchor (start or corridor city). If the
 * anchor already has a fuel-category stop within `ANCHOR_NEAR_MI`, it no-ops.
 * Otherwise it calls the injected `PlaceResolver.resolveNearby(type, coords)`
 * for a nearby gas station (or whatever `fuelType` the caller passes) and
 * hands back a `{ resolved, note }` payload the audit weaves into keptStops +
 * resolvedPlaces the same way live-resolved LLM keyStops are.
 *
 * Run with: cd web && npx tsx --test src/lib/itinerary/fuel-live-resolve.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFuelAtAnchor } from "./fuel-live-resolve";
import type { PlaceResolver } from "./resolve";
import type { BackfillAnchor } from "./anchor-backfill";

const ANCHOR: BackfillAnchor = {
  coords: [-119.77, 36.75], // Fresno-ish
  label: "Fresno, California",
  kind: "start",
};

// Same posture as ground-keystop.test.ts: inline object literals coerced to
// the PlaceResolver shape, so tests don't touch fetch/Google/env.
function makeResolver(handler: PlaceResolver["resolveNearby"]): PlaceResolver {
  return { resolveNearby: handler } as unknown as PlaceResolver;
}

const throwingResolver: PlaceResolver = {
  resolveNearby: async () => {
    throw new Error("resolveNearby must NOT be called on a dedupe hit");
  },
} as unknown as PlaceResolver;

test("returns null when a fuel-category stop is already within ANCHOR_NEAR_MI (no Google call)", async () => {
  // A kept stop 0.5 mi from the anchor with a fuel category should suppress
  // the Google call entirely — the guarantee is satisfied by what the LLM
  // already picked (or an earlier general-backfill pick).
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [[-119.77, 36.76]], // ~0.5 mi north
    fuelType: "gas_station",
    resolver: throwingResolver,
    onCorridor: () => true,
  });
  assert.equal(pick, null);
});

test("returns null when the resolver returns not-found", async () => {
  const resolver = makeResolver(async () => ({ status: "not-found" }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  assert.equal(pick, null);
});

test("returns null when the resolver returns capped (per-generation cost cap reached)", async () => {
  const resolver = makeResolver(async () => ({ status: "capped" }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  assert.equal(pick, null);
});

test("returns null when the resolver returns no-key (GOOGLE_PLACES_API_KEY unset)", async () => {
  const resolver = makeResolver(async () => ({ status: "no-key" }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  assert.equal(pick, null);
});

test("returns null when the resolved coords fail the onCorridor guard", async () => {
  // Google's locationBias is a soft preference — an ambiguous name can resolve
  // far off-route. The corridor guard is what keeps live picks navigation-grade
  // (same posture as resolve.ts's own doc block).
  const resolver = makeResolver(async () => ({
    status: "resolved",
    place: {
      placeId: "google:offroute",
      displayName: "Random Chevron",
      coords: [-100, 40],
      category: "gas_station",
    },
  }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => false,
  });
  assert.equal(pick, null);
});

test("happy path: returns the resolved place + a note that names the anchor", async () => {
  const resolver = makeResolver(async () => ({
    status: "resolved",
    place: {
      placeId: "google:chevron123",
      displayName: "Chevron",
      coords: [-119.771, 36.751],
      category: "gas_station",
    },
  }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  if (!pick) throw new Error("expected a pick, got null");
  assert.equal(pick.resolved.displayName, "Chevron");
  assert.equal(pick.resolved.placeId, "google:chevron123");
  assert.deepEqual(pick.resolved.coords, [-119.771, 36.751]);
  // The note names the anchor so the persisted card is intelligible without
  // structured provenance — matches anchor-backfill.ts's `KeyStop.note is the
  // only part of this decision that survives generation` posture.
  assert.match(pick.note, /Fresno, California/);
  // Distinguishable from a corridor-backfill note so downstream can tell them
  // apart without a new field on BrowsePlace.
  assert.match(pick.note, /fuel|top up|gas/i);
});

test("bias coords passed to the resolver are the anchor's coords", async () => {
  let receivedCoords: [number, number] | null = null;
  const resolver = makeResolver(async (_type, coords) => {
    receivedCoords = coords;
    return { status: "not-found" };
  });
  await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  assert.deepEqual(receivedCoords, ANCHOR.coords);
});

test("resolver is asked for the fuelType the caller passed (e.g. ev_charging)", async () => {
  let receivedType: string | null = null;
  const resolver = makeResolver(async (type) => {
    receivedType = type;
    return { status: "not-found" };
  });
  await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [],
    // Deliberately EV — even though the current wiring only ships gas, the
    // module doesn't hardcode; a future rig fuel-type field flips this per-trip.
    fuelType: "electric_vehicle_charging_station",
    resolver,
    onCorridor: () => true,
  });
  assert.equal(receivedType, "electric_vehicle_charging_station");
});

test("dedupe threshold is ANCHOR_NEAR_MI (25 mi) — a kept fuel stop farther than that does NOT suppress", async () => {
  // 30 mi east of Fresno at this latitude is ~0.5° lng.
  const resolver = makeResolver(async () => ({
    status: "resolved",
    place: {
      placeId: "google:chevron",
      displayName: "Chevron",
      coords: [-119.7, 36.75],
      category: "gas_station",
    },
  }));
  const pick = await pickFuelAtAnchor({
    anchor: ANCHOR,
    keptFuelCoords: [[-119.27, 36.75]], // ~30 mi east — outside ANCHOR_NEAR_MI
    fuelType: "gas_station",
    resolver,
    onCorridor: () => true,
  });
  assert.notEqual(pick, null);
});
