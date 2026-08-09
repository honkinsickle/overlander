/**
 * Throwaway diagnostic: how many searchable master_place rows currently
 * carry google_place_id = NULL under the pois_along_corridor RPC's
 * source_id = 'google' predicate, broken down by which source_ids back them.
 *
 * Also reports the delta the widened predicate would unlock: master_place
 * rows that have a 'google_resolved' source_record but NO 'google' one.
 *
 * READ-ONLY. Reads .env for TEST creds (znldzjdatkogdktymtvi).
 */

import { getDb } from "../ingestion/lib/db.ts";

const url = process.env.SUPABASE_URL ?? "";
const EXPECTED_TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
if (!url.includes(EXPECTED_TEST_HOST)) {
  throw new Error(`Refusing to run: SUPABASE_URL is ${url}, expected ${EXPECTED_TEST_HOST}`);
}
console.log(`[env] TEST ${url}`);

const db = getDb();

async function main() {
  // Total searchable, non-land_status master_place rows (the RPC's own filter set)
  const totalRes = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("is_searchable", true)
    .neq("primary_category", "land_status");
  if (totalRes.error) throw totalRes.error;
  console.log(`[master_place] searchable + non-land_status: ${totalRes.count}`);

  // Master_places backed by at least one source_record with source_id='google'
  // (= tiles that today get a non-NULL google_place_id from the RPC).
  const googleBacked = await db
    .from("source_record")
    .select("master_place_id", { count: "exact", head: true })
    .eq("source_id", "google")
    .not("master_place_id", "is", null);
  if (googleBacked.error) throw googleBacked.error;
  console.log(`[source_record] rows with source_id='google' (linked to a master_place): ${googleBacked.count}`);

  const googleResolvedBacked = await db
    .from("source_record")
    .select("master_place_id", { count: "exact", head: true })
    .eq("source_id", "google_resolved")
    .not("master_place_id", "is", null);
  if (googleResolvedBacked.error) throw googleResolvedBacked.error;
  console.log(`[source_record] rows with source_id='google_resolved' (linked): ${googleResolvedBacked.count}`);

  // Pull the distinct master_place_id sets for both.
  const pageAll = async (sourceId: string): Promise<Set<string>> => {
    const set = new Set<string>();
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await db
        .from("source_record")
        .select("master_place_id")
        .eq("source_id", sourceId)
        .not("master_place_id", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) if (r.master_place_id) set.add(r.master_place_id);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return set;
  };

  const googleMps = await pageAll("google");
  const googleResolvedMps = await pageAll("google_resolved");
  console.log(`[master_place] distinct backed by 'google':          ${googleMps.size}`);
  console.log(`[master_place] distinct backed by 'google_resolved': ${googleResolvedMps.size}`);

  const overlap = [...googleResolvedMps].filter((id) => googleMps.has(id));
  const resolvedOnly = [...googleResolvedMps].filter((id) => !googleMps.has(id));
  console.log(`[overlap] master_places backed by BOTH google + google_resolved: ${overlap.length}`);
  console.log(`[delta]   master_places backed by google_resolved but NOT google (would newly get placeId under widened join): ${resolvedOnly.length}`);

  // Of all searchable master_place rows that would currently get NULL google_place_id
  // (i.e., not backed by 'google'), break down by which source_ids back them.
  // Fetch all searchable master_place IDs, subtract googleMps.
  const allSearchable = new Set<string>();
  {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await db
        .from("master_place")
        .select("id")
        .eq("is_searchable", true)
        .neq("primary_category", "land_status")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) allSearchable.add(r.id);
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }
  const nullGoogleMps = new Set([...allSearchable].filter((id) => !googleMps.has(id)));
  console.log(`[null-google] searchable master_places with NO 'google' source_record: ${nullGoogleMps.size}`);

  // Group by source_id for those NULL-google master_places.
  const bySource = new Map<string, number>();
  {
    const ids = [...nullGoogleMps];
    const chunk = 100;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const { data, error } = await db
        .from("source_record")
        .select("source_id,master_place_id")
        .in("master_place_id", slice);
      if (error) throw error;
      for (const r of data ?? []) {
        if (!r.master_place_id) continue;
        bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
      }
    }
  }
  const sorted = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[null-google][by source_id — count of source_record rows backing them]:`);
  for (const [sid, n] of sorted) console.log(`  ${sid.padEnd(24)} ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
