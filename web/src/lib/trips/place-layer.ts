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
 * The ONE coords guard. A tile is plottable iff `coords` is a real `[lng, lat]`
 * (elevation `[lng, lat, ele]` tolerated). Absent/malformed/NaN → not plottable,
 * skipped, never an error. Shared by `placesToFeatureCollection` (what draws) and
 * `placeBounds` (what the camera fits) so the two can never disagree.
 */
export function isPlottableCoord(c: unknown): c is [number, number] {
  return (
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === "number" &&
    typeof c[1] === "number" &&
    !Number.isNaN(c[0]) &&
    !Number.isNaN(c[1])
  );
}

/**
 * Bounding box of a day's plottable places, `[[minLng,minLat],[maxLng,maxLat]]`,
 * for the day-activation camera fit. `null` when the day has NO plottable place
 * (coordless-waypoint days on de-linked reference trips) — the caller then falls
 * back to the old `flyTo(start, zoom 8)`. A single place (or all-same-coord) yields
 * a valid ZERO-EXTENT box; the caller clamps that with `fitBounds({ maxZoom })`.
 * Pure; no map. Unit-tested in place-layer.test.ts.
 */
export function placeBounds(
  places: CorridorPlace[],
): [[number, number], [number, number]] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let count = 0;
  for (const p of places) {
    if (!isPlottableCoord(p.coords)) continue;
    const [lng, lat] = p.coords;
    count += 1;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return count === 0 ? null : [
    [w, s],
    [e, n],
  ];
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
    if (!isPlottableCoord(c)) {
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
