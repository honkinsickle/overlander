/**
 * splitByTier / hasSortedTierData — where the Verified/Unverified dividers land.
 *
 * Run: cd web && npx tsx --test src/lib/trip-browse/tier-sections.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitByTier, hasSortedTierData, type TierRow } from "./tier-sections";
import type { BrowsePlace } from "./places";

function place(id: string, verified?: "verified" | "unverified"): BrowsePlace {
  return {
    id,
    coords: [-112, 37],
    photoAlt: "P",
    title: id,
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "Add",
    ...(verified ? { verified } : {}),
  };
}

/** Compact shape for assertions: "H:verified" for a header, the id for a place. */
function shape(rows: TierRow[]): string[] {
  return rows.map((r) => (r.kind === "header" ? `H:${r.tier}` : r.place.id));
}

// ── hasSortedTierData ───────────────────────────────────────────────────

test("hasSortedTierData: false on empty", () => {
  assert.equal(hasSortedTierData([]), false);
});

test("hasSortedTierData: false if ANY place lacks verified (flag-off live results)", () => {
  assert.equal(hasSortedTierData([place("a", "verified"), place("b")]), false);
});

test("hasSortedTierData: false if a verified appears after an unverified (unsorted)", () => {
  assert.equal(
    hasSortedTierData([place("a", "verified"), place("b", "unverified"), place("c", "verified")]),
    false,
  );
});

test("hasSortedTierData: true for a clean verified-then-unverified list", () => {
  assert.equal(
    hasSortedTierData([place("a", "verified"), place("b", "verified"), place("c", "unverified")]),
    true,
  );
});

test("hasSortedTierData: true for all-verified and all-unverified", () => {
  assert.equal(hasSortedTierData([place("a", "verified"), place("b", "verified")]), true);
  assert.equal(hasSortedTierData([place("a", "unverified"), place("b", "unverified")]), true);
});

// ── splitByTier ─────────────────────────────────────────────────────────

test("mixed: one Verified header at top, one Unverified header at the boundary", () => {
  const rows = splitByTier([
    place("v1", "verified"),
    place("v2", "verified"),
    place("u1", "unverified"),
    place("u2", "unverified"),
  ]);
  assert.deepEqual(shape(rows), ["H:verified", "v1", "v2", "H:unverified", "u1", "u2"]);
});

test("mixed: the Unverified header lands exactly at the first unverified place", () => {
  const rows = splitByTier([
    place("v1", "verified"),
    place("u1", "unverified"),
  ]);
  assert.deepEqual(shape(rows), ["H:verified", "v1", "H:unverified", "u1"]);
});

test("all-verified: a single Verified header, no Unverified header", () => {
  const rows = splitByTier([place("v1", "verified"), place("v2", "verified")]);
  assert.deepEqual(shape(rows), ["H:verified", "v1", "v2"]);
});

test("all-unverified: a single Unverified header (the useful warning case)", () => {
  const rows = splitByTier([place("u1", "unverified"), place("u2", "unverified")]);
  assert.deepEqual(shape(rows), ["H:unverified", "u1", "u2"]);
});

test("no tier data (flag off / not cut over): NO headers, places passed through unchanged", () => {
  const input = [place("a"), place("b"), place("c")];
  const rows = splitByTier(input);
  assert.deepEqual(shape(rows), ["a", "b", "c"]);
  assert.ok(rows.every((r) => r.kind === "place"));
});

test("partial tier data (some missing verified — legacy live+federated mix): NO headers", () => {
  // Legacy search-area: federated carry verified, live don't. Must not split.
  const rows = splitByTier([place("live1"), place("mp1", "verified"), place("mp2", "unverified")]);
  assert.deepEqual(shape(rows), ["live1", "mp1", "mp2"]);
});

test("unsorted tier data (defensive): NO headers rather than multiple dividers", () => {
  const rows = splitByTier([
    place("v1", "verified"),
    place("u1", "unverified"),
    place("v2", "verified"),
  ]);
  assert.deepEqual(shape(rows), ["v1", "u1", "v2"]);
});

test("empty list: no rows", () => {
  assert.deepEqual(splitByTier([]), []);
});

test("every original place survives, in order, exactly once", () => {
  const input = [place("v1", "verified"), place("v2", "verified"), place("u1", "unverified")];
  const out = splitByTier(input).filter((r) => r.kind === "place").map((r) => (r as { place: BrowsePlace }).place.id);
  assert.deepEqual(out, ["v1", "v2", "u1"]);
});
