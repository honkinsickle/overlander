/**
 * Read-only, TEST-only: for the 5 structurally-sparse OSM categories under
 * review (peak, spring, fire_pit, dump_station, viewpoint), sample
 * NONE-bucket places (per measure-llm-eligibility.ts's bucketing:
 * isStrong = has_wikipedia || has_website || has_meaningful_tags;
 * isWeak = !isStrong && (has_phone || has_hours); else NONE) with real
 * coordinates, for a Google Places pilot lookup.
 *
 * Scoped per-category (not a full-corpus scan — the naive approach timed
 * out at 73,973 candidate master_place rows across these 5 categories).
 * Pulls a randomized-ish over-sample per category, checks each candidate's
 * OWN linked source_record(s) directly, and keeps the first N that qualify
 * as NONE-bucket. NOT modifying anything; writes only to a local JSON file.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const MEANINGFUL_OSM_KEYS = new Set([
  "description", "note",
  "historic_name", "historic:name", "heritage",
  "operator",
  "cuisine",
  "name:en", "alt_name",
  "wikipedia", "wikidata",
]);

// Sample-size reasoning per category (stated up front, not picked
// uniformly): peak/spring have tens of thousands of rows, so 15-20 is a
// directional pilot sample, not a statistically representative one at that
// scale — sized at the upper end (20) since it's cheap and gives slightly
// more spot-check material. viewpoint (6,374) similarly gets 18. fire_pit
// (3,200) is mid-sized, 15 is proportionate. dump_station has only 94 total
// rows — 15 is already ~16% of the ENTIRE category, so it's sized DOWN
// relative to its total population share, not up; a bigger sample here
// would be disproportionate to the pilot's purpose (directional signal,
// not a census).
const CATEGORY_TARGETS: { category: string; sampleSize: number; totalPopulation: number }[] = [
  { category: "peak", sampleSize: 20, totalPopulation: 33457 },
  { category: "spring", sampleSize: 20, totalPopulation: 30848 },
  { category: "viewpoint", sampleSize: 18, totalPopulation: 6374 },
  { category: "fire_pit", sampleSize: 15, totalPopulation: 3200 },
  { category: "dump_station", sampleSize: 15, totalPopulation: 94 },
];

const OVERSAMPLE_FACTOR = 4; // structurally-sparse premise → expect most candidates to qualify as NONE; 4x covers misses without another round-trip
const CHUNK = 200;

type Candidate = { id: string; canonical_name: string; primary_category: string; lng: number; lat: number };

function hasSignal(np: any, rp: any) {
  const contact = np?.contact ?? {};
  const npHours = np?.hours ?? np?.opening_hours;
  const rawTags: Record<string, unknown> =
    (rp?.element?.tags && typeof rp.element.tags === "object" && !Array.isArray(rp.element.tags))
      ? rp.element.tags
      : (rp?.tags && typeof rp.tags === "object" && !Array.isArray(rp.tags)) ? rp.tags : {};
  const rawTagKeys = Object.keys(rawTags);
  let meaningful = 0;
  for (const k of rawTagKeys) if (MEANINGFUL_OSM_KEYS.has(k)) meaningful++;
  return {
    has_website: !!(contact.website ?? np?.website ?? (rawTags as any).website ?? (rawTags as any).url),
    has_phone: !!(contact.phone ?? np?.phone ?? (rawTags as any).phone),
    has_hours: !!(
      (typeof npHours === "string" && npHours.length > 0) ||
      (npHours && typeof npHours === "object" && Object.keys(npHours).length > 0) ||
      (rawTags as any).opening_hours
    ),
    has_wikipedia: !!(np?.wikipedia ?? (rawTags as any).wikipedia),
    has_wikidata: !!(np?.wikidata ?? (rawTags as any).wikidata),
    meaningful_tag_count: meaningful,
    raw_tag_count: rawTagKeys.length,
  };
}

async function sampleCategory(
  db: SupabaseClient,
  category: string,
  sampleSize: number,
  totalPopulation: number,
): Promise<Candidate[]> {
  const overshoot = Math.min(sampleSize * OVERSAMPLE_FACTOR, totalPopulation);
  // Quasi-random slice: random start offset within the category's own id
  // ordering, rather than always the lexicographically-first rows.
  const maxStart = Math.max(0, totalPopulation - overshoot);
  const start = Math.floor(Math.random() * (maxStart + 1));

  const mpRes = await db
    .from("master_place")
    .select("id, canonical_name, primary_category")
    .eq("primary_category", category)
    .order("id")
    .range(start, start + overshoot - 1);
  if (mpRes.error || mpRes.data == null) { console.error("QUERY FAILED (mp):", mpRes); throw new Error(""); }
  const candidates = mpRes.data as { id: string; canonical_name: string; primary_category: string }[];

  const geo = new Map<string, { lng: number; lat: number }>();
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK).map((c) => c.id);
    const r = await db.from("master_place_search_export").select("id, lng, lat").in("id", chunk);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
  }
  const withGeo = candidates.filter((c) => geo.has(c.id));

  const signalsByMp = new Map<string, ReturnType<typeof hasSignal>>();
  for (let i = 0; i < withGeo.length; i += CHUNK) {
    const chunk = withGeo.slice(i, i + CHUNK).map((c) => c.id);
    const r = await db.from("source_record").select("master_place_id, normalized_payload, raw_payload")
      .eq("is_active", true).in("master_place_id", chunk);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    const byMp = new Map<string, any[]>();
    for (const row of r.data as any[]) {
      if (!row.master_place_id) continue;
      const arr = byMp.get(row.master_place_id) ?? [];
      arr.push(row);
      byMp.set(row.master_place_id, arr);
    }
    for (const [mpId, srs] of byMp) {
      let agg = { has_website: false, has_phone: false, has_hours: false, has_wikipedia: false, has_wikidata: false, meaningful_tag_count: 0, raw_tag_count: 0 };
      for (const sr of srs) {
        const s = hasSignal(sr.normalized_payload, sr.raw_payload);
        agg.has_website ||= s.has_website;
        agg.has_phone ||= s.has_phone;
        agg.has_hours ||= s.has_hours;
        agg.has_wikipedia ||= s.has_wikipedia;
        agg.has_wikidata ||= s.has_wikidata;
        agg.meaningful_tag_count = Math.max(agg.meaningful_tag_count, s.meaningful_tag_count);
        agg.raw_tag_count = Math.max(agg.raw_tag_count, s.raw_tag_count);
      }
      signalsByMp.set(mpId, agg);
    }
  }

  const result: Candidate[] = [];
  for (const c of withGeo) {
    if (result.length >= sampleSize) break;
    const s = signalsByMp.get(c.id);
    if (!s) continue; // no active source_record — exclude, not a fair NONE-bucket case
    const isStrong = s.has_wikipedia || s.has_wikidata || s.has_website || (s.meaningful_tag_count >= 1) || (s.raw_tag_count >= 5);
    const isWeak = !isStrong && (s.has_phone || s.has_hours);
    if (!isStrong && !isWeak) {
      const g = geo.get(c.id)!;
      result.push({ id: c.id, canonical_name: c.canonical_name, primary_category: c.primary_category, lng: g.lng, lat: g.lat });
    }
  }
  console.log(`  ${category}: candidates_fetched=${candidates.length} with_geo=${withGeo.length} sampled_NONE=${result.length}/${sampleSize}`);
  return result;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const allSamples: Record<string, Candidate[]> = {};
  for (const t of CATEGORY_TARGETS) {
    allSamples[t.category] = await sampleCategory(db, t.category, t.sampleSize, t.totalPopulation);
  }

  const out = { categoryTargets: CATEGORY_TARGETS, samples: allSamples };
  writeFileSync("../.context/measurements/sparse-category-sample.json", JSON.stringify(out, null, 2));
  console.log("\nWrote sample to .context/measurements/sparse-category-sample.json");
  for (const [cat, rows] of Object.entries(allSamples)) {
    console.log(`  ${cat}: ${rows.length} places sampled`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
