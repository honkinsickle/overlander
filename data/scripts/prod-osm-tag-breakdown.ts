/**
 * READ-only PROD diagnostic: break down osm source_records by which OSM tag
 * matched them. The Overpass query is a union of 7 tag families; a returned
 * node can carry multiple tags but we bucket by the FIRST matching tag in the
 * order the adapter's regex families are declared (tourism, amenity, highway,
 * shop, natural, man_made, leisure).
 *
 * Bucket labels are the concrete tag PAIR (e.g. "tourism=camp_site"), not
 * the internal category (which loses the source-tag detail).
 *
 * Refuses unless SUPABASE_URL points at PROD; caller must supply that via
 * env (data/.env swapped or NEXT_PUBLIC-side merge). READ-ONLY.
 */
import { createClient } from "@supabase/supabase-js";

const KNOWN = {
  tourism: ["camp_site", "caravan_site", "picnic_site", "viewpoint", "alpine_hut", "wilderness_hut"],
  amenity: ["fuel", "drinking_water", "shower", "toilets", "waste_disposal", "charging_station", "bbq", "fire_pit"],
  highway: ["services", "rest_area", "trailhead"],
  shop: ["supermarket", "convenience", "outdoor", "hardware"],
  natural: ["spring", "peak", "beach"],
  man_made: ["water_well", "water_tap"],
  leisure: ["park", "nature_reserve"],
} as const;

// Order matters — first family whose tag matches wins the label.
const FAMILY_ORDER: (keyof typeof KNOWN)[] = ["tourism", "amenity", "highway", "shop", "natural", "man_made", "leisure"];

function classify(tags: Record<string, string> | null | undefined): string {
  if (!tags) return "(no tags)";
  for (const family of FAMILY_ORDER) {
    const val = tags[family];
    if (typeof val === "string" && (KNOWN[family] as readonly string[]).includes(val)) {
      // Special case: split camp_site + backcountry=yes | informal=yes into a
      // dispersed_camping bucket, matching the adapter's own post-fetch split.
      if (family === "tourism" && val === "camp_site" && (tags.backcountry === "yes" || tags.informal === "yes")) {
        return `tourism=camp_site (backcountry/informal)`;
      }
      return `${family}=${val}`;
    }
  }
  return "(unclassified — tags present but no known family)";
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  const allowProd = process.argv.includes("--allow-prod");
  if (ref !== "znldzjdatkogdktymtvi" && !allowProd) {
    throw new Error(`Refusing: not TEST (got ${ref}). Pass --allow-prod to explicitly authorize a PROD read.`);
  }
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] ${ref === "nqzeywzcowujzyegxbsr" ? "PROD" : "TEST"} ${ref}`);

  // Page through every osm source_record. On PROD ~5,371 rows — cheap.
  const counts = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  let scanned = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("raw_payload")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { raw_payload: { element?: { tags?: Record<string, string> } } | null }[];
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const r of rows) {
      const tags = r.raw_payload?.element?.tags ?? null;
      const key = classify(tags);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\nscanned: ${scanned} osm source_records`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\ntop matched-tag pairs by count (all ${sorted.length} buckets):`);
  let rank = 0;
  for (const [tag, n] of sorted) {
    rank += 1;
    const pct = ((n / scanned) * 100).toFixed(1);
    console.log(`  ${String(rank).padStart(2)}. ${tag.padEnd(48)} ${String(n).padStart(6)}  (${pct}%)`);
  }

  // Also: how many rows carry ANY of the specific tags the user asked about?
  console.log(`\nprobe: rows carrying specific tags of interest (may overlap with primary bucket above)`);
  const probes = [
    ["tourism=camp_site", (t: any) => t?.tourism === "camp_site"],
    ["  ↳ + backcountry=yes", (t: any) => t?.tourism === "camp_site" && t?.backcountry === "yes"],
    ["  ↳ + informal=yes", (t: any) => t?.tourism === "camp_site" && t?.informal === "yes"],
    ["tourism=caravan_site", (t: any) => t?.tourism === "caravan_site"],
    ["amenity=drinking_water", (t: any) => t?.amenity === "drinking_water"],
    ["amenity=sanitary_dump_station", (t: any) => t?.amenity === "sanitary_dump_station"],
    ["amenity=toilets", (t: any) => t?.amenity === "toilets"],
    ["amenity=waste_disposal", (t: any) => t?.amenity === "waste_disposal"],
  ] as const;

  // Re-scan with same pagination to count each probe. (Small enough to do twice
  // rather than hold every row in memory.)
  const probeCounts = probes.map(() => 0);
  from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("raw_payload")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { raw_payload: { element?: { tags?: Record<string, string> } } | null }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const tags = r.raw_payload?.element?.tags ?? null;
      probes.forEach(([, fn], i) => { if (fn(tags)) probeCounts[i] += 1; });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  probes.forEach(([label], i) => {
    console.log(`  ${label.padEnd(36)} ${String(probeCounts[i]).padStart(6)}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
