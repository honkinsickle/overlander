import type { Waypoint } from "./types";

/** Loose subset of `BrowsePlace` carried by the `trip:toggleAdded`
 *  event detail. Both `CategoryBrowsePanel` and `MapDetailOverlay`
 *  dispatch the event; this is the shape both `day-detail.tsx`'s
 *  client-side optimistic state and the persistence layer agree on. */
export type AddedPlace = {
  id: string;
  title: string;
  description?: string;
  photoUrl?: string;
  coords?: [number, number];
};

/** Materialize an added BrowsePlace into a `Waypoint` shape. Category
 *  is pinned to "scenic" because `CategoryBrowsePanel` always renders
 *  results in the Scenic palette regardless of which slot the user
 *  opened it from. */
export function addedPlaceToWaypoint(place: AddedPlace): Waypoint {
  return {
    id: place.id,
    slug: place.id,
    category: "scenic",
    title: place.title,
    subtitle: "Added stop",
    description: place.description ?? "",
    stats: [],
    photoUrl: place.photoUrl,
    coords: place.coords,
  };
}
