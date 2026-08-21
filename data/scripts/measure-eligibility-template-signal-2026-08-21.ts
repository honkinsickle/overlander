/**
 * Corpus-wide before/after STRONG/WEAK/NONE bucketing once
 * has_template_description (master_place_generated_content,
 * generation_method='template') is folded into isStrong
 * (lib/eligibility.ts, 2026-08-21 combined eligibility+provenance+review
 * pass).
 *
 * "Before" recomputed in the SAME pass (not a separate earlier run) by
 * zeroing has_template_description and calling the current isStrong —
 * mathematically identical to running the old code, avoids a second
 * full-corpus fetch.
 *
 * Read-only. TEST only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals, emptyAggregatedSignals, foldSignalsInto,
  bucketOf, type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`Project: ${ref} (TEST)`);

  // In-scope population, matching the convention used all session:
  // master_place_search_export (is_searchable, source_count>0, six-state footprint).
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const inScopeIds = new Set(mps.map(m => m.id));
  console.log(`In-scope population (master_place_search_export): ${inScopeIds.size}`);

  const allSR: any[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("id, master_place_id, normalized_payload, raw_payload").eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    for (const s of r.data as any[]) if (s.master_place_id && inScopeIds.has(s.master_place_id)) allSR.push(s);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Active source_records in scope: ${allSR.length}`);

  const sigs = new Map<string, AggregatedSignals>();
  for (const sr of allSR) {
    let s = sigs.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigs.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
  }

  // Which in-scope MPs have a template description row?
  const templateMpIds = new Set<string>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_generated_content").select("master_place_id").eq("generation_method", "template").eq("field_name", "description").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    for (const row of r.data as any[]) if (inScopeIds.has(row.master_place_id)) templateMpIds.add(row.master_place_id);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`In-scope master_places with a template description row: ${templateMpIds.size}`);

  let beforeStrong = 0, beforeWeak = 0, beforeNone = 0;
  let afterStrong = 0, afterWeak = 0, afterNone = 0;
  for (const id of inScopeIds) {
    const s = sigs.get(id) ?? emptyAggregatedSignals();
    // BEFORE: has_template_description forced false, regardless of actual value.
    const before: AggregatedSignals = { ...s, has_template_description: false };
    const beforeBucket = bucketOf(before);
    if (beforeBucket === "STRONG") beforeStrong++; else if (beforeBucket === "WEAK") beforeWeak++; else beforeNone++;

    // AFTER: current logic — has_template_description reflects reality.
    const after: AggregatedSignals = { ...s, has_template_description: templateMpIds.has(id) };
    const afterBucket = bucketOf(after);
    if (afterBucket === "STRONG") afterStrong++; else if (afterBucket === "WEAK") afterWeak++; else afterNone++;
  }

  console.log(`\n=== BEFORE (has_template_description forced off) ===`);
  console.log(`STRONG: ${beforeStrong}  WEAK: ${beforeWeak}  NONE: ${beforeNone}  total: ${beforeStrong + beforeWeak + beforeNone}`);
  console.log(`\n=== AFTER (has_template_description live) ===`);
  console.log(`STRONG: ${afterStrong}  WEAK: ${afterWeak}  NONE: ${afterNone}  total: ${afterStrong + afterWeak + afterNone}`);
  console.log(`\nNONE delta: ${afterNone - beforeNone} (${beforeNone} -> ${afterNone})`);
  console.log(`STRONG delta: ${afterStrong - beforeStrong} (${beforeStrong} -> ${afterStrong})`);
  console.log(`WEAK delta: ${afterWeak - beforeWeak} (${beforeWeak} -> ${afterWeak})`);
}
main().catch(e => { console.error(e); process.exit(1); });
