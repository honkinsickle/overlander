/**
 * One-off, read-only. Computes the precise LLM-generation target population:
 * in-scope master_place rows in the STRONG or WEAK bucket (post-USFS-
 * directions-fix, see measure-usfs-directions-fix-2026-08-20.ts) that do
 * NOT already have a real description (has_real_description signal, same
 * DESCRIPTION_MIN_LENGTH=40 threshold used corpus-wide — a row this signal
 * counts as "real" is exactly a row with nothing to generate).
 *
 * Writes the full target-population candidate list to a local JSON file
 * (id, state, primary_category, source_ids, bucket, is_atlas_oddities) for
 * the task-4 stratified sample draw — no DB writes, no API calls here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  isStrong as isStrongSignals,
  isWeak as isWeakSignals,
  DESCRIPTION_MIN_LENGTH,
  type AggregatedSignals,
} from "./lib/eligibility.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE = 1000;

type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
function classifyState(lng: number, lat: number): State {
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
}

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Run date/time: ${new Date().toISOString()}`);

  // ── MPs in scope (export view = searchable + geometry + source_count>0) ──
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category, description").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const geo = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`master_place rows queried (unfiltered): ${fmt(mps.length)}`);

  // ── Active source_record signals, aggregated per MP, with USFS directions fix folded in ──
  type Row = { master_place_id: string | null; source_id: string; normalized_payload: any; raw_payload: any };
  const rows: Row[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    rows.push(...(r.data as Row[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Active source_record rows queried: ${fmt(rows.length)}`);

  type MPSig = AggregatedSignals & { has_real_directions: boolean; source_ids: Set<string> };
  const sigs = new Map<string, MPSig>();
  for (const r of rows) {
    if (!r.master_place_id) continue;
    let s = sigs.get(r.master_place_id);
    if (!s) { s = { ...emptyAggregatedSignals(), has_real_directions: false, source_ids: new Set() }; sigs.set(r.master_place_id, s); }
    s.source_ids.add(r.source_id);
    foldSignalsInto(s, computeSignals(r.normalized_payload, r.raw_payload));
    if (r.source_id === "usfs") {
      const d = r.normalized_payload?.directions;
      if (typeof d === "string" && d.trim().length >= DESCRIPTION_MIN_LENGTH) s.has_real_directions = true;
    }
  }

  function bucketCorrected(s: MPSig): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s) || s.has_real_directions) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  type Candidate = {
    id: string; canonical_name: string; primary_category: string;
    state: State; source_ids: string[]; bucket: "STRONG" | "WEAK";
    is_atlas_oddities: boolean;
  };
  const candidates: Candidate[] = [];
  let inScopeN = 0;
  let strongN = 0, weakN = 0, noneN = 0;
  let strongAlreadyDescribed = 0;

  for (const m of mps) {
    const g = geo.get(m.id);
    if (!g) continue; // not in export view
    const sig = sigs.get(m.id);
    if (!sig) continue; // no active SR at all
    inScopeN++;
    const bucket = bucketCorrected(sig);
    if (bucket === "STRONG") strongN++; else if (bucket === "WEAK") weakN++; else noneN++;
    if (bucket === "NONE") continue;
    if (sig.has_real_description) { if (bucket === "STRONG") strongAlreadyDescribed++; continue; } // already has real description — not a generation target
    const state = classifyState(g.lng, g.lat);
    candidates.push({
      id: m.id,
      canonical_name: m.canonical_name,
      primary_category: m.primary_category,
      state,
      source_ids: [...sig.source_ids].sort(),
      bucket,
      is_atlas_oddities: sig.source_ids.has("atlas_oddities"),
    });
  }

  console.log(`\n== IN-SCOPE MPs (searchable + geometry + >=1 active SR): ${fmt(inScopeN)} ==`);
  console.log(`  STRONG: ${fmt(strongN)} (${pct(strongN, inScopeN)})`);
  console.log(`  WEAK:   ${fmt(weakN)} (${pct(weakN, inScopeN)})`);
  console.log(`  NONE:   ${fmt(noneN)} (${pct(noneN, inScopeN)})`);
  console.log(`  of STRONG, already carrying a real description (excluded from target): ${fmt(strongAlreadyDescribed)}`);

  console.log(`\n== TARGET POPULATION (STRONG or WEAK, post-USFS-fix, NO real description yet) ==`);
  console.log(`  TOTAL: ${fmt(candidates.length)}`);
  const strongTarget = candidates.filter(c => c.bucket === "STRONG").length;
  const weakTarget = candidates.filter(c => c.bucket === "WEAK").length;
  console.log(`  from STRONG (strong via website/wiki/meaningful-tags/usfs-directions, no description text): ${fmt(strongTarget)}`);
  console.log(`  from WEAK (phone/hours only): ${fmt(weakTarget)}`);

  const atlasN = candidates.filter(c => c.is_atlas_oddities).length;
  console.log(`\n== ATLAS_ODDITIES WITHIN TARGET POPULATION ==`);
  console.log(`  ${fmt(atlasN)} of ${fmt(candidates.length)} target rows (${pct(atlasN, candidates.length)}) carry an atlas_oddities source.`);
  console.log(`  These are STRONG only via contact.website presence (verified in the 2026-08-20 gap-scan`);
  console.log(`  spot-check: 0 of 2,866 active atlas_oddities rows have any description text at all).`);

  console.log(`\n  by state:`);
  const byState = new Map<State, number>();
  for (const c of candidates) byState.set(c.state, (byState.get(c.state) ?? 0) + 1);
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) {
    console.log(`    ${st.padEnd(10)}${fmt(byState.get(st) ?? 0)}`);
  }
  console.log(`\n  by source composition (top 15):`);
  const bySrc = new Map<string, number>();
  for (const c of candidates) {
    const key = c.source_ids.length === 1 ? c.source_ids[0] : "multi:" + c.source_ids.join("+");
    bySrc.set(key, (bySrc.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${k.padEnd(30)} ${fmt(v)}`);
  }

  const outPath = resolve(process.cwd(), "..", ".context/measurements/llm-target-population-2026-08-20.json");
  writeFileSync(outPath, JSON.stringify(candidates, null, 0));
  console.log(`\nWrote ${fmt(candidates.length)} candidates to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
