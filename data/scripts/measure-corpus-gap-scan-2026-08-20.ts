/**
 * Read-only corpus gap scan, 2026-08-20. Re-run of measure-llm-eligibility.ts's
 * STRONG/WEAK/NONE breakdown against the CURRENT TEST corpus, extended with:
 *   - source_id / state / OSM-inferred_category breakdowns
 *   - Google-linkage coverage (SR-level, for comparability to the historical
 *     127/165,939 figure, and MP-level, for the state/category breakdown)
 *   - OSM functional-field coverage (ele/capacity/tents/caravans/EV-socket)
 *   - a NONE-bucket sample dump for manual spot-checking
 *   - NONE-bucket x Google-linkage cross-reference
 *
 * A ONE-OFF measurement script — not editing measure-llm-eligibility.ts in
 * place. Bucketing logic imported unchanged from lib/eligibility.ts (shared,
 * fixed-once module). NOT modifying any DB state.
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
const FUNCTIONAL_KEYS = new Set(["ele", "capacity", "tents", "caravans"]);
const EV_SOCKET_PREFIX = "socket:";

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

type SR = SRSignals & {
  id: string;
  master_place_id: string | null;
  source_id: string;
  inferred_category: string | null;
  is_google: boolean;
  has_functional_field: boolean;
  raw_element_tags: Record<string, unknown> | null; // OSM only, for spot-check dump
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
    if (r.error || r.data == null) {
      console.error("QUERY FAILED (sr):", r);
      throw new Error("sr fetch failed");
    }
    for (const raw of r.data as Array<{
      id: string;
      master_place_id: string | null;
      source_id: string;
      inferred_category: string | null;
      normalized_payload: any;
      raw_payload: any;
    }>) {
      const s = computeSignals(raw.normalized_payload, raw.raw_payload);
      const rp = (raw.raw_payload ?? {}) as Record<string, any>;
      const elementTags: Record<string, unknown> | null =
        raw.source_id === "osm" && rp.element?.tags && typeof rp.element.tags === "object" && !Array.isArray(rp.element.tags)
          ? rp.element.tags
          : null;
      let hasFunctional = false;
      if (elementTags) {
        for (const k of Object.keys(elementTags)) {
          if (FUNCTIONAL_KEYS.has(k) || k.startsWith(EV_SOCKET_PREFIX)) { hasFunctional = true; break; }
        }
      }
      rows.push({
        id: raw.id,
        master_place_id: raw.master_place_id,
        source_id: raw.source_id,
        inferred_category: raw.inferred_category,
        is_google: GOOGLE_SOURCES.has(raw.source_id),
        has_functional_field: hasFunctional,
        raw_element_tags: elementTags,
        ...s,
      });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  return rows;
}

type MP = {
  id: string;
  primary_category: string;
  lng: number;
  lat: number;
  state: State;
};

async function fetchMPs(db: SupabaseClient): Promise<MP[]> {
  const mps: any[] = [];
  process.stderr.write("Fetching master_place (id, category)…\n");
  let from = 0;
  while (true) {
    const r = await db.from("master_place")
      .select("id, primary_category")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … mp ${from}\n`);
  }
  process.stderr.write("Fetching master_place geometry (from master_place_search_export)…\n");
  const geo = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export")
      .select("id, lng, lat")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const out: MP[] = [];
  for (const m of mps) {
    const g = geo.get(m.id);
    if (!g) continue; // not in the export view = not "active" for this measurement
    out.push({ id: m.id, primary_category: m.primary_category, lng: g.lng, lat: g.lat, state: classifyState(g.lng, g.lat) });
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

  // ── Raw, unfiltered totals (logged per task instructions) ──
  const mpTotalR = await db.from("master_place").select("*", { count: "exact", head: true });
  if (mpTotalR.error || mpTotalR.count == null) { console.error("QUERY FAILED (mp total):", mpTotalR); throw new Error(""); }
  const srTotalR = await db.from("source_record").select("*", { count: "exact", head: true });
  if (srTotalR.error || srTotalR.count == null) { console.error("QUERY FAILED (sr total):", srTotalR); throw new Error(""); }
  const srActiveR = await db.from("source_record").select("*", { count: "exact", head: true }).eq("is_active", true);
  if (srActiveR.error || srActiveR.count == null) { console.error("QUERY FAILED (sr active):", srActiveR); throw new Error(""); }
  console.log(`Total master_place rows queried (unfiltered): ${fmt(mpTotalR.count)}`);
  console.log(`Total source_record rows queried (all / active): ${fmt(srTotalR.count)} / ${fmt(srActiveR.count)}`);

  const mps = await fetchMPs(db);
  console.log(`  in-scope MPs (searchable + geometry, i.e. in master_place_search_export): ${fmt(mps.length)}`);

  const srs = await fetchSRSignals(db);
  console.log(`  active source_records probed: ${fmt(srs.length)}`);

  // Aggregate signals per MP
  type MPSig = AggregatedSignals & { source_ids: Set<string>; has_google: boolean };
  const sigs = new Map<string, MPSig>();
  for (const sr of srs) {
    if (!sr.master_place_id) continue;
    let s = sigs.get(sr.master_place_id);
    if (!s) {
      s = { ...emptyAggregatedSignals(), source_ids: new Set(), has_google: false };
      sigs.set(sr.master_place_id, s);
    }
    s.source_ids.add(sr.source_id);
    if (sr.is_google) s.has_google = true;
    foldSignalsInto(s, sr);
  }

  const mpsWithSR = mps.filter(m => sigs.has(m.id));
  const N = mpsWithSR.length;
  console.log(`  MPs with at least one active SR: ${fmt(N)}`);

  function bucketOf(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s)) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  // ── 1. Overall buckets ──
  let strong = 0, weak = 0, none = 0;
  for (const m of mpsWithSR) {
    const b = bucketOf(sigs.get(m.id)!);
    if (b === "STRONG") strong++; else if (b === "WEAK") weak++; else none++;
  }
  console.log("\n══ OVERALL BUCKETS ══");
  console.log(`  STRONG: ${fmt(strong)} (${pct(strong, N)})`);
  console.log(`  WEAK:   ${fmt(weak)} (${pct(weak, N)})`);
  console.log(`  NONE:   ${fmt(none)} (${pct(none, N)})`);

  // ── 2a. By source_id ──
  console.log("\n══ BY SOURCE_ID (MP bucket, restricted to MPs holding >=1 active SR from that source) ══");
  const SOURCE_IDS = ["osm", "padus", "usfs", "ridb", "nps", "blm", "google_resolved", "google"];
  // atlas_oddities landed via #241 (Atlas Obscura adapter) after the original
  // eligibility script's source list was drafted — not in the task's ask, but
  // reported anyway since it's now a live corpus source.
  const SUPPLEMENTARY_SOURCE_IDS = ["atlas_oddities"];
  console.log("  source            n_mps   strong%   weak%   none%   | SR-level: has_web  has_wiki  has_phone  has_hours");
  for (const src of SOURCE_IDS) {
    const mpIds = new Set<string>();
    for (const sr of srs) if (sr.source_id === src && sr.master_place_id) mpIds.add(sr.master_place_id);
    let s = 0, w = 0, n = 0;
    for (const id of mpIds) {
      const sig = sigs.get(id);
      if (!sig) continue;
      const b = bucketOf(sig);
      if (b === "STRONG") s++; else if (b === "WEAK") w++; else n++;
    }
    const total = s + w + n;
    // SR-level signal presence, direct on that source's own records
    const srRows = srs.filter(r => r.source_id === src);
    const srN = srRows.length;
    const webN = srRows.filter(r => r.has_website).length;
    const wikiN = srRows.filter(r => r.has_wikipedia || r.has_wikidata).length;
    const phoneN = srRows.filter(r => r.has_phone).length;
    const hoursN = srRows.filter(r => r.has_hours).length;
    console.log(`  ${src.padEnd(16)} ${fmt(total).padStart(7)}  ${pct(s, total).padStart(7)} ${pct(w, total).padStart(7)} ${pct(n, total).padStart(7)}   | n=${fmt(srN).padStart(6)}  ${pct(webN, srN).padStart(7)}  ${pct(wikiN, srN).padStart(7)}   ${pct(phoneN, srN).padStart(7)}   ${pct(hoursN, srN).padStart(7)}`);
  }
  console.log("  NOTE: has_meaningful_tags is structurally OSM-only (raw tag dict shape differs per");
  console.log("  source); STRONG% differences above driven by that signal are NOT a content finding.");
  console.log("\n  -- supplementary: sources not in the original task ask, reported for completeness --");
  for (const src of SUPPLEMENTARY_SOURCE_IDS) {
    const mpIds = new Set<string>();
    for (const sr of srs) if (sr.source_id === src && sr.master_place_id) mpIds.add(sr.master_place_id);
    let s = 0, w = 0, n = 0;
    for (const id of mpIds) {
      const sig = sigs.get(id);
      if (!sig) continue;
      const b = bucketOf(sig);
      if (b === "STRONG") s++; else if (b === "WEAK") w++; else n++;
    }
    const total = s + w + n;
    const srRows = srs.filter(r => r.source_id === src);
    const srN = srRows.length;
    const webN = srRows.filter(r => r.has_website).length;
    const wikiN = srRows.filter(r => r.has_wikipedia || r.has_wikidata).length;
    const phoneN = srRows.filter(r => r.has_phone).length;
    const hoursN = srRows.filter(r => r.has_hours).length;
    console.log(`  ${src.padEnd(16)} ${fmt(total).padStart(7)}  ${pct(s, total).padStart(7)} ${pct(w, total).padStart(7)} ${pct(n, total).padStart(7)}   | n=${fmt(srN).padStart(6)}  ${pct(webN, srN).padStart(7)}  ${pct(wikiN, srN).padStart(7)}   ${pct(phoneN, srN).padStart(7)}   ${pct(hoursN, srN).padStart(7)}`);
  }

  // ── 2b. By state ──
  console.log("\n══ BY STATE ══");
  console.log("  state       n         strong    weak    none    strong%");
  const byState = new Map<State, { n: number; strong: number; weak: number; none: number }>();
  for (const m of mpsWithSR) {
    const b = bucketOf(sigs.get(m.id)!);
    let row = byState.get(m.state);
    if (!row) { row = { n: 0, strong: 0, weak: 0, none: 0 }; byState.set(m.state, row); }
    row.n++;
    if (b === "STRONG") row.strong++; else if (b === "WEAK") row.weak++; else row.none++;
  }
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) {
    const r = byState.get(st) ?? { n: 0, strong: 0, weak: 0, none: 0 };
    console.log(`  ${st.padEnd(10)}${fmt(r.n).padStart(8)}  ${fmt(r.strong).padStart(7)} ${fmt(r.weak).padStart(7)} ${fmt(r.none).padStart(7)}   ${pct(r.strong, r.n)}`);
  }

  // ── 2c. By inferred_category, OSM rows only ──
  console.log("\n══ BY INFERRED_CATEGORY (OSM rows only — MP bucket, MPs restricted to holding an active OSM SR of that category) ══");
  const byOsmCat = new Map<string, Set<string>>();
  for (const sr of srs) {
    if (sr.source_id !== "osm" || !sr.master_place_id) continue;
    const cat = sr.inferred_category ?? "(null)";
    let set = byOsmCat.get(cat);
    if (!set) { set = new Set(); byOsmCat.set(cat, set); }
    set.add(sr.master_place_id);
  }
  const osmCatRows = [...byOsmCat.entries()].map(([cat, ids]) => {
    let s = 0, w = 0, none = 0;
    for (const id of ids) {
      const sig = sigs.get(id);
      if (!sig) continue;
      const b = bucketOf(sig);
      if (b === "STRONG") s++; else if (b === "WEAK") w++; else none++;
    }
    return { cat, total: s + w + none, s, w, none };
  }).sort((a, b) => b.total - a.total);
  console.log("  category                 n_mps   strong%   weak%   none%");
  for (const row of osmCatRows) {
    console.log(`  ${row.cat.padEnd(24)} ${fmt(row.total).padStart(7)}  ${pct(row.s, row.total).padStart(7)} ${pct(row.w, row.total).padStart(7)} ${pct(row.none, row.total).padStart(7)}`);
  }

  // ── 3. Google-linkage coverage ──
  console.log("\n══ GOOGLE LINKAGE COVERAGE ══");
  const googleSR = srs.filter(r => r.is_google);
  console.log(`  SR-level (comparable to historical 127/165,939 figure): ${fmt(googleSR.length)} active google/google_resolved SR / ${fmt(srs.length)} total active SR = ${pct(googleSR.length, srs.length)}`);
  const mpWithGoogle = mpsWithSR.filter(m => sigs.get(m.id)!.has_google);
  console.log(`  MP-level, corpus-wide (in-scope MPs): ${fmt(mpWithGoogle.length)} / ${fmt(N)} = ${pct(mpWithGoogle.length, N)}`);

  console.log("\n  by state:");
  const glByState = new Map<State, { n: number; g: number }>();
  for (const m of mpsWithSR) {
    let row = glByState.get(m.state);
    if (!row) { row = { n: 0, g: 0 }; glByState.set(m.state, row); }
    row.n++;
    if (sigs.get(m.id)!.has_google) row.g++;
  }
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) {
    const r = glByState.get(st) ?? { n: 0, g: 0 };
    console.log(`    ${st.padEnd(10)}${fmt(r.g).padStart(6)} / ${fmt(r.n).padStart(8)} = ${pct(r.g, r.n)}`);
  }

  console.log("\n  by category (min n=50), top 30 by n:");
  const glByCat = new Map<string, { n: number; g: number }>();
  for (const m of mpsWithSR) {
    let row = glByCat.get(m.primary_category);
    if (!row) { row = { n: 0, g: 0 }; glByCat.set(m.primary_category, row); }
    row.n++;
    if (sigs.get(m.id)!.has_google) row.g++;
  }
  const glCatRows = [...glByCat.entries()].filter(([_, r]) => r.n >= 50).sort((a, b) => b[1].n - a[1].n);
  for (const [cat, r] of glCatRows.slice(0, 30)) {
    console.log(`    ${cat.padEnd(24)} ${fmt(r.g).padStart(6)} / ${fmt(r.n).padStart(8)} = ${pct(r.g, r.n)}`);
  }

  // ── 4. OSM functional-field coverage ──
  console.log("\n══ OSM FUNCTIONAL-FIELD COVERAGE (ele | capacity | tents | caravans | socket:* EV family) ══");
  const osmSRs = srs.filter(r => r.source_id === "osm");
  const osmFunctional = osmSRs.filter(r => r.has_functional_field);
  console.log(`  ${fmt(osmFunctional.length)} / ${fmt(osmSRs.length)} active osm SR carry at least one of these keys = ${pct(osmFunctional.length, osmSRs.length)}`);
  const perKey = { ele: 0, capacity: 0, tents: 0, caravans: 0, ev_socket: 0 };
  for (const r of osmSRs) {
    if (!r.raw_element_tags) continue;
    const keys = Object.keys(r.raw_element_tags);
    if (keys.includes("ele")) perKey.ele++;
    if (keys.includes("capacity")) perKey.capacity++;
    if (keys.includes("tents")) perKey.tents++;
    if (keys.includes("caravans")) perKey.caravans++;
    if (keys.some(k => k.startsWith(EV_SOCKET_PREFIX))) perKey.ev_socket++;
  }
  for (const [k, v] of Object.entries(perKey)) {
    console.log(`    ${k.padEnd(12)} ${fmt(v).padStart(7)} / ${fmt(osmSRs.length)} = ${pct(v, osmSRs.length)}`);
  }

  // ── 5. NONE-bucket spot-check sample ──
  console.log("\n══ NONE-BUCKET SAMPLE FOR SPOT-CHECK (up to 8 per state, spread across categories) ══");
  const noneByState = new Map<State, MP[]>();
  for (const m of mpsWithSR) {
    const b = bucketOf(sigs.get(m.id)!);
    if (b !== "NONE") continue;
    let arr = noneByState.get(m.state);
    if (!arr) { arr = []; noneByState.set(m.state, arr); }
    arr.push(m);
  }
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ"] as State[]) {
    const arr = noneByState.get(st) ?? [];
    // spread across categories: take one per distinct category, up to 8
    const seenCat = new Set<string>();
    const sample: MP[] = [];
    for (const m of arr) {
      if (sample.length >= 8) break;
      if (seenCat.has(m.primary_category)) continue;
      seenCat.add(m.primary_category);
      sample.push(m);
    }
    // fill remainder if fewer than 8 distinct categories available
    if (sample.length < 8) {
      for (const m of arr) {
        if (sample.length >= 8) break;
        if (!sample.includes(m)) sample.push(m);
      }
    }
    console.log(`\n  -- ${st} (${fmt(arr.length)} NONE-bucket MPs total, sampling ${sample.length}) --`);
    for (const m of sample) {
      const sig = sigs.get(m.id)!;
      const srsForMP = srs.filter(r => r.master_place_id === m.id);
      const tagSummary = srsForMP.map(r => {
        if (r.source_id === "osm" && r.raw_element_tags) {
          return `osm:{${Object.keys(r.raw_element_tags).slice(0, 12).join(",")}}`;
        }
        return `${r.source_id}:sr=${r.id.slice(0, 8)}`;
      }).join("  ");
      console.log(`    ${m.id.slice(0, 8)}  cat=${m.primary_category.padEnd(20)} sources=[${[...sig.source_ids].join(",")}] ${tagSummary}`);
    }
  }

  // ── 6. NONE-bucket x Google-linkage cross-reference ──
  console.log("\n══ NONE-BUCKET x GOOGLE-LINKAGE CROSS-REFERENCE ══");
  const noneMPs = mpsWithSR.filter(m => bucketOf(sigs.get(m.id)!) === "NONE");
  const noneAndNoGoogle = noneMPs.filter(m => !sigs.get(m.id)!.has_google);
  const noneAndGoogle = noneMPs.length - noneAndNoGoogle.length;
  console.log(`  NONE-bucket MPs: ${fmt(noneMPs.length)}`);
  console.log(`  ...of which lack Google linkage: ${fmt(noneAndNoGoogle.length)} (${pct(noneAndNoGoogle.length, noneMPs.length)})`);
  console.log(`  ...of which ARE Google-linked (thin bucket but Google-linkable already happened): ${fmt(noneAndGoogle)} (${pct(noneAndGoogle, noneMPs.length)})`);
}

main().catch(e => { console.error(e); process.exit(1); });
