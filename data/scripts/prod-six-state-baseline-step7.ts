/** Read-only PROD baseline for Part 2 step 7. Zero writes.
 *  Records: master_place total, searchable non-land_status,
 *  max(updated_at), active source_record count, and a UTC timestamp
 *  captured at read time (client-side wall clock — noted alongside). */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearchNonLand = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("searchable", true)
    .neq("kind", "land_status");
  const mpMaxUpdated = await db
    .from("master_place")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const srActive = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  console.log("master_place.total                :", mpTotal.count, mpTotal.error?.message ?? "");
  console.log("master_place.searchable_non_land  :", mpSearchNonLand.count, mpSearchNonLand.error?.message ?? "");
  console.log("master_place.max(updated_at)      :", mpMaxUpdated.data?.updated_at, mpMaxUpdated.error?.message ?? "");
  console.log("source_record.active_count        :", srActive.count, srActive.error?.message ?? "");
}
main().catch((e) => { console.error(e); process.exit(1); });
