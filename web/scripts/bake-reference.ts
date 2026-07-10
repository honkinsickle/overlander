/**
 * Bake-in-place reseed: precompute-and-persist corridors into
 * `reference_trips.payload` (spec §3), so forks copy them verbatim (instant,
 * editable) and the reference serve stops re-deriving on every cold start.
 *
 * Reads the CURRENT reference payload from the DB (has routePolyline, is
 * spine-less), strips any prior bake, re-derives the spine, folds the corpus
 * tiles, and upserts. NO markdown/OSM rebuild — avoids that flaky path.
 *
 * DELIBERATE PROD WRITE. TEST-first, eyes-on target confirm:
 *   1. Dry run TEST : tsx --env-file=.env.test.local scripts/bake-reference.ts
 *   2. Write TEST   : tsx --env-file=.env.test.local scripts/bake-reference.ts --write
 *   3. Dry run PROD : tsx --env-file=.env.local      scripts/bake-reference.ts
 *   4. Write PROD   : tsx --env-file=.env.local      scripts/bake-reference.ts --write
 * The pre-flight prints the target project ref — confirm it with your own
 * eyes before passing --write. Without --write it is a read-only dry run.
 *
 * Re-runnable: strips prior bake first, so re-seeding after a derivation
 * change refreshes cleanly.
 */
process.env.USE_FEDERATED_CORRIDOR = "true"; // baking always wants tiles
import { createClient } from "@supabase/supabase-js";
import { bakeCorridors, stripBakedCorridors } from "../src/lib/trips/bake-corridors";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "la-to-deadhorse";
const KNOWN = {
  nqzeywzcowujzyegxbsr: "PROD",
  znldzjdatkogdktymtvi: "TEST",
} as const;

function tiles(trip: Trip): number {
  return trip.days.reduce(
    (s, d) =>
      s + (d.corridorCities?.reduce((n, c) => n + (c.placeIds?.length ?? 0), 0) ?? 0),
    0,
  );
}
function baked(trip: Trip): number {
  return trip.days.filter((d) => d.corridorCities != null).length;
}

async function main() {
  const write = process.argv.includes("--write");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (via --env-file)");
    process.exit(1);
  }
  const ref = url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";
  const label = (KNOWN as Record<string, string>)[ref] ?? "UNKNOWN";

  console.log("──────────────────────────────────────────────");
  console.log(`  PRE-FLIGHT — target project: ${ref}  [${label}]`);
  console.log(`  mode: ${write ? "★ WRITE (will upsert reference_trips.payload)" : "dry run (read-only)"}`);
  console.log("──────────────────────────────────────────────");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
  if (error || !data) throw new Error("read failed: " + JSON.stringify(error));
  const current = data.payload as Trip;
  console.log(`current: ${current.days.length} days | baked days=${baked(current)} tiles=${tiles(current)} | routePolyline=${!!current.routePolyline}`);

  const clean = stripBakedCorridors(current);
  // bakeCorridors is typed for the SSR cookie client; the plain service-role
  // client is structurally compatible (uses .rpc only).
  const t0 = Date.now();
  const out = await bakeCorridors(clean, sb as unknown as Parameters<typeof bakeCorridors>[1]);
  console.log(`baked in ${Date.now() - t0}ms | baked days=${baked(out)} tiles=${tiles(out)}`);
  const d2 = out.days[1]?.corridorCities, d3 = out.days[2]?.corridorCities;
  console.log(`  Day 2: ${d2?.length ?? "NONE"} nodes | Day 3: ${d3?.length ?? "NONE"} nodes`);

  if (!write) {
    console.log("\ndry run — nothing written. Re-run with --write to upsert.");
    return;
  }
  const { error: upErr } = await sb
    .from("reference_trips").update({ payload: out }).eq("id", TRIP_ID);
  if (upErr) throw new Error("upsert failed: " + upErr.message);
  console.log(`\n★ WROTE baked payload to reference_trips/${TRIP_ID} on [${label}] ${ref}`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
