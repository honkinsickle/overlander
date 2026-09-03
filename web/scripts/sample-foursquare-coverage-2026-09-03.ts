/**
 * Foursquare coverage probe — the companion to
 * `sample-mapbox-coverage-2026-09-03.ts`. READ-ONLY: GETs against the
 * Foursquare Places API. No DB, no writes.
 *
 * WHY THIS IS A TEXT PROBE AND NOT A CATEGORY PROBE — this is the caveat that
 * governs how the output may be read:
 *
 *   PR #364 recorded Foursquare's taxonomy as "unmeasured" because
 *   `/places/categories` 404s. This pass re-attempted it across 4 paths x 3
 *   API versions x 2 auth styles (24 combinations) — ALL 404, including the
 *   legacy `api.foursquare.com/v3` host, which returns the same error shape as
 *   the new host. Auth is NOT the problem: the same key drives a 200 on
 *   `/places/search` (control below). So the category vocabulary is still not
 *   enumerable, and category-id probing is impossible.
 *
 *   Free-text `query=` IS supported, so this probes that instead. But
 *   Foursquare's text search matches on NAME, not category — "dump station"
 *   matches "Union Station". Therefore a zero/irrelevant result here is
 *   EVIDENCE OF ABSENCE VIA THE ONLY REACHABLE INTERFACE, not proof that
 *   Foursquare holds no such category. State it that way.
 *
 * The `relevant` heuristic below is deliberately crude and every raw name is
 * printed, so the judgement can be re-made by a reader rather than trusted.
 */

const FSQ_BASE = "https://places-api.foursquare.com/places/search";
/** Matches web/src/lib/discovery/foursquare.ts's pinned version. */
const FSQ_API_VERSION = "2025-06-17";
const RADIUS_M = 10000;
const LIMIT = 10;

type Point = { key: string; label: string; lat: number; lng: number };

/** Same 12 points as the Mapbox pass — see that script for provenance. */
const POINTS: Point[] = [
  { key: "OR-M", label: "Portland", lat: 45.515, lng: -122.7 },
  { key: "WA-M", label: "Seattle", lat: 47.6, lng: -122.35 },
  { key: "AZ-M", label: "Phoenix", lat: 33.45, lng: -112.1 },
  { key: "UT-M", label: "Salt Lake City", lat: 40.75, lng: -111.9 },
  { key: "NV-M", label: "Las Vegas", lat: 36.15, lng: -115.2 },
  { key: "CA-M", label: "San Diego", lat: 32.74, lng: -117.28 },
  { key: "CA-R", label: "Cabazon Dinosaurs", lat: 33.917, lng: -116.788 },
  { key: "OR-R", label: "Tumalo State Park", lat: 44.119, lng: -121.327 },
  { key: "UT-R", label: "Hurricane Cliffs BLM", lat: 37.165, lng: -113.29 },
  { key: "WA-R", label: "Ohanapecosh Campground", lat: 46.73, lng: -121.567 },
  { key: "AZ-R", label: "Fool Hollow Lake Rec Area", lat: 34.2731, lng: -110.0613 },
  { key: "NV-R", label: "Cave Lake State Park", lat: 39.1795, lng: -114.6986 },
];

/** The four categories PR #364 found have NO Mapbox canonical id, plus two
 *  Mapbox-thin ones for comparison. `relevant` is a crude name filter. */
const PROBES: { row: string; queries: string[]; relevant: RegExp; antiExamples: string }[] = [
  { row: "Dump stations", queries: ["dump station", "RV dump"], relevant: /\bdump\s*(station|site)\b|\bsanitary\s*dump\b|\brv\s*dump\b/i, antiExamples: "Union Station, fire stations, dumpling restaurants, dumpster rental" },
  { row: "Showers", queries: ["shower", "public shower"], relevant: /\bshower/i, antiExamples: "hotels, spas, delicatessens" },
  { row: "Water fill", queries: ["potable water", "water fill"], relevant: /\bpotable\b|\bwater\s*(fill|station|spigot)\b/i, antiExamples: "water utilities, water-damage firms, Water Grill" },
  { row: "Dispersed camping", queries: ["dispersed camping", "primitive camping"], relevant: /\b(dispersed|primitive|boondock)/i, antiExamples: "Camping World, camping retailers" },
  { row: "Trailheads (Mapbox-thin, comparison)", queries: ["trailhead"], relevant: /\btrail\s*head\b|\btrailhead\b/i, antiExamples: "Trailhead Credit Union" },
  { row: "Viewpoints (Mapbox-thin, comparison)", queries: ["viewpoint", "scenic overlook"], relevant: /\b(viewpoint|overlook|vista)\b/i, antiExamples: "Viewpoint apartments/offices" },
];

type Hit = { name: string; relevant: boolean };

async function search(q: string, p: Point, key: string): Promise<{ ok: boolean; status: number; names: string[] }> {
  const u = new URL(FSQ_BASE);
  u.searchParams.set("ll", `${p.lat},${p.lng}`);
  u.searchParams.set("radius", String(RADIUS_M));
  u.searchParams.set("query", q);
  u.searchParams.set("limit", String(LIMIT));
  const res = await fetch(u.toString(), {
    headers: { accept: "application/json", "x-places-api-version": FSQ_API_VERSION, authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { ok: false, status: res.status, names: [] };
  const j = (await res.json()) as { results?: { name?: string }[] };
  return { ok: true, status: res.status, names: (j.results ?? []).map((r) => r.name ?? "(unnamed)") };
}

async function main() {
  const key = process.env.FSQ_API_KEY;
  if (!key) { console.error("FSQ_API_KEY not set. Export it from web/.env.local first."); process.exit(2); }

  console.log(`Foursquare coverage probe — TEXT search (category taxonomy is unreachable; see header)`);
  console.log(`radius=${RADIUS_M}m limit=${LIMIT} api-version=${FSQ_API_VERSION}`);
  console.log(`Run started: ${new Date().toISOString()}\n`);

  // Control: prove auth + endpoint work, so a zero elsewhere is about DATA.
  const ctl = await search("coffee", POINTS[0], key);
  console.log(`CONTROL query="coffee" @ ${POINTS[0].label}: HTTP ${ctl.status}, n=${ctl.names.length}`);
  if (!ctl.ok || ctl.names.length === 0) { console.error("Control failed — do not interpret the rest."); process.exit(1); }
  console.log("");

  console.log("=== PER ROW (TSV) ===");
  console.log("row\tquery\tpts_any_result\tpts_RELEVANT_result\ttotal_results\ttotal_relevant\tfailed");
  const detail: string[] = [];
  for (const probe of PROBES) {
    for (const q of probe.queries) {
      let ptsAny = 0, ptsRel = 0, tot = 0, rel = 0, failed = 0;
      for (const p of POINTS) {
        const r = await search(q, p, key);
        if (!r.ok) { failed++; continue; }
        const hits: Hit[] = r.names.map((n) => ({ name: n, relevant: probe.relevant.test(n) }));
        const nRel = hits.filter((h) => h.relevant).length;
        if (hits.length > 0) ptsAny++;
        if (nRel > 0) ptsRel++;
        tot += hits.length; rel += nRel;
        if (nRel > 0) detail.push(`  [${probe.row}] "${q}" @ ${p.key} ${p.label}: ${hits.filter((h) => h.relevant).map((h) => h.name).join(" | ")}`);
      }
      console.log(`${probe.row}\t${q}\t${ptsAny}/${POINTS.length}\t${ptsRel}/${POINTS.length}\t${tot}\t${rel}\t${failed}`);
    }
  }

  console.log(`\n=== EVERY NAME THE HEURISTIC ACCEPTED (judge it yourself) ===`);
  console.log(detail.length ? detail.join("\n") : "  (none)");
  console.log(`\nAnti-examples the heuristic is designed to reject:`);
  for (const p of PROBES) console.log(`  ${p.row}: ${p.antiExamples}`);
  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
