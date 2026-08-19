/** READ-only Overpass count query: how many natural=spring and natural=peak
 *  nodes does live OSM report for the six target states (CA/AZ/NV/UT/WA/OR),
 *  ISO3166-2 area-scoped (the same method confirmed correct for the
 *  six-state OSM campaign — see docs/STATE.md and osm.ts's areaScope()).
 *
 *  Template adapted from overpass-count-corrected-yield.ts's ISO-area
 *  variant (commit a75df64, a sibling branch not merged into this one) —
 *  same mirror list, OVERPASS_PIN freshness pin, retry/backoff, and
 *  timestamp_osm_base freshness assertion.
 *
 *  Uses `out count;` — nothing downloaded but the totals. No DB, no writes.
 *
 *  Run:
 *    OVERPASS_PIN=https://overpass-api.de/api/interpreter \
 *      npx tsx scripts/overpass-count-peak-spring.ts US-CA US-AZ US-NV US-UT US-WA US-OR
 */

let lastTsBase: string | null = null;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "overlander-diagnostic/0.0.1 (read-only count)";

async function overpassCount(query: string): Promise<number> {
  let lastErr: unknown;
  const mirrors = process.env.OVERPASS_PIN ? [process.env.OVERPASS_PIN] : MIRRORS;
  for (const url of mirrors) {
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 180_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(to);
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} @ ${url}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        continue;
      }
      const json = (await res.json()) as {
        elements?: Array<{ tags?: { total?: string; nodes?: string } }>;
        osm3s?: { timestamp_osm_base?: string };
      };
      const el = json.elements?.[0];
      const t = el?.tags?.total ?? el?.tags?.nodes ?? "0";
      if (json.osm3s?.timestamp_osm_base) lastTsBase = json.osm3s.timestamp_osm_base;
      console.log(`   (mirror: ${url.replace(/^https:\/\//, "")})`);
      return Number(t);
    } catch (e) {
      lastErr = e;
      console.log(`   (mirror ${url} failed, trying next)`);
    }
  }
  throw lastErr;
}

// Matches osm.ts's exact family predicate for natural (spring|peak|beach),
// split into the two tags this investigation needs.
const SUBSETS: ReadonlyArray<readonly [label: string, predicate: string]> = [
  ["natural=spring", 'node["natural"="spring"](%AREA%)'],
  ["natural=peak", 'node["natural"="peak"](%AREA%)'],
];

function areaCountQuery(isoCode: string, predicate: string): string {
  return `[out:json][timeout:180];
area["ISO3166-2"="${isoCode}"]->.sa;
(
  ${predicate.replace("%AREA%", "area.sa")};
);
out count;`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpassCountRetry(query: string, attempts = 5): Promise<number> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await overpassCount(query);
    } catch (e) {
      lastErr = e;
      const backoff = 15_000 * (i + 1);
      console.log(`   (attempt ${i + 1}/${attempts} failed, backing off ${backoff / 1000}s)`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function main() {
  const states = process.argv.slice(2);
  if (states.length === 0) {
    throw new Error("Usage: tsx overpass-count-peak-spring.ts <ISO3166-2> [<ISO3166-2> ...]  (e.g. US-CA US-AZ US-NV US-UT US-WA US-OR)");
  }

  const totals: Record<string, number> = { "natural=spring": 0, "natural=peak": 0 };
  const perState: Record<string, Record<string, number>> = {};

  for (const iso of states) {
    console.log(`\n=== ${iso} (ISO3166-2 area-scoped, nodes only) ===`);
    perState[iso] = {};
    for (const [label, predicate] of SUBSETS) {
      const count = await overpassCountRetry(areaCountQuery(iso, predicate));
      console.log(`  ${label} : ${count}`);
      perState[iso][label] = count;
      totals[label] += count;
      await sleep(12_000);
    }
  }

  console.log("\n=== TOTALS across queried states ===");
  for (const [label, total] of Object.entries(totals)) console.log(`  ${label} : ${total}`);
  console.log("\n=== per-state breakdown ===");
  console.log(JSON.stringify(perState, null, 2));

  if (lastTsBase) {
    const ageDays = (Date.now() - new Date(lastTsBase).getTime()) / 86_400_000;
    console.log(`\ntimestamp_osm_base = ${lastTsBase}  (age ${ageDays.toFixed(2)}d)`);
    console.log(`within 7 days? ${ageDays >= 0 && ageDays <= 7 ? "YES" : "NO"}`);
  } else {
    console.log(`\ntimestamp_osm_base: not captured (all queries failed)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

export {};
