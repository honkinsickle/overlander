/**
 * READ-ONLY TEST investigation: per-category OSM tag richness.
 *
 * Question (handoff task #1): for each of the 6 OSM-sourced categories that the
 * sparse-batch deactivation turned off (viewpoint, fire_pit, dump_station,
 * gas_station, water, toilet), is there enough structured tag data beyond the
 * bare category-defining tag to build a real templated description sentence?
 *
 * Deliberately does TWO things, because a 15-20 row sample cannot answer a
 * population question (CLAUDE.md: "a count from a capped source is a SAMPLE —
 * say so"):
 *   1. POPULATION pass — scans EVERY osm source_record in these categories and
 *      counts tag-key frequency + the share of rows carrying >=1 meaningful tag.
 *      These are totals, not samples.
 *   2. SAMPLE pass — dumps the full raw tag set for 20 concrete rows per
 *      category, so the population percentages have real rows behind them.
 *
 * Scans rows regardless of is_active: these categories were deactivated on TEST,
 * so an is_active filter would return zero.
 *
 * READ-ONLY. Refuses to run against anything but TEST.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

const CATEGORIES = ["viewpoint", "fire_pit", "dump_station", "gas_station", "water", "toilet"] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * The tag(s) that DEFINE each category per osm.ts TAG_TO_CATEGORY. A row
 * carrying only these is "bare" — the category tag and nothing else.
 */
const DEFINING: Record<Category, (k: string, v: string) => boolean> = {
  viewpoint: (k, v) => k === "tourism" && v === "viewpoint",
  fire_pit: (k, v) => k === "amenity" && (v === "bbq" || v === "fire_pit"),
  dump_station: (k, v) => k === "amenity" && v === "sanitary_dump_station",
  gas_station: (k, v) => k === "amenity" && v === "fuel",
  water: (k, v) => (k === "amenity" && v === "drinking_water") || (k === "man_made" && (v === "water_well" || v === "water_tap")),
  toilet: (k, v) => k === "amenity" && v === "toilets",
};

/**
 * Bookkeeping / provenance tags. Present on a row but carry nothing a human-
 * facing sentence could say. Excluded from the "meaningful tag" test.
 * `name` is excluded too: it already becomes canonical_name, so it is not
 * *additional* description material.
 */
const NOISE_EXACT = new Set([
  "name", "created_by", "note", "fixme", "FIXME", "source", "attribution",
  "check_date", "survey", "survey:date", "ref", "wikidata", "wikipedia",
  "wikimedia_commons", "image", "mapillary", "url", "website:menu",
  "import", "import_uuid", "converted_by", "odbl", "AND_a_nosr_r", "smoothness:note",
]);
const NOISE_PREFIX = ["name:", "source:", "note:", "check_date:", "ref:", "gnis:", "tiger:", "nhd:", "old_name", "alt_name", "short_name", "official_name", "fixme:", "was:", "disused:", "seamark:"];

function isNoise(k: string): boolean {
  if (NOISE_EXACT.has(k)) return true;
  return NOISE_PREFIX.some((p) => k.startsWith(p));
}

function meaningfulTags(cat: Category, tags: Record<string, string>): [string, string][] {
  const def = DEFINING[cat];
  return Object.entries(tags).filter(([k, v]) => !def(k, v) && !isNoise(k));
}

type Row = { external_id: string; name: string | null; is_active: boolean; raw_payload: { element?: { tags?: Record<string, string> } } | null };

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}). READ-ONLY TEST script.`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  /** Pages every osm source_record in one category. Closes over `db`. */
  async function scanCategory(cat: Category): Promise<Row[]> {
    const pageSize = 1000;
    let from = 0;
    const all: Row[] = [];
    while (true) {
      const r = await db
        .from("source_record")
        .select("external_id, name, is_active, raw_payload")
        .eq("source_id", "osm")
        .eq("inferred_category", cat)
        .order("id")
        .range(from, from + pageSize - 1);
      // CLAUDE.md 2026-08-10: a bad column yields null data + often no visible
      // error.message. Log the WHOLE response, never just error?.message.
      if (r.error || r.data == null) {
        console.log("QUERY FAILED:", JSON.stringify(r, null, 2));
        throw new Error(`scan failed for ${cat}`);
      }
      const rows = r.data as unknown as Row[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  for (const cat of CATEGORIES) {
    const rows = await scanCategory(cat);
    const withTags = rows.filter((r) => r.raw_payload?.element?.tags);
    const active = rows.filter((r) => r.is_active).length;

    console.log("=".repeat(78));
    console.log(`CATEGORY: ${cat}`);
    console.log(`  POPULATION: ${rows.length} osm source_records (active ${active} / inactive ${rows.length - active})`);
    if (rows.length === 0) { console.log("  (no rows)\n"); continue; }
    console.log(`  rows carrying a raw tag object: ${withTags.length}`);

    // --- POPULATION pass: tag-key frequency + meaningful-tag share -----------
    const keyFreq = new Map<string, number>();
    let bare = 0;
    let named = 0;
    const meaningfulCountHist = new Map<number, number>();
    for (const r of withTags) {
      const tags = r.raw_payload!.element!.tags!;
      if (tags.name) named += 1;
      const mt = meaningfulTags(cat, tags);
      meaningfulCountHist.set(mt.length, (meaningfulCountHist.get(mt.length) ?? 0) + 1);
      if (mt.length === 0) bare += 1;
      for (const [k] of mt) keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1);
    }
    const rich = withTags.length - bare;
    const pct = (n: number) => ((n / withTags.length) * 100).toFixed(1);
    console.log(`\n  [POPULATION, not a sample] rows with >=1 meaningful tag: ${rich}/${withTags.length} (${pct(rich)}%)`);
    console.log(`  [POPULATION] rows that are BARE (category tag only): ${bare}/${withTags.length} (${pct(bare)}%)`);
    console.log(`  [POPULATION] rows carrying an OSM name: ${named}/${withTags.length} (${pct(named)}%)`);

    const hist = [...meaningfulCountHist.entries()].sort((a, b) => a[0] - b[0]);
    console.log(`  meaningful-tag-count histogram: ${hist.map(([n, c]) => `${n}:${c}`).join("  ")}`);

    console.log(`\n  top meaningful tag KEYS across the whole category population:`);
    const sorted = [...keyFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    for (const [k, n] of sorted) {
      console.log(`    ${k.padEnd(34)} ${String(n).padStart(6)}  (${pct(n)}% of tagged rows)`);
    }

    // --- SAMPLE pass: 20 concrete full tag sets ------------------------------
    console.log(`\n  --- SAMPLE: full raw tag set for up to 20 rows (evenly strided across the population) ---`);
    const stride = Math.max(1, Math.floor(withTags.length / 20));
    const sample = withTags.filter((_, i) => i % stride === 0).slice(0, 20);
    for (const r of sample) {
      const tags = r.raw_payload!.element!.tags!;
      const mt = meaningfulTags(cat, tags);
      const label = mt.length === 0 ? "BARE" : `${mt.length} meaningful`;
      console.log(`    [${label}] ${r.external_id}  name=${JSON.stringify(r.name)}`);
      console.log(`        ${JSON.stringify(tags)}`);
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
