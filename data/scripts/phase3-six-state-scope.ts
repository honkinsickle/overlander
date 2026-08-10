/** PROD READ-only scope-narrowing investigation. Six states: WA OR CA AZ NV UT.
 *
 *  Footprint definition: per-state bboxes, unioned. This is a defensible
 *  approximation (state polygons would be tighter but need TIGER data);
 *  minor Pacific-Ocean overshoot on the western edges, minor slivers of
 *  BC/ID/WY/NM/MX on landward borders. Rows classified as "in-scope" if
 *  their lat/lng lands inside ANY of the six state bboxes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME!;
const PROD_ENV = join(HOME, ".config/overlander/env-backups/.env.production-backup");

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

// Per-state approximate bboxes (rounded envelopes) — [W, S, E, N]
const STATE_BBOXES: Record<string, [number, number, number, number]> = {
  WA: [-124.85, 45.55, -116.90, 49.00],
  OR: [-124.75, 42.00, -116.45, 46.30],
  CA: [-124.50, 32.53, -114.13, 42.01],
  AZ: [-114.82, 31.33, -109.05, 37.00],
  NV: [-120.01, 35.00, -114.04, 42.00],
  UT: [-114.05, 37.00, -109.04, 42.00],
};

function inFootprint(lng: number, lat: number): string | null {
  for (const [state, [w, s, e, n]] of Object.entries(STATE_BBOXES)) {
    if (lng >= w && lng <= e && lat >= s && lat <= n) return state;
  }
  return null;
}

async function main() {
  const prodEnv = parseEnv(PROD_ENV);
  const url = prodEnv.SUPABASE_URL;
  const key = prodEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.includes("nqzeywzcowujzyegxbsr")) throw new Error("PROD env not PROD");
  const db = createClient(url, key!, { auth: { persistSession: false } });
  console.log(`[env] PROD ${url.match(/\/\/([^.]+)\./)?.[1]}`);
  console.log(`[method] classify each source_record by lng/lat against per-state bboxes (WA OR CA AZ NV UT). union = footprint.`);
  console.log(`[caveat] bbox-union includes small offshore/Baja/border-sliver over-inclusion vs true state polygons (~1-2% overshoot).\n`);

  // ─── 1. Pull all source_records with geometry, classify ────────────
  // Use the search_export view for master_place — but source_record needs its own read.
  // PostgREST can't project ST_X/ST_Y directly, so we page through and read the
  // geometry via a normalized_payload.coords fallback OR use raw_payload for OSM
  // and lat/lon fields for others. Simplest: page source_record, project
  // (source_id, master_place_id, raw_payload, normalized_payload) and extract
  // coords via a source-specific rule.

  type SR = { id: string; source_id: string; master_place_id: string | null; raw_payload: any; normalized_payload: any };
  const rows: SR[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, source_id, master_place_id, raw_payload, normalized_payload")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as SR[];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  console.log(`source_records total on PROD: ${rows.length}`);

  // Extract coords per row (source-shape aware)
  const extract = (r: SR): [number, number] | null => {
    // Normalized_payload.coords is [lng, lat] convention when present
    const nc = r.normalized_payload?.coords;
    if (Array.isArray(nc) && nc.length >= 2) return [Number(nc[0]), Number(nc[1])];
    // OSM
    const el = r.raw_payload?.element;
    if (el?.lat != null && el?.lon != null) return [Number(el.lon), Number(el.lat)];
    // NPS place / campground: latitude/longitude fields on the raw
    const p = r.raw_payload?.place ?? r.raw_payload?.campground ?? r.raw_payload?.park ?? r.raw_payload?.recarea ?? r.raw_payload?.facility;
    if (p?.latitude != null && p?.longitude != null) return [Number(p.longitude), Number(p.latitude)];
    if (p?.FacilityLatitude != null && p?.FacilityLongitude != null) return [Number(p.FacilityLongitude), Number(p.FacilityLatitude)];
    if (p?.RecAreaLatitude != null && p?.RecAreaLongitude != null) return [Number(p.RecAreaLongitude), Number(p.RecAreaLatitude)];
    // Google
    const g = r.raw_payload?.place?.location ?? r.raw_payload?.location;
    if (g?.latitude != null && g?.longitude != null) return [Number(g.longitude), Number(g.latitude)];
    return null;
  };

  const buckets = { in: new Map<string, number>(), out: new Map<string, number>(), noCoords: new Map<string, number>() };
  const inMpIds = new Set<string>();
  const outMpIds = new Set<string>();
  const srToState = new Map<string, string | null>(); // for co-link check
  const inStateBySource = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const c = extract(r);
    if (!c) {
      buckets.noCoords.set(r.source_id, (buckets.noCoords.get(r.source_id) ?? 0) + 1);
      continue;
    }
    const state = inFootprint(c[0], c[1]);
    if (state) {
      buckets.in.set(r.source_id, (buckets.in.get(r.source_id) ?? 0) + 1);
      if (r.master_place_id) inMpIds.add(r.master_place_id);
      srToState.set(r.id, state);
      const perSrc = inStateBySource.get(r.source_id) ?? new Map<string, number>();
      perSrc.set(state, (perSrc.get(state) ?? 0) + 1);
      inStateBySource.set(r.source_id, perSrc);
    } else {
      buckets.out.set(r.source_id, (buckets.out.get(r.source_id) ?? 0) + 1);
      if (r.master_place_id) outMpIds.add(r.master_place_id);
      srToState.set(r.id, null);
    }
  }

  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`\n─── source_records by scope ───`);
  console.log(`  in-scope   : ${total(buckets.in).toString().padStart(6)}`);
  console.log(`  out-scope  : ${total(buckets.out).toString().padStart(6)}`);
  console.log(`  no-coords  : ${total(buckets.noCoords).toString().padStart(6)}   (couldn't extract lng/lat)`);

  console.log(`\n─── in-scope source_records by source_id ───`);
  const allSources = new Set([...buckets.in.keys(), ...buckets.out.keys(), ...buckets.noCoords.keys()]);
  const inTotalRows = total(buckets.in);
  for (const s of [...allSources].sort()) {
    const i = buckets.in.get(s) ?? 0, o = buckets.out.get(s) ?? 0, n = buckets.noCoords.get(s) ?? 0;
    const pct = inTotalRows > 0 ? ((i / inTotalRows) * 100).toFixed(1) : "-";
    console.log(`  ${s.padEnd(24)} in=${i.toString().padStart(6)}  out=${o.toString().padStart(6)}  no-coords=${n.toString().padStart(4)}   in-scope %=${pct}%`);
  }

  // ─── 2. Master_places by scope ──────────────────────────────────────
  console.log(`\n─── master_places touched ───`);
  console.log(`  distinct MPs with ≥1 in-scope SR   : ${inMpIds.size}`);
  console.log(`  distinct MPs with ≥1 out-scope SR  : ${outMpIds.size}`);
  const bothScope = [...inMpIds].filter((id) => outMpIds.has(id));
  console.log(`  MPs with BOTH (co-linked across footprint boundary) : ${bothScope.length}`);
  console.log(`  MPs purely in-scope                : ${inMpIds.size - bothScope.length}`);
  console.log(`  MPs purely out-scope               : ${outMpIds.size - bothScope.length}`);

  // Also fetch total MPs count and filter out unlinked (SRs with no MP)
  const { count: totalMp } = await db.from("master_place").select("id", { count: "exact", head: true });
  const { count: searchableMp } = await db.from("master_place").select("id", { count: "exact", head: true }).eq("is_searchable", true).neq("primary_category", "land_status");
  console.log(`  PROD master_place total            : ${totalMp}`);
  console.log(`  PROD searchable non-land_status    : ${searchableMp}`);

  // ─── 3. In-scope composition percentages ───────────────────────────
  console.log(`\n─── IN-SCOPE composition (source_records) ───`);
  const inRanked = [...buckets.in.entries()].sort((a, b) => b[1] - a[1]);
  for (const [s, n] of inRanked) {
    console.log(`  ${s.padEnd(24)} ${n.toString().padStart(6)}   ${((n / inTotalRows) * 100).toFixed(1)}%`);
  }

  // ─── 4. Per-state distribution (in-scope) ──────────────────────────
  console.log(`\n─── IN-SCOPE per-state distribution (source_records) ───`);
  const stateOrder = ["WA", "OR", "CA", "AZ", "NV", "UT"];
  console.log(`  ${"source".padEnd(24)}  ${stateOrder.map((s) => s.padStart(6)).join("")}`);
  for (const [src, perSrc] of inStateBySource) {
    const line = "  " + src.padEnd(24) + "  " + stateOrder.map((s) => (perSrc.get(s) ?? 0).toString().padStart(6)).join("");
    console.log(line);
  }

  // ─── 5. Trip / corridor / typesense blast radius ───────────────────
  console.log(`\n─── OUT-OF-SCOPE REMOVAL BLAST RADIUS ───`);
  const rt = await db.from("reference_trips").select("id, name, payload");
  console.log(`  reference_trips total: ${rt.data?.length ?? 0}`);
  for (const t of (rt.data ?? []) as any[]) {
    // Coarse-scan: does trip payload contain any coords outside the footprint?
    // Waypoint / overnight coords convention: [lng, lat].
    const txt = JSON.stringify(t.payload);
    const coordRe = /\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/g;
    let outOfScope = 0, inScope = 0;
    let m: RegExpExecArray | null;
    while ((m = coordRe.exec(txt)) !== null) {
      const lng = Number(m[1]), lat = Number(m[2]);
      // heuristic: valid [lng, lat] pair
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      if (Math.abs(lng) < 90 && Math.abs(lat) > 90) continue;
      const state = inFootprint(lng, lat);
      if (state) inScope++; else outOfScope++;
    }
    console.log(`    ${(t.name || t.id).padEnd(30)} : in-scope-coords=${inScope}, out-of-scope-coords=${outOfScope}`);
  }
  const tr = await db.from("trips").select("id, payload");
  console.log(`\n  trips (user) total: ${tr.data?.length ?? 0}`);
  for (const t of (tr.data ?? []) as any[]) {
    const txt = JSON.stringify(t.payload);
    const coordRe = /\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/g;
    let outOfScope = 0, inScope = 0;
    let m: RegExpExecArray | null;
    while ((m = coordRe.exec(txt)) !== null) {
      const lng = Number(m[1]), lat = Number(m[2]);
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      if (Math.abs(lng) < 90 && Math.abs(lat) > 90) continue;
      const state = inFootprint(lng, lat);
      if (state) inScope++; else outOfScope++;
    }
    console.log(`    trip ${t.id.slice(0, 8)}...  : in-scope-coords=${inScope}, out-of-scope-coords=${outOfScope}`);
  }

  // active_corridor_buffer name
  const { data: acb } = await db.from("active_corridor_buffer").select("id, name, bbox_west, bbox_south, bbox_east, bbox_north").limit(1).single();
  console.log(`\n  active_corridor_buffer: name='${acb?.name}' bbox=[${acb?.bbox_west}, ${acb?.bbox_south}, ${acb?.bbox_east}, ${acb?.bbox_north}]`);
  console.log(`  → the active corridor spans well beyond the 6-state footprint (LA→Deadhorse); a narrowed scope needs a NEW active_corridor for ingestion.`);

  // Typesense doc count is 1:1 with master_place_search_export today
  console.log(`\n  Typesense: doc count = master_place_search_export count = ${searchableMp}`);
  console.log(`  → post-narrowing search_export would drop the out-scope MPs; sync's prune sweeps stale docs.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
