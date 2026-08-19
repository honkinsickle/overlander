/**
 * READ-ONLY corpus-wide counts, for before/after comparison around a targeted
 * mutation. Prints a stable, diffable block: totals, source_record by
 * source_id, osm source_record by inferred_category, and master_place by
 * primary_category. TEST-only.
 *
 * Usage: npx tsx --env-file=.env scripts/corpus-baseline-snapshot.ts > before.txt
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  async function count(table: string, apply: (q: any) => any = (q) => q): Promise<number> {
    const r = await apply(db.from(table).select("*", { count: "exact", head: true }));
    // CLAUDE.md 2026-08-10: a null count is a FAILURE SIGNAL, not a data value.
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count failed on ${table}`); }
    return r.count as number;
  }

  const page = 1000;
  async function pageAll(table: string, cols: string, apply: (q: any) => any): Promise<any[]> {
    const out: any[] = [];
    let from = 0;
    while (true) {
      const r = await apply(db.from(table).select(cols)).order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan failed on ${table}`); }
      out.push(...r.data);
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  }

  console.log(`[env] TEST ${ref} — READ-ONLY`);
  console.log(`master_place total                : ${await count("master_place")}`);
  console.log(`source_record total               : ${await count("source_record")}`);
  console.log(`source_record is_active=true      : ${await count("source_record", (q) => q.eq("is_active", true))}`);
  console.log(`source_record is_active=false     : ${await count("source_record", (q) => q.eq("is_active", false))}`);
  console.log(`place_match total                 : ${await count("place_match")}`);

  const srs = await pageAll("source_record", "source_id, inferred_category, is_active", (q) => q);
  const bySource = new Map<string, number>();
  for (const r of srs) bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
  console.log(`\nsource_record by source_id:`);
  for (const [k, v] of [...bySource.entries()].sort()) console.log(`  ${k.padEnd(18)} ${String(v).padStart(7)}`);

  const osmCat = new Map<string, number>();
  for (const r of srs.filter((x) => x.source_id === "osm")) {
    const k = r.inferred_category ?? "(null)";
    osmCat.set(k, (osmCat.get(k) ?? 0) + 1);
  }
  console.log(`\nosm source_record by inferred_category:`);
  for (const [k, v] of [...osmCat.entries()].sort()) console.log(`  ${k.padEnd(24)} ${String(v).padStart(7)}`);

  const mps = await pageAll("master_place", "primary_category, source_count, is_searchable", (q) => q);
  const mpCat = new Map<string, number>();
  for (const m of mps) mpCat.set(m.primary_category ?? "(null)", (mpCat.get(m.primary_category ?? "(null)") ?? 0) + 1);
  console.log(`\nmaster_place by primary_category:`);
  for (const [k, v] of [...mpCat.entries()].sort()) console.log(`  ${k.padEnd(24)} ${String(v).padStart(7)}`);
  console.log(`\nmaster_place source_count=0       : ${mps.filter((m) => m.source_count === 0).length}`);
  console.log(`master_place is_searchable=true   : ${mps.filter((m) => m.is_searchable).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
