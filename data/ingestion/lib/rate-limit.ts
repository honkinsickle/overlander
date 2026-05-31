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
  parks_canada: pLimit(4), // ESRI REST endpoints; no documented rate limit, be polite.
  bc_parks: pLimit(5), // DataBC WFS + BC Parks REST API; ~5 req/sec courtesy limit.
  ioverlander: pLimit(1), // No public API. Be polite.
};
