/**
 * Parks Canada ingester (Phase 1.5 source #5, Segment B prerequisite).
 *
 * Federal authoritative source for Canadian national parks, national
 * historic sites, and national marine conservation areas. The Canadian
 * parallel to NPS (US): highest source_quality_score for sites it
 * manages (0.95), authoritative geometry + canonical names.
 *
 * Three endpoint groups consumed:
 *
 *   1. NPLB (National Parks Legislative Boundaries — NRCan MapServer)
 *      → park-boundary polygons, mirrors NPS's geometry_polygon pattern.
 *      Stored as source_records with inferred_category='park_boundary'
 *      and the polygon in normalized_payload.geometry_polygon for
 *      week-3 recompute_master_place to promote.
 *
 *   2. Accommodation (ArcGIS Online FeatureServer)
 *      → campsite point data. Weekly updates, not necessarily complete
 *      per Parks Canada's own dataset description — surface gaps in
 *      the eventual Segment B execution log.
 *
 *   3. Interest Points (ArcGIS Online FeatureServer)
 *      → trailheads, viewpoints, picnic areas, visitor centres, and
 *      other POIs. Native SRS is 3857; query forces outSR=4326.
 *
 * fed_exact does NOT fire for Parks Canada in this PR: Parks Canada
 * Reservation Service (the would-be partner) has no public API. The
 * matcher hardcodes nps/ridb as the fed_exact pair; extension is
 * deferred (tracked item). name_dominant + standard scoring federate
 * with Google.
 *
 * License: Open Government Licence - Canada. No product-side attribution
 * requirement; attribution in documentation suffices.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source parks_canada --bbox W,S,E,N
 */

import { z } from "zod";

import type { BoundingBox } from "../lib/geometry.ts";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import { limits } from "../lib/rate-limit.ts";
import { defaultRetry } from "../lib/retry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "parks_canada";
const SOURCE_QUALITY_SCORE = 0.95;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";
const PAGE_SIZE = 1000;

// ───── Endpoints ───────────────────────────────────────────────────────
//
// Resolved via Open Government Portal dataset metadata 2026-05-30. If
// any of these move, the dataset landing pages link to the current URL:
//
//   National Parks Legislative Boundaries:
//     https://open.canada.ca/data/en/dataset/9e1507cd-f25c-4c64-995b-6563bf9d65bd
//   Accommodation (campsites):
//     https://open.canada.ca/data/en/dataset/74054d44-68cf-41af-8919-5f09f80dcd02
//   Interest Points:
//     https://open.canada.ca/data/en/dataset/cf5c266c-3a6a-4a3b-aed1-2ddd6e49d5e6

const ENDPOINTS = {
  boundaries:
    "https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/1",
  accommodation:
    "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0",
  interestPoints:
    "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Interest_Point_Interet_V2_FGP/FeatureServer/0",
} as const;

// ───── ESRI GeoJSON envelope ───────────────────────────────────────────
//
// All three endpoints respond identically when queried with `f=geojson`:
// a GeoJSON FeatureCollection wrapping endpoint-specific `properties`.
// Endpoint-specific attribute shapes are validated against narrower
// schemas inside the persistence path; the wrapper schema is shared.

const GeoJsonGeometrySchema = z
  .object({
    type: z.string(),
    coordinates: z.unknown(),
  })
  .passthrough();

const GeoJsonFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: GeoJsonGeometrySchema.nullable(),
    properties: z.record(z.unknown()),
  })
  .passthrough();

const GeoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(GeoJsonFeatureSchema),
  // ESRI sets `exceededTransferLimit: true` when a paginated response
  // hit the server-side cap. Use it as a pagination hint when present;
  // fall back to count-based pagination otherwise.
  exceededTransferLimit: z.boolean().optional(),
});

type EsriFeature = z.infer<typeof GeoJsonFeatureSchema>;

// ───── Per-endpoint attribute schemas ──────────────────────────────────
//
// `.passthrough()` because the upstream datasets carry many fields we
// don't normalize today (bilingual names, regional codes, last-modified,
// etc.). Raw payload retains everything; the schemas extract only what
// the normalizer needs.

const BoundaryPropsSchema = z
  .object({
    OBJECTID: z.union([z.number(), z.string()]).optional(),
    // NPLB attribute keys vary in casing across deployments — accept
    // the common variants and let the normalizer pick the first present.
    AdminAreaNameEn: z.string().nullable().optional(),
    AdminAreaNameFr: z.string().nullable().optional(),
    AdminAreaType: z.string().nullable().optional(),
    AdminAreaID: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();

const AccommodationPropsSchema = z
  .object({
    OBJECTID: z.union([z.number(), z.string()]).optional(),
    AssetID: z.union([z.string(), z.number()]).nullable().optional(),
    NameEn: z.string().nullable().optional(),
    NameFr: z.string().nullable().optional(),
    LocationEn: z.string().nullable().optional(),
    LocationFr: z.string().nullable().optional(),
    AccommodationTypeEn: z.string().nullable().optional(),
    AccommodationTypeFr: z.string().nullable().optional(),
  })
  .passthrough();

const InterestPointPropsSchema = z
  .object({
    OBJECTID: z.union([z.number(), z.string()]).optional(),
    AssetID: z.union([z.string(), z.number()]).nullable().optional(),
    NameEn: z.string().nullable().optional(),
    NameFr: z.string().nullable().optional(),
    InterestTypeEn: z.string().nullable().optional(),
    InterestTypeFr: z.string().nullable().optional(),
    LocationEn: z.string().nullable().optional(),
    LocationFr: z.string().nullable().optional(),
  })
  .passthrough();

// ───── HTTP ────────────────────────────────────────────────────────────

/**
 * Query an ESRI REST layer (MapServer or FeatureServer) for features
 * inside `bbox`, returning a parsed FeatureCollection. Handles pagination
 * via resultOffset; merges all pages into a single collection.
 *
 * Coercion details:
 *   - inSR=4326 — interpret the bbox as WGS84.
 *   - outSR=4326 — force WGS84 output (Interest Points is native 3857).
 *   - f=geojson — bypass ESRI JSON encoding for downstream simplicity.
 *
 * Bbox encoding: ESRI Envelope is xmin,ymin,xmax,ymax — matches our
 * [W,S,E,N] tuple ordering directly.
 */
async function fetchEsriLayer(
  serviceUrl: string,
  bbox: BoundingBox,
  label: string,
): Promise<EsriFeature[]> {
  const features: EsriFeature[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${serviceUrl}/query`);
    url.searchParams.set("where", "1=1");
    url.searchParams.set("geometry", bbox.join(","));
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("outFields", "*");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));

    const page = await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `parks_canada ${label} ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      const json = await res.json();
      const parsed = GeoJsonFeatureCollectionSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { err: parsed.error.flatten(), label },
          "parks_canada: response failed FeatureCollection validation",
        );
        throw new Error(`parks_canada ${label}: schema mismatch`);
      }
      return parsed.data;
    }, `parks_canada.${label}.fetch`);

    features.push(...page.features);
    logger.debug(
      { label, offset, pageSize: page.features.length, total: features.length },
      "parks_canada: page",
    );

    // Pagination terminates when the page returns fewer than PAGE_SIZE
    // features AND the server didn't set exceededTransferLimit (which
    // would signal "there's more — fetch the next page"). Either signal
    // sufficient.
    const shortPage = page.features.length < PAGE_SIZE;
    const transferLimitHit = page.exceededTransferLimit === true;
    if (shortPage && !transferLimitHit) break;
    offset += page.features.length;
    if (page.features.length === 0) break; // safety: never infinite-loop
  }

  return features;
}

// ───── Geometry helpers ────────────────────────────────────────────────

function parsePoint(geom: EsriFeature["geometry"]): [number, number] | null {
  if (!geom || geom.type !== "Point") return null;
  const c = geom.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = c[0];
  const lat = c[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (Number.isNaN(lng) || Number.isNaN(lat)) return null;
  if (lng === 0 && lat === 0) return null;
  return [lng, lat];
}

function extractPolygon(
  geom: EsriFeature["geometry"],
): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null {
  if (!geom) return null;
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return { type: geom.type, coordinates: geom.coordinates };
  }
  return null;
}

function bboxCentroid(
  geom: { type: "Polygon" | "MultiPolygon"; coordinates: unknown },
): [number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (node: unknown): void => {
    if (
      Array.isArray(node) &&
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
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

// ───── Bilingual name preference + category mapping ────────────────────

function pickName(en: unknown, fr: unknown, fallback: string): string {
  if (typeof en === "string" && en.trim().length > 0) return en.trim();
  if (typeof fr === "string" && fr.trim().length > 0) return fr.trim();
  return fallback;
}

/**
 * Map a Parks Canada boundary admin-area type to a canonical category.
 * NPLB's AdminAreaType values (observed): "National Park",
 * "National Park Reserve", "National Marine Conservation Area",
 * "National Historic Site", "National Urban Park".
 *
 * All boundaries land as `park_boundary` to match the existing NPS
 * pattern — geometry_polygon is the substantive payload; the type
 * detail lives in normalized_payload for future precedence resolution.
 */
function inferBoundaryCategory(_typeRaw: unknown): string {
  return "park_boundary";
}

/**
 * Accommodation rows are campgrounds at the corpus level. The exact
 * AccommodationType (front-country campground / oTENTik / yurt / etc.)
 * is preserved in raw_payload + normalized_payload.accommodation_type;
 * the canonical category stays `campground` for matcher uniformity.
 */
function inferAccommodationCategory(_typeRaw: unknown): string {
  return "campground";
}

/**
 * Interest Points carry a heterogeneous InterestType. Map common values
 * to canonical categories; unknown types fall back to `park_feature`
 * (the same default NPS uses for its non-categorized places).
 */
function inferInterestPointCategory(typeRaw: unknown): string {
  if (typeof typeRaw !== "string") return "park_feature";
  const t = typeRaw.toLowerCase();
  if (/trail\s?head|trail head/.test(t)) return "trailhead";
  if (/viewpoint|lookout|vista|belvédère|belvedere/.test(t)) return "viewpoint";
  if (/picnic/.test(t)) return "picnic_area";
  if (/visitor|interpret/.test(t)) return "visitor_center";
  if (/historic\s?site|lieu historique/.test(t)) return "national_historic_site";
  if (/marine/.test(t)) return "national_marine_conservation_area";
  if (/camp/.test(t)) return "campground";
  return "park_feature";
}

// ───── Normalizers ─────────────────────────────────────────────────────

function normalizeBoundary(
  props: z.infer<typeof BoundaryPropsSchema>,
  polygon: { type: "Polygon" | "MultiPolygon"; coordinates: unknown },
  name: string,
): Record<string, unknown> {
  return {
    canonical_name: name,
    description: null,
    overlander_tags: ["federal_land", "parks_canada"],
    contact: null,
    access: null,
    amenities: null,
    hours: null,
    // Promoted by recompute_master_place via field_precedence in week 3,
    // identical mechanism to nps.ts's geometry_polygon path.
    geometry_polygon: polygon,
    admin_area_type: props.AdminAreaType ?? null,
  };
}

function normalizeAccommodation(
  props: z.infer<typeof AccommodationPropsSchema>,
  name: string,
): Record<string, unknown> {
  const accommodationType = pickName(
    props.AccommodationTypeEn,
    props.AccommodationTypeFr,
    "",
  );
  const location = pickName(props.LocationEn, props.LocationFr, "");
  return {
    canonical_name: name,
    description: location.length > 0 ? location : null,
    overlander_tags: ["federal_land", "parks_canada"],
    contact: null,
    access: null,
    amenities: accommodationType.length
      ? compact({ accommodation_type: accommodationType })
      : null,
    hours: null,
  };
}

function normalizeInterestPoint(
  props: z.infer<typeof InterestPointPropsSchema>,
  name: string,
): Record<string, unknown> {
  const interestType = pickName(
    props.InterestTypeEn,
    props.InterestTypeFr,
    "",
  );
  const location = pickName(props.LocationEn, props.LocationFr, "");
  return {
    canonical_name: name,
    description: location.length > 0 ? location : null,
    overlander_tags: ["federal_land", "parks_canada"],
    contact: null,
    access: null,
    amenities: interestType.length
      ? compact({ interest_type: interestType })
      : null,
    hours: null,
  };
}

// ───── Persistence ─────────────────────────────────────────────────────

type PersistOutcome = "inserted" | "skipped" | "error";

async function persistBoundary(
  feature: EsriFeature,
  dryRun: boolean,
): Promise<PersistOutcome> {
  const parsed = BoundaryPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn(
      { err: parsed.error.flatten() },
      "parks_canada: boundary props schema mismatch — skipped",
    );
    return "skipped";
  }
  const props = parsed.data;
  const polygon = extractPolygon(feature.geometry);
  if (!polygon) {
    logger.warn(
      { props_keys: Object.keys(props) },
      "parks_canada: boundary feature missing polygon geometry — skipped",
    );
    return "skipped";
  }
  const centroid = bboxCentroid(polygon);
  if (!centroid) return "skipped";

  const objectId = props.OBJECTID ?? props.AdminAreaID ?? "";
  if (objectId === "") {
    logger.warn(
      { props_keys: Object.keys(props) },
      "parks_canada: boundary missing OBJECTID/AdminAreaID — skipped",
    );
    return "skipped";
  }
  const externalId = `parks_canada:boundary:${objectId}`;
  const name = pickName(
    props.AdminAreaNameEn,
    props.AdminAreaNameFr,
    `Parks Canada boundary ${objectId}`,
  );

  if (dryRun) {
    logger.debug({ externalId, name }, "parks_canada: dry-run boundary");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: inferBoundaryCategory(props.AdminAreaType),
      point: centroid,
      rawPayload: { feature, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeBoundary(props, polygon, name),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "parks_canada: boundary upsert failed");
    return "error";
  }
}

async function persistAccommodation(
  feature: EsriFeature,
  dryRun: boolean,
): Promise<PersistOutcome> {
  const parsed = AccommodationPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn(
      { err: parsed.error.flatten() },
      "parks_canada: accommodation props schema mismatch — skipped",
    );
    return "skipped";
  }
  const props = parsed.data;
  const point = parsePoint(feature.geometry);
  if (!point) return "skipped";

  const objectId = props.AssetID ?? props.OBJECTID ?? "";
  if (objectId === "") return "skipped";
  const externalId = `parks_canada:accommodation:${objectId}`;
  const name = pickName(
    props.NameEn,
    props.NameFr,
    `Parks Canada accommodation ${objectId}`,
  );

  if (dryRun) {
    logger.debug({ externalId, name }, "parks_canada: dry-run accommodation");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: inferAccommodationCategory(props.AccommodationTypeEn),
      point,
      rawPayload: { feature, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeAccommodation(props, name),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error(
      { err, externalId },
      "parks_canada: accommodation upsert failed",
    );
    return "error";
  }
}

async function persistInterestPoint(
  feature: EsriFeature,
  dryRun: boolean,
): Promise<PersistOutcome> {
  const parsed = InterestPointPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn(
      { err: parsed.error.flatten() },
      "parks_canada: interest point props schema mismatch — skipped",
    );
    return "skipped";
  }
  const props = parsed.data;
  const point = parsePoint(feature.geometry);
  if (!point) return "skipped";

  const objectId = props.AssetID ?? props.OBJECTID ?? "";
  if (objectId === "") return "skipped";
  const externalId = `parks_canada:interest_point:${objectId}`;
  const name = pickName(
    props.NameEn,
    props.NameFr,
    `Parks Canada interest point ${objectId}`,
  );

  if (dryRun) {
    logger.debug({ externalId, name }, "parks_canada: dry-run interest_point");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: inferInterestPointCategory(props.InterestTypeEn),
      point,
      rawPayload: { feature, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeInterestPoint(props, name),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error(
      { err, externalId },
      "parks_canada: interest_point upsert failed",
    );
    return "error";
  }
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (
  opts: IngestOptions,
): Promise<IngestResult> => {
  const startedAt = Date.now();
  const bbox = opts.bbox;
  if (!bbox) {
    throw new Error(
      "parks_canada: --bbox is required. The Parks Canada ESRI endpoints have no parkCode equivalent — geographic filter is the primary input.",
    );
  }
  logger.info({ bbox }, "parks_canada: ingest start");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.parks_canada;
  if (!limit) {
    throw new Error("parks_canada: rate limiter missing — check lib/rate-limit.ts");
  }

  const dryRun = opts.dryRun ?? false;

  await Promise.all([
    limit(async () => {
      const features = await fetchEsriLayer(
        ENDPOINTS.boundaries,
        bbox,
        "boundaries",
      );
      stats.fetched += features.length;
      logger.info(
        { count: features.length },
        "parks_canada: boundaries fetched",
      );
      for (const feature of features) {
        const outcome = await persistBoundary(feature, dryRun);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }
    }),
    limit(async () => {
      const features = await fetchEsriLayer(
        ENDPOINTS.accommodation,
        bbox,
        "accommodation",
      );
      stats.fetched += features.length;
      logger.info(
        { count: features.length },
        "parks_canada: accommodation fetched",
      );
      for (const feature of features) {
        const outcome = await persistAccommodation(feature, dryRun);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }
    }),
    limit(async () => {
      const features = await fetchEsriLayer(
        ENDPOINTS.interestPoints,
        bbox,
        "interest_points",
      );
      stats.fetched += features.length;
      logger.info(
        { count: features.length },
        "parks_canada: interest_points fetched",
      );
      for (const feature of features) {
        const outcome = await persistInterestPoint(feature, dryRun);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }
    }),
  ]);

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "parks_canada: ingestion complete");
  return result;
};

export default ingest;

// Test seam: exported so unit tests can exercise the pure helpers without
// hitting the network or DB.
export const _internals = {
  bboxCentroid,
  extractPolygon,
  inferAccommodationCategory,
  inferBoundaryCategory,
  inferInterestPointCategory,
  normalizeAccommodation,
  normalizeBoundary,
  normalizeInterestPoint,
  parsePoint,
  pickName,
};
