/**
 * FREE proof that node seeds survive the regeneration composition — no paid
 * generation. Exercises the REAL loaded TEST-trip shape through the REAL
 * finalizeUserAuthored, so if this passes, the carry wiring is proven; the paid
 * regen (verify-seed-carry.ts) is then confirmation, not discovery.
 *
 * Steps: seed the real TEST trip (free DB write) → reload the served shape →
 * synthesize an overlay-free "regenerated" body → finalizeUserAuthored → assert
 * the seed carried → remove the seed (leave the trip exactly as found).
 *
 * Requires the TEST env (dev .env.development.local: TEST Supabase ref +
 * NEXT_PUBLIC_LIVING_PLAN_EDIT=1). Run:
 *   npx tsx --env-file=.env.development.local scripts/verify-carry-free.ts
 */
import assert from "node:assert/strict";
import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import { finalizeUserAuthored } from "../src/lib/trips/carry-forward";
import {
  createNodeSeedAction,
  removeSeedAction,
} from "../src/lib/itinerary/node-actions";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";

/** The served shape (raw payload + in-memory corridor derivation), matching
 *  what the app renders — without needing a Next request context. */
async function loadServed(): Promise<Trip> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("reference_trips")
    .select("payload")
    .eq("id", TRIP_ID)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`load failed: ${error?.message ?? "trip not found"}`);
  }
  return resolveCorridorCities(data.payload as Trip);
}

/** A coordinate on the route so the seed also resolves onto a day (a corridor
 *  node's coords, else a day's end). */
function pickCoords(trip: Trip): [number, number] {
  for (const d of trip.days) {
    for (const n of d.corridorCities ?? []) {
      if (n.kind === "corridor") return n.coords;
    }
  }
  for (const d of trip.days) if (d.coords) return d.coords;
  throw new Error("no route coordinate available to seed");
}

async function main() {
  const before = await loadServed();
  const coords = pickCoords(before);

  const create = await createNodeSeedAction(TRIP_ID, {
    name: "Carry Proof Seed",
    coords,
  });
  if (!create.ok) throw new Error(`createNodeSeed refused: ${create.error}`);
  const seedId = create.seedId;
  console.log(`seeded ${seedId} at [${coords}] (created=${create.created})`);

  // The real loaded shape, now carrying a seed.
  const withSeed = await loadServed();
  assert(
    withSeed.nodeSeeds?.some((s) => s.id === seedId),
    "seed did not persist to the trip",
  );

  // A fresh regenerated body carries NO overlays (what the pipeline emits).
  const regenerated: Trip = {
    ...withSeed,
    nodeSeeds: undefined,
    placeOverrides: undefined,
    seedResolutions: undefined,
  };
  const out = finalizeUserAuthored(withSeed, regenerated);
  assert(
    out.nodeSeeds?.some((s) => s.id === seedId),
    "finalizeUserAuthored did NOT carry the seed through regeneration",
  );
  console.log("carried: finalizeUserAuthored preserved the seed onto the regenerated body");

  // Leave the trip exactly as found.
  const rm = await removeSeedAction(TRIP_ID, seedId);
  if (!rm.ok) throw new Error(`cleanup removeSeed refused: ${rm.error}`);
  const after = await loadServed();
  assert(
    !(after.nodeSeeds ?? []).some((s) => s.id === seedId),
    "cleanup failed — seed still present",
  );

  console.log("\nPASS — seed carried through finalizeUserAuthored on the real TEST trip; trip restored.");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
