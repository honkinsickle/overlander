import { test } from "node:test";
import assert from "node:assert/strict";
import { mapMasterPlaceRow } from "./federated";

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
