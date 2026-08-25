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

// ── markOvernightTile: cross-scheme reconciliation (Follow-up 4 / #283 Day 4) ──
// A pool-hit overnight's ref is `mp:…`, but the tile that represents the same
// place on the spine may be a live-resolve `google:…` tile (from a keyStop /
// endpoint). When the pool POI carries a google_place_id, mark that tile too —
// in ADDITION to (and preferring) the existing exact-id match.

test("markOvernightTile: mp: ref with no mp: tile marks the matching google: tile via googleId", () => {
  const tiles = [tile("google:ChIJhope", "Hope Valley Campground"), tile("mp:other", "Other")];
  const out = markOvernightTile(tiles, "mp:hopevalley", "creekside sites", "ChIJhope");
  const marked = out.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].id, "google:ChIJhope");
  assert.equal(marked[0].curated, true);
});

test("markOvernightTile: googleId also matches a tile carrying that id as its placeId", () => {
  const t = { ...tile("mp:z", "Hope Valley Campground"), placeId: "ChIJhope" };
  const out = markOvernightTile([t], "mp:hopevalley", "note", "ChIJhope");
  assert.equal(out.filter((x) => x.isOvernight).length, 1);
  assert.equal(out[0].isOvernight, true);
});

test("markOvernightTile: exact ref wins — no double-mark when both an mp: tile and a google: tile exist", () => {
  const tiles = [tile("mp:hopevalley", "Hope Valley Campground"), tile("google:ChIJhope", "Hope Valley Campground")];
  const out = markOvernightTile(tiles, "mp:hopevalley", "note", "ChIJhope");
  const marked = out.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1, "only the exact-ref tile is marked");
  assert.equal(marked[0].id, "mp:hopevalley");
});

test("markOvernightTile: no ref tile and null googleId (backcountry) marks nothing — no paper-over", () => {
  const tiles = [tile("mp:other", "Other")];
  const out = markOvernightTile(tiles, "mp:convictlake", "note", null);
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile: googleId set but no tile carries it marks nothing", () => {
  const tiles = [tile("mp:other", "Other")];
  const out = markOvernightTile(tiles, "mp:x", "note", "ChIJnowhere");
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});
