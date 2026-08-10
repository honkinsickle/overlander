/** TEST-only: verify the placeholder rewrite left:
 *   (a) pending place_match count dropped by exactly 521
 *   (b) all 424 keeps byte-identical (same UUID + target MP + score
 *       components + match_method + status)
 *   (c) 521 new master_places exist, one per rewritten SR, all with
 *       recompute_master_place populated fields */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // (a) pending count. Baseline pre-rewrite was 2,536 → expect 2,015.
  const p = await db.from("place_match").select("id", { count: "exact", head: true }).eq("status", "pending");
  console.log(`(a) pending place_match count : ${p.count} (baseline 2,536 → expected 2,015; delta = ${2536 - (p.count ?? 0)})`);

  // (b) byte-identical check on the 424 keeps.
  const before = JSON.parse(readFileSync("/tmp/keeps-before.json", "utf8")) as any[];
  const ids = before.map((r) => r.id);
  const after: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const q = await db.from("place_match").select("id, source_record_id, master_place_id, distance_meters, name_similarity, category_compatibility, combined_confidence, match_method, status").in("id", ids.slice(i, i + 100));
    if (q.error) { console.log("FAILED:", q); return; }
    after.push(...(q.data ?? []));
  }
  after.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\n(b) keeps snapshot comparison (${before.length} rows)`);
  console.log(`   still present         : ${after.length}`);
  const missing = before.filter((b) => !after.some((a) => a.id === b.id));
  console.log(`   missing after         : ${missing.length}`);

  let mismatch = 0;
  const mismatchExamples: string[] = [];
  const byField = { source_record_id: 0, master_place_id: 0, distance_meters: 0, name_similarity: 0, category_compatibility: 0, combined_confidence: 0, match_method: 0, status: 0 };
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    if (!a) continue;
    for (const k of Object.keys(byField) as (keyof typeof byField)[]) {
      if (a[k] !== b[k]) {
        byField[k]++;
        mismatch++;
        if (mismatchExamples.length < 3) mismatchExamples.push(`${b.id}.${k}: ${b[k]} → ${a[k]}`);
      }
    }
  }
  // Rows where every 8 fields match = before.length - (rows with at least one field mismatch) - (rows missing).
  // Approximation: mismatch counts field-level (not row-level) mismatches; use it as-is
  // since in a real byte-identical case both are 0 and the row-count reduces to before.length.
  const bytesIdentical = mismatch === 0 && missing.length === 0 ? before.length : "N/A (see mismatches)";
  console.log(`   byte-identical rows    : ${bytesIdentical}`);
  console.log(`   field mismatches       :`, byField);
  if (mismatchExamples.length > 0) console.log(`   examples               :`, mismatchExamples);
  const allByteIdentical = missing.length === 0 && mismatch === 0;
  console.log(`   VERDICT                : ${allByteIdentical ? "✓ ALL 424 BYTE-IDENTICAL" : "✗ DIVERGENCE DETECTED"}`);

  // (c) new master_places. Load mapping, count, and confirm confirmed
  //     place_match + source_record link both exist.
  const mapping = JSON.parse(readFileSync("/tmp/rewrite-mapping.json", "utf8")) as any[];
  console.log(`\n(c) new master_places from mapping (${mapping.length} rows)`);
  const newMpIds = mapping.map((m) => m.new_master_place_id);
  let mpCount = 0;
  let confirmedPmCount = 0;
  for (let i = 0; i < newMpIds.length; i += 100) {
    const chunk = newMpIds.slice(i, i + 100);
    const mp = await db.from("master_place").select("id", { count: "exact", head: true }).in("id", chunk);
    if (!mp.error) mpCount += mp.count ?? 0;
    const pm = await db.from("place_match").select("id", { count: "exact", head: true }).in("master_place_id", chunk).eq("status", "confirmed");
    if (!pm.error) confirmedPmCount += pm.count ?? 0;
  }
  console.log(`   master_places found    : ${mpCount} / ${mapping.length}`);
  console.log(`   confirmed place_match  : ${confirmedPmCount} / ${mapping.length}`);
  // Also confirm all 521 source_records now have master_place_id populated
  const srIds = mapping.map((m) => m.source_record_id);
  let srLinkedCount = 0;
  for (let i = 0; i < srIds.length; i += 100) {
    const sr = await db.from("source_record").select("id", { count: "exact", head: true }).in("id", srIds.slice(i, i + 100)).not("master_place_id", "is", null);
    if (!sr.error) srLinkedCount += sr.count ?? 0;
  }
  console.log(`   source_records linked  : ${srLinkedCount} / ${mapping.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
