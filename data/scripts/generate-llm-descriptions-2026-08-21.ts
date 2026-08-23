/**
 * Full-population LLM description generation → master_place_generated_content.
 *
 * TEST ONLY (znldzjdatkogdktymtvi). Refuses any other project. NO PROD.
 *
 * The FIRST real write of LLM-generated content into the corpus. Consumes the
 * run-set produced by measure-llm-target-population-2026-08-21.ts
 * (.context/measurements/llm-target-population-2026-08-21.json — STRONG/WEAK,
 * no real description, atlas_oddities excluded, zero overlap with existing
 * generated_content) and writes generation_method='llm' rows.
 *
 * Prompt: the VALIDATED anti-fabrication prompt from
 * docs/measurements/2026-08-20-llm-description-prompt-iteration.md §2 — SYSTEM_PROMPT
 * and buildPrompt/fetchFacts are copied VERBATIM from
 * eval-llm-descriptions-sample-2026-08-20b.ts (the A/B run that measured 4%
 * any-fabrication / 0% severe on 27 rows). Not the pre-fix prompt in
 * eval-llm-descriptions.ts.
 *
 * Durability / resume: each row is inserted immediately after it generates, so a
 * crash never re-spends on completed rows. On restart, every MP that already has
 * ANY master_place_generated_content description row (template OR llm) is skipped
 * — this also re-verifies the zero-overlap invariant at write time, so a template
 * row can never be overwritten.
 *
 * Flags:
 *   --dry            build prompts, no API calls, no writes; print a sample
 *   --limit N        process only the first N of the remaining run-set (smoke test)
 *   --concurrency N  default 6
 *
 * Run: cd data && npx tsx --env-file=.env scripts/generate-llm-descriptions-2026-08-21.ts [--dry] [--limit N]
 * ANTHROPIC_API_KEY loaded from web/.env.local (same as the eval scripts).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = "claude-sonnet-4-5";
const FALLBACK_MODEL = "claude-sonnet-5"; // only on a hard 404 — treated as a divergence and reported
const PROMPT_VERSION = "2026-08-20b-antifab"; // the validated A/B prompt (prompt-iteration doc §2)
const RUNSET_PATH = resolve(process.cwd(), "..", ".context/measurements/llm-target-population-2026-08-21.json");
const LOG_PATH = resolve(process.cwd(), "..", ".context/measurements/llm-description-run-2026-08-21.jsonl");

// ─── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) : Infinity;
const concIdx = argv.indexOf("--concurrency");
const CONCURRENCY = concIdx >= 0 ? parseInt(argv[concIdx + 1], 10) : 6;

function loadAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const webEnv = resolve(process.cwd(), "..", "web/.env.local");
  const line = readFileSync(webEnv, "utf8").split("\n").find(l => l.startsWith("ANTHROPIC_API_KEY="));
  if (!line) throw new Error("ANTHROPIC_API_KEY not found in env or web/.env.local");
  return line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
}

// ─── VALIDATED system prompt — copied verbatim from eval-llm-descriptions-sample-2026-08-20b.ts ─
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

// ─── facts + prompt — copied verbatim from eval-llm-descriptions-sample-2026-08-20b.ts ─
// (extended only to RETURN the source_record ids read, for grounded_on_source_record_ids provenance)
type Facts = {
  contact: any; hours: any; amenities: any; overlander_tags: string[] | null;
  osm_tags: Record<string, unknown> | null; usfs_directions: string | null;
  source_ids: string[]; source_record_ids: string[];
};

async function fetchFacts(db: SupabaseClient, id: string): Promise<Facts> {
  const r = await db.from("source_record")
    .select("id, source_id, normalized_payload")
    .eq("master_place_id", id).eq("is_active", true);
  if (r.error || !r.data) throw new Error(`facts fetch failed for ${id}: ${JSON.stringify(r.error)}`);
  const facts: Facts = { contact: null, hours: null, amenities: null, overlander_tags: null, osm_tags: null, usfs_directions: null, source_ids: [], source_record_ids: [] };
  for (const row of r.data as any[]) {
    facts.source_ids.push(row.source_id);
    facts.source_record_ids.push(row.id);
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

type Cand = {
  id: string; canonical_name: string; primary_category: string;
  state: string; bucket: "STRONG" | "WEAK";
};

function buildPrompt(c: Cand, facts: Facts): string {
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

// ─── LLM call with retry (429 / 5xx / overloaded) + hard-404 fallback ───────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callAnthropic(client: Anthropic, prompt: string, model: string, attempt = 0): Promise<{
  text: string; input_tokens: number; output_tokens: number; model: string; error?: string;
}> {
  try {
    const res = await client.messages.create({ model, max_tokens: 400, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] });
    const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    return { text, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, model };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = e?.status ?? 0;
    if (msg.includes("404") && model !== FALLBACK_MODEL) {
      process.stderr.write(`  !! model ${model} 404 → falling back to ${FALLBACK_MODEL} (DIVERGENCE — will be reported)\n`);
      return callAnthropic(client, prompt, FALLBACK_MODEL, 0);
    }
    const retriable = status === 429 || status === 529 || (status >= 500 && status < 600) || msg.includes("overloaded") || msg.includes("rate");
    if (retriable && attempt < 5) {
      const backoff = Math.min(30000, 1000 * 2 ** attempt);
      process.stderr.write(`  .. retriable (${status || msg.slice(0, 40)}) attempt ${attempt + 1}, backoff ${backoff}ms\n`);
      await sleep(backoff);
      return callAnthropic(client, prompt, model, attempt + 1);
    }
    return { text: "", input_tokens: 0, output_tokens: 0, model, error: msg };
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
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST — this script NEVER touches PROD");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Run start: ${new Date().toISOString()}  DRY=${DRY}  LIMIT=${LIMIT}  CONCURRENCY=${CONCURRENCY}`);

  // ── load run-set ──
  if (!existsSync(RUNSET_PATH)) throw new Error(`run-set not found: ${RUNSET_PATH} — run measure-llm-target-population-2026-08-21.ts first`);
  const runSet: Cand[] = JSON.parse(readFileSync(RUNSET_PATH, "utf8"));
  console.log(`Loaded run-set: ${runSet.length.toLocaleString()} candidates`);

  // ── resume skip: any MP that already has a description gc row (template OR llm) ──
  const already = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const r = await db.from("master_place_generated_content")
      .select("master_place_id, generation_method").eq("field_name", "description").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (gc scan):", r); throw new Error(""); }
    for (const row of r.data as any[]) already.add(row.master_place_id);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Existing generated_content description rows (template+llm), any MP: ${already.size.toLocaleString()}`);

  let remaining = runSet.filter(c => !already.has(c.id));
  const skipped = runSet.length - remaining.length;
  console.log(`Remaining after skipping already-generated: ${remaining.length.toLocaleString()} (skipped ${skipped.toLocaleString()})`);
  if (Number.isFinite(LIMIT)) { remaining = remaining.slice(0, LIMIT); console.log(`--limit ${LIMIT} → processing ${remaining.length.toLocaleString()}`); }

  if (remaining.length === 0) { console.log("Nothing to do."); return; }

  // ── model / rate preflight (skip on dry) ──
  const anthropicKey = loadAnthropicKey();
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  console.log(`ANTHROPIC_API_KEY present (${anthropicKey.length} chars)`);
  if (!DRY) {
    console.log(`\n── model preflight: confirming ${MODEL} resolves (no silent fallback) ──`);
    const pf = await anthropic.messages.create({ model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "reply with the single word: ok" }] });
    console.log(`  request model: ${MODEL}`);
    console.log(`  response model id: ${pf.model}`);
    console.log(`  rate assumed for cost: $3.00 / M input, $15.00 / M output (claude-sonnet-4-5 standard)`);
    if (!pf.model.includes("sonnet-4-5")) throw new Error(`Preflight model mismatch: got ${pf.model}, refusing to run at sonnet-4-5 rates`);
  }

  // ── dry preview ──
  if (DRY) {
    console.log(`\n── DRY: first 5 prompts (no API, no writes) ──`);
    for (const c of remaining.slice(0, 5)) {
      const facts = await fetchFacts(db, c.id);
      console.log(`\n[${c.bucket} · ${c.state} · ${c.primary_category} · ${facts.source_ids.join(",")}] ${c.canonical_name}`);
      console.log(buildPrompt(c, facts).split("\n").map(l => "    " + l).join("\n"));
    }
    console.log(`\nDRY complete. ${remaining.length.toLocaleString()} rows would be processed.`);
    return;
  }

  // ── run ──
  writeFileSync(LOG_PATH, "", { flag: "a" }); // ensure exists; append-only across resumes
  console.log(`\nLogging every row to ${LOG_PATH}`);
  console.log(`Generating + inserting ${remaining.length.toLocaleString()} rows (concurrency ${CONCURRENCY})…\n`);
  const t0 = performance.now();

  let done = 0, succeeded = 0, errored = 0, inserted = 0, empty = 0, fellBack = 0;
  let totalIn = 0, totalOut = 0;
  const errorsList: Array<{ id: string; name: string; reason: string }> = [];

  await runPool(remaining, CONCURRENCY, async (c) => {
    let facts: Facts;
    try {
      facts = await fetchFacts(db, c.id);
    } catch (e: any) {
      errored++; done++;
      const reason = `facts_fetch: ${String(e?.message ?? e)}`;
      errorsList.push({ id: c.id, name: c.canonical_name, reason });
      appendFileSync(LOG_PATH, JSON.stringify({ master_place_id: c.id, error: reason }) + "\n");
      return;
    }
    const prompt = buildPrompt(c, facts);
    const res = await callAnthropic(anthropic, prompt, MODEL);
    totalIn += res.input_tokens; totalOut += res.output_tokens;
    if (res.model !== MODEL) fellBack++;

    if (res.error) {
      errored++; done++;
      errorsList.push({ id: c.id, name: c.canonical_name, reason: `api: ${res.error}` });
      appendFileSync(LOG_PATH, JSON.stringify({ master_place_id: c.id, model: res.model, error: res.error }) + "\n");
      return;
    }
    if (!res.text || res.text.trim().length === 0) {
      empty++; errored++; done++;
      errorsList.push({ id: c.id, name: c.canonical_name, reason: "empty_generation" });
      appendFileSync(LOG_PATH, JSON.stringify({ master_place_id: c.id, model: res.model, error: "empty_generation" }) + "\n");
      return;
    }

    // insert — plain insert (NOT upsert): a unique-violation means a description row
    // already exists (template or a racing insert); never overwrite it.
    const ins = await db.from("master_place_generated_content").insert({
      master_place_id: c.id,
      field_name: "description",
      generated_text: res.text,
      generation_method: "llm",
      model_version: res.model,
      grounded_on_source_record_ids: facts.source_record_ids,
      prompt_version: PROMPT_VERSION,
    });
    done++;
    if (ins.error) {
      errored++;
      const reason = `insert: ${ins.error.code ?? ""} ${ins.error.message ?? JSON.stringify(ins.error)}`;
      errorsList.push({ id: c.id, name: c.canonical_name, reason });
      appendFileSync(LOG_PATH, JSON.stringify({ master_place_id: c.id, model: res.model, token_count_input: res.input_tokens, token_count_output: res.output_tokens, generated_description: res.text, error: reason }) + "\n");
      return;
    }
    succeeded++; inserted++;
    appendFileSync(LOG_PATH, JSON.stringify({
      master_place_id: c.id, bucket: c.bucket, state: c.state, primary_category: c.primary_category,
      source_ids: facts.source_ids, grounded_on_source_record_ids: facts.source_record_ids,
      prompt_text: prompt, generated_description: res.text,
      token_count_input: res.input_tokens, token_count_output: res.output_tokens, model: res.model,
    }) + "\n");

    if (done % 100 === 0) {
      const cost = (totalIn / 1e6) * 3 + (totalOut / 1e6) * 15;
      process.stderr.write(`  ${done}/${remaining.length}  ok=${succeeded} err=${errored}  in=${totalIn.toLocaleString()} out=${totalOut.toLocaleString()}  ~$${cost.toFixed(2)}\n`);
    }
  });

  const elapsed = (performance.now() - t0) / 1000;
  const cost = (totalIn / 1e6) * 3 + (totalOut / 1e6) * 15;

  console.log(`\n== RUN COMPLETE ==`);
  console.log(`  processed:  ${done.toLocaleString()}`);
  console.log(`  succeeded:  ${succeeded.toLocaleString()} (inserted ${inserted.toLocaleString()})`);
  console.log(`  errored:    ${errored.toLocaleString()} (of which empty generations: ${empty})`);
  console.log(`  fell back to non-4-5 model: ${fellBack}`);
  console.log(`  tokens: input=${totalIn.toLocaleString()}  output=${totalOut.toLocaleString()}`);
  console.log(`  actual cost @ $3/M in, $15/M out: $${cost.toFixed(4)}`);
  console.log(`  elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  log: ${LOG_PATH}`);
  if (errorsList.length > 0) {
    console.log(`\n  errors (${errorsList.length}):`);
    for (const e of errorsList.slice(0, 50)) console.log(`    ${e.id}  ${e.name.slice(0, 40)}  — ${e.reason}`);
    if (errorsList.length > 50) console.log(`    … and ${errorsList.length - 50} more (see log)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
