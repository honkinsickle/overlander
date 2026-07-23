/**
 * Google Places (New) ingester + enrichment helpers.
 *
 * Phase 1: bbox → searchNearby, used by the JT smoke + materialize
 *   orchestrator's --ingest path. Backward-compatible default export.
 *
 * Phase 3: two new modes per spec §2.3:
 *   - `enrichSourceRecord(seed)` — text-search + place-details, keyed
 *     by an existing source_record's (name, coords). Idempotent via a
 *     persistent disk cache; re-runs skip already-resolved seeds.
 *   - `discoverAtAnchor(anchor, radius)` — small-radius searchNearby
 *     centered on a populated-area anchor (town centerpoint). The
 *     corridor driver provides the anchor list.
 *
 * All paid calls flow through the persistent cost ledger (see
 * data/ingestion/lib/cost-ledger.ts). Charges happen BEFORE the
 * network call; a BudgetExceededError prevents the call entirely.
 * No more in-process MAX_REQUESTS cap — the ledger is the cap.
 *
 * Essentials field mask only. Spec ToS: never cache
 * currentOpeningHours / regularOpeningHours / businessStatus more
 * than 30 days. The refresh cron (future work) fetches those
 * separately at higher per-call cost.
 *
 * Auth via X-Goog-Api-Key. Source quality score: 0.85. external_id
 * format: `google:<place_id>`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { getCostLedger, type CostLedger } from "../lib/cost-ledger.ts";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { AbortError, defaultRetry } from "../lib/retry.ts";
import { getActiveCorridorBbox } from "../lib/corridor.ts";
import type { BoundingBox } from "../lib/geometry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const SOURCE_ID = "google";
const SOURCE_QUALITY_SCORE = 0.85;
const PLACES_BASE = "https://places.googleapis.com/v1";
const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

const INCLUDED_PRIMARY_TYPES = [
  "gas_station",
  "lodging",
  "restaurant",
  "car_repair",
  "supermarket",
  "convenience_store",
];

// Essentials field mask. Volatile (hours, businessStatus) deliberately
// excluded — the spec restricts caching them >30d and the refresh cron
// is responsible for them.
const FIELD_MASK_LIST =
  "places.id,places.displayName,places.types,places.location," +
  "places.formattedAddress,places.primaryType";
const FIELD_MASK_SINGLE =
  "id,displayName,types,location,formattedAddress,primaryType";

/**
 * SKU pricing — conservative; rounded up from Google's published
 * per-call rates so the ledger never under-counts vs. the real bill.
 *   - searchNearby:  Nearby Search Pro tier ($30/1000 → $0.032/call)
 *   - textSearch:    Text Search Pro tier ($25/1000 → $0.025/call)
 *   - placeDetails:  Place Details Essentials ($5/1000 → $0.005/call)
 */
export const GOOGLE_SKU = {
  SEARCH_NEARBY: { sku: "google.searchNearby", unitCostUsd: 0.032 },
  TEXT_SEARCH: { sku: "google.textSearch", unitCostUsd: 0.025 },
  PLACE_DETAILS: { sku: "google.placeDetails", unitCostUsd: 0.005 },
} as const;

function requireApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

// ──────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────

const LocationSchema = z
  .object({ latitude: z.number(), longitude: z.number() })
  .passthrough();

const DisplayNameSchema = z
  .object({ text: z.string(), languageCode: z.string().optional() })
  .passthrough();

const PlaceSchema = z
  .object({
    id: z.string(),
    displayName: DisplayNameSchema.optional(),
    types: z.array(z.string()).optional(),
    primaryType: z.string().optional(),
    location: LocationSchema.optional(),
    formattedAddress: z.string().optional(),
  })
  .passthrough();

const SearchResponseSchema = z.object({
  places: z.array(z.unknown()).optional(),
});

type Place = z.infer<typeof PlaceSchema>;

// ──────────────────────────────────────────────────────────────────────
// HTTP helpers — fail-fast detection
// ──────────────────────────────────────────────────────────────────────

function detectFailFast(status: number, body: string): Error | null {
  const isPermissionDenied =
    status === 403 ||
    /PERMISSION_DENIED/i.test(body) ||
    /API key not valid/i.test(body);
  const isApiDisabled =
    /API[\s_-]?has[\s_-]?not[\s_-]?been[\s_-]?used|API is not enabled|PLACES API.*disabled/i.test(
      body,
    );
  const isBillingDisabled =
    /billing/i.test(body) && /(disabled|not[\s_-]?enabled|account.*required)/i.test(body);

  if (isPermissionDenied) {
    return new Error(
      `Google Places: PERMISSION_DENIED. Likely the API key is restricted, the project has no billing, or the Places API (New) isn't enabled. HTTP ${status}, body: ${body.slice(0, 300)}`,
    );
  }
  if (isApiDisabled) {
    return new Error(
      `Google Places: API is not enabled. Enable "Places API (New)" in the GCP project. HTTP ${status}, body: ${body.slice(0, 300)}`,
    );
  }
  if (isBillingDisabled) {
    return new Error(
      `Google Places: billing not enabled on the GCP project. Link a billing account. HTTP ${status}, body: ${body.slice(0, 300)}`,
    );
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Low-level API helpers (charge ledger, then call)
// ──────────────────────────────────────────────────────────────────────

interface SearchNearbyParams {
  center: { latitude: number; longitude: number };
  /** meters, max 50000 (Google's cap on searchNearby radius). */
  radius: number;
  /** override the default INCLUDED_PRIMARY_TYPES set */
  includedPrimaryTypes?: string[];
}

async function searchNearby(
  params: SearchNearbyParams,
  ledger: CostLedger,
): Promise<unknown[]> {
  ledger.charge(GOOGLE_SKU.SEARCH_NEARBY.sku, 1, GOOGLE_SKU.SEARCH_NEARBY.unitCostUsd);

  const apiKey = requireApiKey();
  const body = {
    includedPrimaryTypes: params.includedPrimaryTypes ?? INCLUDED_PRIMARY_TYPES,
    locationRestriction: { circle: { center: params.center, radius: params.radius } },
    maxResultCount: 20,
  };

  return defaultRetry(async () => {
    const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK_LIST,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const failFast = detectFailFast(res.status, errBody);
      if (failFast) throw new AbortError(failFast.message);
      throw new Error(`Google Places ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = await res.json();
    const parsed = SearchResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.flatten() }, "google: searchNearby response failed validation");
      throw new Error("google: searchNearby response failed validation");
    }
    return parsed.data.places ?? [];
  }, "google.searchNearby");
}

interface TextSearchParams {
  textQuery: string;
  bias?: { latitude: number; longitude: number; radius: number };
  maxResultCount?: number;
}

async function textSearch(params: TextSearchParams, ledger: CostLedger): Promise<unknown[]> {
  ledger.charge(GOOGLE_SKU.TEXT_SEARCH.sku, 1, GOOGLE_SKU.TEXT_SEARCH.unitCostUsd);

  const apiKey = requireApiKey();
  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    maxResultCount: params.maxResultCount ?? 5,
  };
  if (params.bias) {
    body.locationBias = {
      circle: {
        center: { latitude: params.bias.latitude, longitude: params.bias.longitude },
        radius: params.bias.radius,
      },
    };
  }

  return defaultRetry(async () => {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK_LIST,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const failFast = detectFailFast(res.status, errBody);
      if (failFast) throw new AbortError(failFast.message);
      throw new Error(`Google Places textSearch ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = await res.json();
    const parsed = SearchResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.flatten() }, "google: textSearch response failed validation");
      throw new Error("google: textSearch response failed validation");
    }
    return parsed.data.places ?? [];
  }, "google.textSearch");
}

async function placeDetails(placeId: string, ledger: CostLedger): Promise<Place | null> {
  ledger.charge(GOOGLE_SKU.PLACE_DETAILS.sku, 1, GOOGLE_SKU.PLACE_DETAILS.unitCostUsd);

  const apiKey = requireApiKey();
  return defaultRetry(async () => {
    const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK_SINGLE,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const failFast = detectFailFast(res.status, errBody);
      if (failFast) throw new AbortError(failFast.message);
      throw new Error(`Google Places placeDetails ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = await res.json();
    const parsed = PlaceSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.flatten() }, "google: placeDetails response failed validation");
      throw new Error("google: placeDetails response failed validation");
    }
    return parsed.data;
  }, "google.placeDetails");
}

// ──────────────────────────────────────────────────────────────────────
// Normalization + persistence (shared)
// ──────────────────────────────────────────────────────────────────────

// TWIN — this switch is duplicated in web/src/lib/itinerary/resolve.ts
// (inferCategory) so live tier-2 resolution and this rich corpus ingester map
// Google's primaryType to the SAME corpus category vocabulary. They are copied,
// not shared, because web/ must not import from data/ at runtime (CLAUDE.md
// cross-workspace rule). If you change one arm, change BOTH.
function inferCategory(p: Place): string | null {
  switch (p.primaryType) {
    case "gas_station":
      return "gas_station";
    case "lodging":
      return "lodging";
    case "restaurant":
      return "restaurant";
    case "car_repair":
      return "car_repair";
    case "supermarket":
    case "convenience_store":
      return "grocery";
    default:
      return p.primaryType ?? null;
  }
}

function normalizePlace(p: Place, cleanName: string): Record<string, unknown> {
  return {
    canonical_name: cleanName,
    description: null,
    overlander_tags: [],
    contact: null, // volatile — refresh cron will populate
    access: null,
    amenities: null,
    hours: null, // volatile — refresh cron will populate
    formatted_address: p.formattedAddress ?? null,
  };
}

async function persistPlace(
  raw: unknown,
  filter: (lng: number, lat: number) => boolean,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = PlaceSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "google: place schema mismatch — skipped");
    return "skipped";
  }
  const p = parsed.data;
  if (!p.location) return "skipped";
  if (!filter(p.location.longitude, p.location.latitude)) return "skipped";

  const name = p.displayName?.text ?? "Unnamed Google place";
  const externalId = `google:${p.id}`;
  const inferredCategory = inferCategory(p);

  if (dryRun) {
    logger.debug({ externalId, name, category: inferredCategory }, "google: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory,
      point: [p.location.longitude, p.location.latitude],
      rawPayload: { place: p, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizePlace(p, name),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "google: upsert failed");
    return "error";
  }
}

function withinBbox(lng: number, lat: number, bbox: BoundingBox): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

// ──────────────────────────────────────────────────────────────────────
// Persistent enrichment cache
// ──────────────────────────────────────────────────────────────────────

/**
 * The enrichment cache prevents re-issuing the same (name, lat, lng)
 * textSearch across runs. Keyed by `<normalized_name>@<rounded_lat>,<rounded_lng>`
 * so multiple source_records for the same place (OSM + RIDB + NPS all
 * naming "Belle Campground" at the same coords) share one Google call.
 */
interface EnrichmentCacheEntry {
  /** null = textSearch returned no plausible match. */
  place_id: string | null;
  resolved_at: string;
}

type EnrichmentCache = Record<string, EnrichmentCacheEntry>;

const ENRICH_CACHE_REL_PATH = ".cache/google-enrichment-cache.json";

function resolveDataRel(rel: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", rel);
}

function enrichmentCachePath(): string {
  const env = process.env.GOOGLE_ENRICH_CACHE_PATH;
  if (env && isAbsolute(env)) return env;
  if (env) return resolveDataRel(env);
  return resolveDataRel(ENRICH_CACHE_REL_PATH);
}

let _enrichmentCache: EnrichmentCache | null = null;

function loadEnrichmentCache(): EnrichmentCache {
  if (_enrichmentCache) return _enrichmentCache;
  const path = enrichmentCachePath();
  if (!existsSync(path)) {
    _enrichmentCache = {};
    return _enrichmentCache;
  }
  try {
    const raw = readFileSync(path, "utf8");
    _enrichmentCache = JSON.parse(raw) as EnrichmentCache;
    return _enrichmentCache;
  } catch (err) {
    logger.warn({ err, path }, "google: enrichment cache unreadable — starting fresh");
    _enrichmentCache = {};
    return _enrichmentCache;
  }
}

function persistEnrichmentCache(): void {
  if (!_enrichmentCache) return;
  const path = enrichmentCachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(_enrichmentCache, null, 2));
}

function normalizeNameForKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/** ~100m grid at all reasonable latitudes; cheap dedup for cross-source duplicates. */
function enrichmentKey(name: string, lng: number, lat: number): string {
  const rLat = lat.toFixed(3);
  const rLng = lng.toFixed(3);
  return `${normalizeNameForKey(name)}@${rLng},${rLat}`;
}

// ──────────────────────────────────────────────────────────────────────
// Public: enrichment + discovery
// ──────────────────────────────────────────────────────────────────────

export interface EnrichSeed {
  /** Existing record's name — fed verbatim to Google textSearch. */
  name: string;
  /** Existing record's coords — biases the textSearch and gates the result. */
  lng: number;
  lat: number;
  /** Reject text-search hits more than this many meters from (lng, lat). Default 500. */
  maxDriftMeters?: number;
}

export interface EnrichOptions {
  ledger?: CostLedger;
  dryRun?: boolean;
}

export type EnrichResult =
  | { status: "cached_hit"; placeId: string }
  | { status: "cached_miss" }
  | { status: "enriched"; placeId: string; inserted: boolean }
  | { status: "miss" }
  | { status: "dry_run" };

/**
 * Resolve a seed (name + coords) to a Google place_id via textSearch,
 * fetch Place Details (essentials mask), upsert as a google source_record.
 *
 * Idempotent: a persistent disk cache short-circuits repeat seeds within
 * ~100m and matching normalized names. Misses are cached too (don't
 * burn budget retrying a place Google has no record of).
 *
 * Cost per fresh call: textSearch + placeDetails ≈ $0.030.
 * Cost per cached call: $0.
 */
export async function enrichSourceRecord(
  seed: EnrichSeed,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const cache = loadEnrichmentCache();
  const key = enrichmentKey(seed.name, seed.lng, seed.lat);
  const cached = cache[key];

  if (cached) {
    if (cached.place_id === null) return { status: "cached_miss" };
    return { status: "cached_hit", placeId: cached.place_id };
  }

  if (opts.dryRun) {
    logger.debug({ seed, key }, "google.enrich: dry-run — skipping textSearch + details");
    return { status: "dry_run" };
  }

  const ledger = opts.ledger ?? getCostLedger();
  const maxDriftM = seed.maxDriftMeters ?? 500;

  const candidates = await textSearch(
    {
      textQuery: seed.name,
      bias: { latitude: seed.lat, longitude: seed.lng, radius: 5000 },
      maxResultCount: 5,
    },
    ledger,
  );

  // First parseable hit within maxDriftM wins.
  let placeId: string | null = null;
  for (const raw of candidates) {
    const parsed = PlaceSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.location) continue;
    const dist = haversineMeters(
      seed.lat,
      seed.lng,
      parsed.data.location.latitude,
      parsed.data.location.longitude,
    );
    if (dist <= maxDriftM) {
      placeId = parsed.data.id;
      break;
    }
  }

  if (placeId === null) {
    cache[key] = { place_id: null, resolved_at: new Date().toISOString() };
    persistEnrichmentCache();
    return { status: "miss" };
  }

  // Details fetch. Even though textSearch returned the essentials we
  // need, the details call locks in the canonical record and matches
  // the spec's per-place enrichment model.
  const details = await placeDetails(placeId, ledger);
  if (!details) {
    cache[key] = { place_id: null, resolved_at: new Date().toISOString() };
    persistEnrichmentCache();
    return { status: "miss" };
  }

  cache[key] = { place_id: placeId, resolved_at: new Date().toISOString() };
  persistEnrichmentCache();

  const outcome = await persistPlace(
    details,
    () => true, // bbox filter is satisfied by construction — the seed is in-corridor.
    false,
  );

  return {
    status: "enriched",
    placeId,
    inserted: outcome === "inserted",
  };
}

export interface DiscoverAnchor {
  /** Human label, e.g. "Portland, OR". Logged only. */
  label: string;
  centerLng: number;
  centerLat: number;
  /** meters. Default 5000. */
  radiusM?: number;
}

export interface DiscoverResult {
  fetched: number;
  inserted: number;
  skipped: number;
  errors: number;
}

/**
 * Discovery via small-radius searchNearby around a populated-area
 * anchor. Spec §2.3 — populated areas are where Google's commercial
 * data adds the most marginal value vs. OSM/RIDB/NPS.
 *
 * Cost per anchor: $0.032.
 */
export async function discoverAtAnchor(
  anchor: DiscoverAnchor,
  opts: EnrichOptions = {},
): Promise<DiscoverResult> {
  if (opts.dryRun) {
    logger.info({ anchor }, "google.discover: dry-run — skipping searchNearby");
    return { fetched: 0, inserted: 0, skipped: 0, errors: 0 };
  }
  const ledger = opts.ledger ?? getCostLedger();
  const radius = anchor.radiusM ?? 5000;

  const places = await searchNearby(
    {
      center: { latitude: anchor.centerLat, longitude: anchor.centerLng },
      radius,
    },
    ledger,
  );

  const stats = { fetched: places.length, inserted: 0, skipped: 0, errors: 0 };
  for (const raw of places) {
    const outcome = await persistPlace(raw, () => true, false);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }
  logger.info({ anchor: anchor.label, ...stats, radiusM: radius }, "google.discover: complete");
  return stats;
}

// ──────────────────────────────────────────────────────────────────────
// Geometry
// ──────────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ──────────────────────────────────────────────────────────────────────
// Backward-compat: bbox-driven ingest (the JT smoke path)
// ──────────────────────────────────────────────────────────────────────

function bboxToCircle(bbox: BoundingBox): SearchNearbyParams {
  const [w, s, e, n] = bbox;
  const longitude = (w + e) / 2;
  const latitude = (s + n) / 2;
  const latM = ((n - s) / 2) * 111320;
  const lonM = ((e - w) / 2) * 111320 * Math.cos((latitude * Math.PI) / 180);
  const radius = Math.min(50000, Math.ceil(Math.sqrt(latM * latM + lonM * lonM) + 1000));
  return { center: { latitude, longitude }, radius };
}

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  let bbox: BoundingBox;
  if (opts.bbox) {
    bbox = opts.bbox;
    logger.info({ bbox }, "google: using manual bbox override");
  } else {
    const corridor = await getActiveCorridorBbox();
    if (!corridor) {
      throw new Error("No active corridor found. Pass --bbox or run deploy-corridor first.");
    }
    bbox = corridor.bbox;
    logger.info({ corridor: corridor.name, bbox }, "google: using corridor bbox");
  }

  const params = bboxToCircle(bbox);
  logger.info(
    {
      center: params.center,
      radiusM: params.radius,
      includedPrimaryTypes: INCLUDED_PRIMARY_TYPES,
    },
    "google: searchNearby params",
  );

  if (opts.dryRun) {
    logger.info("google: --dry-run — skipping searchNearby + persistence");
    const result: IngestResult = {
      source_id: SOURCE_ID,
      duration_ms: Date.now() - startedAt,
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    return result;
  }

  const ledger = getCostLedger();
  const places = await searchNearby(params, ledger);

  const stats = { fetched: places.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  logger.info({ count: places.length }, "google: search complete");

  for (const raw of places) {
    const outcome = await persistPlace(raw, (lng, lat) => withinBbox(lng, lat, bbox), false);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info({ ...result, costSummary: ledger.summary() }, "google: ingestion complete");
  return result;
};

export default ingest;
