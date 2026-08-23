import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapMasterPlaceRow,
  primaryCategoryToSlideKey,
  SLIDE_TO_PRIMARY_CATEGORY,
} from "./federated";

/** Minimal pois_along_corridor row — only the required fields, plus whichever
 *  optional join columns a case exercises. */
function row(extra: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    canonical_name: "Lillian Pitt Public Artwork: Rosa Parks Station",
    primary_category: "attraction",
    lng: -122.68,
    lat: 45.52,
    prominence_score: 0.5,
    mvum_corridor: null,
    overlander_tags: null,
    amenities: null,
    hours: null,
    contact: null,
    access: null,
    services: null,
    capacity: null,
    seasonality: null,
    cell_signal: null,
    geometry_polygon: null,
    description: null,
    attribution: null,
    ...extra,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
  } as any;
}

test("nps_photo_url → photoUrl on the tile (Route A corpus imagery)", () => {
  const url = "https://www.nps.gov/common/uploads/cropped_image/D207.jpg";
  const tile = mapMasterPlaceRow(row({ nps_photo_url: url }), "attraction");
  assert.equal(tile.photoUrl, url);
});

test("no nps_photo_url → no photoUrl (tile stays photoless, card falls back)", () => {
  const tile = mapMasterPlaceRow(row(), "attraction");
  assert.equal(tile.photoUrl, undefined);
});

test("google_place_id still → placeId (the two join columns don't collide)", () => {
  const tile = mapMasterPlaceRow(
    row({ google_place_id: "ChIJabc", nps_photo_url: "https://x/y.jpg" }),
    "attraction",
  );
  assert.equal(tile.placeId, "ChIJabc");
  assert.equal(tile.photoUrl, "https://x/y.jpg");
});

// capacity/amenities: typed on the RPC row, previously never read in this
// function's body — the value crossed the wire and was silently discarded.
// docs/architecture/place-pipeline-trace.md §2 (capacity) and
// place-pipeline-trace-amenities-addendum.md §4 (amenities).

test("capacity survives row → tile (was silently dropped)", () => {
  const capacity = { sites_total: 42, sites_reservable: 30 };
  const tile = mapMasterPlaceRow(row({ capacity }), "camping");
  assert.deepEqual(tile.capacity, capacity);
});

test("no capacity on the row → no capacity on the tile (null, not dropped-and-undefined)", () => {
  const tile = mapMasterPlaceRow(row({ capacity: null }), "camping");
  assert.equal(tile.capacity, null);
});

test("amenities survives row → tile for a source field_precedence resolves (ridb/nps/google) (was silently dropped)", () => {
  const amenities = { water: true, toilet: true, dump_station: false };
  const tile = mapMasterPlaceRow(row({ amenities }), "camping");
  assert.deepEqual(tile.amenities, amenities);
});

test("no amenities on the row → no amenities on the tile", () => {
  const tile = mapMasterPlaceRow(row({ amenities: null }), "camping");
  assert.equal(tile.amenities, null);
});

// ── verification tier from description_source (RPC column) ──────────────

test("description_source='source' → verified", () => {
  const tile = mapMasterPlaceRow(row({ description_source: "source" }), "camping");
  assert.equal(tile.verified, "verified");
});

test("description_source='llm' → verified (per eligibility ADR)", () => {
  const tile = mapMasterPlaceRow(row({ description_source: "llm" }), "camping");
  assert.equal(tile.verified, "verified");
});

test("description_source='template' → unverified", () => {
  const tile = mapMasterPlaceRow(row({ description_source: "template" }), "camping");
  assert.equal(tile.verified, "unverified");
});

test("description_source=null → unverified", () => {
  const tile = mapMasterPlaceRow(row({ description_source: null }), "camping");
  assert.equal(tile.verified, "unverified");
});

test("description_source absent → unverified", () => {
  const tile = mapMasterPlaceRow(row(), "camping");
  assert.equal(tile.verified, "unverified");
});

// ── category bucket assignments ──────────────────────────────────────────

test("camping bucket contains only real camping categories", () => {
  const camping = new Set(SLIDE_TO_PRIMARY_CATEGORY.camping);
  const expected = new Set(["campground", "dispersed_camping", "rv_park", "camping_cabin"]);
  assert.deepEqual(camping, expected);
});

test("facility is NOT in the camping bucket", () => {
  assert.ok(!SLIDE_TO_PRIMARY_CATEGORY.camping.includes("facility"));
  assert.equal(primaryCategoryToSlideKey("facility"), "interest");
});

test("recreation_area is in the scenic bucket, not camping", () => {
  assert.ok(!SLIDE_TO_PRIMARY_CATEGORY.camping.includes("recreation_area"));
  assert.ok(SLIDE_TO_PRIMARY_CATEGORY.scenic.includes("recreation_area"));
  assert.equal(primaryCategoryToSlideKey("recreation_area"), "scenic");
});

// NOTE on OSM + amenities: this function does not, and should not, know
// which source_id resolved `row.amenities` — that decision is made entirely
// upstream, in SQL, by field_precedence (ioverlander/ridb/nps/google only;
// OSM has no field_precedence row for `amenities` and is therefore
// structurally excluded before this function ever runs — confirmed by
// reading supabase/migrations/20260527121000_phase1_seed_field_precedence.sql
// directly, not inferred). mapMasterPlaceRow is a pure, source-blind
// passthrough of whatever the DB already resolved onto `row`, so there is
// nothing for a test at this layer to gate — an OSM-exclusion test belongs
// against `resolve_field()`/field_precedence (DB layer), not this mapper.
