import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvedToTile } from "./bake";
import type { ResolvedPlace } from "./schema";

/** Regression coverage for the 2026-08-31 fix that wired `rp.category` from
 *  Google's inferred primary_type through `primaryCategoryToSlideKey` on the
 *  returned tile. Before the fix, `resolvedToTile` never set `category`, so
 *  every google-resolved tile fell to the generic "interest" diamond icon
 *  regardless of what Google had said the place was
 *  (docs/measurements/2026-08-31-day-detail-description-bug.md follow-up:
 *  352 / 352 google-resolved tiles across TEST's 13 baked trips were
 *  measured with `category: undefined`). */

function rp(category: string | null, overrides: Partial<ResolvedPlace> = {}): ResolvedPlace {
  return {
    name: "test",
    displayName: "Test",
    placeId: "ChIJfake",
    coords: [-116.756, 33.826],
    category,
    where: "keyStop",
    ...overrides,
  };
}

test("resolvedToTile: campground → camping slide key (Boulder Basin repro)", () => {
  const tile = resolvedToTile(rp("campground"));
  assert.equal(tile.category, "camping");
  assert.equal(tile.id, "google:ChIJfake");
});

test("resolvedToTile: restaurant → food", () => {
  assert.equal(resolvedToTile(rp("restaurant")).category, "food");
});

test("resolvedToTile: gas_station → fuel", () => {
  assert.equal(resolvedToTile(rp("gas_station")).category, "fuel");
});

test("resolvedToTile: rv_park → camping", () => {
  assert.equal(resolvedToTile(rp("rv_park")).category, "camping");
});

test("resolvedToTile: viewpoint → scenic", () => {
  assert.equal(resolvedToTile(rp("viewpoint")).category, "scenic");
});

test("resolvedToTile: null category → interest fallback (same as pre-fix visual)", () => {
  assert.equal(resolvedToTile(rp(null)).category, "interest");
});

test("resolvedToTile: unknown/unmapped corpus category → interest fallback", () => {
  assert.equal(resolvedToTile(rp("weird_type_google_returned")).category, "interest");
});
