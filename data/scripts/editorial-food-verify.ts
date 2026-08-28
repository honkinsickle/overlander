/**
 * Live-verify editorial_food content on TEST via the corridor RPC AND
 * Typesense places_test.
 */
import { getDb } from "../ingestion/lib/db.ts";
import Typesense from "typesense";
const db = getDb();

if (process.env.SUPABASE_URL !== "https://znldzjdatkogdktymtvi.supabase.co") {
  console.error("Refusing — not TEST."); process.exit(1);
}

const CORRIDORS: ReadonlyArray<{ label: string; route: { type: "LineString"; coordinates: [number, number][] } }> = [
  { label: "Malibu → Los Angeles (Neptune's Net, Apple Pan)", route: { type: "LineString", coordinates: [[-118.83, 34.02], [-118.42, 34.02]] } },
  { label: "Big Sur ↔ Coalinga (Nepenthe, Harris Ranch)", route: { type: "LineString", coordinates: [[-121.76, 36.22], [-120.24, 36.26]] } },
  { label: "Mojave (Peggy Sue's, Roy's, Mad Greek)", route: { type: "LineString", coordinates: [[-116.88, 34.90], [-115.74, 34.56]] } },
  { label: "Central Coast (Cambria → Cayucos → Morro Bay)", route: { type: "LineString", coordinates: [[-121.08, 35.56], [-120.86, 35.39]] } },
];

type Row = { canonical_name: string; primary_category: string; description: string | null; nps_photo_url: string | null; photo_credit: string | null; attribution: Record<string, string> | null };

async function verifyCorridors() {
  console.log("=".repeat(60)); console.log("Corridor RPC verify (TEST)"); console.log("=".repeat(60));
  for (const c of CORRIDORS) {
    console.log(`\n── ${c.label} ──`);
    const r = await db.rpc("pois_along_corridor", { p_route: c.route, p_buffer_m: 16000, p_categories: null });
    if (r.error) { console.log(`  RPC failed`); continue; }
    const rows = (r.data ?? []) as Row[];
    const ef = rows.filter(row => row.attribution?.description === "editorial_food");
    const efPhoto = ef.filter(row => row.nps_photo_url != null);
    console.log(`  total rows: ${rows.length}   editorial_food desc: ${ef.length}   with photo: ${efPhoto.length}`);
    for (const row of ef.slice(0, 3)) {
      console.log(`    ${row.nps_photo_url ? "📸" : "  "} ${row.canonical_name} [${row.primary_category}]`);
      console.log(`       ${(row.description ?? "").slice(0, 90)}…`);
    }
  }
}

async function verifyTypesense() {
  console.log("\n" + "=".repeat(60)); console.log("Typesense verify (places_test)"); console.log("=".repeat(60));
  const client = new Typesense.Client({
    nodes: [{ host: process.env.TYPESENSE_HOST!, port: Number(process.env.TYPESENSE_PORT!), protocol: process.env.TYPESENSE_PROTOCOL! }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 15,
  });
  const probes = ["Neptune's Net", "Apple Pan", "Peggy Sue's", "The Mad Greek", "Mel's Drive-In", "Nepenthe", "Harris Ranch", "Alien Fresh Jerky", "Ikeda's", "Buck Owens"];
  for (const q of probes) {
    const r = await client.collections("places_test").documents().search({ q, query_by: "canonical_name,alternative_names,description", query_by_weights: "4,2,1", per_page: 3 });
    const hits = (r.hits ?? []).map(h => h.document as { canonical_name: string; primary_category: string; description?: string; photo_url?: string; overlander_tags?: string[] });
    const isEditorial = hits.find(h => h.overlander_tags?.includes("editorial_food"));
    console.log(`  ${isEditorial ? "✓" : "✗"} ${q.padEnd(25)} hits=${r.found}${isEditorial ? `   photo=${isEditorial.photo_url ? "y" : "N"}` : ""}`);
    if (isEditorial) console.log(`     ${isEditorial.canonical_name} — ${(isEditorial.description ?? "").slice(0, 80)}…`);
  }
}

async function main() {
  await verifyCorridors();
  await verifyTypesense();
}
main().catch(e => { console.error(e); process.exit(1); });
