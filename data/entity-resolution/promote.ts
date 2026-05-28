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
 * Apply a batch of MatchOutcomes. Returns the per-kind counts plus any
 * errors that fired during application or recompute.
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

  const db = getDb();
  const { data, error } = await db.rpc("apply_match_outcomes", {
    p_outcomes: outcomes,
  });
  if (error) {
    logger.error({ err: error }, "promote: apply_match_outcomes RPC failed");
    throw error;
  }

  const result = data as ApplyResult;
  logger.info(
    {
      auto_linked: result.auto_linked,
      amenity_rolled_up: result.amenity_rolled_up,
      manual_review_queued: result.manual_review_queued,
      new_master_places: result.new_master_places,
      error_count: result.errors?.length ?? 0,
    },
    "promote: applyMatches complete",
  );
  if (result.errors && result.errors.length > 0) {
    for (const e of result.errors) {
      logger.warn(e, "promote: per-outcome error");
    }
  }
  return result;
}
