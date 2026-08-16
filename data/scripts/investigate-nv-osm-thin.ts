/**
 * Read-only investigation: why does NV have only 6 rows in the
 * grounding-eligible category set after the six-state OSM ingest?
 *
 * NV bbox: [-120.01, 35.00, -114.04, 42.00]
 * NO WRITES. NO EXTERNAL APIs. TEST only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const NV_BBOX = { west: -120.01, south: 35.0, east: -114.04, north: 42.0 };
const ENRICH_CATEGORIES = ["campground", "gas_station", "lodging"] as const;
const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}

type SR = {
  id: string;
  source_id: string;
  external_id: string;
  name: string | null;
  inferred_category: string | null;
  lng: number;
  lat: number;
  is_active: boolean;
};

async function fetchAll(
  db: SupabaseClient,
  opts: { sourceId?: string; sourceIds?: string[]; categories?: readonly string[]; activeOnly?: boolean } = {},
): Promise<SR[]> {
  const PAGE = 1000;
  const rows: SR[] = [];
  let from = 0;
  while (true) {
    let q = db
      .from("source_record_view")
      .select("id, source_id, external_id, name, inferred_category, lng, lat, is_active")
      .gte("lng", NV_BBOX.west)
      .lte("lng", NV_BBOX.east)
      .gte("lat", NV_BBOX.south)
      .lte("lat", NV_BBOX.north)
      .order("id")
      .range(from, from + PAGE - 1);
    if (opts.sourceId) q = q.eq("source_id", opts.sourceId);
    if (opts.sourceIds) q = q.in("source_id", opts.sourceIds);
    if (opts.categories) q = q.in("inferred_category", [...opts.categories]);
    const r = await q;
    if (r.error || r.data == null) {
      console.error("QUERY FAILED:", r);
      throw new Error("query failed");
    }
    rows.push(...(r.data as SR[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  // source_record_view already filters is_active=true; opts.activeOnly is a no-op
  return rows;
}

/**
 * source_record_view filters is_active=true. To count "all osm rows the
 * ingest landed" (active + inactive) we hit source_record directly.
 * source_record has no lng/lat columns — use geometry via a PostGIS-aware
 * PostgREST filter is not available. Fall back to a rough count via
 * source_record joined to source_record_scope, but that's six-state, not
 * NV. Simpler and sufficient: hit source_record filtered on source_id
 * and paginate; we don't need geometry, only the count. But without a
 * bbox filter we'd count all six states. Workaround: use the RPC
 * pattern via .select('*', {count:'exact', head:true}) with a
 * PostgREST filter on ST_MakeEnvelope isn't available either.
 *
 * The active/inactive question is really: are there OSM NV rows that
 * were deactivated by the trim? Since the trim ran on PROD only per
 * STATE.md, TEST has no deactivations from that. So on TEST, active =
 * total. We proceed with source_record_view (active-only) and note the
 * caveat.
 */

function tally<T extends string>(rows: readonly { key: T }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = (out[r.key] ?? 0) + 1;
  return out;
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing to run against non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  // ── Step 1: baseline
  console.log("\n=== Step 1 — baseline (osm, NV bbox, enrich categories, name-gated) ===");
  const nvOsmEnrich = await fetchAll(db, { sourceId: "osm", categories: ENRICH_CATEGORIES });
  const nvOsmEnrichNamed = nvOsmEnrich.filter(r => !isPlaceholderName(r.name));
  console.log(`  osm ∩ NV ∩ enrich-categories: ${nvOsmEnrich.length}`);
  console.log(`  after name gate:              ${nvOsmEnrichNamed.length}  (measurement task said ~6)`);
  console.log(`  by category:`);
  for (const [k, v] of Object.entries(tally(nvOsmEnrichNamed.map(r => ({ key: r.inferred_category ?? "null" }))))) console.log(`    ${k.padEnd(15)} ${v}`);
  console.log(`  sample name-gated rows (id · category · name):`);
  for (const r of nvOsmEnrichNamed.slice(0, 15)) console.log(`    ${r.id.slice(0,8)}  ${(r.inferred_category ?? "?").padEnd(15)}  ${r.name}`);

  // ── Step 2a: total osm in NV bbox (all categories)
  console.log("\n=== Step 2a — all osm rows in NV bbox ===");
  const nvOsmAll = await fetchAll(db, { sourceId: "osm" });
  console.log(`  total osm rows (active) in NV bbox: ${nvOsmAll.length}`);

  // ── Step 2d: category breakdown for all NV OSM
  console.log("\n=== Step 2d — NV OSM by inferred_category (top 25) ===");
  const nvOsmCats = tally(nvOsmAll.map(r => ({ key: r.inferred_category ?? "null" })));
  const sortedCats = Object.entries(nvOsmCats).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sortedCats.slice(0, 25)) console.log(`    ${k.padEnd(20)} ${v}`);
  console.log(`  (${sortedCats.length} distinct categories total)`);

  // ── Step 2b/c reconciliation
  console.log("\n=== Step 2b/c — funnel reconciliation ===");
  console.log(`  (a) total osm NV bbox                : ${nvOsmAll.length}`);
  console.log(`  (b) + enrich-categories             : ${nvOsmEnrich.length}   drop ${nvOsmAll.length - nvOsmEnrich.length}`);
  console.log(`  (c) + isPlaceholderName === false   : ${nvOsmEnrichNamed.length}   drop ${nvOsmEnrich.length - nvOsmEnrichNamed.length}`);
  console.log(`  placeholders dropped by name gate:`);
  const droppedByName = nvOsmEnrich.filter(r => isPlaceholderName(r.name));
  const droppedNames = tally(droppedByName.map(r => ({ key: (r.name ?? "<null>").toLowerCase() })));
  for (const [k, v] of Object.entries(droppedNames).slice(0, 10)) console.log(`    ${v.toString().padStart(4)}  ${k}`);

  // ── Step 3: STATE.md claimed 168 OSM rows for NV
  console.log("\n=== Step 3 — vs STATE.md claim of '168 OSM rows total for NV' ===");
  console.log(`  Measured (active in source_record_view, NV bbox): ${nvOsmAll.length}`);
  console.log(`  Note: STATE.md 2026-08-13 quoted 168 for 'NV OSM camping' (dispersed_camping ISO-area count),`);
  console.log(`  not the full multi-family NV OSM footprint. The relevant NV-camping ISO-area figure is`);
  console.log(`  '15 dispersed_camping' in the camping-only per-state grid (2026-08-10 late).`);
  const dispersed = nvOsmAll.filter(r => r.inferred_category === "dispersed_camping").length;
  const campground = nvOsmAll.filter(r => r.inferred_category === "campground").length;
  console.log(`  Measured NV OSM dispersed_camping: ${dispersed}`);
  console.log(`  Measured NV OSM campground:        ${campground}`);
  console.log(`  Measured NV OSM camping-family total (all categories mapped from camping): see 2d above`);

  // ── Step 4: three known NV campgrounds, any source within 5 km
  console.log("\n=== Step 4 — known NV campgrounds, any source within 5 km ===");
  const knowns: Array<{ label: string; lng: number; lat: number }> = [
    { label: "Valley of Fire SP visitor center",     lng: -114.5093, lat: 36.4295 },
    { label: "Great Basin NP — Baker Creek CG",      lng: -114.2711, lat: 39.0067 },
    { label: "Lake Mead NRA — Boulder Beach CG",     lng: -114.7961, lat: 36.045 },
  ];
  // Pull ALL sources in NV bbox once, then filter per known
  const nvAllSources = await fetchAll(db);
  console.log(`  pool for scan: ${nvAllSources.length} rows (all sources, NV bbox, active)`);
  console.log(`  pool by source_id:`);
  for (const [k, v] of Object.entries(tally(nvAllSources.map(r => ({ key: r.source_id }))))) console.log(`    ${k.padEnd(16)} ${v}`);
  for (const k of knowns) {
    console.log(`\n  ── ${k.label}  (${k.lng.toFixed(4)}, ${k.lat.toFixed(4)}) ──`);
    const near = nvAllSources
      .map(r => ({ r, d: haversineM(k.lng, k.lat, r.lng, r.lat) }))
      .filter(x => x.d <= 5000)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) { console.log("    NO rows within 5 km from any source"); continue; }
    for (const { r, d } of near.slice(0, 8)) {
      console.log(`    ${(d / 1000).toFixed(2).padStart(5)}km  ${r.source_id.padEnd(15)}  ${(r.inferred_category ?? "?").padEnd(18)}  ${r.name}`);
    }
    if (near.length > 8) console.log(`    (+${near.length - 8} more)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
