/**
 * Google Places (New) ingester.
 *
 * Spec section 8.5. Discovery via `places:searchNearby` with a single
 * geographic tile. Essentials-only field mask — no volatile fields
 * (`currentOpeningHours`, `businessStatus`, `regularOpeningHours`) per
 * spec ToS constraint (those have a 30-day cache limit; refresh cron
 * fetches them separately).
 *
 * Auth via `X-Goog-Api-Key` header. Source quality score: 0.85.
 * external_id format: `google:<place_id>`.
 *
 * Request budget: hard cap of MAX_REQUESTS (5). Smoke-test scope; the
 * production tiling job (Phase 1 week 2+) lifts this.
 *
 * Fail-fast errors (no retry):
 *   - 403 / PERMISSION_DENIED → API key restricted or Places API (New) not enabled
 *   - 400 with "API is not enabled" body → enable Places API (New) in the GCP project
 *   - 400 with "BILLING" message → billing not enabled on the GCP project
 * Retry-able errors:
 *   - 429 (rate limit), 5xx
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source google --bbox W,S,E,N
 */

import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { AbortError, defaultRetry } from "../lib/retry.ts";
import { getActiveCorridorBbox } from "../lib/corridor.ts";
import type { BoundingBox } from "../lib/geometry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "google";
const SOURCE_QUALITY_SCORE = 0.85;
const PLACES_BASE = "https://places.googleapis.com/v1";
const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";
const MAX_REQUESTS = 5;

const INCLUDED_PRIMARY_TYPES = [
  "gas_station",
  "lodging",
  "restaurant",
  "car_repair",
  "supermarket",
  "convenience_store",
];

// Essentials field mask per spec §8.5. Volatile fields (hours, businessStatus)
// are deliberately excluded — those are the refresh cron's job and have a
// 30-day cache limit per Google ToS.
const FIELD_MASK =
  "places.id,places.displayName,places.types,places.location," +
  "places.formattedAddress,places.primaryType";

function requireApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

// ───── Schemas ─────────────────────────────────────────────────────────

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

const ResponseSchema = z.object({
  places: z.array(z.unknown()).optional(),
});

type Place = z.infer<typeof PlaceSchema>;

// ───── Request ─────────────────────────────────────────────────────────

interface SearchParams {
  center: { latitude: number; longitude: number };
  /** meters, max 50000 (Google's hard cap on searchNearby radius) */
  radius: number;
}

/**
 * Inspect a Google Places error body for fail-fast signals (auth, API not
 * enabled, billing). When detected, throw AbortError so p-retry stops
 * immediately rather than burning the request budget on retries.
 */
function detectFailFast(status: number, body: string): Error | null {
  const isPermissionDenied =
    status === 403 ||
    /PERMISSION_DENIED/i.test(body) ||
    /API key not valid/i.test(body);
  const isApiDisabled =
    /API[\s_-]?has[\s_-]?not[\s_-]?been[\s_-]?used|API is not enabled|PLACES API.*disabled/i.test(body);
  const isBillingDisabled = /billing/i.test(body) && /(disabled|not[\s_-]?enabled|account.*required)/i.test(body);

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

let requestCount = 0;

async function searchNearby(params: SearchParams): Promise<unknown[]> {
  if (requestCount >= MAX_REQUESTS) {
    logger.warn({ requestCount, cap: MAX_REQUESTS }, "google: request cap reached");
    return [];
  }
  requestCount += 1;

  const apiKey = requireApiKey();
  const body = {
    includedPrimaryTypes: INCLUDED_PRIMARY_TYPES,
    locationRestriction: { circle: { center: params.center, radius: params.radius } },
    maxResultCount: 20,
  };

  return defaultRetry(async () => {
    const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
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
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.flatten() }, "google: response failed validation");
      throw new Error("google: response failed validation");
    }
    return parsed.data.places ?? [];
  }, "google.searchNearby");
}

// ───── Normalization ───────────────────────────────────────────────────

function inferCategory(p: Place): string | null {
  // primaryType is most specific. Map to canonical overlander categories.
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

// ───── Persistence ─────────────────────────────────────────────────────

function withinBbox(lng: number, lat: number, bbox: BoundingBox): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

async function persistPlace(
  raw: unknown,
  bbox: BoundingBox,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = PlaceSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "google: place schema mismatch — skipped");
    return "skipped";
  }
  const p = parsed.data;
  if (!p.location) return "skipped";
  if (!withinBbox(p.location.longitude, p.location.latitude, bbox)) return "skipped";

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

// ───── Entry ───────────────────────────────────────────────────────────

function bboxToCircle(bbox: BoundingBox): SearchParams {
  const [w, s, e, n] = bbox;
  const longitude = (w + e) / 2;
  const latitude = (s + n) / 2;
  // Diagonal/2 in meters, plus 1km buffer. 1 deg lat ≈ 111320m.
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
    { center: params.center, radiusM: params.radius, includedPrimaryTypes: INCLUDED_PRIMARY_TYPES, requestBudget: MAX_REQUESTS },
    "google: searchNearby params",
  );

  const places = await searchNearby(params);

  const stats = { fetched: places.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  logger.info({ count: places.length, requestsUsed: requestCount }, "google: search complete");

  for (const raw of places) {
    const outcome = await persistPlace(raw, bbox, opts.dryRun ?? false);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info({ ...result, requestsUsed: requestCount }, "google: ingestion complete");
  return result;
};

export default ingest;

if (import.meta.url === `file://${process.argv[1]}`) {
  ingest({ dryRun: process.argv.includes("--dry-run") })
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      logger.error({ err }, "google: fatal");
      process.exit(1);
    });
}
