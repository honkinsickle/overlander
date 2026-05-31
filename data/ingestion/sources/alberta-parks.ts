/**
 * Alberta Parks ingester (Phase 1.5 source #7, Segment B prerequisite).
 *
 * Provincial authority for Alberta's provincial parks, provincial
 * recreation areas, and wildland provincial parks. Sits below Parks
 * Canada (federal) in the Canadian hierarchy — peer with BC Parks
 * (source_quality_score 0.90). Third instance of the ESRI-REST source
 * pattern (after Parks Canada and BC Parks), and the second instance of
 * the provincial / park-scoped boundary shape established by BC Parks.
 *
 * ─── Data-shape note: Alberta Parks is boundary-polygon only ───
 *
 * Confirmed during the 2026-05-31 API-surface investigation: Alberta's
 * open geospatial platform (GeoDiscover / geospatial.alberta.ca) publishes
 * ONE polygon per protected area in a single consolidated layer. There is
 * NO campground / facility POINT dataset and NO amenity-enrichment REST
 * API anywhere in Alberta's open data (the titan `parks` folder is officer
 * working areas; `recaccess` is hunting access; albertaparks.ca downloads
 * are boundaries / biota lists). Campground-level detail lives only in the
 * Reserve.AlbertaParks.ca reservation system (out of scope, Phase 3b).
 *
 *   Implications (carried into the PR body + Segment B execution):
 *     a. Alberta Parks is THINNER than BC Parks: BC had a Strapi REST API
 *        for per-park amenity summaries; Alberta has none. Alberta
 *        contributes canonical name + boundary polygon + classification
 *        metadata only. description / contact / hours / amenities are
 *        empty — the field_precedence rows for those fields are seeded for
 *        convention + future-proofing, not because Alberta has the data.
 *     b. Campsite-level granularity for Alberta will come from
 *        iOverlander (the next source), not Alberta Parks.
 *     c. The spec's expected Kananaskis campgrounds (Boulton Creek,
 *        Elkwood, Mount Kidd RV) are NOT separately ingestible — they are
 *        campgrounds WITHIN Peter Lougheed PP, not boundary features.
 *        Validation is repointed at the park / PRA boundaries themselves.
 *
 * ─── Scope: PP / PRA / WPP only ───
 *
 * The layer carries 9 designation TYPEs (469 features total). We ingest
 * the three "park-like" overlander-relevant designations — PP (Provincial
 * Park), PRA (Provincial Recreation Area), WPP (Wildland Provincial Park),
 * 305 features — filtered server-side via `TYPE IN (...)`. Deferred:
 * Natural Areas (NA), Ecological Reserves (ER), Wilderness Areas (WA),
 * Heritage Rangeland (HR), Wilderness Park (WP) — largely no-camping
 * conservation lands (mirrors the BC Rec Sites "defer pending corridor
 * results" decision). EXCLUDED outright: National Parks (NP, 5 features) —
 * those are FEDERAL and belong to Parks Canada; ingesting them here would
 * collide with the parks_canada source (the spec's "federal vs provincial
 * don't overlap" assumption is false for this dataset). The `TYPE IN`
 * filter excludes NP implicitly.
 *
 * One source_record per park (per PASITES_ID). Unlike BC Parks, there is
 * one polygon row per PASITES_ID — no multi-parcel grouping needed.
 *
 * fed_exact does NOT fire for Alberta Parks (reserved for federal-source
 * pairs). amenity_rollup, name_dominant, close_nameless, and the
 * same-source guard all apply as standard; name_dominant carries the
 * Alberta Parks × Google federation.
 *
 * License: Open Government Licence – Alberta. Doc-level attribution
 * suffices; no product-side attribution requirement.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source alberta_parks --bbox W,S,E,N
 */

import { z } from "zod";

import { upsertSourceRecord } from "../lib/db.ts";
import { fetchEsriFeatures } from "../lib/esri.ts";
import { bboxCentroid, extractPolygon, type GeoJsonFeature } from "../lib/geojson.ts";
import { logger } from "../lib/logger.ts";
import { limits } from "../lib/rate-limit.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "alberta_parks";
const SOURCE_QUALITY_SCORE = 0.9;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

// Park-like designations we ingest. NP (federal) is excluded by omission;
// the conservation-only designations (NA/ER/WA/HR/WP) are deferred.
const INGESTED_TYPES = ["PP", "PRA", "WPP"] as const;
const TYPE_WHERE = `TYPE IN (${INGESTED_TYPES.map((t) => `'${t}'`).join(",")})`;

// Human-readable label per designation code, used to build the canonical
// name (the layer's NAME field is bare, e.g. "Peter Lougheed").
const DESIGNATION_LABELS: Record<string, string> = {
  PP: "Provincial Park",
  PRA: "Provincial Recreation Area",
  WPP: "Wildland Provincial Park",
};

// ───── Endpoint ────────────────────────────────────────────────────────
//
// Resolved via GeoDiscover Alberta / open.alberta.ca 2026-05-31. Single
// ArcGIS REST FeatureServer layer (Esri v11.3), `supportsPagination`,
// native SRS EPSG:3400 (Alberta 10-TM) — query forces outSR=4326.
//
//   Parks and Protected Areas of Alberta:
//     https://open.alberta.ca/opendata/gda-6b96341f-2e19-4885-98af-66d12ed4f8dd

const ENDPOINT =
  "https://geospatial.alberta.ca/titan/rest/services/boundary/parks_protected_areas_alberta/FeatureServer/0";

// Layer attribute shape (Protected Area Designations). `.passthrough()` —
// the layer carries many fields we don't normalize (STATUS, IUCN, OC_*,
// ACRES, dates, GlobalID); raw_payload retains everything.
//
// PASITES_ID ("Site Identifier") is the park-scoped stable key — verified
// 469/469 distinct, zero nulls in the full-layer sample (NAME is NOT
// unique: "Bow Valley" exists as both a PP and a PRA). It is served as a
// Double (e.g. 10655.0), so normalizePasitesId() truncates to an integer
// string for the external_id. This is the Alberta analogue of BC's ORCS /
// the Parks Canada Site_Num_Site lesson: key on the stable domain ID, not
// the rebuild-ephemeral OBJECTID.
const ParkPropsSchema = z
  .object({
    OBJECTID: z.union([z.number(), z.string()]).optional(),
    PASITES_ID: z.union([z.number(), z.string()]).nullable().optional(),
    NAME: z.string().nullable().optional(),
    TYPE: z.string().nullable().optional(),
    SUBTYPE: z.string().nullable().optional(),
    IUCN: z.string().nullable().optional(),
  })
  .passthrough();

// ───── Identifier + name helpers ────────────────────────────────────────

/**
 * Normalize PASITES_ID to the external_id seed. The layer serves it as a
 * Double (10655.0); truncate to an integer string. Returns "" for
 * missing / non-finite values so callers can skip rather than mis-key.
 */
function normalizePasitesId(raw: unknown): string {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(Math.trunc(raw)) : "";
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!/^\d+(\.\d+)?$/.test(t)) return "";
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? String(Math.trunc(n)) : "";
  }
  return "";
}

/**
 * Build the canonical name from the bare NAME field + the designation
 * label. The layer's NAME omits the full designation suffix ("Peter
 * Lougheed", not "Peter Lougheed Provincial Park"), and NAME alone is
 * ambiguous ("Bow Valley" is both a PP and a PRA). Appending the
 * designation gives the proper, disambiguated provincial name. Falls back
 * to the PASITES_ID stamp when NAME is missing.
 *
 * The append absorbs any word-level overlap where the TAIL of NAME already
 * matches the HEAD of the label, so we never double words. This matters
 * for WPP: its names commonly already end with "Wildland" ("Bow Valley
 * Wildland"), and a naive append would produce "Bow Valley Wildland
 * Wildland Provincial Park". Taking the largest overlap also subsumes the
 * already-fully-suffixed case ("Writing-on-Stone Provincial Park" stays
 * unchanged).
 *
 * The matcher's own suffix-normalization handles cross-source comparison
 * (Google's "Peter Lougheed Provincial Park" vs this), so building the
 * full name here does not impede federation.
 */
function buildCanonicalName(
  rawName: unknown,
  type: unknown,
  fallback: string,
): string {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name === "") return fallback;
  const label = typeof type === "string" ? DESIGNATION_LABELS[type] : undefined;
  if (!label) return name;
  const nameWords = name.split(/\s+/);
  const labelWords = label.split(/\s+/);
  let overlap = 0;
  for (let k = Math.min(nameWords.length, labelWords.length); k >= 1; k--) {
    const nameTail = nameWords.slice(nameWords.length - k).join(" ").toLowerCase();
    const labelHead = labelWords.slice(0, k).join(" ").toLowerCase();
    if (nameTail === labelHead) {
      overlap = k;
      break;
    }
  }
  const remaining = labelWords.slice(overlap);
  return remaining.length === 0 ? name : `${name} ${remaining.join(" ")}`;
}

// ───── Category + normalizer ────────────────────────────────────────────

/**
 * Every Alberta protected area — provincial park, recreation area,
 * wildland park — lands as `park_boundary`, reusing the Parks Canada /
 * BC Parks category so no matcher.ts / category_compatibility change is
 * needed. The designation detail is preserved in normalized_payload.
 */
function inferParkCategory(): string {
  return "park_boundary";
}

// One park = one source_record. Alberta publishes no amenity / contact /
// description / hours data (see the data-shape note at the top), so those
// fields are always null here. `geometry` is the park's centroid;
// `geometry_polygon` carries the boundary for week-3
// recompute_master_place promotion + polygon-containment ER.
function normalizePark(args: {
  name: string;
  polygon: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  designation: string | null;
  parkType: string | null;
  pasitesId: string;
}): Record<string, unknown> {
  return {
    canonical_name: args.name,
    description: null,
    overlander_tags: ["provincial_land", "alberta_parks"],
    contact: null,
    access: null,
    amenities: null,
    hours: null,
    // Promoted by recompute_master_place via field_precedence in week 3,
    // identical mechanism to the Parks Canada / BC Parks geometry_polygon
    // path.
    geometry_polygon: args.polygon,
    park_designation: args.designation,
    park_type: args.parkType,
    pasites_id: args.pasitesId,
  };
}

// ───── Persistence ─────────────────────────────────────────────────────

type PersistOutcome = "inserted" | "skipped" | "error";

async function persistPark(
  feature: GeoJsonFeature,
  dryRun: boolean,
): Promise<PersistOutcome> {
  const parsed = ParkPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn(
      { err: parsed.error.flatten() },
      "alberta_parks: park props schema mismatch — skipped",
    );
    return "skipped";
  }
  const props = parsed.data;

  const polygon = extractPolygon(feature.geometry);
  if (!polygon) {
    logger.warn(
      { props_keys: Object.keys(props) },
      "alberta_parks: feature missing polygon geometry — skipped",
    );
    return "skipped";
  }
  const centroid = bboxCentroid(polygon);
  if (!centroid) return "skipped";

  const pasitesId = normalizePasitesId(props.PASITES_ID);
  if (pasitesId === "") {
    logger.warn(
      { name: props.NAME ?? null },
      "alberta_parks: missing PASITES_ID — skipped",
    );
    return "skipped";
  }
  const externalId = `alberta_parks:park:${pasitesId}`;

  const designation =
    typeof props.TYPE === "string"
      ? (DESIGNATION_LABELS[props.TYPE] ?? null)
      : null;
  const name = buildCanonicalName(
    props.NAME,
    props.TYPE,
    `Alberta Parks protected area ${pasitesId}`,
  );

  if (dryRun) {
    logger.debug({ externalId, name }, "alberta_parks: dry-run park");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: inferParkCategory(),
      point: centroid,
      rawPayload: { feature, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizePark({
        name,
        polygon,
        designation,
        parkType: props.TYPE ?? null,
        pasitesId,
      }),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "alberta_parks: park upsert failed");
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
      "alberta_parks: --bbox is required. The Alberta Parks ESRI layer is queried by geographic envelope; there is no parkCode-style filter.",
    );
  }
  logger.info({ bbox }, "alberta_parks: ingest start");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.alberta_parks;
  if (!limit) {
    throw new Error(
      "alberta_parks: rate limiter missing — check lib/rate-limit.ts",
    );
  }
  const dryRun = opts.dryRun ?? false;

  await limit(async () => {
    const features = await fetchEsriFeatures(ENDPOINT, bbox, {
      where: TYPE_WHERE,
      label: SOURCE_ID,
      userAgent: USER_AGENT,
    });
    stats.fetched = features.length;
    logger.info({ count: features.length }, "alberta_parks: features fetched");
    for (const feature of features) {
      const outcome = await persistPark(feature, dryRun);
      if (outcome === "inserted") stats.inserted += 1;
      else if (outcome === "skipped") stats.skipped += 1;
      else stats.errors += 1;
    }
  });

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "alberta_parks: ingestion complete");
  return result;
};

export default ingest;

// Test seam: exported so unit tests can exercise the pure helpers without
// hitting the network or DB.
export const _internals = {
  bboxCentroid,
  buildCanonicalName,
  extractPolygon,
  inferParkCategory,
  normalizePark,
  normalizePasitesId,
  TYPE_WHERE,
};
