/**
 * Pin of the Day — one unattended post, end to end (CLI).
 *
 * This is what a scheduler calls: build the next queued row, publish the post,
 * publish its story, tick the sheet. It is the §Autonomous posting flow with no
 * human in it, so every guard that a human used to provide has to be explicit.
 *
 * Run:
 *   npm run -w data potw:auto -- --sheet <url> --category campground
 *   npm run -w data potw:auto -- --sheet <url> --category scenic --dry-run
 *
 * ORDER IS LOAD-BEARING and matches the skill: publish, confirm, THEN tick. A
 * tick written first would silently drop a post from the queue if the publish
 * then failed.
 *
 * THE DANGEROUS STATE is "published but not ticked": the row stays queued, so
 * the next run rebuilds and republishes it. Two things guard against it —
 *   1. a local published-log, consulted BEFORE publishing, which refuses a row
 *      that has already gone out even if the sheet says otherwise; and
 *   2. a loud, non-zero exit naming the tab and row when the tick fails.
 * The log is machine state, not project state, so it lives beside the other
 * machine-local credentials rather than in the repo.
 *
 * An empty queue is SUCCESS, not failure. Nothing to post is the normal state
 * of a queue that has caught up, and a scheduler that treats it as an error
 * just generates noise three times a day.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../ingestion/lib/db.ts";
import { assertTestProject } from "./eligibility.ts";
import type { PostMeta } from "./from-sheet.ts";
import { publish, supabaseDeps } from "./publish-instagram.ts";
import { markPosted, serviceAccountToken, todayLocal } from "./sheet-write.ts";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Machine-local record of what has actually gone out. Not project state. */
const PUBLISHED_LOG = `${process.env.HOME ?? ""}/.config/overlander/potd-published.jsonl`;

interface PublishedEntry {
  tab: string;
  row: number;
  place: string;
  at: string;
  postMediaId: string;
  storyMediaId?: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * The build prints one `✓ <place> → <category> template N + story → <dir>` line
 * per post. `--next-only` makes that exactly one line, and the dir is the last
 * arrow-separated field. Parsed rather than globbed because earlier runs leave
 * their own dirs on disk and a glob can land on a stale post.
 */
export function parseBuiltDir(stdout: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith("✓ "));
  if (!line) return null;
  const parts = line.split(" → ");
  const dir = parts[parts.length - 1]?.trim();
  return dir && dir.startsWith("/") ? dir : null;
}

export function queueIsEmpty(stdout: string): boolean {
  return stdout.includes("nothing to build");
}

function alreadyPublished(tab: string, row: number): PublishedEntry | null {
  if (!existsSync(PUBLISHED_LOG)) return null;
  for (const line of readFileSync(PUBLISHED_LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as PublishedEntry;
      if (e.tab === tab && e.row === row) return e;
    } catch {
      // A corrupt line must not make the guard fail open — skip it and keep
      // checking the rest.
    }
  }
  return null;
}

function recordPublished(entry: PublishedEntry): void {
  appendFileSync(PUBLISHED_LOG, JSON.stringify(entry) + "\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sheet = flag(argv, "--sheet");
  const category = flag(argv, "--category")?.trim();
  const dryRun = argv.includes("--dry-run");
  if (!sheet || !category) {
    throw new Error("usage: potw:auto -- --sheet <url> --category <name> [--dry-run]");
  }
  const tab = `${category} posts`;
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] potw:auto ${category}${dryRun ? " (dry run)" : ""}`);

  const token = process.env.IG_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("IG_ACCESS_TOKEN is not set (it belongs in data/.env)");
  // The staging bucket is on TEST; publishing must never stage into PROD.
  assertTestProject();

  // 1. BUILD. Spawned rather than imported: from-sheet's entry point is
  // argv-driven, and reaching into it would mean changing a file this flow only
  // needs to call.
  const build = spawnSync(
    "npx",
    ["tsx", "pin-of-the-week/from-sheet.ts", "--sheet", sheet, "--category", category, "--next-only"],
    { cwd: DATA_DIR, encoding: "utf8" },
  );
  const out = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  process.stdout.write(out);
  if (build.status !== 0) throw new Error(`build failed (exit ${build.status}) — nothing published`);
  if (queueIsEmpty(out)) {
    console.log(`✓ ${category}: queue empty, nothing to post`);
    return;
  }
  const dir = parseBuiltDir(out);
  if (!dir) throw new Error("could not read the built directory from the build output — nothing published");

  // 2. What did it build? meta.json carries the row number, so the tick does not
  // depend on parsing it back out of a console line.
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as PostMeta;
  const png = await readFile(join(dir, "image.png"));
  const caption = (await readFile(join(dir, "caption.txt"), "utf8")).trim();
  const storyPath = join(dir, "story.png");
  const hasStory = existsSync(storyPath);
  console.log(`  ${meta.place} · row ${meta.sourceRow} · template ${meta.templateNumber}${hasStory ? " + story" : " (no story)"}`);

  // 3. THE REPUBLISH GUARD. Checked before anything is sent: if this row is in
  // the local log, it already went out and the sheet tick is what failed. Posting
  // again would be the loop this whole design exists to prevent.
  const seen = alreadyPublished(tab, meta.sourceRow);
  if (seen) {
    throw new Error(
      `${tab} row ${meta.sourceRow} ("${seen.place}") was already published at ${seen.at} ` +
        `(post ${seen.postMediaId}) but its "posted" cell is still empty. ` +
        `Refusing to publish it again — tick that cell by hand, then re-run.`,
    );
  }

  const deps = supabaseDeps(getDb());
  const objectStamp = stamp.replace(/[:.]/g, "-");

  // 4. PUBLISH THE POST. Everything above this line is reversible; nothing below
  // it is.
  const post = await publish(
    { token, png, kind: "post", caption, objectPath: `${meta.place}/post-${objectStamp}.jpg`, dryRun },
    deps,
  );
  if (dryRun) {
    console.log(`✓ dry run: container ${post.containerId} built, nothing published, sheet untouched`);
    return;
  }
  if (!post.mediaId) throw new Error("publish returned no media id — treating as not published");
  console.log(`✅ post ${post.mediaId}`);

  // 5. THE STORY, which must never be able to undo the post. A failure here is a
  // warning: the post is out, so the row IS posted and must be ticked.
  let storyMediaId: string | undefined;
  if (hasStory) {
    try {
      const story = await publish(
        {
          token,
          png: await readFile(storyPath),
          kind: "story",
          objectPath: `${meta.place}/story-${objectStamp}.jpg`,
        },
        deps,
      );
      storyMediaId = story.mediaId ?? undefined;
      console.log(`✅ story ${storyMediaId}`);
    } catch (e) {
      console.log(`⚠ story not published — ${errText(e)} (the post is live; continuing)`);
    }
  }

  // 6. Record locally BEFORE the sheet. If the tick fails, this is what stops
  // the next run republishing.
  recordPublished({
    tab,
    row: meta.sourceRow,
    place: meta.place,
    at: stamp,
    postMediaId: post.mediaId,
    storyMediaId,
  });

  // 7. TICK THE SHEET.
  const date = todayLocal();
  try {
    await markPosted(
      { sheetUrl: sheet, tab, rowNumber: meta.sourceRow, date },
      { fetch, token: serviceAccountToken() },
    );
    console.log(`✓ ${tab} row ${meta.sourceRow} marked posted ${date}`);
  } catch (e) {
    // Loud and non-zero: the post is public but the queue does not know, which
    // is the one state that needs a human.
    console.error(
      `✗ PUBLISHED BUT NOT TICKED — ${errText(e)}\n` +
        `  Write ${date} into "${tab}" row ${meta.sourceRow} by hand. ` +
        `Until then that row is blocked by the republish guard, not reposted.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`✓ done: ${meta.place} (${category})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
