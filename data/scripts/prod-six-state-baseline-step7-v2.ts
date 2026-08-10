/** Corrected step-7 baseline: filter is "searchable=true" (PROD has zero
 *  land_status rows per DATA_INVENTORY, so this equals total). Adds the
 *  land_status count as a sanity check.  Read-only. Zero writes. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearchable = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("searchable", true);
  const mpLandStatus = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("kind", "land_status");
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
  const srTotal = await db.from("source_record").select("id", { count: "exact", head: true });

  console.log("master_place.total                :", mpTotal.count, mpTotal.error?.message ?? "");
  console.log("master_place.searchable=true      :", mpSearchable.count, mpSearchable.error?.message ?? "");
  console.log("master_place.kind='land_status'   :", mpLandStatus.count, mpLandStatus.error?.message ?? "");
  console.log("master_place.searchable_non_land  :", (mpSearchable.count ?? 0) - (mpLandStatus.count ?? 0), "(derived)");
  console.log("master_place.max(updated_at)      :", mpMaxUpdated.data?.updated_at, mpMaxUpdated.error?.message ?? "");
  console.log("source_record.total               :", srTotal.count, srTotal.error?.message ?? "");
  console.log("source_record.active_count        :", srActive.count, srActive.error?.message ?? "");
}
main().catch((e) => { console.error(e); process.exit(1); });
