/**
 * One-off, READ-ONLY. Re-measures the LLM-generation target population using
 * the EXACT bucketing logic of the 2026-08-20 pilot
 * (measure-llm-target-population-2026-08-20.ts) so the count is directly
 * comparable to that report's 7,154, and reports drift.
 *
 * Additions vs the 2026-08-20 script, for the full-population run that follows:
 *   1. Tracks the actual source_record UUIDs feeding each candidate MP, so the
 *      run script can populate grounded_on_source_record_ids without re-deriving.
 *   2. Cross-references master_place_generated_content (built by #244's template
 *      pass — 10,292 rows) to measure OVERLAP: how many target rows already have
 *      a generated_content entry. Task 2 gate: overlap should be zero (template
 *      targeted the NONE bucket; this target is STRONG/WEAK). Verify, don't assume.
 *   3. Reports, for transparency, the "live-eligibility" bucketing that WOULD
 *      result if has_template_description were folded in (which #244 did to the
 *      shared lib) — NOT used to define the target, only shown so the drift
 *      story is legible.
 *
 * Writes the candidate list (incl. per-MP source_record ids) to a gitignored
 * .context JSON for the run script to consume. NO DB writes, NO API calls.
 *
 * Run:  cd data && npx tsx --env-file=.env scripts/measure-llm-target-population-2026-08-21.ts
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
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

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

  // ── MPs (unfiltered) ──
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category, description").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`master_place rows queried (unfiltered): ${fmt(mps.length)}`);

  // ── geometry (export view = searchable + geometry + source_count>0) ──
  const geo = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`master_place_search_export rows (in-scope geo): ${fmt(geo.size)}`);

  // ── Active source_record signals, aggregated per MP + SR id tracking ──
  type Row = { id: string; master_place_id: string | null; source_id: string; normalized_payload: any; raw_payload: any };
  const rows: Row[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    rows.push(...(r.data as Row[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Active source_record rows queried: ${fmt(rows.length)}`);

  type MPSig = AggregatedSignals & {
    has_real_directions: boolean;
    source_ids: Set<string>;
    source_record_ids: string[];
  };
  const sigs = new Map<string, MPSig>();
  for (const r of rows) {
    if (!r.master_place_id) continue;
    let s = sigs.get(r.master_place_id);
    if (!s) { s = { ...emptyAggregatedSignals(), has_real_directions: false, source_ids: new Set(), source_record_ids: [] }; sigs.set(r.master_place_id, s); }
    s.source_ids.add(r.source_id);
    s.source_record_ids.push(r.id);
    foldSignalsInto(s, computeSignals(r.normalized_payload, r.raw_payload));
    if (r.source_id === "usfs") {
      const d = r.normalized_payload?.directions;
      if (typeof d === "string" && d.trim().length >= DESCRIPTION_MIN_LENGTH) s.has_real_directions = true;
    }
  }

  // ── generated_content: current corpus state + per-MP lookup for overlap ──
  type GC = { master_place_id: string; field_name: string; generation_method: string };
  const gcRows: GC[] = [];
  from = 0;
  while (true) {
    const r = await db.from("master_place_generated_content")
      .select("master_place_id, field_name, generation_method").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (gc):", r); throw new Error(""); }
    gcRows.push(...(r.data as GC[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const gcByMethod = new Map<string, number>();
  const gcDescByMp = new Map<string, string>(); // mp_id -> generation_method (field_name='description')
  for (const g of gcRows) {
    gcByMethod.set(g.generation_method, (gcByMethod.get(g.generation_method) ?? 0) + 1);
    if (g.field_name === "description") gcDescByMp.set(g.master_place_id, g.generation_method);
  }
  console.log(`\n== master_place_generated_content current state ==`);
  console.log(`  total rows: ${fmt(gcRows.length)}`);
  for (const [m, c] of [...gcByMethod.entries()].sort()) console.log(`    generation_method='${m}': ${fmt(c)}`);
  console.log(`  distinct MP with field_name='description': ${fmt(gcDescByMp.size)}`);

  // ── Bucket exactly as the 2026-08-20 pilot did (has_template_description NOT set) ──
  function bucketPilot(s: MPSig): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s) || s.has_real_directions) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  type Candidate = {
    id: string; canonical_name: string; primary_category: string;
    state: State; source_ids: string[]; source_record_ids: string[];
    bucket: "STRONG" | "WEAK"; is_atlas_oddities: boolean;
    already_has_generated: string | null; // generation_method if a description gc row exists
  };
  const candidates: Candidate[] = [];
  let inScopeN = 0, strongN = 0, weakN = 0, noneN = 0, strongAlreadyDescribed = 0;

  // For transparency: live-eligibility bucket if has_template_description were folded in.
  let liveStrong = 0, liveWeak = 0, liveNone = 0;

  for (const m of mps) {
    const g = geo.get(m.id);
    if (!g) continue;
    const sig = sigs.get(m.id);
    if (!sig) continue;
    inScopeN++;

    const bucket = bucketPilot(sig);
    if (bucket === "STRONG") strongN++; else if (bucket === "WEAK") weakN++; else noneN++;

    // live-eligibility (template folded in) — for reporting only
    const liveSig: AggregatedSignals = { ...sig, has_template_description: gcDescByMp.has(m.id) };
    if (isStrongSignals(liveSig)) liveStrong++; else if (isWeakSignals(liveSig)) liveWeak++; else liveNone++;

    if (bucket === "NONE") continue;
    if (sig.has_real_description) { if (bucket === "STRONG") strongAlreadyDescribed++; continue; }
    const state = classifyState(g.lng, g.lat);
    candidates.push({
      id: m.id,
      canonical_name: m.canonical_name,
      primary_category: m.primary_category,
      state,
      source_ids: [...sig.source_ids].sort(),
      source_record_ids: sig.source_record_ids,
      bucket,
      is_atlas_oddities: sig.source_ids.has("atlas_oddities"),
      already_has_generated: gcDescByMp.get(m.id) ?? null,
    });
  }

  console.log(`\n== IN-SCOPE MPs (searchable + geometry + >=1 active SR): ${fmt(inScopeN)} ==`);
  console.log(`  [pilot bucketing, template NOT folded in]`);
  console.log(`  STRONG: ${fmt(strongN)} (${pct(strongN, inScopeN)})`);
  console.log(`  WEAK:   ${fmt(weakN)} (${pct(weakN, inScopeN)})`);
  console.log(`  NONE:   ${fmt(noneN)} (${pct(noneN, inScopeN)})`);
  console.log(`  of STRONG, already carrying a real description (excluded from target): ${fmt(strongAlreadyDescribed)}`);
  console.log(`\n  [live eligibility for contrast — has_template_description folded in, #244]`);
  console.log(`  STRONG: ${fmt(liveStrong)}  WEAK: ${fmt(liveWeak)}  NONE: ${fmt(liveNone)}`);

  const atlasCands = candidates.filter(c => c.is_atlas_oddities);
  const nonAtlas = candidates.filter(c => !c.is_atlas_oddities);
  console.log(`\n== TARGET POPULATION (STRONG or WEAK, pilot bucketing, NO real description) ==`);
  console.log(`  incl. atlas_oddities: ${fmt(candidates.length)}`);
  console.log(`  atlas_oddities within: ${fmt(atlasCands.length)} (${pct(atlasCands.length, candidates.length)})`);
  console.log(`  EXCLUDING atlas_oddities (the run target): ${fmt(nonAtlas.length)}`);
  const strongTarget = nonAtlas.filter(c => c.bucket === "STRONG").length;
  const weakTarget = nonAtlas.filter(c => c.bucket === "WEAK").length;
  console.log(`    of which STRONG: ${fmt(strongTarget)}  WEAK: ${fmt(weakTarget)}`);

  // ── OVERLAP CHECK (task 2 gate) ──
  const overlapAll = candidates.filter(c => c.already_has_generated !== null);
  const overlapNonAtlas = nonAtlas.filter(c => c.already_has_generated !== null);
  console.log(`\n== OVERLAP with master_place_generated_content (task 2 gate) ==`);
  console.log(`  target rows (incl atlas) already having a description generated_content row: ${fmt(overlapAll.length)}`);
  console.log(`  target rows (excl atlas, the run set) already having one:                    ${fmt(overlapNonAtlas.length)}`);
  if (overlapNonAtlas.length > 0) {
    const byMethod = new Map<string, number>();
    for (const c of overlapNonAtlas) byMethod.set(c.already_has_generated!, (byMethod.get(c.already_has_generated!) ?? 0) + 1);
    console.log(`  >>> NON-ZERO OVERLAP — by generation_method:`);
    for (const [m, c] of byMethod) console.log(`        ${m}: ${fmt(c)}`);
    console.log(`  Sample overlapping rows:`);
    for (const c of overlapNonAtlas.slice(0, 10)) console.log(`     ${c.id}  [${c.already_has_generated}]  ${c.bucket}  ${c.canonical_name}`);
  } else {
    console.log(`  >>> ZERO overlap in the run set — clean to write.`);
  }

  console.log(`\n  target (excl atlas) by state:`);
  const byState = new Map<State, number>();
  for (const c of nonAtlas) byState.set(c.state, (byState.get(c.state) ?? 0) + 1);
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) console.log(`    ${st.padEnd(10)}${fmt(byState.get(st) ?? 0)}`);

  console.log(`\n  target (excl atlas) by source composition (top 15):`);
  const bySrc = new Map<string, number>();
  for (const c of nonAtlas) {
    const kk = c.source_ids.length === 1 ? c.source_ids[0] : "multi:" + c.source_ids.join("+");
    bySrc.set(kk, (bySrc.get(kk) ?? 0) + 1);
  }
  for (const [kk, v] of [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${kk.padEnd(34)} ${fmt(v)}`);

  // ── Persist run set (excl atlas, no existing generated_content) for the run script ──
  const runSet = nonAtlas.filter(c => c.already_has_generated === null);
  const outPath = resolve(process.cwd(), "..", ".context/measurements/llm-target-population-2026-08-21.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(runSet, null, 0));
  console.log(`\nWrote ${fmt(runSet.length)} run-set candidates (excl atlas, excl any existing generated_content) to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
