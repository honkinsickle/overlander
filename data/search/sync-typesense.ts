/**
 * Sync master_places → Typesense `places` collection.
 *
 * Phase 2 search slice (spec §4). Reads all master_place rows via the
 * `master_place_search_export` view (which splits the PostGIS geometry
 * into lng/lat doubles), transforms each row to the Typesense document
 * shape, creates the `places` collection if it doesn't exist, and upserts
 * documents in batches.
 *
 * Idempotent: re-runnable. Documents upsert by id (= master_place.id), so
 * re-running with current data replaces existing docs. Stale docs
 * (master_places deleted upstream) are NOT cleaned up by this script —
 * follow-up concern.
 *
 * Corridor-scale ready: paginates the Supabase read in 1000-row windows
 * and batches Typesense imports in 100-doc chunks.
 *
 * Required env (loaded via tsx --env-file=.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TYPESENSE_HOST, TYPESENSE_PORT, TYPESENSE_PROTOCOL, TYPESENSE_ADMIN_API_KEY
 *
 * Run via CLI:
 *   npm run -w data search:sync
 */

import Typesense from "typesense";
import type { CollectionCreateSchema, CollectionFieldSchema } from "typesense/lib/Typesense/Collections";
import type { ImportResponse } from "typesense/lib/Typesense/Documents";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const COLLECTION_NAME = "places";
const SUPABASE_PAGE_SIZE = 1000;
const TYPESENSE_BATCH_SIZE = 100;

/**
 * Overlander tags that indicate a federally-managed place. Used to derive
 * the `is_federal` document field for filtered search.
 */
const FEDERAL_TAGS = new Set(["federal_land", "nps", "blm", "usfs", "usace"]);

/**
 * Amenities JSONB key → derived boolean field on the document. Keys come
 * from RIDB/NPS normalizers; values are booleans or other truthy/falsy
 * scalars. `null` amenities (most rows) means we don't know — the
 * derived field is left unset, not false.
 */
const AMENITY_DERIVATIONS = {
  has_water: "potableWater",
  has_dump_station: "dumpStation",
} as const;

// ──────────────────────────────────────────────────────────────────────
// Collection schema
// ──────────────────────────────────────────────────────────────────────

const SCHEMA: CollectionCreateSchema = {
  name: COLLECTION_NAME,
  fields: [
    { name: "id", type: "string" },
    { name: "canonical_name", type: "string" },
    { name: "alternative_names", type: "string[]", optional: true },
    { name: "primary_category", type: "string", facet: true },
    { name: "secondary_categories", type: "string[]", facet: true, optional: true },
    { name: "overlander_tags", type: "string[]", facet: true, optional: true },
    { name: "description", type: "string", optional: true },
    { name: "location", type: "geopoint" },
    { name: "prominence_score", type: "float" },
    { name: "source_count", type: "int32" },
    { name: "has_water", type: "bool", facet: true, optional: true },
    { name: "has_dump_station", type: "bool", facet: true, optional: true },
    { name: "is_federal", type: "bool", facet: true, optional: true },
  ] satisfies CollectionFieldSchema[],
  default_sorting_field: "prominence_score",
};

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface MasterPlaceExportRow {
  id: string;
  canonical_name: string;
  alternative_names: string[] | null;
  primary_category: string;
  secondary_categories: string[] | null;
  overlander_tags: string[] | null;
  description: string | null;
  lng: number;
  lat: number;
  prominence_score: number;
  source_count: number;
  amenities: Record<string, unknown> | null;
}

interface PlaceDocument {
  id: string;
  canonical_name: string;
  alternative_names?: string[];
  primary_category: string;
  secondary_categories?: string[];
  overlander_tags?: string[];
  description?: string;
  /** Typesense geopoint convention: [lat, lng]. */
  location: [number, number];
  prominence_score: number;
  source_count: number;
  has_water?: boolean;
  has_dump_station?: boolean;
  is_federal?: boolean;
}

export interface SyncResult {
  fetched: number;
  indexed: number;
  failed: number;
  collection_created: boolean;
  duration_ms: number;
}

// ──────────────────────────────────────────────────────────────────────
// Derivations
// ──────────────────────────────────────────────────────────────────────

function deriveAmenityBool(amenities: Record<string, unknown> | null, key: string): boolean | undefined {
  if (!amenities) return undefined;
  const value = amenities[key];
  if (value === undefined) return undefined;
  return Boolean(value);
}

function deriveIsFederal(tags: string[] | null): boolean | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const t of tags) {
    if (FEDERAL_TAGS.has(t.toLowerCase())) return true;
  }
  return undefined;
}

function transformRow(row: MasterPlaceExportRow): PlaceDocument {
  const doc: PlaceDocument = {
    id: row.id,
    canonical_name: row.canonical_name,
    primary_category: row.primary_category,
    location: [row.lat, row.lng],
    prominence_score: row.prominence_score,
    source_count: row.source_count,
  };
  if (row.alternative_names && row.alternative_names.length > 0) doc.alternative_names = row.alternative_names;
  if (row.secondary_categories && row.secondary_categories.length > 0) doc.secondary_categories = row.secondary_categories;
  if (row.overlander_tags && row.overlander_tags.length > 0) doc.overlander_tags = row.overlander_tags;
  if (row.description) doc.description = row.description;

  const hasWater = deriveAmenityBool(row.amenities, AMENITY_DERIVATIONS.has_water);
  if (hasWater !== undefined) doc.has_water = hasWater;
  const hasDump = deriveAmenityBool(row.amenities, AMENITY_DERIVATIONS.has_dump_station);
  if (hasDump !== undefined) doc.has_dump_station = hasDump;
  const isFederal = deriveIsFederal(row.overlander_tags);
  if (isFederal !== undefined) doc.is_federal = isFederal;

  return doc;
}

// ──────────────────────────────────────────────────────────────────────
// Typesense client
// ──────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getTypesenseClient(): Typesense.Client {
  return new Typesense.Client({
    nodes: [
      {
        host: requireEnv("TYPESENSE_HOST"),
        port: Number(requireEnv("TYPESENSE_PORT")),
        protocol: requireEnv("TYPESENSE_PROTOCOL"),
      },
    ],
    apiKey: requireEnv("TYPESENSE_ADMIN_API_KEY"),
    connectionTimeoutSeconds: 10,
  });
}

async function ensureCollection(client: Typesense.Client): Promise<boolean> {
  try {
    await client.collections(COLLECTION_NAME).retrieve();
    logger.info({ collection: COLLECTION_NAME }, "typesense: collection exists");
    return false;
  } catch (err: unknown) {
    if (err instanceof Typesense.Errors.ObjectNotFound) {
      logger.info({ collection: COLLECTION_NAME }, "typesense: creating collection");
      await client.collections().create(SCHEMA);
      return true;
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Supabase fetch
// ──────────────────────────────────────────────────────────────────────

async function fetchAllRows(): Promise<MasterPlaceExportRow[]> {
  const db = getDb();
  const all: MasterPlaceExportRow[] = [];
  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("master_place_search_export")
      .select("*")
      .order("id", { ascending: true })
      .range(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MasterPlaceExportRow[];
    if (rows.length === 0) break;
    all.push(...rows);
    logger.debug({ fetched: all.length, page: offset / SUPABASE_PAGE_SIZE }, "supabase: page fetched");
    if (rows.length < SUPABASE_PAGE_SIZE) break;
  }
  return all;
}

// ──────────────────────────────────────────────────────────────────────
// Typesense import
// ──────────────────────────────────────────────────────────────────────

async function importBatch(client: Typesense.Client, docs: PlaceDocument[]): Promise<{ success: number; failure: number }> {
  const results: ImportResponse[] = await client
    .collections<PlaceDocument>(COLLECTION_NAME)
    .documents()
    .import(docs, { action: "upsert" });
  let success = 0;
  let failure = 0;
  for (const r of results) {
    if (r.success) {
      success += 1;
    } else {
      failure += 1;
      logger.warn({ error: r.error, code: r.code, doc_id: r.id }, "typesense: doc upsert failed");
    }
  }
  return { success, failure };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

export async function sync(): Promise<SyncResult> {
  const startedAt = Date.now();
  const client = getTypesenseClient();
  const collectionCreated = await ensureCollection(client);

  const rows = await fetchAllRows();
  logger.info({ count: rows.length }, "supabase: master_place rows fetched");

  let indexed = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += TYPESENSE_BATCH_SIZE) {
    const batch = rows.slice(i, i + TYPESENSE_BATCH_SIZE).map(transformRow);
    const { success, failure } = await importBatch(client, batch);
    indexed += success;
    failed += failure;
    logger.debug(
      { batch: Math.floor(i / TYPESENSE_BATCH_SIZE) + 1, success, failure },
      "typesense: batch imported",
    );
  }

  return {
    fetched: rows.length,
    indexed,
    failed,
    collection_created: collectionCreated,
    duration_ms: Date.now() - startedAt,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sync()
    .then((result) => {
      logger.info(result, "search:sync: complete");
      process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      logger.error({ err }, "search:sync: fatal");
      process.exit(1);
    });
}
