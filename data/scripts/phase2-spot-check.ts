/** Spot-check 10 sanitary_dump_station and 10 backcountry camp_site rows on TEST.
 *  Print name, coords, all OSM tags. READ-only. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // Collect all osm rows, filter client-side, sample deterministically
  const rows: { id: string; name: string; raw_payload: { element?: { tags?: Record<string, string>; lat?: number; lon?: number } } | null; master_place_id: string | null; inferred_category: string | null }[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, name, raw_payload, master_place_id, inferred_category")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof rows;
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  console.log(`scanned ${rows.length} osm rows\n`);

  const dumps = rows.filter((r) => r.raw_payload?.element?.tags?.amenity === "sanitary_dump_station");
  const back = rows.filter((r) => r.raw_payload?.element?.tags?.tourism === "camp_site" && r.raw_payload?.element?.tags?.backcountry === "yes");

  const sample = <T>(arr: T[], n: number): T[] => {
    if (arr.length <= n) return arr;
    const step = Math.max(1, Math.floor(arr.length / n));
    const out: T[] = [];
    for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]!);
    return out;
  };
  const dumpSample = sample(dumps, 10);
  const backSample = sample(back, 10);

  const render = (r: typeof rows[number]) => {
    const el = r.raw_payload?.element ?? {};
    console.log(`  ${r.id}`);
    console.log(`    name              : ${r.name}`);
    console.log(`    coords            : ${el.lat}, ${el.lon}`);
    console.log(`    inferred_category : ${r.inferred_category}`);
    console.log(`    master_place_id   : ${r.master_place_id ?? "(unlinked)"}`);
    console.log(`    tags              : ${JSON.stringify(el.tags ?? {})}`);
    console.log();
  };

  console.log(`═══ 10 SANITARY_DUMP_STATION SAMPLES (of ${dumps.length}) ═══\n`);
  for (const r of dumpSample) render(r);

  console.log(`═══ 10 BACKCOUNTRY CAMP_SITE SAMPLES (of ${back.length}) ═══\n`);
  for (const r of backSample) render(r);
}
main().catch((e) => { console.error(e); process.exit(1); });
