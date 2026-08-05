import type { CorridorPlace } from "@/components/trip/day-detail-corridor";
import {
  BROWSE_CARD_CATEGORIES,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";

const KNOWN_CATEGORIES = new Set<string>(BROWSE_CARD_CATEGORIES);

/** Clamp a tile category to the canonical 9 so the map's `icon-image`
 *  expression always resolves to a registered image. placePool already maps
 *  `overnight → camping` and defaults missing to `interest`; this is the
 *  belt-and-braces for any out-of-vocabulary value a stored payload might carry. */
function normalizeCategory(c: string): BrowseCardCategory {
  return (KNOWN_CATEGORIES.has(c) ? c : "interest") as BrowseCardCategory;
}

/**
 * Build the GeoJSON FeatureCollection for the active day's place pool, plotted
 * on the map as a point layer (PR1 — plot only; marker interaction is PR2).
 *
 * COORDS-GUARD (required): a tile whose `coords` is absent or malformed is
 * SKIPPED, never an error. `CorridorPlace.coords` is optional, and every
 * coordless tile measured is an editorially-authored reference waypoint (81/400
 * waypoints carry coords; segmentSuggestions and day.suggestions are 100%).
 * `la-to-portland` is entirely coordless and must plot nothing without throwing.
 * See docs/proposals/2026-08-04-plot-day-detail-places-research.md §Coords.
 *
 * PR1 carries only the minimum each point needs to draw and to be looked up
 * later (id/title/category) — no enrichment (photo/rating hydrate is unreliable:
 * a marker cannot depend on it). Pure; no map, no DOM. Unit-tested in
 * place-layer.test.ts.
 */
export type PlaceFeatureProps = {
  id: string;
  title: string;
  category: string;
  /** curated key stop OR user/authored waypoint → the PROMINENT layer (above);
   *  everything else → the POOL layer (below). Computed here, not stored — see
   *  the two-layer map design. `curated` is a segmentSuggestions-only flag set
   *  by the generation bake; `removable` is placePool's marker for the waypoints
   *  source. The two layers filter on `prominent == true` / `!= true`, a
   *  complementary partition so no feature renders twice. */
  prominent: boolean;
};

export function placesToFeatureCollection(
  places: CorridorPlace[],
): GeoJSON.FeatureCollection<GeoJSON.Point, PlaceFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, PlaceFeatureProps>[] = [];
  for (const p of places) {
    const c = p.coords;
    if (
      !Array.isArray(c) ||
      c.length < 2 ||
      typeof c[0] !== "number" ||
      typeof c[1] !== "number" ||
      Number.isNaN(c[0]) ||
      Number.isNaN(c[1])
    ) {
      continue; // coords-guard: skip coordless/malformed tiles, never throw
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c[0], c[1]] },
      properties: {
        id: p.id,
        title: p.title,
        category: normalizeCategory(p.category),
        prominent: Boolean(p.curated) || Boolean(p.removable),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
