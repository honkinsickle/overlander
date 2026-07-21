/**
 * PAID confirmation that a node seed survives a real living-plan regeneration.
 * Two phases around a regen you trigger (the paid gate is yours):
 *
 *   1. Seed the TEST trip (via verify-carry-free's create, or the app), then:
 *        npx tsx --env-file=.env.development.local scripts/verify-seed-carry.ts --snapshot
 *      → hashes nodeSeeds and stashes the hash.
 *   2. Trigger ONE living-plan regeneration on the trip (app or action).
 *   3. npx tsx --env-file=.env.development.local scripts/verify-seed-carry.ts --verify
 *      → re-hashes nodeSeeds, asserts UNCHANGED, and asserts seedResolutions is
 *        present (the derivation ran and reported the seed).
 *
 * Measurement, not eyeball: an equal hash proves byte-identical survival.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";
const STASH = join(tmpdir(), "overlander-seed-carry-hash.txt");

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

function hashSeeds(trip: Trip): string {
  return createHash("sha256")
    .update(JSON.stringify(trip.nodeSeeds ?? []))
    .digest("hex")
    .slice(0, 16);
}

async function main() {
  const mode = process.argv[2];
  const trip = await loadServed();
  const seeds = trip.nodeSeeds ?? [];

  if (mode === "--snapshot") {
    assert(seeds.length > 0, "no nodeSeeds on the trip — seed it before snapshot");
    const h = hashSeeds(trip);
    writeFileSync(STASH, h);
    console.log(`snapshot: ${seeds.length} seed(s), hash ${h} → ${STASH}`);
    console.log("Now trigger one regeneration, then run with --verify.");
    return;
  }

  if (mode === "--verify") {
    const prior = readFileSync(STASH, "utf8").trim();
    const now = hashSeeds(trip);
    assert.equal(now, prior, `nodeSeeds hash changed across regen (${prior} → ${now}) — carry FAILED`);
    assert(
      Array.isArray(trip.seedResolutions) && trip.seedResolutions.length > 0,
      "seedResolutions absent after regen — derivation did not report the seed",
    );
    console.log(`PASS — nodeSeeds hash unchanged (${now}); seedResolutions present (${trip.seedResolutions.length}).`);
    return;
  }

  throw new Error("usage: verify-seed-carry.ts --snapshot | --verify");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
