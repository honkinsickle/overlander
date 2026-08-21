/**
 * Read-only, one-off. Strategy-investigation pass against the CORRECTED
 * in-scope NONE bucket (14,043, per measure-corpus-gap-scan-2026-08-21-scoped-fix.ts —
 * the padus scoping bug from measure-corpus-gap-scan-2026-08-20.ts fixed).
 *
 * Covers, in one pass (to avoid re-fetching the ~82k active source_records
 * four separate times):
 *   A. campground/dispersed_camping (+ all-category) name-pattern split:
 *      placeholder / junk-code-like / real, for the "aggressive placeholder
 *      deactivation" variant.
 *   B. real-named NONE-bucket rows: how many resolve to a named containing
 *      unit via place_relationships.contained_in (the "minimal grounded
 *      template" variant's actual ceiling).
 *   C. state_parks + google_resolved raw_payload field scan for a missed
 *      prose field (mirroring the USFS/RIDB/BLM pattern); OSM structural
 *      ceiling re-verified against the CURRENT corrected population.
 *   D. category NONE counts for utility-POI categories (rest_area, water,
 *      toilet, shower, activity_pass) — corpus-wide, in-scope only.
 *
 * NOT modifying any DB state.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  isStrong as isStrongSignals,
  isWeak as isWeakSignals,
  MEANINGFUL_OSM_KEYS,
  type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;

const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}

// Candidate "junk-code-like" name: no spaces, contains a digit, short,
// alphanumeric/dot/dash only. Matches the observed examples ("42", "46",
// "1103-001", "D10.62L") without matching real multi-word names.
function isJunkCodeLike(name: string): boolean {
  const n = name.trim();
  if (n.includes(" ")) return false;
  if (!/\d/.test(n)) return false;
  if (n.length > 15) return false;
  return /^[A-Za-z0-9.\-]+$/.test(n);
}

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`Run: ${new Date().toISOString()}`);

  // ── Fetch in-scope MPs (with geometry for state + canonical_name) ──
  console.log("Fetching master_place_search_export…");
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export")
      .select("id, canonical_name, primary_category, lng, lat")
      .order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`In-scope MPs: ${fmt(mps.length)}`);
  const inScopeIds = new Set(mps.map(m => m.id));

  // ── Fetch active source_record signals, scoped to in-scope MPs ──
  console.log("Fetching active source_records…");
  const srs: any[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    for (const raw of r.data as any[]) {
      if (!raw.master_place_id || !inScopeIds.has(raw.master_place_id)) continue;
      srs.push(raw);
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) console.log(`  … sr ${from}`);
  }
  console.log(`In-scope active source_records: ${fmt(srs.length)}`);

  const sigs = new Map<string, AggregatedSignals>();
  const srByMp = new Map<string, any[]>();
  for (const sr of srs) {
    let s = sigs.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigs.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
    let arr = srByMp.get(sr.master_place_id);
    if (!arr) { arr = []; srByMp.set(sr.master_place_id, arr); }
    arr.push(sr);
  }
  function bucketOf(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s)) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  const noneMPs = mps.filter(m => {
    const s = sigs.get(m.id);
    return s && bucketOf(s) === "NONE";
  });
  console.log(`NONE-bucket in-scope MPs: ${fmt(noneMPs.length)}`);

  // ═══ A. Name-pattern split — campground/dispersed_camping + all categories ═══
  console.log("\n═══ A. NAME-PATTERN SPLIT (placeholder / junk-code-like / real) ═══");
  const byCat = new Map<string, { total: number; placeholder: number; junk: number; real: number }>();
  for (const m of noneMPs) {
    const name = m.canonical_name ?? "";
    let row = byCat.get(m.primary_category);
    if (!row) { row = { total: 0, placeholder: 0, junk: 0, real: 0 }; byCat.set(m.primary_category, row); }
    row.total++;
    if (isPlaceholderName(name)) row.placeholder++;
    else if (isJunkCodeLike(name)) row.junk++;
    else row.real++;
  }
  console.log("\n-- campground & dispersed_camping (target categories) --");
  for (const cat of ["campground", "dispersed_camping"]) {
    const r = byCat.get(cat);
    if (!r) continue;
    console.log(`  ${cat}: total=${fmt(r.total)}  placeholder=${fmt(r.placeholder)} (${pct(r.placeholder, r.total)})  junk-code=${fmt(r.junk)} (${pct(r.junk, r.total)})  real=${fmt(r.real)} (${pct(r.real, r.total)})`);
    console.log(`    placeholder+junk-code combined (candidate deactivation pool): ${fmt(r.placeholder + r.junk)} (${pct(r.placeholder + r.junk, r.total)})`);
  }
  console.log("\n-- all categories, sorted by placeholder+junk share (min n=20) --");
  const allCatRows = [...byCat.entries()]
    .filter(([, r]) => r.total >= 20)
    .map(([cat, r]) => ({ cat, ...r, combinedRate: (r.placeholder + r.junk) / r.total }))
    .sort((a, b) => b.combinedRate - a.combinedRate);
  console.log("  category                 total  placeholder   junk-code   real   combined%");
  for (const r of allCatRows) {
    console.log(`  ${r.cat.padEnd(24)} ${fmt(r.total).padStart(6)}  ${fmt(r.placeholder).padStart(6)} (${pct(r.placeholder, r.total).padStart(6)})  ${fmt(r.junk).padStart(5)} (${pct(r.junk, r.total).padStart(6)})  ${fmt(r.real).padStart(5)}  ${pct(r.placeholder + r.junk, r.total).padStart(7)}`);
  }
  const totalPlaceholderPlusJunk = [...byCat.values()].reduce((a, r) => a + r.placeholder + r.junk, 0);
  console.log(`\n  TOTAL placeholder+junk-code across ALL NONE-bucket categories: ${fmt(totalPlaceholderPlusJunk)} of ${fmt(noneMPs.length)} (${pct(totalPlaceholderPlusJunk, noneMPs.length)})`);
  const totalPlaceholderOnly = [...byCat.values()].reduce((a, r) => a + r.placeholder, 0);
  console.log(`  TOTAL placeholder-only (excl. junk-code, matches today's picnic_area/ev_charging criterion exactly): ${fmt(totalPlaceholderOnly)} of ${fmt(noneMPs.length)} (${pct(totalPlaceholderOnly, noneMPs.length)})`);

  // Sample junk-code-like names for manual eyeball validation of the heuristic
  console.log("\n-- sample of 20 junk-code-like names caught by the heuristic (validate it's not overreaching) --");
  const junkSamples = noneMPs.filter(m => !isPlaceholderName(m.canonical_name ?? "") && isJunkCodeLike(m.canonical_name ?? "")).slice(0, 20);
  for (const m of junkSamples) console.log(`    "${m.canonical_name}" (${m.primary_category})`);

  // ═══ B. Real-named NONE rows: containing-unit resolvability via place_relationships ═══
  console.log("\n═══ B. MINIMAL GROUNDED TEMPLATE — containing-unit resolvability ═══");
  const realNamedNone = noneMPs.filter(m => {
    const name = m.canonical_name ?? "";
    return !isPlaceholderName(name) && !isJunkCodeLike(name);
  });
  console.log(`Real-named (non-placeholder, non-junk-code) NONE-bucket MPs: ${fmt(realNamedNone.length)}`);

  // Fetch place_relationships contained_in for these ids, chunked
  const childToParent = new Map<string, string>();
  const ids = realNamedNone.map(m => m.id);
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const r = await db.from("place_relationships")
      .select("child_master_place_id, parent_master_place_id")
      .eq("relationship_type", "contained_in")
      .in("child_master_place_id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (place_relationships):", r); throw new Error(""); }
    for (const row of r.data as any[]) childToParent.set(row.child_master_place_id, row.parent_master_place_id);
  }
  console.log(`Of those, with a contained_in parent relationship at all: ${fmt(childToParent.size)} (${pct(childToParent.size, realNamedNone.length)})`);

  // Resolve parent canonical_names in chunks, check they're real-named themselves
  const parentIds = [...new Set(childToParent.values())];
  const parentNames = new Map<string, string>();
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const chunk = parentIds.slice(i, i + CHUNK);
    const r = await db.from("master_place").select("id, canonical_name").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (parent names):", r); throw new Error(""); }
    for (const row of r.data as any[]) parentNames.set(row.id, row.canonical_name);
  }
  let withNamedParent = 0;
  const sampleTemplates: string[] = [];
  for (const m of realNamedNone) {
    const parentId = childToParent.get(m.id);
    if (!parentId) continue;
    const parentName = parentNames.get(parentId);
    if (parentName && !isPlaceholderName(parentName)) {
      withNamedParent++;
      if (sampleTemplates.length < 10) {
        sampleTemplates.push(`"${m.canonical_name}" (${m.primary_category}) contained_in "${parentName}"`);
      }
    }
  }
  console.log(`Of those, parent ALSO has a real (non-placeholder) name: ${fmt(withNamedParent)} (${pct(withNamedParent, realNamedNone.length)})`);
  console.log(`\n  Ceiling for "X is a [category] in [named parent unit], [state]" template: ${fmt(withNamedParent)}`);
  console.log(`  Ceiling for bare "X is a [category] in [state]" template (name+category+state always available): ${fmt(realNamedNone.length)}`);
  console.log("\n-- sample of 10 real containing-unit templates --");
  for (const s of sampleTemplates) console.log(`    ${s}`);

  // ═══ C. state_parks + google_resolved missed-field scan; OSM ceiling re-check ═══
  console.log("\n═══ C. MISSED-FIELD SCAN: state_parks, google_resolved ═══");
  for (const src of ["state_parks", "google_resolved"]) {
    const rows = srs.filter(sr => sr.source_id === src && noneMPs.some(m => m.id === sr.master_place_id));
    console.log(`\n-- ${src}: ${fmt(rows.length)} active SRs attached to a NONE-bucket MP --`);
    if (rows.length === 0) continue;
    // key frequency across normalized_payload + raw_payload top-level keys
    const npKeyFreq = new Map<string, number>();
    const rpKeyFreq = new Map<string, number>();
    for (const r of rows) {
      const np = (r.normalized_payload ?? {}) as Record<string, any>;
      for (const k of Object.keys(np)) npKeyFreq.set(k, (npKeyFreq.get(k) ?? 0) + 1);
      const rp = (r.raw_payload ?? {}) as Record<string, any>;
      const rpTop = rp.properties ?? rp.attributes ?? rp;
      if (rpTop && typeof rpTop === "object") {
        for (const k of Object.keys(rpTop)) rpKeyFreq.set(k, (rpKeyFreq.get(k) ?? 0) + 1);
      }
    }
    console.log(`  normalized_payload keys present: ${[...npKeyFreq.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}(${n})`).join(", ")}`);
    console.log(`  raw_payload top-level keys (top 25 by freq): ${[...rpKeyFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,n])=>`${k}(${n})`).join(", ")}`);
    // sample a few raw_payload dumps for eyeball
    console.log(`  -- 3 raw sample rows --`);
    for (const r of rows.slice(0, 3)) {
      console.log(`    sr=${r.id.slice(0,8)}  raw_payload=${JSON.stringify(r.raw_payload).slice(0, 500)}`);
    }
  }

  console.log("\n-- OSM structural ceiling, re-verified against CURRENT corrected NONE population --");
  const osmNoneRows = srs.filter(sr => sr.source_id === "osm" && noneMPs.some(m => m.id === sr.master_place_id));
  let maxTags = 0, over4 = 0, meaningfulLeak = 0;
  for (const sr of osmNoneRows) {
    const rp = (sr.raw_payload ?? {}) as Record<string, any>;
    const tags = (rp.element?.tags && typeof rp.element.tags === "object") ? rp.element.tags : {};
    const n = Object.keys(tags).length;
    if (n > maxTags) maxTags = n;
    if (n >= 5) over4++;
    for (const k of Object.keys(tags)) if (MEANINGFUL_OSM_KEYS.has(k)) meaningfulLeak++;
  }
  console.log(`  OSM active SRs on a current NONE-bucket MP: ${fmt(osmNoneRows.length)}`);
  console.log(`  Max raw tag count: ${maxTags} (expect <=4)  |  rows with >=5 tags: ${over4} (expect 0)  |  MEANINGFUL_OSM_KEYS leaks: ${meaningfulLeak} (expect 0)`);

  // ═══ D. Utility-POI category NONE counts (corpus-wide, from the byCat map already built) ═══
  console.log("\n═══ D. UTILITY-POI CATEGORY NONE COUNTS (candidates for category-conditional requirement) ═══");
  const utilityCats = ["rest_area", "water", "toilet", "shower", "activity_pass", "hardware", "dump_station", "hut"];
  let utilitySum = 0;
  for (const cat of utilityCats) {
    const r = byCat.get(cat);
    const n = r?.total ?? 0;
    utilitySum += n;
    console.log(`  ${cat.padEnd(16)} ${fmt(n)}`);
  }
  console.log(`  SUM (rest_area+water+toilet+shower+activity_pass+hardware+dump_station+hut): ${fmt(utilitySum)} of ${fmt(noneMPs.length)} (${pct(utilitySum, noneMPs.length)})`);
  const coreUtility = ["rest_area", "water", "toilet", "shower"];
  const coreSum = coreUtility.reduce((a, c) => a + (byCat.get(c)?.total ?? 0), 0);
  console.log(`  CORE-ONLY (rest_area+water+toilet+shower, least ambiguous "utility not destination" set): ${fmt(coreSum)} of ${fmt(noneMPs.length)} (${pct(coreSum, noneMPs.length)})`);
}
main().catch(e => { console.error(e); process.exit(1); });
