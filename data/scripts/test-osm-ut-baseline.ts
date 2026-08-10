/** TEST-only: baseline source_record shape for source_id='osm'.
 *  Captures counts + max updated_at + a per-category breakdown so the
 *  post-ingest delta is measurable at the database, not from log lines. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] TEST ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const total = await db.from("source_record").select("id", { count: "exact", head: true });
  const osm = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", "osm");
  const osmMaxUpdated = await db
    .from("source_record")
    .select("updated_at")
    .eq("source_id", "osm")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Category breakdown — a client-side reduce, since supabase-js doesn't
  // expose GROUP BY. We only need the category counts, so page id+category.
  const perCat: Record<string, number> = {};
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const page = await db
      .from("source_record")
      .select("id, inferred_category")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + pageSize - 1);
    if (page.error || !page.data) {
      console.log("QUERY FAILED:", page);
      break;
    }
    for (const r of page.data as { id: string; inferred_category: string | null }[]) {
      const k = r.inferred_category ?? "(null)";
      perCat[k] = (perCat[k] ?? 0) + 1;
    }
    if (page.data.length < pageSize) break;
    from += pageSize;
  }

  console.log("source_record total       :", total.count);
  console.log("source_record.source=osm  :", osm.count);
  console.log("osm.max(updated_at)       :", osmMaxUpdated.data?.updated_at ?? "(null)");
  console.log("\nosm by inferred_category:");
  for (const [k, v] of Object.entries(perCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
