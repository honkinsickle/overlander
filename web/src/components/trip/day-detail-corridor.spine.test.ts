/**
 * Tests for buildSpineItems() — the merge that positions curated key stops IN
 * the spine (ordered by along-route mile) instead of a detached block.
 * Run with: npx tsx --test src/components/trip/day-detail-corridor.spine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpineItems, coincidesWithAnchor } from "./day-detail-corridor";
import type { CorridorPlace } from "./day-detail-corridor";
import type { CorridorCity } from "@/lib/trips/types";

function city(id: string, name: string, mile: number, kind: CorridorCity["kind"]): CorridorCity {
  return { id, name, kind, coords: [0, 0], milesFromStart: mile, placeIds: [] };
}
function pick(id: string, mile: number): CorridorPlace {
  return { id, title: id, category: "scenic", photoAlt: id, curated: true, milesFromStart: mile };
}
const noMarkers: { mile: number; placeIds?: string[] }[] = [];
const emptyById = new Map<string, CorridorPlace>();

test("key stops sort between start and end by along-route mile", () => {
  const cities = [city("s", "Carmacks", 0, "start"), city("e", "Whitehorse", 110, "end")];
  const keyStops = [pick("laberge", 15), pick("miles-canyon", 8)];
  const items = buildSpineItems({ cities, keyStops, mileMarkers: noMarkers, byId: emptyById });

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
  });
  const order = items.map((i) => (i.type === "city" ? i.city.id : (i as { place: CorridorPlace }).place.id));
  assert.deepEqual(order, ["s", "mid", "at-junction"]);
});

test("anchor dedup: a key stop that IS the end anchor coincides (drop it)", () => {
  const cities = [
    city("s", "Kinaskan Lake Provincial Park, British Columbia", 0, "start"),
    city("e", "Meziadin Lake Provincial Park, British Columbia", 125, "end"),
  ];
  // corpus tile name lacks the ", British Columbia" region suffix.
  assert.equal(coincidesWithAnchor({ title: "Meziadin Lake Provincial Park" }, cities), true);
  // the destination town, no suffix on either side.
  assert.equal(coincidesWithAnchor({ title: "Stewart" }, [city("s", "Meziadin", 0, "start"), city("e", "Stewart, British Columbia", 38, "end")]), true);
});

test("anchor dedup: a legit on-route / in-city stop does NOT coincide", () => {
  const cities = [
    city("s", "Kinaskan Lake Provincial Park, British Columbia", 0, "start"),
    city("e", "Meziadin Lake Provincial Park, British Columbia", 125, "end"),
  ];
  assert.equal(coincidesWithAnchor({ title: "Bell 2 Lodge" }, cities), false);
  // in-city layover stop must survive (coords-based dedup would wrongly drop it).
  const layover = [city("s", "Whitehorse, Yukon", 0, "start"), city("e", "Whitehorse, Yukon", 0, "end")];
  assert.equal(coincidesWithAnchor({ title: "Miles Canyon" }, layover), false);
  assert.equal(coincidesWithAnchor({ title: "S.S. Klondike National Historic Site" }, layover), false);
});

test("no key stops → spine is just the cities, in order", () => {
  const cities = [city("s", "A", 0, "start"), city("e", "B", 40, "end")];
  const items = buildSpineItems({ cities, keyStops: [], mileMarkers: noMarkers, byId: emptyById });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => (i.type === "city" ? i.city.id : "?")), ["s", "e"]);
});
