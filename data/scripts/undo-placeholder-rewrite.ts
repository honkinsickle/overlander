/** TEST-only: undo the placeholder rewrite. Consumes /tmp/rewrite-mapping.json
 *  and reverses each row:
 *    1. UPDATE source_record.master_place_id = NULL (unlink)
 *    2. DELETE master_place (ON DELETE CASCADE drops the confirmed
 *       place_match automatically)
 *    3. INSERT pending place_match restoring the original (SR, old MP)
 *       row with recorded score components
 *
 *  Modes:
 *    --dry-run   : validate the mapping file + report what would be undone
 *    (default)   : apply the reversal
 *
 *  category_compatibility is not stored in the mapping (recoverable from
 *  the dry-run JSON but the dry-run classification path only recorded
 *  what came off the persisted place_match row — it uses the same value
 *  the original scoring path used, so 1.0 is the honest default for
 *  restored pending rows on dispersed_camping ↔ dispersed_camping pairs
 *  which is what every UT flip was). If you need the exact original
 *  category_compatibility, cross-reference /tmp/dryrun-classification.json. */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

interface MappingRow {
  source_record_id: string;
  old_place_match_id: string;
  old_master_place_id: string;
  old_score_components: {
    distance_meters: number;
    name_similarity: number;
    category_compatibility: number | null;
    combined_confidence: number;
  };
  new_master_place_id: string;
  seed_name: string;
  seed_category: string;
}

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[env] TEST ${ref}  ${dryRun ? "(DRY RUN)" : "(APPLY UNDO)"}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  const rows = JSON.parse(readFileSync("/tmp/rewrite-mapping.json", "utf8")) as MappingRow[];
  console.log(`Loaded ${rows.length} rows from /tmp/rewrite-mapping.json`);

  if (dryRun) {
    console.log(`\n(DRY RUN — would reverse ${rows.length} rewrites)`);
    return;
  }

  let unlinked = 0;
  let mpDeleted = 0;
  let pmRestored = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    // 1. Unlink source_records
    const srIds = chunk.map((r) => r.source_record_id);
    const u = await db.from("source_record").update({ master_place_id: null }).in("id", srIds).select("id");
    if (u.error) { errors.push(`unlink chunk ${i}: ${u.error.message}`); continue; }
    unlinked += u.data?.length ?? 0;

    // 2. Delete master_places (cascades confirmed place_match)
    const newMpIds = chunk.map((r) => r.new_master_place_id);
    const d = await db.from("master_place").delete({ count: "exact" }).in("id", newMpIds);
    if (d.error) { errors.push(`mp delete chunk ${i}: ${d.error.message}`); continue; }
    mpDeleted += d.count ?? 0;

    // 3. Restore pending place_match rows
    const inserts = chunk.map((r) => ({
      source_record_id: r.source_record_id,
      master_place_id: r.old_master_place_id,
      distance_meters: r.old_score_components.distance_meters,
      name_similarity: r.old_score_components.name_similarity,
      category_compatibility: r.old_score_components.category_compatibility ?? 1.0,
      combined_confidence: r.old_score_components.combined_confidence,
      match_method: "deterministic",
      status: "pending",
    }));
    const ins = await db.from("place_match").insert(inserts).select("id");
    if (ins.error) { errors.push(`pm insert chunk ${i}: ${ins.error.message}`); continue; }
    pmRestored += ins.data?.length ?? 0;
  }

  console.log(`\n═══ Undo complete ═══`);
  console.log(`  source_records unlinked : ${unlinked}`);
  console.log(`  master_places deleted   : ${mpDeleted}`);
  console.log(`  place_match restored    : ${pmRestored}`);
  console.log(`  errors                  : ${errors.length}`);
  if (errors.length > 0) for (const e of errors) console.log(`    ${e}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
