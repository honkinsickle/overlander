/**
 * Read-only BEFORE measurement for the OSM amenities field_precedence
 * migration (20260818140000_osm_amenities_field_precedence.sql). Run again
 * after the migration + a recompute pass to get the AFTER half.
 *
 * For every master_place linked to an active OSM source_record with a
 * non-empty normalized_payload.amenities, reports whether master_place.
 * amenities is currently null (OSM would be a genuine gap-fill once the
 * precedence row lands + a recompute runs) or already non-null (a
 * higher-precedence source already supplies it, so OSM's contribution
 * should be correctly suppressed post-migration — nothing should change for
 * these rows). NOT modifying anything.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  const PAGE = 1000;
  const osmRows: { master_place_id: string | null; normalized_payload: any }[] = [];
  let from = 0;
  while (true) {
    const r = await db
      .from("source_record")
      .select("master_place_id, normalized_payload")
      .eq("source_id", "osm")
      .eq("is_active", true)
      .not("normalized_payload->amenities", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED:", r); throw new Error(""); }
    osmRows.push(...(r.data as any[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }

  const candidateMpIds = new Set<string>();
  for (const r of osmRows) {
    const a = r.normalized_payload?.amenities;
    if (r.master_place_id && a && typeof a === "object" && Object.keys(a).length > 0) {
      candidateMpIds.add(r.master_place_id);
    }
  }
  console.log(`OSM active SRs with non-empty amenities: ${osmRows.filter((r) => {
    const a = r.normalized_payload?.amenities;
    return a && typeof a === "object" && Object.keys(a).length > 0;
  }).length}`);
  console.log(`Distinct linked master_place ids among them: ${candidateMpIds.size}`);

  // Current master_place.amenities for exactly those ids, paginated.
  const ids = [...candidateMpIds];
  let nullCount = 0, nonNullCount = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await db.from("master_place").select("id, amenities").in("id", chunk);
    if (r.error || r.data == null) { console.error("QUERY FAILED:", r); throw new Error(""); }
    for (const row of r.data as { id: string; amenities: unknown }[]) {
      if (row.amenities == null) nullCount++;
      else nonNullCount++;
    }
  }
  console.log(`\n─── BEFORE migration ───`);
  console.log(`  master_place.amenities currently NULL (would be gap-filled by OSM):     ${nullCount}`);
  console.log(`  master_place.amenities currently NON-NULL (should stay unchanged, a higher-precedence source already wins): ${nonNullCount}`);
  console.log(`  total candidate master_place rows: ${candidateMpIds.size}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
