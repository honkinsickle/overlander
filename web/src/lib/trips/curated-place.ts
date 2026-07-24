/**
 * Curated-POI cross-day move + delete — the PURE core (spec: geometry-free
 * overlay edit). A curated POI is a `Day.segmentSuggestions` entry (a BrowsePlace),
 * which is OVERLAY, not a routed `Day.waypoints` point — so moving/removing one
 * changes NO drive geometry (routing runs only over waypoints, see
 * lib/trips/recompute-day.ts). No Mapbox, no route recompute.
 *
 * These functions do the array move/splice and then `rescopeOverlays` to DROP the
 * moved/removed stop's now-orphaned `placeOverrides` / `placeRanks` (its pin/rank
 * was scoped to a node on the OLD day, absent on the new one). They do NOT re-bake
 * `corridorCities` — the repository wrapper does that via `resolveCorridorCities`
 * inside the guarded write (also pure/no-Mapbox), matching the node-edit path.
 *
 * The node layout fed to `rescopeOverlays` reads node ids from the EXISTING
 * `Day.corridorCities` (node identity is name/coords-based and invariant to a pool
 * move — see docs/architecture/itinerary-model.md §3) and pool membership from the
 * POST-move day arrays. Pure.
 */
import { rescopeOverlays } from "@/lib/corridor/rescope-overlays";
import type { Trip, Day } from "./types";

/** A day's stop POOL ids — the membership set rescopeOverlays checks against
 *  (segmentSuggestions ∪ suggestions ∪ waypoints), BEFORE overrides. */
function poolIds(day: Day): string[] {
  return [
    ...(day.segmentSuggestions ?? []).map((p) => p.id),
    ...Object.values(day.suggestions ?? {})
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => p.id),
    ...day.waypoints.map((w) => w.id),
  ];
}

/** OverlayDayLayout[] for the current trip: pool ids + available node ids per day. */
function overlayLayout(trip: Trip) {
  return trip.days.map((d) => ({
    placeIds: poolIds(d),
    nodeIds: (d.corridorCities ?? []).map((c) => c.id),
  }));
}

/** Re-scope the trip's overlays against its current pool/node layout, dropping
 *  entries whose stop no longer has a valid home. Returns the trip with the
 *  surviving overlays (corridorCities untouched — the repo wrapper re-bakes). */
function withRescopedOverlays(next: Trip): Trip {
  const { placeRanks, placeOverrides } = rescopeOverlays(
    {
      placeRanks: next.placeRanks ?? {},
      placeOverrides: next.placeOverrides ?? [],
    },
    overlayLayout(next),
  );
  return { ...next, placeRanks, placeOverrides };
}

/**
 * Move a curated POI (a `segmentSuggestions` entry) from one day to another.
 * Returns the updated trip, or null if the days/place aren't found (place is a
 * waypoint or not on `fromDayId`, or from === to). The moved stop's overlays drop
 * (v1: lands unranked + unpinned on the new day).
 */
export function moveCuratedPlace(
  trip: Trip,
  fromDayId: string,
  toDayId: string,
  placeId: string,
): Trip | null {
  if (fromDayId === toDayId) return null;
  const next = structuredClone(trip);
  const from = next.days.find((d) => d.id === fromDayId);
  const to = next.days.find((d) => d.id === toDayId);
  if (!from || !to) return null;
  const arr = from.segmentSuggestions ?? [];
  const idx = arr.findIndex((p) => p.id === placeId);
  if (idx === -1) return null; // not a curated tile on this day (waypoint/absent)
  const [place] = arr.splice(idx, 1);
  from.segmentSuggestions = arr;
  to.segmentSuggestions = [...(to.segmentSuggestions ?? []), place];
  return withRescopedOverlays(next);
}

/**
 * Remove a curated POI (a `segmentSuggestions` entry) from a day. Returns the
 * updated trip, or null if the day/place aren't found. Its overlays drop.
 */
export function removeCuratedPlace(
  trip: Trip,
  dayId: string,
  placeId: string,
): Trip | null {
  const next = structuredClone(trip);
  const day = next.days.find((d) => d.id === dayId);
  if (!day) return null;
  const arr = day.segmentSuggestions ?? [];
  const idx = arr.findIndex((p) => p.id === placeId);
  if (idx === -1) return null;
  arr.splice(idx, 1);
  day.segmentSuggestions = arr;
  return withRescopedOverlays(next);
}
