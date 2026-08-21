/**
 * A/B prompt-iteration pass. Same 27 master_place_ids as
 * eval-llm-descriptions-sample-2026-08-20.ts (the prior pilot), same model,
 * NEW system prompt only — a controlled comparison. Copy, not an edit of
 * either the original eval-llm-descriptions.ts or the prior sample script.
 *
 * Real Anthropic API calls, real money (small, capped sample — 27 rows).
 * No DB writes anywhere in this script. Output to a distinct local file.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/eval-llm-descriptions-sample-2026-08-20b.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = "claude-sonnet-4-5"; // same model as the prior pilot, confirmed active
const FALLBACK_MODEL = "claude-sonnet-5";
const PRIOR_OUTPUT_PATH = resolve(process.cwd(), "..", ".context/measurements/place_description_samples_2026-08-20.jsonl");
const OUTPUT_PATH = resolve(process.cwd(), "..", ".context/measurements/place_description_samples_2026-08-20b.jsonl");
const CONCURRENCY = 3;

function loadAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const webEnv = resolve(process.cwd(), "..", "web/.env.local");
  const line = readFileSync(webEnv, "utf8").split("\n").find(l => l.startsWith("ANTHROPIC_API_KEY="));
  if (!line) throw new Error("ANTHROPIC_API_KEY not found");
  return line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
}

// ─── NEW system prompt — anti-fabrication redesign ─────────────────────────
// See docs/measurements/2026-08-20-llm-description-prompt-iteration.md §2 for
// the rationale behind each change vs. the original (eval-llm-descriptions.ts).
const SYSTEM_PROMPT = `You are writing short factual descriptions of places for overland travelers (van/truck-camping road trippers), using ONLY the fields provided below each place — nothing else.

Grounding — this is the most important rule:
- Use ONLY the facts given in the prompt for THIS place. Do not add anything from outside knowledge about it, even if you recognize the name as a real location. You may know its category in general (a national forest, a wildlife refuge, a historic site) but you do NOT know its acreage, elevation, exact history, sub-areas, or any other specific fact unless that exact fact is listed below.
- Never state a specific number (acreage, elevation, distance, headcount, year, percentage) unless that exact number appears in the provided fields. If none is provided, do not estimate or recall one — describe qualitatively ("high elevation", "remote") or leave it out.
- Never name a specific landmark, sub-area, wilderness area, nearby town, or administering unit that is not literally present in the provided fields, even if you believe it is correct.

Length — match it to what's actually provided:
- Rich fields (real tags, contact info, directions, existing description text): up to 2-3 sentences using them.
- Thin fields (little beyond name/category/state): ONE short, general sentence about the category and setting. A short accurate sentence beats a longer one padded with invented detail.

Style:
- Plain, no marketing language, no exclamation marks, no first person.
- When inferring rather than quoting a provided fact, hedge explicitly ("likely", "appears to be").
- Output only the description text — no headings, no quotes.`;

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

type PriorRow = {
  master_place_id: string; bucket: "STRONG" | "WEAK"; state: string;
  primary_category: string; canonical_name: string;
};

function buildPrompt(c: PriorRow, facts: Facts): string {
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
  if (facts.usfs_directions) parts.push(`USFS directions (real facility text): ${facts.usfs_directions.slice(0, 500)}`);
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

  const priorRows: PriorRow[] = readFileSync(PRIOR_OUTPUT_PATH, "utf8")
    .trim().split("\n").map(l => JSON.parse(l));
  console.log(`Loaded ${priorRows.length} rows from the prior pilot (same ids, same order, new prompt)`);

  writeFileSync(OUTPUT_PATH, "");
  console.log(`Writing to ${OUTPUT_PATH}`);
  console.log(`\nCalling Anthropic (${MODEL}, concurrency ${CONCURRENCY})…`);
  const t0 = performance.now();

  const results = await runPool(priorRows, CONCURRENCY, async (c, idx) => {
    const facts = await fetchFacts(db, c.master_place_id);
    const prompt = buildPrompt(c, facts);
    const res = await callAnthropic(anthropic, prompt, MODEL);
    const rec = {
      master_place_id: c.master_place_id, bucket: c.bucket, state: c.state, primary_category: c.primary_category,
      canonical_name: c.canonical_name, source_ids: facts.source_ids,
      has_usfs_directions: !!facts.usfs_directions,
      prompt_text: prompt, generated_description: res.text,
      token_count_input: res.input_tokens, token_count_output: res.output_tokens,
      model: res.model, error: res.error,
    };
    appendFileSync(OUTPUT_PATH, JSON.stringify(rec) + "\n");
    const flag = res.error ? " ERROR" : "";
    process.stderr.write(`  ${String(idx + 1).padStart(2)}/${priorRows.length}  ${c.state.padEnd(3)} ${c.canonical_name.slice(0, 40).padEnd(42)}  ${res.output_tokens}t${flag}\n`);
    return rec;
  });

  const elapsed = (performance.now() - t0) / 1000;
  const errors = results.filter(r => r.error);
  const totalIn = results.reduce((s, r) => s + r.token_count_input, 0);
  const totalOut = results.reduce((s, r) => s + r.token_count_output, 0);
  const modelUsed = results.find(r => !r.error)?.model ?? MODEL;
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
    console.log(`\n[${i + 1}] ${r.bucket} · ${r.state} · ${r.primary_category} · ${r.source_ids.join(",")}`);
    console.log(`    ${r.canonical_name}`);
    if (r.error) { console.log(`    ERROR: ${r.error}`); continue; }
    console.log(`    → ${r.generated_description}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
