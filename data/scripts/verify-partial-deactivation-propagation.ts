/**
 * READ-ONLY: prove the partial deactivation propagated correctly, in BOTH
 * directions and on BOTH consumer surfaces.
 *
 *   direction A — a now-deactivated (description-less) place must be ABSENT
 *                 from master_place_search_export AND from pois_along_corridor;
 *   direction B — a still-active (described) place must be PRESENT on both.
 *
 * Both surfaces are checked because `pois_along_corridor` reads
 * `master_place.geometry` directly and bypasses the export view — a place can
 * be in one and absent from the other, so one surface is not evidence.
 *
 * Coordinates come from the source_record's own OSM raw payload
 * (`raw_payload.element.lat/lon`), not from the view — a deactivated place is
 * absent from the view, so the view cannot supply them. Every row in these
 * categories is an OSM node carrying lat/lon.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const CATEGORIES = ["toilet", "water", "dump_station"] as const;
const PER_CATEGORY = 3;

type SR = {
  external_id: string;
  master_place_id: string;
  is_active: boolean;
  normalized_payload: { description?: unknown } | null;
  raw_payload: { element?: { lat?: number; lon?: number } } | null;
};

const hasDesc = (r: SR) =>
  typeof r.normalized_payload?.description === "string" &&
  (r.normalized_payload.description as string).trim().length > 0;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  let passes = 0, checks = 0;

  async function fetchSample(cat: string, active: boolean): Promise<SR[]> {
    const r = await db.from("source_record")
      .select("external_id, master_place_id, is_active, normalized_payload, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", cat).eq("is_active", active)
      .not("master_place_id", "is", null).order("id").limit(300);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`sample ${cat}`); }
    return r.data as unknown as SR[];
  }

  for (const cat of CATEGORIES) {
    console.log("=".repeat(76));
    console.log(`CATEGORY ${cat}`);

    const deactivated = (await fetchSample(cat, false)).filter((r) => !hasDesc(r));
    const stillActive = (await fetchSample(cat, true)).filter(hasDesc);

    const legs: [string, SR[], boolean][] = [
      ["DEACTIVATED (no description) — must be ABSENT from BOTH", deactivated, false],
      ["ACTIVE (described) control — must be PRESENT on BOTH", stillActive, true],
    ];

    for (const [label, rows, expect] of legs) {
      console.log(`\n  ${label}   [pool: ${rows.length}]`);
      const stride = Math.max(1, Math.floor(rows.length / PER_CATEGORY));
      const picks = rows.filter((_, i) => i % stride === 0).slice(0, PER_CATEGORY);

      for (const p of picks) {
        const el = p.raw_payload?.element;
        if (el?.lat == null || el?.lon == null) { console.log(`     ${p.external_id}: no lat/lon in raw payload — skipped`); continue; }
        checks += 1;

        const mp = await db.from("master_place").select("canonical_name, primary_category, source_count, is_searchable").eq("id", p.master_place_id).single();
        if (mp.error || mp.data == null) { console.log("QUERY FAILED:", JSON.stringify(mp, null, 2)); throw new Error("mp read"); }
        // The RPC filters on master_place.primary_category, NOT on the
        // source_record's inferred_category. On a multi-source place those
        // differ — a water source_record can hang off a campground — so
        // filtering by the source's category would wrongly report ABSENT.
        // Query by the place's own category; null means no filter.
        const rpcCategory = (mp.data as { primary_category: string | null }).primary_category;

        const v = await db.from("master_place_search_export").select("id").eq("id", p.master_place_id).maybeSingle();
        if (v.error) { console.log("QUERY FAILED:", JSON.stringify(v, null, 2)); throw new Error("view read"); }
        const inView = v.data != null;

        const route = {
          type: "LineString",
          coordinates: [[el.lon - 0.05, el.lat - 0.05], [el.lon, el.lat], [el.lon + 0.05, el.lat + 0.05]],
        };
        const rpc = await db.rpc("pois_along_corridor",
          rpcCategory
            ? { p_route: route, p_buffer_m: 16000, p_categories: [rpcCategory] }
            : { p_route: route, p_buffer_m: 16000 });
        if (rpc.error || rpc.data == null) { console.log("RPC FAILED:", JSON.stringify(rpc, null, 2)); throw new Error("rpc"); }
        const returned = rpc.data as { id: string }[];
        const inRpc = returned.some((r) => r.id === p.master_place_id);

        const ok = inView === expect && inRpc === expect;
        if (ok) passes += 1;
        console.log(`     ${mp.data.canonical_name}  (${p.external_id})`);
        console.log(`        description : ${JSON.stringify(p.normalized_payload?.description ?? null)}`);
        console.log(`        master_place: source_count=${mp.data.source_count} is_searchable=${mp.data.is_searchable}`);
        console.log(`        master_place category: ${rpcCategory ?? "(null)"}${rpcCategory !== cat ? `  <- differs from source category "${cat}"` : ""}`);
        console.log(`        view: ${inView ? "PRESENT" : "ABSENT"}   corridor RPC: ${inRpc ? "PRESENT" : "ABSENT"}  (${returned.length} rows in this corridor)   ${ok ? "PASS" : "*** FAIL ***"}`);
      }
    }
    console.log();
  }

  console.log("=".repeat(76));
  console.log(`CHECKS: ${passes}/${checks} passed`);
  if (passes !== checks) throw new Error("propagation check failed");
}

main().catch((e) => { console.error(e); process.exit(1); });
