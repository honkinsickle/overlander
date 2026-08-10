/** Post-ingest predictions check + distinct/inserted reconciliation + spot-check.
 *  TEST only, READ-only. Run this AFTER Phase 2 ingest completes. */
import { getDb } from "../ingestion/lib/db.ts";

const PRED = {
  sanitaryDump: 29,      // Overpass count in bbox before run
  backcountry: 146,      // TEST 36 + Overpass 110 = predicted total post-run
  informal: 11,          // TEST 11 + Overpass 0 = unchanged
  wasteDisposal: 123,    // TEST 123 + adapter no longer requests = unchanged
};

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // Fetch ALL osm rows, filter client-side (jsonb key filters via PostgREST
  // are awkward for arbitrary tag combos).
  const rows: { id: string; raw_payload: { element?: { tags?: Record<string, string> } } | null }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, raw_payload")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof rows;
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  console.log(`osm source_records total (distinct rows on TEST): ${rows.length}\n`);

  const tags = (r: (typeof rows)[number]) => r.raw_payload?.element?.tags ?? {};

  const cSD = rows.filter((r) => tags(r).amenity === "sanitary_dump_station").length;
  const cBC = rows.filter((r) => tags(r).tourism === "camp_site" && tags(r).backcountry === "yes").length;
  const cIF = rows.filter((r) => tags(r).tourism === "camp_site" && tags(r).informal === "yes").length;
  const cWD = rows.filter((r) => tags(r).amenity === "waste_disposal").length;

  const check = (label: string, actual: number, predicted: number, note?: string) => {
    const diff = actual - predicted;
    const held = Math.abs(diff) <= Math.max(3, Math.ceil(predicted * 0.05));
    const status = actual === predicted ? "EXACT" : held ? "within tolerance" : "DIVERGENCE";
    console.log(`  ${label.padEnd(52)} predicted=${predicted}  actual=${actual}  Δ=${diff >= 0 ? "+" : ""}${diff}   ${status}${note ? `   ${note}` : ""}`);
  };

  console.log(`─── predictions vs actuals ───`);
  check("amenity=sanitary_dump_station", cSD, PRED.sanitaryDump);
  check("tourism=camp_site + backcountry=yes", cBC, PRED.backcountry);
  check("tourism=camp_site + informal=yes", cIF, PRED.informal);
  check("amenity=waste_disposal  (must NOT grow)", cWD, PRED.wasteDisposal,
    cWD > PRED.wasteDisposal ? "⚠ INCREASED — fix didn't take" : "");
}
main().catch((e) => { console.error(e); process.exit(1); });
