/**
 * Supabase service-role client + thin RPC helpers.
 *
 * Ingestion uses the service-role key, which bypasses RLS. Never expose
 * this client to a browser context.
 *
 * Why no `rawSql` helper: the spec's section 7.2 references a
 * `supabase.rpc('execute_sql', …)` helper that isn't a built-in Supabase
 * RPC. Adding it would require a custom Postgres function with
 * arbitrary-SQL execution, which is a security footgun. Phase 1 ingestion
 * only needs the typed RPCs declared in our migrations (currently
 * `upsert_source_record`, `point_in_active_corridor`), so we expose those
 * directly and avoid the raw-SQL escape hatch.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger.ts";
import { defaultRetry } from "./retry.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

let _client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (_client) return _client;
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "overlander-data-ingestion" } },
  });
  logger.debug({ url }, "supabase client initialized");
  return _client;
}

/**
 * Upsert a normalized record into source_record. Returns the inserted/updated row id.
 */
export interface UpsertSourceRecordArgs {
  sourceId: string;
  externalId: string;
  name: string;
  inferredCategory: string | null;
  /** Either a [lng, lat] tuple or a WKT POINT string. */
  point: [number, number] | string;
  rawPayload: unknown;
  normalizedPayload: unknown;
  sourceQualityScore?: number;
}

export async function upsertSourceRecord(args: UpsertSourceRecordArgs): Promise<string> {
  const db = getDb();
  const geometryWkt =
    typeof args.point === "string"
      ? args.point
      : `SRID=4326;POINT(${args.point[0]} ${args.point[1]})`;

  const { data, error } = await db.rpc("upsert_source_record", {
    p_source_id: args.sourceId,
    p_external_id: args.externalId,
    p_name: args.name,
    p_inferred_category: args.inferredCategory,
    p_geometry: geometryWkt,
    p_raw_payload: args.rawPayload,
    p_normalized_payload: args.normalizedPayload,
    p_source_quality_score: args.sourceQualityScore ?? 0.5,
  });
  if (error) {
    logger.error({ err: error, sourceId: args.sourceId, externalId: args.externalId }, "upsert_source_record failed");
    throw error;
  }
  return data as string;
}

/**
 * Upsert one MVUM route into mvum_roads (Phase 2 PR-C reference data).
 * `geojson` is a MultiLineString GeoJSON geometry (a route's segments
 * aggregated). The RPC stamps SRID 4326 and coerces LineString→MultiLineString.
 * Returns the rte_cn key on success.
 */
export async function upsertMvumRoad(rteCn: string, geojson: unknown): Promise<string> {
  const db = getDb();
  const { data, error } = await db.rpc("upsert_mvum_road", {
    p_rte_cn: rteCn,
    p_geojson: geojson,
  });
  if (error) {
    logger.error({ err: error, rteCn }, "upsert_mvum_road failed");
    throw error;
  }
  return data as string;
}

// ──────────────────────────────────────────────────────────────────────
// Batched, fail-loud writes
// ──────────────────────────────────────────────────────────────────────

/** Split an array into fixed-size chunks. Pure; unit-tested. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk: size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface BatchUpsertOptions {
  /** Target table, e.g. "source_record" or "mvum_roads". */
  table: string;
  /** Rows to upsert (geometry columns serialized to EWKT — see ewkt.ts). */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** PostgREST conflict target, e.g. "source_id,external_id" or "rte_cn". */
  onConflict: string;
  /** Chunk size. Default 500. */
  chunkSize?: number;
  /** Label for logs / errors. */
  label: string;
  /**
   * Retry wrapper. Defaults to defaultRetry (5 retries, 1s→16s backoff).
   * Injectable so tests can pass a no-retry passthrough.
   */
  retry?: <T>(fn: () => Promise<T>, label?: string) => Promise<T>;
  /** Supabase client. Defaults to the shared getDb() client; injectable for tests. */
  db?: SupabaseClient;
}

export interface BatchUpsertResult {
  written: number;
  chunks: number;
}

/**
 * Chunked multi-row upsert with retry-on-transient and FAIL-LOUD semantics.
 *
 * Replaces the one-row-per-call write pattern (which both overwhelmed small
 * instances and, on a transient blip, silently dropped rows via catch-and-
 * continue). Here: each chunk is retried; if a chunk still fails after retries,
 * this THROWS — the caller must exit non-zero rather than continue. On success
 * it asserts `written === rows.length` so a partial write can never look clean.
 */
export async function batchUpsert(opts: BatchUpsertOptions): Promise<BatchUpsertResult> {
  const { table, rows, onConflict, chunkSize = 500, label, retry = defaultRetry } = opts;
  if (rows.length === 0) return { written: 0, chunks: 0 };
  const db = opts.db ?? getDb();
  const chunks = chunk(rows, chunkSize);
  let written = 0;
  for (let i = 0; i < chunks.length; i++) {
    const batch = chunks[i];
    await retry(async () => {
      const { error } = await db.from(table).upsert(batch as Record<string, unknown>[], { onConflict });
      if (error) {
        throw new Error(`${label}: batch ${i + 1}/${chunks.length} upsert failed: ${error.message}`);
      }
    }, `${label}.batch`);
    written += batch.length;
    logger.debug({ label, batch: i + 1, of: chunks.length, written }, "batchUpsert: chunk written");
  }
  if (written !== rows.length) {
    // Unreachable given the throw above, but make a silent shortfall impossible.
    throw new Error(`${label}: wrote ${written} of ${rows.length} prepared rows — count mismatch`);
  }
  return { written, chunks: chunks.length };
}

/**
 * Defense-in-depth: confirm a point is inside an active corridor buffer.
 * Used to drop API rows that came back outside the bbox we asked for.
 */
export async function pointInActiveCorridor(lng: number, lat: number): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.rpc("point_in_active_corridor", { lng, lat });
  if (error) throw error;
  return data === true;
}
