/** TEST-only DRY-RUN: replay the placeholder-name fix over the 945 pending
 *  place_match rows from the UT camping ingest. NO DB WRITES.
 *
 *  For each pending row: recompute name_similarity under the new rule (0 if
 *  either name is a placeholder), recompute combined_confidence, then
 *  classify per the matcher's Step-4/Step-5 flow. Reports the new
 *  distribution and a `flip_reason` column for the ones that change. */
import { getDb } from "../ingestion/lib/db.ts";
import { isPlaceholderName } from "../entity-resolution/matcher.ts";

interface Row {
  id: string;
  source_record_id: string;
  master_place_id: string;
  distance_meters: number;
  name_similarity_old: number;
  category_compatibility: number;
  combined_confidence_old: number;
  match_method: string;
  sr_name: string;
  sr_source_id: string;
  mp_canonical_name: string;
  mp_sources: Set<string>;
  // Derived under the fix:
  name_similarity_new: number;
  combined_confidence_new: number;
  new_classification: string;
  flip_reason: string | null;
}

function recompute(dist: number, nameSim: number, catCompat: number): number {
  const distanceScore = 1 - Math.min(dist, 100) / 100;
  return 0.4 * distanceScore + 0.4 * nameSim + 0.2 * catCompat;
}

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  // 1. All 945 pending place_match rows (this session's manual_reviews).
  //    The prior spot-check confirmed there are only ~945 pending on TEST at
  //    the moment and they are all from the UT camping run; if the count
  //    exceeds ~1200 something older is bleeding in — surface it.
  // Scope to the 945 from the UT run: the most-recent 945 pending rows,
  // ordered by created_at DESC. PostgREST caps at 1000 anyway.
  const pm = await db
    .from("place_match")
    .select("id, source_record_id, master_place_id, distance_meters, name_similarity, category_compatibility, combined_confidence, match_method")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(945);
  if (pm.error || !pm.data) { console.log("QUERY FAILED:", pm); return; }
  const raw = pm.data as any[];
  console.log(`Loaded ${raw.length} pending place_match rows (target: 945).\n`);

  // 2. Batch-load source_record + master_place details.
  const srIds = [...new Set(raw.map((r) => r.source_record_id))];
  const mpIds = [...new Set(raw.map((r) => r.master_place_id))];
  const srMap = new Map<string, { name: string; source_id: string }>();
  for (let i = 0; i < srIds.length; i += 100) {
    const p = await db.from("source_record").select("id, name, source_id").in("id", srIds.slice(i, i + 100));
    if (p.error) { console.log("SR QUERY FAILED:", p); return; }
    for (const r of p.data ?? []) srMap.set((r as any).id, { name: (r as any).name, source_id: (r as any).source_id });
  }
  const mpMap = new Map<string, string>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const p = await db.from("master_place").select("id, canonical_name").in("id", mpIds.slice(i, i + 100));
    if (p.error) { console.log("MP QUERY FAILED:", p); return; }
    for (const r of p.data ?? []) mpMap.set((r as any).id, (r as any).canonical_name);
  }

  // 3. For each target MP, collect the set of confirmed source_ids linked
  //    to it. `close_nameless` requires the source's source_id to NOT be
  //    among the MP's existing sources (masterPlaceHasSource guard).
  const mpSources = new Map<string, Set<string>>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const chunk = mpIds.slice(i, i + 100);
    const p = await db
      .from("place_match")
      .select("master_place_id, source_record_id")
      .in("master_place_id", chunk)
      .eq("status", "confirmed");
    if (p.error) { console.log("MP-SRC QUERY FAILED:", p); return; }
    const linkedSrIds = [...new Set((p.data ?? []).map((r: any) => r.source_record_id))];
    const srSourceMap = new Map<string, string>();
    for (let j = 0; j < linkedSrIds.length; j += 100) {
      const s = await db.from("source_record").select("id, source_id").in("id", linkedSrIds.slice(j, j + 100));
      if (s.error) { console.log("MP-LINKED-SR QUERY FAILED:", s); return; }
      for (const r of s.data ?? []) srSourceMap.set((r as any).id, (r as any).source_id);
    }
    for (const pm of (p.data ?? []) as any[]) {
      if (!mpSources.has(pm.master_place_id)) mpSources.set(pm.master_place_id, new Set());
      const sid = srSourceMap.get(pm.source_record_id);
      if (sid) mpSources.get(pm.master_place_id)!.add(sid);
    }
  }

  // 4. Simulate re-scoring under the fix.
  const rows: Row[] = raw.map((r) => {
    const sr = srMap.get(r.source_record_id) ?? { name: "", source_id: "" };
    const mpName = mpMap.get(r.master_place_id) ?? "";
    const eitherPlaceholder = isPlaceholderName(sr.name) || isPlaceholderName(mpName);
    const name_new = eitherPlaceholder ? 0 : (r.name_similarity as number);
    const conf_new = recompute(r.distance_meters, name_new, r.category_compatibility);
    return {
      id: r.id,
      source_record_id: r.source_record_id,
      master_place_id: r.master_place_id,
      distance_meters: r.distance_meters,
      name_similarity_old: r.name_similarity,
      category_compatibility: r.category_compatibility,
      combined_confidence_old: r.combined_confidence,
      match_method: r.match_method,
      sr_name: sr.name,
      sr_source_id: sr.source_id,
      mp_canonical_name: mpName,
      mp_sources: mpSources.get(r.master_place_id) ?? new Set(),
      name_similarity_new: name_new,
      combined_confidence_new: conf_new,
      new_classification: "?",
      flip_reason: null,
    };
  });

  // 5. Classify under the fix. Matches matchOne's Step-4/Step-5 order:
  //    - close_nameless: dist≤100 AND name_sim<0.85 AND cat≥0.8 AND
  //                      source_id NOT already on the MP.
  //    - blended:        conf≥0.85 auto_link, ≥0.6 manual_review, else new.
  for (const r of rows) {
    const canCloseNameless =
      r.distance_meters <= 100 &&
      r.name_similarity_new < 0.85 &&
      r.category_compatibility >= 0.8 &&
      !r.mp_sources.has(r.sr_source_id);
    if (canCloseNameless) {
      r.new_classification = "close_nameless (manual_review)";
    } else if (r.combined_confidence_new >= 0.85) {
      r.new_classification = "auto_link";
    } else if (r.combined_confidence_new >= 0.6) {
      r.new_classification = "blended_residual (manual_review)";
    } else {
      r.new_classification = "new_master_place";
    }
    if (r.name_similarity_old !== r.name_similarity_new) {
      r.flip_reason = "placeholder-zeroed";
    }
  }

  // 6. Aggregate.
  const dist: Record<string, number> = {};
  const placeholderCounts = { src_only: 0, mp_only: 0, both: 0, neither: 0 };
  for (const r of rows) {
    dist[r.new_classification] = (dist[r.new_classification] ?? 0) + 1;
    const srPh = isPlaceholderName(r.sr_name);
    const mpPh = isPlaceholderName(r.mp_canonical_name);
    if (srPh && mpPh) placeholderCounts.both++;
    else if (srPh) placeholderCounts.src_only++;
    else if (mpPh) placeholderCounts.mp_only++;
    else placeholderCounts.neither++;
  }
  console.log("═══ NEW classification distribution ═══");
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(38)} ${v.toString().padStart(4)}  (${(100 * v / rows.length).toFixed(1)}%)`);
  }
  console.log("\n═══ placeholder-name presence ═══");
  console.log(`  both sides placeholder     : ${placeholderCounts.both}`);
  console.log(`  only source_record         : ${placeholderCounts.src_only}`);
  console.log(`  only master_place          : ${placeholderCounts.mp_only}`);
  console.log(`  neither (real names both)  : ${placeholderCounts.neither}`);

  // 7. Distance bins for the flipped-to-new_master_place set — sanity-check
  //    that the ones being split are not tight duplicates.
  const flipped = rows.filter((r) => r.new_classification === "new_master_place");
  const distBins: Record<string, number> = { "0-25m": 0, "25-50m": 0, "50-100m": 0, "100-500m": 0, "500m-2km": 0, ">2km": 0 };
  for (const r of flipped) {
    const d = r.distance_meters;
    if (d <= 25) distBins["0-25m"]++;
    else if (d <= 50) distBins["25-50m"]++;
    else if (d <= 100) distBins["50-100m"]++;
    else if (d <= 500) distBins["100-500m"]++;
    else if (d <= 2000) distBins["500m-2km"]++;
    else distBins[">2km"]++;
  }
  console.log(`\n═══ flipped-to-new_master_place distance bins (n=${flipped.length}) ═══`);
  for (const [k, v] of Object.entries(distBins)) console.log(`  ${k.padEnd(12)} ${v}`);

  // 8. Persist the row-level classification to /tmp so the spot-check
  //    script (step 5) can pick 10 flipped rows without re-running the
  //    simulation.
  const fs = await import("node:fs");
  const path = "/tmp/dryrun-classification.json";
  fs.writeFileSync(path, JSON.stringify(rows.map((r) => ({
    place_match_id: r.id,
    source_record_id: r.source_record_id,
    master_place_id: r.master_place_id,
    distance_meters: r.distance_meters,
    name_similarity_old: r.name_similarity_old,
    name_similarity_new: r.name_similarity_new,
    combined_confidence_old: r.combined_confidence_old,
    combined_confidence_new: r.combined_confidence_new,
    new_classification: r.new_classification,
    flip_reason: r.flip_reason,
    sr_name: r.sr_name,
    mp_canonical_name: r.mp_canonical_name,
  })), null, 2));
  console.log(`\nWrote row-level classification to ${path}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
