/**
 * BC Parks ingester (Phase 1.5 source #6, Segment B prerequisite).
 *
 * Provincial authority for British Columbia's ~1,000 provincial parks,
 * conservancies, ecological reserves, and protected areas. Sits below
 * Parks Canada in the Canadian federal/provincial hierarchy
 * (source_quality_score 0.90 vs Parks Canada 0.95). Establishes the
 * provincial source pattern Alberta Parks will reuse.
 *
 * ─── Data-shape note: BC Parks is park-scoped, NOT point-scoped ───
 *
 * Unlike Parks Canada (per-campsite Accommodation records with their own
 * coordinates), BC's open data publishes ONE record per protected area
 * with AGGREGATED amenity summaries. You can know "this park has
 * RV-accessible camping" but not "this campground is at these
 * coordinates." There is no per-campground point dataset in DataBC
 * (verified during the 2026-05-31 API-surface investigation). Campsite-
 * level granularity in BC will come from iOverlander, not BC Parks.
 *
 *   Implications (carried into the PR body + Segment B execution):
 *     a. The BC Parks corpus is ~1,000 records (one per protected area),
 *        NOT the ~2,000–4,000 the Segment B spec estimated from a
 *        per-campsite assumption. Revise that estimate at execution time.
 *     b. iOverlander carries BC campsite-level granularity. BC Parks
 *        (polygons + summary amenities) + iOverlander (campsite UGC)
 *        together reach Parks-Canada-equivalent coverage for BC.
 *     c. BC Parks × Google federation is correct-by-design: BC Parks
 *        contributes the polygon + park-level amenity summary while Google
 *        contributes commercial point data (reservation pages, visitor-
 *        centre addresses) — different aspects of the same physical park.
 *
 * Two upstream surfaces, joined on the ORCS park code:
 *
 *   1. DataBC WFS (OGC WFS 2.0 / GeoJSON) — park-boundary polygons.
 *      Layer WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW. bbox-native query;
 *      drives the in-corridor park set. Stored as source_records with
 *      inferred_category='park_boundary' (reusing the Parks Canada
 *      category — no matcher.ts / category_compatibility change) and the
 *      polygon in normalized_payload.geometry_polygon for week-3
 *      recompute_master_place promotion.
 *
 *   2. BC Parks REST API (bcparks.api.gov.bc.ca, Strapi v5) — per-park
 *      enrichment by ORCS: title-case canonical name, representative
 *      point (latitude/longitude), official URL, curated description,
 *      and the camping-type / facility amenity summary.
 *
 * One source_record per park (per ORCS): WFS supplies geometry, REST
 * supplies attributes. Multi-parcel parks (one ORCS spread across
 * several WFS polygon rows via ORCS_SECONDARY) are merged into a single
 * MultiPolygon record.
 *
 * fed_exact does NOT fire for BC Parks: it is reserved for federal-source
 * pairs (NPS↔RIDB). BC Parks is provincial; name_dominant carries the
 * BC Parks × Google federation. amenity_rollup, name_dominant,
 * close_nameless, and the same-source guard all apply as standard.
 *
 * License: Open Government Licence – British Columbia (data). Doc-level
 * attribution suffices; no product-side attribution requirement.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source bc_parks --bbox W,S,E,N
 */

import { z } from "zod";

import type { BoundingBox } from "../lib/geometry.ts";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact, titleCase } from "../lib/normalize.ts";
import { limits } from "../lib/rate-limit.ts";
import { defaultRetry } from "../lib/retry.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "bc_parks";
const SOURCE_QUALITY_SCORE = 0.9;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";
const WFS_PAGE_SIZE = 1000;

// ───── Endpoints ───────────────────────────────────────────────────────
//
// Resolved via the DataBC catalogue (catalogue.data.gov.bc.ca CKAN API)
// 2026-05-31. The parks polygon layer is served via OGC WFS only (no
// ESRI REST surface). The BC Parks REST API base comes from the
// "BC Parks Data API Access" dataset's Kong service definition.
//
//   BC Parks, Ecological Reserves, and Protected Areas (WFS layer):
//     https://catalogue.data.gov.bc.ca/dataset/bc-parks-ecological-reserves-and-protected-areas
//   BC Parks Data API Access (REST/GraphQL):
//     https://catalogue.data.gov.bc.ca/dataset/bc-parks-data-api-access

const WFS_BASE = "https://openmaps.gov.bc.ca/geo/pub";
const BOUNDARIES_LAYER = "WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW";
const REST_BASE = "https://bcparks.api.gov.bc.ca/api";

// ───── WFS GeoJSON envelope ─────────────────────────────────────────────
//
// DataBC WFS 2.0 returns standard GeoJSON when queried with
// outputFormat=application/json. Shared wrapper schema; the per-layer
// attribute shape is validated separately inside the persistence path.

const GeoJsonGeometrySchema = z
  .object({ type: z.string(), coordinates: z.unknown() })
  .passthrough();

const GeoJsonFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: GeoJsonGeometrySchema.nullable(),
    properties: z.record(z.unknown()),
  })
  .passthrough();

const GeoJsonFeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(GeoJsonFeatureSchema),
    // WFS 2.0 pagination metadata. Present but we terminate on a short
    // page rather than trusting numberMatched, matching the Parks Canada
    // pattern.
    numberReturned: z.number().optional(),
    numberMatched: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

type WfsFeature = z.infer<typeof GeoJsonFeatureSchema>;

// WFS boundary attributes (WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW).
// `.passthrough()` — the layer carries many fields we don't normalize
// (FEATURE_CODE, surveyor plan numbers, OBJECTID, etc.); the raw payload
// retains everything.
//
// ORCS_PRIMARY is the BC Parks canonical park code — genuinely
// park-scoped-stable and verified unique-per-row (39/39 distinct in the
// corridor sample). It is, however, zero-padded here ("0385") while the
// REST API serves it unpadded (385); the join MUST normalize via
// normalizeOrcs(). One ORCS can span multiple polygon rows (distinct
// ORCS_SECONDARY) for multi-parcel parks — those merge into one record.
const BoundaryPropsSchema = z
  .object({
    ORCS_PRIMARY: z.union([z.string(), z.number()]).nullable().optional(),
    ORCS_SECONDARY: z.union([z.string(), z.number()]).nullable().optional(),
    PROTECTED_LANDS_NAME: z.string().nullable().optional(),
    PROTECTED_LANDS_DESIGNATION: z.string().nullable().optional(),
    PARK_CLASS: z.string().nullable().optional(),
    OBJECTID: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

// ───── BC Parks REST API (Strapi v5, flat shape) ───────────────────────
//
// GET /protected-areas?filters[orcs][$eq]=<orcs>
//     &populate[parkFacilities][fields][0]=name
//     &populate[parkCampingTypes][fields][0]=name
//
// Strapi v5 returns `{ data: [ { ...flat fields..., parkFacilities: [],
// parkCampingTypes: [] } ] }` — fields and relations live directly on the
// data item (no v4 `attributes`/`data` wrapping). Amenity `name` values
// are prefixed "<n>:Label" (e.g. "2:EV Charging") — strip via
// stripAmenityPrefix().

const RestAmenitySchema = z
  .object({ name: z.string().nullable().optional() })
  .passthrough();

const ProtectedAreaSchema = z
  .object({
    orcs: z.union([z.number(), z.string()]).nullable().optional(),
    protectedAreaName: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    class: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    parkFacilities: z.array(RestAmenitySchema).nullable().optional(),
    parkCampingTypes: z.array(RestAmenitySchema).nullable().optional(),
  })
  .passthrough();

const RestResponseSchema = z
  .object({ data: z.array(ProtectedAreaSchema) })
  .passthrough();

type ProtectedArea = z.infer<typeof ProtectedAreaSchema>;

// ───── Identifier + text helpers ───────────────────────────────────────

/**
 * Normalize an ORCS park code to the canonical join key. WFS serves it
 * zero-padded ("0385", "0002"); the REST API serves it unpadded (385, 2).
 * parseInt collapses both to the same string. Returns "" for anything
 * non-numeric so callers can skip rather than mis-key.
 *
 * This is the WFS↔REST join key AND the external_id seed; getting it
 * wrong silently breaks every park's enrichment (the BC analogue of the
 * Parks Canada Site_Num_Site trap), so it is the most-tested helper.
 */
function normalizeOrcs(raw: unknown): string {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(Math.trunc(raw)) : "";
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return "";
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? "" : String(n);
  }
  return "";
}

/**
 * BC Parks amenity `name` values arrive prefixed with the park's numeric
 * code and a colon — "2:EV Charging", "9781:Wilderness camping". Strip
 * the "<digits>:" prefix; leave already-clean labels untouched.
 */
function stripAmenityPrefix(name: string): string {
  return name.replace(/^\s*\d+\s*:\s*/, "").trim();
}

/**
 * Best-effort plain-text from a possibly-HTML description (the REST API's
 * `description` is rich text). Strips tags + common entities, collapses
 * whitespace. Returns null for empty/non-string input.
 */
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/** Return a trimmed http(s) URL, or null. */
function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.startsWith("http") ? t : null;
}

// ───── Geometry helpers ────────────────────────────────────────────────

function extractPolygon(
  geom: WfsFeature["geometry"],
): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null {
  if (!geom) return null;
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return { type: geom.type, coordinates: geom.coordinates };
  }
  return null;
}

/**
 * Merge a park's parcel polygons into one geometry. A single parcel keeps
 * its Polygon/MultiPolygon shape; multiple parcels combine into one
 * MultiPolygon (each Polygon contributes one member; each MultiPolygon
 * contributes its members). Returns null when nothing parseable remains.
 */
function mergePolygons(
  polys: Array<{ type: "Polygon" | "MultiPolygon"; coordinates: unknown }>,
): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null {
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  const coordinates: unknown[] = [];
  for (const p of polys) {
    if (p.type === "Polygon") {
      coordinates.push(p.coordinates);
    } else if (Array.isArray(p.coordinates)) {
      coordinates.push(...p.coordinates);
    }
  }
  return { type: "MultiPolygon", coordinates };
}

function bboxCentroid(geom: {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}): [number, number] | null {
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

/**
 * Build a [lng, lat] point from the REST API's latitude/longitude
 * scalars. Returns null for missing/NaN/(0,0) sentinel values.
 */
function restPoint(lat: unknown, lng: unknown): [number, number] | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return [lng, lat];
}

// ───── Name + amenity + category mapping ───────────────────────────────

/**
 * Prefer the REST API's title-case `protectedAreaName` ("Mount Robson
 * Park"); fall back to the Title-Cased WFS name (which arrives ALL-CAPS,
 * "MOUNT ROBSON PARK"); finally the ORCS-stamped fallback.
 */
function pickParkName(
  restName: unknown,
  wfsName: unknown,
  fallback: string,
): string {
  if (typeof restName === "string" && restName.trim().length > 0) {
    return restName.trim();
  }
  if (typeof wfsName === "string" && wfsName.trim().length > 0) {
    return titleCase(wfsName.trim());
  }
  return fallback;
}

/**
 * Build the amenity summary from the park's camping-type + facility
 * relations. Each is a deduplicated, sorted list of prefix-stripped
 * labels. Returns null when the park has neither.
 */
function buildAmenities(
  facilities: Array<{ name?: string | null }>,
  campingTypes: Array<{ name?: string | null }>,
): { camping_types?: string[]; facilities?: string[] } | null {
  const clean = (rows: Array<{ name?: string | null }>): string[] => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (typeof r.name !== "string") continue;
      const label = stripAmenityPrefix(r.name);
      if (label.length > 0) seen.add(label);
    }
    return [...seen].sort();
  };
  const camping = clean(campingTypes);
  const facility = clean(facilities);
  const out: { camping_types?: string[]; facilities?: string[] } = {};
  if (camping.length > 0) out.camping_types = camping;
  if (facility.length > 0) out.facilities = facility;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Every BC protected area — provincial park, protected area, ecological
 * reserve, conservancy, recreation area — lands as `park_boundary`,
 * reusing the Parks Canada category so no matcher.ts /
 * category_compatibility change is needed (locked decision #5). The
 * designation/class detail is preserved in normalized_payload.
 */
function inferParkCategory(): string {
  return "park_boundary";
}

// ───── Normalizer ──────────────────────────────────────────────────────
//
// One park = one source_record. `amenities` is a PARK-LEVEL summary
// (which camping types / facilities the park offers), not per-campsite
// data — BC publishes no campsite-point geometry (see the data-shape note
// at the top of this file). `geometry` is the park's representative point;
// `geometry_polygon` carries the boundary for week-3 promotion + polygon-
// containment ER.
//
// Centroid caveat: the centroid stored on source_record.geometry is the
// park's representative point per the REST API (its true center), NOT
// necessarily within any query bbox the record was returned by. The WFS
// query selects parks whose POLYGON intersects the bbox, so a large park
// clipping a corner (e.g. Wells Gray from a Mount Robson bbox) has a
// centroid well outside that bbox — correct, not a bug. Bbox-filtered
// park queries should therefore use polygon-intersects on
// geometry_polygon, not point-within on geometry.

function normalizePark(args: {
  name: string;
  description: string | null;
  website: string | null;
  amenities: { camping_types?: string[]; facilities?: string[] } | null;
  polygon: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  designation: string | null;
  parkClass: string | null;
  orcs: string;
}): Record<string, unknown> {
  return {
    canonical_name: args.name,
    description: args.description,
    overlander_tags: ["provincial_land", "bc_parks"],
    contact: args.website ? compact({ website: args.website }) : null,
    access: null,
    amenities: args.amenities,
    hours: null,
    // Promoted by recompute_master_place via field_precedence in week 3,
    // identical mechanism to the Parks Canada / NPS geometry_polygon path.
    geometry_polygon: args.polygon,
    park_designation: args.designation,
    park_class: args.parkClass,
    orcs: args.orcs,
  };
}

// ───── HTTP ────────────────────────────────────────────────────────────

/**
 * Query the BC Parks WFS boundary layer for all park polygons
 * intersecting `bbox`, merging paginated GeoJSON pages.
 *
 * Bbox encoding: WFS 2.0 with `urn:ogc:def:crs:EPSG::4326` uses lat/lon
 * (y,x) axis order, so the envelope is ymin,xmin,ymax,xmax =
 * south,west,north,east — NOT the WFS-1.x / ESRI x,y order. Our
 * BoundingBox tuple is [west,south,east,north].
 *
 * srsName=EPSG:4326 forces WGS84 lon/lat GeoJSON output (the layer's
 * native storage is BC Albers EPSG:3005; DataBC reprojects server-side,
 * so no client transform is needed).
 */
async function fetchWfsBoundaries(bbox: BoundingBox): Promise<WfsFeature[]> {
  const [west, south, east, north] = bbox;
  const features: WfsFeature[] = [];
  let startIndex = 0;

  while (true) {
    const url = new URL(`${WFS_BASE}/${BOUNDARIES_LAYER}/ows`);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("version", "2.0.0");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typeName", BOUNDARIES_LAYER);
    url.searchParams.set("outputFormat", "application/json");
    url.searchParams.set("srsName", "EPSG:4326");
    url.searchParams.set("count", String(WFS_PAGE_SIZE));
    url.searchParams.set("startIndex", String(startIndex));
    // GeoServer WFS 2.0 refuses startIndex pagination without a stable
    // sort: "Cannot do natural order without a primary key." This layer
    // has no PK, so we sort by OBJECTID (unique per row) to give every
    // page a deterministic order. Required even on page 0.
    url.searchParams.set("sortBy", "OBJECTID");
    url.searchParams.set(
      "bbox",
      `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`,
    );

    const page = await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `bc_parks boundaries ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      const json = await res.json();
      const parsed = GeoJsonFeatureCollectionSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { err: parsed.error.flatten() },
          "bc_parks: WFS response failed FeatureCollection validation",
        );
        throw new Error("bc_parks boundaries: schema mismatch");
      }
      return parsed.data;
    }, "bc_parks.boundaries.fetch");

    features.push(...page.features);
    logger.debug(
      { startIndex, pageSize: page.features.length, total: features.length },
      "bc_parks: WFS page",
    );

    if (page.features.length < WFS_PAGE_SIZE) break;
    startIndex += page.features.length;
  }

  return features;
}

/**
 * Fetch the BC Parks REST record for one ORCS, populated with the
 * camping-type + facility amenity relations. Returns null when no park
 * matches (the WFS boundary still ingests, geometry-only).
 */
async function fetchProtectedArea(orcs: string): Promise<ProtectedArea | null> {
  const url = new URL(`${REST_BASE}/protected-areas`);
  url.searchParams.set("filters[orcs][$eq]", orcs);
  url.searchParams.set("populate[parkFacilities][fields][0]", "name");
  url.searchParams.set("populate[parkCampingTypes][fields][0]", "name");

  return defaultRetry(async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`bc_parks rest ${orcs} ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const parsed = RestResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { err: parsed.error.flatten(), orcs },
        "bc_parks: REST response failed validation",
      );
      throw new Error(`bc_parks rest ${orcs}: schema mismatch`);
    }
    return parsed.data.data[0] ?? null;
  }, `bc_parks.rest.${orcs}`);
}

// ───── Persistence ─────────────────────────────────────────────────────

type PersistOutcome = "inserted" | "skipped" | "error";

/**
 * Build and upsert one source_record for a park, given all WFS parcel
 * features sharing its ORCS plus the REST enrichment record.
 */
async function persistPark(
  orcs: string,
  features: WfsFeature[],
  dryRun: boolean,
): Promise<PersistOutcome> {
  // Collect parcel polygons from every WFS row for this ORCS.
  const polygons: Array<{ type: "Polygon" | "MultiPolygon"; coordinates: unknown }> = [];
  const wfsProps: Array<z.infer<typeof BoundaryPropsSchema>> = [];
  for (const feature of features) {
    const parsed = BoundaryPropsSchema.safeParse(feature.properties);
    if (parsed.success) wfsProps.push(parsed.data);
    const polygon = extractPolygon(feature.geometry);
    if (polygon) polygons.push(polygon);
  }
  const merged = mergePolygons(polygons);
  if (!merged) {
    logger.warn({ orcs }, "bc_parks: no polygon geometry for park — skipped");
    return "skipped";
  }
  const firstProps = wfsProps[0] ?? {};

  let rest: ProtectedArea | null = null;
  try {
    rest = await fetchProtectedArea(orcs);
  } catch (err) {
    // Enrichment failure is non-fatal: ingest the boundary geometry-only
    // rather than dropping the park. Surfaced in logs for smoke review.
    logger.warn({ err, orcs }, "bc_parks: REST enrichment failed — geometry-only");
  }

  const name = pickParkName(
    rest?.protectedAreaName,
    firstProps.PROTECTED_LANDS_NAME,
    `BC Parks protected area ${orcs}`,
  );
  const point = restPoint(rest?.latitude, rest?.longitude) ?? bboxCentroid(merged);
  if (!point) {
    logger.warn({ orcs }, "bc_parks: no usable point for park — skipped");
    return "skipped";
  }

  const amenities = rest
    ? buildAmenities(rest.parkFacilities ?? [], rest.parkCampingTypes ?? [])
    : null;
  const description = cleanText(rest?.description);
  const website = httpUrl(rest?.url);
  const designation =
    (typeof rest?.type === "string" ? rest.type : null) ??
    firstProps.PROTECTED_LANDS_DESIGNATION ??
    null;
  const parkClass =
    firstProps.PARK_CLASS ??
    (typeof rest?.class === "string" ? rest.class : null) ??
    null;

  const externalId = `bc_parks:park:${orcs}`;

  if (dryRun) {
    logger.debug({ externalId, name, parcels: features.length }, "bc_parks: dry-run park");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: inferParkCategory(),
      point,
      rawPayload: {
        boundaries: features,
        protected_area: rest,
        fetched_at: new Date().toISOString(),
      },
      normalizedPayload: normalizePark({
        name,
        description,
        website,
        amenities,
        polygon: merged,
        designation,
        parkClass,
        orcs,
      }),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "bc_parks: park upsert failed");
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
      "bc_parks: --bbox is required. The DataBC WFS layer is queried by geographic envelope; there is no parkCode-style filter.",
    );
  }
  logger.info({ bbox }, "bc_parks: ingest start");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.bc_parks;
  if (!limit) {
    throw new Error("bc_parks: rate limiter missing — check lib/rate-limit.ts");
  }
  const dryRun = opts.dryRun ?? false;

  // 1. WFS bbox query drives the in-corridor park set.
  const features = await fetchWfsBoundaries(bbox);
  stats.fetched = features.length;

  // 2. Group WFS parcel rows by normalized ORCS — one record per park.
  const groups = new Map<string, WfsFeature[]>();
  for (const feature of features) {
    const parsed = BoundaryPropsSchema.safeParse(feature.properties);
    const orcs = normalizeOrcs(parsed.success ? parsed.data.ORCS_PRIMARY : undefined);
    if (orcs === "") {
      stats.skipped += 1;
      continue;
    }
    const bucket = groups.get(orcs);
    if (bucket) bucket.push(feature);
    else groups.set(orcs, [feature]);
  }
  logger.info(
    { wfs_features: features.length, distinct_parks: groups.size },
    "bc_parks: boundaries fetched + grouped by ORCS",
  );

  // 3. Per park: REST enrich (rate-limited) + upsert.
  await Promise.all(
    [...groups.entries()].map(([orcs, feats]) =>
      limit(async () => {
        const outcome = await persistPark(orcs, feats, dryRun);
        if (outcome === "inserted") stats.inserted += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else stats.errors += 1;
      }),
    ),
  );

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "bc_parks: ingestion complete");
  return result;
};

export default ingest;

// Test seam: exported so unit tests can exercise the pure helpers without
// hitting the network or DB.
export const _internals = {
  bboxCentroid,
  buildAmenities,
  cleanText,
  extractPolygon,
  httpUrl,
  inferParkCategory,
  mergePolygons,
  normalizeOrcs,
  normalizePark,
  pickParkName,
  restPoint,
  stripAmenityPrefix,
};
