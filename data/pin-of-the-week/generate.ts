/**
 * Pin of the Week — GENERATE stage (TEST-only).
 *
 * Given a selected place, produce:
 *   (1) an IG caption from one of 8 fixed templates (interpolating place/
 *       category/state), written to caption.txt / caption.json, and
 *   (2) a branded Nano Banana image prompt/spec (+ the rendered image if a
 *       GEMINI_API_KEY / GOOGLE_API_KEY is configured).
 *
 * Run:
 *   npm run -w data potw:generate -- --id <uuid>
 *   npm run -w data potw:generate -- --from-select               # current top pick
 *   npm run -w data potw:generate -- --id <uuid> --caption-template 3 --render
 *
 * Flags:
 *   --id <uuid>            master_place id to feature
 *   --from-select         pick the current top candidate via the selector's ranking
 *   --caption-template N   force caption template N (1-8); default rotates (LRU)
 *   --render              attempt the Nano Banana render (dry-run without a key)
 *   --out <dir>           output directory (default: data/pin-of-the-week/output)
 *   --force               generate even if the place is not eligible
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../ingestion/lib/db.ts";
import {
  assertTestProject,
  evaluate,
  fetchEvaluatedById,
  fetchEvaluatedCandidates,
  type EvaluatedCandidate,
} from "./eligibility.ts";
import { buildCaption, pickLruTemplate, TEMPLATE_COUNT } from "./caption.ts";
import { logTemplateUse, recentTemplateUses } from "./caption-history.ts";
import { composeImagePrompt } from "./image-prompt.ts";
import { renderNanoBanana } from "./nano-banana.ts";
import { compositePost } from "./composite.ts";
import { fetchPhotoOverride } from "./photo-override.ts";

interface Args {
  id: string | null;
  fromSelect: boolean;
  render: boolean;
  out: string;
  force: boolean;
  captionTemplate: number | null;
}

function parseArgs(argv: string[]): Args {
  const idIdx = argv.indexOf("--id");
  const outIdx = argv.indexOf("--out");
  const tplIdx = argv.indexOf("--caption-template");
  let captionTemplate: number | null = null;
  if (tplIdx >= 0) {
    captionTemplate = Number(argv[tplIdx + 1]);
    if (!Number.isInteger(captionTemplate) || captionTemplate < 1 || captionTemplate > TEMPLATE_COUNT) {
      throw new Error(`--caption-template must be an integer 1-${TEMPLATE_COUNT}`);
    }
  }
  return {
    id: idIdx >= 0 ? argv[idIdx + 1] : null,
    fromSelect: argv.includes("--from-select"),
    render: argv.includes("--render"),
    out: outIdx >= 0 ? argv[outIdx + 1] : join("pin-of-the-week", "output"),
    force: argv.includes("--force"),
    captionTemplate,
  };
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

  // #417: fetch a manually-selected place by id via the shared helper (or the
  // ranked top pick). #419: then apply any manual photo override.
  let candidate: EvaluatedCandidate;
  if (args.id) {
    const found = await fetchEvaluatedById(db, args.id);
    if (!found) throw new Error(`no master_place with id ${args.id}`);
    candidate = found;
  } else {
    candidate = await topPick(db);
  }

  // Manual photo override: if one exists for this place, it replaces the
  // corpus-resolved photo. Re-evaluate so the "has photo" eligibility check
  // passes even when the corpus photo is missing (a common reason to override);
  // all other eligibility rules (description, publishable, …) still apply.
  const override = await fetchPhotoOverride(db, candidate.id);
  let inlineReferences: Array<{ mimeType: string; base64: string }> | undefined;
  if (override) {
    candidate.photo_url = override.image_url ?? `manual-override://${override.mime_type ?? "image"}`;
    candidate = evaluate(candidate);
    if (override.image_data) {
      inlineReferences = [{ mimeType: override.mime_type ?? "image/jpeg", base64: override.image_data }];
    }
  }

  if (!candidate.eligible && !args.force) {
    throw new Error(
      `place ${candidate.id} is not eligible: ${candidate.rejections.join("; ")}. Pass --force to override.`,
    );
  }

  // Caption template: forced via --caption-template, else least-recently-used
  // rotation from the durable history. Forced picks are NOT logged (they are a
  // manual/test override); auto picks are logged so rotation advances.
  const forcedTemplate = args.captionTemplate != null;
  const templateNumber = forcedTemplate
    ? (args.captionTemplate as number)
    : pickLruTemplate(await recentTemplateUses(db, TEMPLATE_COUNT));
  const caption = buildCaption(candidate, templateNumber);
  if (!forcedTemplate) await logTemplateUse(db, templateNumber, candidate.id);

  let imagePrompt = composeImagePrompt(candidate);
  // For an inline (local-file) override there's no URL to fetch — drop the
  // marker URL from the spec; the bytes are passed to the renderer directly.
  if (override?.image_data) imagePrompt = { ...imagePrompt, referenceImageUrls: [] };

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
        photo_source: override ? (override.image_url ? "override:url" : "override:file") : "corpus",
        override: override
          ? {
              source: override.source,
              license: override.license,
              attribution: override.attribution,
              image_url: override.image_url,
              mime_type: override.mime_type,
            }
          : null,
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
    const result = await renderNanoBanana(imagePrompt, { inlineReferences });
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
  console.log(`  caption template: #${caption.templateNumber}${forcedTemplate ? " (forced)" : " (auto / LRU rotation)"}`);
  console.log(
    `  photo: ${override ? `MANUAL OVERRIDE (${override.image_url ? "url" : "file"}) — source: ${override.source}` : "corpus-resolved"}`,
  );
  console.log(`  image: ${renderNote}`);
  console.log(`  artifacts → ${dir}/`);
  console.log(`\n──── caption ────\n${caption.text}\n─────────────────\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
