/**
 * Read-only, one-off. Investigates whether OSM NONE-bucket rows carry any
 * raw tag key with real free-text/prose content that the current
 * eligibility check (data/scripts/lib/eligibility.ts) doesn't read —
 * mirroring the USFS/BLM/RIDB missed-field pattern, scoped to OSM.
 *
 * Structural note verified by this script, not assumed: because
 * `foldSignalsInto` sets has_meaningful on EITHER a MEANINGFUL_OSM_KEYS hit
 * OR raw_tag_count >= 5, every OSM source_record attached to a NONE-bucket
 * master_place must independently satisfy: (a) zero of the 10
 * MEANINGFUL_OSM_KEYS present, AND (b) fewer than 5 total raw tags. That's
 * a hard ceiling on how much could be hiding in any single row — but it
 * does NOT rule out a single not-yet-recognized prose-bearing key turning
 * up inside a 1-4 tag row (the exact shape of the USFS/RIDB directions
 * gap), which is what this script hunts for.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals, emptyAggregatedSignals, foldSignalsInto,
  isStrong as isStrongSignals, isWeak as isWeakSignals,
  MEANINGFUL_OSM_KEYS,
  type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;

// Keys already read by SOME eligibility signal today — for exclusion from
// the "candidate" list. Kept explicit and exhaustive rather than inferred,
// so the exclusion list is auditable against computeSignals() directly.
const ALREADY_READ_RAW_KEYS = new Set([
  "website", "url",           // has_website
  "phone",                     // has_phone
  "opening_hours",             // has_hours
  "wikipedia",                  // has_wikipedia (also in MEANINGFUL_OSM_KEYS)
  "wikidata",                   // has_wikidata (also in MEANINGFUL_OSM_KEYS)
  ...MEANINGFUL_OSM_KEYS,       // description, note, historic_name, historic:name,
                                 // heritage, operator, cuisine, name:en, alt_name,
                                 // wikipedia, wikidata
]);

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
    const r = await db.from("master_place").select("id, primary_category").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const geo = new Set<string>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    for (const row of r.data as any[]) geo.add(row.id);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }

  type SR = { master_place_id: string; source_id: string; external_id: string; inferred_category: string | null; normalized_payload: any; raw_payload: any };
  const allSR: SR[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id, source_id, external_id, inferred_category, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(JSON.stringify(r.error));
    allSR.push(...(r.data as SR[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  console.log(`Active source_record rows queried: ${fmt(allSR.length)}`);

  // Bucket every in-scope MP.
  const sigByMp = new Map<string, AggregatedSignals>();
  const srByMp = new Map<string, SR[]>();
  for (const sr of allSR) {
    if (!sr.master_place_id) continue;
    let s = sigByMp.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigByMp.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
    let arr = srByMp.get(sr.master_place_id);
    if (!arr) { arr = []; srByMp.set(sr.master_place_id, arr); }
    arr.push(sr);
  }
  function bucket(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s)) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  // Collect OSM source_records attached to NONE-bucket, in-scope MPs.
  type OsmRow = { mpId: string; category: string; extId: string; tags: Record<string, unknown> };
  const osmNoneRows: OsmRow[] = [];
  let noneMpCount = 0, noneMpWithOsm = 0;
  for (const m of mps) {
    if (!geo.has(m.id)) continue;
    const sig = sigByMp.get(m.id);
    if (!sig) continue;
    if (bucket(sig) !== "NONE") continue;
    noneMpCount++;
    const srs = srByMp.get(m.id)!;
    const osmSrs = srs.filter(sr => sr.source_id === "osm");
    if (osmSrs.length === 0) continue;
    noneMpWithOsm++;
    for (const sr of osmSrs) {
      const rp = (sr.raw_payload ?? {}) as Record<string, any>;
      const tags: Record<string, unknown> = (rp.element?.tags && typeof rp.element.tags === "object") ? rp.element.tags : {};
      osmNoneRows.push({ mpId: m.id, category: m.primary_category, extId: sr.external_id, tags });
    }
  }
  console.log(`\nIn-scope NONE-bucket MPs: ${fmt(noneMpCount)}`);
  console.log(`NONE-bucket MPs carrying >=1 active OSM source: ${fmt(noneMpWithOsm)} (${pct(noneMpWithOsm, noneMpCount)})`);
  console.log(`Total OSM active source_records attached to NONE-bucket MPs (a MP can carry >1): ${fmt(osmNoneRows.length)}`);

  // ── Structural check: confirm the raw_tag_count<5 / zero-meaningful-key ceiling ──
  let maxTagCount = 0, overFour = 0, meaningfulKeyLeak = 0;
  for (const r of osmNoneRows) {
    const n = Object.keys(r.tags).length;
    if (n > maxTagCount) maxTagCount = n;
    if (n >= 5) overFour++;
    for (const k of Object.keys(r.tags)) if (MEANINGFUL_OSM_KEYS.has(k)) meaningfulKeyLeak++;
  }
  console.log(`\n== STRUCTURAL CHECK (verifying the ceiling this script's docstring claims, not assuming it) ==`);
  console.log(`  Max raw tag count observed on any NONE-bucket OSM row: ${fmt(maxTagCount)} (must be <=4 if the ceiling logic is bug-free)`);
  console.log(`  OSM rows with raw_tag_count >= 5: ${fmt(overFour)} (must be 0)`);
  console.log(`  Occurrences of a MEANINGFUL_OSM_KEYS key on a NONE-bucket OSM row: ${fmt(meaningfulKeyLeak)} (must be 0)`);

  // ── Full-corpus tag-key frequency across NONE-bucket OSM rows ──
  const keyFreq = new Map<string, number>();
  const keySampleValues = new Map<string, string[]>();
  for (const r of osmNoneRows) {
    for (const [k, v] of Object.entries(r.tags)) {
      keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1);
      if (typeof v === "string") {
        let arr = keySampleValues.get(k);
        if (!arr) { arr = []; keySampleValues.set(k, arr); }
        if (arr.length < 6) arr.push(v);
      }
    }
  }
  const sorted = [...keyFreq.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n== FULL TAG-KEY FREQUENCY, all ${fmt(osmNoneRows.length)} OSM NONE-bucket source_records (${sorted.length} distinct keys) ==`);
  console.log(`  key                          freq      already-read?`);
  for (const [k, n] of sorted) {
    const already = ALREADY_READ_RAW_KEYS.has(k) ? "YES" : "";
    console.log(`  ${k.padEnd(28)} ${fmt(n).padStart(7)}   ${already}`);
  }

  console.log(`\n== CANDIDATE KEYS (not already read by any signal) — sample values ==`);
  for (const [k, n] of sorted) {
    if (ALREADY_READ_RAW_KEYS.has(k)) continue;
    if (k === "tourism" || k === "leisure" || k === "amenity" || k === "natural" || k === "shop" || k === "highway") continue; // category-defining, not a candidate
    const samples = keySampleValues.get(k) ?? [];
    console.log(`\n  "${k}" — freq ${fmt(n)}`);
    for (const s of samples) console.log(`      "${s}"`);
  }

  // ── Explicit wikipedia/wikidata-as-raw-tag check ──
  console.log(`\n== WIKIPEDIA/WIKIDATA AS RAW TAG ON NONE-BUCKET OSM NODES ==`);
  console.log(`  wikipedia tag occurrences: ${fmt(keyFreq.get("wikipedia") ?? 0)} (expected 0 — computeSignals already reads this into has_wikipedia, which would make the MP STRONG, not NONE)`);
  console.log(`  wikidata tag occurrences: ${fmt(keyFreq.get("wikidata") ?? 0)} (expected 0, same reason)`);

  // ── Explicit contact:* namespaced-tag check (a real candidate not covered above) ──
  console.log(`\n== NAMESPACED contact:* / EMAIL CHECK ==`);
  for (const k of ["contact:website", "contact:phone", "contact:email", "email", "contact:url"]) {
    console.log(`  ${k.padEnd(20)} freq ${fmt(keyFreq.get(k) ?? 0)}`);
  }

  // ── Category breakdown of these OSM NONE rows (dedup by MP) ──
  console.log(`\n== NONE-BUCKET MPs carrying OSM, BY primary_category (dedup per MP) ==`);
  const mpSeen = new Set<string>();
  const catCount = new Map<string, number>();
  for (const r of osmNoneRows) {
    if (mpSeen.has(r.mpId)) continue;
    mpSeen.add(r.mpId);
    catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1);
  }
  for (const [cat, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${cat.padEnd(24)} ${fmt(n)}`);
  }

  // ── Stratified qualitative sample: ~5 per target category, full tag dump ──
  const targetCats = ["trailhead", "park", "facility", "picnic_area", "ev_charging", "campground", "dispersed_camping"];
  console.log(`\n\n########## STRATIFIED SAMPLE DUMP (full raw tags per row) ##########`);
  for (const cat of targetCats) {
    const rowsForCat = osmNoneRows.filter(r => r.category === cat);
    console.log(`\n===== ${cat}: ${fmt(rowsForCat.length)} OSM NONE-bucket source_records =====`);
    if (rowsForCat.length === 0) { console.log("  (none — OSM does not produce this category, or none land in NONE)"); continue; }
    const step = Math.max(1, Math.floor(rowsForCat.length / 5));
    let shown = 0;
    for (let i = 0; i < rowsForCat.length && shown < 5; i += step) {
      const r = rowsForCat[i];
      console.log(`  [${r.extId}] ${JSON.stringify(r.tags)}`);
      shown++;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
