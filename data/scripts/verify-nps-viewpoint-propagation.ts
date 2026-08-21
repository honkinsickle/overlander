/**
 * READ-ONLY: prove the NPS viewpoint reactivation reached BOTH consumer
 * surfaces — master_place_search_export (browse/search) and a live
 * pois_along_corridor call (trip generation), which bypasses the view.
 *
 * Includes "City Hall Observation Deck" as a NEGATIVE control. The task brief
 * expected it among the reactivated NPS places; it is not. It is OSM-sourced
 * (its only source_record is osm:node:5745696621, description null) and OSM
 * viewpoint stays deactivated, so it must remain ABSENT. Verified rather than
 * assumed, and reported as the discrepancy it is.
 *
 * The RPC is filtered by the master_place's OWN primary_category, not by the
 * source_record's inferred_category — on a multi-source place those differ and
 * filtering by the source's category yields a false ABSENT.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const SAMPLE = 4;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  let passes = 0, checks = 0;

  async function probe(mpId: string, lng: number, lat: number, expect: boolean, label: string) {
    checks += 1;
    const mp = await db.from("master_place").select("canonical_name, primary_category, source_count, is_searchable").eq("id", mpId).single();
    if (mp.error || mp.data == null) { console.log("QUERY FAILED:", JSON.stringify(mp, null, 2)); throw new Error("mp"); }
    const cat = (mp.data as { primary_category: string | null }).primary_category;

    const v = await db.from("master_place_search_export").select("id").eq("id", mpId).maybeSingle();
    if (v.error) { console.log("QUERY FAILED:", JSON.stringify(v, null, 2)); throw new Error("view"); }
    const inView = v.data != null;

    const route = { type: "LineString", coordinates: [[lng - 0.05, lat - 0.05], [lng, lat], [lng + 0.05, lat + 0.05]] };
    const rpc = await db.rpc("pois_along_corridor",
      cat ? { p_route: route, p_buffer_m: 16000, p_categories: [cat] } : { p_route: route, p_buffer_m: 16000 });
    if (rpc.error || rpc.data == null) { console.log("RPC FAILED:", JSON.stringify(rpc, null, 2)); throw new Error("rpc"); }
    const rows = rpc.data as { id: string; description: string | null }[];
    const hit = rows.find((r) => r.id === mpId);
    const ok = inView === expect && !!hit === expect;
    if (ok) passes += 1;

    console.log(`  ${label}`);
    console.log(`     ${JSON.stringify(mp.data.canonical_name)}  cat=${cat}  source_count=${mp.data.source_count}`);
    console.log(`     view: ${inView ? "PRESENT" : "ABSENT"}   corridor RPC: ${hit ? "PRESENT" : "ABSENT"}  (${rows.length} rows nearby)   ${ok ? "PASS" : "*** FAIL ***"}`);
    if (hit?.description) console.log(`     RPC description: ${JSON.stringify(hit.description.slice(0, 110))}${hit.description.length > 110 ? "…" : ""}`);
  }

  // ── Positive: reactivated NPS viewpoint places, sampled from the view ──
  console.log("REACTIVATED NPS VIEWPOINT — must be PRESENT on both\n");
  const srs = await db.from("source_record").select("master_place_id")
    .eq("source_id", "nps").eq("inferred_category", "viewpoint").eq("is_active", true)
    .not("master_place_id", "is", null).order("id").limit(300);
  if (srs.error || srs.data == null) { console.log("QUERY FAILED:", JSON.stringify(srs, null, 2)); throw new Error("srs"); }
  const ids = [...new Set((srs.data as { master_place_id: string }[]).map((r) => r.master_place_id))];

  const viewable: { id: string; lng: number; lat: number }[] = [];
  for (let i = 0; i < ids.length && viewable.length < 40; i += 200) {
    const r = await db.from("master_place_search_export").select("id, lng, lat").in("id", ids.slice(i, i + 200));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("view coords"); }
    viewable.push(...(r.data as { id: string; lng: number; lat: number }[]));
  }
  const stride = Math.max(1, Math.floor(viewable.length / SAMPLE));
  for (const p of viewable.filter((_, i) => i % stride === 0).slice(0, SAMPLE)) {
    await probe(p.id, p.lng, p.lat, true, "reactivated:");
  }

  // ── Negative control: City Hall Observation Deck (OSM, still off) ──────
  console.log("\nNEGATIVE CONTROL — City Hall Observation Deck (OSM-sourced, NOT reactivated)\n");
  const ch = await db.from("source_record").select("master_place_id, raw_payload, is_active, source_id")
    .eq("external_id", "osm:node:5745696621").single();
  if (ch.error || ch.data == null) { console.log("QUERY FAILED:", JSON.stringify(ch, null, 2)); throw new Error("chod"); }
  const el = (ch.data as { raw_payload: { element?: { lat?: number; lon?: number } } }).raw_payload?.element;
  const chSr = ch.data as { master_place_id: string; is_active: boolean; source_id: string };
  console.log(`  its only source_record: source=${chSr.source_id} is_active=${chSr.is_active} (expected osm / false)`);
  if (el?.lat != null && el?.lon != null) {
    await probe(chSr.master_place_id, el.lon, el.lat, false, "negative control (must stay ABSENT):");
  }

  console.log(`\nCHECKS: ${passes}/${checks} passed`);
  if (passes !== checks) throw new Error("propagation check failed");
}

main().catch((e) => { console.error(e); process.exit(1); });
