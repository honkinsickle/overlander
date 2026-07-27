/**
 * Locks the two rules in `resolvedContributions` — the fix for the generated-day
 * mile defect.
 *
 * These are unit tests on purpose. The defect is only observable end-to-end by
 * regenerating a trip (an LLM call that produces a DIFFERENT itinerary and would
 * destroy the standing instrument), and the payload-invariant script reads
 * STORED data, so neither can prove a change to what a FUTURE bake produces.
 * This is the only measurement that can.
 *
 * Fixtures mirror the two real duplicates measured on `expedition-ms28y793`
 * [queried TEST, 2026-07-26]: day 6, where Bryce Canyon National Park resolved
 * as both the endpoint and a key stop, and day 7, where Ruby's Inn resolved as
 * both the overnight and a key stop.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolvedContributions } from "./bake";
import type { ResolvedPlace } from "./schema";

const rp = (
  over: Partial<ResolvedPlace> & Pick<ResolvedPlace, "placeId" | "where">,
): ResolvedPlace => ({
  name: over.name ?? "Somewhere",
  displayName: over.displayName ?? over.name ?? "Somewhere",
  coords: over.coords ?? [-112, 37],
  category: over.category ?? null,
  ...over,
});

// ── VIAS: key stops only ──────────────────────────────────────────────

test("vias exclude the endpoint — routing through it doubles the line back", () => {
  const { vias } = resolvedContributions(
    [rp({ placeId: "end", where: "endpoint", coords: [-112.18, 37.59] })],
    new Map(),
  );
  assert.deepEqual(vias, []);
});

test("vias exclude the overnight", () => {
  const { vias } = resolvedContributions(
    [rp({ placeId: "inn", where: "overnight", coords: [-112.15, 37.67] })],
    new Map(),
  );
  assert.deepEqual(vias, []);
});

test("vias keep key stops, in encounter order", () => {
  const { vias } = resolvedContributions(
    [
      rp({ placeId: "end", where: "endpoint", coords: [-112.18, 37.59] }),
      rp({ placeId: "red", where: "keyStop", coords: [-112.3, 37.74] }),
      rp({ placeId: "lodge", where: "keyStop", coords: [-112.16, 37.62] }),
      rp({ placeId: "inn", where: "overnight", coords: [-112.15, 37.67] }),
    ],
    new Map(),
  );
  assert.deepEqual(vias, [
    [-112.3, 37.74],
    [-112.16, 37.62],
  ]);
});

test("a place resolved in BOTH endpoint and keyStop roles contributes ONE via", () => {
  // Day 6's real shape: the same placeId arrives twice.
  const { vias } = resolvedContributions(
    [
      rp({ placeId: "bryce", where: "endpoint", coords: [-112.18, 37.59] }),
      rp({ placeId: "bryce", where: "keyStop", coords: [-112.18, 37.59] }),
    ],
    new Map(),
  );
  assert.equal(vias.length, 1);
});

// ── TILES: one per place, roles merged, nothing filtered ──────────────

test("the endpoint still produces a tile — it is how the destination gets a card", () => {
  const { tiles } = resolvedContributions(
    [rp({ placeId: "end", where: "endpoint", displayName: "Bryce Canyon" })],
    new Map(),
  );
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, "google:end");
  assert.equal(tiles[0].curated, undefined);
});

test("the overnight still produces a tile — it is deliberately carried", () => {
  const { tiles } = resolvedContributions(
    [rp({ placeId: "inn", where: "overnight", displayName: "Ruby's Inn" })],
    new Map(),
  );
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].title, "Ruby's Inn");
});

test("endpoint + keyStop for one place → ONE tile carrying the keyStop's note", () => {
  // Day 6 verbatim: the LLM named it "Bryce Canyon National Park" as a key stop
  // and the day ended at "Bryce Canyon, UT"; both resolved to the same placeId.
  const { tiles } = resolvedContributions(
    [
      rp({ placeId: "bryce", where: "endpoint", name: "Bryce Canyon, UT" }),
      rp({
        placeId: "bryce",
        where: "keyStop",
        name: "Bryce Canyon National Park",
        displayName: "Bryce Canyon National Park",
      }),
    ],
    new Map([["Bryce Canyon National Park", "first overlooks; scout sunrise"]]),
  );
  assert.equal(tiles.length, 1, "one real place must yield one tile");
  assert.equal(tiles[0].curated, true, "the keyStop role's flag is unioned in");
  assert.equal(tiles[0].keyStopNote, "first overlooks; scout sunrise");
});

test("overnight + keyStop for one place → ONE tile carrying the keyStop's note", () => {
  // Day 7 verbatim.
  const { tiles } = resolvedContributions(
    [
      rp({ placeId: "inn", where: "keyStop", name: "Ruby's Inn" }),
      rp({ placeId: "inn", where: "overnight", name: "Best Western Ruby's Inn" }),
    ],
    new Map([["Ruby's Inn", "food — breakfast buffet"]]),
  );
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].curated, true);
  assert.equal(tiles[0].keyStopNote, "food — breakfast buffet");
});

test("role order does not change the merge — keyStop first or last, same tile", () => {
  const note = new Map([["KS", "the note"]]);
  const a = resolvedContributions(
    [
      rp({ placeId: "p", where: "keyStop", name: "KS" }),
      rp({ placeId: "p", where: "endpoint", name: "EP" }),
    ],
    note,
  ).tiles[0];
  const b = resolvedContributions(
    [
      rp({ placeId: "p", where: "endpoint", name: "EP" }),
      rp({ placeId: "p", where: "keyStop", name: "KS" }),
    ],
    note,
  ).tiles[0];
  assert.equal(a.curated, b.curated);
  assert.equal(a.keyStopNote, b.keyStopNote);
  assert.equal(a.id, b.id);
});

test("distinct places are never merged", () => {
  const { tiles } = resolvedContributions(
    [
      rp({ placeId: "a", where: "keyStop" }),
      rp({ placeId: "b", where: "keyStop" }),
      rp({ placeId: "c", where: "overnight" }),
    ],
    new Map(),
  );
  assert.equal(tiles.length, 3);
  assert.deepEqual(
    tiles.map((t) => t.id),
    ["google:a", "google:b", "google:c"],
  );
});

test("a keyStop with no matching note yields curated with an undefined note", () => {
  // The note is keyed on the LLM's name; a miss must not fabricate one.
  const { tiles } = resolvedContributions(
    [rp({ placeId: "p", where: "keyStop", name: "Unlisted" })],
    new Map(),
  );
  assert.equal(tiles[0].curated, true);
  assert.equal(tiles[0].keyStopNote, undefined);
});

test("no resolutions → no vias, no tiles", () => {
  const { vias, tiles } = resolvedContributions([], new Map());
  assert.deepEqual(vias, []);
  assert.deepEqual(tiles, []);
});
