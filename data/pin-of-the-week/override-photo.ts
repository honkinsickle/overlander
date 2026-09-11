/**
 * Pin of the Week — manual photo override CLI (TEST-only).
 *
 * Set, list, or clear a per-place photo override that the generator uses in
 * place of the corpus-resolved photo. Provenance (--source, --license) is
 * REQUIRED when setting, matching the photo-backfill pilot's licensing
 * discipline.
 *
 * Run:
 *   # set from a URL
 *   npm run -w data potw:override-photo -- --place-id <uuid> --url <url> \
 *     --source "..." --license "..." [--attribution "..."]
 *   # set from a local file
 *   npm run -w data potw:override-photo -- --place-id <uuid> --file <path> \
 *     --source "..." --license "..." [--attribution "..."]
 *   # show the current override
 *   npm run -w data potw:override-photo -- --place-id <uuid> --list
 *   # remove the override
 *   npm run -w data potw:override-photo -- --place-id <uuid> --clear
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDb } from "../ingestion/lib/db.ts";
import { assertTestProject } from "./eligibility.ts";
import { sniffImageMime } from "./nano-banana.ts";
import { clearPhotoOverride, fetchPhotoOverride, setPhotoOverride } from "./photo-override.ts";

interface Args {
  placeId: string | null;
  file: string | null;
  url: string | null;
  source: string | null;
  license: string | null;
  attribution: string | null;
  clear: boolean;
  list: boolean;
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  return {
    placeId: flag(argv, "--place-id"),
    file: flag(argv, "--file"),
    url: flag(argv, "--url"),
    source: flag(argv, "--source"),
    license: flag(argv, "--license"),
    attribution: flag(argv, "--attribution"),
    clear: argv.includes("--clear"),
    list: argv.includes("--list"),
  };
}

/** Confirm the place exists; return its name for friendly output. */
async function placeName(db: ReturnType<typeof getDb>, id: string): Promise<string> {
  const r = await db.from("master_place").select("id,canonical_name").eq("id", id).limit(1);
  if (r.error) throw new Error(`place lookup failed: ${JSON.stringify(r.error)}`);
  if (!r.data || r.data.length === 0) throw new Error(`no master_place with id ${id}`);
  return (r.data[0] as { canonical_name: string }).canonical_name;
}

function describeOverride(o: Awaited<ReturnType<typeof fetchPhotoOverride>>): string {
  if (!o) return "(none)";
  const img = o.image_url ? `url=${o.image_url}` : `inline ${o.mime_type} (${o.image_data?.length ?? 0} b64 chars)`;
  return `${img}\n  source: ${o.source}\n  license: ${o.license}${o.attribution ? `\n  attribution: ${o.attribution}` : ""}\n  updated_at: ${o.updated_at}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertTestProject();
  const db = getDb();

  if (!args.placeId) throw new Error("--place-id <uuid> is required");
  const name = await placeName(db, args.placeId);

  // CLEAR
  if (args.clear) {
    const removed = await clearPhotoOverride(db, args.placeId);
    console.log(removed ? `✅ Cleared photo override for ${name} (${args.placeId}).` : `No override existed for ${name} (${args.placeId}).`);
    return;
  }

  // LIST (explicit --list, or default when nothing to set)
  if (args.list || (!args.file && !args.url)) {
    const current = await fetchPhotoOverride(db, args.placeId);
    console.log(`\nPhoto override for ${name} (${args.placeId}):\n  ${describeOverride(current)}\n`);
    return;
  }

  // SET
  if (args.file && args.url) throw new Error("provide only one of --file / --url");
  if (!args.source || !args.license) {
    throw new Error("--source and --license are REQUIRED when setting an override (provenance discipline)");
  }

  if (args.url) {
    await setPhotoOverride(db, {
      masterPlaceId: args.placeId,
      imageUrl: args.url,
      source: args.source,
      license: args.license,
      attribution: args.attribution,
    });
    console.log(`✅ Set photo override for ${name} → ${args.url}\n   source: ${args.source} · license: ${args.license}`);
    return;
  }

  // --file
  const buf = await readFile(args.file as string);
  const mime = sniffImageMime(buf);
  if (!mime) throw new Error(`--file ${basename(args.file as string)} is not a recognized image (png/jpeg/webp/gif)`);
  await setPhotoOverride(db, {
    masterPlaceId: args.placeId,
    imageData: buf.toString("base64"),
    mimeType: mime,
    source: args.source,
    license: args.license,
    attribution: args.attribution,
  });
  console.log(
    `✅ Set photo override for ${name} → local file ${basename(args.file as string)} (${mime}, ${buf.length} bytes)\n   source: ${args.source} · license: ${args.license}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
