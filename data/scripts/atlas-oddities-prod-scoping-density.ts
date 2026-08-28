/**
 * READ-ONLY investigation of AO POI geographic distribution on TEST,
 * for the 2026-08-27 PROD-promotion scoping doc
 * (docs/proposals/2026-08-27-atlas-oddities-prod-promotion-scoping.md).
 * TEST only. No writes. No PROD access.
 *
 * Groups the enriched AO source_records by their linked master_place.state
 * so PROD-promotion density-cascade risk can be reasoned about without
 * hitting PROD.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/atlas-oddities-prod-scoping-density.ts
 */
import { getDb } from "../ingestion/lib/db.ts";

if (process.env.SUPABASE_URL !== "https://znldzjdatkogdktymtvi.supabase.co") {
  console.error("Refusing to run — not TEST.");
  process.exit(1);
}
const db = getDb();

async function main() {
  // Fetch mp_ids linked to enriched AO source_records, then group by
  // master_place.state (added 2026-08-21).

  // Instead: fetch mp_ids linked to enriched AO source_records, then group
  // via a master_place SELECT with state column (added 2026-08-21).
  const srPages: string[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id")
      .eq("source_id", "atlas_oddities")
      .not("normalized_payload->>description", "is", null)
      .range(from, from + PAGE - 1);
    if (r.error || !r.data) { console.error(r.error); return; }
    for (const row of r.data) if (row.master_place_id) srPages.push(row.master_place_id as string);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const enrichedMpIds = Array.from(new Set(srPages));
  console.log(`Enriched AO source_records: ${srPages.length}`);
  console.log(`Enriched AO distinct master_place_ids: ${enrichedMpIds.length}`);

  // 2. Group by state.
  const CHUNK = 100;
  const byState: Record<string, number> = {};
  for (let i = 0; i < enrichedMpIds.length; i += CHUNK) {
    const chunk = enrichedMpIds.slice(i, i + CHUNK);
    const r = await db.from("master_place")
      .select("state")
      .in("id", chunk);
    if (r.error || !r.data) { console.error(r.error); return; }
    for (const row of r.data) {
      const s = (row.state as string) ?? "NULL";
      byState[s] = (byState[s] ?? 0) + 1;
    }
  }
  console.log("\nDistribution by state (enriched AO POIs on TEST):");
  const total = Object.values(byState).reduce((a, b) => a + b, 0);
  for (const [state, n] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${state.padEnd(6)} ${n.toString().padStart(6)}  (${((n/total)*100).toFixed(1)}%)`);
  }

  // 3. Corridor-city derivation is per-day, based on gazetteer cities.
  //    Approximate density impact: count AO POIs per gazetteer city.
  //    Skip this — it's a corridor-render-side calculation that needs the
  //    real corridor derivation code + a specific route; do it in the plan
  //    as a separate follow-up if Adam wants it.

  // 4. Total AO source_records vs enriched, per state (via linked mp state).
  //    Compare enriched to the corpus baseline atlas_oddities in each state
  //    to know what "PROD would get" if all 2,870 AO rows were promoted.
  const allSrPages: string[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id")
      .eq("source_id", "atlas_oddities")
      .range(from, from + PAGE - 1);
    if (r.error || !r.data) { console.error(r.error); return; }
    for (const row of r.data) if (row.master_place_id) allSrPages.push(row.master_place_id as string);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const allMpIds = Array.from(new Set(allSrPages));
  console.log(`\nAll atlas_oddities distinct master_place_ids: ${allMpIds.length}`);

  const byStateAll: Record<string, number> = {};
  for (let i = 0; i < allMpIds.length; i += CHUNK) {
    const chunk = allMpIds.slice(i, i + CHUNK);
    const r = await db.from("master_place")
      .select("state")
      .in("id", chunk);
    if (r.error || !r.data) { console.error(r.error); return; }
    for (const row of r.data) {
      const s = (row.state as string) ?? "NULL";
      byStateAll[s] = (byStateAll[s] ?? 0) + 1;
    }
  }
  console.log("\nDistribution by state (ALL atlas_oddities on TEST):");
  for (const [state, n] of Object.entries(byStateAll).sort((a, b) => b[1] - a[1])) {
    const enrichedN = byState[state] ?? 0;
    console.log(`  ${state.padEnd(6)} ${n.toString().padStart(6)}  (enriched: ${enrichedN.toString().padStart(4)}, ${enrichedN>0 ? ((enrichedN/n)*100).toFixed(1) : 0}%)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
