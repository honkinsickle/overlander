/**
 * Per-source concurrency limiters.
 * Conservative defaults; tune per source as we observe real rate-limit behavior.
 */

import pLimit, { type LimitFunction } from "p-limit";

export const limits: Record<string, LimitFunction> = {
  osm: pLimit(2),         // Overpass is community-run; keep low.
  google: pLimit(10),     // Plenty of headroom in Places quota.
  // pLimit(1) — RIDB rate-limits concurrent requests, not overall rate.
  // pLimit(4) throttled after ~3-4 minutes of sustained traffic (measured
  // on UT twice); pLimit(1) ran OR through cleanly at ~4x wall time with
  // zero 429s. If RIDB documents a higher tier or the throttle behavior
  // changes, this can be raised.
  ridb: pLimit(1),
  nps: pLimit(4),
  parks_canada: pLimit(4), // ESRI REST endpoints; no documented rate limit, be polite.
  bc_parks: pLimit(5), // DataBC WFS + BC Parks REST API; ~5 req/sec courtesy limit.
  alberta_parks: pLimit(5), // GeoDiscover Alberta ESRI REST; no documented limit, be polite.
  padus: pLimit(4), // USGS PAD-US ArcGIS Online FeatureServer; no documented limit, be polite.
  usfs: pLimit(4), // USFS EDW ArcGIS REST (apps.fs.usda.gov); no documented limit, be polite.
  ioverlander: pLimit(1), // No public API. Be polite.
};
