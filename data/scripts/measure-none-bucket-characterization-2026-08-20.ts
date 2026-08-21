/**
 * Read-only, one-off. Deep characterization of the NONE bucket (post-USFS-
 * directions-fix eligibility classification) — count, category/source/state
 * breakdown, placeholder-name split, Wikipedia-affinity precondition split,
 * and a printed sample per top category for manual qualitative review.
 *
 * Reuses (not imports, per the web/data cross-workspace boundary):
 *   - isPlaceholderName / PLACEHOLDER_ALLOWLIST, copied verbatim from
 *     data/scripts/eval-llm-descriptions.ts (same module, no need to re-derive).
 *   - significantTokens / AFFINITY_STOPWORDS, copied verbatim from
 *     web/src/lib/discovery/wikipedia.ts (a deliberate twin copy — data/ cannot
 *     import web/ at runtime, CLAUDE.md cross-workspace rule).
 *   - has_real_directions USFS fix, same as measure-usfs-directions-fix-2026-08-20.ts.
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

// ─── Twin copy: isPlaceholderName (data/scripts/eval-llm-descriptions.ts) ──
const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}

// ─── Twin copy: significantTokens (web/src/lib/discovery/wikipedia.ts) ─────
const AFFINITY_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "of", "a", "an", "and", "at", "in", "on",
  "building", "buildings", "tower", "hall", "center", "centre",
  "plaza", "house", "block", "complex",
]);
function significantTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0 && !AFFINITY_STOPWORDS.has(t)),
  );
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

  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`master_place rows queried (unfiltered): ${fmt(mps.length)}`);

  const geo = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }

  type SR = { id: string; source_id: string; external_id: string; inferred_category: string | null; normalized_payload: any; raw_payload: any };
  const srByMp = new Map<string, SR[]>();
  let srTotal = 0;
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, master_place_id, source_id, external_id, inferred_category, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    for (const row of r.data as any[]) {
      srTotal++;
      if (!row.master_place_id) continue;
      let arr = srByMp.get(row.master_place_id);
      if (!arr) { arr = []; srByMp.set(row.master_place_id, arr); }
      arr.push({ id: row.id, source_id: row.source_id, external_id: row.external_id, inferred_category: row.inferred_category, normalized_payload: row.normalized_payload, raw_payload: row.raw_payload });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  console.log(`Active source_record rows queried: ${fmt(srTotal)}`);

  type MPRow = {
    id: string; canonical_name: string; primary_category: string; state: State;
    bucket: "STRONG" | "WEAK" | "NONE"; has_real_description: boolean; is_atlas_oddities: boolean;
    source_ids: string[]; srs: SR[];
  };
  const rows: MPRow[] = [];
  let inScopeN = 0;

  for (const m of mps) {
    const g = geo.get(m.id);
    if (!g) continue;
    const srs = srByMp.get(m.id);
    if (!srs || srs.length === 0) continue;
    inScopeN++;
    const sig: AggregatedSignals & { has_real_directions: boolean } = { ...emptyAggregatedSignals(), has_real_directions: false };
    const source_ids = new Set<string>();
    for (const sr of srs) {
      source_ids.add(sr.source_id);
      foldSignalsInto(sig, computeSignals(sr.normalized_payload, sr.raw_payload));
      if (sr.source_id === "usfs") {
        const d = sr.normalized_payload?.directions;
        if (typeof d === "string" && d.trim().length >= DESCRIPTION_MIN_LENGTH) sig.has_real_directions = true;
      }
    }
    const bucket: "STRONG" | "WEAK" | "NONE" = (isStrongSignals(sig) || sig.has_real_directions) ? "STRONG" : isWeakSignals(sig) ? "WEAK" : "NONE";
    rows.push({
      id: m.id, canonical_name: m.canonical_name, primary_category: m.primary_category, state: classifyState(g.lng, g.lat),
      bucket, has_real_description: sig.has_real_description, is_atlas_oddities: source_ids.has("atlas_oddities"),
      source_ids: [...source_ids].sort(), srs,
    });
  }

  console.log(`\n== TASK 1: PARTITION CHECK (in-scope MPs: ${fmt(inScopeN)}) ==`);
  const strongRows = rows.filter(r => r.bucket === "STRONG");
  const weakRows = rows.filter(r => r.bucket === "WEAK");
  const noneRows = rows.filter(r => r.bucket === "NONE");
  console.log(`  STRONG: ${fmt(strongRows.length)} (${pct(strongRows.length, inScopeN)})`);
  console.log(`  WEAK:   ${fmt(weakRows.length)} (${pct(weakRows.length, inScopeN)})`);
  console.log(`  NONE:   ${fmt(noneRows.length)} (${pct(noneRows.length, inScopeN)})`);
  console.log(`  sum check: ${fmt(strongRows.length + weakRows.length + noneRows.length)} vs in-scope ${fmt(inScopeN)} (must match exactly)`);

  const strongAlreadyDescribed = strongRows.filter(r => r.has_real_description).length;
  const strongNoDescription = strongRows.filter(r => !r.has_real_description);
  const strongNoDescAtlas = strongNoDescription.filter(r => r.is_atlas_oddities).length;
  const strongNoDescNonAtlas = strongNoDescription.length - strongNoDescAtlas;
  console.log(`\n  STRONG breakdown: already-described ${fmt(strongAlreadyDescribed)} + no-description ${fmt(strongNoDescription.length)} (of which atlas_oddities ${fmt(strongNoDescAtlas)}, non-atlas ${fmt(strongNoDescNonAtlas)})`);
  console.log(`  Target population re-check (STRONG-no-desc + WEAK, non-atlas): ${fmt(strongNoDescNonAtlas + weakRows.filter(r => !r.is_atlas_oddities).length)} (compare to prior session's 7,154 — corpus may have drifted; this is the CURRENT number)`);
  console.log(`  NONE bucket excludes atlas_oddities check: NONE rows carrying atlas_oddities = ${fmt(noneRows.filter(r => r.is_atlas_oddities).length)} (atlas_oddities rows that are STRONG-only-via-website end up in STRONG or WEAK, not NONE, by construction — reporting for completeness)`);

  console.log(`\n== TASK 2: NONE BUCKET BY primary_category (resolved) — top 25 ==`);
  const byCat = new Map<string, number>();
  for (const r of noneRows) byCat.set(r.primary_category, (byCat.get(r.primary_category) ?? 0) + 1);
  const catSorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of catSorted.slice(0, 25)) {
    console.log(`  ${cat.padEnd(24)} ${fmt(n).padStart(7)}  ${pct(n, noneRows.length)}`);
  }
  console.log(`  (${byCat.size} distinct primary_category values in NONE bucket)`);

  console.log(`\n== TASK 3a: NONE BUCKET BY source_id (MP counted once per source it carries) ==`);
  const bySource = new Map<string, number>();
  for (const r of noneRows) for (const sid of r.source_ids) bySource.set(sid, (bySource.get(sid) ?? 0) + 1);
  for (const [sid, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sid.padEnd(18)} ${fmt(n).padStart(7)}`);
  }

  console.log(`\n== TASK 3b: NONE BUCKET BY state ==`);
  const byState = new Map<State, number>();
  for (const r of noneRows) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) {
    console.log(`  ${st.padEnd(10)}${fmt(byState.get(st) ?? 0).padStart(7)}  ${pct(byState.get(st) ?? 0, noneRows.length)}`);
  }

  console.log(`\n== TASK 3c: CROSS-TAB category x source_id (top 8 categories x top sources) ==`);
  const topCats = catSorted.slice(0, 8).map(([c]) => c);
  const topSources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const cross = new Map<string, Map<string, number>>();
  for (const r of noneRows) {
    if (!topCats.includes(r.primary_category)) continue;
    let m = cross.get(r.primary_category);
    if (!m) { m = new Map(); cross.set(r.primary_category, m); }
    for (const sid of r.source_ids) m.set(sid, (m.get(sid) ?? 0) + 1);
  }
  console.log(`  category               ${topSources.map(s => s.padEnd(10)).join("")}`);
  for (const cat of topCats) {
    const m = cross.get(cat) ?? new Map();
    console.log(`  ${cat.padEnd(22)} ${topSources.map(s => fmt(m.get(s) ?? 0).padEnd(10)).join("")}`);
  }

  console.log(`\n== TASK 4 PREP: placeholder-name split (isPlaceholderName, exact reused logic), corpus-wide over NONE bucket ==`);
  const placeholderN = noneRows.filter(r => isPlaceholderName(r.canonical_name)).length;
  const namedN = noneRows.length - placeholderN;
  console.log(`  placeholder/unnamed (isPlaceholderName true): ${fmt(placeholderN)} (${pct(placeholderN, noneRows.length)})`);
  console.log(`  named (isPlaceholderName false): ${fmt(namedN)} (${pct(namedN, noneRows.length)})`);
  console.log(`  by top category:`);
  for (const cat of topCats) {
    const catRows = noneRows.filter(r => r.primary_category === cat);
    const ph = catRows.filter(r => isPlaceholderName(r.canonical_name)).length;
    console.log(`    ${cat.padEnd(22)} total ${fmt(catRows.length).padStart(6)}  placeholder ${fmt(ph).padStart(6)} (${pct(ph, catRows.length)})  named ${fmt(catRows.length - ph).padStart(6)} (${pct(catRows.length - ph, catRows.length)})`);
  }

  console.log(`\n== TASK 6 PREP: Wikipedia-affinity NECESSARY PRECONDITION (significantTokens(name) non-empty) ==`);
  const wikiPreconditionN = noneRows.filter(r => significantTokens(r.canonical_name).size > 0).length;
  console.log(`  NONE rows with >=1 significant (non-stopword) token in the name: ${fmt(wikiPreconditionN)} (${pct(wikiPreconditionN, noneRows.length)})`);
  console.log(`  NOTE: this is a NECESSARY-but-not-SUFFICIENT precondition — the real affinity check`);
  console.log(`  (sharesSignificantToken) additionally requires a real nearby Wikipedia article within`);
  console.log(`  100m sharing that token, found via LIVE geosearch. This count is NOT that — it's the`);
  console.log(`  ceiling of rows that could ever pass, before any network check. See the small live-`);
  console.log(`  calibration sample run separately (not bulk) for a real pass-rate estimate.`);

  // ── Sample dump: 20 per top category, full raw payload, for manual QC ──
  console.log(`\n\n########## SAMPLE DUMP — 20 rows per top-5 category, full raw content ##########`);
  const dumpCats = topCats.slice(0, 5);
  for (const cat of dumpCats) {
    const catRows = noneRows.filter(r => r.primary_category === cat);
    console.log(`\n\n===== CATEGORY: ${cat} (${fmt(catRows.length)} total in NONE bucket) — sampling ${Math.min(20, catRows.length)} =====`);
    // deterministic spread: every Nth row for coverage across the set, not just the head
    const step = Math.max(1, Math.floor(catRows.length / 20));
    let shown = 0;
    for (let i = 0; i < catRows.length && shown < 20; i += step) {
      const r = catRows[i];
      const g = geo.get(r.id)!;
      console.log(`\n  --- ${r.canonical_name} | ${r.state} | placeholder=${isPlaceholderName(r.canonical_name)} | (${g.lat}, ${g.lng}) ---`);
      for (const sr of r.srs) {
        console.log(`    [${sr.source_id}:${sr.external_id}] inferred_category=${sr.inferred_category}`);
        console.log(`    raw_payload: ${JSON.stringify(sr.raw_payload)}`);
      }
      shown++;
    }
  }

  // ── Task 5: raw payload shape scan for PAD-US / RIDB / NPS / BLM NONE-bucket rows ──
  console.log(`\n\n########## TASK 5 — raw_payload key scan, NONE-bucket rows, per source (padus/ridb/nps/blm) ##########`);
  for (const srcId of ["padus", "ridb", "nps", "blm"]) {
    const srcSRs: SR[] = [];
    for (const r of noneRows) for (const sr of r.srs) if (sr.source_id === srcId) srcSRs.push(sr);
    console.log(`\n=== ${srcId}: ${fmt(srcSRs.length)} NONE-bucket active source_records ===`);
    if (srcSRs.length === 0) { console.log("  (none)"); continue; }
    // Key frequency across raw_payload, to spot an unused free-text field
    const keyFreq = new Map<string, number>();
    const keyMaxLen = new Map<string, number>();
    for (const sr of srcSRs) {
      const rp = (sr.raw_payload ?? {}) as Record<string, any>;
      for (const [k, v] of Object.entries(rp)) {
        keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1);
        if (typeof v === "string") keyMaxLen.set(k, Math.max(keyMaxLen.get(k) ?? 0, v.length));
      }
    }
    console.log(`  top-level raw_payload keys (freq, max string length if string-typed):`);
    for (const [k, freq] of [...keyFreq.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(24)} freq=${fmt(freq).padStart(6)}  maxStrLen=${keyMaxLen.get(k) ?? "-"}`);
    }
    console.log(`  sample raw_payload (first 5):`);
    for (const sr of srcSRs.slice(0, 5)) {
      console.log(`    ${JSON.stringify(sr.raw_payload).slice(0, 2000)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
