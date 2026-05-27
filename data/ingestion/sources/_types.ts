/**
 * Shared types for all source ingesters.
 *
 * Every source in /ingestion/sources exports a default async function
 * matching `IngestFn`.
 */

import type { BoundingBox } from "../lib/geometry.ts";

export interface IngestOptions {
  /** If omitted, uses the active corridor from ingestion_corridor. */
  corridorId?: string;
  /** Manual bbox override. Bypasses the corridor lookup. Useful for smoke tests. */
  bbox?: BoundingBox;
  /** For incremental ingestion. Not used by all sources. */
  sinceTimestamp?: Date;
  /** Validate + log but do not write to source_record. */
  dryRun?: boolean;
  /** NPS-specific: which park codes to query (e.g. ["jotr"]). NPS API is parkCode-driven. */
  parkCodes?: string[];
}

export interface IngestResult {
  source_id: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  duration_ms: number;
}

export type IngestFn = (opts: IngestOptions) => Promise<IngestResult>;
