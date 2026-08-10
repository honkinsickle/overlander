/** TEST-only: spot-check 5 of the newly-created master_places from
 *  /tmp/rewrite-mapping.json. Confirms recompute_master_place populated
 *  the field-precedence columns (canonical_name, primary_category,
 *  attribution, description, amenities) beyond the seed values. */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const mapping = JSON.parse(readFileSync("/tmp/rewrite-mapping.json", "utf8")) as any[];
  // Deterministic 5-sample across the mapping (index 0, 25%, 50%, 75%, last).
  const N = mapping.length;
  const idx = [0, Math.floor(N * 0.25), Math.floor(N * 0.5), Math.floor(N * 0.75), N - 1];
  const sample = idx.map((i) => mapping[i]);
  const ids = sample.map((s) => s.new_master_place_id);
  const mp = await db.from("master_place").select("id, canonical_name, primary_category, geometry, attribution, description, amenities, is_searchable, created_at, updated_at").in("id", ids);
  if (mp.error) { console.log("FAILED:", mp); return; }
  const map = new Map<string, any>();
  for (const r of mp.data ?? []) map.set((r as any).id, r);
  console.log(`[env] TEST\n═══ 5 new master_places from the rewrite ═══`);
  for (const [i, s] of sample.entries()) {
    const m = map.get(s.new_master_place_id);
    if (!m) { console.log(`#${i+1}: MP ${s.new_master_place_id} NOT FOUND`); continue; }
    const coords = typeof m.geometry === "object" && m.geometry?.coordinates ? m.geometry.coordinates : null;
    console.log(`\n── #${i+1} ─────`);
    console.log(`  id             : ${m.id}`);
    console.log(`  canonical_name : "${m.canonical_name}"`);
    console.log(`  primary_cat    : ${m.primary_category}`);
    console.log(`  coords         : ${coords ? `[${coords[1]?.toFixed(5)}, ${coords[0]?.toFixed(5)}]` : "?"}`);
    console.log(`  is_searchable  : ${m.is_searchable}`);
    console.log(`  attribution    : ${JSON.stringify(m.attribution)}`);
    console.log(`  description    : ${m.description ?? "(null)"}`);
    console.log(`  amenities      : ${JSON.stringify(m.amenities)}`);
    console.log(`  created_at     : ${m.created_at}`);
    console.log(`  updated_at     : ${m.updated_at}`);
    console.log(`  seed was       : "${s.seed_name}" / ${s.seed_category}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
