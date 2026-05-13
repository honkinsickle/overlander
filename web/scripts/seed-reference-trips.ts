/**
 * Snapshot + seed for the LA→Deadhorse reference trip.
 *
 * Two modes (combinable):
 *   --snapshot   Run the markdown pipeline and write web/.alaska-snapshot.json.
 *   --seed       Upsert the snapshot (or freshly-built payload) into the
 *                Supabase `reference_trips` table via the service-role key.
 *
 * Defaults to `--snapshot --seed` if neither flag is passed.
 *
 *   npm run snapshot       # snapshot only
 *   npm run seed           # snapshot + DB seed
 *
 * Requires (for --seed): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * in web/.env.local. `--snapshot` alone has no Supabase dependency.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { buildAlaskaTripFromMarkdown } from "../src/lib/trips/alaska";

const TRIP_ID = "la-to-deadhorse";
const SNAPSHOT_PATH = join(process.cwd(), ".alaska-snapshot.json");

function parseArgs() {
  const argv = process.argv.slice(2);
  let snapshot = argv.includes("--snapshot");
  let seed = argv.includes("--seed");
  if (!snapshot && !seed) {
    snapshot = true;
    seed = true;
  }
  return { snapshot, seed };
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const { snapshot, seed } = parseArgs();

  console.log("→ Building trip from markdown…");
  const trip = await buildAlaskaTripFromMarkdown();
  console.log(`  ✓ ${trip.days.length} days, ${trip.days.flatMap((d) => d.waypoints).length} waypoints`);

  if (snapshot) {
    await writeFile(SNAPSHOT_PATH, JSON.stringify(trip, null, 2));
    console.log(`→ Wrote snapshot to ${SNAPSHOT_PATH}`);
  }

  if (seed) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.error(
        "✗ --seed requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in web/.env.local",
      );
      process.exit(1);
    }
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sourceVersion = `alaska-v3.md@${gitSha()}`;
    const { error } = await supabase
      .from("reference_trips")
      .upsert({
        id: TRIP_ID,
        title: trip.title,
        payload: trip,
        source_version: sourceVersion,
      });
    if (error) {
      console.error("✗ Upsert failed:", error.message);
      process.exit(1);
    }
    console.log(`→ Upserted reference_trips/${TRIP_ID} (${sourceVersion})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
