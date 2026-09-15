/**
 * Overpass / OSM — six-state population counts + remote-terrain coverage.
 *
 * READ-ONLY: POSTs count-only queries to the public Overpass API. No DB, no
 * writes. Uses `out count;` so no node bodies are transferred.
 *
 * WHY THIS EXISTS. #364 and #366 measured Mapbox and Foursquare and concluded
 * that showers, dump stations and water fill have "no viable live source
 * anywhere checked". Overpass was never checked — it is not in
 * `DEFAULT_BBOX_LIVE_SOURCES` or `DEFAULT_CORRIDOR_LIVE_SOURCES`, so it did not
 * appear in the audit's frame at all. But the corpus measurement run this
 * session shows OSM is the LARGEST single contributor to the corpus
 * (15,692 of 33,103 in-scope master_places) and the SOLE source of every one of
 * those three categories. So the source that was never checked is the source
 * those rows already came from.
 *
 * TWO QUESTIONS, and they are different:
 *
 *  1. POPULATION. How many nodes carrying each tag exist across the six states
 *     TODAY? Compare against the corpus depth for the same category. A large
 *     gap means the corpus is thin because the INGEST is bounded, not because
 *     OSM is empty — which is a completely different routing conclusion from
 *     "no source exists". `out count;` gives an exact figure, not a sample.
 *
 *  2. REMOTE COVERAGE. Mapbox returned 0/6 and Foursquare 0/2 at genuinely
 *     remote points for every commercial category measured this session. Does
 *     OSM thin out in the same terrain? If it does not, that is the single most
 *     load-bearing routing fact available: it decides whether ANY live source
 *     can serve the overland case off-grid.
 *
 * LIMITS. Counts are of NODES only, matching `overpass.ts`'s own `node[...]`
 * queries — ways and relations carrying the same tags are NOT counted, so every
 * figure is a FLOOR. The six-state box is a bounding box, not the real
 * `six_state_footprint()` polygon, so it over-covers at the edges: population
 * counts are an upper bound on what the footprint would admit and a lower bound
 * on node-vs-way completeness. Both directions are stated rather than resolved.
 */
/** No imports here either — see the note in the Foursquare probe. Without this
 *  the file is a global script and its top-level consts collide. */
export {};

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

/** Bounding box over CA/NV/UT/AZ/WA/OR as s,w,n,e (Overpass order). This is a
 *  BOX, not the six_state_footprint() polygon — see the limits note above. */
const SIX_STATE_BBOX = "31.3,-124.8,49.1,-109.0";

/** Tag → the corpus `primary_category` the OSM importer maps it to
 *  (data/ingestion/sources/osm.ts CATEGORY_RULES), plus the in-scope corpus
 *  depth measured on TEST this session, so each row is a direct comparison. */
const TAGS: { label: string; filter: string; category: string; corpusInScope: number }[] = [
  { label: "amenity=shower", filter: '["amenity"="shower"]', category: "shower", corpusInScope: 4 },
  { label: "amenity=sanitary_dump_station", filter: '["amenity"="sanitary_dump_station"]', category: "dump_station", corpusInScope: 6 },
  { label: "amenity=drinking_water", filter: '["amenity"="drinking_water"]', category: "water", corpusInScope: 167 },
  { label: "amenity=toilets", filter: '["amenity"="toilets"]', category: "toilet", corpusInScope: 128 },
  { label: "amenity=charging_station", filter: '["amenity"="charging_station"]', category: "ev_charging", corpusInScope: 2884 },
  { label: "amenity=fuel", filter: '["amenity"="fuel"]', category: "gas_station", corpusInScope: 1 },
  { label: "shop=car_repair", filter: '["shop"="car_repair"]', category: "car_repair (none)", corpusInScope: 0 },
  { label: "amenity=car_wash", filter: '["amenity"="car_wash"]', category: "car_wash (none)", corpusInScope: 0 },
  { label: "tourism=camp_site", filter: '["tourism"="camp_site"]', category: "campground", corpusInScope: 6107 },
  { label: "tourism=viewpoint", filter: '["tourism"="viewpoint"]', category: "viewpoint", corpusInScope: 312 },
  { label: "shop=mall", filter: '["shop"="mall"]', category: "shopping_mall (none)", corpusInScope: 0 },
  { label: "leisure=park", filter: '["leisure"="park"]', category: "park", corpusInScope: 2480 },
];

/** The same six remote anchors the Mapbox pass used, where Mapbox returned 0/6
 *  for every commercial category and Foursquare 0/2 for every category. */
const REMOTE: { state: string; label: string; coords: [number, number] }[] = [
  { state: "CA", label: "Saline Valley, Death Valley NP", coords: [-117.77, 36.8] },
  { state: "NV", label: "Black Rock Desert playa", coords: [-119.06, 40.87] },
  { state: "UT", label: "Hole-in-the-Rock Rd", coords: [-111.0, 37.55] },
  { state: "AZ", label: "Toroweap, Arizona Strip", coords: [-113.07, 36.22] },
  { state: "OR", label: "Alvord Desert / Steens", coords: [-118.53, 42.52] },
  { state: "WA", label: "Hart's Pass, Pasayten", coords: [-120.66, 48.72] },
];

/** Same 10 km probe radius as the Mapbox pass, so the remote comparison is
 *  like-for-like. Degrees-per-km at the relevant latitudes; lng scaled by
 *  cos(lat) exactly as `bboxFromCoords` does. */
function bboxAround(coords: [number, number], km: number): string {
  const [lng, lat] = coords;
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return `${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng}`;
}

async function count(ql: string): Promise<{ ok: boolean; n: number; note: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "overlander-web/0.1 (+adam@acwcreative.com)",
        },
        body: `data=${encodeURIComponent(ql)}`,
      });
      if (res.status === 429 || res.status === 504) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return { ok: false, n: 0, note: `HTTP ${res.status}` };
      const json = (await res.json()) as {
        elements?: { tags?: { nodes?: string; total?: string } }[];
      };
      const tags = json.elements?.[0]?.tags;
      const n = Number(tags?.nodes ?? tags?.total ?? 0);
      return { ok: true, n, note: "" };
    } catch (e) {
      if (attempt === 2) return { ok: false, n: 0, note: String(e).slice(0, 80) };
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return { ok: false, n: 0, note: "retries exhausted" };
}

async function main() {
  console.log(`Run started: ${new Date().toISOString()}`);
  console.log(`Endpoint: ${OVERPASS_URL}\n`);

  // ── 0. Liveness. The session-start preflight reported Overpass 504. ────
  const live = await count(`[out:json][timeout:60];node["amenity"="fuel"](45.5,-122.75,45.55,-122.65);out count;`);
  console.log(
    `Liveness probe (fuel nodes, small Portland box): ${live.ok ? `OK — ${live.n} nodes` : `FAILED — ${live.note}`}`,
  );
  if (!live.ok) {
    console.log("Overpass unreachable; every figure below would be a non-measurement. Stopping.");
    process.exit(1);
  }

  // ── 1. Six-state population vs corpus depth ───────────────────────────
  console.log(`\n── OSM node population across the six-state BOX vs TEST corpus depth ──`);
  console.log(
    `"osm nodes" counts NODES ONLY (matching overpass.ts's own node[...] queries),\n` +
      `so it is a FLOOR — ways/relations with the same tag are not counted. The box\n` +
      `over-covers the real six_state_footprint() polygon at the edges.\n`,
  );
  console.log(
    `${"tag".padEnd(32)} ${"osm nodes".padStart(10)} ${"corpus".padStart(8)}  ${"corpus/osm".padStart(10)}  category`,
  );
  for (const t of TAGS) {
    const ql = `[out:json][timeout:180];node${t.filter}(${SIX_STATE_BBOX});out count;`;
    const r = await count(ql);
    const ratio = r.ok && r.n > 0 ? `${((t.corpusInScope / r.n) * 100).toFixed(1)}%` : "—";
    console.log(
      `${t.label.padEnd(32)} ${(r.ok ? String(r.n) : `ERR ${r.note}`).padStart(10)} ${String(t.corpusInScope).padStart(8)}  ${ratio.padStart(10)}  ${t.category}`,
    );
  }

  // ── 2. Remote coverage — the terrain Mapbox and FSQ both return 0 in ───
  console.log(`\n── Remote-anchor coverage, 10 km radius (same points as the Mapbox pass) ──`);
  console.log(
    `Mapbox returned 0/6 at these points for EVERY commercial category measured;\n` +
      `Foursquare 0/2 at the two it was probed at. This asks whether OSM does too.\n`,
  );
  const REMOTE_TAGS = TAGS.filter((t) =>
    ["tourism=camp_site", "amenity=fuel", "amenity=drinking_water", "amenity=toilets", "tourism=viewpoint", "amenity=charging_station"].includes(t.label),
  );
  console.log(`${"point".padEnd(34)} ${REMOTE_TAGS.map((t) => t.label.replace(/^(amenity|tourism|shop|leisure)=/, "").slice(0, 9).padStart(10)).join(" ")}`);
  for (const p of REMOTE) {
    const box = bboxAround(p.coords, 10);
    const cells: string[] = [];
    for (const t of REMOTE_TAGS) {
      const r = await count(`[out:json][timeout:120];node${t.filter}(${box});out count;`);
      cells.push((r.ok ? String(r.n) : "ERR").padStart(10));
    }
    console.log(`${`${p.state} ${p.label}`.slice(0, 34).padEnd(34)} ${cells.join(" ")}`);
  }

  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
