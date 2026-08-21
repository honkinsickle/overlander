/**
 * Backfill normalized_payload.directions onto existing RIDB *facility*
 * source_records from raw_payload.facility.FacilityDirections.
 *
 * Root cause (2026-08-20 NONE-bucket characterization pass, docs/
 * measurements/2026-08-20-none-bucket-characterization.md §5, and the
 * accompanying fix report): ridb.ts's normalizeFacility() never read
 * FacilityDirections at all — the field wasn't even in FacilitySchema, so
 * it only ever reached the corpus inside the passthrough raw_payload, never
 * normalized_payload. Fixed at ingest time in ridb.ts (FacilitySchema +
 * normalizeFacility now map it, HTML-stripped, to `directions` — the same
 * key usfs.ts already uses, read generically by the new has_real_directions
 * signal in data/scripts/lib/eligibility.ts). This backfill re-normalizes
 * facility rows written before that fix. recareas are out of scope —
 * RecAreaSchema has no directions-equivalent field; this is facility-only,
 * matching what was actually found.
 *
 * Purely a re-derivation from each row's own stored raw_payload.facility —
 * no network calls. The existing normalized_payload.photo is carried
 * through unchanged (not re-fetched, not clobbered to null) — this backfill
 * touches `directions` only. Idempotent + re-runnable: writes only when the
 * recomputed `directions` differs from what's stored (a second run reports
 * 0 changed). Same Phase-1-read-then-Phase-2-write shape as
 * backfill-ridb-photo.ts.
 *
 * NOT a corpus materialize/--rematerialize: writes NO master_place row and
 * inserts NO source_record — sets one jsonb key on existing ridb:facility
 * source_records. PROD is guarded behind --confirm; TEST is the default via
 * data/.env.
 *
 * Run:
 *   npm run -w data backfill:ridb-directions -- --dry-run   # read-only preview
 *   npm run -w data backfill:ridb-directions                # apply (test)
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { normalizeFacility, type RidbPhoto } from "../ingestion/sources/ridb.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE_SIZE = 1000;

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m ? m[1] : "unknown";
}

type Row = {
  id: string;
  external_id: string;
  raw_payload: { facility?: Record<string, unknown> } | null;
  normalized_payload: Record<string, unknown> | null;
};

function isFacilityRow(externalId: string): boolean {
  return externalId.startsWith("ridb:facility:");
}

export async function scan(
  db: SupabaseClient,
  apply: boolean,
  pageSize: number = PAGE_SIZE,
): Promise<{
  scanned: number;
  facilityRows: number;
  withDirections: number;
  withRealDirections: number;
  changed: number;
  skipped: number;
  errors: number;
}> {
  const stats = {
    scanned: 0, facilityRows: 0, withDirections: 0, withRealDirections: 0,
    changed: 0, skipped: 0, errors: 0,
  };

  const pending: { id: string; normalized: Record<string, unknown> }[] = [];

  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("id, external_id, raw_payload, normalized_payload")
      .eq("source_id", "ridb")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch ridb source_records: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      if (!isFacilityRow(row.external_id)) {
        stats.skipped += 1;
        continue; // recareas — out of scope, see file docstring
      }
      stats.facilityRows += 1;

      const facility = row.raw_payload?.facility;
      if (!facility) {
        logger.warn({ id: row.id, external_id: row.external_id }, "ridb-directions-backfill: no raw_payload.facility — skipped");
        stats.skipped += 1;
        continue;
      }
      if (typeof facility.FacilityDirections === "string" && facility.FacilityDirections.trim().length > 0) {
        stats.withDirections += 1;
      }

      const cleanName = (row.normalized_payload?.canonical_name as string) ?? "";
      const existingPhoto = (row.normalized_payload?.photo as RidbPhoto | null | undefined) ?? null;
      const recomputed = normalizeFacility(facility as any, cleanName, existingPhoto);
      const newDirections = (recomputed.directions as string | null) ?? null;

      if (newDirections && newDirections.length >= 40) stats.withRealDirections += 1;

      const existingDirections = (row.normalized_payload?.directions as string | null | undefined) ?? null;
      if (existingDirections === newDirections) {
        stats.skipped += 1;
        continue;
      }
      stats.changed += 1;
      pending.push({
        id: row.id,
        normalized: { ...(row.normalized_payload ?? {}), directions: newDirections },
      });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  if (apply) {
    for (const { id, normalized } of pending) {
      const { error: upErr } = await db
        .from("source_record")
        .update({ normalized_payload: normalized })
        .eq("id", id);
      if (upErr) throw new Error(`update ${id}: ${upErr.message}`);
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("backfill-ridb-directions")
    .description("Backfill normalized_payload.directions on ridb:facility source_records from raw_payload.facility.FacilityDirections.")
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
  logger.info({ target: ref, apply, ...stats }, apply ? "backfill-ridb-directions: applied" : "backfill-ridb-directions: dry-run");
  console.log(JSON.stringify({ target: ref, apply, ...stats }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "backfill-ridb-directions: fatal");
    process.exit(1);
  });
}
