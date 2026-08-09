/** Sample 10 solo google_resolved master_places (MPs whose ONLY backing
 *  source_record is a google_resolved row). Report canonical_name,
 *  primary_category, geometry, and a data-quality judgment. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Not TEST");

  // All MPs that have at least one google_resolved source_record
  const { data: grLinked, error: e1 } = await db
    .from("source_record")
    .select("master_place_id")
    .eq("source_id", "google_resolved")
    .not("master_place_id", "is", null);
  if (e1) throw e1;
  const mpIdsWithGr = new Set(grLinked!.map((r) => r.master_place_id));
  console.log(`MPs with any google_resolved source_record: ${mpIdsWithGr.size}`);

  // For each, count total source_records — solo = count 1
  const soloIds: string[] = [];
  const chunk = 200;
  const mpArr = [...mpIdsWithGr];
  for (let i = 0; i < mpArr.length; i += chunk) {
    const slice = mpArr.slice(i, i + chunk);
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .in("master_place_id", slice);
    if (error) throw error;
    // Group per MP
    const grouped = new Map<string, string[]>();
    for (const r of data ?? []) {
      if (!r.master_place_id) continue;
      const arr = grouped.get(r.master_place_id) ?? [];
      arr.push(r.source_id);
      grouped.set(r.master_place_id, arr);
    }
    for (const [id, srcs] of grouped) {
      if (srcs.length === 1 && srcs[0] === "google_resolved") soloIds.push(id);
    }
  }
  console.log(`SOLO google_resolved MPs (only source is google_resolved): ${soloIds.length}\n`);

  // Sample 10 by id ordering (deterministic)
  soloIds.sort();
  const sample = soloIds.slice(0, 10);

  // Fetch canonical_name, primary_category, geometry via ST_AsText
  const { data: mpRows, error: e2 } = await db.rpc("pois_along_corridor", {
    p_route: { type: "LineString", coordinates: [[-125, 30], [-100, 50]] },
    p_buffer_m: 2_000_000,
    p_categories: null,
  });
  // Simpler: query master_place directly, but geometry needs ST_X/ST_Y through PostGIS
  // Use master_place_search_export view which already has lng/lat split
  const { data: geoRows } = await db.from("master_place_search_export").select("id, lng, lat").in("id", sample);
  const geoMap = new Map((geoRows ?? []).map((r) => [r.id, { lng: r.lng, lat: r.lat }]));
  void mpRows;
  void e2;

  const { data: rows, error: e3 } = await db
    .from("master_place")
    .select("id, canonical_name, primary_category, description, attribution, prominence_score")
    .in("id", sample);
  if (e3) throw e3;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  // Also pull each MP's google_resolved source_record for context
  const { data: srRows } = await db
    .from("source_record")
    .select("master_place_id, external_id, name, inferred_category, normalized_payload")
    .in("master_place_id", sample)
    .eq("source_id", "google_resolved");
  const srById = new Map((srRows ?? []).map((r) => [r.master_place_id, r]));

  console.log("─── 10 solo google_resolved master_places ───\n");
  for (const id of sample) {
    const mp = byId.get(id)!;
    const geo = geoMap.get(id);
    const sr = srById.get(id);
    console.log(`  ${id}`);
    console.log(`    canonical_name  : ${mp.canonical_name}`);
    console.log(`    primary_category: ${mp.primary_category}`);
    console.log(`    geometry        : ${geo ? `${geo.lng.toFixed(5)}, ${geo.lat.toFixed(5)}` : "(none)"}`);
    console.log(`    prominence      : ${mp.prominence_score}`);
    console.log(`    description     : ${mp.description ? "(present)" : "(null)"}`);
    console.log(`    attribution     : ${JSON.stringify(mp.attribution)}`);
    console.log(`    source ext id   : ${sr?.external_id}`);
    console.log(`    source category : ${sr?.inferred_category}`);
    console.log(`    src norm keys   : ${sr?.normalized_payload ? Object.keys(sr.normalized_payload).join(", ") : "(none)"}`);
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
