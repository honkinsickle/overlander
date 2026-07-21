/**
 * Backtrack detector for a user-chosen place visit order (the "pricing" half of
 * docs/decisions/2026-07-20-place-card-order-is-route-derived.md). PURE — no
 * network, no UI, no rendering.
 *
 * Places on a day sit at an along-route position (`milesFromStart`). If you
 * choose to visit them out of that order, any step that goes BACKWARD along the
 * route is a backtrack: you drive back Δ miles and then re-cover them, so it
 * costs ~2Δ. This walks an ordered list, resolves each position (stored miles,
 * else a pure-geometry projection of the coords onto the day polyline), and
 * returns the backward segments + the estimated extra miles.
 *
 * The estimate is along-route (rough for large perpendicular spurs); an exact
 * figure would need a routed pass. Node-dragging (the deferred node-stack model)
 * will price a re-sequenced day with this — the detector renders nothing itself.
 */

import { alongRouteMiles } from "@/lib/routing/point-to-polyline";

type LngLat = [number, number];

export type OrderedPlace = {
  id: string;
  /** Along-route miles from the day start, when baked. */
  milesFromStart?: number;
  /** [lng, lat] — used to PROJECT a position when `milesFromStart` is absent. */
  coords?: LngLat;
};

export type BacktrackSegment = {
  /** The place you're at when the route reverses. */
  fromId: string;
  /** The next place in the order — earlier along the route. */
  toId: string;
  fromMiles: number;
  toMiles: number;
  /** ~2 × (fromMiles − toMiles): drive back, then re-cover. Rounded. */
  extraMiles: number;
};

export type BacktrackReport = {
  /** One per backward step, in order. Empty = the order follows the road. */
  segments: BacktrackSegment[];
  /** Sum of the segment extras — the estimated extra miles for this order. */
  extraMiles: number;
  /** How many input places resolved to a usable position. Fewer than two →
   *  nothing to compare, empty report. */
  positioned: number;
};

/** Resolve a place's along-route position: stored miles first, else project its
 *  coords onto the day polyline. null when neither is available. */
function positionOf(
  place: OrderedPlace,
  dayPolyline?: LngLat[] | string,
): number | null {
  if (place.milesFromStart != null) return place.milesFromStart;
  if (place.coords && dayPolyline != null) {
    return alongRouteMiles(place.coords, dayPolyline)?.miles ?? null;
  }
  return null;
}

/**
 * Price an arbitrary visit order. `places` are already in the user's chosen
 * order; places that can't be positioned are dropped (they contribute no route
 * position). Fewer than two positioned places means nothing to compare.
 */
export function detectBacktracks(
  places: OrderedPlace[],
  dayPolyline?: LngLat[] | string,
): BacktrackReport {
  const positioned = places
    .map((p) => ({ id: p.id, miles: positionOf(p, dayPolyline) }))
    .filter((p): p is { id: string; miles: number } => p.miles != null);

  if (positioned.length < 2) {
    return { segments: [], extraMiles: 0, positioned: positioned.length };
  }

  const segments: BacktrackSegment[] = [];
  for (let i = 0; i < positioned.length - 1; i++) {
    const from = positioned[i];
    const to = positioned[i + 1];
    if (to.miles < from.miles) {
      segments.push({
        fromId: from.id,
        toId: to.id,
        fromMiles: from.miles,
        toMiles: to.miles,
        extraMiles: Math.round(2 * (from.miles - to.miles)),
      });
    }
  }

  return {
    segments,
    extraMiles: segments.reduce((sum, s) => sum + s.extraMiles, 0),
    positioned: positioned.length,
  };
}
