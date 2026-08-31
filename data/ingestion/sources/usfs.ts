/**
 * USFS INFRA ingester (Phase 2 rewrite — source-of-record moved to
 * EDW_RecInfraRecreationSites_02).
 *
 * Source: EDW_RecInfraRecreationSites_02 layer 0 (31,397 sites nationally).
 * Superseded EDW_RecreationOpportunities_01 as the primary source after
 * a scoping investigation on 2026-08-15 confirmed:
 *   - INFRA carries ~2.2× the sites (31,397 vs RecOpp's 14,211)
 *   - RecOpp is only ~30% joinable back to INFRA (`infra_cn` populated on
 *     9,606 of 14,211 RecOpp rows) — RecOpp is a PARTIAL Portal projection
 *     over INFRA, not a superset
 *   - The six ingest-worthy site_types (TRAILHEAD / CAMPGROUND / GROUP
 *     CAMPGROUND / CAMPING AREA / PICNIC SITE / GROUP PICNIC SITE) all live
 *     on INFRA layer 0's `site_type` field, with `development_scale` giving
 *     the dispersed/developed split for CAMPING AREA
 *
 * A parallel investigation of the sibling _01 service (137 fields, alerts +
 * amenities + rig-fit + contact) confirmed those extra columns are 100% null
 * in a stratified six-state sample and single-to-double-digit populated
 * nationally — schema is aspirational, so we stay on _02.
 *
 * external_id: usfs:site:<site_cn>
 *   site_cn (INFRA Consistent Number) is the persistent identifier — stable
 *   across ArcGIS builds (verified: two format families, `4527408010602` and
 *   `5275.002691`, both non-sequential unlike per-build OBJECTIDs).
 *
 * Category mapping (six site_types, v1):
 *   TRAILHEAD                 -> trailhead
 *   CAMPGROUND                -> campground
 *   GROUP CAMPGROUND          -> campground
 *   CAMPING AREA (scale ≤ 1)  -> dispersed_camping   (scale 0 = primitive,
 *                                                     scale 1 = minimally
 *                                                     developed)
 *   PICNIC SITE               -> picnic_area
 *   GROUP PICNIC SITE         -> picnic_area
 * Deliberately excluded from v1: HORSE CAMP, BOATING SITE, CAMPING AREA at
 * scale 2 (overlap-heavy with CAMPGROUND), and all other site_types.
 *
 * RecOpp enrichment: a light join. For each INFRA site_cn, look up the
 * matching EDW_RecreationOpportunities_01 row via infra_cn = site_cn and
 * merge three RecOpp-only fields (recareaurl, markeractivity,
 * markeractivitygroup). Only ~30% of INFRA sites match; misses are handled
 * cleanly. Provenance is stored in normalized_payload.provenance so
 * consumers can trace which fields came from where.
 *
 * Naming: prefer `public_site_name` when populated, fall back to `site_name`.
 * Names are passed through as-is. Do NOT synthesize replacement names for
 * admin-code sites like `FS1302-03` — those codes are honest identifiers and
 * a synthetic rewrite ("<ForestName> Dispersed Site") would collide across
 * siblings in the same forest.
 *
 * Point geometry over ArcGIS REST → rides the shared lib/esri.ts client
 * (OID-keyset pagination at pageSize 1000). pLimit(4) at the source layer;
 * the whole ingest wraps in one limit() so it's serial per-invocation.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source usfs --bbox W,S,E,N
 *   npm run -w data ingest:manual -- --source usfs --bbox W,S,E,N \
 *     --site-types trailhead
 *   npm run -w data ingest:manual -- --source usfs --bbox W,S,E,N \
 *     --site-types campground,group_campground,camping_area,picnic_site,group_picnic_site
 */

import { z } from "zod";

import { batchUpsert } from "../lib/db.ts";
import { resolveCorridorFilter } from "../lib/corridor.ts";
import { fetchEsriFeatures, type EsriSpatialFilter } from "../lib/esri.ts";
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

const INFRA_ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0";
const RECOPP_ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0";

// ── Site-type → category mapping ────────────────────────────────────────

/** CLI token → INFRA site_type string. Ordered for reproducibility. */
export const SITE_TYPE_TOKENS: Readonly<Record<string, string>> = {
  trailhead:          "TRAILHEAD",
  campground:         "CAMPGROUND",
  group_campground:   "GROUP CAMPGROUND",
  camping_area:       "CAMPING AREA",
  picnic_site:        "PICNIC SITE",
  group_picnic_site:  "GROUP PICNIC SITE",
} as const;

const DEFAULT_SITE_TYPE_TOKENS: readonly string[] = Object.keys(SITE_TYPE_TOKENS);

/**
 * v1 category mapping. Returns `keep: false` for rows that pass the
 * site_type filter but fail a secondary rule (CAMPING AREA scale > 1).
 */
export function inferCategoryV1(
  siteType: string,
  developmentScale: string | null,
): { category: string; keep: boolean } {
  const scale = developmentScale != null && developmentScale !== ""
    ? parseInt(developmentScale, 10)
    : null;
  switch (siteType) {
    case "TRAILHEAD":         return { category: "trailhead", keep: true };
    case "CAMPGROUND":        return { category: "campground", keep: true };
    case "GROUP CAMPGROUND":  return { category: "campground", keep: true };
    case "CAMPING AREA":
      // Scale 0 = primitive/dispersed. Scale 1 = minimally developed.
      // Scale 2 excluded from v1 — overlaps CAMPGROUND-style development
      // and doesn't cleanly represent dispersed camping.
      if (scale !== null && scale <= 1) return { category: "dispersed_camping", keep: true };
      return { category: "dispersed_camping", keep: false };
    case "PICNIC SITE":       return { category: "picnic_area", keep: true };
    case "GROUP PICNIC SITE": return { category: "picnic_area", keep: true };
    default:                  return { category: "unknown", keep: false };
  }
}

// ── ESRI attribute schemas ──────────────────────────────────────────────
//
// `.passthrough()` — the layer carries many fields we don't normalize.
// Only fields >50% populated in the 2026-08-15 stratified six-state sample
// are named here; the rest are ignored.

const InfraPropsSchema = z
  .object({
    site_cn: z.union([z.string(), z.number()]).nullable().optional(),
    site_id: z.union([z.string(), z.number()]).nullable().optional(),
    site_name: z.string().nullable().optional(),
    public_site_name: z.string().nullable().optional(),
    site_type: z.string().nullable().optional(),
    development_scale: z.union([z.string(), z.number()]).nullable().optional(),
    latitude: z.union([z.string(), z.number()]).nullable().optional(),
    longitude: z.union([z.string(), z.number()]).nullable().optional(),
    fee_charged: z.string().nullable().optional(),
    recarea_name: z.string().nullable().optional(),
    recarea_description: z.string().nullable().optional(),
    recarea_enable: z.string().nullable().optional(),
    parent_recarea: z.string().nullable().optional(),
    pack_in_out: z.string().nullable().optional(),
    total_capacity: z.union([z.string(), z.number()]).nullable().optional(),
    // NOTE: `minimum_elevation` on INFRA layer 0 is UNRELIABLE. Roughly half
    // the six-state sample carried the literal string "feet" with no number
    // (a data-entry bug on the FS side), and some rows are missing entirely.
    // Others carry usable strings like "7,300 feet". We store the raw value
    // as-is; do not attempt to parse it here — a downstream consumer that
    // wants a numeric elevation must handle the "feet"-only case explicitly.
    minimum_elevation: z.union([z.string(), z.number()]).nullable().optional(),
    operated_by: z.string().nullable().optional(),
    fee_description: z.string().nullable().optional(),
    closest_towns: z.string().nullable().optional(),
    restroom_availability: z.string().nullable().optional(),
    water_availability: z.string().nullable().optional(),
    directions: z.string().nullable().optional(),
    usda_portal_url: z.string().nullable().optional(),
  })
  .passthrough();

type InfraProps = z.infer<typeof InfraPropsSchema>;

const RecOppPropsSchema = z
  .object({
    infra_cn: z.union([z.string(), z.number()]).nullable().optional(),
    recareaurl: z.string().nullable().optional(),
    markeractivity: z.string().nullable().optional(),
    markeractivitygroup: z.string().nullable().optional(),
  })
  .passthrough();

// ── helpers ─────────────────────────────────────────────────────────────

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.trim().length > 0 ? s.trim() : null;
}

function toIntOrNull(v: unknown): number | null {
  const s = trimOrNull(v);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract [lng, lat]. Prefer the GeoJSON Point geometry; fall back to the
 * lat/lng string fields on the row. (0,0) is treated as no-geometry.
 */
function extractPoint(
  geom: GeoJsonFeature["geometry"],
  props: InfraProps,
): [number, number] | null {
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
  const lat = typeof props.latitude === "string" ? parseFloat(props.latitude) : (props.latitude ?? NaN) as number;
  const lng = typeof props.longitude === "string" ? parseFloat(props.longitude) : (props.longitude ?? NaN) as number;
  if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    return [lng, lat];
  }
  return null;
}

/**
 * Best-available name: public_site_name > site_name. As-is from source — no
 * placeholder synthesis. (Admin codes like FS1302-03 stay as-is; a synthetic
 * rewrite would collide across siblings in the same forest.)
 */
function bestName(props: InfraProps): string | null {
  return trimOrNull(props.public_site_name) ?? trimOrNull(props.site_name);
}

// ── RecOpp enrichment fetch + map ───────────────────────────────────────

interface RecOppEnrichment {
  recareaurl: string | null;
  markeractivity: string | null;
  markeractivitygroup: string | null;
}

/**
 * Fetch RecOpp records with `infra_cn IS NOT NULL` inside the same spatial
 * filter, and build a Map<site_cn, RecOppEnrichment>. Used to enrich INFRA
 * rows with the ~30% that have a matching Portal-published record.
 * INFRA-only sites yield no map entry; the ingester handles absence.
 */
async function buildRecOppMap(filter: EsriSpatialFilter): Promise<Map<string, RecOppEnrichment>> {
  const features = await fetchEsriFeatures(RECOPP_ENDPOINT, filter, {
    where: "infra_cn IS NOT NULL",
    outFields: "infra_cn,recareaurl,markeractivity,markeractivitygroup",
    label: "usfs.recopp_enrichment",
    userAgent: USER_AGENT,
  });
  const map = new Map<string, RecOppEnrichment>();
  for (const feature of features) {
    const parsed = RecOppPropsSchema.safeParse(feature.properties);
    if (!parsed.success) continue;
    const p = parsed.data;
    const key = trimOrNull(p.infra_cn);
    if (!key) continue;
    // First-write-wins if duplicate keys ever appear (they shouldn't).
    if (map.has(key)) continue;
    map.set(key, {
      recareaurl: trimOrNull(p.recareaurl),
      markeractivity: trimOrNull(p.markeractivity),
      markeractivitygroup: trimOrNull(p.markeractivitygroup),
    });
  }
  return map;
}

// ── Normalize + build a source_record row ───────────────────────────────

function normalize(
  props: InfraProps,
  category: string,
  name: string,
  siteCn: string,
  recOpp: RecOppEnrichment | null,
): Record<string, unknown> {
  const isDispersed = category === "dispersed_camping";
  return {
    canonical_name: name,
    description: trimOrNull(props.recarea_description),
    overlander_tags: [
      "federal_land",
      "usfs",
      ...(isDispersed ? ["dispersed_camping_likely" as const] : []),
    ],
    // No populated amenity fields on INFRA layer 0 in the six-state
    // sample; leaving null rather than emitting a bag of nulls.
    amenities: null,
    hours: null,
    contact: null,
    access: (() => {
      const bag = compact({
        operated_by: trimOrNull(props.operated_by),
        pack_in_out: trimOrNull(props.pack_in_out),
      });
      return Object.keys(bag).length > 0 ? bag : null;
    })(),

    // Dispersed-camping advisory (matches osm.ts / padus.ts / RecOpp-era usfs.ts).
    // Only emitted for the dispersed_camping category; mvum_corridor stubbed
    // null until PR-C wires MVUM proximity.
    ...(isDispersed
      ? { dispersed_camping: "likely_allowed", verify_locally: true, mvum_corridor: null }
      : {}),

    // INFRA-native fields (>50% populated in six-state; kept as-is).
    site_cn: siteCn,
    site_id: trimOrNull(props.site_id),
    site_type: trimOrNull(props.site_type),
    development_scale: toIntOrNull(props.development_scale),
    fee_charged: trimOrNull(props.fee_charged),
    recarea_name: trimOrNull(props.recarea_name),
    // `recarea_enable` is the reliable signal that a record has real
    // description/directions content vs a bare INFRA inventory stub.
    // Observed 100% correlation on the 20-row sample: recarea_enable=Y
    // → populated `recarea_description` + `directions`; N → boilerplate
    // "<NAME> (Camping Area)" and blank directions. Also surfaced under
    // `provenance` for cheap queryability.
    recarea_enable: trimOrNull(props.recarea_enable),
    parent_recarea: trimOrNull(props.parent_recarea),
    // Raw capacity value from INFRA. Common values include the small-pull-off
    // default of 5 plus real capacities up to 250 (persons or PAOTs). Store
    // as-is; do not bucket or normalize.
    total_capacity: toIntOrNull(props.total_capacity),
    // Unreliable field — see NOTE in InfraPropsSchema. Some rows carry
    // "feet" with no number.
    minimum_elevation: trimOrNull(props.minimum_elevation),
    fee_description: trimOrNull(props.fee_description),
    closest_towns: trimOrNull(props.closest_towns),
    restroom_availability: trimOrNull(props.restroom_availability),
    water_availability: trimOrNull(props.water_availability),
    directions: trimOrNull(props.directions),
    usda_portal_url: trimOrNull(props.usda_portal_url),

    // RecOpp enrichment — only ~30% match. Store all three enrichment
    // fields (nulls preserved) plus a `provenance` audit block so consumers
    // can see which fields came from RecOpp vs INFRA. `matched=false` when
    // the site had no RecOpp record.
    recopp: recOpp
      ? {
          url: recOpp.recareaurl,
          marker_activity: recOpp.markeractivity,
          marker_activity_group: recOpp.markeractivitygroup,
        }
      : null,
    operational_status: (() => {
      const raw = (props as Record<string, unknown>).seasonal_operational_status;
      if (raw == null) return null;
      const s = String(raw).toUpperCase().trim();
      return s === "OPEN" || s === "" || s === "NONE" ? null : s;
    })(),
    provenance: {
      infra_layer: "EDW_RecInfraRecreationSites_02:0",
      infra_cn: siteCn,
      recopp_matched: recOpp != null,
      // `recarea_enable` mirrored here so consumers can filter to
      // "records with real content" (Y) vs "bare inventory stubs" (N)
      // without deserializing the full normalized_payload.
      recarea_enable: trimOrNull(props.recarea_enable),
    },
  };
}

/**
 * Build a source_record upsert row from one INFRA feature, or null to skip
 * (schema mismatch / non-eligible category / no geometry / no site_cn / no
 * name). Pure except for warn-log on schema mismatch — no DB writes here.
 */
function buildRow(
  feature: GeoJsonFeature,
  allowedSiteTypes: ReadonlySet<string>,
  recOppMap: Map<string, RecOppEnrichment>,
): { row: Record<string, unknown> | null; skipReason: string | null } {
  const parsed = InfraPropsSchema.safeParse(feature.properties);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.flatten() }, "usfs.infra: props schema mismatch — skipped");
    return { row: null, skipReason: "schema_mismatch" };
  }
  const props = parsed.data;

  const siteType = trimOrNull(props.site_type);
  if (!siteType || !allowedSiteTypes.has(siteType)) {
    return { row: null, skipReason: `site_type_not_allowed:${siteType ?? "null"}` };
  }

  const { category, keep } = inferCategoryV1(siteType, trimOrNull(props.development_scale));
  if (!keep) return { row: null, skipReason: `category_gate:${siteType}:scale=${props.development_scale ?? "null"}` };

  const point = extractPoint(feature.geometry, props);
  if (!point) return { row: null, skipReason: "no_geometry" };

  const siteCn = trimOrNull(props.site_cn);
  if (!siteCn) {
    logger.warn({ site_name: props.site_name, site_id: props.site_id }, "usfs.infra: row missing site_cn — skipped");
    return { row: null, skipReason: "no_site_cn" };
  }

  const name = bestName(props);
  if (!name) return { row: null, skipReason: "no_name" };

  const externalId = `usfs:site:${siteCn}`;
  const recOpp = recOppMap.get(siteCn) ?? null;

  return {
    row: {
      source_id: SOURCE_ID,
      external_id: externalId,
      name,
      inferred_category: category,
      geometry: pointEwkt(point),
      raw_payload: { props, fetched_at: new Date().toISOString() },
      normalized_payload: normalize(props, category, name, siteCn, recOpp),
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

  // Resolve the site-type filter. Default = all six mapped types when the
  // caller didn't restrict. Unknown tokens throw at parse time (caller-side).
  const siteTypeTokens = opts.siteTypes ?? DEFAULT_SITE_TYPE_TOKENS;
  const allowedSiteTypes = new Set<string>();
  for (const t of siteTypeTokens) {
    const v = SITE_TYPE_TOKENS[t];
    if (!v) throw new Error(`usfs: unknown site-type token '${t}'. Allowed: ${Object.keys(SITE_TYPE_TOKENS).join(", ")}`);
    allowedSiteTypes.add(v);
  }

  const filter = await resolveCorridorFilter(opts.bbox);
  logger.info(
    { filter: filter.kind, site_types: [...allowedSiteTypes] },
    "usfs.infra: ingest start",
  );

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.usfs;
  if (!limit) throw new Error("usfs: rate limiter missing — check lib/rate-limit.ts");
  const dryRun = opts.dryRun ?? false;

  // Enrichment counters — exposed via the log line, not the IngestResult
  // shape (which is fixed for CI compatibility).
  let recOppMatches = 0;
  const skipCounts: Record<string, number> = {};

  await limit(async () => {
    // Server-side site_type filter to cut transfer volume. CAMPING AREA at
    // scale > 1 is not excluded server-side (the scale filter is applied
    // per-row in inferCategoryV1) — the server-side clause is a coarse
    // pre-filter, the JS keeps the final say.
    const inList = [...allowedSiteTypes].map(s => `'${s.replace(/'/g, "''")}'`).join(",");
    const where = `site_type IN (${inList})`;

    logger.info({ where }, "usfs.infra: fetching INFRA layer 0");
    const infraFeatures = await fetchEsriFeatures(INFRA_ENDPOINT, filter, {
      where,
      label: "usfs.infra",
      userAgent: USER_AGENT,
    });
    stats.fetched = infraFeatures.length;
    logger.info({ fetched: infraFeatures.length }, "usfs.infra: INFRA features fetched");

    // Enrichment fetch — RecOpp records with an infra_cn back-pointer,
    // clipped to the same spatial filter. ~30% of INFRA sites will match.
    logger.info("usfs.infra: fetching RecOpp enrichment (infra_cn IS NOT NULL)");
    const recOppMap = await buildRecOppMap(filter);
    logger.info({ recopp_records: recOppMap.size }, "usfs.infra: RecOpp enrichment map built");

    // Build rows. Skips are non-writes.
    const rows: Record<string, unknown>[] = [];
    for (const feature of infraFeatures) {
      const { row, skipReason } = buildRow(feature, allowedSiteTypes, recOppMap);
      if (row) {
        rows.push(row);
        // A row was built ⇒ check recopp_matched from the normalized payload
        const np = row.normalized_payload as { provenance?: { recopp_matched?: boolean } };
        if (np?.provenance?.recopp_matched) recOppMatches += 1;
      } else {
        stats.skipped += 1;
        if (skipReason) skipCounts[skipReason.split(":")[0]] = (skipCounts[skipReason.split(":")[0]] ?? 0) + 1;
      }
    }

    logger.info(
      {
        rows_ready: rows.length,
        skipped: stats.skipped,
        skip_breakdown: skipCounts,
        recopp_matches: recOppMatches,
        recopp_match_rate: rows.length > 0 ? (recOppMatches / rows.length).toFixed(3) : "0",
      },
      "usfs.infra: rows built",
    );

    if (dryRun) {
      // Dry-run: emit ready-row count and first-3 sample payloads for eyeballing.
      // No batchUpsert; no DB writes.
      logger.info(
        { wouldWrite: rows.length, skipped: stats.skipped },
        "usfs.infra: dry-run (no writes)",
      );
      stats.inserted = rows.length;
      // Dump the first 3 rows' normalized_payloads as a sanity check.
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        logger.info(
          { sample: i + 1, external_id: rows[i].external_id, name: rows[i].name, category: rows[i].inferred_category, normalized_payload: rows[i].normalized_payload },
          "usfs.infra: dry-run sample",
        );
      }
      return;
    }

    // Live write path — FAIL-LOUD batched upsert.
    const { written } = await batchUpsert({
      table: "source_record",
      rows,
      onConflict: "source_id,external_id",
      label: "usfs.infra",
    });
    stats.inserted = written;
    if (written !== rows.length) {
      throw new Error(`usfs: wrote ${written} of ${rows.length} prepared rows`);
    }
    logger.info(
      { fetched: stats.fetched, skipped: stats.skipped, written, recopp_matches: recOppMatches },
      "usfs.infra: write complete",
    );
  });

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "usfs.infra: ingestion complete");
  return result;
};

export default ingest;

// Test seam: pure helpers exercised without network or DB.
export const _internals = {
  bestName,
  buildRow,
  extractPoint,
  inferCategoryV1,
  normalize,
  InfraPropsSchema,
  RecOppPropsSchema,
  SITE_TYPE_TOKENS,
  DEFAULT_SITE_TYPE_TOKENS,
};
