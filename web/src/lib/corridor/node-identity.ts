/**
 * Node/card dedup — a place is a NODE or a CARD, never both, whatever supply it
 * came from (gazetteer community, corpus POI, promoted seed, or anything ingested
 * later). The collision: `bucketPlacesIntoCorridor` buckets EVERY place under its
 * nearest node by mile, so a place sitting ~0 mi from a node — because it *is*
 * that node — lands in the node's `placeIds` and renders as a card under itself
 * (the "Whitehorse renders as both a node and a POI card" bug).
 *
 * WHERE THIS BELONGS: the resolver chokepoints where the derived spine and the
 * day's place pool are both in hand and feed every render surface —
 * `resolveCorridorCities` (serve) and `bakeGeneratedDays` (persist). Applied
 * there, it strips node-identical places from BOTH the bucketing pool (so
 * `placeIds` never contains a node) and the served/persisted `segmentSuggestions`
 * (so no surface renders the card). One predicate, both flows, supply-agnostic.
 *
 * MATCH RULE (same name + coords within a centroid-drift band):
 *   - exact id  → same place. A seed promoted FROM a POI carries that POI's id,
 *     so this catches seed/corpus collisions precisely.
 *   - same normalized name AND coords ≤ NODE_COINCIDENCE_MI → same place. Both
 *     required. A name MISMATCH always blocks the merge; the coords band only
 *     bounds a same-name match.
 *
 * The name requirement is the safety guarantee: near a node sit many
 * legitimately-close but distinct POIs (they bucket under it — a restaurant a
 * few hundred metres from the town centre), and two genuinely different places
 * with different names must NEVER merge, whatever their distance. The failure
 * mode is therefore "renders twice" (visible, fixable), never "the wrong place
 * silently disappears".
 *
 * The coords band is 2 mi, not tight: a gazetteer community centroid (CGNDB)
 * and its corpus-POI twin are the SAME place from two coordinate sources and
 * measurably drift ~1 mi apart (Dease Lake: CGNDB centroid vs corpus POI =
 * 0.94 mi). The band must absorb that. 2 mi stays far below any same-name
 * collision that isn't the same town (two "Springfield"s are ~200 mi apart, not
 * ~2), so the name+band pair can't merge distinct towns.
 */
import { haversineMi } from "@/lib/routing/point-to-polyline";
import { normPlaceName } from "./anchor-match";
import type { CorridorCity } from "@/lib/trips/types";

/** A place that might collide with a node. `title`/`coords` optional so it fits
 *  BrowsePlace (segmentSuggestions) and Waypoint alike. */
export type IdentifiablePlace = {
  id: string;
  title?: string;
  coords?: [number, number];
};

/** Coords within this AND a matching name ⇒ the same place. Sized to absorb
 *  gazetteer-centroid vs corpus-POI drift for the same town (~1 mi), well below
 *  any distinct same-name collision. */
export const NODE_COINCIDENCE_MI = 2;

/** True when `place` IS one of `nodes` — see file header for the rule. */
export function isNodeIdentical(
  place: IdentifiablePlace,
  nodes: CorridorCity[],
): boolean {
  const placeName = place.title ? normPlaceName(place.title) : "";
  for (const n of nodes) {
    if (place.id === n.id) return true; // promotion / same-id — exact
    if (!place.coords) continue;
    if (haversineMi(place.coords, n.coords) > NODE_COINCIDENCE_MI) continue;
    // Within epsilon: confirm by name so a distinct nearby POI is not eaten.
    const nodeName = normPlaceName(n.name);
    if (placeName && nodeName && placeName === nodeName) return true;
  }
  return false;
}

/** Drop the node-identical places from a pool. Used for both the bucketing pool
 *  and the rendered `segmentSuggestions`, at persist and at serve. */
export function stripNodeIdentical<T extends IdentifiablePlace>(
  places: T[],
  nodes: CorridorCity[],
): T[] {
  return places.filter((p) => !isNodeIdentical(p, nodes));
}
