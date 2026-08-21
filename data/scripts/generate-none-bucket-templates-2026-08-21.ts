/**
 * Minimal grounded template descriptions for real-named NONE-bucket rows.
 * Per docs/measurements/2026-08-21-none-bucket-reduction-strategy.md §3b —
 * NOT the LLM enrichment pipeline (which targets STRONG/WEAK rows only).
 * Zero-fabrication-risk: every word comes from a field that already exists
 * (canonical_name, primary_category, state derived from geometry) or a real
 * corpus relationship (place_relationships.contained_in).
 *
 * Two template shapes:
 *   - Named-parent: "{name} is a {category} in {parent_name}, {state}."
 *     Only when a contained_in parent exists, has a real (non-placeholder)
 *     name, AND is not a near-duplicate of the child's own name (guard
 *     below — reuses data/entity-resolution/matcher.ts's normalizeName +
 *     Jaro-Winkler, the existing "same place?" mechanism, at the same 0.85
 *     threshold matcher.ts uses for auto-link, rather than inventing a new
 *     number).
 *   - Bare fallback: "{name} is a {category} in {state}." — for rows with
 *     no usable parent (none at all, or guard-rejected).
 *
 * Category display wording: checked first for an existing primary_category
 * -> natural-language convention anywhere in web/src. NONE exists — only
 * AMENITY_LABELS (a different, boolean-amenities map in
 * web/src/lib/trip-browse/card-stats.ts) and a coarse search-type grouping
 * in web/src/app/api/search-area/route.ts were found, neither of which maps
 * primary_category to display text. CATEGORY_LABELS below is built fresh,
 * following the one worked example the task gave
 * ("dispersed_camping" -> "dispersed camping site"), with a generic
 * snake_case->spaced-lowercase fallback for the long tail of low-count
 * categories (mostly Google-sourced values like "hamburger_restaurant").
 *
 * Writes to master_place_generated_content (migration 20260821000000).
 * Does NOT touch master_place.description.
 *
 * Modes:
 *   (no flag)        preview mode — 30-row sample, mix of named-parent and
 *                     bare-fallback cases, prints the actual generated text.
 *   --write           full-scale run against the whole real-named NONE
 *                     population, writes rows to master_place_generated_content.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/generate-none-bucket-templates-2026-08-21.ts            # 30-row sample preview
 *   cd data && npx tsx --env-file=.env scripts/generate-none-bucket-templates-2026-08-21.ts --write     # full run, writes to DB
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import natural from "natural";
import {
  computeSignals, emptyAggregatedSignals, foldSignalsInto,
  isStrong as isStrongSignals, isWeak as isWeakSignals,
} from "./lib/eligibility.ts";
import { normalizeName } from "../entity-resolution/matcher.ts";

const PAGE = 1000;
const TEMPLATE_VERSION = "template-v1-2026-08-21";
const SIMILARITY_GUARD_THRESHOLD = 0.85; // same as matcher.ts's auto-link name_similarity threshold — reused, not invented

const jaroWinkler = natural.JaroWinklerDistance;

type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
// NOTE: this is deliberately NOT the ordered first-match classifyState()
// used elsewhere in this session's read-only measurement scripts. Those
// bboxes are copied from six_state_footprint()'s own per-state rectangles
// (supabase/migrations/20260810130000_six_state_footprint.sql), whose
// header explicitly documents that "interior edges (CA/NV, NV/UT, WA/OR,
// …) are deliberately loose: both sides are in scope, so overlap there
// costs nothing" — true for six-state SCOPE membership, false for
// asserting ONE specific state as fact. No true state-boundary dataset
// exists anywhere in this repo (same header: "No TIGER or state-boundary
// dataset exists in this repo"), so there is no more-precise ground truth
// to fall back to. A first-match ordering silently picks a winner in the
// overlap band (caught in the mandated 30-row eyeball check: "Fort Miller"
// near Millerton Lake, CA, was labeled Nevada). Fix: check ALL six boxes:
// exactly one match = confident, state clause included; zero or 2+ matches
// = ambiguous, template omits the state clause rather than assert a
// possibly-wrong one.
const STATE_BOXES: Array<{ code: State; latMin: number; latMax: number; lngMin: number; lngMax: number }> = [
  { code: "AZ", latMin: 31.333, latMax: 37.0, lngMin: -114.82, lngMax: -109.045 },
  { code: "UT", latMin: 37.0, latMax: 42.0, lngMin: -114.05, lngMax: -109.04 },
  { code: "NV", latMin: 35.0, latMax: 42.0, lngMin: -120.01, lngMax: -114.04 },
  { code: "WA", latMin: 45.85, latMax: 49.0, lngMin: -124.85, lngMax: -117.04 },
  { code: "OR", latMin: 41.99, latMax: 46.30, lngMin: -124.75, lngMax: -116.45 },
  { code: "CA", latMin: 32.534, latMax: 42.01, lngMin: -124.50, lngMax: -114.13 },
];
function classifyStateUnambiguous(lng: number, lat: number): State | "ambiguous" {
  const matches = STATE_BOXES.filter(b => lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax);
  if (matches.length === 1) return matches[0].code;
  if (matches.length === 0) return "outside";
  return "ambiguous";
}
const STATE_NAMES: Record<State, string> = {
  WA: "Washington", OR: "Oregon", CA: "California", NV: "Nevada", UT: "Utah", AZ: "Arizona", outside: "the region",
};

const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}
function isJunkCodeLike(name: string): boolean {
  const n = name.trim();
  if (n.includes(" ")) return false;
  if (!/\d/.test(n)) return false;
  if (n.length > 15) return false;
  return /^[A-Za-z0-9.\-]+$/.test(n);
}
function bucketOf(s: any): "STRONG" | "WEAK" | "NONE" {
  if (isStrongSignals(s)) return "STRONG";
  if (isWeakSignals(s)) return "WEAK";
  return "NONE";
}

// Checked web/src for an existing primary_category -> display-text map —
// none found (see file docstring). Built fresh; falls back to a generic
// snake_case -> spaced-lowercase conversion for anything not listed.
const CATEGORY_LABELS: Record<string, string> = {
  trailhead: "trailhead",
  campground: "campground",
  park: "park",
  oddity: "oddity",
  dispersed_camping: "dispersed camping site",
  picnic_area: "picnic area",
  public_land: "public land area",
  recreation_area: "recreation area",
  facility: "facility",
  grocery: "grocery store",
  beach: "beach",
  ev_charging: "EV charging station",
  electric_vehicle_charging_station: "EV charging station",
  activity_pass: "activity pass location",
  park_feature: "park feature",
  hut: "hut",
  hardware: "hardware store",
  permit: "permit office",
  tree_permit: "permit office",
  rest_area: "rest area",
  peak: "peak",
  mountain_peak: "peak",
  venue_reservations: "venue",
  scenic_spot: "scenic spot",
  viewpoint: "viewpoint",
  national_park: "national park",
  outdoor_gear: "outdoor gear store",
  state_park: "state park",
  toilet: "restroom",
  natural_feature: "natural feature",
  landmark: "landmark",
  monument: "monument",
  historical_place: "historical site",
  historical_landmark: "historical site",
  dump_station: "dump station",
  intersection: "intersection",
  spring: "spring",
  gas_station: "gas station",
  hamburger_restaurant: "restaurant",
  restaurant: "restaurant",
  breakfast_restaurant: "restaurant",
  pizza_restaurant: "restaurant",
  american_restaurant: "restaurant",
  mexican_restaurant: "restaurant",
  food_court: "restaurant",
  resort_hotel: "lodging",
  hotel: "lodging",
  lodging: "lodging",
  cafe: "cafe",
  coffee_shop: "cafe",
  unknown: "place",
};
function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").toLowerCase();
}
// Simple first-letter vowel check for "a"/"an" — sufficient for this fixed
// label vocabulary (no exceptions like "university"/"one-hour" appear in
// CATEGORY_LABELS or the fallback conversion). Caught by the mandated
// 30-row eyeball check before this fix: "is a oddity", "is a EV charging
// station" both read wrong with a hardcoded "a".
function article(label: string): string {
  return /^[aeiouAEIOU]/.test(label) ? "an" : "a";
}

type Row = {
  id: string;
  canonical_name: string;
  primary_category: string;
  lng: number;
  lat: number;
  state: State | "ambiguous";
  activeSrIds: string[];
};

// Collapses whitespace runs (some corpus canonical_names carry a stray
// double space, e.g. a state_parks parent seen in the 30-row eyeball check:
// "Salt Lake  Field Office") — pure formatting, not a factual change.
function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const write = process.argv.includes("--write");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write) — full-scale run" : "PREVIEW — 30-row sample, no writes"}`);

  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, canonical_name, primary_category, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const inScopeIds = new Set(mps.map(m => m.id));

  const allSR: any[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("id, master_place_id, normalized_payload, raw_payload").eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    for (const s of r.data as any[]) if (s.master_place_id && inScopeIds.has(s.master_place_id)) allSR.push(s);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }

  const sigs = new Map<string, any>();
  const srByMp = new Map<string, string[]>();
  for (const sr of allSR) {
    let s = sigs.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigs.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
    let arr = srByMp.get(sr.master_place_id);
    if (!arr) { arr = []; srByMp.set(sr.master_place_id, arr); }
    arr.push(sr.id);
  }

  const targetRows: Row[] = [];
  for (const m of mps) {
    const sig = sigs.get(m.id);
    if (!sig || bucketOf(sig) !== "NONE") continue;
    const name = m.canonical_name ?? "";
    if (isPlaceholderName(name) || isJunkCodeLike(name)) continue;
    targetRows.push({
      id: m.id, canonical_name: m.canonical_name, primary_category: m.primary_category,
      lng: m.lng, lat: m.lat, state: classifyStateUnambiguous(m.lng, m.lat),
      activeSrIds: srByMp.get(m.id) ?? [],
    });
  }
  console.log(`\nReal-named NONE-bucket target population: ${targetRows.length}`);

  // Resolve contained_in parents, chunked
  const childToParent = new Map<string, string>();
  const CHUNK = 300;
  const ids = targetRows.map(r => r.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const r = await db.from("place_relationships").select("child_master_place_id, parent_master_place_id").eq("relationship_type", "contained_in").in("child_master_place_id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (place_relationships):", r); throw new Error(""); }
    for (const row of r.data as any[]) childToParent.set(row.child_master_place_id, row.parent_master_place_id);
  }
  const parentIds = [...new Set(childToParent.values())];
  const parentNames = new Map<string, string>();
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const chunk = parentIds.slice(i, i + CHUNK);
    const r = await db.from("master_place").select("id, canonical_name").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (parent names):", r); throw new Error(""); }
    for (const row of r.data as any[]) parentNames.set(row.id, row.canonical_name);
  }

  type Generated = { row: Row; text: string; method: "named-parent" | "bare-no-parent" | "bare-guard-triggered"; parentName?: string; similarity?: number };
  const results: Generated[] = [];
  let ambiguousStateCount = 0;
  for (const row of targetRows) {
    const label = categoryLabel(row.primary_category);
    const name = clean(row.canonical_name);
    // Ambiguous/outside: omit the state clause rather than assert a
    // possibly-wrong one (see classifyStateUnambiguous's docstring).
    const knownState = row.state !== "ambiguous" && row.state !== "outside";
    if (row.state === "ambiguous") ambiguousStateCount++;
    const stateName = knownState ? STATE_NAMES[row.state as State] : undefined;
    const parentId = childToParent.get(row.id);
    const rawParentName = parentId ? parentNames.get(parentId) : undefined;
    const parentName = rawParentName ? clean(rawParentName) : undefined;

    const bareText = stateName
      ? `${name} is ${article(label)} ${label} in ${stateName}.`
      : `${name} is ${article(label)} ${label}.`;

    if (!parentName || isPlaceholderName(parentName)) {
      results.push({ row, text: bareText, method: "bare-no-parent" });
      continue;
    }
    const sim = jaroWinkler(normalizeName(name), normalizeName(parentName));
    if (sim >= SIMILARITY_GUARD_THRESHOLD) {
      results.push({ row, text: bareText, method: "bare-guard-triggered", parentName, similarity: sim });
      continue;
    }
    const namedText = stateName
      ? `${name} is ${article(label)} ${label} in ${parentName}, ${stateName}.`
      : `${name} is ${article(label)} ${label} in ${parentName}.`;
    results.push({ row, text: namedText, method: "named-parent", parentName, similarity: sim });
  }
  console.log(`\nRows with ambiguous state (overlapping bboxes, e.g. CA/NV border) — state clause omitted: ${ambiguousStateCount}`);

  const namedParentCount = results.filter(r => r.method === "named-parent").length;
  const bareNoParentCount = results.filter(r => r.method === "bare-no-parent").length;
  const bareGuardCount = results.filter(r => r.method === "bare-guard-triggered").length;
  console.log(`\nnamed-parent: ${namedParentCount}`);
  console.log(`bare (no usable parent at all): ${bareNoParentCount}`);
  console.log(`bare (guard-triggered — parent too similar to child name): ${bareGuardCount}`);
  console.log(`sum check: ${namedParentCount + bareNoParentCount + bareGuardCount} (must equal ${targetRows.length})`);

  if (bareGuardCount > 0) {
    console.log(`\n-- sample of up to 10 guard-triggered rows (parent rejected as near-duplicate) --`);
    for (const r of results.filter(x => x.method === "bare-guard-triggered").slice(0, 10)) {
      console.log(`  "${r.row.canonical_name}" vs parent "${r.parentName}" — similarity ${r.similarity!.toFixed(3)}`);
    }
  }

  if (!write) {
    // Preview: 30-row sample, mix of named-parent and bare-fallback.
    const namedSample = results.filter(r => r.method === "named-parent").slice(0, 15);
    const bareSample = results.filter(r => r.method !== "named-parent").slice(0, 15);
    console.log(`\n══ PREVIEW SAMPLE (${namedSample.length} named-parent + ${bareSample.length} bare) ══`);
    for (const r of [...namedSample, ...bareSample]) {
      console.log(`  [${r.method}] (${r.row.primary_category}, ${r.row.state}) ${r.row.id.slice(0,8)}`);
      console.log(`    -> "${r.text}"`);
    }
    console.log("\nPREVIEW ONLY — no writes made. Pass --write to run at full scale.");
    process.exit(0);
  }

  // ── Full-scale write ──
  console.log("\nWriting to master_place_generated_content...");
  const BATCH = 500;
  let written = 0, errors = 0;
  const errorSamples: any[] = [];
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH).map(r => ({
      master_place_id: r.row.id,
      field_name: "description",
      generated_text: r.text,
      generation_method: "template",
      model_version: null,
      grounded_on_source_record_ids: r.row.activeSrIds,
      prompt_version: TEMPLATE_VERSION,
    }));
    const ins = await db.from("master_place_generated_content").upsert(batch, { onConflict: "master_place_id,field_name" }).select("id");
    if (ins.error) { errors++; errorSamples.push(ins.error); continue; }
    written += ins.data?.length ?? 0;
    if ((i + BATCH) % 2500 < BATCH) console.log(`  ...${written}/${results.length}`);
  }
  console.log(`\nWritten: ${written} / ${results.length}`);
  console.log(`Batch errors: ${errors}`);
  if (errorSamples.length) console.log("sample errors:", JSON.stringify(errorSamples.slice(0, 3)));
  console.log(JSON.stringify({ namedParentCount, bareNoParentCount, bareGuardCount, written, errors }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
