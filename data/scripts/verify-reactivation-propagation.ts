/**
 * READ-ONLY: prove the toilet / water / dump_station reactivation reaches BOTH
 * consumer surfaces, not just one.
 *
 *   1. `master_place_search_export` — the view browse + Typesense read.
 *   2. `pois_along_corridor(p_route, p_buffer_m, p_categories)` — the RPC trip
 *      generation reads. It bypasses the view entirely and reads
 *      master_place.geometry directly, which is why it needed its own
 *      `source_count > 0` fix (migration 20260818160000). A place can be in one
 *      and absent from the other, so both are checked per sample place.
 *
 * For each sampled place a real GeoJSON LineString is built through its own
 * coordinates and passed to the RPC, then the result is searched for that
 * place's master_place id.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const CATEGORIES = ["toilet", "water", "dump_station"] as const;
const PER_CATEGORY = 3;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  let bothOk = 0, total = 0;

  for (const cat of CATEGORIES) {
    console.log("=".repeat(74));
    console.log(`CATEGORY ${cat}`);

    // Reactivated source_records in this category, linked to a master_place.
    const srs = await db.from("source_record")
      .select("external_id, master_place_id, normalized_payload")
      .eq("source_id", "osm").eq("inferred_category", cat).eq("is_active", true)
      .not("master_place_id", "is", null).order("id").limit(400);
    if (srs.error || srs.data == null) { console.log("QUERY FAILED:", JSON.stringify(srs, null, 2)); throw new Error("sr scan"); }

    // Prefer places that carry a description so the sample is reviewable.
    const withDesc = (srs.data as { external_id: string; master_place_id: string; normalized_payload: { description?: unknown } | null }[])
      .filter((r) => typeof r.normalized_payload?.description === "string" && (r.normalized_payload.description as string).trim().length > 0);
    const pool = withDesc.length >= PER_CATEGORY ? withDesc : (srs.data as typeof withDesc);
    const stride = Math.max(1, Math.floor(pool.length / PER_CATEGORY));
    const picks = pool.filter((_, i) => i % stride === 0).slice(0, PER_CATEGORY);

    for (const p of picks) {
      total += 1;
      const mp = await db.from("master_place")
        .select("id, canonical_name, primary_category, source_count, is_searchable")
        .eq("id", p.master_place_id).single();
      if (mp.error || mp.data == null) { console.log("QUERY FAILED:", JSON.stringify(mp, null, 2)); throw new Error("mp read"); }

      // Coordinates come from the export view (it exposes lng/lat).
      const view = await db.from("master_place_search_export")
        .select("id, canonical_name, primary_category, lng, lat")
        .eq("id", p.master_place_id).maybeSingle();
      if (view.error) { console.log("QUERY FAILED:", JSON.stringify(view, null, 2)); throw new Error("view read"); }
      const inView = view.data != null;

      console.log(`\n  ${mp.data.canonical_name}  [${mp.data.primary_category}]`);
      console.log(`    source_record   : ${p.external_id}`);
      console.log(`    description     : ${JSON.stringify(p.normalized_payload?.description ?? null)}`);
      console.log(`    master_place    : source_count=${mp.data.source_count}  is_searchable=${mp.data.is_searchable}`);
      console.log(`    SURFACE 1 — master_place_search_export : ${inView ? "PRESENT" : "ABSENT"}`);

      if (!inView) { console.log(`    SURFACE 2 — pois_along_corridor        : SKIPPED (no coords from view)`); continue; }

      const lng = view.data!.lng as number, lat = view.data!.lat as number;
      // A short real route line running through the place's own position.
      const route = {
        type: "LineString",
        coordinates: [[lng - 0.05, lat - 0.05], [lng, lat], [lng + 0.05, lat + 0.05]],
      };
      const rpc = await db.rpc("pois_along_corridor", {
        p_route: route,
        p_buffer_m: 16000,
        p_categories: [cat],
      });
      if (rpc.error || rpc.data == null) { console.log("RPC FAILED:", JSON.stringify(rpc, null, 2)); throw new Error("rpc"); }
      const rows = rpc.data as { id: string; canonical_name: string; description: string | null }[];
      const hit = rows.find((r) => r.id === p.master_place_id);
      console.log(`    SURFACE 2 — pois_along_corridor        : ${hit ? "PRESENT" : "ABSENT"}  (RPC returned ${rows.length} ${cat} rows for this corridor)`);
      if (hit) console.log(`                 RPC description           : ${JSON.stringify(hit.description)}`);
      if (inView && hit) bothOk += 1;
    }
    console.log();
  }

  console.log("=".repeat(74));
  console.log(`SAMPLED ${total} places; present on BOTH surfaces: ${bothOk}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
