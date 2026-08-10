/** PROD Part 2, Step 1 — baseline snapshot. Read-only. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearch = await db.from("master_place").select("id", { count: "exact", head: true }).eq("is_searchable", true);
  const mpMaxUpd = await db.from("master_place").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const srActive = await db.from("source_record").select("id", { count: "exact", head: true }).eq("is_active", true);
  const srTotal = await db.from("source_record").select("id", { count: "exact", head: true });
  if (mpTotal.error || mpSearch.error || srActive.error || srTotal.error) { console.log("QUERY FAILED", { mpTotal, mpSearch, srActive, srTotal }); return; }

  console.log("master_place.total                :", mpTotal.count);
  console.log("master_place.is_searchable=true   :", mpSearch.count);
  console.log("  (searchable non-land_status)    :", mpSearch.count, "— per prior baseline PROD has 0 land_status MPs");
  console.log("master_place.max(updated_at)      :", mpMaxUpd.data?.updated_at);
  console.log("source_record.total               :", srTotal.count);
  console.log("source_record.is_active=true      :", srActive.count);
}
main().catch((e) => { console.error(e); process.exit(1); });
