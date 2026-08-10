/** PROD Part 2, Step 3 — batched UPDATE source_record SET is_active=false
 *  for out-of-scope IDs. Chunks of 500. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  const ids = await db.rpc("list_out_of_scope_source_record_ids");
  if (ids.error) { console.log("LIST RPC FAILED:", ids); return; }
  const idArray = ids.data as string[];
  console.log(`Loaded ${idArray.length} out-of-scope IDs (expected 8,067).`);
  if (idArray.length !== 8067) console.log(`  ⚠ WARNING: count changed since step 2 (was 8,067)`);

  const CHUNK = 500;
  let totalDeactivated = 0;
  for (let i = 0; i < idArray.length; i += CHUNK) {
    const chunk = idArray.slice(i, i + CHUNK);
    // NOTE: supabase-js .update().select() takes only columns (no count/head opts).
    // Prior attempt passed { count:'exact', head:true } and got null in `count`.
    // Correct pattern: .select("id") returns the affected rows; use .length.
    const upd = await db.from("source_record").update({ is_active: false }).in("id", chunk).eq("is_active", true).select("id");
    if (upd.error) { console.log(`UPDATE FAILED at chunk ${i}:`, upd); return; }
    const n = upd.data?.length ?? 0;
    totalDeactivated += n;
    console.log(`  chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(idArray.length / CHUNK)}: chunk_size=${chunk.length} deactivated=${n}`);
  }
  console.log(`\n═══ Totals ═══`);
  console.log(`  IDs sent      : ${idArray.length}`);
  console.log(`  rows updated  : ${totalDeactivated}`);
  console.log(`  status        : ${totalDeactivated === idArray.length ? "✓ OK" : "✗ MISMATCH"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
