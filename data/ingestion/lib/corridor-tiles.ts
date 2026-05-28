/**
 * Corridor → bbox tiling for sources whose query model doesn't accept
 * a giant envelope.
 *
 * Design contract (per phase-3-corridor-expansion-spec.md §2.2):
 *   - OSM ingester already sub-tiles internally at 50km, so feed it the
 *     whole-segment envelope; no external tiling required.
 *   - RIDB converts (bbox → centroid + radius). A 1500-mile segment
 *     envelope produces a radius the RIDB API can't usefully serve.
 *     External tiling is required.
 *   - NPS is parkCode-driven; tiling doesn't apply.
 *   - Google enrichment + discovery is anchor-based, not envelope-based;
 *     tiling doesn't apply.
 *
 * Target: ~5–15 tiles per segment (spec §2.2). The strategy here walks
 * the envelope in fixed-height latitude strips because the LA→Deadhorse
 * corridor is much taller than it is wide (the route's W↔E span is
 * roughly constant ~8° across all three segments, but its N↔S span
 * varies 15–20° per segment).
 */

import type { BoundingBox } from "./geometry.ts";

export interface CorridorTilingOptions {
  /**
   * Strip height in degrees of latitude. Default 2.0 ≈ 220km tall.
   * Picked so Segment A (~16° tall) yields ~8 tiles — middle of the
   * spec's 5–15 range.
   */
  stripHeightDeg?: number;
}

/**
 * Tile a corridor's envelope bbox into latitude strips. Each strip
 * spans the full longitude range of the envelope; the height is
 * `stripHeightDeg`.
 *
 * Returns at least one tile (the whole envelope if shorter than the
 * strip height).
 */
export function tileCorridorEnvelope(
  envelope: BoundingBox,
  opts: CorridorTilingOptions = {},
): BoundingBox[] {
  const stripHeight = opts.stripHeightDeg ?? 2.0;
  const [west, south, east, north] = envelope;

  if (north - south <= stripHeight) {
    return [envelope];
  }

  const tiles: BoundingBox[] = [];
  for (let lat = south; lat < north; lat += stripHeight) {
    const top = Math.min(lat + stripHeight, north);
    tiles.push([west, lat, east, top]);
  }
  return tiles;
}
