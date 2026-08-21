/**
 * Read-only, one-off. Quantifies the blast radius of the state-assignment
 * bug flagged this session (Astoria Column labeled WA, actually OR; Fort
 * Miller labeled NV, actually CA). No persisted state field exists anywhere
 * in the schema (confirmed by grepping every migration) — state is
 * inferred ad-hoc, per-script, from a bounding-box heuristic whose boxes
 * are copied from six_state_footprint()'s per-state rectangles
 * (supabase/migrations/20260810130000_six_state_footprint.sql), whose own
 * header documents that interior state-to-state edges are "deliberately
 * loose... both sides are in scope, so overlap there costs nothing" — true
 * for six-state SCOPE membership, false for asserting one specific state.
 *
 * This script builds a REAL reference instead of another proxy: a public
 * US state-boundary GeoJSON (github.com/PublicaMundi/MappingAPI, a common
 * lightweight/simplified public dataset — NOT full-precision TIGER/Line;
 * flagged as a scoping-level reference, not a production-grade one) fetched
 * to .context/us-states-reference.geojson (gitignored, not committed), read
 * via @turf/turf (already a data/ dependency — booleanPointInPolygon for
 * ground-truth state, pointToLineDistance against polygonToLine(state) for
 * border-proximity).
 *
 * NOT modifying any DB state. NOT fixing the bug.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as turf from "@turf/turf";

const PAGE = 1000;
const BORDER_THRESHOLD_KM = 16.09; // 10 miles — task's own suggested range (5-10mi); picked
  // the upper end because POI-density in true border corridors (river valleys,
  // highway corridors) means most legitimate ambiguity concentrates close to
  // the line, and 10mi keeps the analysis from ballooning to "half the state."

const TARGET_STATES = ["Washington", "Oregon", "California", "Nevada", "Arizona", "Utah", "Idaho"];
// Real US geography — which state pairs actually share a border. Not
// invented per-row; this is the well-known adjacency graph, used only to
// decide which pairwise distance comparisons are meaningful to report.
const ADJACENT_PAIRS: [string, string][] = [
  ["Washington", "Oregon"], ["Washington", "Idaho"],
  ["Oregon", "California"], ["Oregon", "Nevada"], ["Oregon", "Idaho"],
  ["California", "Nevada"], ["California", "Arizona"],
  ["Nevada", "Arizona"], ["Nevada", "Utah"], ["Nevada", "Idaho"],
  ["Arizona", "Utah"],
  ["Utah", "Idaho"],
];

// The same first-match bbox classifier used throughout tonight's earlier
// scripts (gap-scan, characterization, OSM investigation, the ad-hoc
// "pull 4 rows" script that produced the Astoria Column error) — copied
// verbatim, not modified, so this investigation measures the ACTUAL
// mechanism in use, not a strawman.
type BboxState = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
function classifyStateBbox(lng: number, lat: number): BboxState {
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
}
const BBOX_TO_NAME: Record<string, string> = { WA: "Washington", OR: "Oregon", CA: "California", NV: "Nevada", UT: "Utah", AZ: "Arizona" };

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`Run: ${new Date().toISOString()}`);

  // ── Load real state boundaries ──
  const gj = JSON.parse(fs.readFileSync(".context/us-states-reference.geojson", "utf-8"));
  const statePolys = new Map<string, any>();
  // polygonToLine returns a single Feature for a Polygon input but a
  // FeatureCollection for a MultiPolygon input (e.g. Washington, which
  // includes islands) — normalize both to an array of line features so
  // pointToLineDistance always gets a single Feature, and border distance
  // is the min across all of a state's line pieces.
  const stateLines = new Map<string, any[]>();
  for (const f of gj.features) {
    if (!TARGET_STATES.includes(f.properties.name)) continue;
    statePolys.set(f.properties.name, f);
    const lineResult = turf.polygonToLine(f);
    const lineFeatures = lineResult.type === "FeatureCollection" ? lineResult.features : [lineResult];
    stateLines.set(f.properties.name, lineFeatures);
  }
  console.log(`Loaded real boundaries for: ${[...statePolys.keys()].join(", ")}`);

  // ── Fetch in-scope corpus rows ──
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, canonical_name, primary_category, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`In-scope corpus rows: ${fmt(mps.length)}`);

  // ── Ground-truth state via real point-in-polygon ──
  type Row = { id: string; name: string; cat: string; lng: number; lat: number; trueState: string | null; bboxState: BboxState };
  const rows: Row[] = [];
  for (const m of mps) {
    const pt = turf.point([m.lng, m.lat]);
    let trueState: string | null = null;
    let matchCount = 0;
    for (const [name, poly] of statePolys) {
      if (turf.booleanPointInPolygon(pt, poly)) { trueState = name; matchCount++; }
    }
    if (matchCount > 1) trueState = "MULTI-MATCH(" + trueState + ")"; // real polygons shouldn't overlap; flag if they somehow do
    rows.push({ id: m.id, name: m.canonical_name, cat: m.primary_category, lng: m.lng, lat: m.lat, trueState, bboxState: classifyStateBbox(m.lng, m.lat) });
  }
  const noTrueMatch = rows.filter(r => r.trueState === null).length;
  const multiMatch = rows.filter(r => r.trueState?.startsWith("MULTI-MATCH")).length;
  console.log(`Rows with no true-state polygon match (outside all 7, e.g. ocean/Mexico/Canada edge): ${noTrueMatch}`);
  console.log(`Rows matching >1 real state polygon (would indicate a data problem in the reference set): ${multiMatch}`);

  // ── Task 2: per-border-pair population within threshold ──
  console.log(`\n== PER-BORDER-PAIR POPULATION (within ${BORDER_THRESHOLD_KM.toFixed(2)} km / 10 mi of the REAL boundary line, using true point-in-polygon state) ==`);
  const pairCounts = new Map<string, number>();
  const pairRows = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.trueState || row.trueState.startsWith("MULTI-MATCH")) continue;
    for (const [a, b] of ADJACENT_PAIRS) {
      if (row.trueState !== a && row.trueState !== b) continue;
      const other = row.trueState === a ? b : a;
      const otherLines = stateLines.get(other);
      if (!otherLines) continue;
      const pt = turf.point([row.lng, row.lat]);
      let distKm = Infinity;
      for (const line of otherLines) {
        const d = turf.pointToLineDistance(pt, line, { units: "kilometers" });
        if (d < distKm) distKm = d;
      }
      if (distKm <= BORDER_THRESHOLD_KM) {
        const key = [a, b].sort().join(" / ");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        let arr = pairRows.get(key);
        if (!arr) { arr = []; pairRows.set(key, arr); }
        arr.push(row);
      }
    }
  }
  const sortedPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [pair, n] of sortedPairs) console.log(`  ${pair.padEnd(28)} ${fmt(n)}`);
  const totalBorderZoneRows = new Set([...pairRows.values()].flat().map(r => r.id)).size;
  console.log(`\n  Total distinct rows within 10mi of ANY relevant border pair: ${fmt(totalBorderZoneRows)} (${pct(totalBorderZoneRows, rows.length)} of in-scope corpus)`);

  // ── Task 3: measured error rate — bbox-derived state vs real point-in-polygon state, for border-zone rows ──
  console.log(`\n== MEASURED ERROR RATE: bbox classifier vs real point-in-polygon, border-zone rows only ==`);
  const allBorderZoneRows = [...new Map([...pairRows.values()].flat().map(r => [r.id, r])).values()];
  let agree = 0, disagree = 0, bboxOutside = 0;
  const disagreements: Row[] = [];
  for (const row of allBorderZoneRows) {
    const bboxName = BBOX_TO_NAME[row.bboxState];
    if (!bboxName) { bboxOutside++; continue; }
    if (bboxName === row.trueState) agree++;
    else { disagree++; disagreements.push(row); }
  }
  console.log(`  Border-zone rows checked: ${fmt(allBorderZoneRows.length)}`);
  console.log(`  bbox state === true state: ${fmt(agree)} (${pct(agree, allBorderZoneRows.length)})`);
  console.log(`  bbox state !== true state (WRONG): ${fmt(disagree)} (${pct(disagree, allBorderZoneRows.length)})`);
  console.log(`  bbox returned "outside" (no box matched at all): ${fmt(bboxOutside)}`);

  console.log(`\n-- sample of up to 15 disagreements (bbox state vs real state) --`);
  for (const r of disagreements.slice(0, 15)) {
    console.log(`  "${r.name}" (${r.cat}) @ ${r.lat},${r.lng} — bbox says ${r.bboxState}, real boundary says ${r.trueState}`);
  }

  // Corpus-wide (not just border-zone) disagreement rate, for context — how much of the TOTAL
  // corpus would change state if state were computed correctly, not just the border-adjacent slice.
  let corpusAgree = 0, corpusDisagree = 0, corpusOutsideBoth = 0;
  for (const row of rows) {
    if (!row.trueState || row.trueState.startsWith("MULTI-MATCH")) { corpusOutsideBoth++; continue; }
    const bboxName = BBOX_TO_NAME[row.bboxState];
    if (!bboxName) { corpusOutsideBoth++; continue; }
    if (bboxName === row.trueState) corpusAgree++; else corpusDisagree++;
  }
  console.log(`\n== CORPUS-WIDE (not just border-zone) bbox-vs-real disagreement ==`);
  console.log(`  agree: ${fmt(corpusAgree)} (${pct(corpusAgree, rows.length)})`);
  console.log(`  disagree: ${fmt(corpusDisagree)} (${pct(corpusDisagree, rows.length)})`);
  console.log(`  neither resolved (outside all boxes/polygons): ${fmt(corpusOutsideBoth)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
