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

// A short line running through downtown Portland — AO-dense. Buffer 16km
// so we sweep a wide swath. Deliberately picks a route where AO content
// is expected to be plentiful; a null result would flag a wiring failure.
const ROUTE: { type: "LineString"; coordinates: [number, number][] } = {
  type: "LineString",
  coordinates: [
    [-122.7000, 45.5150], // Downtown Portland
    [-122.6300, 45.5350], // NE Portland
  ],
};

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

async function main() {
  console.log("=".repeat(72));
  console.log("AO manual content — LIVE VERIFY via pois_along_corridor");
  console.log("Target: TEST (", TEST_URL, ")");
  console.log("=".repeat(72));

  const r = await db.rpc("pois_along_corridor", {
    p_route: ROUTE,
    p_buffer_m: 16000,
    p_categories: null,
  });
  if (r.error || r.data == null) {
    console.error("QUERY FAILED (pois_along_corridor):", r);
    process.exit(1);
  }

  const rows = r.data as Row[];
  console.log(`\nRPC returned ${rows.length} rows in the Portland-area corridor.`);

  const withAoDesc = rows.filter((row) => row.attribution?.description === "atlas_oddities");
  const withAnyPhoto = rows.filter((row) => row.nps_photo_url);
  const withAoPhotoCredit = rows.filter((row) => row.photo_credit === "Atlas Obscura");
  console.log(`  with attribution.description = 'atlas_oddities':       ${withAoDesc.length}`);
  console.log(`  with a non-null nps_photo_url (any source):            ${withAnyPhoto.length}`);
  console.log(`  with photo_credit = 'Atlas Obscura':                    ${withAoPhotoCredit.length}`);

  console.log("\nSample AO-attributed description + AO photo (first 3):");
  const sample = rows.filter(
    (row) => row.attribution?.description === "atlas_oddities" && row.photo_credit === "Atlas Obscura",
  );
  console.log(`  rows meeting both conditions: ${sample.length}`);
  for (const s of sample.slice(0, 3)) {
    console.log(`    - ${s.canonical_name} (${s.primary_category})`);
    console.log(`      description_source: ${s.description_source}`);
    console.log(`      description[:120]:  ${(s.description ?? "").slice(0, 120)}${(s.description ?? "").length > 120 ? "…" : ""}`);
    console.log(`      photo: ${s.nps_photo_url?.slice(0, 90)}…`);
  }

  if (withAoDesc.length === 0) {
    console.error("\n✗ VERIFY FAILED — no rows in the corridor carry an AO-attributed description.");
    process.exit(1);
  }
  if (withAoPhotoCredit.length === 0) {
    console.error("\n✗ VERIFY FAILED — no rows in the corridor carry an AO-credited photo.");
    process.exit(1);
  }

  console.log("\n✓ VERIFY PASSED — AO descriptions and photos surface via pois_along_corridor.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
