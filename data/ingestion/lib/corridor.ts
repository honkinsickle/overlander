/**
 * Active-corridor lookup. Sources that don't take a manual bbox use the
 * active corridor's buffered envelope as their spatial filter.
 *
 * Reads from the `active_corridor_buffer` view (defined in
 * 20260527120400_phase1_ingestion_corridor.sql), which exposes the
 * buffered polygon's bbox as four float columns. No client-side geometry
 * parsing needed.
 */

import { getDb } from "./db.ts";
import {
  envelopeFilter,
  esriPolygonFromGeoJson,
  type EsriPolygon,
  type EsriSpatialFilter,
} from "./esri.ts";
import type { BoundingBox } from "./geometry.ts";

export interface ActiveCorridor {
  id: string;
  name: string;
  bbox: BoundingBox;
}

/**
 * Fetch the bbox envelope of the active corridor buffer.
 * Returns null if no corridor is active (e.g. fresh database).
 */
export async function getActiveCorridorBbox(): Promise<ActiveCorridor | null> {
  const db = getDb();

  const { data, error } = await db
    .from("active_corridor_buffer")
    .select("id, name, bbox_west, bbox_south, bbox_east, bbox_north")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    bbox: [
      data.bbox_west as number,
      data.bbox_south as number,
      data.bbox_east as number,
      data.bbox_north as number,
    ],
  };
}

/**
 * Fetch the active corridor BUFFER POLYGON as an ESRI polygon (clockwise
 * exterior ring), for use as an ESRI `/query` spatial filter. Returns null
 * when no corridor is active.
 *
 * The CW exterior orientation is produced server-side by the
 * `active_corridor_buffer_cw_geojson` RPC (ST_ForcePolygonCW) — ESRI treats a
 * CCW outer ring as a hole and returns ~0 features. `esriPolygonFromGeoJson`
 * re-enforces winding defensively.
 */
export async function getActiveCorridorPolygon(): Promise<EsriPolygon | null> {
  const db = getDb();
  const { data, error } = await db.rpc("active_corridor_buffer_cw_geojson");
  if (error) throw error;
  if (data == null) return null; // no active corridor
  const geojson = typeof data === "string" ? JSON.parse(data) : data;
  return esriPolygonFromGeoJson(geojson as { type?: string; coordinates?: unknown });
}

/**
 * Resolve the spatial filter for an ESRI loader.
 *
 * Default (no explicit bbox): clip by the active corridor BUFFER POLYGON.
 * Explicit `bbox` (e.g. a `--bbox` override): use the bbox envelope.
 * Throws when neither is available — never silently falls back to an
 * unbounded query.
 */
export async function resolveCorridorFilter(bbox?: BoundingBox | null): Promise<EsriSpatialFilter> {
  if (bbox) return envelopeFilter(bbox);
  const polygon = await getActiveCorridorPolygon();
  if (polygon) return { kind: "polygon", polygon };
  throw new Error(
    "No active corridor buffer found and no --bbox provided. " +
      "Deploy a corridor (deploy-corridor) or pass an explicit --bbox.",
  );
}
