/**
 * Ground-truth fixtures for the PINNED ER corpus (data/entity-resolution/
 * fixtures/er-corpus.ts). Each entry is a per-case OUTCOME expectation the
 * phase3a JT-corpus block asserts after a single matchAll + applyMatches over
 * the ~17-record fixture.
 *
 * These are OUTCOME assertions, not counts — "records X and Y resolved to one
 * master_place with sources {…}", "amenity A rolled into parent P", "record R
 * stayed solo". They survive any fixture edit that preserves the SHAPES; they do
 * not depend on any corpus size. See docs/decisions/2026-07-23-pinned-er-fixture.md.
 *
 * The name-similarity / category-compatibility / blended-confidence values that
 * drive each expected path were verified by pure computation against the
 * matcher's own scoreMatch/normalizeName/lookupCompatibility while authoring the
 * fixture (see the ADR's verification note).
 */

export interface PositiveFixture {
  /** ilike pattern for finding the master_place after resolution */
  canonical_name: string;
  /** sources that should be linked to the resolved master_place */
  expected_source_ids: ReadonlyArray<"nps" | "ridb" | "google" | "osm" | "parks_canada">;
  /** explanatory note for failure diagnostics */
  notes?: string;
}

export const ER_POSITIVE_FIXTURES: ReadonlyArray<PositiveFixture> = [
  {
    canonical_name: "Alpha Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes:
      "4-source merge: NPS+RIDB @0m via fed_exact; Google @200m via name_dominant " +
      "(name_sim 1.0); OSM toilet @40m via amenity_rollup.",
  },
  {
    canonical_name: "Epsilon Campground",
    expected_source_ids: ["google", "parks_canada"],
    notes:
      "Binational name_dominant: parks_canada + Google @100m (name_sim ~0.92). " +
      "canonical_name resolves to the parks_canada value via field_precedence " +
      "(parks_canada priority 1 > google priority 2) — asserted separately.",
  },
];

export interface NegativeFixture {
  /** ilike pattern on source_record.external_id */
  external_id_pattern: string;
  /** Optional name filter to disambiguate */
  name_pattern?: string;
  /** Optional inferred_category filter */
  inferred_category?: string;
  /** explanatory note */
  reason: string;
}

export const ER_NEGATIVE_FIXTURES: ReadonlyArray<NegativeFixture> = [
  {
    external_id_pattern: "er:theta:%",
    name_pattern: "%theta%",
    reason: "Theta Recreation Area — RIDB only, isolated, no cross-source neighbor → solo",
  },
];

export interface AmenityRolloutFixture {
  /** ilike pattern on source_record.name */
  amenity_name: string;
  /** ilike pattern on the parent master_place canonical_name */
  near_campground: string;
  /** whether the rollup should fire */
  expected_rollup: boolean;
  /** rollup path's distance constraint */
  max_distance_m?: number;
  /** explanatory note */
  reason?: string;
}

export const ER_AMENITY_FIXTURES: ReadonlyArray<AmenityRolloutFixture> = [
  {
    amenity_name: "Alpha Toilet",
    near_campground: "Alpha Campground",
    expected_rollup: true,
    max_distance_m: 100,
    reason: "OSM toilet 40 m from Alpha → amenity_rollup into the campground",
  },
  {
    amenity_name: "Iota Peak",
    near_campground: "Alpha Campground",
    expected_rollup: false,
    reason: "peak ↔ campground category_compatibility = 0 (hard zero) → must NOT merge",
  },
];
