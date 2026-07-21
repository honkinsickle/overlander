/**
 * The merged gazetteer = base ∪ northern supplement, deduped. Locks that the
 * northern communities are actually present (the whole point of the ingest).
 * Run: npx tsx --test src/lib/corridor/data/gazetteer.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import merged from "./gazetteer";
import base from "./cities-na.json";
import north from "./cities-na-north.json";

test("merged gazetteer adds every northern row (no base collisions)", () => {
  assert.equal(merged.length, base.length + north.length);
});

test("Dease Lake and Teslin are present with real coords/pop", () => {
  const dease = merged.find((c) => c.name === "Dease Lake" && c.admin === "BC");
  assert.ok(dease, "Dease Lake present");
  assert.equal(dease!.pop, 0); // unincorporated — grounded 0, not invented
  assert.ok(Math.abs(dease!.lat - 58.4333) < 0.01 && Math.abs(dease!.lng + 130.0242) < 0.01);

  const teslin = merged.find((c) => c.name === "Teslin" && c.admin === "YT");
  assert.equal(teslin!.pop, 239); // 2021 census
});
