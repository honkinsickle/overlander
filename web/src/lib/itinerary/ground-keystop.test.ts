/**
 * Locks the key-stop grounding + note-threading invariant across the
 * string[] → {name,note}[] schema change: a {name, note} key stop GROUNDS by
 * name (pool-first → live-resolve → drop) AND its note survives the name→ref
 * swap so the bake can key it onto the matching tile. The note never resolves.
 * Run with: npx tsx --test src/lib/itinerary/ground-keystop.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groundKeyStop } from "./audit";
import type { PlaceResolver } from "./resolve";
import type { PoolPOI } from "./facts";

const CTX_BASE = { biasCoord: [0, 0] as [number, number], onCorridor: () => true };
const throwingResolver = {
  resolve: async () => {
    throw new Error("resolver must NOT be called on a pool-hit");
  },
} as unknown as PlaceResolver;

test("pool-hit: grounds name→corpus id, carries the note, never calls the resolver", async () => {
  const poi: PoolPOI = {
    id: "mp:boya",
    name: "Boya Lake Provincial Park",
    category: "camping",
    coords: [-129.07, 59.37],
    rating: 4.7,
    priceTier: null,
    tags: null,
  };
  const poolByName = new Map([["boya lake provincial park", poi]]);
  const g = await groundKeyStop(
    { name: "Boya Lake Provincial Park", note: "aquamarine lake — worth a swim" },
    { ...CTX_BASE, poolByName, resolver: throwingResolver },
  );
  if (g.kind !== "kept") throw new Error(`expected kept, got ${g.kind}`);
  assert.equal(g.kept.name, "mp:boya"); // grounded: name → corpus id
  assert.equal(g.kept.note, "aquamarine lake — worth a swim"); // note carried
  assert.equal(g.resolved, null);

  // Note reaches the tile: the bake keys the note by kept.name (the corpus id)
  // and matches the corpus tile's id — same ref on both sides.
  const noteByRef = new Map([[g.kept.name, g.kept.note]]);
  assert.equal(noteByRef.get(poi.id), "aquamarine lake — worth a swim");
});

test("live-resolve: keeps the name, carries the note, emits a keyStop ResolvedPlace", async () => {
  const resolver = {
    resolve: async () => ({
      status: "resolved",
      place: { coords: [-135.79, 61.47], displayName: "Braeburn Lodge", placeId: "google:brae" },
    }),
  } as unknown as PlaceResolver;
  const g = await groundKeyStop(
    { name: "Braeburn Lodge", note: "cinnamon buns worth the stop" },
    { ...CTX_BASE, poolByName: new Map(), resolver },
  );
  if (g.kind !== "kept") throw new Error(`expected kept, got ${g.kind}`);
  assert.equal(g.kept.name, "Braeburn Lodge"); // name kept on live-resolve
  assert.equal(g.kept.note, "cinnamon buns worth the stop"); // note carried
  assert.equal(g.resolved?.where, "keyStop");
  assert.equal(g.resolved?.name, "Braeburn Lodge");

  // Bake keys resolved-tile notes by the resolved name.
  const noteByRef = new Map([[g.kept.name, g.kept.note]]);
  assert.equal(noteByRef.get("Braeburn Lodge"), "cinnamon buns worth the stop");
});

test("off-corridor: dropped (name never reaches a tile)", async () => {
  const resolver = {
    resolve: async () => ({
      status: "resolved",
      place: { coords: [0, 0], displayName: "Far Place", placeId: "google:x" },
    }),
  } as unknown as PlaceResolver;
  const g = await groundKeyStop(
    { name: "Far Place", note: "off route" },
    { ...CTX_BASE, poolByName: new Map(), resolver, onCorridor: () => false },
  );
  assert.equal(g.kind, "dropped");
  if (g.kind !== "dropped") return;
  assert.equal(g.poiId, "Far Place");
});
