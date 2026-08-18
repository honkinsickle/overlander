/**
 * NPS ingester (developer.nps.gov API v1).
 *
 * Spec section 8.4. Fetches places, campgrounds, and park boundary polygons
 * for the parks specified in `opts.parkCodes`.
 *
 * Auth via api_key query param. Source quality score: 0.95 (highest authority
 * for NPS-managed places).
 * external_id format: `nps:place:<id>`, `nps:campground:<id>`, `nps:park:<code>`.
 *
 * Park boundary polygon strategy: NPS API exposes boundary GeoJSON at
 *   /mapdata/parkboundaries/{parkCode}
 * which returns a Polygon or MultiPolygon. We store this in
 * source_record.normalized_payload.geometry_polygon so that, when entity
 * resolution runs in week 3, recompute_master_place() can promote it to
 * master_place.geometry_polygon via field_precedence. Phase 1 doesn't write
 * to master_place directly — preserves the entity-resolution invariant.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source nps --park-codes jotr
 *   npm run -w data ingest:manual -- --source nps --park-codes jotr,joshua-tree --bbox W,S,E,N
 */

import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { defaultRetry } from "../lib/retry.ts";
import { limits } from "../lib/rate-limit.ts";
import { compact } from "../lib/normalize.ts";
import type { BoundingBox } from "../lib/geometry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "nps";
const SOURCE_QUALITY_SCORE = 0.95;
const NPS_BASE = "https://developer.nps.gov/api/v1";
const PAGE_LIMIT = 50;
const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

function requireApiKey(): string {
  const key = process.env.NPS_API_KEY;
  if (!key) throw new Error("NPS_API_KEY is not set");
  return key;
}

// ───── Schemas ─────────────────────────────────────────────────────────

const PlaceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string().nullable().optional(),
    latitude: z.string().nullable().optional(),
    longitude: z.string().nullable().optional(),
    shortDescription: z.string().nullable().optional(),
    longDescription: z.string().nullable().optional(),
    bodyText: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    // The API returns an images array (cropped_image URLs + altText + credit).
    // .passthrough() already kept it in raw_payload; parse it so normalizePlace
    // can promote a photo. altText/credit ride along for a later render choice —
    // licensing is deferred, not ignored (NPS credits vary: NPS public domain
    // vs third-party CC BY-SA). See the NPS-photo backlog item.
    images: z
      .array(
        z
          .object({
            url: z.string().nullable().optional(),
            altText: z.string().nullable().optional(),
            credit: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    relatedParks: z
      .array(
        z
          .object({ parkCode: z.string().optional(), fullName: z.string().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const CampgroundSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string().nullable().optional(),
    latitude: z.string().nullable().optional(),
    longitude: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    reservationInfo: z.string().nullable().optional(),
    reservationUrl: z.string().nullable().optional(),
    parkCode: z.string().optional(),
    amenities: z.record(z.unknown()).optional(),
    fees: z.array(z.unknown()).optional(),
    operatingHours: z.array(z.unknown()).optional(),
    accessibility: z.record(z.unknown()).optional(),
  })
  .passthrough();

const ListResponseSchema = z.object({
  data: z.array(z.unknown()),
  total: z.union([z.number(), z.string()]).optional(),
  limit: z.union([z.number(), z.string()]).optional(),
  start: z.union([z.number(), z.string()]).optional(),
});

// Park boundary endpoint returns GeoJSON directly. Could be a FeatureCollection,
// a single Feature, or a bare geometry — handle all three defensively.
const ParkBoundarySchema = z.union([
  z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal("Feature"),
    geometry: z.unknown(),
  }),
  z.object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.unknown(),
  }),
]);

// /parks?parkCode=<code> — the park unit record. We consume fullName (the real
// canonical name), description, url + phone (contact), and operatingHours (hours).
// designation, entranceFees, addresses, etc. are kept in raw_payload only (via
// .passthrough() + stashing the whole object) — no normalized fields invented.
const ParkSchema = z
  .object({
    id: z.string().optional(),
    parkCode: z.string().optional(),
    fullName: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    designation: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    contacts: z
      .object({
        phoneNumbers: z
          .array(z.object({ phoneNumber: z.string().nullable().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
    operatingHours: z.array(z.unknown()).optional(),
    entranceFees: z.array(z.unknown()).optional(),
    addresses: z.array(z.unknown()).optional(),
  })
  .passthrough();

type Place = z.infer<typeof PlaceSchema>;
type Campground = z.infer<typeof CampgroundSchema>;
type Park = z.infer<typeof ParkSchema>;

// ───── Pagination ──────────────────────────────────────────────────────

async function fetchPaginated(
  endpoint: "places" | "campgrounds",
  parkCode: string,
): Promise<unknown[]> {
  const apiKey = requireApiKey();
  const out: unknown[] = [];
  let start = 0;

  while (true) {
    const url = new URL(`${NPS_BASE}/${endpoint}`);
    url.searchParams.set("parkCode", parkCode);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("start", String(start));
    url.searchParams.set("api_key", apiKey);

    const data = await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`NPS ${endpoint} ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const parsed = ListResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.flatten() }, "nps: list response failed validation");
        throw new Error("nps: list response failed validation");
      }
      return parsed.data;
    }, `nps.${endpoint}.fetch`);

    const records = data.data;
    out.push(...records);

    const total = typeof data.total === "string" ? parseInt(data.total, 10) : (data.total ?? 0);
    logger.debug({ endpoint, parkCode, start, fetched: records.length, total }, "nps: page");

    if (records.length < PAGE_LIMIT || start + records.length >= total) break;
    start += PAGE_LIMIT;
  }
  return out;
}

async function fetchParkBoundary(parkCode: string): Promise<unknown | null> {
  const apiKey = requireApiKey();
  const url = new URL(`${NPS_BASE}/mapdata/parkboundaries/${parkCode}`);
  url.searchParams.set("api_key", apiKey);

  try {
    return await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (res.status === 404) {
        logger.warn({ parkCode }, "nps: park boundary not found");
        return null;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`NPS parkboundaries ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const parsed = ParkBoundarySchema.safeParse(json);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.flatten() }, "nps: boundary response failed validation");
        return json; // store as-is, let humans inspect raw payload
      }
      return parsed.data;
    }, "nps.parkboundary.fetch");
  } catch (err) {
    logger.warn({ err, parkCode }, "nps: park boundary fetch failed — continuing without polygon");
    return null;
  }
}

/** Fetch the park unit record (/parks?parkCode). Returns null on any failure —
 *  persistParkBoundary then falls back to the synthetic name, so a missing
 *  /parks response never blocks writing the boundary polygon. */
async function fetchPark(parkCode: string): Promise<Park | null> {
  const apiKey = requireApiKey();
  const url = new URL(`${NPS_BASE}/parks`);
  url.searchParams.set("parkCode", parkCode);
  url.searchParams.set("limit", "1");
  url.searchParams.set("api_key", apiKey);

  try {
    return await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`NPS parks ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const list = ListResponseSchema.safeParse(json);
      if (!list.success || list.data.data.length === 0) {
        logger.warn({ parkCode }, "nps: /parks returned no data — synthetic name will be used");
        return null;
      }
      const parsed = ParkSchema.safeParse(list.data.data[0]);
      if (!parsed.success) {
        logger.warn({ parkCode, err: parsed.error.flatten() }, "nps: /parks response failed validation");
        return null;
      }
      return parsed.data;
    }, "nps.parks.fetch");
  } catch (err) {
    logger.warn({ err, parkCode }, "nps: /parks fetch failed — falling back to synthetic name");
    return null;
  }
}

// ───── Normalization ───────────────────────────────────────────────────

function parseLatLng(latStr: unknown, lngStr: unknown): [number, number] | null {
  const lat = typeof latStr === "string" ? parseFloat(latStr) : (latStr as number | null);
  const lng = typeof lngStr === "string" ? parseFloat(lngStr) : (lngStr as number | null);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return [lng, lat];
}

/** The photo shape stored on `source_record.normalized_payload.photo` (Route A —
 *  no master_place column). Carries `altText` + `credit` now so displaying them
 *  later is a render choice, not another backfill. `null` when the place has no
 *  usable image url. Pure; the backfill script reuses it off raw_payload. */
export type NpsPhoto = { url: string; altText: string | null; credit: string | null };

export function npsPhotoFromImages(
  images: Place["images"] | undefined,
): NpsPhoto | null {
  const first = images?.find((im) => typeof im.url === "string" && im.url.length > 0);
  if (!first || typeof first.url !== "string") return null;
  return {
    url: first.url,
    altText: first.altText ?? null,
    credit: first.credit ?? null,
  };
}

export function normalizePlace(p: Place): Record<string, unknown> {
  return {
    // canonical_name from NPS's title field. NPS is the authority for federal
    // place names (priority 1 in field_precedence) — without this, master_place
    // canonical_name fell through to Google's name.
    canonical_name: p.title,
    description: p.longDescription ?? p.shortDescription ?? p.bodyText ?? null,
    overlander_tags: ["federal_land", "nps"],
    contact: p.url ? { website: p.url } : null,
    access: null,
    amenities: null,
    hours: null,
    // Route A: photo lives here (not on master_place). pois_along_corridor reads
    // `normalized_payload->'photo'->>'url'` via a LEFT JOIN LATERAL; the card
    // renders whatever photoUrl arrives, so no render change is needed.
    photo: npsPhotoFromImages(p.images),
  };
}

function normalizeCampground(c: Campground): Record<string, unknown> {
  const contact = compact({
    website: c.url ?? c.reservationUrl,
  });
  return {
    // canonical_name from NPS's name field. Federal-bookable campgrounds:
    // NPS's name is the canonical one (e.g., "Sheep Pass Group Campground"
    // vs RIDB's "Sheep Pass Group" vs Google's "Sheep Pass Campground").
    canonical_name: c.name,
    description: c.description ?? null,
    overlander_tags: ["federal_land", "nps"],
    contact: Object.keys(contact).length ? contact : null,
    // The NPS API returns extremely rich amenity/accessibility/fees data —
    // for Phase 1 we keep just the raw shape inside raw_payload and surface
    // a flat boolean amenities map. A second-pass normalizer can refine.
    amenities: c.amenities ? coerceCampgroundAmenities(c.amenities) : null,
    access: c.accessibility ? compact({ raw: c.accessibility }) : null,
    hours: c.operatingHours ? { raw: c.operatingHours } : null,
  };
}

function coerceCampgroundAmenities(raw: Record<string, unknown>): Record<string, unknown> {
  // NPS amenity values are strings like "Yes", "No - seasonal", "Yes - seasonal", "None".
  // Keep the raw mapping; downstream can interpret.
  return raw;
}

// ───── Persistence ─────────────────────────────────────────────────────

function withinBbox(lng: number, lat: number, bbox?: BoundingBox): boolean {
  if (!bbox) return true;
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

async function persistPlace(
  raw: unknown,
  bbox: BoundingBox | undefined,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = PlaceSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "nps: place schema mismatch — skipped");
    return "skipped";
  }
  const p = parsed.data;
  const coords = parseLatLng(p.latitude, p.longitude);
  if (!coords) return "skipped";
  if (!withinBbox(coords[0], coords[1], bbox)) return "skipped";

  const externalId = `nps:place:${p.id}`;
  if (dryRun) {
    logger.debug({ externalId, name: p.title }, "nps: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: p.title,
      inferredCategory: inferPlaceCategory(p),
      point: coords,
      rawPayload: { place: p, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizePlace(p),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "nps: place upsert failed");
    return "error";
  }
}

function inferPlaceCategory(p: Place): string | null {
  // NPS places carry semantic tags. Map common ones to canonical categories.
  const tags = (p.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => /visitor center/.test(t))) return "visitor_center";
  if (tags.some((t) => /trailhead/.test(t))) return "trailhead";
  if (tags.some((t) => /overlook|viewpoint|vista/.test(t))) return "viewpoint";
  if (tags.some((t) => /campground/.test(t))) return "campground";
  if (tags.some((t) => /picnic/.test(t))) return "picnic_area";
  // Default — preserves nps:place category for downstream inspection.
  return "park_feature";
}

async function persistCampground(
  raw: unknown,
  bbox: BoundingBox | undefined,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  const parsed = CampgroundSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "nps: campground schema mismatch — skipped");
    return "skipped";
  }
  const c = parsed.data;
  const coords = parseLatLng(c.latitude, c.longitude);
  if (!coords) return "skipped";
  if (!withinBbox(coords[0], coords[1], bbox)) return "skipped";

  const externalId = `nps:campground:${c.id}`;
  if (dryRun) {
    logger.debug({ externalId, name: c.name }, "nps: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: c.name,
      inferredCategory: "campground",
      point: coords,
      rawPayload: { campground: c, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeCampground(c),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "nps: campground upsert failed");
    return "error";
  }
}

/**
 * Persist the park itself as a synthetic source_record with a centroid point
 * + the boundary polygon stored in normalized_payload.geometry_polygon.
 *
 * Why not write directly to master_place.geometry_polygon? Because
 * master_place is only populated by entity resolution (week 3), and bypassing
 * that breaks the resolution invariant. Week 3's recompute_master_place will
 * promote this polygon via field_precedence.
 */
async function persistParkBoundary(
  parkCode: string,
  boundary: unknown,
  park: Park | null,
  dryRun: boolean,
): Promise<"inserted" | "skipped" | "error"> {
  // Extract a primary polygon geometry + a representative point for the
  // source_record's required point field.
  const geometry = extractPolygonGeometry(boundary);
  if (!geometry) {
    logger.warn({ parkCode }, "nps: could not extract polygon from boundary response");
    return "skipped";
  }
  const centroid = polygonCentroid(geometry);
  if (!centroid) {
    logger.warn({ parkCode }, "nps: could not compute centroid for boundary");
    return "skipped";
  }

  const externalId = `nps:park:${parkCode}`;
  // Real park name from /parks (fullName), e.g. "Joshua Tree National Park".
  // Falls back to the synthetic string only when /parks is unavailable so the
  // boundary polygon still lands. This name is NPS's authoritative canonical_name
  // (field_precedence priority 1) — the whole point of wiring /parks.
  const fullName = park?.fullName?.trim();
  const name = fullName && fullName.length > 0 ? fullName : `NPS park boundary: ${parkCode}`;
  if (dryRun) {
    logger.debug({ externalId, parkCode, name }, "nps: dry-run");
    return "inserted";
  }
  const phone = park?.contacts?.phoneNumbers?.find(
    (p): p is { phoneNumber: string } => typeof p.phoneNumber === "string" && p.phoneNumber.length > 0,
  )?.phoneNumber;
  const contact = compact({ website: park?.url ?? undefined, phone });
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: "park",
      point: centroid,
      // Full /parks object stashed here — designation, entranceFees, addresses,
      // etc. live in raw_payload, not in invented normalized fields.
      rawPayload: { boundary, park: park ?? null, fetched_at: new Date().toISOString() },
      normalizedPayload: {
        canonical_name: name,
        description: park?.description ?? null,
        overlander_tags: ["federal_land", "nps"],
        contact: Object.keys(contact).length ? contact : null,
        access: null,
        amenities: null,
        hours: park?.operatingHours && park.operatingHours.length ? { raw: park.operatingHours } : null,
        // The key Phase-1 deliverable for parks: GeoJSON polygon for
        // recompute_master_place() to promote later.
        geometry_polygon: geometry,
      },
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "nps: park boundary upsert failed");
    return "error";
  }
}

/**
 * Walk the various shapes the boundary endpoint may return and pull out
 * a Polygon or MultiPolygon. If a FeatureCollection contains multiple
 * features, prefer the one with the most coordinates (heuristic for "main"
 * boundary vs satellite annexes).
 */
function extractPolygonGeometry(boundary: unknown): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null {
  if (!boundary || typeof boundary !== "object") return null;
  const b = boundary as { type?: string; geometry?: unknown; features?: unknown[]; coordinates?: unknown };

  if (b.type === "Polygon" || b.type === "MultiPolygon") {
    return { type: b.type, coordinates: b.coordinates };
  }
  if (b.type === "Feature" && b.geometry && typeof b.geometry === "object") {
    return extractPolygonGeometry(b.geometry);
  }
  if (b.type === "FeatureCollection" && Array.isArray(b.features)) {
    let best: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null = null;
    let bestSize = -1;
    for (const f of b.features) {
      const g = extractPolygonGeometry(f);
      if (!g) continue;
      const size = JSON.stringify(g.coordinates).length;
      if (size > bestSize) {
        best = g;
        bestSize = size;
      }
    }
    return best;
  }
  return null;
}

/**
 * Rough centroid of the polygon's bbox. Good enough for a source_record's
 * required point — the canonical center will come from NPS /parks at
 * resolution time.
 */
function polygonCentroid(geom: { type: "Polygon" | "MultiPolygon"; coordinates: unknown }): [number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const walk = (node: unknown): void => {
    if (Array.isArray(node) && node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      const [lng, lat] = node as [number, number];
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    if (Array.isArray(node)) for (const child of node) walk(child);
  };
  walk(geom.coordinates);
  if (!Number.isFinite(west)) return null;
  return [(west + east) / 2, (south + north) / 2];
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  if (!opts.parkCodes || opts.parkCodes.length === 0) {
    throw new Error(
      "nps: --park-codes is required (e.g. --park-codes jotr). NPS API is parkCode-driven.",
    );
  }
  const bbox = opts.bbox;
  if (bbox) logger.info({ bbox, parkCodes: opts.parkCodes }, "nps: bbox + parkCodes");
  else logger.info({ parkCodes: opts.parkCodes }, "nps: parkCodes only (no bbox filter)");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.nps;

  for (const parkCode of opts.parkCodes) {
    await Promise.all([
      limit(async () => {
        const places = await fetchPaginated("places", parkCode);
        stats.fetched += places.length;
        logger.info({ parkCode, count: places.length }, "nps: places fetched");
        for (const raw of places) {
          const outcome = await persistPlace(raw, bbox, opts.dryRun ?? false);
          if (outcome === "inserted") stats.inserted += 1;
          else if (outcome === "skipped") stats.skipped += 1;
          else stats.errors += 1;
        }
      }),
      limit(async () => {
        const campgrounds = await fetchPaginated("campgrounds", parkCode);
        stats.fetched += campgrounds.length;
        logger.info({ parkCode, count: campgrounds.length }, "nps: campgrounds fetched");
        for (const raw of campgrounds) {
          const outcome = await persistCampground(raw, bbox, opts.dryRun ?? false);
          if (outcome === "inserted") stats.inserted += 1;
          else if (outcome === "skipped") stats.skipped += 1;
          else stats.errors += 1;
        }
      }),
      limit(async () => {
        const [boundary, park] = await Promise.all([
          fetchParkBoundary(parkCode),
          fetchPark(parkCode),
        ]);
        if (!boundary) return;
        stats.fetched += 1;
        const outcome = await persistParkBoundary(parkCode, boundary, park, opts.dryRun ?? false);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }),
    ]);
  }

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "nps: ingestion complete");
  return result;
};

export default ingest;

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  ingest({ dryRun, parkCodes: [] })
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      logger.error({ err }, "nps: fatal");
      process.exit(1);
    });
}
