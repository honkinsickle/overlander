/**
 * Evaluation-only: LLM-generate descriptions for a diverse 50-place sample.
 * Real Anthropic API calls (~$1). Writes to a JSONL file, NOT to any DB
 * table. NOT to master_place. TEST-guarded.
 *
 * Output: .context/measurements/place_description_samples.jsonl
 * One JSON object per line, fields: master_place_id, bucket,
 * prompt_text, generated_description, token_count_input,
 * token_count_output, model, error?, ...meta.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/eval-llm-descriptions.ts
 * ANTHROPIC_API_KEY is loaded from web/.env.local at runtime (the only
 * place it's stored — not a Supabase key, not scope-sensitive).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-5";  // as requested; fallback to claude-sonnet-5 if 404
const FALLBACK_MODEL = "claude-sonnet-5";
const OUTPUT_PATH = resolve(process.cwd(), "..", ".context/measurements/place_description_samples.jsonl");
const CONCURRENCY = 3;  // gentle on Anthropic rate limits
const SAMPLE_TARGET = 50;  // 25 minimal + 25 rich

// State classifier (same logic as measure-grounding-eligibility.ts after fix)
type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
function classifyState(lng: number, lat: number): State {
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
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

// ─── Env ──────────────────────────────────────────────────────────────────

function loadAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Fallback: read from web/.env.local
  const webEnv = resolve(process.cwd(), "..", "web/.env.local");
  if (!existsSync(webEnv)) throw new Error("ANTHROPIC_API_KEY not in env and web/.env.local missing");
  const line = readFileSync(webEnv, "utf8").split("\n").find(l => l.startsWith("ANTHROPIC_API_KEY="));
  if (!line) throw new Error("ANTHROPIC_API_KEY not in web/.env.local");
  return line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
}

// ─── Data types ───────────────────────────────────────────────────────────

type MP = {
  id: string;
  canonical_name: string;
  primary_category: string;
  lng: number;
  lat: number;
  state: State;
  description: string | null;
  amenities: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  overlander_tags: string[] | null;
  source_ids: string[];  // sources contributing to this MP
  osm_tags: Record<string, unknown> | null;  // best-effort OSM tags for rich prompt
  facets: {
    has_description: boolean;
    has_website: boolean;
    has_phone: boolean;
    has_hours: boolean;
    has_wikipedia: boolean;
    has_wikidata: boolean;
  };
};

// ─── Fetch corpus + build sample ──────────────────────────────────────────

async function fetchAllMPsWithFacets(db: SupabaseClient): Promise<MP[]> {
  const PAGE = 1000;
  const mpRows: any[] = [];
  let from = 0;
  process.stderr.write("Fetching master_place…\n");
  while (true) {
    const r = await db.from("master_place")
      .select("id, canonical_name, primary_category, description, amenities, hours, contact, overlander_tags")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mpRows.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … mp ${from}\n`);
  }
  // Fetch geometry via source_record_view (has lng/lat) — join by MP id via source_record.master_place_id
  // Alternate: use master_place_search_export view which has lng/lat
  process.stderr.write("Fetching master_place geometry via master_place_search_export…\n");
  const geoById = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export")
      .select("id, lng, lat")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geoById.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }

  process.stderr.write("Fetching source_record → normalized_payload (for facets + osm tags)…\n");
  const bySR = new Map<string, { source_ids: Set<string>; osm_tags: any; facets: MP["facets"] }>();
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, source_id, master_place_id, normalized_payload")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    for (const row of r.data as any[]) {
      if (!row.master_place_id) continue;
      const np = (row.normalized_payload ?? {}) as any;
      const contact = np.contact ?? {};
      const photo = np.photo;
      const hours = np.hours ?? np.opening_hours;
      let agg = bySR.get(row.master_place_id);
      if (!agg) {
        agg = { source_ids: new Set(), osm_tags: null, facets: {
          has_description: false, has_website: false, has_phone: false,
          has_hours: false, has_wikipedia: false, has_wikidata: false,
        } };
        bySR.set(row.master_place_id, agg);
      }
      agg.source_ids.add(row.source_id);
      if (row.source_id === "osm" && np.tags && typeof np.tags === "object") agg.osm_tags = np.tags;
      agg.facets.has_description ||= !!(np.description && String(np.description).length > 0);
      agg.facets.has_website ||= !!contact.website;
      agg.facets.has_phone ||= !!contact.phone;
      agg.facets.has_hours ||= !!(hours && (typeof hours === "string" ? hours.length > 0 : Object.keys(hours).length > 0));
      agg.facets.has_wikipedia ||= !!(np.wikipedia || np.tags?.wikipedia);
      agg.facets.has_wikidata ||= !!(np.wikidata || np.tags?.wikidata);
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }

  const out: MP[] = [];
  for (const m of mpRows) {
    const geo = geoById.get(m.id);
    if (!geo) continue;  // not in export view (probably not searchable, or land_status) — skip
    const sr = bySR.get(m.id);
    if (!sr) continue;
    out.push({
      id: m.id,
      canonical_name: m.canonical_name,
      primary_category: m.primary_category,
      lng: geo.lng, lat: geo.lat,
      state: classifyState(geo.lng, geo.lat),
      description: m.description,
      amenities: m.amenities,
      hours: m.hours,
      contact: m.contact,
      overlander_tags: m.overlander_tags,
      source_ids: [...sr.source_ids].sort(),
      osm_tags: sr.osm_tags,
      facets: sr.facets,
    });
  }
  return out;
}

// ─── Diverse sampling ─────────────────────────────────────────────────────

const TARGET_CATEGORIES = ["campground", "gas_station", "peak", "spring", "trailhead", "park", "viewpoint", "beach", "picnic_area"];
const TARGET_STATES: State[] = ["WA", "OR", "CA", "NV", "UT", "AZ"];

/** Deterministic PRNG so runs are repeatable. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function selectDiverse(mps: MP[], rich: boolean, n: number, rng: () => number): MP[] {
  // Filter to real names, in-scope
  const pool = mps.filter(m => !isPlaceholderName(m.canonical_name) && m.state !== "outside");
  const rp = pool.filter(m => {
    const f = m.facets;
    const anyRich = f.has_description || f.has_website || f.has_phone || f.has_hours || f.has_wikipedia;
    return rich ? anyRich : !anyRich;
  });
  // Diversify across (state, category, source_signature)
  // Round-robin: for each round, pick one row per unique bucket key that still has capacity
  const buckets = new Map<string, MP[]>();
  for (const m of rp) {
    const primaryCat = m.primary_category;
    const srcSig = m.source_ids.length === 1 ? m.source_ids[0] : "multi";
    const key = `${m.state}|${primaryCat}|${srcSig}`;
    let arr = buckets.get(key); if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(m);
  }
  // Shuffle each bucket
  for (const arr of buckets.values()) arr.sort(() => rng() - 0.5);
  const bucketKeys = [...buckets.keys()].sort(() => rng() - 0.5);
  const picked: MP[] = [];
  const seen = new Set<string>();
  let round = 0;
  while (picked.length < n) {
    let progressThisRound = false;
    for (const k of bucketKeys) {
      if (picked.length >= n) break;
      const arr = buckets.get(k)!;
      if (round < arr.length) {
        const cand = arr[round];
        if (!seen.has(cand.id)) { picked.push(cand); seen.add(cand.id); progressThisRound = true; }
      }
    }
    round++;
    if (!progressThisRound) break;
  }
  return picked;
}

// ─── Reverse geocode: nearest town from coord ─────────────────────────────

function approxLocation(lng: number, lat: number, state: State): string {
  // Very rough — no external API. Just "in <state>, near <deg,min>". LLM
  // can guess a town from the coord if it recognizes it; we don't claim
  // to know one. Include the coord verbatim so the model can reason.
  return `approximately (${lat.toFixed(3)}, ${lng.toFixed(3)}) in ${state}`;
}

// ─── Prompt construction ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a knowledgeable travel writer describing places for overland travelers (van/truck-camping road trippers). Given a place name, category, state, and coordinates — plus any structured facts provided — write a 2–3 sentence description of what the place is, what a visitor can expect there, and any notable characteristics.

Rules:
- If a fact is not provided, do NOT invent it. Do not claim specific hours, prices, phone numbers, current status, or amenities unless they appear in the provided facts.
- When you are inferring rather than reporting, hedge: "this appears to be", "likely", "based on the location".
- Prefer concrete geography (nearest known town, notable nearby landform) over generic filler.
- No first person, no exclamation marks, no marketing language ("stunning", "breathtaking"). Plain and useful.
- Do not repeat the place name at the start of every sentence.
- Output only the description text — no headings, no bullet points, no quote marks.`;

function buildPrompt(mp: MP, bucket: "minimal" | "rich"): string {
  const parts: string[] = [];
  parts.push(`Name: ${mp.canonical_name}`);
  parts.push(`Category: ${mp.primary_category}`);
  parts.push(`Location: ${approxLocation(mp.lng, mp.lat, mp.state)}`);
  parts.push(`Sources that identified this place: ${mp.source_ids.join(", ")}`);

  if (bucket === "rich") {
    if (mp.description) parts.push(`Existing description (from a source, for grounding): ${mp.description.slice(0, 800)}`);
    if (mp.contact && Object.keys(mp.contact).length > 0) {
      const c: any = mp.contact;
      const bits = [];
      if (c.website) bits.push(`website ${c.website}`);
      if (c.phone) bits.push(`phone ${c.phone}`);
      if (c.address) bits.push(`address ${c.address}`);
      if (bits.length) parts.push(`Contact facts: ${bits.join(" · ")}`);
    }
    if (mp.hours && Object.keys(mp.hours).length > 0) parts.push(`Hours (raw): ${JSON.stringify(mp.hours).slice(0, 300)}`);
    if (mp.amenities && Object.keys(mp.amenities).length > 0) parts.push(`Amenities: ${JSON.stringify(mp.amenities).slice(0, 400)}`);
    if (mp.overlander_tags && mp.overlander_tags.length > 0) parts.push(`Tags: ${mp.overlander_tags.join(", ")}`);
    if (mp.osm_tags) {
      const t: any = mp.osm_tags;
      const bits: string[] = [];
      for (const k of ["ele", "operator", "access", "toilets", "drinking_water", "wikipedia", "wikidata", "website", "url", "phone", "opening_hours"]) {
        if (t[k]) bits.push(`${k}=${t[k]}`);
      }
      if (bits.length) parts.push(`OSM tags: ${bits.join(" · ")}`);
    }
  }

  return parts.join("\n");
}

// ─── LLM call ─────────────────────────────────────────────────────────────

async function callAnthropic(client: Anthropic, prompt: string, model: string): Promise<{
  text: string; input_tokens: number; output_tokens: number; model: string; error?: string;
}> {
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    return {
      text,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      model,
    };
  } catch (e: any) {
    // Fallback on 404 / bad model
    if (String(e).includes("404") && model !== FALLBACK_MODEL) {
      process.stderr.write(`  model ${model} not found → retrying with ${FALLBACK_MODEL}\n`);
      return callAnthropic(client, prompt, FALLBACK_MODEL);
    }
    return { text: "", input_tokens: 0, output_tokens: 0, model, error: String(e?.message ?? e) };
  }
}

async function runPool<I, O>(items: I[], concurrency: number, fn: (item: I, idx: number) => Promise<O>): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const anthropicKey = loadAnthropicKey();
  console.log(`ANTHROPIC_API_KEY: present (${anthropicKey.length} chars, source: ${process.env.ANTHROPIC_API_KEY ? 'env' : 'web/.env.local'})`);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const mps = await fetchAllMPsWithFacets(db);
  console.log(`Assembled ${mps.length} candidate master_places (in-scope, six-state, with source membership)`);

  const rng = mulberry32(42);
  const minimal = selectDiverse(mps, /*rich*/false, 25, rng);
  const rich = selectDiverse(mps, /*rich*/true, 25, rng);
  console.log(`Selected ${minimal.length} minimal + ${rich.length} rich = ${minimal.length + rich.length}`);

  const selection: Array<{ mp: MP; bucket: "minimal" | "rich" }> = [
    ...minimal.map(mp => ({ mp, bucket: "minimal" as const })),
    ...rich.map(mp => ({ mp, bucket: "rich" as const })),
  ];

  // Print the selection table BEFORE spending
  console.log("\n── SELECTION ──");
  console.log("bucket  |state|cat                |sources                       |name");
  for (const { mp, bucket } of selection) {
    console.log(`${bucket.padEnd(8)}|${mp.state.padEnd(5)}|${mp.primary_category.padEnd(19)}|${mp.source_ids.join(",").padEnd(30)}|${mp.canonical_name.slice(0, 60)}`);
  }

  // Truncate output file
  writeFileSync(OUTPUT_PATH, "");
  console.log(`\nWriting to ${OUTPUT_PATH}`);

  console.log(`\nCalling Anthropic (${MODEL}, concurrency ${CONCURRENCY})…`);
  const t0 = performance.now();

  const results = await runPool(selection, CONCURRENCY, async ({ mp, bucket }, idx) => {
    const prompt = buildPrompt(mp, bucket);
    const res = await callAnthropic(anthropic, prompt, MODEL);
    const rec = {
      master_place_id: mp.id,
      bucket,
      state: mp.state,
      primary_category: mp.primary_category,
      canonical_name: mp.canonical_name,
      source_ids: mp.source_ids,
      prompt_text: prompt,
      generated_description: res.text,
      token_count_input: res.input_tokens,
      token_count_output: res.output_tokens,
      model: res.model,
      error: res.error,
    };
    appendFileSync(OUTPUT_PATH, JSON.stringify(rec) + "\n");
    const flag = res.error ? " ERROR" : "";
    process.stderr.write(`  ${String(idx + 1).padStart(2)}/${selection.length}  ${bucket.padEnd(8)}  ${mp.canonical_name.slice(0, 44).padEnd(46)}  ${res.output_tokens}t${flag}\n`);
    return rec;
  });

  const elapsed = (performance.now() - t0) / 1000;
  const errors = results.filter(r => r.error);
  const totalIn = results.reduce((s, r) => s + r.token_count_input, 0);
  const totalOut = results.reduce((s, r) => s + r.token_count_output, 0);

  // Sonnet 4.5 pricing (approx): $3/M input, $15/M output
  const costEst = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  console.log(`\n── RESULT ──`);
  console.log(`  total: ${results.length}  errors: ${errors.length}  elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  tokens: in=${totalIn.toLocaleString()}  out=${totalOut.toLocaleString()}  est cost ≈ $${costEst.toFixed(3)}`);
  console.log(`  output: ${OUTPUT_PATH}`);

  console.log("\n── ALL DESCRIPTIONS ──");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = r.source_ids.join(",");
    console.log(`\n[${i + 1}] ${r.bucket} · ${r.state} · ${r.primary_category} · ${src}`);
    console.log(`    ${r.canonical_name}`);
    if (r.error) { console.log(`    ERROR: ${r.error}`); continue; }
    console.log(`    → ${r.generated_description}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
