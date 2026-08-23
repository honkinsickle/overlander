/**
 * READ-ONLY. Fabrication spot-check sampler for the 2026-08-21 full-population
 * LLM description run. Reads the run's JSONL log
 * (.context/measurements/llm-description-run-2026-08-21.jsonl), draws a
 * seeded-random sample of N>=50 SUCCESSFUL rows, and prints prompt vs generated
 * text side by side for a manual eye-check (same method as the 2026-08-20 A/B).
 *
 * The heuristic flags below (a number in the output absent from the prompt; a
 * capitalized multi-word phrase absent from the prompt) are ONLY reading aids to
 * focus attention — the classification (clean/minor/moderate/severe) is done by
 * eye, not by the heuristic. No API, no DB, no writes.
 *
 * Run: cd data && npx tsx scripts/spotcheck-llm-descriptions-2026-08-21.ts [N] [seed]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOG_PATH = resolve(process.cwd(), "..", ".context/measurements/llm-description-run-2026-08-21.jsonl");
const N = process.argv[2] ? parseInt(process.argv[2], 10) : 50;
const SEED = process.argv[3] ? parseInt(process.argv[3], 10) : 20260821;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rec = {
  master_place_id: string; bucket?: string; state?: string; primary_category?: string;
  source_ids?: string[]; prompt_text?: string; generated_description?: string; error?: string;
};

// Numbers present in the generated text but NOT in the prompt — the exact
// failure mode the anti-fabrication prompt targets (acreage/elevation/year/etc).
function fabricatedNumbers(prompt: string, gen: string): string[] {
  const promptNums = new Set((prompt.match(/\d+/g) ?? []));
  const genNums = gen.match(/\d[\d,\.]*/g) ?? [];
  const out: string[] = [];
  for (const raw of genNums) {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length === 0) continue;
    // ignore small standalone ordinals like "2-3" that the length rule handles
    if (!promptNums.has(digits) && ![...promptNums].some(p => p.includes(digits) || digits.includes(p))) {
      out.push(raw);
    }
  }
  return out;
}

function main() {
  const lines = readFileSync(LOG_PATH, "utf8").trim().split("\n").filter(Boolean);
  const recs: Rec[] = lines.map(l => JSON.parse(l));
  const ok = recs.filter(r => !r.error && r.generated_description && r.prompt_text);
  console.log(`Log rows: ${recs.length}  successful (with prompt+text): ${ok.length}  errors: ${recs.length - ok.length}`);

  const rng = mulberry32(SEED);
  const shuffled = [...ok].sort(() => rng() - 0.5);
  const sample = shuffled.slice(0, Math.min(N, ok.length));
  console.log(`Sampling ${sample.length} (seed ${SEED})\n`);

  let heuristicNumFlags = 0;
  sample.forEach((r, i) => {
    const nums = fabricatedNumbers(r.prompt_text!, r.generated_description!);
    if (nums.length) heuristicNumFlags++;
    console.log(`\n════ [${i + 1}] ${r.bucket} · ${r.state} · ${r.primary_category} · ${(r.source_ids ?? []).join(",")} ════`);
    console.log(`ID ${r.master_place_id}`);
    console.log(`PROMPT:`);
    console.log(r.prompt_text!.split("\n").map(l => "  | " + l).join("\n"));
    console.log(`GENERATED:`);
    console.log("  → " + r.generated_description);
    if (nums.length) console.log(`  ⚠ heuristic: number(s) in output not in prompt: ${nums.join(", ")}`);
  });

  console.log(`\n\n== heuristic summary (reading aid only, NOT the fabrication rate) ==`);
  console.log(`  rows with a number in output absent from prompt: ${heuristicNumFlags}/${sample.length}`);
  console.log(`  (manual eye-check classifies clean/minor/moderate/severe — a flagged number may be a legit`);
  console.log(`   provided figure the matcher missed, or a real fabrication; read each.)`);
}

main();
