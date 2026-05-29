/**
 * matchAll perf profiler — env-gated, sampled, off by default.
 *
 * Captures per-substep timings per sampled matchOne call into a JSONL
 * trace file. One line per sampled record. Sampling decision is
 * `record_index % MATCHALL_PROFILE_SAMPLE === 0` (default N=50). Non-
 * sampled records still walk the same code path but emit no I/O —
 * the only added cost is a Map.get + integer modulo.
 *
 * Activation:
 *   MATCHALL_PROFILE=true            enable
 *   MATCHALL_PROFILE_SAMPLE=50       1-in-N sample rate (default 50)
 *   MATCHALL_PROFILE_PATH=...        override trace file location
 *
 * Default trace file: data/.cache/matchall-perf-trace.jsonl
 * (gitignored via the existing data/.cache/ rule).
 *
 * Lifecycle (called by matcher.matchAll):
 *   initProfiler()        once at start; truncates the trace file
 *   startSample(...)      once per record; decides sample-or-not
 *   recordRpc(...)        per findCandidates RPC call
 *   recordSearchPlanned() per searchPlanned call
 *   recordScoring(ms)     per scoring-loop measurement
 *   recordTrack(ms)       per trackOutcomeLink call
 *   recordPlanned(ms)     per recordPlanned call
 *   finishSample(...)     once per record; flushes to disk if sampled
 *   finalizeProfiler()    once at end; emits summary log
 *
 * Module-level mutable state is fine here: matchOne is sequential
 * within matchAll's for-loop (no concurrency), and the profiler is
 * disabled in production. This module is also the only consumer of
 * its own state.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../ingestion/lib/logger.ts";

const DEFAULT_REL_PATH = ".cache/matchall-perf-trace.jsonl";
const DEFAULT_SAMPLE_INTERVAL = 50;

export type RpcVariant = "fed_exact" | "amenity" | "standard";

export interface PerfSample {
  source_record_id: string;
  source_id: string;
  inferred_category: string | null;
  record_index: number;
  /** plannedMasterPlaces.length AT THE START of this matchOne call. */
  planned_size_at_start: number;

  // Per RPC variant — null when that variant wasn't invoked for this record.
  rpc_fed_exact_ms: number | null;
  rpc_fed_exact_db_count: number | null;
  rpc_amenity_ms: number | null;
  rpc_amenity_db_count: number | null;
  rpc_standard_ms: number | null;
  rpc_standard_db_count: number | null;

  // searchPlanned can fire 1–3× per matchOne (once per findCandidates call
  // that finds plannedMasterPlaces.length > 0). Aggregated.
  search_planned_total_ms: number;
  search_planned_total_candidates: number;
  search_planned_calls: number;

  scoring_ms: number;
  track_outcome_link_ms: number;
  record_planned_ms: number;

  outcome_kind: string;
  total_ms: number;
}

let enabled = false;
let traceFile: string | null = null;
let sampleInterval = DEFAULT_SAMPLE_INTERVAL;
let samplesWritten = 0;
let current: PerfSample | null = null;

function resolveDataRel(rel: string): string {
  // entity-resolution → data → root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", rel);
}

/**
 * Read env, set up the trace file, truncate any prior trace. Called once
 * at the start of each matchAll run. Idempotent across runs.
 */
export function initProfiler(): void {
  enabled =
    process.env.MATCHALL_PROFILE === "true" || process.env.MATCHALL_PROFILE === "1";
  current = null;
  samplesWritten = 0;
  if (!enabled) {
    traceFile = null;
    return;
  }

  const envPath = process.env.MATCHALL_PROFILE_PATH;
  if (envPath && isAbsolute(envPath)) traceFile = envPath;
  else if (envPath) traceFile = resolveDataRel(envPath);
  else traceFile = resolveDataRel(DEFAULT_REL_PATH);

  const envSample = process.env.MATCHALL_PROFILE_SAMPLE;
  if (envSample) {
    const n = Number.parseInt(envSample, 10);
    if (Number.isFinite(n) && n > 0) sampleInterval = n;
    else sampleInterval = DEFAULT_SAMPLE_INTERVAL;
  } else {
    sampleInterval = DEFAULT_SAMPLE_INTERVAL;
  }

  mkdirSync(dirname(traceFile), { recursive: true });
  writeFileSync(traceFile, ""); // truncate

  logger.info(
    { trace_path: traceFile, sample_interval: sampleInterval },
    "profiler: enabled — sampling matchAll",
  );
}

export function isProfilerEnabled(): boolean {
  return enabled;
}

/**
 * Open a per-record sample. If `record_index` doesn't hit the sample
 * cadence, this leaves `current` null and subsequent `record*` calls
 * are cheap no-ops.
 */
export function startSample(
  srId: string,
  sourceId: string,
  category: string | null,
  recordIndex: number,
  plannedSize: number,
): void {
  if (!enabled) return;
  if (recordIndex % sampleInterval !== 0) {
    current = null;
    return;
  }
  current = {
    source_record_id: srId,
    source_id: sourceId,
    inferred_category: category,
    record_index: recordIndex,
    planned_size_at_start: plannedSize,
    rpc_fed_exact_ms: null,
    rpc_fed_exact_db_count: null,
    rpc_amenity_ms: null,
    rpc_amenity_db_count: null,
    rpc_standard_ms: null,
    rpc_standard_db_count: null,
    search_planned_total_ms: 0,
    search_planned_total_candidates: 0,
    search_planned_calls: 0,
    scoring_ms: 0,
    track_outcome_link_ms: 0,
    record_planned_ms: 0,
    outcome_kind: "pending",
    total_ms: 0,
  };
}

export function recordRpc(
  variant: RpcVariant,
  durationMs: number,
  dbCount: number,
): void {
  if (!current) return;
  if (variant === "fed_exact") {
    current.rpc_fed_exact_ms = durationMs;
    current.rpc_fed_exact_db_count = dbCount;
  } else if (variant === "amenity") {
    current.rpc_amenity_ms = durationMs;
    current.rpc_amenity_db_count = dbCount;
  } else {
    current.rpc_standard_ms = durationMs;
    current.rpc_standard_db_count = dbCount;
  }
}

export function recordSearchPlanned(
  durationMs: number,
  candidateCount: number,
): void {
  if (!current) return;
  current.search_planned_total_ms += durationMs;
  current.search_planned_total_candidates += candidateCount;
  current.search_planned_calls += 1;
}

export function recordScoring(durationMs: number): void {
  if (!current) return;
  current.scoring_ms += durationMs;
}

export function recordTrack(durationMs: number): void {
  if (!current) return;
  current.track_outcome_link_ms += durationMs;
}

export function recordPlannedTiming(durationMs: number): void {
  if (!current) return;
  current.record_planned_ms += durationMs;
}

/**
 * Close the per-record sample. If sampled, append one JSON line to the
 * trace file. Errors are swallowed — losing a profile sample is
 * recoverable; failing matchAll on a profile-disk hiccup is not.
 */
export function finishSample(outcomeKind: string, totalMs: number): void {
  if (!current || !traceFile) {
    current = null;
    return;
  }
  current.outcome_kind = outcomeKind;
  current.total_ms = totalMs;
  try {
    appendFileSync(traceFile, JSON.stringify(current) + "\n");
    samplesWritten += 1;
  } catch (err) {
    logger.warn({ err, trace_path: traceFile }, "profiler: append failed");
  }
  current = null;
}

export function finalizeProfiler(): void {
  if (!enabled) return;
  logger.info(
    { samples_written: samplesWritten, trace_path: traceFile },
    "profiler: matchAll complete",
  );
}
