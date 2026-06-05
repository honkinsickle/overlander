/**
 * Phase 2 PR-C — MVUM open-route reference-data loader.
 *
 * Loads USFS MVUM (Motor Vehicle Use Map) line geometry for a corridor bbox
 * into the `mvum_roads` reference table, which recompute_master_place reads to
 * set the `mvum_corridor` flag on dispersed_camping places.
 *
 * NOT a federated source: MVUM never becomes a source_record / master_place
 * (ADR 2026-06-02 — "MVUM → mvum_corridor only, not places"). It is pure
 * spatial reference data, so it lives as a script + its own upsert RPC, not in
 * the ingest:manual source harness.
 *
 * Source: USFS EDW EDW_MVUM_01 MapServer layer 1 (polyline). Reachable
 * ArcGIS REST (apps.fs.usda.gov), rides the shared lib/esri.ts client.
 *
 * Keying: rte_cn (route common number) — stable across builds, unlike
 * objectid/globalid (per-build surrogates). A route may split into several
 * LineString segments sharing one rte_cn; this loader aggregates a route's
 * segments into one MultiLineString row. MVP: every segment is treated as
 * open (no per-vehicle-class / seasonal filtering — deferred per ADR).
 *
 * ENV: loaded by the npm script via `tsx --env-file=.env`:
 *   npm run -w data mvum:load -- --bbox=-117.62,34.00,-116.63,34.38
 *   npm run -w data mvum:load -- --bbox=… --dry-run
 *   npm run -w data mvum:load -- --bbox=… --confirm     (prod target)
 *
 * Negative-leading bbox: use the `--bbox=…` form so commander doesn't read the
 * leading `-` as a flag.
 */

import { Command } from "commander";

import { resolveCorridorFilter } from "../ingestion/lib/corridor.ts";
import { batchUpsert } from "../ingestion/lib/db.ts";
import { fetchEsriFeatures } from "../ingestion/lib/esri.ts";
import { multiLineStringEwkt } from "../ingestion/lib/ewkt.ts";
import type { GeoJsonFeature } from "../ingestion/lib/geojson.ts";
import { parseBboxString } from "../ingestion/lib/geometry.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { limits } from "../ingestion/lib/rate-limit.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1";
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m?.[1] ?? "unknown";
}

interface RouteGroup {
  /** GeoJSON MultiLineString geometry: one entry per segment of the route. */
  geojson: { type: "MultiLineString"; coordinates: number[][][] };
  segments: number;
}

/**
 * Group MVUM polyline features by rte_cn into one MultiLineString per route.
 *
 * EDW returns mostly LineString features (one per segment) but also some
 * MultiLineString features (multi-part segments). A route (rte_cn) may span
 * several features of either type. Every feature's constituent line(s) are
 * collected into the route's single MultiLineString — spatially identical to
 * per-segment storage for the proximity check, but keyed stably on rte_cn.
 * (Confirmed empirically: in the SB-NF bbox, 17 routes appear ONLY via
 * MultiLineString features, so dropping them would silently lose real roads.)
 *
 * Features with a null/empty rte_cn are skipped (counted, not keyed on the
 * unstable objectid). Geometries that are neither LineString nor
 * MultiLineString are skipped defensively.
 */
export function groupRoutesByRteCn(features: GeoJsonFeature[]): {
  routes: Map<string, RouteGroup>;
  skippedNoKey: number;
  skippedGeom: number;
} {
  const routes = new Map<string, RouteGroup>();
  let skippedNoKey = 0;
  let skippedGeom = 0;

  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const raw = props.rte_cn;
    const rteCn = raw === null || raw === undefined ? "" : String(raw).trim();
    if (rteCn === "") {
      skippedNoKey += 1;
      continue;
    }
    const geom = f.geometry;
    let lines: number[][][];
    if (geom && geom.type === "LineString" && Array.isArray(geom.coordinates)) {
      lines = [geom.coordinates as number[][]];
    } else if (geom && geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      lines = geom.coordinates as number[][][];
    } else {
      skippedGeom += 1;
      continue;
    }
    const existing = routes.get(rteCn);
    if (existing) {
      existing.geojson.coordinates.push(...lines);
      existing.segments += 1;
    } else {
      routes.set(rteCn, {
        geojson: { type: "MultiLineString", coordinates: [...lines] },
        segments: 1,
      });
    }
  }

  return { routes, skippedNoKey, skippedGeom };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mvum:load")
    .description("Load USFS MVUM open routes into mvum_roads (default: active corridor buffer)")
    .option("--bbox <w,s,e,n>", "override: bbox envelope west,south,east,north (default: corridor buffer polygon)")
    .option("--dry-run", "fetch + group + log, but write nothing", false)
    .option("--confirm", "required when the target project is PRODUCTION", false)
    .parse(process.argv);

  const opts = program.opts<{ bbox?: string; dryRun: boolean; confirm: boolean }>();
  // Default to the active corridor BUFFER POLYGON; --bbox is an explicit override.
  const filter = await resolveCorridorFilter(opts.bbox ? parseBboxString(opts.bbox) : null);
  const ref = targetRef();

  if (ref === PROD_REF && !opts.confirm) {
    throw new Error(
      `Target is PRODUCTION (${ref}). Re-run with --confirm to load MVUM into prod.`,
    );
  }
  logger.info({ filter: filter.kind, ref, dryRun: opts.dryRun }, "mvum:load: start");

  const limit = limits.usfs; // same host (apps.fs.usda.gov); reuse the USFS limiter.
  if (!limit) throw new Error("mvum:load: rate limiter missing — check lib/rate-limit.ts");

  const features = await limit(() =>
    fetchEsriFeatures(ENDPOINT, filter, {
      where: "1=1",
      label: "mvum",
      userAgent: USER_AGENT,
    }),
  );
  logger.info({ fetched: features.length }, "mvum:load: features fetched");
  if (features.length === 0) {
    throw new Error(
      "mvum:load: 0 features — empty read is suspect. Check bbox / endpoint reachability before concluding 'no roads'.",
    );
  }

  const { routes, skippedNoKey, skippedGeom } = groupRoutesByRteCn(features);
  logger.info(
    { routes: routes.size, segments: features.length, skippedNoKey, skippedGeom },
    "mvum:load: grouped by rte_cn",
  );

  const stats = { routes: routes.size, upserted: 0, errors: 0, skippedNoKey, skippedGeom };

  if (opts.dryRun) {
    logger.info(stats, "mvum:load: dry-run complete (no writes)");
  } else {
    // Build batched rows (geom as EWKT MultiLineString), then FAIL-LOUD upsert:
    // a chunk that fails after retries throws → non-zero exit, not a silent drop.
    const nowIso = new Date().toISOString();
    const rows = [...routes.entries()].map(([rteCn, group]) => ({
      rte_cn: rteCn,
      geom: multiLineStringEwkt(group.geojson.coordinates),
      loaded_at: nowIso,
    }));
    const { written } = await batchUpsert({
      table: "mvum_roads",
      rows,
      onConflict: "rte_cn",
      label: "mvum:load",
    });
    stats.upserted = written;
    if (written !== routes.size) {
      throw new Error(`mvum:load: wrote ${written} of ${routes.size} routes`);
    }
    logger.info(stats, "mvum:load: complete");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ref, filter: filter.kind, dryRun: opts.dryRun, ...stats }, null, 2));
  process.exit(stats.errors > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "mvum:load: fatal");
    process.exit(1);
  });
}
