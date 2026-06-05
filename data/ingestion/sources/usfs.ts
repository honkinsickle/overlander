/**
 * USFS dispersed-camping ingester (Phase 2 PR-A).
 *
 * Source: USFS EDW Recreation Opportunities, filtered to the "Dispersed
 * Camping" activity — the net-new dispersed layer RIDB does NOT carry
 * (RIDB = reservable recreation.gov facilities). Developed campgrounds
 * (markeractivity='Campground Camping') are DELIBERATELY out of scope:
 * they overlap RIDB heavily and are deferred to the fed_exact /
 * findFederalAnchor generalization (tracked national-fill item).
 *
 * Category: dispersed_camping (Phase 2 canonical category — PR-0).
 *
 * external_id: usfs:recarea:<recareaid>. recareaid is the public FS
 * recreation-URL recid (fs.usda.gov/recarea/<forest>/recarea/?recid=<id>):
 * a persistent domain id — NOT the per-build OBJECTID surrogate — and unique
 * per dispersed recarea (367/367 distinct nationally). Stability proven in
 * the PR-A read pass (recareaid == recid in the public URL for 367/367).
 *
 * Point geometry over ArcGIS REST → rides the shared lib/esri.ts client.
 * A "Dispersed Camping" rec area means dispersed camping is offered there, so
 * dispersed_camping = likely_allowed, always paired with verify_locally
 * (advisory; see ADR). mvum_corridor stubbed until PR-C wires MVUM.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source usfs --bbox W,S,E,N
 */

import { z } from "zod";

import { batchUpsert } from "../lib/db.ts";
import { resolveCorridorFilter } from "../lib/corridor.ts";
import { fetchEsriFeatures } from "../lib/esri.ts";
import { pointEwkt } from "../lib/ewkt.ts";
import type { GeoJsonFeature } from "../lib/geojson.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import { limits } from "../lib/rate-limit.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "usfs";
const SOURCE_QUALITY_SCORE = 0.9;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";
const ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0";
// markeractivity is the real activity field (markertype is icon PNG paths).
const DISPERSED_WHERE = "markeractivity='Dispersed Camping'";

// `.passthrough()` — the layer carries many fields we don't normalize.
const RecOppPropsSchema = z
  .object({
    recareaname: z.string().nullable().optional(),
    recareaid: z.union([z.number(), z.string()]).nullable().optional(),
    forestname: z.string().nullable().optional(),
    latitude: z.union([z.string(), z.number()]).nullable().optional(),
    longitude: z.union([z.string(), z.number()]).nullable().optional(),
    reservation_info: z.string().nullable().optional(),
    recareaurl: z.string().nullable().optional(),
    recareadescription: z.string().nullable().optional(),
    openstatus: z.string().nullable().optional(),
    markeractivity: z.string().nullable().optional(),
  })
  .passthrough();

type RecOppProps = z.infer<typeof RecOppPropsSchema>;

function trimOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Point: prefer the GeoJSON Point geometry, fall back to the latitude/
 * longitude string fields. Returns [lng, lat] (codebase convention).
 */
function extractPoint(
  geom: GeoJsonFeature["geometry"],
  props: RecOppProps,
): [number, number] | null {
  if (geom && geom.type === "Point") {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = c[0];
      const lat = c[1];
      if (typeof lng === "number" && typeof lat === "number" && !(lng === 0 && lat === 0)) {
        return [lng, lat];
      }
    }
  }
  const lat = typeof props.latitude === "string" ? parseFloat(props.latitude) : props.latitude;
  const lng = typeof props.longitude === "string" ? parseFloat(props.longitude) : props.longitude;
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    return [lng, lat];
  }
  return null;
}

/**
 * `reservation_info` is free text ("No Reservations, Register on site",
 * "Reservations Required", "Reserve at recreation.gov/…"). Positive-signal
 * heuristic — never keys on the bare substring "reserv" (which "No
 * Reservations" also contains). null when there's no usable signal.
 */
function inferReservable(info: string | null): boolean | null {
  if (!info) return null;
  const t = info.toLowerCase();
  if (/no reservation/.test(t)) return false;
  if (/reservations?\s+required|reserve\s+(at|via|online|by)|reservable|recreation\.gov/.test(t)) {
    return true;
  }
  return null;
}

function normalize(props: RecOppProps, name: string): Record<string, unknown> {
  const website = trimOrNull(props.recareaurl);
  const description = trimOrNull(props.recareadescription);
  const reservable = inferReservable(trimOrNull(props.reservation_info));
  return {
    canonical_name: name,
    description,
    overlander_tags: ["federal_land", "usfs", "dispersed_camping_likely"],
    contact: website ? compact({ website }) : null,
    access: null,
    amenities: null,
    hours: null,
    // Dispersed-camping advisory. The rec area offers dispersed camping →
    // likely_allowed, ALWAYS paired with verify_locally (coarse/advisory).
    // mvum_corridor stays null until PR-C wires MVUM proximity.
    dispersed_camping: "likely_allowed",
    verify_locally: true,
    mvum_corridor: null,
    reservable,
    forest_name: trimOrNull(props.forestname),
    open_status: trimOrNull(props.openstatus),
  };
}

/**
 * Build a source_record upsert row from one feature, or null to skip
 * (schema mismatch / non-dispersed / no geometry / no key). Geometry is
 * serialized to EWKT for client-side batched upsert (see ewkt.ts). Pure
 * except for skip logging — no DB writes here.
 */
function buildRow(feature: GeoJsonFeature): Record<string, unknown> | null {
  const parsed = RecOppPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "usfs: props schema mismatch — skipped");
    return null;
  }
  const props = parsed.data;
  // Defensive: the where clause already filters, but never persist a
  // non-dispersed row even if the service returns one.
  if (trimOrNull(props.markeractivity) !== "Dispersed Camping") return null;

  const point = extractPoint(feature.geometry, props);
  if (!point) return null;

  const recareaid = props.recareaid;
  if (recareaid === null || recareaid === undefined || String(recareaid).trim() === "") {
    logger.warn({ name: props.recareaname }, "usfs: dispersed row missing recareaid — skipped");
    return null;
  }
  const externalId = `usfs:recarea:${recareaid}`;
  const name = trimOrNull(props.recareaname) ?? `USFS dispersed camping ${recareaid}`;

  return {
    source_id: SOURCE_ID,
    external_id: externalId,
    name,
    inferred_category: "dispersed_camping",
    geometry: pointEwkt(point),
    raw_payload: { props, fetched_at: new Date().toISOString() },
    normalized_payload: normalize(props, name),
    source_quality_score: SOURCE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

export const ingest: IngestFn = async (
  opts: IngestOptions,
): Promise<IngestResult> => {
  const startedAt = Date.now();
  // Default to the active corridor BUFFER POLYGON; --bbox is an explicit
  // override/fallback when no corridor is active.
  const filter = await resolveCorridorFilter(opts.bbox);
  logger.info({ filter: filter.kind }, "usfs: ingest start (dispersed camping only)");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.usfs;
  if (!limit) throw new Error("usfs: rate limiter missing — check lib/rate-limit.ts");
  const dryRun = opts.dryRun ?? false;

  await limit(async () => {
    const features = await fetchEsriFeatures(ENDPOINT, filter, {
      where: DISPERSED_WHERE,
      label: "usfs.dispersed",
      userAgent: USER_AGENT,
    });
    stats.fetched += features.length;
    logger.info({ fetched: features.length }, "usfs: dispersed features fetched");

    // Build rows (skips are non-writes), then batch-upsert FAIL-LOUD: a chunk
    // that fails after retries throws → the run errors instead of silently
    // dropping rows.
    const rows: Record<string, unknown>[] = [];
    for (const feature of features) {
      const row = buildRow(feature);
      if (row) rows.push(row);
      else stats.skipped += 1;
    }

    if (dryRun) {
      logger.info({ wouldWrite: rows.length, skipped: stats.skipped }, "usfs: dry-run (no writes)");
      stats.inserted = rows.length;
      return;
    }

    const { written } = await batchUpsert({
      table: "source_record",
      rows,
      onConflict: "source_id,external_id",
      label: "usfs.dispersed",
    });
    stats.inserted = written;
    if (written !== rows.length) {
      // batchUpsert already throws on shortfall; assert here too.
      throw new Error(`usfs: wrote ${written} of ${rows.length} prepared rows`);
    }
    logger.info({ fetched: stats.fetched, skipped: stats.skipped, written }, "usfs: write complete");
  });

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "usfs: ingestion complete");
  return result;
};

export default ingest;

// Test seam: pure helpers exercised without network or DB.
export const _internals = {
  extractPoint,
  inferReservable,
  normalize,
  RecOppPropsSchema,
};
