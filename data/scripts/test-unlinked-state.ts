/** TEST-only quick state check. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const total = await db.from("source_record").select("id", { count: "exact", head: true });
  const active = await db.from("source_record").select("id", { count: "exact", head: true }).eq("is_active", true);
  const linked = await db.from("source_record").select("id", { count: "exact", head: true }).eq("is_active", true).not("master_place_id", "is", null);
  const unlinked = await db.from("source_record").select("id", { count: "exact", head: true }).eq("is_active", true).is("master_place_id", null);
  const mp = await db.from("master_place").select("id", { count: "exact", head: true });
  console.log(`[env] TEST ${ref}`);
  console.log("source_record total    :", total.count);
  console.log("source_record active   :", active.count);
  console.log("source_record linked   :", linked.count);
  console.log("source_record unlinked :", unlinked.count, " ← the incremental input");
  console.log("master_place total     :", mp.count);
}
main().catch((e) => { console.error(e); process.exit(1); });
