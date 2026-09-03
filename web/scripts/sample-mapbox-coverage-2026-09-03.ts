/**
 * Mapbox Search Box coverage sampling — closes the gap left by
 * `docs/investigations/2026-09-02-category-source-audit.md` (PR #364), which
 * established which canonical category ids EXIST but never asked whether data
 * actually comes back at real six-state locations.
 *
 * READ-ONLY: issues GET requests to Mapbox's public category endpoint. No DB,
 * no writes, no Typesense, no browser.
 *
 * METHOD NOTES that matter when reading the output:
 *   - `bboxFromCoords` is imported from the app, so the bbox math is
 *     production's, not a reimplementation.
 *   - ONE fixed probe radius for every category (PROBE_RADIUS_KM), so densities
 *     are comparable across categories. Production uses PER-CATEGORY radii
 *     (5–50 km, DEFAULT_RADIUS_KM_BY_CATEGORY). For any category whose
 *     production radius is larger than the probe radius — camping is 50 km —
 *     these counts are a FLOOR, not the production figure.
 *   - `limit=25` mirrors the app's MAX_RESULTS and is Mapbox's own ceiling. A
 *     result of exactly 25 means "at least 25", NOT "25". Counted separately as
 *     `saturated` so a saturated cell is never read as an exact density.
 *
 * Sample points are REUSED from existing repo fixtures / verify scripts, not
 * invented — provenance recorded per point below.
 */
import { bboxFromCoords } from "../src/lib/discovery/discovery";

const ENDPOINT = "https://api.mapbox.com/search/searchbox/v1/category";
const PROBE_RADIUS_KM = 10;
const LIMIT = 25;
const CONCURRENCY = 4;

type Point = { state: string; tier: "metro" | "rural"; label: string; coords: [number, number]; provenance: string };

const POINTS: Point[] = [
  // ── metro tier: the labelled probes the atlas-oddities + family-destinations
  //    verify scripts already use.
  { state: "OR", tier: "metro", label: "Portland", coords: [-122.7, 45.515], provenance: "data/scripts/atlas-oddities-prod-verify.ts:42" },
  { state: "WA", tier: "metro", label: "Seattle", coords: [-122.35, 47.6], provenance: "data/scripts/atlas-oddities-prod-verify.ts:43" },
  { state: "AZ", tier: "metro", label: "Phoenix", coords: [-112.1, 33.45], provenance: "data/scripts/atlas-oddities-prod-verify.ts:44" },
  { state: "UT", tier: "metro", label: "Salt Lake City", coords: [-111.9, 40.75], provenance: "data/scripts/atlas-oddities-prod-verify.ts:45" },
  { state: "NV", tier: "metro", label: "Las Vegas", coords: [-115.2, 36.15], provenance: "data/scripts/atlas-oddities-prod-verify.ts:46" },
  { state: "CA", tier: "metro", label: "San Diego", coords: [-117.28, 32.74], provenance: "data/scripts/family-destinations-verify.ts:20" },

  // ── rural tier: overland-relevant anchors. Four come from the browse
  //    fixtures; AZ and NV had no usable fixture, so they are drawn from the
  //    TEST corpus (selection method recorded in the report).
  { state: "CA", tier: "rural", label: "Cabazon Dinosaurs", coords: [-116.788, 33.917], provenance: "web/src/lib/trip-browse/places.ts:357" },
  { state: "OR", tier: "rural", label: "Tumalo State Park", coords: [-121.327, 44.119], provenance: "web/src/lib/trip-browse/places.ts:382" },
  { state: "UT", tier: "rural", label: "Hurricane Cliffs BLM", coords: [-113.29, 37.165], provenance: "web/src/lib/trip-browse/places.ts:406" },
  { state: "WA", tier: "rural", label: "Ohanapecosh Campground", coords: [-121.567, 46.73], provenance: "web/src/lib/trip-browse/places.ts:429" },
  { state: "AZ", tier: "rural", label: "Fool Hollow Lake Rec Area", coords: [-110.0613, 34.2731], provenance: "TEST corpus: top-prominence unambiguous-AZ campground >1deg from Phoenix" },
  { state: "NV", tier: "rural", label: "Cave Lake State Park", coords: [-114.6986, 39.1795], provenance: "TEST corpus: nevada_state_parks-sourced, >1deg from Las Vegas" },
];

/** Mapbox canonical ids to probe, tagged with the #364 row each informs.
 *  Only ids #364 recorded as EXISTING are here — the four it recorded as
 *  ABSENT (dispersed camping, water fill, showers, dump stations) are carried
 *  forward in the report and deliberately not re-derived. */
const PROBES: { row: string; ids: string[] }[] = [
  { row: "Campgrounds / camping", ids: ["campground"] },
  { row: "Trailheads", ids: ["trailhead"] },
  { row: "Viewpoints / scenic", ids: ["viewpoint"] },
  { row: "Gas / fuel", ids: ["gas_station", "charging_station"] },
  { row: "Auto / Repair", ids: ["auto_repair", "repair_shop", "car_wash"] },
  { row: "Coffee", ids: ["cafe", "coffee_shop"] },
  { row: "Restaurants / food", ids: ["restaurant"] },
  { row: "Groceries", ids: ["grocery", "supermarket"] },
  { row: "Hotels / overnight", ids: ["hotel", "motel", "lodging"] },
  { row: "attraction", ids: ["museum", "art_gallery", "historic_site", "monument"] },
  { row: "oddity", ids: ["tourist_attraction"] },
  { row: "interest", ids: ["rest_area", "laundry"] },
  { row: "urban", ids: ["park", "theme_park", "dog_park"] },
];

type Cell = { id: string; point: Point; ok: boolean; status: number; count: number; error?: string };

async function probe(id: string, point: Point, token: string): Promise<Cell> {
  const bbox = bboxFromCoords(point.coords, PROBE_RADIUS_KM);
  const u = new URL(`${ENDPOINT}/${id}`);
  u.searchParams.set("bbox", bbox.join(","));
  u.searchParams.set("limit", String(LIMIT));
  u.searchParams.set("access_token", token);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(u.toString());
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { id, point, ok: false, status: res.status, count: 0, error: body.slice(0, 120) };
    }
    const j = (await res.json()) as { features?: unknown[] };
    if (!Array.isArray(j.features)) {
      return { id, point, ok: false, status: res.status, count: 0, error: "no features array" };
    }
    return { id, point, ok: true, status: res.status, count: j.features.length };
  }
  return { id, point, ok: false, status: 429, count: 0, error: "rate limited after retry" };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    console.error("NEXT_PUBLIC_MAPBOX_TOKEN not set. Export it from web/.env.local first.");
    process.exit(2);
  }
  const allIds = PROBES.flatMap((p) => p.ids);
  console.log(`Mapbox coverage sampling — ${allIds.length} category ids x ${POINTS.length} points = ${allIds.length * POINTS.length} requests`);
  console.log(`Probe radius ${PROBE_RADIUS_KM} km (fixed, NOT production per-category radii); limit=${LIMIT} (Mapbox ceiling)`);
  console.log(`Run started: ${new Date().toISOString()}\n`);

  const jobs = allIds.flatMap((id) => POINTS.map((point) => ({ id, point })));
  const cells = await pool(jobs, CONCURRENCY, (j) => probe(j.id, j.point, token));

  const failed = cells.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.log(`⚠️  ${failed.length} of ${cells.length} requests FAILED:`);
    for (const f of failed.slice(0, 10)) console.log(`   ${f.id} @ ${f.point.label}: HTTP ${f.status} ${f.error ?? ""}`);
    console.log("");
  }

  const byId = new Map<string, Cell[]>();
  for (const c of cells) {
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id)!.push(c);
  }

  console.log("=== PER CATEGORY ID (TSV) ===");
  console.log("row\tmapbox_id\tmetro_pts_with_hits\trural_pts_with_hits\tmetro_features\trural_features\tsaturated_cells\tfailed_cells");
  for (const p of PROBES) {
    for (const id of p.ids) {
      const cs = byId.get(id) ?? [];
      const ok = cs.filter((c) => c.ok);
      const metro = ok.filter((c) => c.point.tier === "metro");
      const rural = ok.filter((c) => c.point.tier === "rural");
      const nMetro = POINTS.filter((x) => x.tier === "metro").length;
      const nRural = POINTS.filter((x) => x.tier === "rural").length;
      console.log(
        `${p.row}\t${id}\t` +
        `${metro.filter((c) => c.count > 0).length}/${nMetro}\t` +
        `${rural.filter((c) => c.count > 0).length}/${nRural}\t` +
        `${metro.reduce((a, c) => a + c.count, 0)}\t` +
        `${rural.reduce((a, c) => a + c.count, 0)}\t` +
        `${ok.filter((c) => c.count >= LIMIT).length}\t` +
        `${cs.length - ok.length}`,
      );
    }
  }

  console.log("\n=== PER POINT x ID MATRIX (features; 'x'=request failed, '25+'=saturated) ===");
  const header = POINTS.map((p) => `${p.state}-${p.tier === "metro" ? "M" : "R"}`).join("\t");
  console.log(`mapbox_id\t${header}`);
  for (const id of allIds) {
    const cs = byId.get(id) ?? [];
    const row = POINTS.map((p) => {
      const c = cs.find((x) => x.point.label === p.label);
      if (!c) return "?";
      if (!c.ok) return "x";
      return c.count >= LIMIT ? "25+" : String(c.count);
    }).join("\t");
    console.log(`${id}\t${row}`);
  }

  console.log("\n=== SAMPLE POINTS ===");
  for (const p of POINTS) console.log(`  ${p.state} ${p.tier}\t${p.label}\t[${p.coords.join(", ")}]\t${p.provenance}`);
  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
