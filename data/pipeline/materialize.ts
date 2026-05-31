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
import parksCanadaIngest from "../ingestion/sources/parks-canada.ts";
import bcParksIngest from "../ingestion/sources/bc-parks.ts";
import type { IngestFn, IngestOptions, IngestResult } from "../ingestion/sources/_types.ts";
import type { BoundingBox } from "../ingestion/lib/geometry.ts";
import { matchAll, type MatchOutcome } from "../entity-resolution/matcher.ts";
import {
  loadFreshOutcomeCache,
  loadOutcomeCacheBypassingFingerprint,
  saveOutcomeCache,
} from "../entity-resolution/outcome-cache.ts";
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
  parks_canada: parksCanadaIngest,
  bc_parks: bcParksIngest,
};

const SOURCE_IDS = ["osm", "ridb", "nps", "google", "parks_canada", "bc_parks"] as const;
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
  /**
   * RECOVERY ONLY. With `--rematerialize`, load `matchall-outcomes.json`
   * WITHOUT verifying its corpus fingerprint. Use when a prior matchAll
   * completed cleanly and persisted outcomes, but applyMatches died
   * partway through — the cache outcomes still describe the same logical
   * corpus, even though the fingerprint has drifted via the partial
   * mutations + a subsequent clear. Misuse can corrupt master_place
   * state; the loader emits a warn log at every invocation.
   */
  skipFingerprintCheck: boolean;
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
 * Drain a PostgREST query that may return more than the 1000-row default
 * cap. Caller supplies a builder so .range() can be applied per page on a
 * fresh query each iteration.
 *
 * Surfaced at corridor scale: at JT (~219 records) the default cap was
 * invisible; at Segment A (~8K records) it silently truncated to 1000.
 */
async function paginatedSelect<T>(
  buildQuery: () => { range: (from: number, to: number) => unknown },
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const promise = buildQuery().range(offset, offset + PAGE - 1) as unknown as Promise<{
      data: T[] | null;
      error: { message?: string } | null;
    }>;
    const { data, error } = await promise;
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/**
 * Find source_records that ER has never seen — `master_place_id IS NULL`
 * AND no existing `place_match` row. Used only in incremental mode (no
 * --rematerialize). On a re-run over an already-resolved corpus this is
 * empty. On a re-run after an incremental ingest, this is just the
 * newly-added source_records.
 *
 * Rematerialize mode skips this function entirely — every source_record
 * is unresolved by construction, and matchAll() drives its own
 * server-side full-corpus query.
 */
async function findTrulyUnresolvedIds(): Promise<string[]> {
  const db = getDb();
  const [srRows, pmRows] = await Promise.all([
    paginatedSelect<{ id: string }>(() =>
      db.from("source_record").select("id").is("master_place_id", null).order("id"),
    ),
    paginatedSelect<{ source_record_id: string }>(() =>
      db.from("place_match").select("source_record_id").order("source_record_id"),
    ),
  ]);
  const seenInPlaceMatch = new Set<string>(pmRows.map((r) => r.source_record_id));
  return srRows.map((r) => r.id).filter((id) => !seenInPlaceMatch.has(id));
}

async function runResolution(
  rematerializeJustRan: boolean,
  dryRun: boolean,
  skipFingerprintCheck: boolean,
): Promise<ApplyResult> {
  // After --rematerialize, every source_record is unresolved by
  // construction; call matchAll() with no IDs so it runs its own
  // server-side query. Passing an explicit ID list at corridor scale
  // sends ~35KB+ of UUIDs through .in("id", [...]) and PostgREST
  // returns 400 Bad Request because the URL exceeds the URL-length cap.
  let outcomes: MatchOutcome[];
  if (rematerializeJustRan) {
    // Try the outcome cache first — at corridor scale matchAll takes
    // ~35 min and we don't want to re-pay that on an applyMatches
    // retry. The cache is fingerprinted against the source_record
    // corpus, so any source_record mutation (including a successful
    // apply's master_place_id writes) invalidates it implicitly.
    //
    // --skip-fingerprint-check enables the bypassing loader, for
    // recovery after a partial apply + clear sequence where the
    // outcomes are semantically valid but the fingerprint has drifted.
    let cached: MatchOutcome[] | null = null;
    if (!dryRun) {
      if (skipFingerprintCheck) {
        logger.warn(
          "materialize: --skip-fingerprint-check active — recovery mode",
        );
        cached = await loadOutcomeCacheBypassingFingerprint();
      } else {
        cached = await loadFreshOutcomeCache();
      }
    }
    if (cached) {
      outcomes = cached;
    } else {
      logger.info("materialize: ER over full corpus (rematerialize)");
      outcomes = await matchAll();
      if (!dryRun) await saveOutcomeCache(outcomes);
    }
  } else {
    const trulyUnresolvedIds = await findTrulyUnresolvedIds();
    if (trulyUnresolvedIds.length === 0) {
      logger.info(
        "materialize: ER skipped — no truly-unresolved source_records (every record is " +
          "either already linked or already pending in place_match). Use --rematerialize for a clean rebuild.",
      );
      return { new_master_places: 0, auto_linked: 0, amenity_rolled_up: 0, manual_review_queued: 0, errors: [] };
    }
    logger.info(
      { unresolved: trulyUnresolvedIds.length },
      "materialize: ER over truly-new source_records (incremental)",
    );
    outcomes = await matchAll(trulyUnresolvedIds);
  }

  if (dryRun) {
    logger.info("materialize: --dry-run → matching but not applying");
    return {
      new_master_places: outcomes.filter((o) => o.kind === "new_master_place").length,
      auto_linked: outcomes.filter((o) => o.kind === "auto_link").length,
      amenity_rolled_up: outcomes.filter((o) => o.kind === "amenity_rollup").length,
      manual_review_queued: outcomes.filter((o) => o.kind === "manual_review").length,
      errors: [],
    };
  }
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
  // Per-source COUNT(*) head queries avoid PostgREST's 1000-row default cap.
  // The previous .select("source_id") form silently truncated at corridor
  // scale; this returns true counts.
  const db = getDb();
  const by_source: Record<string, number> = {};
  let total = 0;
  for (const id of SOURCE_IDS) {
    const { count, error } = await db
      .from("source_record")
      .select("id", { count: "exact", head: true })
      .eq("source_id", id);
    if (error) throw error;
    const n = count ?? 0;
    by_source[id] = n;
    total += n;
  }
  return { total, by_source };
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
    erResult = await runResolution(opts.rematerialize, opts.dryRun, opts.skipFingerprintCheck);
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
  skipFingerprintCheck?: boolean;
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
    .option(
      "--skip-fingerprint-check",
      "RECOVERY ONLY (with --rematerialize): load matchall-outcomes.json without verifying corpus fingerprint. Use when resuming from a partial-apply failure via clear + re-apply.",
    )
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
        skipFingerprintCheck: cli.skipFingerprintCheck ?? false,
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
