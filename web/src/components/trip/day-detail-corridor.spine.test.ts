/**
 * Tests for buildSpineItems() — the merge that positions curated key stops IN
 * the spine (ordered by along-route mile) instead of a detached block — and for
 * spinePosition(), which decides WHERE a pick sits and WHETHER it gets a mile.
 * Run with: npx tsx --test src/components/trip/day-detail-corridor.spine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpineItems, filterVisibleSpineItems, isRealContent, pickProminenceFeature, spinePosition } from "./day-detail-corridor";
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

/** A non-fuel place with a real description — the bar `hasRealContent`
 *  requires (category !== "fuel" AND a non-empty description). Distinct
 *  from the shared `pick()` (used by the ordering tests above, which don't
 *  care about description) so those stay untouched by this bar. */
function realPick(id: string, mile: number): CorridorPlace {
  return { ...pick(id, mile), description: "A real, described place." };
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
    [withPool, [realPick("p1", 60)]],
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
    [anchorLike, [realPick("anchor-pick", 30)]],
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
    [withPool, [realPick("p1", 20)]],
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

// ── fuel/charging-only pools ─────────────────────────────────────────────
// A wall of near-duplicate gas/EV-charging listings is functionally the same
// noise problem as a genuinely empty pool: a city header surfacing on the
// spine with nothing worth browsing. `category: "fuel"` is the resolved
// BrowseCardCategory bucket gas_station/ev_charging/truck_stop all roll up
// to (trip-browse/federated.ts SLIDE_TO_PRIMARY_CATEGORY.fuel) — checking it
// directly, not a duplicated source-value list.

function fuelPick(id: string, mile: number): CorridorPlace {
  return { id, title: id, category: "fuel", photoAlt: id, curated: true, milesFromStart: mile };
}

test("a corridor city whose entire pool is fuel/charging is dropped, same as empty", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const chargingOnly = cityWithPool("hillsborough", "Hillsborough", 20, "corridor", ["ev1", "ev2", "ev3"]);
  const end = cityWithPool("e", "B", 60, "end", []);
  const cities = [start, chargingOnly, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [chargingOnly, [fuelPick("ev1", 20), fuelPick("ev2", 20), fuelPick("ev3", 20)]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  assert.deepEqual(ids, ["s", "e"]); // Hillsborough dropped despite a non-empty pool
});

test("a corridor city mixing fuel/charging with at least one real POI still renders, fuel tiles included", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const mixed = cityWithPool("mixed-town", "Mixed Town", 30, "corridor", ["ev1", "diner"]);
  const end = cityWithPool("e", "B", 60, "end", []);
  const cities = [start, mixed, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const mixedTiles = [
    fuelPick("ev1", 30),
    { ...fuelPick("diner", 30), category: "food" as const, description: "Local diner, open since 1962." },
  ];
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [mixed, mixedTiles],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  assert.deepEqual(ids, ["s", "mixed-town", "e"]); // still renders

  // The pool count logic (Explore N more / rendered tiles) reads straight off
  // cityTiles, which this filter never mutates — the fuel tile is still there
  // to browse, not silently dropped from the city that DOES render.
  assert.deepEqual(cityTiles.get(mixed), mixedTiles);
  assert.equal(cityTiles.get(mixed)?.length, 2);
  assert.equal(cityTiles.get(mixed)?.some((p) => p.category === "fuel"), true);
});

test("a corridor city with a fuel-only pool but a non-fuel featured card still renders", () => {
  // featuredFor() only ever returns non-empty for start/end nodes today, but
  // the check covers a corridor node too, defensively — same posture as the
  // empty-pool PR #300 check it extends.
  const start = cityWithPool("s", "A", 0, "start", []);
  const corridorWithFeatured = cityWithPool("odd-case", "Odd Case", 25, "corridor", ["ev1"]);
  const end = cityWithPool("e", "B", 50, "end", []);
  const cities = [start, corridorWithFeatured, end];
  const items = buildSpineItems({
    cities,
    keyStops: [],
    mileMarkers: noMarkers,
    byId: emptyById,
    placeMile: byStoredMile,
  });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [corridorWithFeatured, [fuelPick("ev1", 25)]],
    [end, []],
  ]);
  const cityFeatured = new Map<CorridorCity, CorridorPlace[]>([
    [corridorWithFeatured, [{ ...fuelPick("scenic-anchor", 25), category: "scenic" as const, description: "Overlook with a view of the valley." }]],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, cityFeatured);
  const ids = visible.map((i) => (i.type === "city" ? i.city.id : "?"));
  assert.deepEqual(ids, ["s", "odd-case", "e"]);
});

// ── description-presence bar ─────────────────────────────────────────────
// A place counts as real, browsable content only when it's BOTH non-fuel
// AND has a real description — an unenriched placeholder (real place, no
// description written yet) is "not ready to show," same as noise. Foster
// City's actual pattern: a wall of charging stations plus one undescribed
// real POI ("Chantellope Field") — the city must still hide.

function undescribedPick(id: string, mile: number, category: CorridorPlace["category"] = "scenic"): CorridorPlace {
  return { ...pick(id, mile), category, description: undefined };
}

test("a city with a real, described non-fuel POI is shown", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const town = cityWithPool("town", "Town", 20, "corridor", ["p1"]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, town, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [town, [realPick("p1", 20)]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "town", "e"]);
});

test("a city with a real category but NO description is hidden", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const town = cityWithPool("town", "Town", 20, "corridor", ["p1"]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, town, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [town, [undescribedPick("p1", 20)]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("whitespace-only and empty-string descriptions count as no description", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const town = cityWithPool("town", "Town", 20, "corridor", ["p1", "p2"]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, town, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [town, [
      { ...pick("p1", 20), description: "" },
      { ...pick("p2", 20), description: "   \n\t  " },
    ]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("a fuel-only pool is hidden even when a fuel tile happens to carry a description", () => {
  // Category disqualifies first — a described gas station is still fuel,
  // never "real content." Existing #301 behavior, unchanged by this bar.
  const start = cityWithPool("s", "A", 0, "start", []);
  const town = cityWithPool("town", "Town", 20, "corridor", ["p1"]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, town, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [town, [{ ...fuelPick("p1", 20), description: "Full-service Shell station." }]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("Foster City pattern: fuel/charging wall + one undescribed real POI is hidden", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const fosterCity = cityWithPool("foster-city", "Foster City, CA", 13, "corridor", [
    "tesla1", "electrify1", "evgo1", "chargepoint1", "chantellope",
  ]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, fosterCity, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [fosterCity, [
      fuelPick("tesla1", 13),
      fuelPick("electrify1", 13),
      fuelPick("evgo1", 13),
      fuelPick("chargepoint1", 13),
      undescribedPick("chantellope", 13, "interest"), // "Chantellope Field" — real place, no description yet
    ]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

test("fuel/charging wall + one real, DESCRIBED POI is shown — genuinely mixed cities are unaffected", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const fosterCity = cityWithPool("foster-city", "Foster City, CA", 13, "corridor", [
    "tesla1", "electrify1", "chantellope",
  ]);
  const end = cityWithPool("e", "B", 40, "end", []);
  const cities = [start, fosterCity, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [fosterCity, [
      fuelPick("tesla1", 13),
      fuelPick("electrify1", 13),
      { ...realPick("chantellope", 13), category: "interest" as const, description: "Community park with a small pond and walking loop." },
    ]],
    [end, []],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, new Map());
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "foster-city", "e"]);
});

test("an undescribed featured card and no other content hides the city", () => {
  const start = cityWithPool("s", "A", 0, "start", []);
  const corridorWithFeatured = cityWithPool("odd-case", "Odd Case", 25, "corridor", ["ev1"]);
  const end = cityWithPool("e", "B", 50, "end", []);
  const cities = [start, corridorWithFeatured, end];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById, placeMile: byStoredMile });
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>([
    [start, []],
    [corridorWithFeatured, [fuelPick("ev1", 25)]],
    [end, []],
  ]);
  const cityFeatured = new Map<CorridorCity, CorridorPlace[]>([
    [corridorWithFeatured, [undescribedPick("scenic-anchor", 25)]],
  ]);
  const visible = filterVisibleSpineItems(items, cityTiles, cityFeatured);
  assert.deepEqual(visible.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});

// ── pickProminenceFeature ────────────────────────────────────────────────
// Every city that renders on the spine gets a featured pick — an anchor
// falls back here when the LLM curated nothing for it, and every
// mid-corridor city (never eligible for a curated anchor match at all)
// uses this as its ONLY path to a featured card.

function realPickWithScore(id: string, score: number | undefined, photoUrl?: string): CorridorPlace {
  // Plain (non-curated) pool tile — pickProminenceFeature only ranks these;
  // a curated tile is already shown elsewhere (anchor/pinned/KeyStopNode).
  return { ...realPick(id, 0), curated: false, prominenceScore: score, photoUrl };
}

test("picks the highest-prominenceScore real-content tile", () => {
  const tiles = [
    realPickWithScore("low", 0.2),
    realPickWithScore("high", 0.9),
    realPickWithScore("mid", 0.5),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "high");
});

test("a fuel tile is never picked even with the top prominenceScore", () => {
  const tiles = [
    { ...fuelPick("fuel-top", 0), curated: false, prominenceScore: 0.99 },
    realPickWithScore("real-lower", 0.1),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "real-lower");
});

test("an undescribed tile is never picked even with the top prominenceScore", () => {
  const tiles: CorridorPlace[] = [
    { ...undescribedPick("undescribed-top", 0, "scenic"), curated: false, prominenceScore: 0.99 },
    realPickWithScore("real-lower", 0.1),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "real-lower");
});

test("a curated tile is never picked — it's already shown elsewhere (anchor/pinned/KeyStopNode)", () => {
  const tiles = [
    { ...realPickWithScore("curated-top", 0.99), curated: true },
    realPickWithScore("real-lower", 0.1),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "real-lower");
});

test("tiebreak on equal prominenceScore: a tile with a photo wins", () => {
  const tiles = [
    realPickWithScore("no-photo", 0.5),
    realPickWithScore("with-photo", 0.5, "https://example.com/photo.jpg"),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "with-photo");
});

test("tiebreak on equal prominenceScore AND equal photo presence: stable id order", () => {
  const tiles = [
    realPickWithScore("zzz", 0.5),
    realPickWithScore("aaa", 0.5),
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "aaa");
});

test("absent prominenceScore sorts below any real score, not above (not treated as 0)", () => {
  const tiles = [
    realPickWithScore("no-score", undefined),
    realPickWithScore("negative-ish-real-score", -5), // still a real, present score
  ];
  const pick = pickProminenceFeature(tiles);
  assert.equal(pick?.id, "negative-ish-real-score");
});

test("empty pool, or a pool with nothing real, returns undefined (no fabricated pick)", () => {
  assert.equal(pickProminenceFeature([]), undefined);
  assert.equal(pickProminenceFeature([fuelPick("f", 0)]), undefined);
  assert.equal(pickProminenceFeature([undescribedPick("u", 0)]), undefined);
});

test("isRealContent: the exported per-tile predicate matches hasRealContent's own bar", () => {
  assert.equal(isRealContent(realPick("r", 0)), true);
  assert.equal(isRealContent(fuelPick("f", 0)), false);
  assert.equal(isRealContent(undescribedPick("u", 0)), false);
});
