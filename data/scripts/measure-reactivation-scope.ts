/**
 * READ-ONLY TEST measurement for the toilet / water / dump_station
 * reactivation. Establishes fresh: population per category BY SOURCE, active /
 * inactive split, and how many carry a real (templated or original)
 * description.
 *
 * Scope question this exists to answer: commit 47e00e4 deactivated these
 * categories across ANY source_id, not just osm. So "all osm rows" and "exactly
 * the set 47e00e4 deactivated" are not necessarily the same set — this reports
 * both so the difference is visible before anything is written.
 *
 * Also reports the other four categories 47e00e4 touched (viewpoint, fire_pit,
 * gas_station, public_land) so it can be proven afterwards that they were NOT
 * reactivated.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const REACTIVATE = ["toilet", "water", "dump_station"] as const;
const LEAVE_ALONE = ["viewpoint", "fire_pit", "gas_station", "public_land"] as const;

type Row = {
  source_id: string;
  inferred_category: string;
  is_active: boolean;
  master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  const page = 1000;
  async function scan(cat: string): Promise<Row[]> {
    const out: Row[] = [];
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("source_id, inferred_category, is_active, master_place_id, normalized_payload")
        .eq("inferred_category", cat).order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      out.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  }

  const hasDesc = (x: Row) => typeof x.normalized_payload?.description === "string" && (x.normalized_payload.description as string).trim().length > 0;

  console.log("TO REACTIVATE — every source_id, so the osm-vs-all difference is visible");
  let grandTotal = 0, grandInactive = 0, grandOsmInactive = 0;
  for (const cat of REACTIVATE) {
    const rows = await scan(cat);
    grandTotal += rows.length;
    const bySrc = new Map<string, Row[]>();
    for (const r of rows) bySrc.set(r.source_id, [...(bySrc.get(r.source_id) ?? []), r]);
    console.log(`\n  ${cat}: ${rows.length} source_records total`);
    for (const [src, rs] of [...bySrc.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const inactive = rs.filter((r) => !r.is_active).length;
      grandInactive += inactive;
      if (src === "osm") grandOsmInactive += inactive;
      console.log(`     ${src.padEnd(16)} total ${String(rs.length).padStart(5)}  active ${String(rs.filter((r) => r.is_active).length).padStart(5)}  inactive ${String(inactive).padStart(5)}  with description ${String(rs.filter(hasDesc).length).padStart(5)}`);
    }
    console.log(`     -> linked to a master_place: ${rows.filter((r) => r.master_place_id).length}   distinct MPs: ${new Set(rows.map((r) => r.master_place_id).filter(Boolean)).size}`);
    console.log(`     -> carrying a description  : ${rows.filter(hasDesc).length} / ${rows.length}`);
  }
  console.log(`\n  TOTALS: ${grandTotal} rows, ${grandInactive} inactive (osm-only inactive: ${grandOsmInactive})`);
  console.log(`  => non-osm inactive rows in these 3 categories: ${grandInactive - grandOsmInactive}`);

  console.log("\n\nMUST STAY DEACTIVATED — the other four categories 47e00e4 touched");
  for (const cat of LEAVE_ALONE) {
    const rows = await scan(cat);
    console.log(`  ${cat.padEnd(14)} total ${String(rows.length).padStart(6)}  active ${String(rows.filter((r) => r.is_active).length).padStart(6)}  inactive ${String(rows.filter((r) => !r.is_active).length).padStart(6)}`);
  }

  // Corpus-wide baseline for the before/after comparison.
  async function count(table: string): Promise<number> {
    const r = await db.from(table).select("*", { count: "exact", head: true });
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${table}`); }
    return r.count;
  }
  console.log("\n\nCORPUS BASELINE");
  console.log(`  master_place total            : ${await count("master_place")}`);
  console.log(`  master_place_search_export    : ${await count("master_place_search_export")}`);
  console.log(`  source_record total           : ${await count("source_record")}`);
  const active = await db.from("source_record").select("*", { count: "exact", head: true }).eq("is_active", true);
  const inactive = await db.from("source_record").select("*", { count: "exact", head: true }).eq("is_active", false);
  if (active.error || active.count == null || inactive.error || inactive.count == null) { console.log("QUERY FAILED:", JSON.stringify({ active, inactive }, null, 2)); throw new Error("count active"); }
  console.log(`  source_record is_active=true  : ${active.count}`);
  console.log(`  source_record is_active=false : ${inactive.count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
