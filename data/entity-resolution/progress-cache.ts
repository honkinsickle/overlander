/**
 * Incremental checkpoint for in-flight matchAll runs.
 *
 * matchAll over a corridor-scale corpus (15K+ records, ~85 min) lost
 * all progress when interrupted because outcomes were only persisted
 * at end-of-run. This module writes progress every N records so a
 * resumed run skips already-processed records instead of replaying
 * them.
 *
 * Distinct from outcome-cache: outcome cache marks a SUCCESSFUL
 * matchAll's output for applyMatches re-runs. Progress cache marks
 * an IN-FLIGHT matchAll's partial output for a future matchAll
 * resume. On clean matchAll completion the progress file is unlinked
 * — outcome-cache becomes the durable record.
 *
 * Storage: `data/.cache/matchall-progress.json` (gitignored).
 * Override path via `MATCHALL_PROGRESS_CACHE_PATH`.
 *
 * Atomic writes: every save writes a sibling `.tmp` file then renames
 * over the destination so an interrupt during write can't leave a
 * truncated JSON.
 *
 * Pure I/O: this module does not call the DB. Caller computes the
 * corpus fingerprint and passes it in. Keeps the module unit-testable
 * without a live Supabase connection.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../ingestion/lib/logger.ts";
import type { CorpusFingerprint } from "./outcome-cache.ts";
import type { MatchOutcome } from "./matcher.ts";

const DEFAULT_REL_PATH = ".cache/matchall-progress.json";

interface ProgressEntry {
  fingerprint: CorpusFingerprint;
  saved_at: string;
  completed_count: number;
  outcomes: MatchOutcome[];
}

function resolveDataRel(rel: string): string {
  // entity-resolution → data → root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", rel);
}

function progressPath(): string {
  const env = process.env.MATCHALL_PROGRESS_CACHE_PATH;
  if (env && isAbsolute(env)) return env;
  if (env) return resolveDataRel(env);
  return resolveDataRel(DEFAULT_REL_PATH);
}

function fingerprintsMatch(
  a: CorpusFingerprint,
  b: CorpusFingerprint,
): boolean {
  return (
    a.source_record_count === b.source_record_count &&
    a.source_record_max_updated_at === b.source_record_max_updated_at
  );
}

/**
 * Load checkpoint outcomes if the on-disk fingerprint matches the
 * passed-in current fingerprint. Returns null when there's no
 * checkpoint, the file is unreadable, or the fingerprint mismatches.
 */
export function loadProgress(
  current: CorpusFingerprint,
): MatchOutcome[] | null {
  const path = progressPath();
  if (!existsSync(path)) return null;

  let entry: ProgressEntry;
  try {
    entry = JSON.parse(readFileSync(path, "utf8")) as ProgressEntry;
  } catch (err) {
    logger.warn({ err, path }, "progress-cache: unreadable — ignoring");
    return null;
  }

  if (!fingerprintsMatch(entry.fingerprint, current)) {
    logger.info(
      { cached: entry.fingerprint, current },
      "progress-cache: stale (corpus changed) — ignoring",
    );
    return null;
  }
  logger.info(
    {
      path,
      saved_at: entry.saved_at,
      completed_count: entry.completed_count,
    },
    "progress-cache: resume from checkpoint",
  );
  return entry.outcomes;
}

/**
 * Persist current outcomes atomically. Writes a sibling `.tmp` then
 * renames over the destination so an interrupt mid-write can't leave
 * a truncated JSON.
 *
 * Errors are logged but not thrown — losing a single checkpoint is
 * recoverable (the next checkpoint or the next resume falls back to
 * the prior good file). Failing the whole matchAll on disk hiccups
 * is not.
 */
export function saveProgress(
  outcomes: MatchOutcome[],
  fingerprint: CorpusFingerprint,
): void {
  const path = progressPath();
  const entry: ProgressEntry = {
    fingerprint,
    saved_at: new Date().toISOString(),
    completed_count: outcomes.length,
    outcomes,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, path);
  } catch (err) {
    logger.warn(
      { err, path, completed_count: outcomes.length },
      "progress-cache: save failed — continuing without checkpoint",
    );
  }
}

/**
 * Delete the checkpoint file. Called on clean matchAll completion;
 * outcome-cache becomes the durable record of a successful run.
 * No-op when the file is already absent.
 */
export function clearProgress(): void {
  const path = progressPath();
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    logger.warn({ err, path }, "progress-cache: unlink failed");
  }
}
