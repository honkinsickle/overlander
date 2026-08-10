/** Audit the 25 amenity_rollup outcomes from this session's materialize run.
 *  For each, report: child source_record (source_id, external_id, category, coords)
 *  and parent master_place (canonical_name, has_dump_station via amenities).
 *  Then pick 5 dump_station rollups and confirm the child is
 *  sanitary_dump_station, not waste_disposal. TEST only, READ-only. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // Fetch recent amenity_rollup place_match rows (from this session's materialize).
  const { data: matches, error } = await db
    .from("place_match")
    .select("id, master_place_id, source_record_id, match_method, resolved_at")
    .eq("match_method", "amenity_rollup")
    .order("resolved_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  console.log(`amenity_rollup place_match rows: ${matches?.length ?? 0}\n`);

  // Distinguish this session's rollups by resolved_at within materialize window.
  // Materialize ran ~2026-08-10T01:15..01:27 UTC.
  const inSession = (matches ?? []).filter((m: any) => {
    const t = new Date(m.resolved_at).getTime();
    const start = new Date("2026-08-10T01:14:00Z").getTime();
    const end = new Date("2026-08-10T01:30:00Z").getTime();
    return t >= start && t <= end;
  });
  console.log(`amenity_rollup rows from this session (2026-08-10 01:14-01:30 UTC): ${inSession.length}\n`);

  if (inSession.length === 0) {
    console.log("no rollups from this session — showing all recent for context");
  }
  const rollups = inSession.length > 0 ? inSession : (matches ?? []).slice(0, 25);

  // Pull each child source_record and each parent master_place.
  const childIds = rollups.map((m: any) => m.source_record_id);
  const parentIds = [...new Set(rollups.map((m: any) => m.master_place_id))];

  const { data: children } = await db
    .from("source_record")
    .select("id, source_id, external_id, name, inferred_category, raw_payload, geometry")
    .in("id", childIds);
  const childrenById = new Map((children ?? []).map((r: any) => [r.id, r]));

  const { data: parents } = await db
    .from("master_place")
    .select("id, canonical_name, primary_category, amenities, source_count")
    .in("id", parentIds);
  const parentById = new Map((parents ?? []).map((r: any) => [r.id, r]));

  console.log(`─── all rollups this session ───`);
  const dumpRollups: any[] = [];
  for (const m of rollups) {
    const child: any = childrenById.get(m.source_record_id);
    const parent: any = parentById.get(m.master_place_id);
    if (!child || !parent) continue;
    const childTags = child.raw_payload?.element?.tags ?? {};
    const amenityKey = childTags.amenity ?? "(non-amenity)";
    console.log(`  child ${child.source_id}:${child.inferred_category} (tag: amenity=${amenityKey})  →  parent "${parent.canonical_name}" (${parent.primary_category})`);
    if (child.inferred_category === "dump_station") dumpRollups.push({ m, child, parent, childTags });
  }

  console.log(`\n─── DUMP_STATION rollups: ${dumpRollups.length} ───`);
  const sample = dumpRollups.slice(0, 5);
  for (const { child, parent, childTags } of sample) {
    const amKey = childTags.amenity;
    const parentDump = (parent.amenities as { dump_station?: unknown } | null)?.dump_station;
    console.log(`\n  ─ parent MP: ${parent.id}`);
    console.log(`    canonical_name       : ${parent.canonical_name}`);
    console.log(`    primary_category     : ${parent.primary_category}`);
    console.log(`    source_count         : ${parent.source_count}`);
    console.log(`    amenities.dump_station: ${JSON.stringify(parentDump)}`);
    console.log(`    child external_id    : ${child.external_id}`);
    console.log(`    child amenity tag    : ${amKey}   ${amKey === "sanitary_dump_station" ? "✓ REAL RV DUMP" : "✗ NOT sanitary_dump_station"}`);
    console.log(`    child tags           : ${JSON.stringify(childTags)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
