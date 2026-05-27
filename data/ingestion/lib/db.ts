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
 * Defense-in-depth: confirm a point is inside an active corridor buffer.
 * Used to drop API rows that came back outside the bbox we asked for.
 */
export async function pointInActiveCorridor(lng: number, lat: number): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.rpc("point_in_active_corridor", { lng, lat });
  if (error) throw error;
  return data === true;
}
