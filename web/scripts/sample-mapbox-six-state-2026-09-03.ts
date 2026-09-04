/**
 * Mapbox Search Box — six-state coverage sample + taxonomy-mismatch audit.
 *
 * READ-ONLY: GETs against Mapbox's public Search Box endpoints. No DB, no
 * writes, no Typesense, no browser.
 *
 * WHAT THIS ADDS over `sample-mapbox-coverage-2026-09-03.ts` (#366). Three
 * things, each aimed at a gap that pass left open:
 *
 *  1. CANONICAL ID ENUMERATION. #364 established id existence by spot-checking
 *     individual ids; when a probe returned nothing it could not distinguish
 *     "no such category" from "category exists, no data here" — #366's own
 *     negative control showed a nonsense id returns HTTP 200 with 0 features,
 *     exactly like a real-but-empty one. This pass pulls the FULL canonical
 *     list from `/list/category` first, so id existence is a membership test
 *     against a population, not an inference from an empty result.
 *
 *  2. A THIRD, GENUINELY REMOTE TIER. #366 flagged its own rural tier as
 *     heterogeneous: only 2 of its 6 "rural" points (Ohanapecosh, Cave Lake)
 *     are actually remote; the rest sit beside Bend / Show Low / St George /
 *     I-10. Its "Mapbox tracks settlement, not geography" hypothesis therefore
 *     rested on two points. This pass keeps all 12 of #366's points VERBATIM
 *     (so the numbers stay comparable) and adds six genuinely remote
 *     overland anchors, one per state. Each remote point's state is CONFIRMED
 *     by Mapbox reverse geocoding rather than asserted — the repo's own
 *     STATE_BOXES classifier is known-broken for NV.
 *
 *  3. poi_category CAPTURE — the taxonomy-mismatch detector. `repair_shop` was
 *     caught (2026-09-03) returning appliance/electronics repair rather than
 *     auto only because someone eyeballed one probe. Mapbox's category list is
 *     FLAT — `/list/category` explicitly does not describe parent/child
 *     relationships — so an id whose NAME implies a hierarchy it does not have
 *     is a general hazard, not a one-off. This pass records the `poi_category`
 *     strings Mapbox actually stamps on every returned feature, per id, so the
 *     same class of mismatch is detectable for every id we rely on instead of
 *     only the one that was looked at.
 *
 * READING THE NUMBERS — the limits from #366 still apply and are restated
 * because they govern every figure printed:
 *   - `limit=25` is Mapbox's ceiling AND the app's MAX_RESULTS. A cell showing
 *     25 means "at least 25", never exactly 25. Saturated cells are counted
 *     separately.
 *   - ONE fixed probe radius for every category, so densities are comparable
 *     across categories. Production uses PER-CATEGORY radii of 5-50 km
 *     (DEFAULT_RADIUS_KM_BY_CATEGORY), so for wide-radius categories — camping
 *     is 50 km — these are a FLOOR, not the production figure.
 *   - 18 points on one day is a SAMPLE. Nothing here describes Mapbox coverage
 *     outside these points.
 */
import { bboxFromCoords } from "../src/lib/discovery/discovery";

const CATEGORY_ENDPOINT = "https://api.mapbox.com/search/searchbox/v1/category";
const LIST_ENDPOINT = "https://api.mapbox.com/search/searchbox/v1/list/category";
const REVERSE_ENDPOINT = "https://api.mapbox.com/search/geocode/v6/reverse";
const PROBE_RADIUS_KM = 10;
const LIMIT = 25;
const CONCURRENCY = 4;

type Tier = "metro" | "rural" | "remote";
type Point = {
  state: string;
  tier: Tier;
  label: string;
  coords: [number, number];
  provenance: string;
};

const POINTS: Point[] = [
  // ── #366's twelve, VERBATIM (same coords, same provenance strings) so this
  //    pass's figures are directly comparable to that report's.
  { state: "OR", tier: "metro", label: "Portland", coords: [-122.7, 45.515], provenance: "#366 / data/scripts/atlas-oddities-prod-verify.ts:42" },
  { state: "WA", tier: "metro", label: "Seattle", coords: [-122.35, 47.6], provenance: "#366 / data/scripts/atlas-oddities-prod-verify.ts:43" },
  { state: "AZ", tier: "metro", label: "Phoenix", coords: [-112.1, 33.45], provenance: "#366 / data/scripts/atlas-oddities-prod-verify.ts:44" },
  { state: "UT", tier: "metro", label: "Salt Lake City", coords: [-111.9, 40.75], provenance: "#366 / data/scripts/atlas-oddities-prod-verify.ts:45" },
  { state: "NV", tier: "metro", label: "Las Vegas", coords: [-115.2, 36.15], provenance: "#366 / data/scripts/atlas-oddities-prod-verify.ts:46" },
  { state: "CA", tier: "metro", label: "San Diego", coords: [-117.28, 32.74], provenance: "#366 / data/scripts/family-destinations-verify.ts:20" },
  { state: "CA", tier: "rural", label: "Cabazon Dinosaurs", coords: [-116.788, 33.917], provenance: "#366 / web/src/lib/trip-browse/places.ts:357" },
  { state: "OR", tier: "rural", label: "Tumalo State Park", coords: [-121.327, 44.119], provenance: "#366 / web/src/lib/trip-browse/places.ts:382" },
  { state: "UT", tier: "rural", label: "Hurricane Cliffs BLM", coords: [-113.29, 37.165], provenance: "#366 / web/src/lib/trip-browse/places.ts:406" },
  { state: "WA", tier: "rural", label: "Ohanapecosh Campground", coords: [-121.567, 46.73], provenance: "#366 / web/src/lib/trip-browse/places.ts:429" },
  { state: "AZ", tier: "rural", label: "Fool Hollow Lake Rec Area", coords: [-110.0613, 34.2731], provenance: "#366 / TEST corpus pick" },
  { state: "NV", tier: "rural", label: "Cave Lake State Park", coords: [-114.6986, 39.1795], provenance: "#366 / TEST corpus pick" },

  // ── NEW: a genuinely remote tier, one point per state. These are named
  //    overland destinations chosen for distance from any settlement; each
  //    one's STATE IS VERIFIED at runtime by Mapbox reverse geocoding (printed
  //    in the output) rather than trusted from the label, because the repo's
  //    STATE_BOXES classifier returns `ambiguous` for most of NV.
  { state: "CA", tier: "remote", label: "Saline Valley, Death Valley NP", coords: [-117.77, 36.8], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
  { state: "NV", tier: "remote", label: "Black Rock Desert playa", coords: [-119.06, 40.87], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
  { state: "UT", tier: "remote", label: "Hole-in-the-Rock Rd, Grand Staircase", coords: [-111.0, 37.55], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
  { state: "AZ", tier: "remote", label: "Toroweap, Arizona Strip", coords: [-113.07, 36.22], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
  { state: "OR", tier: "remote", label: "Alvord Desert / Steens", coords: [-118.53, 42.52], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
  { state: "WA", tier: "remote", label: "Hart's Pass, Pasayten", coords: [-120.66, 48.72], provenance: "new this pass — remote tier; state reverse-geocode-verified" },
];

/** Ids to probe, grouped by the routing row each informs. The Auto/Repair and
 *  EV/fuel rows are the ones this pass was commissioned to measure; the rest
 *  are carried so the taxonomy audit covers every id the app relies on or is
 *  considering, not just the new ones. */
const PROBES: { row: string; ids: string[] }[] = [
  // WIRED TODAY (mapbox-search-box.ts MAPBOX_CATEGORY_FOR_PRIMARY).
  { row: "fuel/Gas [WIRED]", ids: ["gas_station"] },
  { row: "fuel/Auto-Repair [WIRED 2026-09-03]", ids: ["auto_repair", "car_wash"] },
  // The excluded id, re-probed to confirm the 2026-09-03 exclusion still holds.
  { row: "fuel/Auto-Repair [EXCLUDED]", ids: ["repair_shop"] },
  // EV — the routing table's #1 recommendation, unwired.
  { row: "fuel/EV [UNWIRED]", ids: ["charging_station", "ev_charging_station"] },
  { row: "fuel/truck [UNWIRED]", ids: ["truck_stop", "truck_dealer", "tire_shop"] },
  // Unwired wins already named in the routing table.
  { row: "food/grocery [UNWIRED]", ids: ["grocery", "supermarket"] },
  { row: "attraction/Culture [UNWIRED]", ids: ["museum", "art_gallery", "historic_site", "monument"] },
  { row: "oddity [UNWIRED]", ids: ["tourist_attraction"] },
  // The R4 NONE set — #364 recorded "no Mapbox id". Probed AND membership-
  // tested against the canonical list so absence is a population fact.
  { row: "R4 candidates", ids: ["shower", "dump_station", "rv_park", "toilet", "restroom", "drinking_water", "water"] },
  { row: "urban primaries", ids: ["shopping_mall", "city_park"] },
  { row: "interest", ids: ["rest_area", "laundry"] },
  // Controls carried from #366 so drift in the endpoint itself is visible.
  { row: "control (dense)", ids: ["campground", "restaurant"] },
  { row: "control (negative)", ids: ["zzz_not_a_real_category"] },
];

type Cell = {
  id: string;
  point: Point;
  ok: boolean;
  status: number;
  count: number;
  saturated: boolean;
  poiCategories: string[];
  error?: string;
};

async function getJson(url: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function probe(id: string, point: Point, token: string): Promise<Cell> {
  const bbox = bboxFromCoords(point.coords, PROBE_RADIUS_KM);
  const u = new URL(`${CATEGORY_ENDPOINT}/${id}`);
  u.searchParams.set("bbox", bbox.join(","));
  u.searchParams.set("limit", String(LIMIT));
  u.searchParams.set("access_token", token);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(u.toString());
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) {
        return { id, point, ok: false, status: res.status, count: 0, saturated: false, poiCategories: [], error: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as {
        features?: { properties?: { poi_category?: string[] } }[];
      };
      const feats = json.features ?? [];
      const cats: string[] = [];
      for (const f of feats) for (const c of f.properties?.poi_category ?? []) cats.push(c);
      return { id, point, ok: true, status: res.status, count: feats.length, saturated: feats.length >= LIMIT, poiCategories: cats };
    } catch (e) {
      if (attempt === 1) {
        return { id, point, ok: false, status: 0, count: 0, saturated: false, poiCategories: [], error: String(e) };
      }
    }
  }
  return { id, point, ok: false, status: 0, count: 0, saturated: false, poiCategories: [], error: "unreachable" };
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function main() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    console.error(
      "NEXT_PUBLIC_MAPBOX_TOKEN not set. From web/:\n" +
        `  export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)`,
    );
    process.exit(2);
  }
  console.log(`Run started: ${new Date().toISOString()}`);
  console.log(`Probe radius: ${PROBE_RADIUS_KM} km · limit: ${LIMIT}\n`);

  // ── 1. Canonical category list — the population, not a spot check ──────
  console.log("── /list/category — canonical id enumeration ──");
  const listUrl = new URL(LIST_ENDPOINT);
  listUrl.searchParams.set("access_token", token);
  const list = await getJson(listUrl.toString());
  let canonical = new Set<string>();
  if (list.status === 200) {
    const body = list.json as {
      listItems?: { canonical_id?: string; name?: string }[];
    };
    for (const it of body.listItems ?? []) {
      if (it.canonical_id) canonical.add(it.canonical_id);
    }
    console.log(`HTTP 200 · ${canonical.size} canonical ids enumerated`);
  } else {
    console.log(`HTTP ${list.status} — enumeration FAILED; id-existence claims below are UNVERIFIED`);
    console.log(JSON.stringify(list.json).slice(0, 300));
  }

  if (canonical.size > 0) {
    const probed = [...new Set(PROBES.flatMap((p) => p.ids))];
    console.log(`\nMembership of every id this pass probes:`);
    for (const id of probed.sort()) {
      console.log(`  ${canonical.has(id) ? "EXISTS " : "ABSENT "} ${id}`);
    }
    // Keyword sweep — find ids we may never have considered.
    const KEYWORDS = ["charg", "ev_", "electric", "auto", "car", "repair", "tire", "mechanic", "truck", "shower", "dump", "sanitar", "water", "toilet", "restroom", "rv", "wash", "fuel", "gas", "petrol", "mall", "shopping", "laundr"];
    console.log(`\nKeyword sweep over the canonical list (finds ids never considered):`);
    for (const kw of KEYWORDS) {
      const hits = [...canonical].filter((c) => c.includes(kw)).sort();
      console.log(`  ${kw.padEnd(10)} → ${hits.length ? hits.join(", ") : "(none)"}`);
    }
  }

  // ── 2. Reverse-geocode every point; the remote tier's state is a claim ──
  console.log(`\n── Point state verification (Mapbox reverse geocode v6) ──`);
  for (const p of POINTS) {
    const u = new URL(REVERSE_ENDPOINT);
    u.searchParams.set("longitude", String(p.coords[0]));
    u.searchParams.set("latitude", String(p.coords[1]));
    u.searchParams.set("types", "region");
    u.searchParams.set("access_token", token);
    const r = await getJson(u.toString());
    const body = r.json as { features?: { properties?: { name?: string; region?: { region_code?: string } } }[] };
    const f = body?.features?.[0]?.properties;
    const code = f?.region?.region_code ?? f?.name ?? "(none)";
    const match = String(code).toUpperCase().includes(p.state) || String(code) === p.state;
    console.log(
      `  ${p.tier.padEnd(6)} ${p.state} ${p.label.padEnd(34)} → ${String(code).padEnd(12)} ${match ? "OK" : "⚠ MISMATCH"}`,
    );
  }

  // ── 3. Coverage probe ─────────────────────────────────────────────────
  const jobs: { id: string; point: Point }[] = [];
  for (const g of PROBES) for (const id of g.ids) for (const p of POINTS) jobs.push({ id, point: p });
  console.log(`\n── Coverage probe: ${jobs.length} requests ──`);
  const cells = await mapLimit(jobs, CONCURRENCY, (j) => probe(j.id, j.point, token));

  const failed = cells.filter((c) => !c.ok);
  console.log(`Requests: ${cells.length} · failures: ${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.id} @ ${f.point.label}: ${f.error}`);

  const tiers: Tier[] = ["metro", "rural", "remote"];
  const nPer = Object.fromEntries(tiers.map((t) => [t, POINTS.filter((p) => p.tier === t).length])) as Record<Tier, number>;

  console.log(
    `\n${"id".padEnd(26)} ${"metro".padStart(7)} ${"rural".padStart(7)} ${"remote".padStart(7)}  ${"feat m/r/rm".padStart(14)}  states-with-any`,
  );
  for (const g of PROBES) {
    console.log(`-- ${g.row}`);
    for (const id of g.ids) {
      const mine = cells.filter((c) => c.id === id && c.ok);
      const hit = (t: Tier) => mine.filter((c) => c.point.tier === t && c.count > 0).length;
      const feat = (t: Tier) => mine.filter((c) => c.point.tier === t).reduce((s, c) => s + c.count, 0);
      const states = [...new Set(mine.filter((c) => c.count > 0).map((c) => c.point.state))].sort();
      const sat = mine.filter((c) => c.saturated).length;
      console.log(
        `${id.padEnd(26)} ${`${hit("metro")}/${nPer.metro}`.padStart(7)} ${`${hit("rural")}/${nPer.rural}`.padStart(7)} ${`${hit("remote")}/${nPer.remote}`.padStart(7)}  ${`${feat("metro")}/${feat("rural")}/${feat("remote")}`.padStart(14)}  ${states.join(",") || "(none)"}${sat ? `  [${sat} saturated]` : ""}`,
      );
    }
  }

  // ── 4. Taxonomy-mismatch audit ────────────────────────────────────────
  console.log(`\n── poi_category profile per id (taxonomy-mismatch detector) ──`);
  console.log(
    `Shows what Mapbox ACTUALLY stamps on the features an id returns. An id whose\n` +
      `top poi_category values do not match its name is the \`repair_shop\` class of\n` +
      `defect: the id exists and returns data, but not the data its name implies.\n`,
  );
  for (const g of PROBES) {
    for (const id of g.ids) {
      const mine = cells.filter((c) => c.id === id && c.ok);
      const counts = new Map<string, number>();
      for (const c of mine) for (const pc of c.poiCategories) counts.set(pc, (counts.get(pc) ?? 0) + 1);
      if (counts.size === 0) continue;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      console.log(`${id}:`);
      console.log(`  ${top.map(([k, v]) => `${k}(${v})`).join(" · ")}`);
    }
  }

  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
