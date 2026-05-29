/**
 * Phase 3a deliverable 3 — match application layer.
 *
 * Takes the MatchOutcome array emitted by matcher.ts and applies it to
 * the database transactionally. The actual application logic lives in
 * the SQL function `apply_match_outcomes(jsonb)` (see
 * supabase/migrations/20260527130300_phase3a_apply_match_outcomes.sql);
 * this file is a thin TypeScript wrapper.
 *
 * Separation of concerns (per phase-3a-build-spec.md §6):
 *
 *   matcher.ts  — decides
 *   promote.ts  — applies
 *   recompute_master_place (SQL) — transforms (called by promote)
 *
 * The matcher emits outcomes purely as data; promote serializes them
 * into a JSONB array and ships them to the DB function. All four
 * outcome shapes (auto_link, amenity_rollup, manual_review,
 * new_master_place) are handled in one Postgres transaction:
 *
 *   - new_master_place    → INSERT master_place + UPDATE source_record + INSERT place_match
 *   - auto_link           → UPDATE source_record + INSERT place_match (status='confirmed')
 *   - amenity_rollup      → UPDATE source_record + INSERT place_match (match_method='amenity_rollup')
 *   - manual_review       → INSERT place_match (status='pending', source_record stays unlinked)
 *
 * After mutations, `apply_match_outcomes` deduplicates the recompute
 * queue and calls `recompute_master_place(id)` on each affected
 * master_place. Per-outcome errors are caught individually (a single
 * bad row doesn't roll back the whole batch) and returned via the
 * `errors` array on ApplyResult.
 *
 * Run via test suite or ad-hoc tsx:
 *   const outcomes = await matchAll();
 *   const result = await applyMatches(outcomes);
 */

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import type { MatchOutcome } from "./matcher.ts";

export interface ApplyResultError {
  source_record_id?: string;
  master_place_id?: string;
  target?: string;
  kind?: string;
  phase: "apply" | "recompute";
  error: string;
}

export interface ApplyResult {
  auto_linked: number;
  amenity_rolled_up: number;
  manual_review_queued: number;
  new_master_places: number;
  errors: ApplyResultError[];
}

/**
 * Default outcome-batch size for the apply_match_outcomes RPC. Each
 * batch is its own transaction; bounding it bounds the per-RPC work
 * (especially the recompute_master_place cascade, which is the
 * dominant cost).
 *
 * Calibration: at corridor scale, an 8,428-outcome single call hit
 * Postgres statement_timeout (~10 s). 500/batch keeps each call's
 * recompute cascade comfortably under that ceiling. Drop via
 * ER_APPLY_BATCH_SIZE if a particular corpus shape (e.g. all
 * new_master_place outcomes with heavy amenity rollups) still
 * stresses the timeout.
 */
const DEFAULT_BATCH_SIZE = 500;

function parseBatchSize(): number {
  const env = process.env.ER_APPLY_BATCH_SIZE;
  if (!env) return DEFAULT_BATCH_SIZE;
  const n = parseInt(env, 10);
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn(
      { env, fallback: DEFAULT_BATCH_SIZE },
      "promote: invalid ER_APPLY_BATCH_SIZE — using default",
    );
    return DEFAULT_BATCH_SIZE;
  }
  return n;
}

/**
 * Apply a batch of MatchOutcomes. Chunks into per-RPC sub-batches to
 * bound each transaction's work — at corridor scale (~8K outcomes) a
 * single-call payload would time out on the recompute cascade. Each
 * sub-batch is independently committed: if RPC N succeeds and N+1
 * throws, sub-batches 1..N persist and the saved outcome cache makes
 * a clean re-apply possible from the start.
 *
 * Returns the per-kind counts summed across sub-batches plus any
 * per-outcome errors the RPC surfaced.
 *
 * Empty input returns zero counts and no errors — safe to call on a
 * filtered subset where nothing matched.
 */
export async function applyMatches(outcomes: MatchOutcome[]): Promise<ApplyResult> {
  if (outcomes.length === 0) {
    return {
      auto_linked: 0,
      amenity_rolled_up: 0,
      manual_review_queued: 0,
      new_master_places: 0,
      errors: [],
    };
  }

  const batchSize = parseBatchSize();
  const totalBatches = Math.ceil(outcomes.length / batchSize);
  const db = getDb();

  const totals: ApplyResult = {
    auto_linked: 0,
    amenity_rolled_up: 0,
    manual_review_queued: 0,
    new_master_places: 0,
    errors: [],
  };

  for (let offset = 0; offset < outcomes.length; offset += batchSize) {
    const batch = outcomes.slice(offset, offset + batchSize);
    const batchIdx = Math.floor(offset / batchSize) + 1;
    logger.info(
      { batch: batchIdx, of: totalBatches, size: batch.length, offset },
      "promote: applying batch",
    );

    const { data, error } = await db.rpc("apply_match_outcomes", {
      p_outcomes: batch,
    });
    if (error) {
      logger.error(
        { err: error, batchIndex: batchIdx, batchSize: batch.length, completedOutcomes: offset },
        "promote: apply_match_outcomes RPC failed (partial progress retained)",
      );
      throw error;
    }
    const result = data as ApplyResult;
    totals.auto_linked += result.auto_linked;
    totals.amenity_rolled_up += result.amenity_rolled_up;
    totals.manual_review_queued += result.manual_review_queued;
    totals.new_master_places += result.new_master_places;
    if (result.errors && result.errors.length > 0) {
      totals.errors.push(...result.errors);
    }
  }

  logger.info(
    {
      auto_linked: totals.auto_linked,
      amenity_rolled_up: totals.amenity_rolled_up,
      manual_review_queued: totals.manual_review_queued,
      new_master_places: totals.new_master_places,
      error_count: totals.errors.length,
      total_batches: totalBatches,
      batch_size: batchSize,
    },
    "promote: applyMatches complete (batched)",
  );
  if (totals.errors.length > 0) {
    for (const e of totals.errors) {
      logger.warn(e, "promote: per-outcome error");
    }
  }
  return totals;
}
