/** READ-only Overpass count against 6 sub-regions along the corridor.
 *  For each region: total-node-count (full corrected OSM query),
 *  sanitary_dump_station count, camp_site+backcountry count. */

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "overlander-scope/0.0.1 (read-only count)";

async function overpassCount(query: string): Promise<number> {
  let lastErr: unknown = null;
  for (const url of MIRRORS) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 300_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctl.signal,
      });
      clearTimeout(to);
      if (!res.ok) { lastErr = new Error(`${res.status} @ ${url}`); continue; }
      const json = (await res.json()) as { elements?: Array<{ tags?: { total?: string; nodes?: string } }> };
      const el = json.elements?.[0];
      return Number(el?.tags?.total ?? el?.tags?.nodes ?? "0");
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

type Region = { label: string; w: number; s: number; e: number; n: number };

const REGIONS: Region[] = [
  { label: "A · SoCal/SW-AZ (RV heartland)",  w: -116.5, s: 32.5, e: -111.0, n: 35.0 },
  { label: "B · UT/southern ID",              w: -114.0, s: 37.0, e: -111.0, n: 43.0 },
  { label: "C · MT/central ID",               w: -117.0, s: 44.0, e: -111.0, n: 49.0 },
  { label: "D · northern BC (Cassiar country)", w: -132.0, s: 54.0, e: -120.0, n: 60.0 },
  { label: "E · Yukon (AK Highway)",          w: -141.0, s: 60.0, e: -128.0, n: 65.0 },
  { label: "F · AK interior (Fairbanks area)", w: -152.0, s: 63.0, e: -145.0, n: 66.0 },
];

const FULL_QUERY = (bbox: string) => `[out:json][timeout:300];
(
  node["tourism"~"^(camp_site|caravan_site|picnic_site|viewpoint|alpine_hut|wilderness_hut)$"](${bbox});
  node["tourism"="camp_site"]["backcountry"="yes"](${bbox});
  node["tourism"="camp_site"]["informal"="yes"](${bbox});
  node["amenity"~"^(fuel|drinking_water|shower|toilets|sanitary_dump_station|charging_station|bbq|fire_pit)$"](${bbox});
  node["highway"~"^(services|rest_area|trailhead)$"](${bbox});
  node["shop"~"^(supermarket|convenience|outdoor|hardware)$"](${bbox});
  node["natural"~"^(spring|peak|beach)$"](${bbox});
  node["man_made"~"^(water_well|water_tap)$"](${bbox});
  node["leisure"~"^(park|nature_reserve)$"](${bbox});
);
out count;`;

async function main() {
  console.log(`[method] Overpass "out count;" per region. Mirrors: overpass-api.de → private.coffee → kumi.systems fallback. UA=${UA}`);
  console.log(`         Full corrected OSM query (all 9 clauses). Non-overlapping regions.\n`);
  const rows: { region: string; area: number; total: number; dumps: number; backcountry: number }[] = [];

  for (const r of REGIONS) {
    const bbox = `${r.s},${r.w},${r.n},${r.e}`;
    const area = (r.e - r.w) * (r.n - r.s);
    console.log(`[${r.label}]  bbox=${r.w},${r.s},${r.e},${r.n}  area≈${area.toFixed(1)}°²`);
    const total = await overpassCount(FULL_QUERY(bbox));
    console.log(`  full corrected query total nodes             : ${total}`);
    const dumps = await overpassCount(`[out:json][timeout:180];node["amenity"="sanitary_dump_station"](${bbox});out count;`);
    console.log(`  amenity=sanitary_dump_station                : ${dumps}`);
    const back = await overpassCount(`[out:json][timeout:180];node["tourism"="camp_site"]["backcountry"="yes"](${bbox});out count;`);
    console.log(`  tourism=camp_site + backcountry=yes          : ${back}`);
    rows.push({ region: r.label, area, total, dumps, backcountry: back });
    console.log();
  }

  const sumArea = rows.reduce((a, b) => a + b.area, 0);
  const sumTotal = rows.reduce((a, b) => a + b.total, 0);
  const sumDumps = rows.reduce((a, b) => a + b.dumps, 0);
  const sumBack = rows.reduce((a, b) => a + b.backcountry, 0);

  console.log(`══════════════════════════════════════════════`);
  console.log(`SUMS across 6 sampled regions (${sumArea.toFixed(1)}°² of sampled coverage)`);
  console.log(`  total elements (full corrected query)     : ${sumTotal}`);
  console.log(`  sanitary_dump_station                     : ${sumDumps}`);
  console.log(`  camp_site + backcountry=yes               : ${sumBack}`);
  console.log(`\n  weighted density (elements per °²):`);
  for (const r of rows) {
    console.log(`    ${r.region.padEnd(45)} ${(r.total / r.area).toFixed(0).padStart(6)} elem/°²   ${(r.dumps / r.area).toFixed(2)} dumps/°²   ${(r.backcountry / r.area).toFixed(2)} back/°²`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
