/** TEST-only: sample 10 backcountry/dispersed sites from the UT ingest run.
 *  Filters to source_id='osm', inferred_category='dispersed_camping', and
 *  updated_at within the ingest window (>= 2026-08-10T04:13:00Z, before
 *  the materialize touched anything). Print name, coords, full raw tag set. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // The 893 new UT rows are the most recent dispersed_camping updates on
  // this table (nothing else has written camping rows in this session).
  // Ordering by updated_at DESC and taking 10 sidesteps client-clock skew
  // (my machine is ~1h ahead of Postgres) and gives an honest sample of
  // what just landed.
  const rows = await db
    .from("source_record")
    .select("external_id, name, raw_payload, updated_at")
    .eq("source_id", "osm")
    .eq("inferred_category", "dispersed_camping")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (rows.error || !rows.data) {
    console.log("QUERY FAILED:", rows);
    return;
  }
  console.log(`Sampled ${rows.data.length} of the fresh dispersed_camping rows (deterministic order by external_id):\n`);
  for (const r of rows.data as { external_id: string; name: string; point: unknown; raw_payload: any; updated_at: string }[]) {
    const el = r.raw_payload?.element ?? {};
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    console.log(`──────────────────────────────`);
    console.log(`external_id : ${r.external_id}`);
    console.log(`name        : ${r.name}`);
    console.log(`coords      : lat=${lat}  lon=${lon}`);
    console.log(`updated_at  : ${r.updated_at}`);
    console.log(`osm tags    :`);
    for (const [k, v] of Object.entries(tags).sort()) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
