import type { Trip } from "./types";
import {
  type BrowsePlace,
  type SlideCategoryKey,
} from "@/lib/trip-browse/places";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { overpassSource } from "@/lib/discovery/overpass";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";

/**
 * Server-side pre-resolution of the SuggestedSection cards. For each day
 * with coords, run one discovery call per slide category and pick the
 * top photo-bearing place. Result lands on `day.suggestions` and the
 * client renders without an extra fetch.
 *
 * Cost is paid once per server start (cached in `getAlaskaTrip()` with
 * the trip). Saturates outbound bandwidth on first request — 66 days ×
 * 4 categories = up to 264 parallel `discover()` calls — but the
 * subsequent render is instant.
 */
const FETCH_CATEGORIES: SlideCategoryKey[] = [
  "scenic",
  "food",
  "oddity",
  "camping",
];

/** Per-category radius — matches `/api/trip-browse` route. */
const RADIUS_KM: Record<SlideCategoryKey, number> = {
  food: 5,
  scenic: 15,
  oddity: 25,
  overnight: 15,
  camping: 50,
  fuel: 10,
  attraction: 15,
  interest: 15,
  urban: 10,
};

async function topPhotoBearing(
  coords: [number, number],
  category: SlideCategoryKey,
): Promise<BrowsePlace | null> {
  try {
    const places = await discover({
      bboxes: [bboxFromCoords(coords, RADIUS_KM[category])],
      categories: [category],
      sources: [overpassSource, recGovSource, usfsSource, blmSource, foursquareSource],
    });
    // Mirror the API route's sort: photo-bearing first.
    const top = places.find((p) => p.photoUrl && p.description && p.title);
    return top ?? null;
  } catch {
    return null;
  }
}

/** Bounded concurrency over `items`. Spawns `limit` workers that each
 *  pull the next index from a shared cursor. Used here to throttle
 *  outbound discovery calls — 264 unthrottled requests saturate the
 *  Overpass mirror and Foursquare rate limit, so coverage drops to
 *  ~38%. 8-way parallelism gets ~3–5 min cold start in exchange for
 *  near-complete fill. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const SUGGESTION_CONCURRENCY = 8;

export async function resolveSuggestions(trip: Trip): Promise<Trip> {
  const days = await pool(trip.days, SUGGESTION_CONCURRENCY, async (day) => {
    if (!day.coords || day.suggestions) return day;
    const entries = await Promise.all(
      FETCH_CATEGORIES.map(async (c) => {
        const place = await topPhotoBearing(day.coords!, c);
        return [c, place] as const;
      }),
    );
    const suggestions: Partial<Record<SlideCategoryKey, BrowsePlace>> = {};
    for (const [c, p] of entries) {
      if (p) suggestions[c] = p;
    }
    return { ...day, suggestions };
  });
  return { ...trip, days };
}
