/**
 * Backfill NPS imagery onto source_record.normalized_payload.photo (Route A).
 *
 * The NPS API already returned an `images` array at ingest; `.passthrough()`
 * kept it in raw_payload.place.images, but the schema never parsed it. The
 * ingester now promotes a `photo` object; this backfills EXISTING rows from
 * their own raw_payload — ZERO new API traffic.
 *
 * Idempotent + re-runnable: for each nps source_record it recomputes the photo
 * from raw_payload and writes only when it differs from what's stored. A second
 * run reports 0 changed.
 *
 * NOT a corpus materialize/--rematerialize: it writes NO master_place row and
 * inserts NO source_record — it only sets one jsonb key on existing nps
 * source_records. Additive-only in spirit; still a deliberate corpus write, so
 * PRODUCTION is guarded behind --confirm (and needs the prod .env swap, same as
 * db:push-verify's prod path). Run TEST via the default `.env` (test).
 *
 * Run:
 *   npm run -w data backfill:nps-photo -- --dry-run     # read-only preview
 *   npm run -w data backfill:nps-photo                  # apply (test)
 *   # PROD: swap data/.env to prod creds, then: ... -- --confirm
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { npsPhotoFromImages } from "../ingestion/sources/nps.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE_SIZE = 1000;

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m ? m[1] : "unknown";
}

type Row = {
  id: string;
  raw_payload: { place?: { images?: unknown[] } } | null;
  normalized_payload: Record<string, unknown> | null;
};

/** The photo the row SHOULD carry, from its own raw_payload. */
function desiredPhoto(row: Row): ReturnType<typeof npsPhotoFromImages> {
  const images = row.raw_payload?.place?.images;
  // npsPhotoFromImages tolerates the loose shape; cast at this one seam.
  return npsPhotoFromImages(images as Parameters<typeof npsPhotoFromImages>[0]);
}

/** True when the stored normalized_payload.photo already matches `want`. Field-
 *  wise, NOT JSON.stringify — postgres jsonb does not preserve key order, so a
 *  stringify compare re-writes every row on every run (not idempotent). */
function alreadyMatches(
  row: Row,
  want: ReturnType<typeof npsPhotoFromImages>,
): boolean {
  const cur = ((row.normalized_payload ?? {}).photo ?? null) as
    | { url?: unknown; altText?: unknown; credit?: unknown }
    | null;
  if (want === null) return cur === null;
  if (cur === null) return false;
  return (
    cur.url === want.url &&
    (cur.altText ?? null) === want.altText &&
    (cur.credit ?? null) === want.credit
  );
}

async function scan(
  db: SupabaseClient,
  apply: boolean,
): Promise<{ scanned: number; withPhoto: number; changed: number; skipped: number }> {
  const stats = { scanned: 0, withPhoto: 0, changed: 0, skipped: 0 };
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("id, raw_payload, normalized_payload")
      .eq("source_id", "nps")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch nps source_records: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const photo = desiredPhoto(row);
      if (photo) stats.withPhoto += 1;
      if (alreadyMatches(row, photo)) {
        stats.skipped += 1;
        continue;
      }
      stats.changed += 1;
      if (apply) {
        const merged = { ...(row.normalized_payload ?? {}), photo };
        const { error: upErr } = await db
          .from("source_record")
          .update({ normalized_payload: merged })
          .eq("id", row.id);
        if (upErr) throw new Error(`update ${row.id}: ${upErr.message}`);
      }
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return stats;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("backfill-nps-photo")
    .description("Backfill normalized_payload.photo on nps source_records from their own raw_payload.")
    .option("--dry-run", "Read-only preview; writes nothing. Needs no --confirm.")
    .option("--confirm", "Required to write against the PRODUCTION project.")
    .parse(process.argv);
  const opts = program.opts<{ dryRun?: boolean; confirm?: boolean }>();
  const db = getDb();
  const ref = targetRef();

  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error(
      { target: ref },
      "refusing to backfill PRODUCTION without --confirm. Re-run with --confirm, or use --dry-run.",
    );
    process.exitCode = 1;
    return;
  }
  if (ref !== PROD_REF && ref !== TEST_REF) {
    logger.warn({ target: ref }, "target is neither the known prod nor test ref; proceeding");
  }

  const apply = !opts.dryRun;
  const stats = await scan(db, apply);
  logger.info({ target: ref, apply, ...stats }, apply ? "backfill-nps-photo: applied" : "backfill-nps-photo: dry-run");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ target: ref, apply, ...stats }, null, 2));
}

main().catch((err) => {
  logger.error({ err }, "backfill-nps-photo: fatal");
  process.exit(1);
});
