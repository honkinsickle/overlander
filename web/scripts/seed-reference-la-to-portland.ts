/**
 * Lift-and-shift: migrate the `la-to-portland` demo trip from the in-code
 * fixture (`src/lib/trips/fixtures.ts`) into the Supabase `reference_trips`
 * table, so it stops being fixture-only and can serve DB-first like every
 * other reference slug.
 *
 * BEHAVIOR-NEUTRAL BY CONSTRUCTION: the payload written is the fixture literal
 * VERBATIM — `TRIPS["la-to-portland"]`, pre-derivation. We do NOT bake
 * corridors and do NOT run getTrip (which would derive at read). The read path
 * (`reference.ts withCorridors` / federated fold) still derives at serve, same
 * as it would for any raw reference payload — this script only moves the stored
 * bytes, it does not reshape them.
 *
 * Idempotent: upsert on the `id` primary key. Re-runnable against PROD later by
 * pointing --env-file at the production env (service-role key required —
 * `reference_trips` is public-read / service-write).
 *
 * Modes:
 *   (default)   Upsert the row, then verify (read back + deep-equal).
 *   --verify    Verify only: read back the stored payload and deep-equal it
 *               against the fixture literal. No write.
 *   --revert    Delete the row (the exact back-out for this migration).
 *
 * Run (TEST):
 *   cd web && npx tsx --env-file=.env.development.local \
 *     scripts/seed-reference-la-to-portland.ts
 *
 * Revert (TEST):
 *   cd web && npx tsx --env-file=.env.development.local \
 *     scripts/seed-reference-la-to-portland.ts --revert
 */

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { TRIPS } from "../src/lib/trips/fixtures";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "la-to-portland";
const SOURCE_VERSION = "fixture-literal@2026-07-25";

/** The fixture literal, pre-derivation. `TRIPS` is the in-memory seed store;
 *  la-to-portland is never mutated by `ensureAlaskaUpgraded` (that only touches
 *  la-to-deadhorse), so this is the raw shape as authored. */
function fixtureLiteral(): Trip {
  const trip = TRIPS[TRIP_ID];
  if (!trip) throw new Error(`fixture ${TRIP_ID} not found in TRIPS`);
  return trip;
}

/** jsonb round-trips through JSON: undefined keys drop, key order is not
 *  significant. Deep-equal AFTER deserialization is the correct comparison,
 *  not byte-identity (a TS literal and a jsonb column are not byte-comparable). */
function jsonNormalized(trip: Trip): unknown {
  return JSON.parse(JSON.stringify(trip));
}

function client() {
  // TEST env uses NEXT_PUBLIC_SUPABASE_URL; the PROD env backup uses
  // SUPABASE_URL — accept either so the same script runs against both.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "✗ requires (NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (use --env-file)",
    );
    process.exit(1);
  }
  console.log(`→ target: ${(url.match(/https:\/\/([a-z0-9]+)/) ?? [])[1]}`);
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verify(supabase: ReturnType<typeof client>): Promise<void> {
  const { data, error } = await supabase
    .from("reference_trips")
    .select("payload")
    .eq("id", TRIP_ID)
    .maybeSingle();
  if (error) {
    console.error("✗ read-back failed:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`✗ no reference_trips row for ${TRIP_ID}`);
    process.exit(1);
  }
  // Compare the RAW stored payload against the fixture literal (both
  // JSON-normalized). withCorridors is deterministic and input-only, so
  // raw-equality guarantees serve-equality on the shared read path.
  assert.deepStrictEqual(data.payload, jsonNormalized(fixtureLiteral()));
  console.log("✓ stored payload deep-equals the fixture literal (raw, pre-derivation)");
}

async function main() {
  const argv = process.argv.slice(2);
  const supabase = client();

  if (argv.includes("--revert")) {
    const { error } = await supabase
      .from("reference_trips")
      .delete()
      .eq("id", TRIP_ID);
    if (error) {
      console.error("✗ revert failed:", error.message);
      process.exit(1);
    }
    console.log(`→ reverted: deleted reference_trips/${TRIP_ID}`);
    return;
  }

  if (argv.includes("--verify")) {
    await verify(supabase);
    return;
  }

  const trip = fixtureLiteral();
  const { error } = await supabase.from("reference_trips").upsert({
    id: TRIP_ID,
    title: trip.title,
    payload: trip, // raw literal — no bake, no derivation
    source_version: SOURCE_VERSION,
  });
  if (error) {
    console.error("✗ upsert failed:", error.message);
    process.exit(1);
  }
  console.log(
    `→ upserted reference_trips/${TRIP_ID} (${SOURCE_VERSION}), ${trip.days.length} days`,
  );
  await verify(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
