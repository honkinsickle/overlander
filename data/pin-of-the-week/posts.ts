/**
 * Pin of the Day — post history CLI (TEST-only).
 *
 * Records approved posts to a reusable history and lets you browse / re-open
 * them. A post is recorded ONLY on approval (the skill calls --record after the
 * operator approves), never at generate time.
 *
 *   # record an approved post from a generator output dir (must contain image.png)
 *   npm run -w data potw:posts -- --record --from pin-of-the-week/output/<slug>
 *
 *   # browse recorded posts (newest first)
 *   npm run -w data potw:posts -- --list [--json]
 *
 *   # re-open a past post: prints its metadata + archive paths (show-only, no writes)
 *   npm run -w data potw:posts -- --reuse <id> [--json]
 *
 * --record reads the generator's self-describing place.json + caption.json from
 * --from, inserts the DB row, then copies image.png into a committed archive at
 * pin-of-the-week/posts/<date>-<slug>/ alongside a self-contained manifest.json.
 * The archive slug matches the generator's own output slug (basename of --from).
 */

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getDb } from "../ingestion/lib/db.ts";
import { assertTestProject } from "./eligibility.ts";
import {
  archiveDirName,
  buildManifest,
  getPost,
  listPosts,
  postFieldsFromArtifacts,
  recordPost,
  type CaptionArtifact,
  type PlaceArtifact,
  type PostInput,
  type StoredPost,
} from "./post-history.ts";

const ARCHIVE_ROOT = join("pin-of-the-week", "posts");

interface Args {
  record: boolean;
  list: boolean;
  from: string | null;
  reuse: number | null;
  json: boolean;
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  const reuseRaw = flag(argv, "--reuse");
  let reuse: number | null = null;
  if (reuseRaw != null) {
    reuse = Number(reuseRaw);
    if (!Number.isInteger(reuse) || reuse <= 0) throw new Error("--reuse requires a positive integer id");
  }
  return {
    record: argv.includes("--record"),
    list: argv.includes("--list"),
    from: flag(argv, "--from"),
    reuse,
    json: argv.includes("--json"),
  };
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    throw new Error(`could not read ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

/** RECORD: read the generator output, insert the row, archive the image + manifest. */
async function runRecord(db: ReturnType<typeof getDb>, args: Args): Promise<void> {
  if (!args.from) throw new Error("--record requires --from <generator-output-dir>");
  const fromDir = args.from.replace(/\/+$/, "");

  const place = await readJson<PlaceArtifact>(join(fromDir, "place.json"));
  const caption = await readJson<CaptionArtifact>(join(fromDir, "caption.json"));
  const imageSrc = join(fromDir, "image.png");
  // The image must already exist — the skill runs `generate --render` first.
  const imageStat = await stat(imageSrc).catch(() => null);
  if (!imageStat?.isFile()) {
    throw new Error(`no image.png in ${fromDir} — run \`potw:generate --id <uuid> --render\` first`);
  }

  const slug = basename(fromDir);
  const date = new Date().toISOString().slice(0, 10);
  const archiveDir = join(ARCHIVE_ROOT, archiveDirName(date, slug));

  const input: PostInput = { ...postFieldsFromArtifacts(place, caption), archiveDir };

  // Archive the image first (creates the dir); then insert; then write the
  // manifest with the real id + created_at.
  await mkdir(archiveDir, { recursive: true });
  await copyFile(imageSrc, join(archiveDir, "image.png"));
  await copyFile(join(fromDir, "caption.txt"), join(archiveDir, "caption.txt")).catch(() => {
    /* caption.txt is a convenience copy; manifest.json holds the caption text */
  });

  const { id, created_at } = await recordPost(db, input);
  const manifest = buildManifest(input, created_at, id);
  await writeFile(join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n📌 Pin of the Day — recorded post #${id}\n`);
  console.log(`  ${input.canonicalName}`);
  console.log(`  caption template: #${input.templateNumber}  ·  photo: ${input.photoSource}`);
  console.log(`  archive: ${archiveDir}/  (image.png + manifest.json + caption.txt)`);
  console.log(`  status: ${input.status ?? "created"}  ·  created_at: ${created_at}\n`);
}

function line(p: StoredPost): string {
  const date = p.created_at.slice(0, 10);
  return `  #${p.id}  ${date}  ${p.canonical_name}  [tpl ${p.template_number} · ${p.photo_source} · ${p.status}]`;
}

/** LIST: recorded posts, newest first. */
async function runList(db: ReturnType<typeof getDb>, args: Args): Promise<void> {
  const posts = await listPosts(db);
  if (args.json) {
    console.log(JSON.stringify(posts, null, 2));
    return;
  }
  if (posts.length === 0) {
    console.log("\nNo Pin of the Day posts recorded yet.\n");
    return;
  }
  console.log(`\n📌 Pin of the Day — ${posts.length} recorded post(s):\n`);
  for (const p of posts) console.log(line(p));
  console.log("");
}

/** REUSE: show a past post (metadata + archive paths). No writes, no re-render. */
async function runReuse(db: ReturnType<typeof getDb>, args: Args): Promise<void> {
  const post = await getPost(db, args.reuse as number);
  if (!post) throw new Error(`no Pin of the Day post with id ${args.reuse}`);
  if (args.json) {
    console.log(JSON.stringify(post, null, 2));
    return;
  }
  console.log(`\n📌 Pin of the Day — post #${post.id}\n`);
  console.log(`  ${post.canonical_name}  [tpl ${post.template_number} · ${post.photo_source} · ${post.status}]`);
  console.log(`  created_at: ${post.created_at}`);
  console.log(`  photo_ref: ${post.photo_ref ?? "(none)"}`);
  console.log(`  archive: ${post.archive_dir}/`);
  console.log(`    image:    ${join(post.archive_dir, "image.png")}`);
  console.log(`    manifest: ${join(post.archive_dir, "manifest.json")}`);
  console.log(`\n──── caption ────\n${post.caption_text}\n─────────────────\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertTestProject();
  const db = getDb();

  if (args.record) return runRecord(db, args);
  if (args.reuse != null) return runReuse(db, args);
  if (args.list) return runList(db, args);

  throw new Error("pass one of --record --from <dir> / --list / --reuse <id>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
