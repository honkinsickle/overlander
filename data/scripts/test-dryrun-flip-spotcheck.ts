/** Read /tmp/dryrun-classification.json and spot-check 10 of the
 *  flipped-to-new_master_place rows: distance bins spread, so the
 *  tightest cases get eyeballs. Print SR + MP name/coords/tags. */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  const rows = JSON.parse(readFileSync("/tmp/dryrun-classification.json", "utf8")) as any[];
  const flipped = rows.filter((r) => r.new_classification === "new_master_place");
  console.log(`flipped-to-new_master_place count: ${flipped.length}\n`);

  // Stratified sample across distance bins so the tight cases are visible.
  const buckets = { tight: [] as any[], mid: [] as any[], far: [] as any[] };
  for (const r of flipped) {
    if (r.distance_meters <= 50) buckets.tight.push(r);
    else if (r.distance_meters <= 150) buckets.mid.push(r);
    else buckets.far.push(r);
  }
  // Deterministic pick: take from index 0, N/2, N-1 within each bucket to
  // spread across the ordering.
  function pickN(arr: any[], n: number): any[] {
    if (arr.length <= n) return arr;
    const step = Math.floor(arr.length / n);
    return Array.from({ length: n }, (_, i) => arr[i * step]);
  }
  const sample = [
    ...pickN(buckets.tight, 4),   // 24 flips are 25-50m — pick 4
    ...pickN(buckets.mid, 3),      // 93 flips are 50-100m — pick 3
    ...pickN(buckets.far, 3),      // 404 flips are 100-500m — pick 3
  ];

  const srIds = sample.map((r) => r.source_record_id);
  const mpIds = sample.map((r) => r.master_place_id);
  const srR = await db
    .from("source_record")
    .select("id, name, external_id, raw_payload")
    .in("id", srIds);
  const mpR = await db.from("master_place").select("id, canonical_name, primary_category, geometry").in("id", mpIds);
  const srMap = new Map<string, any>();
  for (const r of srR.data ?? []) srMap.set((r as any).id, r);
  const mpMap = new Map<string, any>();
  for (const r of mpR.data ?? []) mpMap.set((r as any).id, r);

  function parsePt(g: any): [number, number] | null {
    if (typeof g === "object" && g?.coordinates) return g.coordinates as [number, number];
    if (typeof g === "string") { try { return (JSON.parse(g) as any).coordinates as [number, number]; } catch { return null; } }
    return null;
  }

  for (const [i, r] of sample.entries()) {
    const sr = srMap.get(r.source_record_id);
    const mp = mpMap.get(r.master_place_id);
    const el = sr?.raw_payload?.element ?? {};
    const tags = el.tags ?? {};
    const srLat = el.lat ?? el.center?.lat;
    const srLon = el.lon ?? el.center?.lon;
    const mpPt = mp ? parsePt(mp.geometry) : null;
    console.log(`── #${(i+1).toString().padStart(2)} ─────────────────────────────`);
    console.log(`  dist=${r.distance_meters.toFixed(1)}m  old_conf=${r.combined_confidence_old.toFixed(3)}  new_conf=${r.combined_confidence_new.toFixed(3)}`);
    console.log(`  old_name_sim=${r.name_similarity_old.toFixed(3)}  →  new_name_sim=${r.name_similarity_new}`);
    console.log(`  SR ${sr?.external_id ?? '?'}: "${sr?.name}" @ [${srLat?.toFixed(5)}, ${srLon?.toFixed(5)}]`);
    console.log(`     tags: ${JSON.stringify(tags)}`);
    console.log(`  MP "${mp?.canonical_name}" (${mp?.primary_category}) @ [${mpPt?.[1]?.toFixed(5)}, ${mpPt?.[0]?.toFixed(5)}]`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
