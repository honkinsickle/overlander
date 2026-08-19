/**
 * READ-ONLY: every number the viewpoint docs pass will state, measured in one
 * go against current TEST. Nothing transcribed from a chat report.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

type SR = { external_id: string; name: string; is_active: boolean; master_place_id: string | null; normalized_payload: { description?: unknown } | null };

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY, measured now\n`);

  const page = 1000;
  /** Plain, concrete helpers — no generic query-builder callback. An earlier
   *  version of this script used one and failed `tsc`; the supabase-js builder
   *  types do not survive being passed through a generic function. */
  async function cntAll(table: string): Promise<number> {
    const r = await db.from(table).select("*", { count: "exact", head: true });
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${table}`); }
    return r.count;
  }
  async function cntActive(active: boolean): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true }).eq("is_active", active);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("count active"); }
    return r.count;
  }
  async function cntCatActive(cat: string): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true }).eq("inferred_category", cat).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${cat}`); }
    return r.count;
  }
  async function cntViewCat(cat: string): Promise<number> {
    const r = await db.from("master_place_search_export").select("*", { count: "exact", head: true }).eq("primary_category", cat);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`view ${cat}`); }
    return r.count;
  }

  console.log("── CORPUS TOTALS ───────────────────────────────");
  console.log(`master_place                 : ${await cntAll("master_place")}`);
  console.log(`source_record total          : ${await cntAll("source_record")}`);
  console.log(`source_record is_active=true : ${await cntActive(true)}`);
  console.log(`source_record is_active=false: ${await cntActive(false)}`);
  console.log(`master_place_search_export   : ${await cntAll("master_place_search_export")}`);
  console.log(`place_match total            : ${await cntAll("place_match")}`);

  // ── viewpoint by source ────────────────────────────────────────────
  async function slice(src: string) {
    const out: SR[] = [];
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("external_id, name, is_active, master_place_id, normalized_payload")
        .eq("inferred_category", "viewpoint").eq("source_id", src).order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("slice"); }
      out.push(...(r.data as unknown as SR[]));
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  }
  async function inViewCount(ids: string[]) {
    let n = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const r = await db.from("master_place_search_export").select("id", { count: "exact", head: true }).in("id", ids.slice(i, i + 200));
      if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("inview"); }
      n += r.count;
    }
    return n;
  }

  for (const src of ["nps", "osm"] as const) {
    const s = await slice(src);
    const active = s.filter((r) => r.is_active);
    const mps = [...new Set(active.map((r) => r.master_place_id).filter((x): x is string => !!x))];
    console.log(`\n── ${src.toUpperCase()} VIEWPOINT ───────────────────────────────`);
    console.log(`  total source_records : ${s.length}`);
    console.log(`  ACTIVE               : ${active.length}`);
    console.log(`  inactive             : ${s.length - active.length}`);
    console.log(`  active & linked      : ${active.filter((r) => r.master_place_id).length}`);
    console.log(`  active & UNLINKED    : ${active.filter((r) => !r.master_place_id).length}`);
    console.log(`  distinct master_places (from active rows): ${mps.length}`);
    console.log(`  of those, in the export view            : ${await inViewCount(mps)}`);
    if (src === "osm") {
      for (const r of active.filter((x) => !x.master_place_id)) {
        console.log(`     UNLINKED: ${r.external_id}  ${JSON.stringify(String(r.normalized_payload?.description ?? "").slice(0, 70))}`);
      }
    }
  }

  console.log(`\n  view rows primary_category='viewpoint': ${await cntViewCat("viewpoint")}`);

  console.log("\n── STILL DEACTIVATED (must be 0 active) ────────");
  for (const c of ["fire_pit", "gas_station", "public_land", "peak", "spring"]) {
    console.log(`  ${c.padEnd(14)} ${await cntCatActive(c)}`);
  }
  console.log("\n── THE THREE NARROWED CATEGORIES ───────────────");
  for (const c of ["toilet", "water", "dump_station"]) {
    console.log(`  ${c.padEnd(14)} active ${await cntCatActive(c)}`);
  }

  // ── Typesense drift ────────────────────────────────────────────────
  const host = process.env.TYPESENSE_HOST, proto = process.env.TYPESENSE_PROTOCOL ?? "https";
  const port = process.env.TYPESENSE_PORT ?? "443", col = process.env.TYPESENSE_COLLECTION;
  if (host && col && process.env.TYPESENSE_ADMIN_API_KEY) {
    const H = { "X-TYPESENSE-API-KEY": process.env.TYPESENSE_ADMIN_API_KEY };
    const c = await (await fetch(`${proto}://${host}:${port}/collections/${col}`, { headers: H })).json() as { num_documents?: number };
    const h = await (await fetch(`${proto}://${host}:${port}/health`, { headers: H })).json();
    const m = await (await fetch(`${proto}://${host}:${port}/metrics.json`, { headers: H })).json() as Record<string, string>;
    const view = await cntAll("master_place_search_export");
    const u = Number(m.system_memory_used_bytes), t = Number(m.system_memory_total_bytes);
    console.log("\n── TYPESENSE ───────────────────────────────────");
    console.log(`  ${col} num_documents : ${c.num_documents}`);
    console.log(`  view                       : ${view}`);
    console.log(`  DRIFT (index - view)       : ${(c.num_documents ?? 0) - view}`);
    console.log(`  /health                    : ${JSON.stringify(h)}`);
    console.log(`  system memory              : ${(u / 1e9).toFixed(3)}GB / ${(t / 1e9).toFixed(3)}GB = ${((u / t) * 100).toFixed(1)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
