/**
 * Place → corridor-node bucketing (docs/corridor-cities-spec.md §2.3).
 *
 * Runs AFTER deriveCorridorCities() at the same hook points (finalize +
 * reference resolver), taking the derived spine + the day's place pool
 * and returning the spine with each node's `placeIds` populated.
 *
 * Attachment rule (decided 2026-07-06, overrides §2.3's original
 * "last city passed / upstream anchor" text — a spec amendment is
 * pending): each place attaches to the NEAREST node by along-route mile.
 * Two gates:
 *   1. On-corridor — the place must project within `bufferMi` of the
 *      route (reuses the buffer_mi gate); a place well off-route doesn't
 *      cluster even if its mileage lands near a node.
 *   2. Max-attach — the place must be within `maxAttachMi` of its nearest
 *      node. Places farther than that from every node stay UNBUCKETED
 *      (candidates for future POI-node work, consistent with the
 *      townless-gap philosophy — better unclustered than clustered under
 *      a distant city).
 * Equidistant ties break UPSTREAM (the smaller-mile node), matching the
 * §2.3 tie rule. Within a node, placeIds order by placeMi ascending.
 *
 * Pure function, no I/O. Places are referenced by id (spec §1.4) — the
 * caller resolves ids back against segmentSuggestions ∪ waypoints.
 */
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import type { LngLat } from "@/lib/routing/route-between";
import type { CorridorCity } from "@/lib/trips/types";
import { DEFAULT_CORRIDOR_PARAMS, type CorridorParams } from "./derive";

/** Minimal place shape for bucketing — id (→ placeIds) + coords to
 *  project. Structurally satisfied by both BrowsePlace and Waypoint. */
export type BucketPlace = { id: string; coords: LngLat };

/** Distances within this of each other count as a tie (upstream node
 *  wins, spec §2.3). Absorbs float noise from summed haversine segments;
 *  ~50 ft, far below any real place-to-node distinction. */
const TIE_EPS_MI = 0.01;

export function bucketPlacesIntoCorridor(input: {
  cities: CorridorCity[];
  places: BucketPlace[];
  line: LngLat[];
  params?: Partial<CorridorParams>;
}): CorridorCity[] {
  const { cities, places, line } = input;
  const p = { ...DEFAULT_CORRIDOR_PARAMS, ...input.params };
  if (cities.length === 0 || line.length < 2) return cities;

  // Collect (nodeIndex, placeId, placeMi) for every place that clears
  // both gates, then order per node by placeMi before assigning.
  const hits: { node: number; id: string; mi: number }[] = [];
  for (const place of places) {
    const r = alongRouteMiles(place.coords, line);
    if (!r || r.offsetMi > p.bufferMi) continue; // gate 1: on-corridor

    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < cities.length; i++) {
      const d = Math.abs(cities[i].milesFromStart - r.miles);
      // Nodes are visited upstream→downstream (ascending milesFromStart);
      // a later node only wins if it's closer by more than TIE_EPS_MI, so
      // exact/near ties keep the upstream node (spec §2.3 tie rule).
      if (d < bestDist - TIE_EPS_MI) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0 || bestDist > p.maxAttachMi) continue; // gate 2: max-attach
    hits.push({ node: best, id: place.id, mi: r.miles });
  }

  return cities.map((city, i) => {
    const placeIds = hits
      .filter((h) => h.node === i)
      .sort((a, b) => a.mi - b.mi)
      .map((h) => h.id);
    return placeIds.length ? { ...city, placeIds } : city;
  });
}
