/**
 * Two-phase entity resolution for `nevada_state_parks`.
 *
 * Mirrors the OR pattern (data/scripts/or-state-parks-er.ts):
 *   1. Spatial pre-link: point-in-polygon against existing NV
 *      state_parks GIS boundaries. The standard 500m ER radius is too
 *      small for large parks whose polygon centroids sit kilometers
 *      from the website point.
 *   2. Standard matchAll → applyMatches for the remainder.
 *
 * NV corpus notes (see docs/DATA_INVENTORY.md):
 *   - state_parks:NV:park:* → 27 polygons
 *   - nevada_state_parks:* → 28 visitor rows
 *   - Known M:N cases route through this ER as-is:
 *       * Walker River SRA (1 visitor row) may spatially match one of
 *         4 GIS sub-ranch polygons (9 Mile, Flying M, Pitchfork, Rafter 7).
 *       * Lake Tahoe Nevada (Cave Rock, Sand Harbor, Spooner, Van
 *         Sickle in the visitor scrape) intersects 3 GIS polygons.
 *       * Old LV Mormon Fort, Spring Mountain Ranch, Nevada's Newest
 *         State Park have no GIS polygon and will become solo
 *         master_places via matchAll.
 *     Manual triage is expected for these — same treatment as CA/OR.
 *
 * Run:
 *   npx tsx --env-file=.env scripts/nv-state-parks-er.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { matchAll } from "../entity-resolution/matcher.ts";
import { applyMatches } from "../entity-resolution/promote.ts";
import { logger } from "../ingestion/lib/logger.ts";

const SOURCE_ID = "nevada_state_parks";
const DRY_RUN = process.argv.includes("--dry-run");

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface SourceRow {
  id: string;
  external_id: string;
  name: string;
  inferred_category: string | null;
  master_place_id: string | null;
}

// ───── Phase 1 (JS point-in-polygon against state_parks GIS boundaries) ────

async function fetchNvStateParkPolygons(): Promise<Array<{ id: string; canonical_name: string; polygon: any }>> {
  // All NV state_parks master_places with a GIS polygon in normalized_payload.
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const p = await sb
      .from("source_record")
      .select("master_place_id, normalized_payload")
      .eq("source_id", "state_parks")
      .ilike("external_id", "state_parks:NV:%")
      .not("master_place_id", "is", null)
      .order("id")
      .range(off, off + 999);
    if (p.error || p.data == null) { throw new Error(`fetch state_parks NV failed: ${JSON.stringify(p.error)}`); }
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }
  logger.info({ mps: rows.length }, "nv-er: fetched NV state_parks master_places (with polygons)");

  // Use normalized_payload.geometry_polygon (GeoJSON) rather than the
  // PostGIS master_place.geometry_polygon column — avoids a custom RPC.
  const byMp = new Map<string, { canonical_name: string; polygon: any }>();
  for (const r of rows) {
    const poly = r.normalized_payload?.geometry_polygon;
    if (poly && r.master_place_id && !byMp.has(r.master_place_id)) {
      byMp.set(r.master_place_id, { canonical_name: r.normalized_payload?.canonical_name ?? "", polygon: poly });
    }
  }
  const result = [...byMp.entries()].map(([id, v]) => ({ id, canonical_name: v.canonical_name, polygon: v.polygon }));
  logger.info({ polygons: result.length }, "nv-er: assembled polygons from source_record payload");
  return result;
}

// Simple ray-casting point-in-polygon (handles Polygon and MultiPolygon)
function pointInPolygon(pt: [number, number], poly: any): boolean {
  const [px, py] = pt;
  const rings: number[][][] =
    poly.type === "Polygon" ? poly.coordinates :
    poly.type === "MultiPolygon" ? poly.coordinates.flat() :
    [];
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

async function fetchUnlinkedSourceRecords(): Promise<Array<SourceRow & { lon: number; lat: number }>> {
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const p = await sb
      .from("source_record")
      .select("id, external_id, name, inferred_category, master_place_id, raw_payload")
      .eq("source_id", SOURCE_ID)
      .is("master_place_id", null)
      .order("id")
      .range(off, off + 999);
    if (p.error || p.data == null) throw new Error(`fetch unlinked failed: ${JSON.stringify(p.error)}`);
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }
  return rows.map(r => {
    const raw = r.raw_payload?.row ?? {};
    return {
      id: r.id,
      external_id: r.external_id,
      name: r.name,
      inferred_category: r.inferred_category,
      master_place_id: r.master_place_id,
      lon: typeof raw.lon === "number" ? raw.lon : parseFloat(raw.lon),
      lat: typeof raw.lat === "number" ? raw.lat : parseFloat(raw.lat),
    };
  });
}

async function applySpatialLink(match: { srcId: string; mpId: string; srcName: string; mpName: string; distanceM: number }): Promise<void> {
  if (DRY_RUN) return;
  const u = await sb.from("source_record").update({ master_place_id: match.mpId }).eq("id", match.srcId);
  if (u.error) throw new Error(`spatial link update failed for ${match.srcId}: ${u.error.message}`);
  const i = await sb.from("place_match").insert({
    source_record_id: match.srcId,
    master_place_id: match.mpId,
    distance_meters: match.distanceM,
    name_similarity: 0,
    category_compatibility: 0,
    combined_confidence: 1.0,
    match_method: "spatial_containment",
    status: "confirmed",
    resolved_by: "auto:nevada_state_parks_er",
    resolved_at: new Date().toISOString(),
    notes: `Spatial pre-link: ${match.srcName} → ${match.mpName}`,
  });
  if (i.error && !i.error.message.includes("duplicate")) {
    throw new Error(`place_match insert failed: ${i.error.message}`);
  }
  const r = await sb.rpc("recompute_master_place", { p_master_place_id: match.mpId });
  if (r.error) logger.warn({ err: r.error, mpId: match.mpId }, "nv-er: recompute_master_place returned error");
}

// ───── Main ───────────────────────────────────────────────────────────

async function main() {
  logger.info({ dryRun: DRY_RUN, sourceId: SOURCE_ID }, "nv-er: starting");

  const polys = await fetchNvStateParkPolygons();
  const unlinked = await fetchUnlinkedSourceRecords();
  logger.info({ unlinked: unlinked.length }, "nv-er: fetched unlinked source_records");

  // Phase 1: spatial pre-link
  const linked: Array<{ srcId: string; mpId: string; srcName: string; mpName: string; distanceM: number }> = [];
  const missed: SourceRow[] = [];
  for (const src of unlinked) {
    if (Number.isNaN(src.lon) || Number.isNaN(src.lat)) { missed.push(src); continue; }
    let match: { mpId: string; mpName: string } | null = null;
    for (const p of polys) {
      if (pointInPolygon([src.lon, src.lat], p.polygon)) {
        match = { mpId: p.id, mpName: p.canonical_name };
        break;
      }
    }
    if (match) {
      linked.push({ srcId: src.id, mpId: match.mpId, srcName: src.name, mpName: match.mpName, distanceM: 0 });
    } else {
      missed.push(src);
    }
  }
  logger.info({ spatial_linked: linked.length, remaining: missed.length }, "nv-er: phase 1 spatial pre-link result");

  for (const m of linked) {
    try {
      await applySpatialLink(m);
    } catch (err) {
      logger.error({ err, match: m }, "nv-er: spatial link apply failed");
    }
  }
  logger.info({ applied: linked.length, dryRun: DRY_RUN }, "nv-er: phase 1 apply complete");

  // Phase 2: standard matchAll for the remainder
  if (missed.length === 0) {
    logger.info({}, "nv-er: nothing left for phase 2");
    return;
  }
  logger.info({ n: missed.length }, "nv-er: phase 2 — running matchAll on remaining NV source_records");
  const outcomes = await matchAll(missed.map(m => m.id));
  logger.info({ outcomes: outcomes.length }, "nv-er: matchAll returned");

  if (DRY_RUN) {
    const byKind: Record<string, number> = {};
    for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    logger.info({ byKind }, "nv-er: dry-run — outcome breakdown (not applied)");
    return;
  }

  const result = await applyMatches(outcomes);
  logger.info({ result }, "nv-er: applyMatches complete");
}

main().catch((e) => { logger.error({ err: e }, "nv-er: fatal"); process.exit(1); });
