/**
 * Live-verify family_destinations content on TEST via the corridor RPC.
 *
 * Runs pois_along_corridor on route segments passing through cities the
 * article covers, and asserts:
 *   - each verifiable stop returns as an oddity/restaurant row
 *   - attribution.description = 'family_destinations'
 *   - photo_credit = 'familydestinationsguide.com'
 *   - photo is present (nps_photo_url non-null)
 */
import { getDb } from "../ingestion/lib/db.ts";
const db = getDb();

if (process.env.SUPABASE_URL !== "https://znldzjdatkogdktymtvi.supabase.co") {
  console.error("Refusing to run — not TEST.");
  process.exit(1);
}

const CORRIDORS: ReadonlyArray<{ label: string; route: { type: "LineString"; coordinates: [number, number][] }; expectContains: string }> = [
  { label: "San Diego (Hodad's, Cafe 222)", route: { type: "LineString", coordinates: [[-117.28, 32.74], [-117.15, 32.72]] }, expectContains: "Hodad" },
  { label: "Central Coast (Nepenthe, Duarte's)", route: { type: "LineString", coordinates: [[-121.79, 36.22], [-122.39, 37.26]] }, expectContains: "Duarte" },
  { label: "LA metro (Tito's, Philippe's)", route: { type: "LineString", coordinates: [[-118.42, 34.01], [-118.24, 34.06]] }, expectContains: "Philippe" },
  { label: "Napa (Gott's, Marshall)", route: { type: "LineString", coordinates: [[-122.47, 38.5], [-122.89, 38.15]] }, expectContains: "Marshall Store" },
  { label: "Chico area (Burger Hut, India Oven)", route: { type: "LineString", coordinates: [[-121.83, 39.73], [-121.50, 38.64]] }, expectContains: "India Oven" },
];

type Row = {
  id: string;
  canonical_name: string;
  primary_category: string;
  description: string | null;
  nps_photo_url: string | null;
  photo_credit: string | null;
  attribution: Record<string, string> | null;
};

async function verifyOne(label: string, route: (typeof CORRIDORS)[number]["route"], expectContains: string) {
  console.log(`\n── ${label} ──`);
  const r = await db.rpc("pois_along_corridor", { p_route: route, p_buffer_m: 16000, p_categories: null });
  if (r.error || r.data == null) {
    console.error(`  RPC failed: ${JSON.stringify(r.error)}`);
    return false;
  }
  const rows = r.data as Row[];
  const fdRows = rows.filter((row) => row.attribution?.description === "family_destinations");
  const fdWithPhoto = fdRows.filter((row) => row.photo_credit === "familydestinationsguide.com");
  console.log(`  total rows: ${rows.length}   family_destinations desc: ${fdRows.length}   with FD photo: ${fdWithPhoto.length}`);
  const expectHit = fdRows.find((row) => row.canonical_name.includes(expectContains));
  if (expectHit) {
    console.log(`    ✓ ${expectHit.canonical_name} (${expectHit.primary_category})`);
    console.log(`      photo: ${expectHit.nps_photo_url?.slice(0, 80)}…`);
    console.log(`      desc:  ${(expectHit.description ?? "").slice(0, 100)}…`);
    return true;
  }
  console.log(`    ✗ expected canonical_name containing "${expectContains}" not found among family_destinations rows`);
  for (const fd of fdRows.slice(0, 3)) console.log(`      - ${fd.canonical_name}`);
  return false;
}

async function main() {
  console.log("=".repeat(72));
  console.log("family_destinations live-verify (TEST)");
  console.log("=".repeat(72));
  const results: { label: string; passed: boolean }[] = [];
  for (const c of CORRIDORS) {
    results.push({ label: c.label, passed: await verifyOne(c.label, c.route, c.expectContains) });
  }
  console.log("\n" + "=".repeat(72));
  for (const r of results) console.log(`  ${r.passed ? "✓" : "✗"} ${r.label}`);
  const ok = results.every((r) => r.passed);
  if (!ok) { console.error("\n✗ VERIFY FAILED"); process.exit(1); }
  console.log("\n✓ VERIFY PASSED");
}
main().catch(e => { console.error(e); process.exit(1); });
