/** TEST-only: baseline for master_place + place_match (manual_review queue). */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  const mpTotal = await db.from("master_place").select("id", { count: "exact", head: true });
  const mpSearchable = await db.from("master_place").select("id", { count: "exact", head: true }).eq("is_searchable", true);
  const mpMaxUpdated = await db.from("master_place").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();

  console.log("master_place.total          :", mpTotal.count);
  console.log("master_place.is_searchable  :", mpSearchable.count);
  console.log("master_place.max(updated_at):", mpMaxUpdated.data?.updated_at ?? "(null)");

  // master_place by kind
  const perKind: Record<string, number> = {};
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const p = await db.from("master_place").select("id, kind").order("id").range(from, from + pageSize - 1);
    if (p.error) { console.log("QUERY FAILED:", p); break; }
    for (const r of (p.data ?? []) as { id: string; kind: string | null }[]) {
      const k = r.kind ?? "(null)";
      perKind[k] = (perKind[k] ?? 0) + 1;
    }
    if ((p.data?.length ?? 0) < pageSize) break;
    from += pageSize;
  }
  console.log("\nmaster_place by kind:");
  for (const [k, v] of Object.entries(perKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }

  // place_match manual_review queue
  const pmTotal = await db.from("place_match").select("id", { count: "exact", head: true });
  const pmReview = await db.from("place_match").select("id", { count: "exact", head: true }).eq("outcome", "manual_review");
  console.log("\nplace_match.total           :", pmTotal.count);
  console.log("place_match.manual_review   :", pmReview.count);

  // source_record link status
  const srLinked = await db.from("source_record").select("id", { count: "exact", head: true }).not("master_place_id", "is", null);
  const srUnlinked = await db.from("source_record").select("id", { count: "exact", head: true }).is("master_place_id", null);
  console.log("source_record.linked        :", srLinked.count);
  console.log("source_record.unlinked      :", srUnlinked.count);
}
main().catch((e) => { console.error(e); process.exit(1); });
