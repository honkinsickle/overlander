/**
 * Regenerates the confirmed-stale slice of master_place_generated_content
 * template rows — the 158 rows whose generated_text names a US state that
 * the 2026-08-21 state-boundary fix (real TIGER/Line geometry,
 * docs/measurements/2026-08-21-state-boundary-fix-all-six-states.md) has
 * since corrected. Identified by
 * data/scripts/_identify-stale-templates.ts (ids written to
 * .context/measurements/stale-template-gc-ids-2026-08-21.json).
 *
 * Reuses the EXACT template logic from
 * generate-none-bucket-templates-2026-08-21.ts (category labels, a/an
 * article helper, near-duplicate-parent-name guard via matcher.ts's
 * normalizeName + Jaro-Winkler) — only the state source changes: reads
 * the now-corrected master_place.state column directly instead of
 * re-deriving via any bbox classifier.
 *
 * UPDATEs the existing row in place (same id, bumps generated_at, keeps
 * generation_method='template') — does NOT insert a new row, so no
 * duplicate/orphaned content-table rows.
 *
 * Dry-run by default. Pass --write to apply.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/regenerate-stale-state-templates-2026-08-21.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/regenerate-stale-state-templates-2026-08-21.ts --write   # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import natural from "natural";
import * as fs from "node:fs";
import { normalizeName } from "../entity-resolution/matcher.ts";

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
const SIMILARITY_GUARD_THRESHOLD = 0.85;
const jaroWinkler = natural.JaroWinklerDistance;
const REGEN_VERSION = "template-v1-2026-08-21-state-fix";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const write = process.argv.includes("--write");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  const staleIds: string[] = JSON.parse(fs.readFileSync(".context/measurements/stale-template-gc-ids-2026-08-21.json", "utf-8"));
  console.log(`Confirmed-stale generated_content ids to regenerate: ${staleIds.length}`);

  const gcRows: any[] = [];
  const CHUNK = 300;
  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const chunk = staleIds.slice(i, i + CHUNK);
    const r = await db.from("master_place_generated_content").select("id, master_place_id, generated_text, grounded_on_source_record_ids").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (gc):", r); throw new Error(""); }
    gcRows.push(...r.data);
  }
  console.log(`Fetched ${gcRows.length} rows to regenerate`);

  const mpIds = gcRows.map(r => r.master_place_id);
  const mpInfo = new Map<string, any>();
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db.from("master_place").select("id, canonical_name, primary_category, state").in("id", chunk);
    if (r.error || r.data == null) { console.log("QUERY FAILED (mp):", r); throw new Error(""); }
    for (const row of r.data as any[]) mpInfo.set(row.id, row);
  }

  const childToParent = new Map<string, string>();
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
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
  for (const gc of gcRows) {
    const mp = mpInfo.get(gc.master_place_id);
    if (!mp) { console.log(`  no master_place found for gc ${gc.id}, skipping`); continue; }
    const label = categoryLabel(mp.primary_category);
    const name = clean(mp.canonical_name);
    const stateName = mp.state ? STATE_NAMES[mp.state] : undefined;
    const parentId = childToParent.get(mp.id);
    const rawParentName = parentId ? parentNames.get(parentId) : undefined;
    const parentName = rawParentName ? clean(rawParentName) : undefined;

    const bareText = stateName ? `${name} is ${article(label)} ${label} in ${stateName}.` : `${name} is ${article(label)} ${label}.`;
    let newText: string;
    if (!parentName || isPlaceholderName(parentName)) {
      newText = bareText;
    } else {
      const sim = jaroWinkler(normalizeName(name), normalizeName(parentName));
      if (sim >= SIMILARITY_GUARD_THRESHOLD) {
        newText = bareText;
      } else {
        newText = stateName ? `${name} is ${article(label)} ${label} in ${parentName}, ${stateName}.` : `${name} is ${article(label)} ${label} in ${parentName}.`;
      }
    }
    results.push({ gcId: gc.id, mpId: gc.master_place_id, oldText: gc.generated_text, newText });
  }

  const changedCount = results.filter(r => r.oldText !== r.newText).length;
  console.log(`\nRegenerated ${results.length} rows; text actually differs from before in ${changedCount} of them`);

  console.log(`\n== SAMPLE (up to 15 before/after pairs) ==`);
  for (const r of results.slice(0, 15)) {
    console.log(`  mp=${r.mpId.slice(0,8)}`);
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
