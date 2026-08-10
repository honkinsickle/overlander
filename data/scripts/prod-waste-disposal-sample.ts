/** READ-only: sample 20 osm rows with amenity=waste_disposal on PROD.
 *  Report canonical_name, full tag set, lat/lng. Deterministic (by id).
 *  Human-classify offline. */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = url.match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(`[env] PROD ${ref}\n`);

  // Fetch a sample of osm rows and filter client-side (jsonb path filters on
  // deeply nested keys through PostgREST are awkward for arbitrary tags).
  // The 5,371-row table is small; pull all and pick 20.
  const size = 1000;
  let from = 0;
  const matches: any[] = [];
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, name, raw_payload, master_place_id")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.raw_payload?.element?.tags?.amenity === "waste_disposal") matches.push(r);
    }
    if (rows.length < size) break;
    from += size;
  }
  console.log(`total waste_disposal rows: ${matches.length}`);

  // Deterministic 20 — take a stratified slice (every Nth row) so we don't
  // get 20 consecutive imports from one Overpass tile.
  const step = Math.max(1, Math.floor(matches.length / 20));
  const sample = [];
  for (let i = 0; i < matches.length && sample.length < 20; i += step) sample.push(matches[i]);
  console.log(`sampled: ${sample.length} rows (stratified every ${step}th)\n`);

  for (const r of sample) {
    const tags = r.raw_payload.element.tags;
    const lat = r.raw_payload.element.lat;
    const lon = r.raw_payload.element.lon;
    console.log(`─ ${r.id}`);
    console.log(`  name        : ${r.name}`);
    console.log(`  coords      : ${lat}, ${lon}`);
    console.log(`  master_place: ${r.master_place_id ?? "(unlinked)"}`);
    console.log(`  tags        : ${JSON.stringify(tags)}`);
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
