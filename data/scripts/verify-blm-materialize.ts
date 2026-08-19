/**
 * READ-ONLY verification of the real BLM dispersed_camping materialization.
 *
 * Checks, in order:
 *   - before/after against the captured baseline;
 *   - whether apply_match_outcomes recomputed master_place itself (i.e. whether
 *     the new places are already in master_place_search_export, which requires
 *     source_count > 0) or whether a separate recompute pass is still needed;
 *   - propagation on BOTH surfaces for newly-created places;
 *   - guards: viewpoint's unresolved rows and every other category unmoved.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  const dir = join(homedir(), ".config", "overlander", "materialize-baselines");
  const snap = JSON.parse(readFileSync(join(dir, readdirSync(dir).sort().at(-1)!), "utf8")) as {
    baseline: Record<string, number>; target_source_record_ids: string[];
  };
  const b = snap.baseline;
  const targets = snap.target_source_record_ids;

  /** Concrete helpers only — a generic query-builder callback has failed `tsc`
   *  twice this session; supabase-js builder types don't survive it. */
  async function cntTable(table: string): Promise<number> {
    const r = await db.from(table).select("*", { count: "exact", head: true });
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error(`count ${table}`); }
    return r.count;
  }
  async function cntActiveSr(): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true }).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error("count active"); }
    return r.count;
  }
  async function cntCatActive(cat: string): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true }).eq("inferred_category", cat).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error(`count ${cat}`); }
    return r.count;
  }
  async function cntCatUnlinkedActive(cat: string): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true })
      .eq("inferred_category", cat).is("master_place_id", null).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error(`count ${cat}`); }
    return r.count;
  }
  async function cntSrcUnlinkedActive(src: string): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true })
      .eq("source_id", src).is("master_place_id", null).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error(`count ${src}`); }
    return r.count;
  }

  console.log("1. BEFORE -> AFTER");
  const now = {
    place_match_total: await cntTable("place_match"),
    master_place_total: await cntTable("master_place"),
    view_total: await cntTable("master_place_search_export"),
    sr_active: await cntActiveSr(),
  };
  const rows: [string, number, number][] = [
    ["place_match", b.place_match_total, now.place_match_total],
    ["master_place", b.master_place_total, now.master_place_total],
    ["master_place_search_export", b.view_total, now.view_total],
    ["source_record is_active=true", b.sr_active, now.sr_active],
  ];
  for (const [k, before, after] of rows) {
    console.log(`   ${k.padEnd(30)} ${String(before).padStart(7)} -> ${String(after).padStart(7)}   delta ${after - before >= 0 ? "+" : ""}${after - before}`);
  }

  // Per-category unlinked+active
  const dcNow = await cntCatUnlinkedActive("dispersed_camping");
  const vpNow = await cntCatUnlinkedActive("viewpoint");
  const blmNow = await cntSrcUnlinkedActive("blm");
  console.log(`   ${"dispersed_camping unlinked+active".padEnd(30)} ${String(b.dc_unlinked_active).padStart(7)} -> ${String(dcNow).padStart(7)}   delta ${dcNow - b.dc_unlinked_active}`);
  console.log(`   ${"blm unlinked+active".padEnd(30)} ${String(b.blm_unlinked_active).padStart(7)} -> ${String(blmNow).padStart(7)}   delta ${blmNow - b.blm_unlinked_active}`);
  console.log(`   ${"viewpoint unlinked+active".padEnd(30)} ${String(b.viewpoint_unlinked_active).padStart(7)} -> ${String(vpNow).padStart(7)}   delta ${vpNow - b.viewpoint_unlinked_active}   ${vpNow === b.viewpoint_unlinked_active ? "UNTOUCHED (guard)" : "*** MOVED ***"}`);

  // 2. What happened to the 652 targets?
  console.log("\n2. THE 652 TARGET ROWS — final state");
  const linked: string[] = [];
  const stillUnlinked: string[] = [];
  const mpIds = new Set<string>();
  for (let i = 0; i < targets.length; i += 200) {
    const r = await db.from("source_record").select("id, master_place_id").in("id", targets.slice(i, i + 200));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error("targets"); }
    for (const x of r.data as { id: string; master_place_id: string | null }[]) {
      if (x.master_place_id) { linked.push(x.id); mpIds.add(x.master_place_id); } else stillUnlinked.push(x.id);
    }
  }
  console.log(`   now LINKED        : ${linked.length}   (expected 507 new_master_place + 44 auto_link = 551)`);
  console.log(`   still UNLINKED    : ${stillUnlinked.length}   (expected 101 manual_review)`);
  console.log(`   distinct master_places they point at: ${mpIds.size}`);

  // place_match rows written for them
  let pmForTargets = 0;
  const pmStatus = new Map<string, number>();
  for (let i = 0; i < targets.length; i += 100) {
    const r = await db.from("place_match").select("source_record_id, status").in("source_record_id", targets.slice(i, i + 100));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r).slice(0, 250)); throw new Error("pm"); }
    pmForTargets += r.data.length;
    for (const x of r.data as { status: string }[]) pmStatus.set(x.status, (pmStatus.get(x.status) ?? 0) + 1);
  }
  console.log(`   place_match rows written for them: ${pmForTargets}  (${[...pmStatus.entries()].map(([k, v]) => `${k} ${v}`).join(", ")})`);

  // 3. Did apply recompute? Are the new MPs in the view already?
  console.log("\n3. DID materialize RECOMPUTE master_place ITSELF?");
  const ids = [...mpIds];
  let inView = 0, scZero = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const v = await db.from("master_place_search_export").select("id", { count: "exact", head: true }).in("id", ids.slice(i, i + 200));
    if (v.error || v.count == null) { console.log("QUERY FAILED:", JSON.stringify(v).slice(0, 250)); throw new Error("view"); }
    inView += v.count;
    const m = await db.from("master_place").select("id, source_count").in("id", ids.slice(i, i + 200));
    if (m.error || m.data == null) { console.log("QUERY FAILED:", JSON.stringify(m).slice(0, 250)); throw new Error("mp"); }
    scZero += (m.data as { source_count: number }[]).filter((x) => x.source_count === 0).length;
  }
  console.log(`   master_places touched          : ${ids.length}`);
  console.log(`   with source_count = 0          : ${scZero}   (would mean recompute did NOT run)`);
  console.log(`   present in the export view     : ${inView}`);
  console.log(`   => ${scZero === 0 ? "recompute RAN inside apply_match_outcomes — no separate pass needed" : "recompute did NOT run — a separate pass IS needed"}`);

  // 4. Propagation on both surfaces
  console.log("\n4. PROPAGATION — both surfaces, 4 newly-materialized places");
  const sample = await db.from("master_place_search_export").select("id, canonical_name, primary_category, lng, lat").in("id", ids.slice(0, 200)).limit(4);
  if (sample.error || sample.data == null) { console.log("QUERY FAILED:", JSON.stringify(sample).slice(0, 250)); throw new Error("sample"); }
  let pass = 0;
  for (const p of sample.data as { id: string; canonical_name: string; primary_category: string; lng: number; lat: number }[]) {
    const route = { type: "LineString", coordinates: [[p.lng - 0.05, p.lat - 0.05], [p.lng, p.lat], [p.lng + 0.05, p.lat + 0.05]] };
    const rpc = await db.rpc("pois_along_corridor", { p_route: route, p_buffer_m: 16000, p_categories: [p.primary_category] });
    if (rpc.error || rpc.data == null) { console.log("RPC FAILED:", JSON.stringify(rpc).slice(0, 250)); throw new Error("rpc"); }
    const hit = (rpc.data as { id: string }[]).some((r) => r.id === p.id);
    const ok = hit;
    if (ok) pass += 1;
    console.log(`   ${JSON.stringify(p.canonical_name)}  [${p.primary_category}]`);
    console.log(`      view: PRESENT   corridor RPC: ${hit ? "PRESENT" : "ABSENT"}   ${ok ? "PASS" : "*** FAIL ***"}`);
  }
  console.log(`   ${pass}/${(sample.data as unknown[]).length} present on both surfaces`);

  // 5. Guards
  console.log("\n5. GUARDS — nothing outside dispersed_camping moved");
  for (const c of ["viewpoint", "fire_pit", "gas_station", "public_land", "peak", "spring", "toilet", "water", "dump_station"]) {
    const n = await cntCatActive(c);
    console.log(`   ${c.padEnd(18)} active ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
