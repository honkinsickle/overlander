/** TEST-only: simulate a partial apply for the resume test.
 *
 *  Takes N recent OSM camping SRs from the last ingest, deletes their
 *  place_match rows, deletes the master_place rows they were linked to
 *  (only when the MP has no other linked SRs — safe unlink), and unlinks
 *  the SRs (sets master_place_id = NULL). Result: N SRs are back in the
 *  "unresolved" state that --apply-from-cache expects.
 *
 *  Prints the affected SR ids so the test harness can verify. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const N = Number(process.argv[2] ?? "10");
  console.log(`[env] TEST ${ref}  simulating partial apply for N=${N} SRs\n`);

  // Pick recent OSM camping SRs that are currently linked.
  const recent = await db
    .from("source_record")
    .select("id, master_place_id, name")
    .eq("source_id", "osm")
    .in("inferred_category", ["dispersed_camping", "campground"])
    .not("master_place_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(N);
  if (recent.error || !recent.data) { console.log("QUERY FAILED:", recent); return; }
  const rows = recent.data as { id: string; master_place_id: string; name: string }[];
  console.log(`Selected ${rows.length} SRs to unlink.`);

  for (const r of rows) {
    // Count other active SRs on this MP; only safe to delete MP if it's this SR alone.
    const other = await db
      .from("source_record")
      .select("id", { count: "exact", head: true })
      .eq("master_place_id", r.master_place_id)
      .neq("id", r.id);
    if (other.error) { console.log(`  ${r.id}: other-count query failed:`, other); continue; }
    const canDeleteMp = (other.count ?? 0) === 0;

    // Delete place_match rows for this SR.
    const dpm = await db.from("place_match").delete().eq("source_record_id", r.id).select("id");
    if (dpm.error) { console.log(`  ${r.id}: pm delete failed:`, dpm); continue; }
    // Unlink SR.
    const upd = await db.from("source_record").update({ master_place_id: null }).eq("id", r.id).select("id");
    if (upd.error) { console.log(`  ${r.id}: unlink failed:`, upd); continue; }
    if (canDeleteMp) {
      const dmp = await db.from("master_place").delete().eq("id", r.master_place_id).select("id");
      if (dmp.error) { console.log(`  ${r.id}: mp delete failed:`, dmp); continue; }
    }
    console.log(`  ${r.id.slice(0, 8)}… "${r.name.slice(0, 30)}" → pm:${dpm.data?.length ?? 0} sr:unlinked mp_deleted:${canDeleteMp}`);
  }
  console.log(`\nDone. ${rows.length} SRs are now in an unresolved state (master_place_id=NULL, no place_match row).`);
  console.log(`Next: run \`npm run -w data materialize -- --skip-sync --apply-from-cache\` to resume from cache.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
