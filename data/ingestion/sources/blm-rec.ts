/**
 * BLM recreation-points ingester — Primitive campsite (dispersed) slice.
 *
 * Source: BLM_Natl_Recs_pts layer 23 ("Recreation Locations - All"),
 * https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/23
 *
 * v1 scope (per docs/specs/blm-primitive-campsite-ingest.md): the single
 * dispersed-camping subtype
 *   FET_SUBTYPE = 'Campsite - Primitive - Non Reservable - No Fee'
 * scoped to the six planning states via ADMIN_ST IN ('CA','AZ','NV','UT','OR')
 * (the OR office administers both OR and WA — WA is not a separate ADMIN_ST
 * value, so it rides along under 'OR'; see the OR/WA note below). Developed,
 * reservable, and generic-campground subtypes are deliberately excluded — they
 * are already covered via RIDB. The sibling primitive variants
 * (Fee / Reservable / Undeveloped, ~165 national) are a v2 candidate, not v1.
 *
 * external_id: blm:recpt:<Original_GlobalID>
 *   Original_GlobalID is an Esri GlobalID GUID, verified 100% populated AND
 *   fully unique across all 10,241 national rows (paged the whole layer). It is
 *   the stable idempotency key. The layer has NO bare `GlobalID` field.
 *
 * Category: dispersed_camping — the same category USFS CAMPING AREA (scale ≤1)
 * uses, so the matcher treats BLM primitives and USFS/OSM dispersed sites as
 * taxonomically identical (dispersed_camping ↔ dispersed_camping = 1.0). Source
 * remains distinguishable via source_id / overlander_tags / provenance.
 *
 * Coordinates come from the GeoJSON geometry ONLY. The OR-office rows carry
 * null LAT/LONG attribute columns (they have SHAPE geometry but not the
 * lat/long fields); reading LAT/LONG would silently drop the entire OR/WA
 * footprint. The shared esri.ts client requests f=geojson + outSR=4326, so
 * extractPoint reads the GeoJSON Point and never touches LAT/LONG.
 *
 * OR/WA: ADMIN_ST is stored as a soft tag in provenance.admin_st; point
 * geometry drives all state/map queries. No hard WA attribution at ingest —
 * the OR/WA line is the meandering Columbia and a bbox lat-cut is a guess.
 *
 * Attributes are sparse: PHOTO fields ~100% null, DESCRIPTION mostly null,
 * WEB_LINK office-level not per-POI. amenities/hours/contact/access are emitted
 * null rather than fabricated.
 *
 * Point geometry over ArcGIS REST rides the shared lib/esri.ts client
 * (OID-keyset pagination at pageSize 1000). pLimit(4) at the source layer.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source blm --bbox W,S,E,N --dry-run
 */

import { z } from "zod";

import { batchUpsert } from "../lib/db.ts";
import { resolveCorridorFilter } from "../lib/corridor.ts";
import { fetchEsriFeatures } from "../lib/esri.ts";
import { pointEwkt } from "../lib/ewkt.ts";
import type { GeoJsonFeature } from "../lib/geojson.ts";
import { logger } from "../lib/logger.ts";
import { limits } from "../lib/rate-limit.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "blm";
const SOURCE_QUALITY_SCORE = 0.5;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

const ENDPOINT =
  "https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/23";

const CATEGORY = "dispersed_camping";

const PRIMITIVE_SUBTYPE = "Campsite - Primitive - Non Reservable - No Fee";
const SIX_STATE_ADMIN = ["CA", "AZ", "NV", "UT", "OR"] as const;

const WHERE =
  `FET_SUBTYPE = '${PRIMITIVE_SUBTYPE}' ` +
  `AND ADMIN_ST IN (${SIX_STATE_ADMIN.map((s) => `'${s}'`).join(",")})`;

// ── ESRI attribute schema ───────────────────────────────────────────────
//
// `.passthrough()` — the layer carries 18 fields; raw_payload retains all of
// them. Only the fields this ingester reads are named. FET_NAME / FET_SUBTYPE /
// ADMIN_ST / Original_GlobalID are ~100% populated; DESCRIPTION and WEB_LINK
// are region-sparse but named because they are read into normalized_payload.

const BlmRecPropsSchema = z
  .object({
    FET_NAME: z.string().nullable().optional(),
    FET_SUBTYPE: z.string().nullable().optional(),
    DESCRIPTION: z.string().nullable().optional(),
    WEB_LINK: z.string().nullable().optional(),
    ADMIN_ST: z.string().nullable().optional(),
    Original_GlobalID: z.string().nullable().optional(),
  })
  .passthrough();

type BlmRecProps = z.infer<typeof BlmRecPropsSchema>;

// ── helpers ─────────────────────────────────────────────────────────────

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.trim().length > 0 ? s.trim() : null;
}

/**
 * Extract [lng, lat] from the GeoJSON Point geometry ONLY. There is no
 * LAT/LONG fallback: those attribute columns are null on the OR-office rows,
 * and reading them would silently drop the OR/WA footprint. (0,0) is treated
 * as no-geometry.
 */
function extractPoint(geom: GeoJsonFeature["geometry"]): [number, number] | null {
  if (geom && geom.type === "Point") {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = typeof c[0] === "number" ? c[0] : NaN;
      const lat = typeof c[1] === "number" ? c[1] : NaN;
      if (Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0)) {
        return [lng, lat];
      }
    }
  }
  return null;
}

/** Feature name: FET_NAME as-is (no synthesis — placeholder/numeric codes like
 *  "Campsite 91" or river-mile codes like "J75.40R" are honest identifiers). */
function bestName(props: BlmRecProps): string | null {
  return trimOrNull(props.FET_NAME);
}

// ── Normalize + build a source_record row ───────────────────────────────

function normalize(
  props: BlmRecProps,
  name: string,
  globalId: string,
): Record<string, unknown> {
  return {
    canonical_name: name,
    description: trimOrNull(props.DESCRIPTION),
    overlander_tags: ["federal_land", "blm", "dispersed_camping_likely"],

    // Dispersed-camping advisory (matches osm.ts / padus.ts / usfs.ts).
    dispersed_camping: "likely_allowed",
    verify_locally: true,
    mvum_corridor: null,

    // Office-level URL, not per-POI — stored, not promoted.
    web_link: trimOrNull(props.WEB_LINK),

    // Attributes are sparse to absent on this layer; emit null rather than a
    // bag of nulls fabricated from empty fields.
    amenities: null,
    hours: null,
    contact: null,
    access: null,

    provenance: {
      layer: "BLM_Natl_Recs_pts:23",
      original_global_id: globalId,
      // Soft state tag only — 'OR' covers OR+WA. Geometry drives state queries.
      admin_st: trimOrNull(props.ADMIN_ST),
      fet_subtype: trimOrNull(props.FET_SUBTYPE),
    },
  };
}

/**
 * Build a source_record upsert row from one BLM feature, or null to skip
 * (schema mismatch / wrong subtype / no geometry / no Original_GlobalID / no
 * name). Pure except for a warn-log on schema mismatch — no DB writes here.
 */
function buildRow(feature: GeoJsonFeature): {
  row: Record<string, unknown> | null;
  skipReason: string | null;
} {
  const parsed = BlmRecPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "blm: props schema mismatch — skipped");
    return { row: null, skipReason: "schema_mismatch" };
  }
  const props = parsed.data;

  // Defensive subtype gate: the server-side WHERE already restricts to the
  // primitive subtype, but assert per-row so a developed/reservable/generic
  // campground row can never leak in even if the WHERE is later changed.
  const subtype = trimOrNull(props.FET_SUBTYPE);
  if (subtype !== PRIMITIVE_SUBTYPE) {
    return { row: null, skipReason: `subtype_gate:${subtype ?? "null"}` };
  }

  const point = extractPoint(feature.geometry);
  if (!point) return { row: null, skipReason: "no_geometry" };

  const globalId = trimOrNull(props.Original_GlobalID);
  if (!globalId) {
    logger.warn({ fet_name: props.FET_NAME }, "blm: row missing Original_GlobalID — skipped");
    return { row: null, skipReason: "no_global_id" };
  }

  const name = bestName(props);
  if (!name) return { row: null, skipReason: "no_name" };

  return {
    row: {
      source_id: SOURCE_ID,
      external_id: `blm:recpt:${globalId}`,
      name,
      inferred_category: CATEGORY,
      geometry: pointEwkt(point),
      raw_payload: { props, fetched_at: new Date().toISOString() },
      normalized_payload: normalize(props, name, globalId),
      source_quality_score: SOURCE_QUALITY_SCORE,
      fetch_timestamp: new Date().toISOString(),
    },
    skipReason: null,
  };
}

// ── Entry ───────────────────────────────────────────────────────────────

export const ingest: IngestFn = async (
  opts: IngestOptions,
): Promise<IngestResult> => {
  const startedAt = Date.now();

  const filter = await resolveCorridorFilter(opts.bbox);
  logger.info({ filter: filter.kind, where: WHERE }, "blm: ingest start");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.blm;
  if (!limit) throw new Error("blm: rate limiter missing — check lib/rate-limit.ts");
  const dryRun = opts.dryRun ?? false;
  const skipCounts: Record<string, number> = {};

  await limit(async () => {
    logger.info({ where: WHERE }, "blm: fetching layer 23");
    const features = await fetchEsriFeatures(ENDPOINT, filter, {
      where: WHERE,
      label: "blm.rec_pts",
      userAgent: USER_AGENT,
    });
    stats.fetched = features.length;
    logger.info({ fetched: features.length }, "blm: features fetched");

    const rows: Record<string, unknown>[] = [];
    for (const feature of features) {
      const { row, skipReason } = buildRow(feature);
      if (row) {
        rows.push(row);
      } else {
        stats.skipped += 1;
        if (skipReason) {
          const key = skipReason.split(":")[0];
          skipCounts[key] = (skipCounts[key] ?? 0) + 1;
        }
      }
    }

    logger.info(
      { rows_ready: rows.length, skipped: stats.skipped, skip_breakdown: skipCounts },
      "blm: rows built",
    );

    if (dryRun) {
      stats.inserted = rows.length;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        logger.info(
          {
            sample: i + 1,
            external_id: rows[i].external_id,
            name: rows[i].name,
            category: rows[i].inferred_category,
            geometry: rows[i].geometry,
            normalized_payload: rows[i].normalized_payload,
          },
          "blm: dry-run sample",
        );
      }
      logger.info({ wouldWrite: rows.length, skipped: stats.skipped }, "blm: dry-run (no writes)");
      return;
    }

    const { written } = await batchUpsert({
      table: "source_record",
      rows,
      onConflict: "source_id,external_id",
      label: "blm.rec_pts",
    });
    stats.inserted = written;
    if (written !== rows.length) {
      throw new Error(`blm: wrote ${written} of ${rows.length} prepared rows`);
    }
    logger.info(
      { fetched: stats.fetched, skipped: stats.skipped, written },
      "blm: write complete",
    );
  });

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "blm: ingestion complete");
  return result;
};

export default ingest;

// Test seam: pure helpers exercised without network or DB.
export const _internals = {
  bestName,
  buildRow,
  extractPoint,
  normalize,
  BlmRecPropsSchema,
  PRIMITIVE_SUBTYPE,
  WHERE,
};
