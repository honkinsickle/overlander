/**
 * Pin of the Week — GENERATE stage (TEST-only).
 *
 * Given a selected place, produce:
 *   (1) a hook + caption (HOOK → payoff → CTA), and
 *   (2) a branded Nano Banana image prompt/spec (+ the rendered image if a
 *       GEMINI_API_KEY / GOOGLE_API_KEY is configured).
 *
 * Run:
 *   npm run -w data potw:generate -- --id <uuid>
 *   npm run -w data potw:generate -- --from-select      # use the current top pick
 *   npm run -w data potw:generate -- --from-select --llm --render
 *
 * Flags:
 *   --id <uuid>     master_place id to feature
 *   --from-select   pick the current top candidate via the selector's ranking
 *   --llm           rewrite hook/body via Anthropic (falls back if no key)
 *   --render        attempt the Nano Banana render (dry-run without a key)
 *   --out <dir>     output directory (default: data/pin-of-the-week/output)
 *   --force         generate even if the place is not eligible
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../ingestion/lib/db.ts";
import {
  assertTestProject,
  evaluate,
  fetchEvaluatedCandidates,
  CANDIDATE_COLUMNS,
  type CandidateRow,
  type EvaluatedCandidate,
} from "./eligibility.ts";
import { composeCaption, composeCaptionLLM } from "./caption.ts";
import { composeImagePrompt } from "./image-prompt.ts";
import { renderNanoBanana } from "./nano-banana.ts";
import { compositePost } from "./composite.ts";

interface Args {
  id: string | null;
  fromSelect: boolean;
  llm: boolean;
  render: boolean;
  out: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const idIdx = argv.indexOf("--id");
  const outIdx = argv.indexOf("--out");
  return {
    id: idIdx >= 0 ? argv[idIdx + 1] : null,
    fromSelect: argv.includes("--from-select"),
    llm: argv.includes("--llm"),
    render: argv.includes("--render"),
    out: outIdx >= 0 ? argv[outIdx + 1] : join("pin-of-the-week", "output"),
    force: argv.includes("--force"),
  };
}

async function fetchById(db: ReturnType<typeof getDb>, id: string): Promise<EvaluatedCandidate> {
  const res = await db.from("master_place").select(CANDIDATE_COLUMNS).eq("id", id).limit(1);
  if (res.error || res.data == null) throw new Error(`fetch by id failed: ${JSON.stringify(res)}`);
  if (res.data.length === 0) throw new Error(`no master_place with id ${id}`);
  return evaluate(res.data[0] as unknown as CandidateRow);
}

/** Reuse the selector's ranking to get the current top pick. */
async function topPick(db: ReturnType<typeof getDb>): Promise<EvaluatedCandidate> {
  const evaluated = await fetchEvaluatedCandidates(db);
  const eligible = evaluated.filter((c) => c.eligible);
  if (eligible.length === 0) throw new Error("no eligible candidates to generate from");
  // Same primary ordering as select.ts with no featured history: prominence desc, id asc.
  eligible.sort((a, b) => b.prominence_score - a.prominence_score || a.id.localeCompare(b.id));
  return eligible[0];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertTestProject();
  const db = getDb();

  if (!args.id && !args.fromSelect) throw new Error("pass --id <uuid> or --from-select");

  const candidate = args.id ? await fetchById(db, args.id) : await topPick(db);
  if (!candidate.eligible && !args.force) {
    throw new Error(
      `place ${candidate.id} is not eligible: ${candidate.rejections.join("; ")}. Pass --force to override.`,
    );
  }

  const caption = args.llm ? await composeCaptionLLM(candidate) : composeCaption(candidate);
  const imagePrompt = composeImagePrompt(candidate);

  const slug = slugify(candidate.canonical_name);
  const dir = join(args.out, slug);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, "caption.txt"), caption.text + "\n");
  await writeFile(join(dir, "caption.json"), JSON.stringify(caption, null, 2) + "\n");
  await writeFile(join(dir, "image-prompt.txt"), imagePrompt.prompt + "\n");
  await writeFile(join(dir, "image-spec.json"), JSON.stringify(imagePrompt, null, 2) + "\n");
  await writeFile(
    join(dir, "place.json"),
    JSON.stringify(
      {
        id: candidate.id,
        canonical_name: candidate.canonical_name,
        primary_category: candidate.primary_category,
        state: candidate.state,
        photo_url: candidate.photo_url,
        prominence_score: candidate.prominence_score,
        official_sources: candidate.signals.officialSources,
        eligible: candidate.eligible,
        rejections: candidate.rejections,
      },
      null,
      2,
    ) + "\n",
  );

  let renderNote = "skipped (pass --render to render)";
  if (args.render) {
    // Step 1: Nano Banana renders the graded hero photo (NO text).
    const result = await renderNanoBanana(imagePrompt);
    if (result.rendered && result.bytes) {
      const baseExt = result.mimeType?.includes("png") ? "png" : "jpg";
      await writeFile(join(dir, `base.${baseExt}`), result.bytes);
      // Step 2: composite the caption bar deterministically (real name + fonts).
      const composited = await compositePost({
        baseImage: result.bytes,
        overlayText: imagePrompt.overlayText,
        dimensions: imagePrompt.dimensions,
      });
      await writeFile(join(dir, "image.png"), composited);
      renderNote = `treatment base.${baseExt} + composited image.png (${composited.length} bytes)`;
    } else {
      renderNote = `dry run — ${result.reason}`;
    }
  }

  console.log(`\n📌 Pin of the Week — GENERATE\n`);
  console.log(`  ${candidate.canonical_name} [${candidate.primary_category}${candidate.state ? ` · ${candidate.state}` : ""}]`);
  console.log(`  caption source: ${caption.meta.generatedBy}  (payoff basis: ${caption.meta.verificationBasis})`);
  console.log(`  image: ${renderNote}`);
  console.log(`  artifacts → ${dir}/`);
  console.log(`\n──── caption ────\n${caption.text}\n─────────────────\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
