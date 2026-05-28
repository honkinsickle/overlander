/**
 * Phase 2.5 — Materialize orchestrator.
 *
 * Single command that wraps the ingest → ER → sync chain into one
 * idempotent, re-runnable, summary-reporting operation. Replaces the
 * hand-run-sequence-of-scripts pattern that left master_place empty at
 * the start of the search-slice session.
 *
 * Stages (each independently skippable):
 *
 *   1. (--ingest)        run source ingesters per --sources / --bbox
 *   2. (--rematerialize) clear master_place + place_match, unlink
 *                        source_record.master_place_id (RPC:
 *                        materialize_clear_resolution_state)
 *   3.                   matchAll + applyMatches (entity resolution)
 *   4. (unless --skip-sync) sync to Typesense with stale-doc pruning
 *
 * Bare invocation:    `npm run -w data materialize`
 *   → ER over current source_record, then Typesense sync.
 *
 * Fresh rebuild:      `npm run -w data materialize -- --rematerialize`
 *   → wipe ER state, re-run ER, re-sync.
 *
 * Full pipeline:      `npm run -w data materialize -- --ingest --rematerialize`
 *   → re-ingest, wipe ER, re-resolve, re-sync.
 *
 * Per spec §4: "safe by default" — bare invocation never destroys data.
 * Destructive modes require explicit flags. Idempotency requirement
 * (spec §A.3): two consecutive `--rematerialize` runs must produce
 * identical end state.
 */

import { Command, InvalidArgumentError } from "commander";
import osmIngest from "../ingestion/sources/osm.ts";
import ridbIngest from "../ingestion/sources/ridb.ts";
import npsIngest from "../ingestion/sources/nps.ts";
import googleIngest from "../ingestion/sources/google-places.ts";
import type { IngestFn, IngestOptions, IngestResult } from "../ingestion/sources/_types.ts";
import type { BoundingBox } from "../ingestion/lib/geometry.ts";
import { matchAll } from "../entity-resolution/matcher.ts";
import { applyMatches, type ApplyResult } from "../entity-resolution/promote.ts";
import { sync as runSync, type SyncResult } from "../search/sync-typesense.ts";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

// ──────────────────────────────────────────────────────────────────────
// Types + constants
// ──────────────────────────────────────────────────────────────────────

const SOURCE_INGESTERS: Record<SourceId, IngestFn> = {
  osm: osmIngest,
  ridb: ridbIngest,
  nps: npsIngest,
  google: googleIngest,
};

const SOURCE_IDS = ["osm", "ridb", "nps", "google"] as const;
type SourceId = (typeof SOURCE_IDS)[number];

const DEFAULT_NPS_PARK_CODES = ["jotr"] as const;

export interface MaterializeOptions {
  ingest: boolean;
  sources: readonly SourceId[];
  bbox: BoundingBox | null;
  parkCodes: readonly string[] | null;
  skipEr: boolean;
  skipSync: boolean;
  skipPrune: boolean;
  dryRun: boolean;
  rematerialize: boolean;
}

export interface RematerializeReport {
  source_record_unlinked: number;
  place_match_deleted: number;
  master_place_deleted: number;
}

export interface SourceRecordCounts {
  total: number;
  by_source: Record<string, number>;
}

export interface MaterializeReport {
  stages_run: string[];
  ingest: Record<string, IngestResult> | null;
  rematerialize: RematerializeReport | null;
  source_records: SourceRecordCounts;
  er: ApplyResult | null;
  sync: SyncResult | null;
  duration_ms: number;
}

// ──────────────────────────────────────────────────────────────────────
// Stage implementations
// ──────────────────────────────────────────────────────────────────────

async function runIngest(opts: MaterializeOptions): Promise<Record<string, IngestResult>> {
  const results: Record<string, IngestResult> = {};
  for (const id of opts.sources) {
    const ingestOpts: IngestOptions = { dryRun: opts.dryRun };
    if (opts.bbox) ingestOpts.bbox = opts.bbox;
    if (id === "nps") {
      // NPS is parkCode-driven, not bbox-driven.
      ingestOpts.parkCodes = [...(opts.parkCodes ?? DEFAULT_NPS_PARK_CODES)];
    }
    logger.info({ source: id, opts: ingestOpts }, "materialize: ingesting");
    try {
      const result = await SOURCE_INGESTERS[id](ingestOpts);
      results[id] = result;
      logger.info({ source: id, result }, "materialize: ingest complete");
    } catch (err) {
      logger.error({ err, source: id }, "materialize: ingest failed");
      throw err;
    }
  }
  return results;
}

async function runRematerialize(dryRun: boolean): Promise<RematerializeReport> {
  if (dryRun) {
    logger.info("materialize: --dry-run --rematerialize → skipping destructive RPC");
    return { source_record_unlinked: 0, place_match_deleted: 0, master_place_deleted: 0 };
  }
  const db = getDb();
  const { data, error } = await db.rpc("materialize_clear_resolution_state");
  if (error) {
    logger.error({ err: error }, "materialize: rematerialize RPC failed");
    throw error;
  }
  const report = data as RematerializeReport;
  logger.info(report, "materialize: rematerialize complete");
  return report;
}

/**
 * Find source_records that ER has never seen — `master_place_id IS NULL`
 * AND no existing `place_match` row. After a clean --rematerialize this
 * is the entire corpus. On a bare re-run over an already-resolved
 * corpus this is empty (every unresolved record is already pending in
 * place_match). On a re-run after an incremental ingest, this is the
 * newly-added source_records only.
 */
async function findTrulyUnresolvedIds(rematerializeJustRan: boolean): Promise<string[]> {
  const db = getDb();
  if (rematerializeJustRan) {
    // After --rematerialize, all source_records are unlinked and
    // place_match is empty. Skip the NOT EXISTS check — empty by design.
    const { data, error } = await db.from("source_record").select("id");
    if (error) throw error;
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  // Records with no master_place_id AND no row in place_match. PostgREST
  // doesn't support NOT EXISTS subqueries cleanly, so do the diff in TS.
  const [{ data: srData, error: srErr }, { data: pmData, error: pmErr }] = await Promise.all([
    db.from("source_record").select("id").is("master_place_id", null),
    db.from("place_match").select("source_record_id"),
  ]);
  if (srErr) throw srErr;
  if (pmErr) throw pmErr;
  const seenInPlaceMatch = new Set<string>(
    ((pmData ?? []) as { source_record_id: string }[]).map((r) => r.source_record_id),
  );
  return ((srData ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !seenInPlaceMatch.has(id));
}

async function runResolution(rematerializeJustRan: boolean, dryRun: boolean): Promise<ApplyResult> {
  const trulyUnresolvedIds = await findTrulyUnresolvedIds(rematerializeJustRan);
  if (trulyUnresolvedIds.length === 0) {
    logger.info(
      "materialize: ER skipped — no truly-unresolved source_records (every record is " +
        "either already linked or already pending in place_match). Use --rematerialize for a clean rebuild.",
    );
    return { new_master_places: 0, auto_linked: 0, amenity_rolled_up: 0, manual_review_queued: 0, errors: [] };
  }
  logger.info(
    { unresolved: trulyUnresolvedIds.length },
    rematerializeJustRan
      ? "materialize: ER over full corpus (rematerialize)"
      : "materialize: ER over truly-new source_records (incremental)",
  );

  if (dryRun) {
    logger.info("materialize: --dry-run → matching but not applying");
    const outcomes = await matchAll(trulyUnresolvedIds);
    return {
      new_master_places: outcomes.filter((o) => o.kind === "new_master_place").length,
      auto_linked: outcomes.filter((o) => o.kind === "auto_link").length,
      amenity_rolled_up: outcomes.filter((o) => o.kind === "amenity_rollup").length,
      manual_review_queued: outcomes.filter((o) => o.kind === "manual_review").length,
      errors: [],
    };
  }
  const outcomes = await matchAll(trulyUnresolvedIds);
  return await applyMatches(outcomes);
}

async function runSyncStage(dryRun: boolean, skipPrune: boolean): Promise<SyncResult> {
  if (dryRun) {
    logger.info("materialize: --dry-run → skipping Typesense sync");
    return {
      fetched: 0,
      indexed: 0,
      failed: 0,
      pruned: 0,
      prune_errors: 0,
      collection_created: false,
      duration_ms: 0,
    };
  }
  return await runSync({ skipPrune });
}

async function countSourceRecords(): Promise<SourceRecordCounts> {
  const db = getDb();
  const { data, error } = await db.from("source_record").select("source_id");
  if (error) throw error;
  const rows = (data ?? []) as { source_id: string }[];
  const by_source: Record<string, number> = {};
  for (const row of rows) {
    by_source[row.source_id] = (by_source[row.source_id] ?? 0) + 1;
  }
  return { total: rows.length, by_source };
}

// ──────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────

export async function materialize(opts: MaterializeOptions): Promise<MaterializeReport> {
  const startedAt = Date.now();
  const stagesRun: string[] = [];

  let ingestResults: Record<string, IngestResult> | null = null;
  if (opts.ingest) {
    stagesRun.push("ingest");
    ingestResults = await runIngest(opts);
  }

  let rematerializeReport: RematerializeReport | null = null;
  if (opts.rematerialize) {
    stagesRun.push("rematerialize");
    rematerializeReport = await runRematerialize(opts.dryRun);
  }

  // Source-record counts AFTER ingest + rematerialize, BEFORE ER —
  // so the report reflects the corpus ER is about to process.
  const sourceCounts = await countSourceRecords();
  logger.info(sourceCounts, "materialize: source_record counts");

  let erResult: ApplyResult | null = null;
  if (!opts.skipEr) {
    stagesRun.push("er");
    erResult = await runResolution(opts.rematerialize, opts.dryRun);
    logger.info(erResult, "materialize: ER complete");
  }

  let syncResult: SyncResult | null = null;
  if (!opts.skipSync) {
    stagesRun.push("sync");
    syncResult = await runSyncStage(opts.dryRun, opts.skipPrune);
    logger.info(syncResult, "materialize: sync complete");
  }

  return {
    stages_run: stagesRun,
    ingest: ingestResults,
    rematerialize: rematerializeReport,
    source_records: sourceCounts,
    er: erResult,
    sync: syncResult,
    duration_ms: Date.now() - startedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────

function parseSources(value: string): readonly SourceId[] {
  const ids = value.split(",").map((s) => s.trim());
  for (const id of ids) {
    if (!SOURCE_IDS.includes(id as SourceId)) {
      throw new InvalidArgumentError(`unknown source '${id}'. Valid: ${SOURCE_IDS.join(", ")}`);
    }
  }
  return ids as readonly SourceId[];
}

function parseBbox(value: string): BoundingBox {
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new InvalidArgumentError("bbox must be W,S,E,N as four numbers");
  }
  return parts as BoundingBox;
}

function parseParkCodes(value: string): readonly string[] {
  return value.split(",").map((s) => s.trim().toLowerCase());
}

interface CliOpts {
  ingest?: boolean;
  sources?: readonly SourceId[];
  bbox?: BoundingBox;
  parkCodes?: readonly string[];
  skipEr?: boolean;
  skipSync?: boolean;
  skipPrune?: boolean;
  dryRun?: boolean;
  rematerialize?: boolean;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Command();
  program
    .name("materialize")
    .description("Phase 2.5 orchestrator — optional ingest → ER → Typesense sync.")
    .option("--ingest", "Run source ingestion first (default: assume source_record populated)")
    .option("--sources <list>", "Comma-separated subset (osm,ridb,nps,google). Default all.", parseSources)
    .option("--bbox <W,S,E,N>", "Restrict ingest to bbox. Default: each source's default.", parseBbox)
    .option("--park-codes <list>", "NPS park codes (default: jotr).", parseParkCodes)
    .option("--skip-er", "Skip entity resolution (just re-sync existing master_place).")
    .option("--skip-sync", "Skip Typesense sync (just rebuild master_place).")
    .option("--skip-prune", "Sync but don't prune stale Typesense docs.")
    .option("--dry-run", "Report what would happen, mutate nothing.")
    .option("--rematerialize", "DESTRUCTIVE: clear master_place + place_match before ER. Required for deterministic rebuilds.")
    .action(async (cli: CliOpts) => {
      const opts: MaterializeOptions = {
        ingest: cli.ingest ?? false,
        sources: cli.sources ?? SOURCE_IDS,
        bbox: cli.bbox ?? null,
        parkCodes: cli.parkCodes ?? null,
        skipEr: cli.skipEr ?? false,
        skipSync: cli.skipSync ?? false,
        skipPrune: cli.skipPrune ?? false,
        dryRun: cli.dryRun ?? false,
        rematerialize: cli.rematerialize ?? false,
      };
      try {
        const report = await materialize(opts);
        logger.info(report, "materialize: complete");
        // Surface a concise success/failure exit code.
        const erErrors = report.er?.errors.length ?? 0;
        const syncErrors = (report.sync?.failed ?? 0) + (report.sync?.prune_errors ?? 0);
        process.exit(erErrors + syncErrors > 0 ? 1 : 0);
      } catch (err) {
        logger.error({ err }, "materialize: fatal");
        process.exit(1);
      }
    });

  program.parseAsync(process.argv);
}
