/**
 * End-to-end verification for the RIDB photo widening.
 *
 * Runs pois_along_corridor over a Southern-California bbox (matching the
 * STEP-2 ingest region), then reports:
 *   - total rows returned
 *   - rows with non-null nps_photo_url
 *   - broken down by the master_place's backing source (nps vs ridb)
 *
 * Prints a "before" line describing what to expect from the DEPLOYED
 * RPC on TEST (migration 20260805120000, pre-widening: only nps source
 * carries photos through the lateral), then an "after" line describing
 * what to expect once 20260809130000 is applied.
 *
 * READ-ONLY. Uses supabase-js env clients only. No CLI link touched.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`[env] target: ${ref}`);

  // Straight route across the Southern-California / Southern-Nevada bbox we
  // ingested in STEP 2. Buffer wide enough (30 km) to catch RIDB tiles that
  // sit off the diagonal.
  const route = {
    type: "LineString",
    coordinates: [
      [-120.0, 35.0],
      [-114.0, 37.0],
    ],
  };
  const bufferM = 500_000;

  const { data, error } = await db.rpc("pois_along_corridor", {
    p_route: route,
    p_buffer_m: bufferM,
    p_categories: null,
  });
  if (error) throw error;
  const rows = data as Array<{ id: string; nps_photo_url: string | null }>;
  console.log(`\n[RPC] pois_along_corridor rows returned: ${rows.length}`);
  const withPhoto = rows.filter((r) => r.nps_photo_url && r.nps_photo_url.length > 0);
  console.log(`[RPC]   with nps_photo_url populated     : ${withPhoto.length}`);

  // For each returned master_place, determine what source_records back it.
  // Chunked query to avoid header-size limits.
  const idMap = new Map<string, Set<string>>();
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200).map((r) => r.id);
    const { data: srs, error: e2 } = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .in("master_place_id", slice);
    if (e2) throw e2;
    for (const sr of (srs ?? []) as Array<{ master_place_id: string; source_id: string }>) {
      if (!idMap.has(sr.master_place_id)) idMap.set(sr.master_place_id, new Set());
      idMap.get(sr.master_place_id)!.add(sr.source_id);
    }
  }

  // Buckets by backing source composition
  const buckets = { nps_only: 0, ridb_only: 0, both: 0, neither: 0 };
  const photoBuckets = { nps_only: 0, ridb_only: 0, both: 0, neither: 0 };
  for (const r of rows) {
    const s = idMap.get(r.id) ?? new Set<string>();
    const hasNps = s.has("nps");
    const hasRidb = s.has("ridb");
    const key = hasNps && hasRidb ? "both" : hasNps ? "nps_only" : hasRidb ? "ridb_only" : "neither";
    buckets[key] += 1;
    if (r.nps_photo_url && r.nps_photo_url.length > 0) photoBuckets[key] += 1;
  }

  console.log(`\n[RPC] tile composition by backing source`);
  console.log(`  nps only    : ${buckets.nps_only}   with photo: ${photoBuckets.nps_only}`);
  console.log(`  ridb only   : ${buckets.ridb_only}   with photo: ${photoBuckets.ridb_only}`);
  console.log(`  both        : ${buckets.both}   with photo: ${photoBuckets.both}`);
  console.log(`  neither     : ${buckets.neither}   with photo: ${photoBuckets.neither}`);

  console.log(`\n[EXPECTED — pre-migration 20260809130000]`);
  console.log(`  nps_only:    all rows with an NPS photo populate nps_photo_url`);
  console.log(`  ridb_only:   ZERO rows populate nps_photo_url even if the ridb source_record has a photo`);
  console.log(`  both:        NPS wins (only NPS source contributes today)`);
  console.log(`\n[EXPECTED — after applying migration 20260809130000]`);
  console.log(`  nps_only:    unchanged`);
  console.log(`  ridb_only:   rows whose ridb source_record has a photo populate nps_photo_url`);
  console.log(`  both:        still NPS-preferred via ORDER BY case (backward compatible)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
