/**
 * Locks the overnight → spine-tile link (notes-to-spine, overnight slice).
 *
 * The overnight is already grounded by the audit (pool-first → live-resolve →
 * drop). These tests lock:
 *   1. `overnightTileRef` — the grounded overnight maps to the canonical id of
 *      the tile that IS it (a corpus id on a pool-hit, `google:<placeId>` on a
 *      live-resolve), by IDENTITY, not a substring name match. Null on a drop.
 *   2. `markOvernightTile` — given that ref, exactly the matching tile is
 *      flagged `isOvernight` (+ featured like a curated pick, + its note);
 *      nothing is marked when the ref is null or matches no tile.
 *
 * Run: npx tsx --test src/lib/itinerary/overnight-tile.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { overnightTileRef, markOvernightTile } from "./bake";
import type { BrowsePlace } from "@/lib/trip-browse/places";

function tile(id: string, title: string): BrowsePlace {
  return {
    id,
    coords: [0, 0],
    title,
    photoAlt: title,
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
  };
}

// ── overnightTileRef ────────────────────────────────────────────────────

test("overnightTileRef: pool-hit → the corpus id (identity, not name)", () => {
  const ref = overnightTileRef({
    kind: "pool-hit",
    poi: {
      id: "mp:watchman",
      name: "Watchman Campground",
      category: "camping",
      coords: [-113, 37],
      rating: null,
      priceTier: null,
      hasPhoto: true,
      hasDescription: true,
      tags: null,
    },
  });
  assert.equal(ref, "mp:watchman");
});

test("overnightTileRef: live-resolve → the google:<placeId> tile id", () => {
  const ref = overnightTileRef({
    kind: "resolved",
    place: {
      displayName: "Tuttle Creek Campground",
      placeId: "ChIJabc123",
      coords: [-118, 36],
      category: "camping",
    },
  });
  assert.equal(ref, "google:ChIJabc123");
});

test("overnightTileRef: dropped overnight → null (nothing to link)", () => {
  const ref = overnightTileRef({
    kind: "drop",
    reason: "off-corridor",
    reasonText: "resolved off your route",
    flag: { kind: "dropped-overnight", severity: "critical", message: "x" },
  });
  assert.equal(ref, null);
});

// ── markOvernightTile ───────────────────────────────────────────────────

test("markOvernightTile: flags exactly the matching tile as the overnight", () => {
  const tiles = [tile("mp:a", "A"), tile("mp:watchman", "Watchman Campground"), tile("mp:b", "B")];
  const out = markOvernightTile(tiles, "mp:watchman", "level sites near the shuttle");

  const marked = out.find((t) => t.id === "mp:watchman")!;
  assert.equal(marked.isOvernight, true);
  assert.equal(marked.curated, true); // featured on the spine like a curated pick
  assert.equal(marked.keyStopNote, "level sites near the shuttle");

  // Every other tile is untouched — no isOvernight leakage.
  assert.equal(out.filter((t) => t.isOvernight).length, 1);
  assert.equal(out.find((t) => t.id === "mp:a")!.isOvernight, undefined);
});

test("markOvernightTile: null ref (desc-only / dropped) marks nothing", () => {
  const tiles = [tile("mp:a", "A"), tile("mp:b", "B")];
  const out = markOvernightTile(tiles, null, "note");
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile: ref matching no tile (off-corridor overnight) marks nothing", () => {
  const tiles = [tile("mp:a", "A")];
  const out = markOvernightTile(tiles, "google:notpresent", "note");
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});
