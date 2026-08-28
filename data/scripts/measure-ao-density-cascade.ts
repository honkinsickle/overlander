/**
 * READ-ONLY density-cascade measurement for the atlas_oddities PROD-
 * promotion question (PR #310 §2 Path A + Path B combined). No writes to
 * either TEST or PROD. Two independent Supabase clients — TEST from
 * data/.env, PROD from ~/.config/overlander/env-backups/.env.production-
 * backup — each fenced to SELECT-shaped calls only (rpc(pois_along_corridor)
 * + .from(...).select(...)).
 *
 * What we measure, per sample route:
 *   - TEST pois_along_corridor() result WITH AO enrichment landed
 *     (source_id='atlas_oddities' present).
 *   - PROD pois_along_corridor() result (0 AO rows on PROD; this IS the
 *     "without AO" baseline for the same route geometry).
 *   - For each TEST row, whether the underlying master_place has ANY
 *     non-AO active source_record. If NOT, the row is "AO-only" — it
 *     would disappear from the pool without AO. If YES, the row is
 *     "AO-backed" — it exists either way; AO only shapes description /
 *     photo winners.
 *   - For each AO-only row, whether there are OTHER master_place rows in
 *     PROD's return within a small radius (approximation of the
 *     "corridor city cluster" concept). An AO-only row with no PROD
 *     neighbours within 5 mi is a candidate for a city-visibility flip
 *     (city hidden today because pool has no isRealContent, becomes
 *     visible once AO's non-fuel-with-description tile arrives).
 *
 * Confirms up front — via the code in web/src/lib/corridor/derive.ts —
 * that corridor-city SELECTION is gazetteer-based (independent of POI
 * density), so adding AO POIs cannot add or drop cities from the day
 * spine. Only pool composition and the filterVisibleSpineItems() pass-
 * through-visibility rule are affected.
 *
 * Sample routes chosen for representative AO-dense geography per the
 * PR #310 §2.2 distribution (CA 86%, then OR/WA/AZ/UT/NV). Each is a
 * short 2-point LineString through a real corridor; buffer 16km matches
 * the RPC's default and the trip-generation call site.
 *
 * Run:
 *   npx tsx --env-file=data/.env data/scripts/measure-ao-density-cascade.ts
 *
 * (data/.env holds TEST creds. The script loads PROD creds separately
 * from ~/.config/overlander/env-backups/.env.production-backup so a
 * mis-run against `--env-file=<prod-file>` can never talk to TEST — the
 * two clients are hardcoded to their expected URLs.)
 */

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";
const PROD_URL = "https://nqzeywzcowujzyegxbsr.supabase.co";
const PROD_ENV_PATH = `${process.env.HOME}/.config/overlander/env-backups/.env.production-backup`;

// ── Env loading (PROD from an explicit file, not from process.env) ────
function loadEnvFile(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const testUrl = process.env.SUPABASE_URL ?? "";
const testKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (testUrl !== TEST_URL) {
  console.error(`Refusing to run — data/.env is not pinned to TEST. Got: ${testUrl}`);
  process.exit(1);
}
if (!testKey) {
  console.error("Missing TEST SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const test: SupabaseClient = createClient(testUrl, testKey, {
  auth: { persistSession: false },
});

const prodEnv = loadEnvFile(PROD_ENV_PATH);
const prodUrl = prodEnv["SUPABASE_URL"];
const prodKey = prodEnv["SUPABASE_SERVICE_ROLE_KEY"];
if (prodUrl !== PROD_URL) {
  console.error(`Refusing to run — PROD env file's SUPABASE_URL does not match PROD ref. Got: ${prodUrl}`);
  process.exit(1);
}
if (!prodKey) {
  console.error(`Missing PROD SUPABASE_SERVICE_ROLE_KEY in ${PROD_ENV_PATH}.`);
  process.exit(1);
}
const prod: SupabaseClient = createClient(prodUrl, prodKey, {
  auth: { persistSession: false },
});

// ── Sample routes (CA-heavy, then one per remaining state) ────────────
type LineRoute = { type: "LineString"; coordinates: [number, number][] };
const ROUTES: ReadonlyArray<{ label: string; route: LineRoute; note: string }> = [
  {
    label: "SF Bay: San Jose → San Francisco",
    note: "CA-heavy; peak AO density (LA basin + Bay Area dominate)",
    route: {
      type: "LineString",
      coordinates: [[-121.8863, 37.3382], [-122.4194, 37.7749]],
    },
  },
  {
    label: "LA metro: Santa Monica → Riverside",
    note: "CA-heavy; densest AO area per README (LA basin 523 places)",
    route: {
      type: "LineString",
      coordinates: [[-118.4912, 34.0195], [-117.3961, 33.9533]],
    },
  },
  {
    label: "Central Valley: Sacramento → Fresno",
    note: "CA mid-density; I-5/Hwy-99 spine",
    route: {
      type: "LineString",
      coordinates: [[-121.4944, 38.5816], [-119.7871, 36.7378]],
    },
  },
  {
    label: "Oregon coast: Portland → Eugene",
    note: "OR spine; wave-1 verified corridor extended",
    route: {
      type: "LineString",
      coordinates: [[-122.6784, 45.5152], [-123.0868, 44.0521]],
    },
  },
  {
    label: "Arizona: Phoenix → Tucson",
    note: "AZ moderate density (wave 2)",
    route: {
      type: "LineString",
      coordinates: [[-112.0740, 33.4484], [-110.9265, 32.2226]],
    },
  },
  {
    label: "Nevada: Reno → Las Vegas",
    note: "NV sparse (wave 2); tests long-desert route with few PROD POIs",
    route: {
      type: "LineString",
      coordinates: [[-119.8138, 39.5296], [-115.1398, 36.1699]],
    },
  },
  {
    label: "Utah: Salt Lake City → Moab",
    note: "UT sparse (wave 2)",
    route: {
      type: "LineString",
      coordinates: [[-111.8910, 40.7608], [-109.5498, 38.5733]],
    },
  },
  {
    label: "Washington: Seattle → Portland OR",
    note: "WA (wave 2) crossing state line into OR (wave 1)",
    route: {
      type: "LineString",
      coordinates: [[-122.3321, 47.6062], [-122.6784, 45.5152]],
    },
  },
];

// ── Types mirroring pois_along_corridor's return ──────────────────────
type CorridorRow = {
  id: string;
  canonical_name: string;
  primary_category: string;
  lng: number;
  lat: number;
  prominence_score: number | null;
  description: string | null;
  attribution: Record<string, string> | null;
  nps_photo_url: string | null;
  photo_credit: string | null;
  description_source: string | null;
};

type Verdict = "AO-only" | "AO-backed" | "no-AO";

type Enriched = CorridorRow & {
  verdict: Verdict;
  nearestProdRowMi: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────
async function callCorridorRpc(client: SupabaseClient, route: LineRoute): Promise<CorridorRow[]> {
  const r = await client.rpc("pois_along_corridor", {
    p_route: route,
    p_buffer_m: 16000,
    p_categories: null,
  });
  if (r.error || r.data == null) {
    console.error("pois_along_corridor failed:", r);
    throw new Error("rpc failed");
  }
  return r.data as CorridorRow[];
}

/** Return the set of TEST master_place_ids in `mpIds` that have at least one
 *  non-atlas_oddities active source_record. Chunked to keep URL sizes safe. */
async function backedMpIds(mpIds: string[]): Promise<Set<string>> {
  const backed = new Set<string>();
  const CHUNK = 80;
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await test
      .from("source_record")
      .select("master_place_id")
      .in("master_place_id", chunk)
      .neq("source_id", "atlas_oddities")
      .eq("is_active", true);
    if (r.error || r.data == null) {
      console.error("backed mp query failed:", r);
      throw new Error("backed query failed");
    }
    for (const row of r.data) {
      if (row.master_place_id) backed.add(row.master_place_id as string);
    }
  }
  return backed;
}

/** Haversine distance in miles between two [lng, lat] points. */
function milesBetween(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Approximate `isRealContent`: non-fuel category AND has a description. */
const FUEL_CATEGORIES = new Set(["fuel", "gas_station", "ev_charging"]);
function isRealContent(row: CorridorRow): boolean {
  if (FUEL_CATEGORIES.has(row.primary_category)) return false;
  const d = (row.description ?? "").trim();
  return d.length > 0;
}

/** Nearest-neighbour distance (miles) between an AO-only TEST row and the
 *  nearest PROD row. Used as a proxy for "does PROD already have a real
 *  content cluster here?" — an AO-only row far from any PROD content is a
 *  candidate for a city-visibility flip. */
function nearestProdMi(row: CorridorRow, prodRows: CorridorRow[]): number | null {
  if (prodRows.length === 0) return null;
  let min = Infinity;
  for (const p of prodRows) {
    const d = milesBetween([row.lng, row.lat], [p.lng, p.lat]);
    if (d < min) min = d;
  }
  return min;
}

// ── Per-route measurement ─────────────────────────────────────────────
type RouteReport = {
  label: string;
  note: string;
  testTotal: number;
  prodTotal: number;
  aoOnly: number;
  aoBacked: number;
  noAo: number;
  aoOnlyIsRealContent: number;
  prodIsRealContent: number;
  potentialCityFlips: Enriched[];
};

async function measureRoute(cfg: (typeof ROUTES)[number]): Promise<RouteReport> {
  console.log(`\n── ${cfg.label} ──`);
  console.log(`    (${cfg.note})`);

  const [testRows, prodRows] = await Promise.all([
    callCorridorRpc(test, cfg.route),
    callCorridorRpc(prod, cfg.route),
  ]);
  console.log(`  TEST rows: ${testRows.length}   PROD rows: ${prodRows.length}`);

  const testMpIds = Array.from(new Set(testRows.map((r) => r.id)));
  const backedSet = await backedMpIds(testMpIds);

  const aoDescIds = new Set(
    testRows
      .filter((r) => r.attribution?.description === "atlas_oddities")
      .map((r) => r.id),
  );

  const enriched: Enriched[] = testRows.map((r) => {
    const hasAoContribution =
      aoDescIds.has(r.id) || r.photo_credit === "Atlas Obscura";
    let verdict: Verdict;
    if (!hasAoContribution) verdict = "no-AO";
    else if (backedSet.has(r.id)) verdict = "AO-backed";
    else verdict = "AO-only";
    return { ...r, verdict, nearestProdRowMi: null };
  });

  const aoOnly = enriched.filter((e) => e.verdict === "AO-only");
  for (const row of aoOnly) row.nearestProdRowMi = nearestProdMi(row, prodRows);

  const CITY_CLUSTER_MI = 5;
  const potentialCityFlips = aoOnly.filter(
    (r) =>
      isRealContent(r) &&
      (r.nearestProdRowMi ?? Infinity) > CITY_CLUSTER_MI,
  );

  const report: RouteReport = {
    label: cfg.label,
    note: cfg.note,
    testTotal: testRows.length,
    prodTotal: prodRows.length,
    aoOnly: aoOnly.length,
    aoBacked: enriched.filter((e) => e.verdict === "AO-backed").length,
    noAo: enriched.filter((e) => e.verdict === "no-AO").length,
    aoOnlyIsRealContent: aoOnly.filter(isRealContent).length,
    prodIsRealContent: prodRows.filter(isRealContent).length,
    potentialCityFlips,
  };

  console.log(
    `  breakdown: AO-only=${report.aoOnly}  AO-backed=${report.aoBacked}  no-AO=${report.noAo}`,
  );
  console.log(
    `  AO-only rows that clear isRealContent (non-fuel + described): ${report.aoOnlyIsRealContent}`,
  );
  console.log(
    `  PROD rows that clear isRealContent (today's baseline): ${report.prodIsRealContent}`,
  );
  console.log(
    `  potential city flips (AO-only, real content, >${CITY_CLUSTER_MI} mi from nearest PROD row): ${report.potentialCityFlips.length}`,
  );
  for (const f of report.potentialCityFlips.slice(0, 5)) {
    const d = f.nearestProdRowMi == null ? "n/a" : f.nearestProdRowMi.toFixed(1);
    console.log(
      `    • ${f.canonical_name} [${f.primary_category}] @ ${f.lng.toFixed(4)},${f.lat.toFixed(4)}  nearestProd=${d}mi`,
    );
  }
  if (report.potentialCityFlips.length > 5) {
    console.log(`      … ${report.potentialCityFlips.length - 5} more`);
  }
  return report;
}

// ── Verify corridor-city selection is gazetteer-based (independent) ───
async function verifyCorridorCitySelectionIsGazetteerBased() {
  console.log("=".repeat(72));
  console.log("Corridor-city SELECTION is gazetteer-based, not POI-derived");
  console.log("=".repeat(72));
  console.log(
    "  Source: web/src/lib/corridor/derive.ts — `deriveCorridorCities` takes",
  );
  console.log(
    "  gazetteer: GazetteerCity[] as input and applies the ≤3mi corridorMi",
  );
  console.log(
    "  rule to a city's straight-line offset from the day polyline. POI",
  );
  console.log(
    "  density is NOT a parameter. Therefore promoting AO cannot add or",
  );
  console.log(
    "  drop cities from the spine. The only surface AO can affect is:",
  );
  console.log(
    "    - pool composition within each already-selected city, and",
  );
  console.log(
    "    - `filterVisibleSpineItems()` verdict (pass-through city drops",
  );
  console.log(
    "      when no tile clears `isRealContent = non-fuel && hasDescription`).",
  );
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(72));
  console.log("Atlas Obscura → PROD density-cascade measurement");
  console.log(`TEST: ${TEST_URL}`);
  console.log(`PROD: ${PROD_URL}   (read-only via ${PROD_ENV_PATH})`);
  console.log("=".repeat(72));

  await verifyCorridorCitySelectionIsGazetteerBased();

  const reports: RouteReport[] = [];
  for (const cfg of ROUTES) {
    const r = await measureRoute(cfg);
    reports.push(r);
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(
    "route".padEnd(48) +
      "TEST".padStart(6) +
      "PROD".padStart(6) +
      "AO-only".padStart(10) +
      "AO-realC".padStart(10) +
      "flip?".padStart(8),
  );
  for (const r of reports) {
    console.log(
      r.label.padEnd(48) +
        r.testTotal.toString().padStart(6) +
        r.prodTotal.toString().padStart(6) +
        r.aoOnly.toString().padStart(10) +
        r.aoOnlyIsRealContent.toString().padStart(10) +
        r.potentialCityFlips.length.toString().padStart(8),
    );
  }

  const totalFlips = reports.reduce(
    (s, r) => s + r.potentialCityFlips.length,
    0,
  );
  const totalAoOnly = reports.reduce((s, r) => s + r.aoOnly, 0);
  const totalAoRealC = reports.reduce((s, r) => s + r.aoOnlyIsRealContent, 0);
  console.log(
    "\nTotals — AO-only rows across all sampled routes: " +
      totalAoOnly +
      ", of which real-content: " +
      totalAoRealC +
      ", potential city-flip candidates: " +
      totalFlips,
  );

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
