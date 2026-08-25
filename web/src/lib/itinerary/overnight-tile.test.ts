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

// ── markOvernightTile: fuzzy name + proximity fallback (tier 3, #285) ──────
// When neither the exact `mp:`/`google:` id match nor the google_place_id bridge
// hits, fall back to matching the overnight's pool POI (name + coords) against
// the day's candidate tiles. BOTH name (strict fuzzy) AND distance (tight) must
// clear. No match → no mark (behaves like today). Never a best-guess.

const HV: [number, number] = [-119.92, 38.75]; // Hope Valley
const NEAR: [number, number] = [-119.9205, 38.7505]; // ~0.06 mi
const FAR: [number, number] = [-119.96, 38.75]; // ~2.1 mi

function tileAt(id: string, title: string, coords: [number, number]) {
  return { ...tile(id, title), coords };
}

test("markOvernightTile fuzzy: marks a same-place google: tile by name + proximity when id tiers miss", () => {
  const tiles = [tileAt("google:ChIJhv", "Hope Valley Campground", NEAR), tileAt("mp:other", "Somewhere Else", FAR)];
  const out = markOvernightTile(tiles, "mp:hopevalley-not-in-fold", "note", null, {
    name: "Hope Valley Campground",
    coords: HV,
  });
  const marked = out.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].id, "google:ChIJhv");
});

test("markOvernightTile fuzzy: 'Convict Lake' ≈ 'Convict Lake Campground' (subset) matches", () => {
  const out = markOvernightTile([tileAt("google:x", "Convict Lake", NEAR)], "mp:x", "note", null, {
    name: "Convict Lake Campground",
    coords: HV,
  });
  assert.equal(out.filter((t) => t.isOvernight).length, 1);
});

test("markOvernightTile fuzzy: name near-miss does NOT match ('Convict Creek Trailhead')", () => {
  const out = markOvernightTile([tileAt("google:x", "Convict Creek Trailhead", NEAR)], "mp:x", "note", null, {
    name: "Convict Lake Campground",
    coords: HV,
  });
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile fuzzy: distance near-miss does NOT match (right name, too far)", () => {
  const out = markOvernightTile([tileAt("google:x", "Hope Valley Campground", FAR)], "mp:x", "note", null, {
    name: "Hope Valley Campground",
    coords: HV,
  });
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile fuzzy: single generic token does NOT match (err strict)", () => {
  const out = markOvernightTile([tileAt("google:x", "Convict", NEAR)], "mp:x", "note", null, {
    name: "Convict Lake Campground",
    coords: HV,
  });
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile fuzzy: genuine no-match marks nothing (behaves like today)", () => {
  const out = markOvernightTile([tileAt("google:x", "Different Lake", FAR)], "mp:x", "note", null, {
    name: "Hope Valley Campground",
    coords: HV,
  });
  assert.equal(out.filter((t) => t.isOvernight).length, 0);
});

test("markOvernightTile fuzzy: exact id match (tier 1) wins — fuzzy never overrides it", () => {
  const tiles = [tileAt("mp:hopevalley", "Hope Valley Campground", FAR), tileAt("google:ChIJhv", "Hope Valley Campground", NEAR)];
  const out = markOvernightTile(tiles, "mp:hopevalley", "note", null, { name: "Hope Valley Campground", coords: HV });
  const marked = out.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1, "only the exact-ref tile is marked");
  assert.equal(marked[0].id, "mp:hopevalley");
});

test("markOvernightTile fuzzy: google_place_id bridge (tier 2) wins over fuzzy", () => {
  const tiles = [tileAt("google:ChIJgid", "Hope Valley Campground", FAR), tileAt("google:ChIJother", "Hope Valley Campground", NEAR)];
  const out = markOvernightTile(tiles, "mp:x", "note", "ChIJgid", { name: "Hope Valley Campground", coords: HV });
  const marked = out.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1, "the tier-2 google_place_id tile is marked, not the nearer fuzzy one");
  assert.equal(marked[0].id, "google:ChIJgid");
});
