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

import { upsertSourceRecord } from "../lib/db.ts";
import { fetchEsriFeatures } from "../lib/esri.ts";
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

type PersistOutcome = "inserted" | "skipped" | "error";

async function persist(feature: GeoJsonFeature, dryRun: boolean): Promise<PersistOutcome> {
  const parsed = RecOppPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "usfs: props schema mismatch — skipped");
    return "skipped";
  }
  const props = parsed.data;
  // Defensive: the where clause already filters, but never persist a
  // non-dispersed row even if the service returns one.
  if (trimOrNull(props.markeractivity) !== "Dispersed Camping") return "skipped";

  const point = extractPoint(feature.geometry, props);
  if (!point) return "skipped";

  const recareaid = props.recareaid;
  if (recareaid === null || recareaid === undefined || String(recareaid).trim() === "") {
    logger.warn({ name: props.recareaname }, "usfs: dispersed row missing recareaid — skipped");
    return "skipped";
  }
  const externalId = `usfs:recarea:${recareaid}`;
  const name = trimOrNull(props.recareaname) ?? `USFS dispersed camping ${recareaid}`;

  if (dryRun) {
    logger.debug({ externalId, name }, "usfs: dry-run dispersed");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: "dispersed_camping",
      point,
      rawPayload: { props, fetched_at: new Date().toISOString() },
      normalizedPayload: normalize(props, name),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "usfs: dispersed upsert failed");
    return "error";
  }
}

export const ingest: IngestFn = async (
  opts: IngestOptions,
): Promise<IngestResult> => {
  const startedAt = Date.now();
  const bbox = opts.bbox;
  if (!bbox) {
    throw new Error(
      "usfs: --bbox is required. EDW Recreation Opportunities is queried by geographic envelope.",
    );
  }
  logger.info({ bbox }, "usfs: ingest start (dispersed camping only)");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.usfs;
  if (!limit) throw new Error("usfs: rate limiter missing — check lib/rate-limit.ts");
  const dryRun = opts.dryRun ?? false;

  await limit(async () => {
    const features = await fetchEsriFeatures(ENDPOINT, bbox, {
      where: DISPERSED_WHERE,
      label: "usfs.dispersed",
      userAgent: USER_AGENT,
    });
    stats.fetched += features.length;
    logger.info({ fetched: features.length }, "usfs: dispersed features fetched");
    for (const feature of features) {
      const outcome = await persist(feature, dryRun);
      if (outcome === "inserted") stats.inserted += 1;
      else if (outcome === "skipped") stats.skipped += 1;
      else stats.errors += 1;
    }
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
