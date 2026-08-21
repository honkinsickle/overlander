/**
 * Recompute master_place for every candidate id identified by
 * measure-osm-amenities-precedence-before.ts, now that
 * 20260818140000_osm_amenities_field_precedence.sql is applied to TEST.
 * field_precedence changes don't retroactively update master_place — only a
 * fresh recompute_master_place() call does. Sequential (matches the
 * established pattern in data/scripts/slice1-rollback.ts), TEST-only guard,
 * logs progress every 500.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  // Rebuild the candidate set exactly as the BEFORE script did.
  const PAGE = 1000;
  const osmRows: { master_place_id: string | null; normalized_payload: any }[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record").select("master_place_id, normalized_payload")
      .eq("source_id", "osm").eq("is_active", true)
      .not("normalized_payload->amenities", "is", null)
      .order("id").range(from, from + PAGE - 1);
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
  const ids = [...candidateMpIds];
  console.log(`Recomputing ${ids.length} candidate master_place ids...`);

  let ok = 0, failed = 0;
  const errors: { id: string; message: string }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const { error } = await db.rpc("recompute_master_place", { p_master_place_id: ids[i] });
    if (error) { failed++; errors.push({ id: ids[i], message: error.message }); }
    else ok++;
    if ((i + 1) % 500 === 0) console.log(`  ...${i + 1}/${ids.length} (ok=${ok}, failed=${failed})`);
  }
  console.log(`\nDone. ok=${ok} failed=${failed}`);
  if (errors.length > 0) {
    console.log("First 10 errors:");
    for (const e of errors.slice(0, 10)) console.log(`  ${e.id}: ${e.message}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
