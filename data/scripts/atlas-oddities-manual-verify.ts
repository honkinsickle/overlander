/**
 * Live-verify for the AO manual content ingest.
 *
 * Calls the real `pois_along_corridor` RPC on TEST with a route through an
 * AO-dense area (Portland, OR — 66 AO places per the OR CSV README), then
 * asserts that AT LEAST ONE row in the result carries an AO-attributed
 * description AND an AO photo url. The RPC is the read path
 * trip generation uses for browse tiles (via
 * `fetchFederatedPois` → `mapMasterPlaceRow` in
 * web/src/lib/trip-browse/federated.ts), so an assertion here confirms
 * end-to-end wiring, not just DB shape.
 *
 * Also prints a sample confirmed row.
 *
 * Run:
 *   npx tsx --env-file=.env scripts/atlas-oddities-manual-verify.ts
 */

import { getDb } from "../ingestion/lib/db.ts";

const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";
if (process.env.SUPABASE_URL !== TEST_URL) {
  console.error(`Refusing to run — SUPABASE_URL is not TEST. Got: ${process.env.SUPABASE_URL}`);
  process.exit(1);
}
const db = getDb();

// Short lines through AO-dense areas — one per state batch, to verify
// that both PR #309 (OR/CA/LA) and this pass (WA/AZ/UT/NV) surface AO
// content end-to-end via the RPC that trip generation reads. Buffer
// 16km so we sweep a wide swath. A null result on ANY of these would
// flag a wiring failure.
const ROUTES: ReadonlyArray<{ label: string; route: { type: "LineString"; coordinates: [number, number][] } }> = [
  {
    label: "Portland OR (wave 1)",
    route: { type: "LineString", coordinates: [[-122.7000, 45.5150], [-122.6300, 45.5350]] },
  },
  {
    label: "Seattle WA (wave 2)",
    route: { type: "LineString", coordinates: [[-122.3500, 47.6000], [-122.3000, 47.6300]] },
  },
  {
    label: "Phoenix AZ (wave 2)",
    route: { type: "LineString", coordinates: [[-112.1000, 33.4500], [-111.9500, 33.4700]] },
  },
  {
    label: "Salt Lake City UT (wave 2)",
    route: { type: "LineString", coordinates: [[-111.9000, 40.7500], [-111.8500, 40.7700]] },
  },
  {
    label: "Las Vegas NV (wave 2)",
    route: { type: "LineString", coordinates: [[-115.2000, 36.1500], [-115.1000, 36.1800]] },
  },
];

type Row = {
  id: string;
  canonical_name: string;
  primary_category: string;
  description: string | null;
  nps_photo_url: string | null;
  photo_credit: string | null;
  description_source: string | null;
  attribution: Record<string, string> | null;
};

async function verifyCorridor(label: string, route: { type: "LineString"; coordinates: [number, number][] }): Promise<boolean> {
  console.log(`\n── ${label} ──`);
  const r = await db.rpc("pois_along_corridor", {
    p_route: route,
    p_buffer_m: 16000,
    p_categories: null,
  });
  if (r.error || r.data == null) {
    console.error("QUERY FAILED (pois_along_corridor):", r);
    return false;
  }
  const rows = r.data as Row[];
  const withAoDesc = rows.filter((row) => row.attribution?.description === "atlas_oddities");
  const withAoPhotoCredit = rows.filter((row) => row.photo_credit === "Atlas Obscura");
  console.log(`  rows returned: ${rows.length}   AO description: ${withAoDesc.length}   AO photo: ${withAoPhotoCredit.length}`);
  const sample = rows.filter(
    (row) => row.attribution?.description === "atlas_oddities" && row.photo_credit === "Atlas Obscura",
  );
  for (const s of sample.slice(0, 2)) {
    console.log(`    - ${s.canonical_name} (${s.primary_category})`);
    console.log(`      ${(s.description ?? "").slice(0, 100).replace(/\n/g, " ")}…`);
  }
  return withAoDesc.length > 0 && withAoPhotoCredit.length > 0;
}

async function main() {
  console.log("=".repeat(72));
  console.log("AO manual content — LIVE VERIFY via pois_along_corridor");
  console.log("Target: TEST (", TEST_URL, ")");
  console.log("=".repeat(72));

  const results: { label: string; passed: boolean }[] = [];
  for (const { label, route } of ROUTES) {
    const passed = await verifyCorridor(label, route);
    results.push({ label, passed });
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.label}`);
  }
  const allPassed = results.every((r) => r.passed);
  if (!allPassed) {
    console.error("\n✗ VERIFY FAILED — one or more corridors did not surface AO content.");
    process.exit(1);
  }
  console.log("\n✓ VERIFY PASSED — AO descriptions and photos surface via pois_along_corridor in all corridors.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
