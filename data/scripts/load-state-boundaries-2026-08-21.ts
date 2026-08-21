/**
 * One-time data load for state_boundaries (migration 20260821010000).
 * Source: US Census Bureau TIGER/Line 2023 national state file
 * (https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip),
 * converted to GeoJSON via ogr2ogr (GDAL), filtered to the six states this
 * corpus targets. See the migration file for the full source/license note.
 *
 * Idempotent — load_state_boundary_geom() upserts on state_code.
 *
 * Run: cd data && npx tsx --env-file=.env scripts/load-state-boundaries-2026-08-21.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";

const STATE_CODES: Record<string, string> = {
  California: "CA", Oregon: "OR", Washington: "WA", Utah: "UT", Nevada: "NV", Arizona: "AZ",
};

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const gj = JSON.parse(fs.readFileSync(".context/six-states-tiger.geojson", "utf-8"));
  console.log(`Loaded ${gj.features.length} state features from the TIGER-derived GeoJSON.`);

  for (const f of gj.features) {
    const name = f.properties.NAME;
    const code = STATE_CODES[name];
    if (!code) { console.log(`  SKIP unrecognized state: ${name}`); continue; }
    const r = await db.rpc("load_state_boundary_geom", {
      p_state_code: code,
      p_state_name: name,
      p_geojson: f.geometry,
    });
    if (r.error) { console.log(`  FAILED ${code} (${name}):`, r.error); throw new Error(""); }
    console.log(`  loaded ${code} (${name}), geometry bytes=${JSON.stringify(f.geometry).length}`);
  }

  const check = await db.from("state_boundaries").select("state_code, state_name", { count: "exact" });
  console.log(`\nstate_boundaries now has ${check.count} rows:`, check.data?.map((r: any) => r.state_code).join(", "));
}
main().catch(e => { console.error(e); process.exit(1); });
