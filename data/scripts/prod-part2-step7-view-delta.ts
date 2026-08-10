/** PROD Part 2, Steps 7-8 — view row count + max(updated_at) boundary check. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  const view = await db.from("master_place_search_export").select("id", { count: "exact", head: true });
  if (view.error) { console.log("VIEW COUNT FAILED:", view); return; }
  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearch = await db.from("master_place").select("id", { count: "exact", head: true }).eq("is_searchable", true);
  console.log("═══ View row delta ═══");
  console.log(`  master_place.total                    : ${mpTotal.count}`);
  console.log(`  master_place.is_searchable=true       : ${mpSearch.count}`);
  console.log(`  master_place_search_export (post-trim): ${view.count}`);
  console.log(`  predicted                             : ~9,300`);
  console.log(`  delta from pre-trim view (~13,629)    : ${(mpSearch.count ?? 0) - (view.count ?? 0)} rows removed by view predicates`);

  console.log(`\n═══ max(updated_at) boundary check ═══`);
  const mpMaxUpd = await db.from("master_place").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  console.log(`  master_place.max(updated_at)          : ${mpMaxUpd.data?.updated_at}`);
  console.log(`  baseline (2026-08-10T06:11:26Z pre-op): 2026-07-12T19:57:09.505571+00:00`);
  console.log(`  ↑ if unchanged, no master_place was recomputed (correct — this trim doesn't call recompute_master_place, only source_record.is_active + view predicates changed).`);

  // Also count how many source_records changed updated_at recently
  const srRecent = await db.from("source_record").select("id", { count: "exact", head: true }).gte("updated_at", "2026-08-10T06:14:00Z");
  console.log(`\n  source_record.updated_at >= 2026-08-10T06:14Z : ${srRecent.count} (should equal 8,067 — the deactivated rows)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
