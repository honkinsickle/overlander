/**
 * RIDB ingester (Recreation.gov API v1).
 *
 * Spec section 8.3. Fetches facilities and recreation areas from federal lands
 * (NPS, USFS, BLM, USACE, etc.) via the Recreation.gov RIDB API.
 *
 * Auth via X-API-KEY header. Source quality score: 0.9 (official federal data).
 * external_id format: `ridb:facility:<id>` or `ridb:recarea:<id>`.
 *
 * Spatial filter strategy: RIDB doesn't support bbox queries natively, but does
 * support (latitude, longitude, radius). We derive the bbox centroid + a
 * diagonal-plus-buffer radius, fetch, then filter client-side to the bbox for
 * defense in depth.
 *
 * OrgID → agency tag mapping (provided ad-hoc; spec didn't specify):
 *   10  → nps
 *   131 → usfs
 *   125 → blm
 *   130 → usace
 *   other → log warning, tag federal_land only
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source ridb --bbox W,S,E,N
 */

import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { defaultRetry } from "../lib/retry.ts";
import { limits } from "../lib/rate-limit.ts";
import { getActiveCorridorBbox } from "../lib/corridor.ts";
import { compact } from "../lib/normalize.ts";
import type { BoundingBox } from "../lib/geometry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "ridb";
const SOURCE_QUALITY_SCORE = 0.9;
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const PAGE_LIMIT = 50;
const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

const ORG_ID_TO_AGENCY: Record<number, string> = {
  10: "nps",
  131: "usfs",
  125: "blm",
  130: "usace",
};

function requireApiKey(): string {
  const key = process.env.RIDB_API_KEY;
  if (!key) throw new Error("RIDB_API_KEY is not set");
  return key;
}

// ───── Schemas ─────────────────────────────────────────────────────────

const OrganizationSchema = z
  .object({
    OrgID: z.union([z.number(), z.string()]).optional(),
    OrgName: z.string().optional(),
  })
  .passthrough();

const FacilitySchema = z
  .object({
    FacilityID: z.union([z.number(), z.string()]),
    FacilityName: z.string(),
    FacilityTypeDescription: z.string().nullable().optional(),
    FacilityLatitude: z.number().nullable().optional(),
    FacilityLongitude: z.number().nullable().optional(),
    FacilityDescription: z.string().nullable().optional(),
    FacilityPhone: z.string().nullable().optional(),
    FacilityEmail: z.string().nullable().optional(),
    FacilityReservationURL: z.string().nullable().optional(),
    FacilityMapURL: z.string().nullable().optional(),
    FacilityAdaAccess: z.string().nullable().optional(),
    ORGANIZATION: z.array(OrganizationSchema).optional(),
  })
  .passthrough();

const RecAreaSchema = z
  .object({
    RecAreaID: z.union([z.number(), z.string()]),
    RecAreaName: z.string(),
    RecAreaDescription: z.string().nullable().optional(),
    RecAreaLatitude: z.number().nullable().optional(),
    RecAreaLongitude: z.number().nullable().optional(),
    RecAreaPhone: z.string().nullable().optional(),
    RecAreaEmail: z.string().nullable().optional(),
    RecAreaMapURL: z.string().nullable().optional(),
    ORGANIZATION: z.array(OrganizationSchema).optional(),
  })
  .passthrough();

const ResponseSchema = z.object({
  RECDATA: z.array(z.unknown()),
  METADATA: z
    .object({
      RESULTS: z
        .object({
          CURRENT_COUNT: z.number().optional(),
          TOTAL_COUNT: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

type Facility = z.infer<typeof FacilitySchema>;
type RecArea = z.infer<typeof RecAreaSchema>;

// ───── Pagination ──────────────────────────────────────────────────────

interface QueryParams {
  latitude: number;
  longitude: number;
  /** radius in miles (RIDB unit). */
  radius: number;
}

async function fetchPaginated(
  endpoint: "facilities" | "recareas",
  params: QueryParams,
): Promise<unknown[]> {
  const apiKey = requireApiKey();
  const out: unknown[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${RIDB_BASE}/${endpoint}`);
    url.searchParams.set("latitude", String(params.latitude));
    url.searchParams.set("longitude", String(params.longitude));
    url.searchParams.set("radius", String(params.radius));
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const data = await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: {
          // RIDB uses lowercase "apikey" header — spec §8.3 says "X-API-KEY"
          // but that returns 401. Confirmed by curl + existing bin/preflight.
          apikey: apiKey,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`RIDB ${endpoint} ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const parsed = ResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.flatten() }, "ridb: response failed validation");
        throw new Error("ridb: response failed validation");
      }
      return parsed.data;
    }, `ridb.${endpoint}.fetch`);

    const records = data.RECDATA;
    out.push(...records);

    const total = data.METADATA?.RESULTS?.TOTAL_COUNT ?? records.length + offset;
    logger.debug({ endpoint, offset, fetched: records.length, total }, "ridb: page");

    if (records.length < PAGE_LIMIT || offset + records.length >= total) break;
    offset += PAGE_LIMIT;
  }

  return out;
}

// ───── Normalization ───────────────────────────────────────────────────

function buildOverlanderTags(orgs: Facility["ORGANIZATION"] | RecArea["ORGANIZATION"]): string[] {
  const tags: string[] = ["federal_land"];
  const seenAgencies = new Set<string>();
  for (const o of orgs ?? []) {
    const raw = o.OrgID;
    const orgId = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (orgId === undefined || Number.isNaN(orgId)) continue;
    const agency = ORG_ID_TO_AGENCY[orgId];
    if (agency) {
      if (!seenAgencies.has(agency)) {
        tags.push(agency);
        seenAgencies.add(agency);
      }
    } else {
      logger.warn({ orgId, orgName: o.OrgName }, "ridb: unknown OrgID — tagging federal_land only");
    }
  }
  return tags;
}

function snakeCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeFacility(f: Facility): Record<string, unknown> {
  const contact = compact({
    phone: f.FacilityPhone,
    email: f.FacilityEmail,
    website: f.FacilityReservationURL ?? f.FacilityMapURL,
  });
  const access = compact({ ada: f.FacilityAdaAccess });
  return {
    description: f.FacilityDescription ?? null,
    overlander_tags: buildOverlanderTags(f.ORGANIZATION),
    contact: Object.keys(contact).length ? contact : null,
    access: Object.keys(access).length ? access : null,
    amenities: null,
    hours: null,
  };
}

function normalizeRecArea(r: RecArea): Record<string, unknown> {
  const contact = compact({
    phone: r.RecAreaPhone,
    email: r.RecAreaEmail,
    website: r.RecAreaMapURL,
  });
  return {
    description: r.RecAreaDescription ?? null,
    overlander_tags: buildOverlanderTags(r.ORGANIZATION),
    contact: Object.keys(contact).length ? contact : null,
    access: null,
    amenities: null,
    hours: null,
  };
}

// ───── Persistence ─────────────────────────────────────────────────────

function withinBbox(lng: number, lat: number, bbox: BoundingBox): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

async function persistFacility(
  raw: unknown,
  bbox: BoundingBox,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = FacilitySchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "ridb: facility schema mismatch — skipped");
    return "skipped";
  }
  const f = parsed.data;
  if (f.FacilityLatitude == null || f.FacilityLongitude == null) return "skipped";
  if (!withinBbox(f.FacilityLongitude, f.FacilityLatitude, bbox)) return "skipped";

  const externalId = `ridb:facility:${f.FacilityID}`;
  const inferredCategory = f.FacilityTypeDescription ? snakeCase(f.FacilityTypeDescription) : null;
  const normalized = normalizeFacility(f);

  if (dryRun) {
    logger.debug({ externalId, name: f.FacilityName, category: inferredCategory }, "ridb: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: f.FacilityName,
      inferredCategory,
      point: [f.FacilityLongitude, f.FacilityLatitude],
      rawPayload: { facility: f, fetched_at: new Date().toISOString() },
      normalizedPayload: normalized,
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "ridb: facility upsert failed");
    return "error";
  }
}

async function persistRecArea(
  raw: unknown,
  bbox: BoundingBox,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = RecAreaSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "ridb: recarea schema mismatch — skipped");
    return "skipped";
  }
  const r = parsed.data;
  if (r.RecAreaLatitude == null || r.RecAreaLongitude == null) return "skipped";
  if (!withinBbox(r.RecAreaLongitude, r.RecAreaLatitude, bbox)) return "skipped";

  const externalId = `ridb:recarea:${r.RecAreaID}`;
  const normalized = normalizeRecArea(r);

  if (dryRun) {
    logger.debug({ externalId, name: r.RecAreaName }, "ridb: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: r.RecAreaName,
      inferredCategory: "recreation_area",
      point: [r.RecAreaLongitude, r.RecAreaLatitude],
      rawPayload: { recarea: r, fetched_at: new Date().toISOString() },
      normalizedPayload: normalized,
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "ridb: recarea upsert failed");
    return "error";
  }
}

// ───── Entry ───────────────────────────────────────────────────────────

function bboxCentroidAndRadius(bbox: BoundingBox): QueryParams {
  const [w, s, e, n] = bbox;
  const longitude = (w + e) / 2;
  const latitude = (s + n) / 2;
  // 1 degree latitude ≈ 69 miles. Longitude scales by cos(lat).
  const latMiles = ((n - s) / 2) * 69;
  const lonMiles = ((e - w) / 2) * 69 * Math.cos((latitude * Math.PI) / 180);
  const radius = Math.ceil(Math.sqrt(latMiles * latMiles + lonMiles * lonMiles) + 5);
  return { latitude, longitude, radius };
}

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  let bbox: BoundingBox;

  if (opts.bbox) {
    bbox = opts.bbox;
    logger.info({ bbox }, "ridb: using manual bbox override");
  } else {
    const corridor = await getActiveCorridorBbox();
    if (!corridor) {
      throw new Error("No active corridor found. Pass --bbox or run deploy-corridor first.");
    }
    bbox = corridor.bbox;
    logger.info({ corridor: corridor.name, bbox }, "ridb: using corridor bbox");
  }

  const queryParams = bboxCentroidAndRadius(bbox);
  logger.info(queryParams, "ridb: derived query params (centroid + radius)");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.ridb;

  await Promise.all([
    limit(async () => {
      const facilities = await fetchPaginated("facilities", queryParams);
      stats.fetched += facilities.length;
      logger.info({ count: facilities.length }, "ridb: facilities fetched");
      for (const raw of facilities) {
        const outcome = await persistFacility(raw, bbox, opts.dryRun ?? false);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }
    }),
    limit(async () => {
      const recareas = await fetchPaginated("recareas", queryParams);
      stats.fetched += recareas.length;
      logger.info({ count: recareas.length }, "ridb: recareas fetched");
      for (const raw of recareas) {
        const outcome = await persistRecArea(raw, bbox, opts.dryRun ?? false);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }
    }),
  ]);

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "ridb: ingestion complete");
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
      logger.error({ err }, "ridb: fatal");
      process.exit(1);
    });
}
