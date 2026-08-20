/**
 * Verify General Grant + Buck Rock are still pending (untouched by 3.A)
 * and reconcile SR-level accounting to 2,866.
 */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();

  const heldNames = ["General Grant", "Buck Rock"];
  for (const nm of heldNames) {
    const r = await db
      .from("source_record")
      .select("id, name, master_place_id, place_match(id, status, resolved_by, master_place(canonical_name))")
      .eq("source_id", "atlas_oddities")
      .eq("name", nm)
      .maybeSingle();
    if (r.error || !r.data) {
      console.log(`${nm}: NOT FOUND`);
      continue;
    }
    const pms: any[] = (r.data as any).place_match ?? [];
    console.log(`${nm}: sr.master_place_id=${(r.data as any).master_place_id}  pm_count=${pms.length}`);
    for (const pm of pms) {
      console.log(`   pm ${pm.id} status=${pm.status} resolved_by=${pm.resolved_by} → mp='${pm.master_place?.canonical_name}'`);
    }
  }

  const [totalSr, pendPm, confPm, rejPm, linked, unlinked] = await Promise.all([
    db.from("source_record").select("id", { count: "exact", head: true }).eq("source_id", "atlas_oddities"),
    db.from("place_match").select("id, source_record!inner(source_id)", { count: "exact", head: true })
      .eq("status", "pending").eq("source_record.source_id", "atlas_oddities"),
    db.from("place_match").select("id, source_record!inner(source_id)", { count: "exact", head: true })
      .eq("status", "confirmed").eq("source_record.source_id", "atlas_oddities"),
    db.from("place_match").select("id, source_record!inner(source_id)", { count: "exact", head: true })
      .eq("status", "rejected").eq("source_record.source_id", "atlas_oddities"),
    db.from("source_record").select("id", { count: "exact", head: true })
      .eq("source_id", "atlas_oddities").not("master_place_id", "is", null),
    db.from("source_record").select("id", { count: "exact", head: true })
      .eq("source_id", "atlas_oddities").is("master_place_id", null),
  ]);

  const unlinkedSrs = await db
    .from("source_record")
    .select("id, place_match(id)")
    .eq("source_id", "atlas_oddities")
    .is("master_place_id", null);
  const noPm = (unlinkedSrs.data ?? []).filter((r: any) => (r.place_match ?? []).length === 0).length;

  console.log(`\n--- SR-level accounting ---`);
  console.log(`total atlas_oddities SR : ${totalSr.count}`);
  console.log(`  linked (master_place_id NOT NULL): ${linked.count}`);
  console.log(`  unlinked                         : ${unlinked.count}`);
  console.log(`    of which have a pending place_match : ${pendPm.count}`);
  console.log(`    of which have NO place_match at all : ${noPm}   ← Cloudflare-stranded`);
  console.log(`\n--- place_match by status (atlas_oddities SR) ---`);
  console.log(`confirmed: ${confPm.count}`);
  console.log(`pending  : ${pendPm.count}`);
  console.log(`rejected : ${rejPm.count}`);
  const linkedN = linked.count ?? 0;
  const pendingN = pendPm.count ?? 0;
  const partition = linkedN + pendingN + noPm;
  console.log(`\nSR partition: linked ${linkedN} + pending ${pendingN} + Cloudflare-stranded ${noPm} = ${partition}  (expect 2866: ${partition === 2866 ? "OK" : "MISMATCH"})`);
}

main().catch((err) => {
  console.error("verify: fatal", err);
  process.exit(1);
});
