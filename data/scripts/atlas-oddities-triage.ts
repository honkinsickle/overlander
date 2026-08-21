/**
 * Read-only triage of the 149 pending place_match rows for atlas_oddities.
 * Pulls: AO name/external_id, MP name/primary_category/source_count, the
 * MP's current source list, and every scoring column from place_match.
 * Categorizes into three buckets by name similarity + distance. NO WRITES.
 *
 * The bucket thresholds live here and NOT in the DB — this is a triage
 * proposal Adam is reviewing, not policy code.
 */
import { getDb } from "../ingestion/lib/db.ts";
import { writeFileSync } from "node:fs";

interface PendingRow {
  place_match_id: string;
  source_record_id: string;
  master_place_id: string;
  ao_external_id: string;
  ao_name: string;
  mp_name: string;
  mp_primary_category: string | null;
  mp_source_count: number;
  distance_meters: number;
  name_similarity: number;
  category_compatibility: number;
  combined_confidence: number;
  match_method: string;
  mp_source_ids: string[];
}

type Bucket = "likely_same" | "ambiguous" | "likely_distinct";

/**
 * Bucketing thresholds — a proposal to spot-check, not policy.
 *
 * Two signals only: name_similarity (0..1) and distance_meters.
 * `combined_confidence` is derived from these plus category_compatibility;
 * bucketing on the components is easier to reason about than the composite.
 *
 * likely_same     — near-identical name AND tight distance.
 * ambiguous       — mid name similarity OR identical name at moderate distance.
 * likely_distinct — low name similarity (regardless of distance — same-coord
 *                   AO pairs that share a venue but are distinct entities
 *                   land here, which is the desired signal, not a bug).
 *
 * Generic-name flag is REPORTED but no longer downgrades the bucket — a
 * 2-token identical name at <10m from a well-sourced NPS/PAD-US MP is
 * almost certainly the same entity, e.g. "Alcatraz Island" ↔ "Alcatraz
 * Island" at 4m. Keeping the flag visible so a reviewer sees it.
 */
function bucketFor(r: PendingRow): { bucket: Bucket; why: string; is_generic_name: boolean } {
  const nameSim = r.name_similarity;
  const dist = r.distance_meters;
  const tokens = r.mp_name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !["the", "a", "an", "of"].includes(t));
  const is_generic_name = tokens.length <= 2;

  if (nameSim >= 0.95 && dist < 20) {
    return {
      bucket: "likely_same",
      why: `name_sim ${nameSim.toFixed(2)} ≥ 0.95 AND dist ${dist.toFixed(1)}m < 20m`,
      is_generic_name,
    };
  }
  if (nameSim < 0.6) {
    return {
      bucket: "likely_distinct",
      why: `name_sim ${nameSim.toFixed(2)} < 0.60 — names don't correspond`,
      is_generic_name,
    };
  }
  return {
    bucket: "ambiguous",
    why: `name_sim ${nameSim.toFixed(2)} in [0.60, 0.95) OR identical name at ≥20m`,
    is_generic_name,
  };
}

async function main() {
  const db = getDb();

  // Step 1: fetch the 149 pending rows where the source_record is atlas_oddities.
  const pending = await db
    .from("place_match")
    .select(`
      id,
      source_record_id,
      master_place_id,
      distance_meters,
      name_similarity,
      category_compatibility,
      combined_confidence,
      match_method,
      source_record!inner ( id, external_id, name, source_id, inferred_category ),
      master_place!inner ( id, canonical_name, primary_category, source_count )
    `)
    .eq("status", "pending")
    .eq("source_record.source_id", "atlas_oddities");
  if (pending.error || pending.data == null) {
    console.error("QUERY FAILED pending:", pending);
    process.exit(1);
  }
  if (pending.data.length !== 149) {
    console.warn(`WARN: expected 149 pending rows, got ${pending.data.length}`);
  }

  const mpIds = [...new Set(pending.data.map((p: any) => p.master_place_id))];

  // Step 2: for each MP, fetch every current source_record's source_id so we
  // know what an accept would be merging AO into.
  const srByMp = new Map<string, string[]>();
  const CHUNK = 100;
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .in("master_place_id", chunk);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED sr:", r);
      process.exit(1);
    }
    for (const row of r.data) {
      const arr = srByMp.get(row.master_place_id) ?? [];
      arr.push(row.source_id);
      srByMp.set(row.master_place_id, arr);
    }
  }

  const rows: PendingRow[] = pending.data.map((p: any) => ({
    place_match_id: p.id,
    source_record_id: p.source_record_id,
    master_place_id: p.master_place_id,
    ao_external_id: p.source_record.external_id,
    ao_name: p.source_record.name,
    mp_name: p.master_place.canonical_name,
    mp_primary_category: p.master_place.primary_category,
    mp_source_count: p.master_place.source_count,
    distance_meters: p.distance_meters,
    name_similarity: p.name_similarity,
    category_compatibility: p.category_compatibility,
    combined_confidence: p.combined_confidence,
    match_method: p.match_method,
    mp_source_ids: (srByMp.get(p.master_place_id) ?? []).sort(),
  }));

  // Assign buckets.
  const buckets: Record<Bucket, (PendingRow & { why: string; is_generic_name: boolean })[]> = {
    likely_same: [],
    ambiguous: [],
    likely_distinct: [],
  };
  for (const r of rows) {
    const b = bucketFor(r);
    buckets[b.bucket].push({ ...r, why: b.why, is_generic_name: b.is_generic_name });
  }

  // Structural summaries.
  const catCounter: Record<string, number> = {};
  const srIdsCounter: Record<string, number> = {};
  const methodCounter: Record<string, number> = {};
  for (const r of rows) {
    catCounter[r.mp_primary_category ?? "(null)"] = (catCounter[r.mp_primary_category ?? "(null)"] ?? 0) + 1;
    methodCounter[r.match_method] = (methodCounter[r.match_method] ?? 0) + 1;
    const key = r.mp_source_ids.join(",") || "(none)";
    srIdsCounter[key] = (srIdsCounter[key] ?? 0) + 1;
  }
  // Also, per bucket, source-set concentration.
  const perBucketSrCounter: Record<Bucket, Record<string, number>> = {
    likely_same: {}, ambiguous: {}, likely_distinct: {},
  };
  for (const [bkt, arr] of Object.entries(buckets) as [Bucket, PendingRow[]][]) {
    for (const r of arr) {
      const key = r.mp_source_ids.join(",") || "(none)";
      perBucketSrCounter[bkt][key] = (perBucketSrCounter[bkt][key] ?? 0) + 1;
    }
  }

  const summary = {
    total: rows.length,
    by_bucket: {
      likely_same: buckets.likely_same.length,
      ambiguous: buckets.ambiguous.length,
      likely_distinct: buckets.likely_distinct.length,
    },
    mp_primary_category: catCounter,
    match_method: methodCounter,
    mp_source_id_sets: srIdsCounter,
    per_bucket_source_sets: perBucketSrCounter,
  };
  console.log("SUMMARY:", JSON.stringify(summary, null, 2));

  // Persist full list for review.
  const path = "/tmp/ao-triage-149.jsonl";
  const lines = [
    ...buckets.likely_same.map((r) => JSON.stringify({ bucket: "likely_same", ...r })),
    ...buckets.ambiguous.map((r) => JSON.stringify({ bucket: "ambiguous", ...r })),
    ...buckets.likely_distinct.map((r) => JSON.stringify({ bucket: "likely_distinct", ...r })),
  ];
  writeFileSync(path, lines.join("\n") + "\n");
  console.log(`\nWROTE ${lines.length} rows → ${path}`);

  // Samples per bucket (10 rows each, sorted by confidence desc).
  for (const bkt of ["likely_same", "ambiguous", "likely_distinct"] as Bucket[]) {
    const arr = [...buckets[bkt]].sort((a, b) => b.combined_confidence - a.combined_confidence);
    const sample = arr.slice(0, 10).map((r) => ({
      ao: r.ao_name,
      mp: r.mp_name,
      conf: +r.combined_confidence.toFixed(3),
      dist_m: +r.distance_meters.toFixed(1),
      name_sim: +r.name_similarity.toFixed(3),
      mp_cat: r.mp_primary_category,
      mp_srcs: r.mp_source_ids,
      why: r.why,
    }));
    console.log(`\n${bkt.toUpperCase()} sample (top ${sample.length} by confidence):`);
    console.log(JSON.stringify(sample, null, 2));
  }
}

main().catch((err) => {
  console.error("triage: fatal", err);
  process.exit(1);
});
