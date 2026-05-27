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
