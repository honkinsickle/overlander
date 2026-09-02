/**
 * Shared two-phase entity-resolution runner for the state-park visitor-content
 * sources (CA / WA / OR / NV).
 *
 *   Phase 1 — spatial pre-link: point-in-polygon against that state's slice of
 *     the `state_parks` GIS source. The standard 500m ER radius is far too
 *     small for large parks whose polygon centroids sit kilometres from the
 *     website point (measured on CA 2026-09-01: Auburn SRA 10.9 km,
 *     Anza-Borrego 7.4 km, Mt. Tamalpais 3.6 km).
 *   Phase 2 — standard `matchAll` → `applyMatches` for the remainder.
 *
 * The four states previously carried independently-duplicated copies of this,
 * which is how the overlapping-polygon bug (see `spatial-prelink.ts`) came to
 * be fixed in one and left stale in the others. One runner, four configs.
 *
 * Modes, uniform across every state:
 *   (default)   apply both phases
 *   --dry-run   compute both phases, write nothing
 *   --verify    re-derive phase 1 over EVERY record regardless of current link
 *               state and diff against the `spatial_containment` rows already
 *               in `place_match`. Writes nothing.
 *
 * `--verify` exists because the obvious check is vacuous: once a source is
 * fully linked, `--dry-run` finds zero unlinked rows and reports success
 * having exercised no containment logic at all.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { matchAll } from "../../entity-resolution/matcher.ts";
import { applyMatches } from "../../entity-resolution/promote.ts";
import { logger } from "../../ingestion/lib/logger.ts";
import {
  computeSpatialMatches,
  printVerifyReport,
  verifyAgainstRecorded,
  type ParkPolygon,
  type PrelinkRecord,
  type SpatialMatch,
} from "./spatial-prelink.ts";

export interface StateParksErConfig {
  /** Visitor-content source_id, e.g. `california_state_parks`. */
  sourceId: string;
  /** LIKE pattern for that state's slice of the GIS source, e.g. `state_parks:CA:%`. */
  gisPrefix: string;
  /** Stamp written to `place_match.resolved_by` for phase-1 links. */
  resolvedBy: string;
  /** Short log prefix, e.g. `ca-er`. */
  label: string;
}

interface SourceRow extends PrelinkRecord {
  externalId: string;
  masterPlaceId: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Coordinates arrive as strings from CSV sources and numbers from JSON ones. */
function toNumber(v: unknown): number {
  return typeof v === "number" ? v : parseFloat(String(v));
}

function makeClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Assemble that state's park polygons, keyed by the master_place they resolved
 * to. Reads `normalized_payload.geometry_polygon` off the `state_parks` source
 * records rather than `master_place.geometry_polygon` — the latter is a PostGIS
 * type PostgREST won't project as GeoJSON without a bespoke RPC.
 */
async function fetchParkPolygons(sb: SupabaseClient, cfg: StateParksErConfig): Promise<ParkPolygon[]> {
  const rows: unknown[] = [];
  for (let off = 0; ; off += 1000) {
    const p = await sb
      .from("source_record")
      .select("master_place_id, normalized_payload")
      .eq("source_id", "state_parks")
      .ilike("external_id", cfg.gisPrefix)
      .not("master_place_id", "is", null)
      .order("id")
      .range(off, off + 999);
    if (p.error || p.data == null) {
      throw new Error(`fetch ${cfg.gisPrefix} failed: ${JSON.stringify(p.error)}`);
    }
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }
  logger.info({ gisRows: rows.length }, `${cfg.label}: fetched GIS source_records`);

  const byMp = new Map<string, ParkPolygon>();
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const mpId = r.master_place_id;
    const np = r.normalized_payload;
    if (typeof mpId !== "string" || !isRecord(np)) continue;
    const poly = np.geometry_polygon;
    if (!isRecord(poly) || typeof poly.type !== "string") continue;
    if (byMp.has(mpId)) continue;
    byMp.set(mpId, {
      mpId,
      canonicalName: typeof np.canonical_name === "string" ? np.canonical_name : "",
      polygon: poly as unknown as ParkPolygon["polygon"],
    });
  }
  const out = [...byMp.values()];
  logger.info({ polygons: out.length }, `${cfg.label}: assembled distinct park polygons`);
  return out;
}

/** `onlyUnlinked` is the normal ER path; --verify passes false. */
async function fetchSourceRecords(
  sb: SupabaseClient,
  cfg: StateParksErConfig,
  onlyUnlinked: boolean,
): Promise<SourceRow[]> {
  const rows: unknown[] = [];
  for (let off = 0; ; off += 1000) {
    let q = sb
      .from("source_record")
      .select("id, external_id, name, master_place_id, raw_payload")
      .eq("source_id", cfg.sourceId);
    if (onlyUnlinked) q = q.is("master_place_id", null);
    const p = await q.order("id").range(off, off + 999);
    if (p.error || p.data == null) {
      throw new Error(`fetch ${cfg.sourceId} failed: ${JSON.stringify(p.error)}`);
    }
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }

  const out: SourceRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const raw = isRecord(r.raw_payload) && isRecord(r.raw_payload.row) ? r.raw_payload.row : {};
    out.push({
      id: String(r.id),
      externalId: String(r.external_id),
      name: typeof r.name === "string" ? r.name : "",
      masterPlaceId: typeof r.master_place_id === "string" ? r.master_place_id : null,
      lon: toNumber(raw.lon),
      lat: toNumber(raw.lat),
    });
  }
  return out;
}

async function applySpatialLink(
  sb: SupabaseClient,
  cfg: StateParksErConfig,
  m: SpatialMatch,
): Promise<void> {
  const u = await sb.from("source_record").update({ master_place_id: m.mpId }).eq("id", m.srcId);
  if (u.error) throw new Error(`spatial link update failed for ${m.srcId}: ${u.error.message}`);

  const i = await sb.from("place_match").insert({
    source_record_id: m.srcId,
    master_place_id: m.mpId,
    distance_meters: 0,
    name_similarity: 0,
    category_compatibility: 0,
    combined_confidence: 1.0,
    match_method: "spatial_containment",
    status: "confirmed",
    resolved_by: cfg.resolvedBy,
    resolved_at: new Date().toISOString(),
    notes: `Spatial pre-link: ${m.srcName} → ${m.mpName}`,
  });
  if (i.error && !i.error.message.includes("duplicate")) {
    throw new Error(`place_match insert failed: ${i.error.message}`);
  }

  const r = await sb.rpc("recompute_master_place", { p_master_place_id: m.mpId });
  if (r.error) logger.warn({ err: r.error, mpId: m.mpId }, `${cfg.label}: recompute returned error`);
}

/** Entry point every per-state script calls. Reads flags from `process.argv`. */
export async function runStateParksEr(cfg: StateParksErConfig): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verifyMode = process.argv.includes("--verify");
  const sb = makeClient();

  logger.info({ dryRun, verify: verifyMode, sourceId: cfg.sourceId }, `${cfg.label}: starting`);
  const polys = await fetchParkPolygons(sb, cfg);

  if (verifyMode) {
    const all = await fetchSourceRecords(sb, cfg, false);
    logger.info({ records: all.length }, `${cfg.label}/verify: source_records under test`);
    const report = await verifyAgainstRecorded(sb, all, polys);
    printVerifyReport(cfg.sourceId, polys.length, all.length, report);
    return;
  }

  const unlinked = await fetchSourceRecords(sb, cfg, true);
  logger.info({ unlinked: unlinked.length }, `${cfg.label}: fetched unlinked source_records`);
  if (unlinked.length === 0) {
    logger.info({}, `${cfg.label}: nothing unlinked — no work. (Use --verify to re-derive phase 1.)`);
    return;
  }

  const { matched, unmatched } = computeSpatialMatches(unlinked, polys, (src, chosen, among) => {
    logger.debug(
      { src: src.name, chose: chosen.canonicalName, among: among.map((c) => c.canonicalName) },
      `${cfg.label}: overlapping polygons — disambiguated by name`,
    );
  });
  logger.info(
    { spatialLinked: matched.length, remaining: unmatched.length },
    `${cfg.label}: phase 1 spatial pre-link result`,
  );

  if (!dryRun) {
    for (const m of matched) {
      try {
        await applySpatialLink(sb, cfg, m);
      } catch (err) {
        logger.error({ err, match: m }, `${cfg.label}: spatial link apply failed`);
      }
    }
  }
  logger.info({ applied: dryRun ? 0 : matched.length, dryRun }, `${cfg.label}: phase 1 apply complete`);

  if (unmatched.length === 0) {
    logger.info({}, `${cfg.label}: nothing left for phase 2`);
    return;
  }

  logger.info({ n: unmatched.length }, `${cfg.label}: phase 2 — matchAll on the remainder`);
  const outcomes = await matchAll(unmatched.map((m) => m.id));
  logger.info({ outcomes: outcomes.length }, `${cfg.label}: matchAll returned`);

  if (dryRun) {
    const byKind: Record<string, number> = {};
    for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    logger.info({ byKind }, `${cfg.label}: dry-run — outcome breakdown (not applied)`);
    return;
  }

  const result = await applyMatches(outcomes);
  logger.info({ result }, `${cfg.label}: applyMatches complete`);
}
