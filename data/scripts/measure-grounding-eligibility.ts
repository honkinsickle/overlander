/**
 * Read-only grounding-eligibility measurement (2026-08-14).
 *
 * Answers: how many source_records would fetchEnrichmentCandidates feed
 * the Google Places resolver against the six-state TEST corpus?
 *
 * Applies the same filters as the committed code path
 * (data/scripts/ingest-corridor.ts):
 *   - source_record.is_active = true (via source_record_view)
 *   - inferred_category IN (campground, gas_station, lodging)
 *   - isPlaceholderName(name) === false  (PR #218)
 *
 * Scope:
 *   - Six-state corpus: st_within(geometry, six_state_footprint())
 *     (approximated in JS via per-state bbox membership; the DB view
 *     source_record_scope is the truth but does not carry coords/category)
 *   - LA→Portland corridor: 40 km buffer around the ordered coords of
 *     reference_trips 'la-to-portland' (haversine great-circle geometry)
 *
 * NO WRITES. NO GOOGLE CALLS. NO RESOLVER RUN. TEST only.
 *
 * Run:
 *   npx tsx --env-file=data/.env .context/measurements/grounding-eligibility.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Filters that mirror committed code ──────────────────────────────────

const ENRICH_CATEGORIES = ["campground", "gas_station", "lodging"] as const;

const PLACEHOLDER_ALLOWLIST = new Set([
  "campsite",
  "designated campsite",
  "designated walk-in campsite",
]);

function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}

// ─── Six-state classification (priority-ordered bbox membership) ─────────
//
// Bboxes lifted from public.six_state_footprint(). The bboxes overlap
// (notably: CA's [-124.50, -114.13] × [32.534, 42.01] fully contains
// NV's [-120.01, -114.04] × [35, 42], and reaches into AZ/UT slivers),
// so the classifier tests INLAND-SMALL-FIRST — AZ, UT, NV each get a
// chance to claim a point before CA's wide box catches it. Then WA
// (northmost), then OR, then CA as the residual catch. The WA/OR
// Columbia-River split is approximated at lat 45.85.
//
// Prior version was WA→OR→CA→NV→UT→AZ, which mis-labeled all NV
// points as CA (measured 2026-08-14: 759 NV OSM rows appeared as CA).

type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";

function classifyState(lng: number, lat: number): State {
  // AZ: lat in [31.333, 37.00], lng in [-114.82, -109.045]
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  // UT: lat in [37.00, 42.00], lng in [-114.05, -109.04]
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  // NV: lat in [35.00, 42.00], lng in [-120.01, -114.04]
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  // WA: lat >= ~45.85 (Columbia), lng in [-124.85, -117.04]
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  // OR: lat in [41.99, 46.30], lng in [-124.75, -116.45]
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  // CA: lat in [32.534, 42.01], west of -114.13 (loose — catches Owens Valley + Sierra + rest)
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
}

// ─── Haversine + point-to-segment distance ───────────────────────────────

const R = 6371008.8; // meters, WGS84 mean earth radius

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Distance from point P to segment AB on the sphere. Uses local ENU
 * projection at P's latitude — accurate to well under 1% for 40 km scale.
 */
function pointToSegmentM(
  pLng: number, pLat: number,
  aLng: number, aLat: number,
  bLng: number, bLat: number,
): number {
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  // convert degrees to meters in local ENU
  const M_PER_DEG_LAT = 111_320;
  const M_PER_DEG_LNG = M_PER_DEG_LAT * cosLat;
  const px = pLng * M_PER_DEG_LNG, py = pLat * M_PER_DEG_LAT;
  const ax = aLng * M_PER_DEG_LNG, ay = aLat * M_PER_DEG_LAT;
  const bx = bLng * M_PER_DEG_LNG, by = bLat * M_PER_DEG_LAT;
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const qx = ax + t * abx, qy = ay + t * aby;
  // final distance via haversine for extra accuracy (undoes any ENU drift)
  const qLng = qx / M_PER_DEG_LNG, qLat = qy / M_PER_DEG_LAT;
  return haversineM(pLng, pLat, qLng, qLat);
}

function withinPolylineM(
  pLng: number, pLat: number,
  polyline: readonly [number, number][],
  maxMeters: number,
): boolean {
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLng, aLat] = polyline[i]!;
    const [bLng, bLat] = polyline[i + 1]!;
    if (pointToSegmentM(pLng, pLat, aLng, aLat, bLng, bLat) <= maxMeters) return true;
  }
  return false;
}

// ─── Query ───────────────────────────────────────────────────────────────

type Row = {
  id: string;
  source_id: string;
  name: string | null;
  inferred_category: string;
  lng: number;
  lat: number;
};

async function fetchAllCandidates(db: SupabaseClient): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db
      .from("source_record_view")
      .select("id, source_id, name, inferred_category, lng, lat")
      .in("inferred_category", [...ENRICH_CATEGORIES])
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED:", r);
      throw new Error("source_record_view query failed");
    }
    rows.push(...(r.data as Row[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function fetchLaToPortlandPolyline(db: SupabaseClient): Promise<[number, number][]> {
  // reference_trips.payload holds the Trip JSON; days[].coords is [lng, lat]
  const r = await db
    .from("reference_trips")
    .select("id, payload")
    .eq("id", "la-to-portland")
    .maybeSingle();
  if (r.error || r.data == null) {
    console.error("QUERY FAILED (reference_trips la-to-portland):", r);
    throw new Error("could not read la-to-portland reference trip");
  }
  const payload = (r.data.payload ?? {}) as { days?: Array<{ coords?: [number, number] }> };
  const days = payload.days ?? [];
  const poly = days
    .map(d => d.coords)
    .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (poly.length < 2) throw new Error(`la-to-portland has ${poly.length} usable coords — need >=2`);
  return poly;
}

// ─── Reporting helpers ───────────────────────────────────────────────────

function tally<T extends string>(rows: readonly { key: T }[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const r of rows) out[r.key] = (out[r.key] ?? 0) + 1;
  return out;
}

function printBreakdown(label: string, rows: Row[]) {
  const byCat = tally(rows.map(r => ({ key: r.inferred_category as string })));
  const bySrc = tally(rows.map(r => ({ key: r.source_id as string })));
  const byState = tally(rows.map(r => ({ key: classifyState(r.lng, r.lat) as string })));
  console.log(`\n── ${label} — n=${rows.length.toLocaleString()} ──`);
  console.log("  by inferred_category:");
  for (const k of Object.keys(byCat).sort()) console.log(`    ${k.padEnd(14)} ${byCat[k].toLocaleString()}`);
  console.log("  by source_id:");
  for (const k of Object.keys(bySrc).sort()) console.log(`    ${k.padEnd(14)} ${bySrc[k].toLocaleString()}`);
  console.log("  by state:");
  for (const k of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"]) {
    console.log(`    ${k.padEnd(14)} ${(byState[k] ?? 0).toLocaleString()}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const projectRef = new URL(url).host.split(".")[0];
  console.log(`Project: ${projectRef}  (must be TEST znldzjdatkogdktymtvi)`);
  if (projectRef !== "znldzjdatkogdktymtvi") {
    throw new Error(`Refusing to run against non-TEST project: ${projectRef}`);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log("Fetching all is_active source_record_view rows in the three enrichment categories…");
  const all = await fetchAllCandidates(db);
  console.log(`  raw rows (pre name-gate, no scope): ${all.length.toLocaleString()}`);

  // Name gate (PR #218)
  const named = all.filter(r => !isPlaceholderName(r.name));
  console.log(`  after isPlaceholderName gate:        ${named.length.toLocaleString()}  (dropped ${(all.length - named.length).toLocaleString()})`);

  // Six-state scope (JS bbox classification)
  const inSix = named.filter(r => classifyState(r.lng, r.lat) !== "outside");
  console.log(`  after six-state bbox scope:          ${inSix.length.toLocaleString()}  (dropped ${(named.length - inSix.length).toLocaleString()} outside)`);

  // ── (1)+(2) Corpus-wide, current filter (gas_station included)
  printBreakdown("SIX-STATE, current filter (campground / gas_station / lodging)", inSix);

  // ── (3) Corpus-wide, gas_station removed
  const inSixNoGas = inSix.filter(r => r.inferred_category !== "gas_station");
  printBreakdown("SIX-STATE, gas_station REMOVED (campground / lodging only)", inSixNoGas);

  // ── (4) LA→Portland corridor scope
  console.log("\nBuilding LA→Portland polyline from reference_trips.la-to-portland…");
  const poly = await fetchLaToPortlandPolyline(db);
  console.log(`  polyline vertices: ${poly.length}`);
  console.log(`  first→last: [${poly[0]}] → [${poly[poly.length - 1]}]`);

  const BUFFER_M = 40_000;
  const laPortlandAll = named.filter(r => withinPolylineM(r.lng, r.lat, poly, BUFFER_M));
  const laPortlandNoGas = laPortlandAll.filter(r => r.inferred_category !== "gas_station");
  printBreakdown(`LA→PORTLAND (40 km buffer), current filter`, laPortlandAll);
  printBreakdown(`LA→PORTLAND (40 km buffer), gas_station REMOVED`, laPortlandNoGas);

  // ── (5) Cost projection
  const COST_PER_CALL = 0.032;
  const money = (n: number) => `$${(n * COST_PER_CALL).toFixed(2)}`;
  console.log("\n── COST PROJECTION at $0.032/call ──");
  console.log(`  Six-state, current filter:              ${inSix.length.toLocaleString().padStart(7)}  ${money(inSix.length)}`);
  console.log(`  Six-state, gas removed:                 ${inSixNoGas.length.toLocaleString().padStart(7)}  ${money(inSixNoGas.length)}`);
  console.log(`  LA→Portland 40km, current filter:       ${laPortlandAll.length.toLocaleString().padStart(7)}  ${money(laPortlandAll.length)}`);
  console.log(`  LA→Portland 40km, gas removed:          ${laPortlandNoGas.length.toLocaleString().padStart(7)}  ${money(laPortlandNoGas.length)}`);

  const inRange = (n: number) => {
    const $ = n * COST_PER_CALL;
    return $ >= 30 && $ <= 50 ? "IN $30–50" : $ < 30 ? "BELOW $30" : "ABOVE $50";
  };
  console.log(`\n  → LA→Portland dry-run band (current filter):  ${inRange(laPortlandAll.length)}`);
  console.log(`  → LA→Portland dry-run band (gas removed):     ${inRange(laPortlandNoGas.length)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
