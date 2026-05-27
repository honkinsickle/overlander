/**
 * Per-source concurrency limiters.
 * Conservative defaults; tune per source as we observe real rate-limit behavior.
 */

import pLimit, { type LimitFunction } from "p-limit";

export const limits: Record<string, LimitFunction> = {
  osm: pLimit(2),         // Overpass is community-run; keep low.
  google: pLimit(10),     // Plenty of headroom in Places quota.
  ridb: pLimit(4),
  nps: pLimit(4),
  ioverlander: pLimit(1), // No public API. Be polite.
};
