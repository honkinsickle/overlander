/**
 * Persist matchAll outcomes between the match and apply stages.
 *
 * At corridor scale (8K+ source_records) matchAll takes ~35 min while
 * applyMatches dies on a single transaction-timeout. Discarding the
 * outcome array on every apply failure makes retries unacceptably
 * expensive. This module caches the in-memory MatchOutcome[] to disk
 * so a retry can apply the same outcomes without re-matching.
 *
 * Freshness: keyed by a corpus fingerprint over `source_record`
 * (row count + max(updated_at)). Any change to source_record —
 * including `master_place_id` updates from a successful apply, and
 * the unlink-all RPC in rematerialize — moves `updated_at` and
 * invalidates the cache implicitly. No manual delete required.
 *
 * Storage: `data/.cache/matchall-outcomes.json` (gitignored).
 * Override path via `MATCHALL_OUTCOMES_CACHE_PATH`.
 *
 * Usage:
 *
 *   const cached = await loadFreshOutcomeCache();
 *   if (cached) {
 *     outcomes = cached;                       // skip matchAll
 *   } else {
 *     outcomes = await matchAll();
 *     await saveOutcomeCache(outcomes);        // before apply
 *   }
 *   await applyMatches(outcomes);              // retryable
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import type { MatchOutcome } from "./matcher.ts";

const DEFAULT_REL_PATH = ".cache/matchall-outcomes.json";
const EPOCH_ZERO = "0000-01-01T00:00:00Z";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface CorpusFingerprint {
  source_record_count: number;
  source_record_max_updated_at: string;
}

interface OutcomeCacheEntry {
  fingerprint: CorpusFingerprint;
  saved_at: string;
  outcomes: MatchOutcome[];
}

// ──────────────────────────────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────────────────────────────

function resolveDataRel(rel: string): string {
  // entity-resolution → data → root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", rel);
}

function cachePath(): string {
  const env = process.env.MATCHALL_OUTCOMES_CACHE_PATH;
  if (env && isAbsolute(env)) return env;
  if (env) return resolveDataRel(env);
  return resolveDataRel(DEFAULT_REL_PATH);
}

// ──────────────────────────────────────────────────────────────────────
// Fingerprint
// ──────────────────────────────────────────────────────────────────────

export async function computeCorpusFingerprint(): Promise<CorpusFingerprint> {
  const db = getDb();
  const { count, error: countErr } = await db
    .from("source_record")
    .select("id", { count: "exact", head: true });
  if (countErr) throw countErr;
  const { data, error: updErr } = await db
    .from("source_record")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (updErr) throw updErr;
  const row = data as { updated_at?: string } | null;
  return {
    source_record_count: count ?? 0,
    source_record_max_updated_at: row?.updated_at ?? EPOCH_ZERO,
  };
}

function fingerprintsMatch(a: CorpusFingerprint, b: CorpusFingerprint): boolean {
  return (
    a.source_record_count === b.source_record_count &&
    a.source_record_max_updated_at === b.source_record_max_updated_at
  );
}

// ──────────────────────────────────────────────────────────────────────
// Load + save
// ──────────────────────────────────────────────────────────────────────

/**
 * Load cached outcomes if they match the current corpus fingerprint.
 * Returns null when there's no cache, the file is unreadable, or the
 * fingerprint indicates the corpus has changed since the save.
 */
export async function loadFreshOutcomeCache(): Promise<MatchOutcome[] | null> {
  const path = cachePath();
  if (!existsSync(path)) return null;

  let entry: OutcomeCacheEntry;
  try {
    const raw = readFileSync(path, "utf8");
    entry = JSON.parse(raw) as OutcomeCacheEntry;
  } catch (err) {
    logger.warn({ err, path }, "outcome-cache: unreadable — ignoring");
    return null;
  }

  const fresh = await computeCorpusFingerprint();
  if (!fingerprintsMatch(entry.fingerprint, fresh)) {
    logger.info(
      { cached: entry.fingerprint, current: fresh },
      "outcome-cache: stale (corpus changed) — ignoring",
    );
    return null;
  }
  logger.info(
    {
      path,
      saved_at: entry.saved_at,
      outcomeCount: entry.outcomes.length,
      fingerprint: entry.fingerprint,
    },
    "outcome-cache: hit — reusing cached matchAll output",
  );
  return entry.outcomes;
}

/**
 * Persist matchAll outcomes for re-apply on retry. Captures the corpus
 * fingerprint at the moment of save; the next load compares against
 * the live fingerprint to decide freshness.
 */
export async function saveOutcomeCache(outcomes: MatchOutcome[]): Promise<void> {
  const path = cachePath();
  const fingerprint = await computeCorpusFingerprint();
  const entry: OutcomeCacheEntry = {
    fingerprint,
    saved_at: new Date().toISOString(),
    outcomes,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry));
  logger.info(
    { path, outcomeCount: outcomes.length, fingerprint },
    "outcome-cache: saved",
  );
}
