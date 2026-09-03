/**
 * Rollup for the 2026-09-02 category × source audit. READ-ONLY, no network,
 * no DB — pure arithmetic over the TSV emitted by
 * `data/scripts/measure-category-source-audit-2026-09-02.ts`.
 *
 * Rolls the per-`primary_category` corpus counts up to the two vocabularies
 * the UI actually uses:
 *   1. the 9 slide buckets (SLIDE_TO_PRIMARY_CATEGORY — imported, not retyped)
 *   2. the 13 Find Nearby tiles (transcribed from find-nearby-panel.tsx:84-236,
 *      which does not export its BUCKETS literal)
 *
 * Also reports which primary_categories are claimed by NEITHER vocabulary, and
 * which claimed values have zero corpus rows.
 *
 * Usage: npx tsx scripts/rollup-category-audit-2026-09-02.ts <tsv-file>
 */
import { readFileSync } from "node:fs";
// Extensionless: the `web` workspace does NOT set allowImportingTsExtensions
// (the `data` workspace does), so a `.ts` suffix here fails `npm run -w web
// typecheck` even though tsx runs it fine. Per-workspace gate divergence.
import { SLIDE_TO_PRIMARY_CATEGORY } from "../src/lib/trip-browse/federated";
import { LIVE_SLIDE_FOR_PRIMARY } from "../src/lib/places/resolve-places";

/** Transcribed from web/src/components/trip/find-nearby-panel.tsx:84-236
 *  (the BUCKETS literal is module-private). Tile id → primaryCategories. */
const TILES: Record<string, { bucket: string; primaries: string[]; isNew: boolean }> = {
  dispersed: { bucket: "CAMP & EXPLORE", primaries: ["dispersed_camping"], isNew: true },
  campgrounds: { bucket: "CAMP & EXPLORE", primaries: ["campground", "rv_park", "camping_cabin"], isNew: true },
  trailheads: { bucket: "CAMP & EXPLORE", primaries: ["trailhead", "hiking_area"], isNew: true },
  viewpoints: { bucket: "CAMP & EXPLORE", primaries: ["viewpoint", "peak", "mountain_peak", "scenic_spot"], isNew: true },
  gas: { bucket: "FUEL & REPAIR", primaries: ["gas_station", "truck_stop", "ev_charging"], isNew: false },
  "auto-repair": { bucket: "FUEL & REPAIR", primaries: ["car_repair", "car_wash"], isNew: true },
  coffee: { bucket: "FOOD", primaries: ["cafe"], isNew: false },
  restaurants: {
    bucket: "FOOD",
    primaries: [
      "restaurant", "fast_food_restaurant", "diner", "american_restaurant",
      "italian_restaurant", "mexican_restaurant", "chinese_restaurant",
      "indian_restaurant", "french_restaurant", "brazilian_restaurant",
      "taco_restaurant", "pizza_restaurant", "hamburger_restaurant",
      "chicken_restaurant", "breakfast_restaurant", "family_restaurant",
      "fine_dining_restaurant", "steak_house", "sandwich_shop",
      "bar_and_grill", "gastropub", "brewpub",
    ],
    isNew: false,
  },
  groceries: { bucket: "SUPPLY", primaries: ["grocery", "grocery_store"], isNew: false },
  "water-fill": { bucket: "SUPPLY", primaries: ["water"], isNew: true },
  showers: { bucket: "SERVICE", primaries: ["shower"], isNew: true },
  "dump-stations": { bucket: "SERVICE", primaries: ["dump_station"], isNew: true },
  hotels: { bucket: "STAY", primaries: ["hotel", "motel", "resort_hotel"], isNew: false },
};

type Row = { total: number; searchable: number; inScope: number; strong: number; weak: number; none: number };

const file = process.argv[2];
if (!file) {
  console.error("usage: rollup-category-audit-2026-09-02.ts <tsv-file>");
  process.exit(2);
}

const corpus = new Map<string, Row>();
let inTable = false;
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (line.startsWith("=== PER-CATEGORY")) { inTable = true; continue; }
  if (!inTable) continue;
  if (line.startsWith("primary_category\t")) continue;
  if (line.trim() === "" || line.startsWith("TOTALS")) break;
  const f = line.split("\t");
  if (f.length < 7) continue;
  corpus.set(f[0], {
    total: +f[1], searchable: +f[2], inScope: +f[3],
    strong: +f[4], weak: +f[5], none: +f[6],
  });
}
console.log(`Parsed ${corpus.size} primary_category rows from ${file}\n`);

const zero: Row = { total: 0, searchable: 0, inScope: 0, strong: 0, weak: 0, none: 0 };
const add = (a: Row, b: Row): Row => ({
  total: a.total + b.total, searchable: a.searchable + b.searchable,
  inScope: a.inScope + b.inScope, strong: a.strong + b.strong,
  weak: a.weak + b.weak, none: a.none + b.none,
});
const roll = (primaries: string[]): { r: Row; missing: string[] } => {
  let r = zero;
  const missing: string[] = [];
  for (const p of primaries) {
    const c = corpus.get(p);
    if (!c) { missing.push(p); continue; }
    r = add(r, c);
  }
  return { r, missing };
};

// ── 1. Slide buckets ──
console.log("=== SLIDE BUCKETS (SLIDE_TO_PRIMARY_CATEGORY, imported) ===");
console.log("slide\ttotal_mp\tsearchable_sourced\tin_scope\tSTRONG\tWEAK\tNONE\tzero_row_primaries");
for (const [slide, primaries] of Object.entries(SLIDE_TO_PRIMARY_CATEGORY)) {
  const { r, missing } = roll(primaries as string[]);
  console.log(
    `${slide}\t${r.total}\t${r.searchable}\t${r.inScope}\t${r.strong}\t${r.weak}\t${r.none}\t` +
    `${missing.length}/${(primaries as string[]).length}${missing.length ? " [" + missing.join(",") + "]" : ""}`,
  );
}

// ── 2. Find Nearby tiles ──
console.log("\n=== FIND NEARBY TILES (transcribed from find-nearby-panel.tsx:84-236) ===");
console.log("tile\tbucket\tNEW\ttotal_mp\tsearchable_sourced\tin_scope\tSTRONG\tWEAK\tNONE\tlive_slide_keys\tzero_row_primaries");
for (const [id, t] of Object.entries(TILES)) {
  const { r, missing } = roll(t.primaries);
  const liveKeys = [...new Set(t.primaries.map((p) => LIVE_SLIDE_FOR_PRIMARY[p]).filter(Boolean))];
  console.log(
    `${id}\t${t.bucket}\t${t.isNew ? "NEW" : "-"}\t${r.total}\t${r.searchable}\t${r.inScope}\t` +
    `${r.strong}\t${r.weak}\t${r.none}\t${liveKeys.length ? liveKeys.join("+") : "NONE"}\t` +
    `${missing.length}/${t.primaries.length}${missing.length ? " [" + missing.join(",") + "]" : ""}`,
  );
}

// ── 3. Vocabulary coverage ──
const claimedBySlide = new Set(Object.values(SLIDE_TO_PRIMARY_CATEGORY).flat() as string[]);
const claimedByTile = new Set(Object.values(TILES).flatMap((t) => t.primaries));
const inCorpus = [...corpus.keys()];

const orphanCorpus = inCorpus.filter((p) => !claimedBySlide.has(p));
console.log(`\n=== CORPUS primary_category values NOT claimed by any slide bucket (${orphanCorpus.length}) ===`);
for (const p of orphanCorpus.sort((a, b) => (corpus.get(b)!.inScope - corpus.get(a)!.inScope))) {
  const c = corpus.get(p)!;
  console.log(`  ${p}\ttotal=${c.total}\tin_scope=${c.inScope}`);
}

const tileOnly = [...claimedByTile].filter((p) => !claimedBySlide.has(p));
console.log(`\n=== Claimed by a TILE but not by any slide bucket (${tileOnly.length}) ===`);
console.log(tileOnly.length ? "  " + tileOnly.join(", ") : "  (none)");

const slideOnly = [...claimedBySlide].filter((p) => !claimedByTile.has(p));
console.log(`\n=== Claimed by a slide bucket but by no tile (${slideOnly.length}) ===`);
console.log("  " + slideOnly.join(", "));

const claimedZero = [...new Set([...claimedBySlide, ...claimedByTile])].filter((p) => !corpus.has(p));
console.log(`\n=== Claimed by slide and/or tile but ZERO corpus rows (${claimedZero.length}) ===`);
console.log("  " + claimedZero.sort().join(", "));

// ── 4. Live-source reachability per slide key ──
console.log("\n=== LIVE_SLIDE_FOR_PRIMARY reverse map (which slide keys the bbox live half can reach) ===");
const bySlide = new Map<string, string[]>();
for (const [p, s] of Object.entries(LIVE_SLIDE_FOR_PRIMARY)) {
  if (!bySlide.has(s)) bySlide.set(s, []);
  bySlide.get(s)!.push(p);
}
for (const [s, ps] of [...bySlide].sort()) console.log(`  ${s}: ${ps.length} primaries`);
const slideKeysAll = Object.keys(SLIDE_TO_PRIMARY_CATEGORY);
console.log(`  slide keys with NO live mapping: ${slideKeysAll.filter((s) => !bySlide.has(s)).join(", ") || "(none)"}`);
