/**
 * Backfills a state clause into master_place_generated_content template rows
 * that never had one — the population where the OLD bbox classifier
 * (classifyStateUnambiguous in generate-none-bucket-templates-2026-08-21.ts)
 * called the row "ambiguous" (2+ overlapping boxes) or "outside" (0 boxes),
 * so the template omitted the state clause entirely.
 *
 * Distinct from regenerate-stale-state-templates-2026-08-21.ts (the 158-row
 * fix): that pass corrected a WRONG fact already present in the text. This
 * pass ADDS a fact that was never asserted, now that master_place.state
 * (real TIGER/Line point-in-polygon, backfilled corpus-wide) can resolve
 * some of these rows. Rows that still resolve to null (genuinely outside
 * all six states) are left untouched — no fact is forced.
 *
 * Population is recomputed fresh from the same old-classifier logic against
 * the CURRENT set of template rows — not read from any stored list.
 *
 * Same template shape / near-duplicate-parent guard as the original
 * generator. UPDATEs in place (same id, bumps generated_at/prompt_version).
 *
 * Dry-run by default. Pass --write to apply.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/backfill-resolvable-state-templates-2026-08-21.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/backfill-resolvable-state-templates-2026-08-21.ts --write   # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import natural from "natural";
import { normalizeName } from "../entity-resolution/matcher.ts";

const PAGE = 1000;
const CHUNK = 300;
const REGEN_VERSION = "template-v1-2026-08-21-state-backfill";
const SIMILARITY_GUARD_THRESHOLD = 0.85;
const jaroWinkler = natural.JaroWinklerDistance;

type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ";
// Verbatim copy of the OLD classifier from generate-none-bucket-templates-2026-08-21.ts
// — needed here ONLY to re-derive what the old classifier would have said,
// so the "ambiguous/outside" population can be recomputed. Not used as a
// source of truth for the new text (master_place.state is).
const STATE_BOXES: Array<{ code: State; latMin: number; latMax: number; lngMin: number; lngMax: number }> = [
  { code: "AZ", latMin: 31.333, latMax: 37.0, lngMin: -114.82, lngMax: -109.045 },
  { code: "UT", latMin: 37.0, latMax: 42.0, lngMin: -114.05, lngMax: -109.04 },
  { code: "NV", latMin: 35.0, latMax: 42.0, lngMin: -120.01, lngMax: -114.04 },
  { code: "WA", latMin: 45.85, latMax: 49.0, lngMin: -124.85, lngMax: -117.04 },
  { code: "OR", latMin: 41.99, latMax: 46.30, lngMin: -124.75, lngMax: -116.45 },
  { code: "CA", latMin: 32.534, latMax: 42.01, lngMin: -124.50, lngMax: -114.13 },
];
function classifyStateUnambiguous(lng: number, lat: number): State | "ambiguous" | "outside" {
  const matches = STATE_BOXES.filter(b => lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax);
  if (matches.length === 1) return matches[0].code;
  if (matches.length === 0) return "outside";
  return "ambiguous";
}

const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}
const CATEGORY_LABELS: Record<string, string> = {
  trailhead: "trailhead", campground: "campground", park: "park", oddity: "oddity",
  dispersed_camping: "dispersed camping site", picnic_area: "picnic area",
  public_land: "public land area", recreation_area: "recreation area", facility: "facility",
  grocery: "grocery store", beach: "beach", ev_charging: "EV charging station",
  electric_vehicle_charging_station: "EV charging station", activity_pass: "activity pass location",
  park_feature: "park feature", hut: "hut", hardware: "hardware store", permit: "permit office",
  tree_permit: "permit office", rest_area: "rest area", peak: "peak", mountain_peak: "peak",
  venue_reservations: "venue", scenic_spot: "scenic spot", viewpoint: "viewpoint",
  national_park: "national park", outdoor_gear: "outdoor gear store", state_park: "state park",
  toilet: "restroom", natural_feature: "natural feature", landmark: "landmark", monument: "monument",
  historical_place: "historical site", historical_landmark: "historical site", dump_station: "dump station",
  intersection: "intersection", spring: "spring", gas_station: "gas station",
  hamburger_restaurant: "restaurant", restaurant: "restaurant", breakfast_restaurant: "restaurant",
  pizza_restaurant: "restaurant", american_restaurant: "restaurant", mexican_restaurant: "restaurant",
  food_court: "restaurant", resort_hotel: "lodging", hotel: "lodging", lodging: "lodging",
  cafe: "cafe", coffee_shop: "cafe", unknown: "place",
};
function categoryLabel(cat: string): string { return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").toLowerCase(); }
function article(label: string): string { return /^[aeiouAEIOU]/.test(label) ? "an" : "a"; }
function clean(s: string): string { return s.replace(/\s+/g, " ").trim(); }

const STATE_NAMES: Record<string, string> = { WA: "Washington", OR: "Oregon", CA: "California", NV: "Nevada", UT: "Utah", AZ: "Arizona" };

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const write = process.argv.includes("--write");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  // 1. Fetch ALL current template rows.
  const gcRows: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_generated_content")
      .select("id, master_place_id, generated_text, prompt_version")
      .eq("generation_method", "template")
      .order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED (gc):", r); throw new Error(""); }
    gcRows.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\nTotal template rows in master_place_generated_content: ${gcRows.length}`);

  // 2. Get lng/lat for each (from master_place_search_export — same source the generator used).
  const mpIds = gcRows.map(r => r.master_place_id);
  const geo = new Map<string, { lng: number; lat: number }>();
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db.from("master_place_search_export").select("id, lng, lat").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (search_export):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
  }
  const noGeo = mpIds.filter(id => !geo.has(id));
  if (noGeo.length > 0) {
    console.log(`\nNOTE: ${noGeo.length} template rows' master_place ids are no longer in master_place_search_export (deactivated/no-longer-in-scope since generation) — excluded from this pass, geometry unavailable via this source.`);
  }

  // 3. Recompute OLD classifier state fresh; population = ambiguous or outside.
  const omittedPop: { gcId: string; mpId: string; oldClassifierState: string }[] = [];
  for (const gc of gcRows) {
    const g = geo.get(gc.master_place_id);
    if (!g) continue;
    const old = classifyStateUnambiguous(g.lng, g.lat);
    if (old === "ambiguous" || old === "outside") {
      omittedPop.push({ gcId: gc.id, mpId: gc.master_place_id, oldClassifierState: old });
    }
  }
  console.log(`\nRe-identified population (old classifier said ambiguous/outside, state clause omitted): ${omittedPop.length}`);

  // Cross-check: text should not already contain any of the 6 state names.
  const gcById = new Map(gcRows.map(r => [r.id, r]));
  let textAlreadyHasState = 0;
  for (const p of omittedPop) {
    const text = gcById.get(p.gcId)!.generated_text as string;
    if (Object.values(STATE_NAMES).some(n => text.includes(n))) textAlreadyHasState++;
  }
  console.log(`Cross-check: of those, rows whose stored text unexpectedly already names a state: ${textAlreadyHasState}`);

  // 4. Of the population, how many now resolve via master_place.state (real TIGER/Line, persisted)?
  const mpInfo = new Map<string, any>();
  const popIds = omittedPop.map(p => p.mpId);
  for (let i = 0; i < popIds.length; i += CHUNK) {
    const chunk = popIds.slice(i, i + CHUNK);
    const r = await db.from("master_place").select("id, canonical_name, primary_category, state").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (mp):", r); throw new Error(""); }
    for (const row of r.data as any[]) mpInfo.set(row.id, row);
  }
  const resolvable = omittedPop.filter(p => mpInfo.get(p.mpId)?.state != null);
  const stillNull = omittedPop.filter(p => mpInfo.get(p.mpId)?.state == null);
  console.log(`\nNow resolvable (master_place.state non-null): ${resolvable.length}`);
  console.log(`Still null (genuinely outside all six states — left as-is): ${stillNull.length}`);

  // 5. Regenerate the resolvable subset.
  const resolvableMpIds = resolvable.map(p => p.mpId);
  const childToParent = new Map<string, string>();
  for (let i = 0; i < resolvableMpIds.length; i += CHUNK) {
    const chunk = resolvableMpIds.slice(i, i + CHUNK);
    const r = await db.from("place_relationships").select("child_master_place_id, parent_master_place_id").eq("relationship_type", "contained_in").in("child_master_place_id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (relationships):", r); throw new Error(""); }
    for (const row of r.data as any[]) childToParent.set(row.child_master_place_id, row.parent_master_place_id);
  }
  const parentIds = [...new Set(childToParent.values())];
  const parentNames = new Map<string, string>();
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const chunk = parentIds.slice(i, i + CHUNK);
    const r = await db.from("master_place").select("id, canonical_name").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (parents):", r); throw new Error(""); }
    for (const row of r.data as any[]) parentNames.set(row.id, row.canonical_name);
  }

  const results: { gcId: string; mpId: string; oldText: string; newText: string }[] = [];
  for (const p of resolvable) {
    const mp = mpInfo.get(p.mpId);
    const gc = gcById.get(p.gcId)!;
    const label = categoryLabel(mp.primary_category);
    const name = clean(mp.canonical_name);
    const stateName = STATE_NAMES[mp.state];
    const parentId = childToParent.get(mp.id);
    const rawParentName = parentId ? parentNames.get(parentId) : undefined;
    const parentName = rawParentName ? clean(rawParentName) : undefined;

    const bareText = `${name} is ${article(label)} ${label} in ${stateName}.`;
    let newText: string;
    if (!parentName || isPlaceholderName(parentName)) {
      newText = bareText;
    } else {
      const sim = jaroWinkler(normalizeName(name), normalizeName(parentName));
      newText = sim >= SIMILARITY_GUARD_THRESHOLD ? bareText : `${name} is ${article(label)} ${label} in ${parentName}, ${stateName}.`;
    }
    results.push({ gcId: p.gcId, mpId: p.mpId, oldText: gc.generated_text, newText });
  }

  const changedCount = results.filter(r => r.oldText !== r.newText).length;
  console.log(`\nRegenerated ${results.length} resolvable rows; text actually differs from before in ${changedCount} of them`);

  console.log(`\n== SAMPLE (up to 15 before/after pairs) ==`);
  for (const r of results.slice(0, 15)) {
    console.log(`  mp=${r.mpId.slice(0, 8)}`);
    console.log(`    BEFORE: "${r.oldText}"`);
    console.log(`    AFTER:  "${r.newText}"`);
  }

  if (!write) {
    console.log("\nDRY-RUN — no writes made. Pass --write to apply.");
    process.exit(0);
  }

  console.log("\nWriting updates (UPDATE in place, same id, no new rows)...");
  let written = 0, errors = 0;
  for (const r of results) {
    const upd = await db.from("master_place_generated_content")
      .update({ generated_text: r.newText, generated_at: new Date().toISOString(), prompt_version: REGEN_VERSION })
      .eq("id", r.gcId);
    if (upd.error) { errors++; console.log(`  UPDATE FAILED for ${r.gcId}:`, upd.error); continue; }
    written++;
  }
  console.log(`\nWritten: ${written} / ${results.length}. Errors: ${errors}`);
}
main().catch(e => { console.error(e); process.exit(1); });
