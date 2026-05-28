/**
 * Phase 3a D4 — ground truth fixtures for the JT smoke-test corpus.
 *
 * Five named campgrounds make up the positive set. Each fixture's
 * `expected_source_ids` reflects the corrected matcher rules (see
 * data/entity-resolution/README.md "Phase 3a diagnostic"):
 *
 *   - Ryan, White Tank, Jumbo Rocks
 *       4 sources merge — NPS/RIDB/Google via name_dominant or
 *       fed_exact; OSM via amenity_rollup (the nearby `dump_station`
 *       node rolls up into the campground master_place).
 *
 *   - Hidden Valley
 *       3 sources merge — NPS/RIDB/Google. OSM's nearest neighbor is
 *       "Chimney Rock" (a peak), `peak ↔ campground = 0.0` in
 *       CATEGORY_COMPATIBILITY → must NOT merge.
 *
 *   - Sheep Pass
 *       3 sources merge — NPS/RIDB/Google. OSM tags 6 campsite-numbered
 *       nodes ("1"–"6") near the cluster; the closest go through the
 *       close_nameless path → manual_review (status='pending'), not
 *       linked. Those beyond 100m become solo master_places (Phase 3a
 *       limitation — polygon containment is 3b).
 *
 * Negative fixtures verify that single-source records become their own
 * master_place (no false merges). The amenity-rollup fixtures spot-check
 * the rollup vs no-rollup classification.
 */

export interface PositiveFixture {
  /** ilike pattern for finding the master_place after resolution */
  canonical_name: string;
  /** sources that should be linked to the resolved master_place */
  expected_source_ids: ReadonlyArray<"nps" | "ridb" | "google" | "osm">;
  /** explanatory note for failure diagnostics */
  notes?: string;
}

export const JT_POSITIVE_FIXTURES: ReadonlyArray<PositiveFixture> = [
  {
    canonical_name: "Ryan Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes: "OSM dump_station rolls up via amenity_rollup",
  },
  {
    canonical_name: "Hidden Valley Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes:
      "OSM Chimney Rock (peak) MUST NOT merge — checked separately via " +
      "JT_AMENITY_ROLLUP_FIXTURES. Other OSM amenity nodes near Hidden " +
      "Valley (dump_station / toilet / etc.) DO roll up via amenity_rollup.",
  },
  {
    canonical_name: "White Tank Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes: "OSM dump_station rolls up via amenity_rollup",
  },
  {
    canonical_name: "Jumbo Rocks Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes:
      "NPS↔RIDB drift 341m, NPS↔Google drift 347m — both auto via " +
      "name_dominant after radius widened to 500m",
  },
  {
    canonical_name: "Sheep Pass Group Campground",
    expected_source_ids: ["nps", "ridb", "google", "osm"],
    notes:
      "Resolved canonical_name comes from NPS (priority 1 in field_precedence) " +
      "now that all four normalizers write canonical_name into " +
      "normalized_payload. Previously fell through to Google because NPS " +
      "didn't write it. OSM presence is via dump_station amenity_rollup " +
      "(two nodes within 100m of the seeded MP); OSM campsite-numbered " +
      "nodes (name='1'..'6') route to close_nameless manual_review " +
      "separately and stay unlinked.",
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

export const JT_NEGATIVE_FIXTURES: ReadonlyArray<NegativeFixture> = [
  {
    external_id_pattern: "ridb:recarea:%",
    name_pattern: "%pinto%",
    reason: "Pinto Mountains Wilderness — BLM, no other source has it",
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

export const JT_AMENITY_ROLLUP_FIXTURES: ReadonlyArray<AmenityRolloutFixture> = [
  {
    amenity_name: "Unnamed dump station",
    near_campground: "Ryan Campground",
    expected_rollup: true,
    max_distance_m: 100,
  },
  {
    amenity_name: "Chimney Rock",
    near_campground: "Hidden Valley Campground",
    expected_rollup: false,
    reason: "peak ↔ campground category_compatibility = 0",
  },
];
