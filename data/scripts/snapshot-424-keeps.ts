/** TEST-only: snapshot the 424 keeps to /tmp/keeps-before.json so a post-
 *  rewrite comparison can verify byte-identical UUIDs + target MPs +
 *  score components. */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const all = JSON.parse(readFileSync("/tmp/dryrun-classification.json", "utf8")) as any[];
  const keeps = all.filter((r) => r.new_classification !== "new_master_place");
  console.log(`${keeps.length} keeps in JSON`);
  const ids = keeps.map((k) => k.place_match_id);
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const p = await db.from("place_match").select("id, source_record_id, master_place_id, distance_meters, name_similarity, category_compatibility, combined_confidence, match_method, status").in("id", ids.slice(i, i + 100));
    if (p.error) { console.log("FAILED:", p); return; }
    rows.push(...(p.data ?? []));
  }
  writeFileSync("/tmp/keeps-before.json", JSON.stringify(rows.sort((a, b) => a.id.localeCompare(b.id)), null, 2));
  console.log(`Wrote ${rows.length} snapshot rows to /tmp/keeps-before.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
