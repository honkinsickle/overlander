/** Final PROD baseline for Part 2 step 7. Uses is_searchable (correct column
 *  name; earlier attempt used 'searchable' which does not exist). Read-only. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearch = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("is_searchable", true);
  const mpNonSearch = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("is_searchable", false);
  const mpMaxUpdated = await db
    .from("master_place")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const srTotal = await db.from("source_record").select("id", { count: "exact", head: true });
  const srActive = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  console.log("master_place.total                :", mpTotal.count);
  console.log("master_place.is_searchable=true   :", mpSearch.count);
  console.log("master_place.is_searchable=false  :", mpNonSearch.count, "(PADUS land-status polygons)");
  console.log("master_place.max(updated_at)      :", mpMaxUpdated.data?.updated_at);
  console.log("source_record.total               :", srTotal.count);
  console.log("source_record.is_active=true      :", srActive.count);
}
main().catch((e) => { console.error(e); process.exit(1); });
