import type { SlideCategoryKey } from "@/lib/trip-browse/places";

/** Provenance for a discovered place. Becomes part of the reliability
 *  score (multi-source confirmation) and the `mention.secondary` line
 *  on the planning slide. */
export type SourceId =
  | "osm"
  | "nps"
  | "rec-gov"
  | "ioverlander"
  | "wikipedia"
  | "foursquare"
  | "fixture";

/** A normalised place from a single source — the common shape every
 *  `WaypointSource` produces. The discovery aggregator merges these
 *  across sources, then projects to `BrowsePlace` for the UI. */
export type SourceResult = {
  sourceId: SourceId;
  /** Stable id within the source (OSM node id, NPS parkCode, etc).
   *  Used for dedup keying and for follow-up enrichment lookups. */
  externalId: string;
  coords: [number, number];
  category: SlideCategoryKey;
  title: string;
  description?: string;
  photoUrl?: string;
  address?: string;
  website?: string;
  phone?: string;
  /** OSM-style `opening_hours` string (e.g. "Mo-Su 09:00-17:00").
   *  Surfaced as a stat on the planning slide when present. */
  openingHours?: string;
  /** Pre-mapped source fields — kept around so the dedup layer can
   *  look at tags/attributes the normalised shape doesn't carry. */
  raw?: Record<string, unknown>;
};

export interface WaypointSource {
  id: SourceId;
  /** Returns places inside the bounding box matching any of the given
   *  categories. Implementations should respect `signal` for cancel. */
  query(args: {
    bbox: [west: number, south: number, east: number, north: number];
    categories: SlideCategoryKey[];
    signal?: AbortSignal;
  }): Promise<SourceResult[]>;
}
