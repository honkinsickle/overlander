/**
 * Pin of the Day — publish a built post or story to Instagram (CLI).
 *
 * Takes a directory a build already wrote and puts it on the account. It renders
 * nothing: `potw:sheet` makes the files, this sends one of them. Keeping the two
 * apart means a publish can be retried without re-rendering, and a render can be
 * reviewed without any risk of it going live.
 *
 * Run:
 *   # what would happen, and prove the credential — publishes NOTHING
 *   npm run -w data potw:publish -- --dir <out>/<slug> --dry-run
 *   # the post
 *   npm run -w data potw:publish -- --dir <out>/<slug>
 *   # the story (a separate call; stories carry no caption)
 *   npm run -w data potw:publish -- --dir <out>/<slug> --story
 *
 * It asks for confirmation before anything goes live. `--yes` skips the prompt,
 * which is what the autonomous skill flow uses; without a terminal AND without
 * `--yes` it refuses rather than assuming consent.
 *
 * Marking the sheet row `posted` is deliberately NOT done here — the skill ticks
 * it only after Instagram has confirmed, and that ordering is the thing that
 * stops a row reading `posted` when nothing was.
 */

import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadImage } from "@napi-rs/canvas";
import { getDb } from "../ingestion/lib/db.ts";
import { assertTestProject } from "./eligibility.ts";
import { BUCKET, publish, supabaseDeps, type PublishKind } from "./publish-instagram.ts";
import type { PostMeta } from "./from-sheet.ts";

interface Args {
  dir: string | null;
  story: boolean;
  dryRun: boolean;
  yes: boolean;
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  return {
    dir: flag(argv, "--dir"),
    story: argv.includes("--story"),
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
  };
}

/**
 * The story file is `story.png` (1080x1920), not `story-web.png`. The padded
 * 1080x2340 variant exists only to survive Instagram's browser composer; the API
 * takes the 9:16 render as-is. See publish-instagram.ts.
 */
function fileFor(kind: PublishKind): string {
  return kind === "story" ? "story.png" : "image.png";
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) throw new Error("--dir <path to a built post directory> is required");

  const token = process.env.IG_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("IG_ACCESS_TOKEN is not set (it belongs in data/.env)");
  // The staging bucket lives on TEST. Staging into PROD would put a render in the
  // wrong project for no benefit, since the object is deleted moments later.
  assertTestProject();

  const dir = resolve(args.dir);
  const kind: PublishKind = args.story ? "story" : "post";
  const png = await readFile(join(dir, fileFor(kind))).catch(() => {
    throw new Error(`${fileFor(kind)} not found in ${dir}${args.story ? " — this post has no story" : ""}`);
  });
  // A story carries no caption; reading one would only invite the question of
  // where it went.
  const caption = kind === "post" ? (await readFile(join(dir, "caption.txt"), "utf8")).trim() : "";
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as PostMeta;
  const img = await loadImage(png);

  console.log(`\n${args.dryRun ? "DRY RUN — nothing will be published" : "PUBLISH TO INSTAGRAM"}`);
  console.log(`  ${meta.place} · ${meta.state || meta.country} · ${meta.category}`);
  console.log(`  ${kind}: ${fileFor(kind)} (${img.width}x${img.height})`);
  if (caption) console.log(`\n${caption}\n`);

  if (!args.dryRun && !args.yes) {
    if (!process.stdin.isTTY) {
      throw new Error("refusing to publish unattended — pass --yes to confirm, or run with a terminal");
    }
    if (!(await confirm(`Publish this ${kind} to @yotrippin.app now?`))) {
      console.log("cancelled — nothing published");
      return;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await publish(
    {
      token,
      png,
      kind,
      caption: caption || undefined,
      objectPath: `${basename(dir)}/${kind}-${stamp}.jpg`,
      dryRun: args.dryRun,
    },
    supabaseDeps(getDb()),
  );

  if (result.mediaId) {
    console.log(`✅ published ${kind} — media ${result.mediaId}`);
  } else {
    console.log(
      `✓ container ${result.containerId} built and NOT published — Instagram fetched the image, so the credential and the staging url both work. It expires in 24h.`,
    );
  }
  if (result.cleanupError) {
    console.log(`⚠ the staged jpeg was left in the "${BUCKET}" bucket — ${result.cleanupError}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
