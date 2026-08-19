/**
 * Snapshot corpus counts around the atlas_oddities TEST ingest — measured
 * baseline, not a hardcoded one (per CLAUDE.md "Snapshot before…" rule).
 * Prints JSON to stdout so the same script serves before AND after.
 */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();

  const [mp, sr, pm] = await Promise.all([
    db.from("master_place").select("id", { count: "exact", head: true }),
    db.from("source_record").select("id", { count: "exact", head: true }),
    db.from("place_match").select("id", { count: "exact", head: true }),
  ]);

  if (mp.error || mp.count == null) {
    console.error("QUERY FAILED master_place:", mp);
    process.exit(1);
  }
  if (sr.error || sr.count == null) {
    console.error("QUERY FAILED source_record:", sr);
    process.exit(1);
  }
  if (pm.error || pm.count == null) {
    console.error("QUERY FAILED place_match:", pm);
    process.exit(1);
  }

  // source_record grouped by source_id (small number of distinct values;
  // simplest correct way is one count query per known source).
  const KNOWN = [
    "osm", "padus", "usfs", "ridb", "nps", "blm",
    "google", "google_resolved", "parks_canada", "bc_parks",
    "alberta_parks", "atlas_oddities",
  ];
  const bySource: Record<string, number> = {};
  for (const source of KNOWN) {
    const r = await db
      .from("source_record")
      .select("id", { count: "exact", head: true })
      .eq("source_id", source);
    if (r.error || r.count == null) {
      console.error(`QUERY FAILED source_record[${source}]:`, r);
      process.exit(1);
    }
    bySource[source] = r.count;
  }

  const snapshot = {
    at: new Date().toISOString(),
    master_place: mp.count,
    source_record: sr.count,
    place_match: pm.count,
    source_record_by_source: bySource,
  };
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error("baseline: fatal", err);
  process.exit(1);
});
