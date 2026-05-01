import type { SlideCategoryKey } from "@/lib/trip-browse/places";

/** Maps slide categories to Overpass `node[...]` filter expressions.
 *  Each entry is a partial Overpass QL fragment that gets appended
 *  inside a bbox in `overpass.ts`. Tags are picked to favour places
 *  that justify a stop, not every dot on the map (e.g. `viewpoint`
 *  rather than every `natural=peak`).
 *
 *  Tag references — https://wiki.openstreetmap.org/wiki/Map_features
 */
export const OSM_TAG_QUERIES: Record<SlideCategoryKey, string[]> = {
  scenic: [
    'node["tourism"="viewpoint"]',
    'node["tourism"="attraction"]["name"]',
    'node["natural"="waterfall"]',
    'node["natural"="hot_spring"]',
    'node["natural"="peak"]["name"]',
    'node["natural"="arch"]["name"]',
    'node["natural"="cliff"]["name"]',
    'node["natural"="glacier"]["name"]',
    // `leisure=park` is intentionally excluded — OSM contributors use it
    // for everything from urban parks to RV resorts to corporate office
    // parks, so it pollutes scenic results badly. Real scenic spots map
    // to `tourism` / `natural` tags above.
  ],
  food: [
    'node["amenity"="restaurant"]["name"]',
    'node["amenity"="cafe"]["name"]',
    'node["amenity"="bar"]["name"]',
    'node["amenity"="ice_cream"]["name"]',
  ],
  oddity: [
    'node["historic"]["name"]',
    'node["tourism"="museum"]',
    'node["amenity"="arts_centre"]',
    'node["tourism"="artwork"]',
  ],
  camping: [
    'node["tourism"="camp_site"]',
    'node["tourism"="caravan_site"]',
  ],
  overnight: [
    'node["tourism"="hotel"]',
    'node["tourism"="motel"]',
    'node["tourism"="guest_house"]',
    'node["tourism"="hostel"]',
  ],
};

/** Reverse-derive the slide category for an OSM element from its tags.
 *  Order matters — the first match wins, so put more-specific keys
 *  before generic fallbacks. Returns null when none of the tags map
 *  to a category we surface. */
export function categoryFromTags(
  tags: Record<string, string> | undefined,
): SlideCategoryKey | null {
  if (!tags) return null;

  if (tags.tourism === "camp_site" || tags.tourism === "caravan_site") {
    return "camping";
  }
  if (
    tags.tourism === "hotel" ||
    tags.tourism === "motel" ||
    tags.tourism === "guest_house" ||
    tags.tourism === "hostel"
  ) {
    return "overnight";
  }
  if (
    tags.amenity === "restaurant" ||
    tags.amenity === "cafe" ||
    tags.amenity === "bar" ||
    tags.amenity === "ice_cream"
  ) {
    return "food";
  }
  if (
    tags.tourism === "viewpoint" ||
    tags.tourism === "attraction" ||
    tags.natural === "waterfall" ||
    tags.natural === "hot_spring" ||
    tags.natural === "peak" ||
    tags.natural === "arch" ||
    tags.natural === "cliff" ||
    tags.natural === "glacier"
  ) {
    return "scenic";
  }
  if (
    tags.historic ||
    tags.tourism === "museum" ||
    tags.amenity === "arts_centre" ||
    tags.tourism === "artwork"
  ) {
    return "oddity";
  }
  return null;
}
