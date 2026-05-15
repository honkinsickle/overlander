/**
 * Discover places of interest within a configurable radius of a
 * day-segment's polyline. Built on top of the existing
 * `lib/discovery/discovery.ts` aggregator — this module's job is just
 * to convert a route polyline into a series of search bboxes and
 * route them through the existing infra.
 *
 * Per the shape brief (Diary/2026-05-15-shape-distance-per-day.md):
 *  - Default radius is 25 mi, user-adjustable later from the trip page.
 *  - Default sources are Foursquare + RIDB (Recreation.gov).
 *  - One uniform radius across all categories (the existing per-day-
 *    endpoint flow scales radius by category; this segment-scoped flow
 *    intentionally does not — the user's single "radius" slider is
 *    what's adjustable).
 *
 * Sampling: walk the segment polyline by haversine distance, drop a
 * search point every ~1.5 × radius. The 1.5× spacing gives ~33%
 * overlap between adjacent circles so a place near the seam is
 * unlikely to be missed by both.
 */

import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { recGovSource } from "@/lib/discovery/rec-gov";
import type { WaypointSource } from "@/lib/discovery/types";
import type { DaySegment } from "./segment-by-pace";
import type { LngLat } from "./route-between";

const METERS_PER_MILE = 1609.34;

const DEFAULT_RADIUS_MI = 25;

const DEFAULT_CATEGORIES: SlideCategoryKey[] = [
  "scenic",
  "food",
  "oddity",
  "camping",
  "overnight",
  "fuel",
];

const DEFAULT_SOURCES: WaypointSource[] = [foursquareSource, recGovSource];

export type SuggestionsForSegmentOptions = {
  /** Search radius around each sample point, in miles. Defaults to 25.
   *  Drives both bbox sizing and the spacing between sample points. */
  radiusMi?: number;
  /** Which place categories to query for. Defaults to all six. */
  categories?: SlideCategoryKey[];
  /** Which discovery sources to query. Defaults to Foursquare + RIDB.
   *  Override to include the OSM/USFS/BLM sources used by the
   *  per-day-endpoint browse panel. */
  sources?: WaypointSource[];
  /** Cancellation passthrough. */
  signal?: AbortSignal;
};

/** Return places of interest within `radiusMi` of `segment.coordinates`,
 *  matching the requested categories. */
export async function suggestionsForSegment(
  segment: DaySegment,
  opts: SuggestionsForSegmentOptions = {},
): Promise<BrowsePlace[]> {
  const radiusMi = opts.radiusMi ?? DEFAULT_RADIUS_MI;
  if (!(radiusMi > 0)) {
    throw new Error(`radiusMi must be > 0, got ${radiusMi}`);
  }
  const categories = opts.categories ?? DEFAULT_CATEGORIES;
  const sources = opts.sources ?? DEFAULT_SOURCES;
  const radiusKm = radiusMi * (METERS_PER_MILE / 1000);

  const samples = sampleAlong(segment.coordinates, radiusMi);
  if (samples.length === 0) return [];

  const bboxes = samples.map((p) => bboxFromCoords(p, radiusKm));
  return discover({
    bboxes,
    categories,
    sources,
    signal: opts.signal,
  });
}

/** Sample a polyline at ~1.5 × `radiusMi` intervals by haversine
 *  distance, always including the first and last coordinate. The
 *  spacing gives adjacent search circles ~33% overlap. */
export function sampleAlong(coords: LngLat[], radiusMi: number): LngLat[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [coords[0]];

  const spacingM = radiusMi * 1.5 * METERS_PER_MILE;
  const samples: LngLat[] = [coords[0]];
  let cum = 0;
  for (let i = 1; i < coords.length; i++) {
    cum += haversine(coords[i - 1], coords[i]);
    if (cum >= spacingM) {
      samples.push(coords[i]);
      cum = 0;
    }
  }
  // Make sure the last coordinate is represented if we didn't already
  // emit it (or something very close to it) as our most recent sample.
  const lastSampled = samples[samples.length - 1];
  const lastCoord = coords[coords.length - 1];
  const seamDistanceM = haversine(lastSampled, lastCoord);
  if (seamDistanceM > spacingM * 0.25) {
    samples.push(lastCoord);
  }
  return samples;
}

/** Earth-surface distance between two `[lng, lat]` points in meters. */
function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
