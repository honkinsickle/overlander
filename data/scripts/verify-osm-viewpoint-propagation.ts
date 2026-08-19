/**
 * READ-ONLY: verify the filter-C OSM viewpoint reactivation.
 *
 *   - reconciles the view delta against the recomputed master_places, and
 *     explains any row that did not enter the view;
 *   - positive controls: reactivated filter-C places must be PRESENT in
 *     master_place_search_export AND returned by a live pois_along_corridor
 *     call — including at least one whose description came from a `note` tag,
 *     since note-tag content is the contested part of filter C;
 *   - negative controls: City Hall Observation Deck (description null, never
 *     qualified) and excluded junk rows ("bench", "Northbound") must be ABSENT
 *     from both surfaces.
 *
 * The RPC is filtered by the master_place's OWN primary_category, not the
 * source_record's inferred_category — on a multi-source place those differ and
 * filtering by the source's category yields a false ABSENT.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { passesViewpointContentFilter } from "../ingestion/lib/osm-viewpoint-content-filter.ts";

const TEST_REF = "znldzjdatkogdktymtvi";

type Row = {
  external_id: string; name: string; is_active: boolean; master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
  raw_payload: { element?: { tags?: Record<string, string>; lat?: number; lon?: number } } | null;
};

const descOf = (r: Row) => {
  const d = r.normalized_payload?.description;
  return typeof d === "string" && d.trim() ? d.trim() : null;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  let passes = 0, checks = 0;

  async function probe(mpId: string, lng: number, lat: number, expect: boolean, label: string, note?: string) {
    checks += 1;
    const mp = await db.from("master_place").select("canonical_name, primary_category, source_count").eq("id", mpId).single();
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
    if (note) console.log(`     ${note}`);
    console.log(`     view: ${inView ? "PRESENT" : "ABSENT"}   corridor RPC: ${hit ? "PRESENT" : "ABSENT"}  (${rows.length} rows nearby)   ${ok ? "PASS" : "*** FAIL ***"}`);
    if (hit?.description) console.log(`     RPC description: ${JSON.stringify(hit.description.slice(0, 120))}`);
  }

  // ── Reconcile the view delta ──────────────────────────────────────────
  const dir = join(homedir(), ".config", "overlander", "osm-viewpoint-snapshots");
  const snap = JSON.parse(readFileSync(join(dir, readdirSync(dir).sort().at(-1)!), "utf8")) as { affected_master_place_ids: string[] };
  const ids = snap.affected_master_place_ids;
  const mps: { id: string; canonical_name: string; primary_category: string | null; source_count: number; is_searchable: boolean }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category, source_count, is_searchable").in("id", ids.slice(i, i + 200));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("mps"); }
    mps.push(...(r.data as typeof mps));
  }
  const inView = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from("master_place_search_export").select("id").in("id", ids.slice(i, i + 200));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("view ids"); }
    for (const x of r.data as { id: string }[]) inView.add(x.id);
  }
  console.log("VIEW DELTA RECONCILIATION");
  console.log(`  master_places recomputed        : ${ids.length}`);
  console.log(`  now in master_place_search_export: ${inView.size}`);
  const missing = mps.filter((m) => !inView.has(m.id));
  console.log(`  NOT in the view                 : ${missing.length}`);
  for (const m of missing) {
    const why = m.source_count === 0 ? "source_count=0" : !m.is_searchable ? "is_searchable=false" : "passes source_count+searchable -> excluded by the view's geographic filter (outside six_state_footprint)";
    console.log(`     ${JSON.stringify(m.canonical_name)}  cat=${m.primary_category}  source_count=${m.source_count}  is_searchable=${m.is_searchable}`);
    console.log(`        reason: ${why}`);
  }

  // ── Positive controls, incl. a note-tag-sourced one ───────────────────
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("external_id, name, is_active, master_place_id, normalized_payload, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", "viewpoint").eq("is_active", true)
      .not("master_place_id", "is", null).order("id").range(from, from + 999);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan active"); }
    all.push(...(r.data as unknown as Row[]));
    if (r.data.length < 1000) break;
    from += 1000;
  }
  const fromNote = all.filter((r) => {
    const t = r.raw_payload?.element?.tags ?? {};
    return t.note != null && t.note.trim() === descOf(r);
  });
  const fromDesc = all.filter((r) => !fromNote.includes(r));

  console.log(`\nREACTIVATED filter-C places — must be PRESENT on both`);
  console.log(`  (active osm viewpoint now: ${all.length} linked; from a note tag: ${fromNote.length}, from a description tag: ${fromDesc.length})\n`);

  const picks: [Row, string][] = [];
  // At least one note-tag example, preferring the longest (richest) content.
  const noteSorted = [...fromNote].sort((a, b) => (descOf(b)?.length ?? 0) - (descOf(a)?.length ?? 0));
  if (noteSorted[0]) picks.push([noteSorted[0], "NOTE-TAG sourced (the contested part of filter C):"]);
  if (noteSorted[1]) picks.push([noteSorted[1], "NOTE-TAG sourced:"]);
  const descStride = Math.max(1, Math.floor(fromDesc.length / 2));
  for (const r of fromDesc.filter((_, i) => i % descStride === 0).slice(0, 2)) picks.push([r, "description-tag sourced:"]);

  for (const [r, label] of picks) {
    const el = r.raw_payload?.element;
    if (el?.lat == null || el?.lon == null) { console.log(`  ${r.external_id}: no lat/lon — skipped`); continue; }
    await probe(r.master_place_id!, el.lon, el.lat, true, label, `source: ${r.external_id}  description: ${JSON.stringify(descOf(r)?.slice(0, 130))}`);
  }

  // ── Negative controls ─────────────────────────────────────────────────
  console.log(`\nNEGATIVE CONTROLS — must be ABSENT from both\n`);
  const negatives = ["osm:node:5745696621"]; // City Hall Observation Deck (description null)
  const junkSample = await db.from("source_record")
    .select("external_id, name, is_active, master_place_id, normalized_payload, raw_payload")
    .eq("source_id", "osm").eq("inferred_category", "viewpoint").eq("is_active", false)
    .not("master_place_id", "is", null).order("id").limit(400);
  if (junkSample.error || junkSample.data == null) { console.log("QUERY FAILED:", JSON.stringify(junkSample, null, 2)); throw new Error("junk scan"); }
  const junkRows = (junkSample.data as unknown as Row[])
    .filter((r) => descOf(r) !== null && !passesViewpointContentFilter(descOf(r), r.name))
    .slice(0, 2);

  for (const ext of negatives) {
    const r = await db.from("source_record").select("external_id, name, is_active, master_place_id, normalized_payload, raw_payload").eq("external_id", ext).single();
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("neg"); }
    const row = r.data as unknown as Row;
    const el = row.raw_payload?.element;
    if (el?.lat != null && el?.lon != null) {
      await probe(row.master_place_id!, el.lon, el.lat, false,
        "City Hall Observation Deck (description null — never qualified):",
        `is_active=${row.is_active}  description=${JSON.stringify(descOf(row))}`);
    }
  }
  for (const r of junkRows) {
    const el = r.raw_payload?.element;
    if (el?.lat == null || el?.lon == null) continue;
    await probe(r.master_place_id!, el.lon, el.lat, false,
      "excluded junk row:", `${r.external_id}  description=${JSON.stringify(descOf(r))}  is_active=${r.is_active}`);
  }

  console.log(`\nCHECKS: ${passes}/${checks} passed`);
  if (passes !== checks) throw new Error("propagation check failed");
}

main().catch((e) => { console.error(e); process.exit(1); });
