import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const total = await db.from("source_record").select("id", { count: "exact", head: true }).eq("source_id", "osm");
  console.log("osm total:", total.count);
}
main().catch((e) => { console.error(e); process.exit(1); });
