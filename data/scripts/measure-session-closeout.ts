/**
 * READ-ONLY TEST measurement for the session docs close-out. Every number the
 * docs will state is produced here, in one pass, against live TEST — nothing is
 * transcribed from a chat report or an earlier script's output.
 *
 * Exists because counts drifted between reports during this session
 * (dump_station appeared as both 149 and 26 at different points, either side of
 * a deletion; water counts were quoted inconsistently).
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

const REACTIVATED = ["toilet", "water", "dump_station"] as const;
const STILL_OFF = ["viewpoint", "fire_pit", "gas_station", "public_land", "peak", "spring"] as const;

type SR = {
  source_id: string;
  inferred_category: string | null;
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
  console.log(`[env] TEST ${ref} — READ-ONLY, all figures measured now\n`);

  const page = 1000;
  async function count(table: string): Promise<number> {
    const r = await db.from(table).select("*", { count: "exact", head: true });
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${table}`); }
    return r.count;
  }
  async function countWhere(table: string, col: string, val: string | boolean): Promise<number> {
    const r = await db.from(table).select("*", { count: "exact", head: true }).eq(col, val);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${table}.${col}`); }
    return r.count;
  }
  async function scanCat(cat: string): Promise<SR[]> {
    const out: SR[] = [];
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("source_id, inferred_category, is_active, master_place_id, normalized_payload")
        .eq("inferred_category", cat).order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      out.push(...(r.data as unknown as SR[]));
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  }
  const hasDesc = (x: SR) => typeof x.normalized_payload?.description === "string" && (x.normalized_payload.description as string).trim().length > 0;

  console.log("── CORPUS TOTALS ─────────────────────────────────────────────");
  console.log(`master_place                 : ${await count("master_place")}`);
  console.log(`source_record total          : ${await count("source_record")}`);
  console.log(`source_record is_active=true : ${await countWhere("source_record", "is_active", true)}`);
  console.log(`source_record is_active=false: ${await countWhere("source_record", "is_active", false)}`);
  console.log(`place_match total            : ${await count("place_match")}`);
  console.log(`place_match pending          : ${await countWhere("place_match", "status", "pending")}`);
  console.log(`master_place_search_export   : ${await count("master_place_search_export")}`);

  // source_record by source_id (active / all)
  const all: SR[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record").select("source_id, inferred_category, is_active, master_place_id, normalized_payload")
      .order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan all"); }
    all.push(...(r.data as unknown as SR[]));
    if (r.data.length < page) break;
    from += page;
  }
  const bySrc = new Map<string, { all: number; active: number }>();
  for (const r of all) {
    const e = bySrc.get(r.source_id) ?? { all: 0, active: 0 };
    e.all += 1; if (r.is_active) e.active += 1;
    bySrc.set(r.source_id, e);
  }
  console.log(`\nsource_record by source_id (active / all):`);
  for (const [s, e] of [...bySrc.entries()].sort((a, b) => b[1].all - a[1].all)) {
    console.log(`  ${s.padEnd(18)} ${String(e.active).padStart(7)} / ${e.all}`);
  }

  // master_place source_count = 0
  const mps: { source_count: number; primary_category: string | null }[] = [];
  from = 0;
  while (true) {
    const r = await db.from("master_place").select("source_count, primary_category").order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan mp"); }
    mps.push(...(r.data as { source_count: number; primary_category: string | null }[]));
    if (r.data.length < page) break;
    from += page;
  }
  console.log(`\nmaster_place source_count=0  : ${mps.filter((m) => m.source_count === 0).length}`);
  console.log(`master_place primary_category='dump_station': ${mps.filter((m) => m.primary_category === "dump_station").length} (source_count=0: ${mps.filter((m) => m.primary_category === "dump_station" && m.source_count === 0).length})`);

  console.log("\n── REACTIVATED CATEGORIES ────────────────────────────────────");
  for (const cat of REACTIVATED) {
    const rows = await scanCat(cat);
    console.log(`${cat.padEnd(14)} total ${String(rows.length).padStart(5)}  active ${String(rows.filter((r) => r.is_active).length).padStart(5)}  inactive ${String(rows.filter((r) => !r.is_active).length).padStart(5)}  WITH DESCRIPTION ${String(rows.filter(hasDesc).length).padStart(5)}  (${((rows.filter(hasDesc).length / rows.length) * 100).toFixed(1)}%)`);
    const srcs = new Set(rows.map((r) => r.source_id));
    console.log(`               sources: ${[...srcs].join(", ")}`);
  }
  // view + index presence for the three
  console.log(`\nview rows in the three categories:`);
  let viewSum = 0;
  for (const cat of REACTIVATED) {
    const r = await db.from("master_place_search_export").select("*", { count: "exact", head: true }).eq("primary_category", cat);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("view cat"); }
    console.log(`  ${cat.padEnd(14)} ${r.count}`);
    viewSum += r.count;
  }
  console.log(`  sum: ${viewSum}`);

  console.log("\n── STILL DEACTIVATED ─────────────────────────────────────────");
  for (const cat of STILL_OFF) {
    const rows = await scanCat(cat);
    if (rows.length === 0) { console.log(`${cat.padEnd(14)} (no rows)`); continue; }
    const bySrcCat = new Map<string, { all: number; active: number }>();
    for (const r of rows) {
      const e = bySrcCat.get(r.source_id) ?? { all: 0, active: 0 };
      e.all += 1; if (r.is_active) e.active += 1;
      bySrcCat.set(r.source_id, e);
    }
    console.log(`${cat.padEnd(14)} total ${String(rows.length).padStart(6)}  active ${String(rows.filter((r) => r.is_active).length).padStart(6)}  inactive ${String(rows.filter((r) => !r.is_active).length).padStart(6)}`);
    console.log(`               by source (active/all): ${[...bySrcCat.entries()].map(([s, e]) => `${s} ${e.active}/${e.all}`).join("  ")}`);
  }

  // ── VIEWPOINT NPS: the explicitly-flagged open question ──────────────
  console.log("\n── VIEWPOINT / NPS SLICE (explicit open question) ────────────");
  const vp = await scanCat("viewpoint");
  const nps = vp.filter((r) => r.source_id === "nps");
  const npsLinked = nps.filter((r) => r.master_place_id);
  const npsMps = new Set(npsLinked.map((r) => r.master_place_id!));
  console.log(`nps viewpoint source_records : ${nps.length}  (active ${nps.filter((r) => r.is_active).length} / inactive ${nps.filter((r) => !r.is_active).length})`);
  console.log(`  linked to a master_place   : ${npsLinked.length}  -> distinct master_places: ${npsMps.size}`);
  console.log(`  with a description         : ${nps.filter(hasDesc).length}`);
  const osmVp = vp.filter((r) => r.source_id === "osm");
  console.log(`osm viewpoint source_records : ${osmVp.length}  (active ${osmVp.filter((r) => r.is_active).length})  with description ${osmVp.filter(hasDesc).length}`);
  // Are any of those NPS-viewpoint master_places currently visible?
  const ids = [...npsMps];
  let inView = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from("master_place_search_export").select("id", { count: "exact", head: true }).in("id", ids.slice(i, i + 200));
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("vp view"); }
    inView += r.count;
  }
  console.log(`  of those ${ids.length} master_places, present in master_place_search_export: ${inView}`);
  console.log(`  => NPS viewpoint reactivated? ${nps.filter((r) => r.is_active).length > 0 ? "YES" : "NO — still deactivated"}`);

  // ── Typesense ────────────────────────────────────────────────────────
  const host = process.env.TYPESENSE_HOST, proto = process.env.TYPESENSE_PROTOCOL ?? "https";
  const port = process.env.TYPESENSE_PORT ?? "443", col = process.env.TYPESENSE_COLLECTION;
  if (host && col && process.env.TYPESENSE_ADMIN_API_KEY) {
    const j = await (await fetch(`${proto}://${host}:${port}/collections/${col}`, {
      headers: { "X-TYPESENSE-API-KEY": process.env.TYPESENSE_ADMIN_API_KEY },
    })).json() as { num_documents?: number };
    console.log(`\n── SEARCH INDEX ──────────────────────────────────────────────`);
    console.log(`typesense ${col}: ${j.num_documents}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
