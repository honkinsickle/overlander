import type { CorridorPlace } from "@/components/trip/day-detail-corridor";

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
      properties: { id: p.id, title: p.title, category: p.category },
    });
  }
  return { type: "FeatureCollection", features };
}
