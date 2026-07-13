/**
 * Tests for the anchor-match rule: a curated key stop that IS a day's start/end
 * anchor must never be treated as a separate key-stop tile. Locks the rule
 * (id | name | tight-coords) and the S.S. Klondike coord-safety guard.
 * Run with: npx tsx --test src/lib/corridor/anchor-match.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSameAnchorPlace,
  coincidesWithAnchor,
  ANCHOR_COORD_MI,
  type AnchorLike,
} from "./anchor-match";

/** A point `miNorth` miles north of [lng, lat] (1° lat ≈ 69.09 mi). */
function north(coords: [number, number], miNorth: number): [number, number] {
  return [coords[0], coords[1] + miNorth / 69.09];
}
const WHITEHORSE: [number, number] = [-135.0522761, 60.7197137];

test("id equality → same place (even if names/coords differ)", () => {
  assert.equal(
    isSameAnchorPlace(
      { id: "mp:x", name: "Foo", coords: [0, 0] },
      { id: "mp:x", name: "Bar", coords: [50, 50] },
    ),
    true,
  );
});

test("normalized name equality → same place (region suffix stripped)", () => {
  assert.equal(
    isSameAnchorPlace(
      { id: "google:a", name: "Meziadin Lake Provincial Park" },
      { id: "node-e", name: "Meziadin Lake Provincial Park, British Columbia" },
    ),
    true,
  );
});

test("tight coords → same place even when names differ and no shared id", () => {
  // ~0.1 mi apart, distinct names, distinct ids → coords carries the match.
  assert.equal(
    isSameAnchorPlace(
      { id: "google:a", name: "Park Campground", coords: north(WHITEHORSE, 0.1) },
      { id: "node-e", name: "Whitehorse, Yukon", coords: WHITEHORSE },
    ),
    true,
  );
  assert.ok(0.1 < ANCHOR_COORD_MI);
});

test("SAFETY: S.S. Klondike (0.42 mi from Whitehorse) does NOT match the anchor", () => {
  // A distinct place sitting 0.42 mi from the anchor — a looser coord gate would
  // wrongly dedup it. Name differs, id differs, distance > ANCHOR_COORD_MI.
  assert.ok(0.42 > ANCHOR_COORD_MI);
  assert.equal(
    isSameAnchorPlace(
      { id: "google:klondike", name: "S.S. Klondike National Historic Site", coords: north(WHITEHORSE, 0.42) },
      { id: "node", name: "Whitehorse, Yukon", coords: WHITEHORSE },
    ),
    false,
  );
});

test("coincidesWithAnchor: destination-as-keyStop and start-as-keyStop both hit", () => {
  const cities: AnchorLike[] = [
    { id: "s", name: "Kinaskan Lake Provincial Park, British Columbia", coords: [-130.24, 57.48] },
    { id: "e", name: "Meziadin Lake Provincial Park, British Columbia", coords: [-129.28, 56.1] },
  ];
  assert.equal(coincidesWithAnchor({ id: "g:1", name: "Meziadin Lake Provincial Park" }, cities), true); // end
  assert.equal(coincidesWithAnchor({ id: "g:2", name: "Kinaskan Lake Provincial Park" }, cities), true); // start
  assert.equal(coincidesWithAnchor({ id: "g:3", name: "Bell 2 Lodge" }, cities), false); // legit stop
});

test("layover in-city stops survive (name+coords both correctly reject)", () => {
  const layover: AnchorLike[] = [
    { id: "s", name: "Whitehorse, Yukon", coords: WHITEHORSE },
    { id: "e", name: "Whitehorse, Yukon", coords: WHITEHORSE },
  ];
  assert.equal(coincidesWithAnchor({ id: "g:mc", name: "Miles Canyon", coords: north(WHITEHORSE, 4.1) }, layover), false);
  assert.equal(coincidesWithAnchor({ id: "g:ssk", name: "S.S. Klondike National Historic Site", coords: north(WHITEHORSE, 0.42) }, layover), false);
});

test("NO DUPLICATE: an anchor-coinciding keyStop is excluded from the spine set", () => {
  const cities: AnchorLike[] = [
    { id: "s", name: "Kinaskan Lake Provincial Park, British Columbia", coords: [-130.24, 57.48] },
    { id: "e", name: "Meziadin Lake Provincial Park, British Columbia", coords: [-129.28, 56.1] },
  ];
  const picks: AnchorLike[] = [
    { id: "g:bell2", name: "Bell 2 Lodge" },
    { id: "g:meziadin", name: "Meziadin Lake Provincial Park" }, // == end anchor
  ];
  const spine = picks.filter((p) => !coincidesWithAnchor(p, cities));
  const anchorPicks = picks.filter((p) => coincidesWithAnchor(p, cities));
  // Meziadin is NOT a separate spine tile; Bell 2 is.
  assert.deepEqual(spine.map((p) => p.name), ["Bell 2 Lodge"]);
  assert.deepEqual(anchorPicks.map((p) => p.name), ["Meziadin Lake Provincial Park"]);
});
