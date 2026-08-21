/**
 * Read-only, one-off. Fixes a confirmed scoping bug in
 * measure-corpus-gap-scan-2026-08-20.ts: its "BY SOURCE_ID" section built
 * each source's MP set from ALL active source_records corpus-wide, never
 * restricting to the in-scope population (master_place_search_export) the
 * way the "OVERALL BUCKETS" section correctly does. This silently included
 * every is_searchable=false / not-in-view master_place (all 35,967 padus
 * land_status rows, and potentially rows from other sources) as if they were
 * part of the searchable corpus. See
 * docs/measurements/2026-08-20-padus-scope-reconciliation.md for the
 * original diagnosis (padus specifically).
 *
 * This copy fixes it by intersecting every per-source and per-category MP
 * set against the same in-scope id set (`inScopeIds`, from
 * master_place_search_export) that the overall bucket calculation already
 * uses. Also adds a genuine corpus-wide BY primary_category breakdown
 * (the original script's category table was OSM-inferred_category only,
 * not a full-corpus category view) since downstream work needs NONE counts
 * per primary_category across all sources, not just OSM.
 *
 * NOT modifying the original script. NOT writing to the DB.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  isStrong as isStrongSignals,
  isWeak as isWeakSignals,
  type SRSignals,
  type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;
const GOOGLE_SOURCES = new Set(["google", "google_resolved"]);

type SR = SRSignals & {
  id: string;
  master_place_id: string | null;
  source_id: string;
  inferred_category: string | null;
  is_google: boolean;
};

async function fetchSRSignals(db: SupabaseClient): Promise<SR[]> {
  const rows: SR[] = [];
  let from = 0;
  process.stderr.write("Fetching source_record signals (active only)…\n");
  while (true) {
    const r = await db.from("source_record")
      .select("id, master_place_id, source_id, inferred_category, normalized_payload, raw_payload")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    for (const raw of r.data as any[]) {
      const s = computeSignals(raw.normalized_payload, raw.raw_payload);
      rows.push({
        id: raw.id,
        master_place_id: raw.master_place_id,
        source_id: raw.source_id,
        inferred_category: raw.inferred_category,
        is_google: GOOGLE_SOURCES.has(raw.source_id),
        ...s,
      });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  return rows;
}

type MP = { id: string; primary_category: string };

async function fetchInScopeMPs(db: SupabaseClient): Promise<MP[]> {
  process.stderr.write("Fetching master_place (id, category)…\n");
  const catById = new Map<string, string>();
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, primary_category").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    for (const row of r.data as any[]) catById.set(row.id, row.primary_category);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  process.stderr.write("Fetching in-scope ids (master_place_search_export)…\n");
  const out: MP[] = [];
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) {
      const cat = catById.get(row.id);
      out.push({ id: row.id, primary_category: cat ?? "(unknown)" });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Run date/time: ${new Date().toISOString()}`);

  const mps = await fetchInScopeMPs(db);
  const inScopeIds = new Set(mps.map(m => m.id));
  console.log(`In-scope MPs (master_place_search_export): ${fmt(mps.length)}`);

  const srs = await fetchSRSignals(db);
  console.log(`Active source_records probed: ${fmt(srs.length)}`);

  type MPSig = AggregatedSignals & { source_ids: Set<string> };
  const sigs = new Map<string, MPSig>();
  for (const sr of srs) {
    if (!sr.master_place_id || !inScopeIds.has(sr.master_place_id)) continue; // THE FIX: scope gate here
    let s = sigs.get(sr.master_place_id);
    if (!s) { s = { ...emptyAggregatedSignals(), source_ids: new Set() }; sigs.set(sr.master_place_id, s); }
    s.source_ids.add(sr.source_id);
    foldSignalsInto(s, sr);
  }

  function bucketOf(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s)) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  const mpsWithSR = mps.filter(m => sigs.has(m.id));
  const N = mpsWithSR.length;
  console.log(`In-scope MPs with >=1 active SR: ${fmt(N)}`);

  let strong = 0, weak = 0, none = 0;
  for (const m of mpsWithSR) {
    const b = bucketOf(sigs.get(m.id)!);
    if (b === "STRONG") strong++; else if (b === "WEAK") weak++; else none++;
  }
  console.log("\n== OVERALL BUCKETS (unchanged from the original script — sanity cross-check) ==");
  console.log(`  STRONG: ${fmt(strong)} (${pct(strong, N)})`);
  console.log(`  WEAK:   ${fmt(weak)} (${pct(weak, N)})`);
  console.log(`  NONE:   ${fmt(none)} (${pct(none, N)})`);

  // ── FIXED: by source_id, properly restricted to in-scope MPs ──
  console.log("\n== BY SOURCE_ID, CORRECTLY RESTRICTED TO IN-SCOPE (36,250-class) MPs ==");
  const SOURCE_IDS = ["osm", "padus", "usfs", "ridb", "nps", "blm", "state_parks", "google_resolved", "google", "atlas_oddities"];
  console.log("  source            n_mps(in-scope)   strong%   weak%   none%   none(n)");
  for (const src of SOURCE_IDS) {
    const mpIds = new Set<string>();
    for (const sr of srs) {
      if (sr.source_id !== src || !sr.master_place_id) continue;
      if (!inScopeIds.has(sr.master_place_id)) continue; // THE FIX
      mpIds.add(sr.master_place_id);
    }
    let s = 0, w = 0, n = 0;
    for (const id of mpIds) {
      const sig = sigs.get(id);
      if (!sig) continue;
      const b = bucketOf(sig);
      if (b === "STRONG") s++; else if (b === "WEAK") w++; else n++;
    }
    const total = s + w + n;
    console.log(`  ${src.padEnd(16)} ${fmt(total).padStart(9)}       ${pct(s, total).padStart(7)} ${pct(w, total).padStart(7)} ${pct(n, total).padStart(7)}   ${fmt(n).padStart(7)}`);
  }

  // ── ADDED: by primary_category, corpus-wide (all sources), restricted to in-scope ──
  console.log("\n== BY primary_category, CORPUS-WIDE (all sources), IN-SCOPE ONLY ==");
  const byCat = new Map<string, { s: number; w: number; n: number }>();
  for (const m of mpsWithSR) {
    const b = bucketOf(sigs.get(m.id)!);
    let row = byCat.get(m.primary_category);
    if (!row) { row = { s: 0, w: 0, n: 0 }; byCat.set(m.primary_category, row); }
    if (b === "STRONG") row.s++; else if (b === "WEAK") row.w++; else row.n++;
  }
  const catRows = [...byCat.entries()].map(([cat, r]) => ({ cat, total: r.s + r.w + r.n, ...r }))
    .sort((a, b) => b.n - a.n);
  console.log("  category                 n_total   strong%   weak%   none%   none(n)");
  for (const row of catRows) {
    console.log(`  ${row.cat.padEnd(24)} ${fmt(row.total).padStart(7)}  ${pct(row.s, row.total).padStart(7)} ${pct(row.w, row.total).padStart(7)} ${pct(row.n, row.total).padStart(7)}   ${fmt(row.n).padStart(7)}`);
  }
  console.log(`\n  Sum of NONE across all categories: ${fmt(catRows.reduce((a, r) => a + r.n, 0))} (must equal ${fmt(none)} above — clean partition, unlike the by-source table)`);
}
main().catch(e => { console.error(e); process.exit(1); });
