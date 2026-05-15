/**
 * Resolve a day-segment to the two suggestion shapes the wizard
 * finalize action persists onto each Day:
 *
 *   - `byCategory`: top photo-bearing place per slide category.
 *     Matches the existing `Day.suggestions` field that the
 *     SuggestedSection component already renders against. Categories
 *     with no match are simply absent.
 *   - `all`: the flat list of every discovered place along the
 *     segment, capped. Goes onto `Day.segmentSuggestions` for the
 *     future "browse the day" sheet to consume.
 *
 * Sources match the shape brief: Foursquare + RIDB only. Honest
 * default radius of 25 mi.
 */

import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import { suggestionsForSegment } from "./suggestions-for-segment";
import type { DaySegment } from "./segment-by-pace";

const MAX_SEGMENT_SUGGESTIONS = 30;

export type DaySuggestions = {
  /** Top photo-bearing place per slide category. */
  byCategory: Partial<Record<SlideCategoryKey, BrowsePlace>>;
  /** Capped flat list of all discoveries. */
  all: BrowsePlace[];
};

/** Query suggestions along a day's polyline and shape into the two
 *  surfaces the trip data model needs. Swallows errors — a failed
 *  query yields empty results rather than blocking finalize. */
export async function buildDaySuggestions(
  segment: DaySegment,
  signal?: AbortSignal,
): Promise<DaySuggestions> {
  let places: BrowsePlace[];
  try {
    places = await suggestionsForSegment(segment, { signal });
  } catch (err) {
    console.warn(
      `[day-suggestions] day ${segment.index} segment query failed:`,
      err,
    );
    return { byCategory: {}, all: [] };
  }

  // Top photo-bearing per category. Mirrors the existing Alaska
  // `resolveSuggestions` rule so SuggestedSection rendering is
  // consistent. Places with no category survived but contribute only
  // to `all`.
  const byCategory: Partial<Record<SlideCategoryKey, BrowsePlace>> = {};
  for (const p of places) {
    const cat = p.category;
    if (!cat) continue;
    if (byCategory[cat]) continue;
    if (!p.photoUrl) continue;
    byCategory[cat] = p;
  }
  // Fallback pass: if a category had no photo-bearing match, take the
  // first item in that category regardless of photo.
  for (const p of places) {
    const cat = p.category;
    if (!cat) continue;
    if (byCategory[cat]) continue;
    byCategory[cat] = p;
  }

  // Photo-bearing first for the flat list too — same sort the live API
  // route applies. Then cap.
  const all = [
    ...places.filter((p) => p.photoUrl),
    ...places.filter((p) => !p.photoUrl),
  ].slice(0, MAX_SEGMENT_SUGGESTIONS);

  return { byCategory, all };
}
