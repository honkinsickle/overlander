import type { Trip } from "./types";
import {
  BROWSE_CARD_CATEGORIES,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";

/**
 * Trip-level "Top Places to Visit" for the Overview state (Phase A).
 *
 * Aggregates every day's `segmentSuggestions` ∪ `waypoints` (the corridor
 * bucket pool is a subset of this union, so it's covered), dedupes by id,
 * ranks by rating then review count, and returns the top N. Reference
 * trips have no segmentSuggestions, so they populate from their editorial
 * waypoints — the key fallback that keeps Overview non-empty.
 *
 * Pure/synchronous. `detour` is intentionally omitted (ruling 3): detour
 * is leg-relative and Overview is trip-level with no defined leg.
 */
export type TripTopPlace = {
  id: string;
  title: string;
  photoUrl?: string;
  photoAlt: string;
  description: string;
  rating?: number;
  reviewCount?: number;
  category: BrowseCardCategory;
};

export const TOP_PLACES_N = 10;

const VALID = new Set<string>(BROWSE_CARD_CATEGORIES);

/** BrowsePlace uses SlideCategoryKey ("overnight" has no card palette →
 *  camping); Waypoint uses Category. Fall back to "interest". */
function normalizeCategory(c: string | undefined): BrowseCardCategory {
  if (c === "overnight") return "camping";
  return c && VALID.has(c) ? (c as BrowseCardCategory) : "interest";
}

export function topPlacesForTrip(trip: Trip): TripTopPlace[] {
  const seen = new Set<string>();
  const out: TripTopPlace[] = [];

  for (const day of trip.days) {
    for (const s of day.segmentSuggestions ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({
        id: s.id,
        title: s.title,
        photoUrl: s.photoUrl,
        photoAlt: s.photoAlt,
        description: s.description,
        rating: s.rating,
        reviewCount: s.reviewCount,
        category: normalizeCategory(s.category),
      });
    }
    for (const wp of day.waypoints) {
      if (seen.has(wp.id)) continue;
      seen.add(wp.id);
      out.push({
        id: wp.id,
        title: wp.title,
        photoUrl: wp.photoUrl,
        photoAlt: wp.title,
        description: wp.description,
        rating: wp.community?.rating,
        reviewCount: wp.community?.reviewCount,
        category: normalizeCategory(wp.category),
      });
    }
  }

  // Rating desc (unrated last), then review count desc. Array#sort is
  // stable on Node, so equal-rank places keep along-route order.
  out.sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  );
  return out.slice(0, TOP_PLACES_N);
}
