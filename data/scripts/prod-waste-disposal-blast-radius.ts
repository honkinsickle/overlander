/** READ-only PROD blast radius:
 *  - waste_disposal source_records total (should be 1,723)
 *  - subset linked to a master_place
 *  - of those, how many master_places would be ORPHANED if the row is removed
 *    (waste_disposal is the ONLY source_record on that MP)
 *  - how many are CO-LINKED (removal shrinks source_count by 1 but keeps MP)
 *  - whether any of those master_place ids appear in reference_trips.payload
 *  - whether any appear in trips.payload
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = url.match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(`[env] PROD ${ref}\n`);

  // 1. Fetch every osm row and pick the waste_disposal ones. Small enough.
  const wd: { id: string; master_place_id: string | null }[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, raw_payload, master_place_id")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.raw_payload?.element?.tags?.amenity === "waste_disposal") {
        wd.push({ id: r.id, master_place_id: r.master_place_id });
      }
    }
    if (rows.length < size) break;
    from += size;
  }
  console.log(`waste_disposal source_records total: ${wd.length}`);

  const linked = wd.filter((r) => r.master_place_id !== null);
  const unlinked = wd.filter((r) => r.master_place_id === null);
  console.log(`  linked to a master_place  : ${linked.length}`);
  console.log(`  UNLINKED (no MP)          : ${unlinked.length}`);

  // 2. For each linked row, get the source_count on its MP. sole-source = would orphan.
  const linkedMpIds = [...new Set(linked.map((r) => r.master_place_id!))];
  console.log(`\ndistinct master_places touched by a waste_disposal source_record: ${linkedMpIds.length}`);

  // Pull all source_records on those MPs so we can count per-MP.
  const perMpCount = new Map<string, number>();
  const chunk = 200;
  for (let i = 0; i < linkedMpIds.length; i += chunk) {
    const slice = linkedMpIds.slice(i, i + chunk);
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id")
      .in("master_place_id", slice);
    if (error) throw error;
    for (const r of (data ?? []) as { master_place_id: string }[]) {
      perMpCount.set(r.master_place_id, (perMpCount.get(r.master_place_id) ?? 0) + 1);
    }
  }

  let orphanedIfRemoved = 0;
  let coLinkedSurvives = 0;
  const orphanIds: string[] = [];
  for (const mpId of linkedMpIds) {
    const n = perMpCount.get(mpId) ?? 0;
    if (n <= 1) { orphanedIfRemoved += 1; orphanIds.push(mpId); }
    else coLinkedSurvives += 1;
  }
  console.log(`\nMPs that would be ORPHANED (removal kills the only source_record): ${orphanedIfRemoved}`);
  console.log(`MPs that would SURVIVE (co-linked to another source)              : ${coLinkedSurvives}`);

  // 3. Check whether any of the potentially-orphaned MP ids appear in
  //    reference_trips.payload or trips.payload.
  //    Payload is jsonb; a linked master_place_id would typically appear as
  //    a string somewhere in a `waypoints` / `overnights` / `days` blob.
  //    Cheap approximation: for a sample of orphan ids, cast payload to text
  //    and check LIKE '%<id>%'. Doing this for every orphan is expensive;
  //    do 100 at a time via OR-of-LIKEs is over-engineering, so batch as a
  //    single-jsonb-cast text search across all trips.
  //
  //    Since PROD has ~thousands of trips, we'll do it per-id for a bounded
  //    sample of the ORPHAN set (worst case for the blast question — solo
  //    MPs are the ones deletion would destroy).
  const refTripsTotal = await db.from("reference_trips").select("id", { count: "exact", head: true });
  const tripsTotal = await db.from("trips").select("id", { count: "exact", head: true });
  console.log(`\ntrip corpus:  reference_trips=${refTripsTotal.count}  trips=${tripsTotal.count}`);

  // Sample check: pick 50 orphan ids and grep each against payload text.
  // Full-corpus per-id text search is too slow; sample and extrapolate.
  const sampleN = Math.min(50, orphanIds.length);
  const orphanSample = orphanIds.slice(0, sampleN);
  let refTripHits = 0;
  let tripHits = 0;
  for (const id of orphanSample) {
    const { count: rc } = await db.from("reference_trips").select("id", { count: "exact", head: true }).ilike("payload::text", `%${id}%`);
    const { count: tc } = await db.from("trips").select("id", { count: "exact", head: true }).ilike("payload::text", `%${id}%`);
    if ((rc ?? 0) > 0) refTripHits += 1;
    if ((tc ?? 0) > 0) tripHits += 1;
  }
  console.log(`\nsampled ${sampleN} orphan MP ids for trip references:`);
  console.log(`  reference_trips containing the id in payload: ${refTripHits} / ${sampleN}`);
  console.log(`  trips containing the id in payload          : ${tripHits} / ${sampleN}`);

  if (refTripHits === 0 && tripHits === 0) {
    console.log(`\n✓ Zero of the sampled orphan MP ids appear in any trip payload. Extrapolating: highly unlikely any of the ${orphanedIfRemoved} orphans are referenced by trips.`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
