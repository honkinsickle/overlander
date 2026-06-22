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
    // Generic roadside markers stay here; the built/cultural historic set and
    // museums/galleries move to `attraction` (see categoryFromTags). The broad
    // historic filter is kept so marker subvalues still surface under oddity —
    // categoryFromTags drops the cultural ones (they derive to attraction).
    'node["historic"]["name"]',
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
  fuel: ['node["amenity"="fuel"]'],
  // Formal cultural set — museums, galleries, and built/cultural historic
  // heritage — mirrors the federated corpus `attraction` bucket so the live
  // and corpus paths agree. categoryFromTags arbitrates the historic split.
  attraction: [
    'node["tourism"="museum"]',
    'node["tourism"="gallery"]',
    'node["historic"]["name"]',
  ],
  // interest/urban surface via the federated master_place corpus, not the live
  // Overpass fanout — empty short-circuits to [] in query().
  interest: [],
  urban: [],
};

/** OSM `historic=*` subvalues that are generic roadside markers rather than
 *  built/cultural heritage. These stay in `oddity`; every other historic
 *  value (built heritage, sites, `historic=yes`, and the long tail) derives
 *  to `attraction`. */
const ODDITY_HISTORIC: ReadonlySet<string> = new Set([
  "boundary_stone", "milestone", "marker", "plaque", "cairn",
  "wayside_cross", "wayside_shrine", "charcoal_pile", "rune_stone", "stone",
]);

/** Reverse-derive the slide category for an OSM element from its tags.
 *  Order matters — the first match wins, so put more-specific keys
 *  before generic fallbacks. Returns null when none of the tags map
 *  to a category we surface. */
export function categoryFromTags(
  tags: Record<string, string> | undefined,
): SlideCategoryKey | null {
  if (!tags) return null;

  if (tags.amenity === "fuel") {
    return "fuel";
  }
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
  // Formal cultural venues → attraction (mirrors the federated corpus split).
  if (tags.tourism === "museum" || tags.tourism === "gallery") {
    return "attraction";
  }
  // historic=* splits: generic roadside markers (boundary stones, milestones,
  // plaques) stay oddity; built/cultural heritage (bridges, ruins, memorials,
  // and the long tail incl. historic=yes) → attraction.
  if (tags.historic) {
    return ODDITY_HISTORIC.has(tags.historic) ? "oddity" : "attraction";
  }
  // Roadside-quirky cultural → oddity.
  if (tags.amenity === "arts_centre" || tags.tourism === "artwork") {
    return "oddity";
  }
  return null;
}
