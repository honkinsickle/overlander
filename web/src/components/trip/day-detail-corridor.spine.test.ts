/**
 * Tests for buildSpineItems() — the merge that positions curated key stops IN
 * the spine (ordered by along-route mile) instead of a detached block — and for
 * spinePosition(), which decides WHERE a pick sits and WHETHER it gets a mile.
 * Run with: npx tsx --test src/components/trip/day-detail-corridor.spine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpineItems, filterVisibleSpineItems, spinePosition } from "./day-detail-corridor";
import type { CorridorPlace, SpineItem, SpinePos } from "./day-detail-corridor";
import type { CorridorCity } from "@/lib/trips/types";
import type { PositionedPlace } from "@/lib/corridor/stretches";

function city(id: string, name: string, mile: number, kind: CorridorCity["kind"]): CorridorCity {
  return { id, name, kind, coords: [0, 0], milesFromStart: mile, placeIds: [] };
}
function pick(id: string, mile: number): CorridorPlace {
  return { id, title: id, category: "scenic", photoAlt: id, curated: true, milesFromStart: mile };
}
const noMarkers: { mile: number; placeIds?: string[] }[] = [];
const emptyById = new Map<string, CorridorPlace>();

/** These merge tests are about ORDER, not about where the mile came from, so they
 *  inject the pick's own `milesFromStart`. Production never does — it injects
 *  `spinePosition`, exercised separately below. */
const byStoredMile = (p: CorridorPlace): SpinePos => ({
  sort: p.milesFromStart as number,
  tiebreak: 0,
  label: p.milesFromStart ?? null,
});

test("key stops sort between start and end by along-route mile", () => {
  const cities = [city("s", "Carmacks", 0, "start"), city("e", "Whitehorse", 110, "end")];
  const keyStops = [pick("laberge", 15), pick("miles-canyon", 8)];
  const items = buildSpineItems({
    cities,
    keyStops,
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });

  const order = items.map((i) =>
    i.type === "city" ? i.city.id : i.type === "keystop" ? i.place.id : `mk${i.mile}`,
  );
  // Start(0) → Miles Canyon(8) → Lake Laberge(15) → End(110).
  assert.deepEqual(order, ["s", "miles-canyon", "laberge", "e"]);
});

test("only the final entry is flagged last (drops its connector)", () => {
  const cities = [city("s", "Carmacks", 0, "start"), city("e", "Whitehorse", 110, "end")];
  const items = buildSpineItems({
    cities,
    keyStops: [pick("laberge", 15)],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const lasts = items.map((i) => i.last);
  assert.deepEqual(lasts, [false, false, true]);
  assert.equal(items[items.length - 1].type, "city"); // end city is last
});

test("a key stop at a city's mile lands just AFTER that city (tie → city first)", () => {
  const cities = [
    city("s", "Carmacks", 0, "start"),
    city("mid", "Junction", 50, "end"),
  ];
  const items = buildSpineItems({
    cities,
    keyStops: [pick("at-junction", 50)],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const order = items.map((i) => (i.type === "city" ? i.city.id : (i as { place: CorridorPlace }).place.id));
  assert.deepEqual(order, ["s", "mid", "at-junction"]);
});

test("no key stops → spine is just the cities, in order", () => {
  const cities = [city("s", "A", 0, "start"), city("e", "B", 40, "end")];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("a pinned pick sorts UNDER its node but displays its own (out-of-order) mile", () => {
  // Bear Glacier's true mile is 315, but it's pinned to Dease Lake@95: it must
  // render right AFTER Dease Lake (not at 315 near the end) yet show 315mi.
  const cities = [
    city("boya", "Boya Lake", 0, "start"),
    city("dease", "Dease Lake", 95, "corridor"),
    city("stewart", "Stewart", 338, "end"),
  ];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    pinnedKeyStops: [{ place: pick("bear-glacier", 315), nodeMile: 95 }],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const order = items.map((i) =>
    i.type === "city" ? i.city.id : (i as { place: CorridorPlace }).place.id,
  );
  assert.deepEqual(order, ["boya", "dease", "bear-glacier", "stewart"]); // after Dease, before Stewart
  const bear = items.find((i) => i.type === "keystop") as { mile: number };
  assert.equal(bear.mile, 315); // displays its TRUE mile, not the node's 95
});

// ── Regression 2: end-clamp collapse ───────────────────────────────────────
// PROD 7e3e088a day 3 (Fremont→SF): four picks sit BEYOND the polyline's final
// vertex, so alongRouteMiles clamps all four to the same mile. Sorting on mile
// alone leaves them in input order (Array#sort is stable), which is not a route
// order. The tiebreak is offsetMi, which at a clamp IS distance past the end.

test("picks clamped to the same mile order by tiebreak, not input order", () => {
  const cities = [city("s", "Fremont", 0, "start"), city("e", "San Francisco", 44, "end")];
  const clamped = new Map<string, SpinePos>([
    ["rob-hill", { sort: 43.69, tiebreak: 3.28, label: 43.69 }],
    ["battery-spencer", { sort: 43.69, tiebreak: 4.89, label: 43.69 }],
    ["ggb-plaza", { sort: 43.69, tiebreak: 3.59, label: 43.69 }],
    ["ferry-building", { sort: 43.69, tiebreak: 1.83, label: 43.69 }],
  ]);
  // Input order is the collapsed order observed in production.
  const keyStops = ["rob-hill", "battery-spencer", "ggb-plaza", "ferry-building"].map((id) =>
    pick(id, 43.69),
  );
  const items = buildSpineItems({
    cities,
    keyStops,
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: (p) => clamped.get(p.id)!,
  });
  const stops = items
    .filter((i) => i.type === "keystop")
    .map((i) => (i as { place: CorridorPlace }).place.id);
  assert.deepEqual(stops, ["ferry-building", "rob-hill", "ggb-plaza", "battery-spencer"]);
});

test("the tiebreak never reorders picks that sit at different miles", () => {
  const cities = [city("s", "A", 0, "start"), city("e", "B", 100, "end")];
  const pos = new Map<string, SpinePos>([
    // A far-offset near pick must still precede an on-route far pick.
    ["near-far-offset", { sort: 10, tiebreak: 20, label: 10 }],
    ["far-on-route", { sort: 80, tiebreak: 0, label: 80 }],
  ]);
  const items = buildSpineItems({
    cities,
    keyStops: [pick("far-on-route", 80), pick("near-far-offset", 10)],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: (p) => pos.get(p.id)!,
  });
  const stops = items
    .filter((i) => i.type === "keystop")
    .map((i) => (i as { place: CorridorPlace }).place.id);
  assert.deepEqual(stops, ["near-far-offset", "far-on-route"]);
});

// ── spinePosition ──────────────────────────────────────────────────────────

function positionedMap(entries: [string, number, number][]): Map<string, PositionedPlace> {
  return new Map(
    entries.map(([id, dayMile, offsetMi]) => [
      id,
      { id, dayMile, offsetMi, onCorridor: offsetMi <= 25 },
    ]),
  );
}

test("a normal day labels with the projected day-mile and tiebreaks on offset", () => {
  const at = spinePosition({
    roundTrip: false,
    anchor: [0, 0],
    positioned: positionedMap([["red-canyon", 62.4, 1.2]]),
  });
  assert.deepEqual(at(pick("red-canyon", 113)), { sort: 62.4, tiebreak: 1.2, label: 62.4 });
});

test("a pick projecting upstream of the day start keeps its place but claims no mile", () => {
  // Not a round-trip day: an off-route stop whose nearest point on the trip line
  // falls before this day begins. It must sort ahead of the start node (it IS
  // behind you) without printing "-23mi" or the equally false "0mi".
  const at = spinePosition({
    roundTrip: false,
    anchor: [0, 0],
    positioned: positionedMap([["fremont-indian", -23.4, 6.1]]),
  });
  const p = at(pick("fremont-indian", 157));
  assert.equal(p.label, null);
  assert.equal(p.sort, -23.4);
});

test("an unprojectable pick sorts last and claims no mile", () => {
  const at = spinePosition({ roundTrip: false, anchor: [0, 0], positioned: positionedMap([]) });
  const p = at(pick("nowhere", 999));
  assert.equal(p.label, null);
  assert.equal(p.sort, Number.POSITIVE_INFINITY);
});

// Regression 1: round-trip days. Projection onto routePolyline is uninformed
// there (the day's driving is absent from the line), so it produced negatives.
test("a round-trip day orders near→far from the anchor and claims NO mile", () => {
  const anchor: [number, number] = [-109.55, 38.57]; // Moab
  const at = spinePosition({
    roundTrip: true,
    anchor,
    // Deliberately populated with the NEGATIVE values the naive projection
    // returns — a round-trip day must ignore them entirely.
    positioned: positionedMap([
      ["mesa-arch", -8, 20],
      ["quesadilla", -1, 2],
    ]),
  });
  const near: CorridorPlace = { ...pick("quesadilla", 103), coords: [-109.55, 38.58] };
  const far: CorridorPlace = { ...pick("mesa-arch", 39), coords: [-109.87, 38.39] };

  const a = at(near);
  const b = at(far);
  assert.equal(a.label, null);
  assert.equal(b.label, null);
  assert.ok(a.sort < b.sort, "the nearer stop sorts first");
  assert.ok(a.sort >= 0 && b.sort >= 0, "radial distances are never negative");
});

test("a round-trip pick with no coords sorts last rather than at zero", () => {
  const at = spinePosition({ roundTrip: true, anchor: [0, 0], positioned: positionedMap([]) });
  assert.equal(at(pick("no-coords", 5)).sort, Number.POSITIVE_INFINITY);
});

test("a null label reaches the spine item, so the tick renders without a mile", () => {
  const cities = [city("s", "Moab", 0, "start"), city("e", "Moab", 0, "end")];
  const at = spinePosition({
    roundTrip: true,
    anchor: [-109.55, 38.57],
    positioned: positionedMap([]),
  });
  const items = buildSpineItems({
    cities,
    keyStops: [{ ...pick("arch", 39), coords: [-109.87, 38.39] }],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: at,
  });
  const stop = items.find((i) => i.type === "keystop") as { mile: number | null };
  assert.equal(stop.mile, null);
});

// ── filterVisibleSpineItems ─────────────────────────────────────────────────
// The density-cascade fix: strict-proximity corridor selection (PR #296) can
// surface 20+ cities/day with nothing under them — bare name, no card, no
// "Explore more". These tests use non-empty placeIds (unlike the city()
// helper's default []) so tiles/featured maps can be built per case.

function cityWithPool(id: string, name: string, mile: number, kind: CorridorCity["kind"], placeIds: string[]): CorridorCity {
  return { id, name, kind, coords: [0, 0], milesFromStart: mile, placeIds };
}

test("a corridor city with no pool and no featured card is dropped", () => {
  const start = cityWithPool("s", "Placerville", 0, "start", []);
  const bare = cityWithPool("hayward", "Hayward", 20, "corridor", []);
  const withPool = cityWithPool("concord", "Concord", 60, "corridor", ["p1"]);
  const end = cityWithPool("e", "South Lake Tahoe", 100, "end", []);
  const cities = [start, bare, withPool, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [bare, []],
    [withPool, [pick("p1", 60)]],
    [end, []],
  ]);
  const cityFeatured = new Map<CorridorCity, CorridorPlace[]>();
  const visible = filterVisibleSpineItems(items, cityTiles, cityFeatured);
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  // Hayward (empty corridor city) is gone; Concord (has a pool) stays;
  // start/end stay regardless of their own empty pool.
  assert.deepEqual(ids, ["s", "concord", "e"]);
});

test("a corridor city with no pool but a featured anchor card is kept", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const anchorLike = cityWithPool("mid", "Mid", 30, "corridor", []);
  const end = cityWithPool("e", "B", 60, "end", []);
  const cities = [start, anchorLike, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [anchorLike, []],
    [end, []],
  ]);
  const cityFeatured = new Map<CorridorCity, CorridorPlace[]>([
    [anchorLike, [pick("anchor-pick", 30)]],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, cityFeatured);
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  assert.deepEqual(ids, ["s", "mid", "e"]);
});

test("start and end cities always render even with an empty pool", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("non-city items (keystops, markers) are never filtered", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, end];
  const items = buildSpineItems({
    cities,
    keyStops: [pick("ks", 20)],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([[start, []], [end, []]]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.equal(visible.some((i) => i.type === "keystop"), true);
});

test("last is recomputed against the FILTERED list, not the original", () => {
  // If the trailing city gets dropped, the new true-last item must be
  // flagged last so its connector line still drops correctly.
  const start = cityWithPool("s", "A", 0, "start", []);
  const withPool = cityWithPool("mid", "Mid", 20, "corridor", ["p1"]);
  const bareEnd = cityWithPool("bare-tail", "BareTail", 40, "corridor", []);
  const cities = [start, withPool, bareEnd];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  // Sanity: in the UNFILTERED list, the bare tail city is last.
  assert.equal(items[items.length - 1].type, "city");
  assert.equal((items[items.length - 1] as { city: CorridorCity }).city.id, "bare-tail");

  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [withPool, [pick("p1", 20)]],
    [bareEnd, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  assert.deepEqual(ids, ["s", "mid"]); // bare-tail dropped
  const lasts = visible.map((i) => i.last);
  assert.deepEqual(lasts, [false, true]); // "mid" — the new true last — is flagged
});

test("filterVisibleSpineItems does not mutate its input array", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const bare = cityWithPool("bare", "Bare", 20, "corridor", []);
  const cities = [start, bare];
  const items: SpineItem[] = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const originalLength = items.length;
  filterVisibleSpineItems(items, new Map([[start, []], [bare, []]]), new Map());
  assert.equal(items.length, originalLength);
});
