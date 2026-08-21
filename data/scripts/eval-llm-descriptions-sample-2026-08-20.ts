/**
 * Copy of eval-llm-descriptions.ts, adapted for this session's controlled pass.
 * Original NOT edited. Differences from the original:
 *   - Sample is drawn from the precomputed target population
 *     (.context/measurements/llm-target-population-2026-08-20.json — STRONG or
 *     WEAK bucket post-USFS-directions-fix, no existing real description,
 *     atlas_oddities excluded per this session's recommendation), not the
 *     script's own generic "rich"/"minimal" facet split.
 *   - Stratified across state x source-bucket (osm / usfs-involved / other),
 *     genuinely random within strata (seeded, reproducible).
 *   - Prompt building includes the USFS `directions` field fix from this
 *     session (measure-usfs-directions-fix-2026-08-20.ts) when present.
 *   - Output to a distinct local file so the original script's default output
 *     is untouched.
 *
 * Real Anthropic API calls, real money. TEST-guarded (source data only —
 * no DB writes at all in this script). Writes to a local JSONL file only.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/eval-llm-descriptions-sample-2026-08-20.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = "claude-sonnet-4-5"; // confirmed active model id, 2026-08-20 — see report for pricing
const FALLBACK_MODEL = "claude-sonnet-5";
const OUTPUT_PATH = resolve(process.cwd(), "..", ".context/measurements/place_description_samples_2026-08-20.jsonl");
const CANDIDATE_PATH = resolve(process.cwd(), "..", ".context/measurements/llm-target-population-2026-08-20.json");
const SAMPLE_SIZE = 27;
const CONCURRENCY = 3;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Candidate = {
  id: string; canonical_name: string; primary_category: string;
  state: string; source_ids: string[]; bucket: "STRONG" | "WEAK";
  is_atlas_oddities: boolean;
};

function sourceBucket(source_ids: string[]): "osm" | "usfs" | "other" {
  if (source_ids.includes("usfs")) return "usfs";
  if (source_ids.length === 1 && source_ids[0] === "osm") return "osm";
  return "other";
}

function selectStratifiedSample(candidates: Candidate[], n: number, rng: () => number): Candidate[] {
  const pool = candidates.filter(c => !c.is_atlas_oddities);
  const buckets = new Map<string, Candidate[]>();
  for (const c of pool) {
    const key = `${c.state}|${sourceBucket(c.source_ids)}`;
    let arr = buckets.get(key); if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(c);
  }
  for (const arr of buckets.values()) arr.sort(() => rng() - 0.5);
  const bucketKeys = [...buckets.keys()].sort(() => rng() - 0.5);
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  let round = 0;
  while (picked.length < n) {
    let progress = false;
    for (const k of bucketKeys) {
      if (picked.length >= n) break;
      const arr = buckets.get(k)!;
      if (round < arr.length) {
        const cand = arr[round];
        if (!seen.has(cand.id)) { picked.push(cand); seen.add(cand.id); progress = true; }
      }
    }
    round++;
    if (!progress) break;
  }
  return picked;
}

function loadAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const webEnv = resolve(process.cwd(), "..", "web/.env.local");
  const line = readFileSync(webEnv, "utf8").split("\n").find(l => l.startsWith("ANTHROPIC_API_KEY="));
  if (!line) throw new Error("ANTHROPIC_API_KEY not found");
  return line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
}

const SYSTEM_PROMPT = `You are a knowledgeable travel writer describing places for overland travelers (van/truck-camping road trippers). Given a place name, category, state, and coordinates — plus any structured facts provided — write a 2–3 sentence description of what the place is, what a visitor can expect there, and any notable characteristics.

Rules:
- If a fact is not provided, do NOT invent it. Do not claim specific hours, prices, phone numbers, current status, or amenities unless they appear in the provided facts.
- When you are inferring rather than reporting, hedge: "this appears to be", "likely", "based on the location".
- Prefer concrete geography (nearest known town, notable nearby landform) over generic filler.
- No first person, no exclamation marks, no marketing language ("stunning", "breathtaking"). Plain and useful.
- Do not repeat the place name at the start of every sentence.
- Output only the description text — no headings, no bullet points, no quote marks.`;

type Facts = {
  contact: any; hours: any; amenities: any; overlander_tags: string[] | null;
  osm_tags: Record<string, unknown> | null; usfs_directions: string | null;
  source_ids: string[];
};

async function fetchFacts(db: SupabaseClient, id: string): Promise<Facts> {
  const r = await db.from("source_record")
    .select("source_id, normalized_payload")
    .eq("master_place_id", id).eq("is_active", true);
  if (r.error || !r.data) throw new Error(`facts fetch failed for ${id}: ${JSON.stringify(r.error)}`);
  const facts: Facts = { contact: null, hours: null, amenities: null, overlander_tags: null, osm_tags: null, usfs_directions: null, source_ids: [] };
  for (const row of r.data as any[]) {
    facts.source_ids.push(row.source_id);
    const np = row.normalized_payload ?? {};
    if (np.contact && !facts.contact) facts.contact = np.contact;
    if ((np.hours || np.opening_hours) && !facts.hours) facts.hours = np.hours ?? np.opening_hours;
    if (np.amenities && !facts.amenities) facts.amenities = np.amenities;
    if (np.overlander_tags && !facts.overlander_tags) facts.overlander_tags = np.overlander_tags;
    if (row.source_id === "osm" && np.tags && typeof np.tags === "object") facts.osm_tags = np.tags;
    if (row.source_id === "usfs" && typeof np.directions === "string" && np.directions.trim().length >= 40) facts.usfs_directions = np.directions;
  }
  return facts;
}

function buildPrompt(c: Candidate, facts: Facts): string {
  const parts: string[] = [];
  parts.push(`Name: ${c.canonical_name}`);
  parts.push(`Category: ${c.primary_category}`);
  parts.push(`Location: in ${c.state}`);
  parts.push(`Sources that identified this place: ${facts.source_ids.join(", ")}`);
  if (facts.contact && Object.keys(facts.contact).length > 0) {
    const cts: any = facts.contact;
    const bits = [];
    if (cts.website) bits.push(`website ${cts.website}`);
    if (cts.phone) bits.push(`phone ${cts.phone}`);
    if (cts.address) bits.push(`address ${cts.address}`);
    if (bits.length) parts.push(`Contact facts: ${bits.join(" · ")}`);
  }
  if (facts.hours && Object.keys(facts.hours).length > 0) parts.push(`Hours (raw): ${JSON.stringify(facts.hours).slice(0, 300)}`);
  if (facts.amenities && Object.keys(facts.amenities).length > 0) parts.push(`Amenities: ${JSON.stringify(facts.amenities).slice(0, 400)}`);
  if (facts.overlander_tags && facts.overlander_tags.length > 0) parts.push(`Tags: ${facts.overlander_tags.join(", ")}`);
  if (facts.osm_tags) {
    const t: any = facts.osm_tags;
    const bits: string[] = [];
    for (const k of ["ele", "operator", "access", "toilets", "drinking_water", "wikipedia", "wikidata", "website", "url", "phone", "opening_hours", "note", "description"]) {
      if (t[k]) bits.push(`${k}=${t[k]}`);
    }
    if (bits.length) parts.push(`OSM tags: ${bits.join(" · ")}`);
  }
  if (facts.usfs_directions) parts.push(`USFS directions (real facility text — the correction this session made): ${facts.usfs_directions.slice(0, 500)}`);
  return parts.join("\n");
}

async function callAnthropic(client: Anthropic, prompt: string, model: string): Promise<{
  text: string; input_tokens: number; output_tokens: number; model: string; error?: string;
}> {
  try {
    const res = await client.messages.create({ model, max_tokens: 400, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] });
    const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    return { text, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, model };
  } catch (e: any) {
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

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  const anthropicKey = loadAnthropicKey();
  console.log(`ANTHROPIC_API_KEY: present (${anthropicKey.length} chars)`);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const candidates: Candidate[] = JSON.parse(readFileSync(CANDIDATE_PATH, "utf8"));
  console.log(`Loaded ${candidates.length} target-population candidates (${candidates.filter(c => c.is_atlas_oddities).length} atlas_oddities excluded from sampling)`);

  const rng = mulberry32(20260820);
  const sample = selectStratifiedSample(candidates, SAMPLE_SIZE, rng);
  console.log(`Selected ${sample.length} rows, stratified state x source-bucket`);

  console.log("\n== SELECTION ==");
  console.log("state|bucket|srcBucket|category            |sources                |name");
  for (const c of sample) {
    console.log(`${c.state.padEnd(5)}|${c.bucket.padEnd(6)}|${sourceBucket(c.source_ids).padEnd(9)}|${c.primary_category.padEnd(20)}|${c.source_ids.join(",").padEnd(23)}|${c.canonical_name.slice(0, 50)}`);
  }

  writeFileSync(OUTPUT_PATH, "");
  console.log(`\nWriting to ${OUTPUT_PATH}`);
  console.log(`\nCalling Anthropic (${MODEL}, concurrency ${CONCURRENCY})…`);
  const t0 = performance.now();

  const results = await runPool(sample, CONCURRENCY, async (c, idx) => {
    const facts = await fetchFacts(db, c.id);
    const prompt = buildPrompt(c, facts);
    const res = await callAnthropic(anthropic, prompt, MODEL);
    const rec = {
      master_place_id: c.id, bucket: c.bucket, state: c.state, primary_category: c.primary_category,
      canonical_name: c.canonical_name, source_ids: facts.source_ids, source_bucket: sourceBucket(c.source_ids),
      has_usfs_directions: !!facts.usfs_directions,
      prompt_text: prompt, generated_description: res.text,
      token_count_input: res.input_tokens, token_count_output: res.output_tokens,
      model: res.model, error: res.error,
    };
    appendFileSync(OUTPUT_PATH, JSON.stringify(rec) + "\n");
    const flag = res.error ? " ERROR" : "";
    process.stderr.write(`  ${String(idx + 1).padStart(2)}/${sample.length}  ${c.state.padEnd(3)} ${c.canonical_name.slice(0, 40).padEnd(42)}  ${res.output_tokens}t${flag}\n`);
    return rec;
  });

  const elapsed = (performance.now() - t0) / 1000;
  const errors = results.filter(r => r.error);
  const totalIn = results.reduce((s, r) => s + r.token_count_input, 0);
  const totalOut = results.reduce((s, r) => s + r.token_count_output, 0);
  const modelUsed = results.find(r => !r.error)?.model ?? MODEL;
  // Pricing confirmed 2026-08-20: claude-sonnet-4-5 is $3/M input, $15/M output
  // (still active, not deprecated); claude-sonnet-5 fallback would be $2/$10
  // intro (through 2026-08-31) / $3/$15 standard. Report actual model used.
  const rateIn = modelUsed === "claude-sonnet-5" ? 2 : 3;
  const rateOut = modelUsed === "claude-sonnet-5" ? 10 : 15;
  const costEst = (totalIn / 1_000_000) * rateIn + (totalOut / 1_000_000) * rateOut;

  console.log(`\n== RESULT ==`);
  console.log(`  total: ${results.length}  errors: ${errors.length}  elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  model actually used: ${modelUsed}`);
  console.log(`  tokens: in=${totalIn.toLocaleString()}  out=${totalOut.toLocaleString()}`);
  console.log(`  cost @ $${rateIn}/M in, $${rateOut}/M out = $${costEst.toFixed(4)}`);
  console.log(`  output: ${OUTPUT_PATH}`);

  console.log("\n== ALL DESCRIPTIONS ==");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`\n[${i + 1}] ${r.bucket} · ${r.state} · ${r.primary_category} · ${r.source_ids.join(",")} · usfs_dir=${r.has_usfs_directions}`);
    console.log(`    ${r.canonical_name}`);
    if (r.error) { console.log(`    ERROR: ${r.error}`); continue; }
    console.log(`    → ${r.generated_description}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
