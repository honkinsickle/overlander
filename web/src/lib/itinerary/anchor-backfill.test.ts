/**
 * The bar is the whole feature — every test here is about something the
 * backfill must REFUSE to pick, because the failure mode that matters is a
 * padded irrelevant stop, not a missing one.
 *
 * Run: cd web && npx tsx --test src/lib/itinerary/anchor-backfill.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  pickAnchorStop,
  hasStopNearAnchor,
  anchorStopNote,
  ANCHOR_NEAR_MI,
} from "./anchor-backfill";
import type { PoolPOI } from "./facts";

const ANCHOR: [number, number] = [-118.395, 37.363]; // Bishop, CA

/** A coord roughly `mi` east of the anchor — enough for distance-gate tests. */
function offset(mi: number): [number, number] {
  const degPerMiLng = 1 / (69 * Math.cos((ANCHOR[1] * Math.PI) / 180));
  return [ANCHOR[0] + mi * degPerMiLng, ANCHOR[1]];
}

function poi(over: Partial<PoolPOI> = {}): PoolPOI {
  return {
    id: "mp:base",
    name: "Base Place",
    category: "scenic",
    coords: offset(1),
    rating: null,
    priceTier: null,
    tags: null,
    hasPhoto: false,
    hasDescription: false,
    ...over,
  };
}

const ALLOW = () => true;
const NONE = new Set<string>();

test("picks a qualifying nearby place", () => {
  const p = poi({ id: "mp:a", name: "Nearby Overlook" });
  const got = pickAnchorStop({ anchor: ANCHOR, pool: [p], keptRefs: NONE, onCorridor: ALLOW });
  assert.equal(got?.id, "mp:a");
});

test("returns null rather than padding when the pool is empty", () => {
  assert.equal(
    pickAnchorStop({ anchor: ANCHOR, pool: [], keptRefs: NONE, onCorridor: ALLOW }),
    null,
  );
});

test("REFUSES junk-drawer and tautological categories", () => {
  for (const category of ["interest", "urban", "fuel", "overnight"]) {
    const got = pickAnchorStop({
      anchor: ANCHOR,
      pool: [poi({ category })],
      keptRefs: NONE,
      onCorridor: ALLOW,
    });
    assert.equal(got, null, `${category} must not be an opener`);
  }
});

test("REFUSES a place with no category at all", () => {
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [poi({ category: null })],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(got, null);
});

test("REFUSES anything beyond the proximity gate", () => {
  const far = poi({ coords: offset(ANCHOR_NEAR_MI + 10) });
  assert.equal(
    pickAnchorStop({ anchor: ANCHOR, pool: [far], keptRefs: NONE, onCorridor: ALLOW }),
    null,
  );
});

test("REFUSES anything the caller's corridor guard rejects — never a looser test", () => {
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [poi()],
    keptRefs: NONE,
    onCorridor: () => false,
  });
  assert.equal(got, null);
});

test("REFUSES a place the model already kept — by corpus id AND by name", () => {
  const byId = pickAnchorStop({
    anchor: ANCHOR,
    pool: [poi({ id: "mp:dupe" })],
    keptRefs: new Set(["mp:dupe"]),
    onCorridor: ALLOW,
  });
  assert.equal(byId, null);

  const byName = pickAnchorStop({
    anchor: ANCHOR,
    pool: [poi({ id: "mp:x", name: "Live Resolved Place" })],
    keptRefs: new Set(["Live Resolved Place"]),
    onCorridor: ALLOW,
  });
  assert.equal(byName, null);
});

test("prefers the nearer candidate when neither carries a rating (the corpus-wide case)", () => {
  const near = poi({ id: "mp:near", coords: offset(2) });
  const far = poi({ id: "mp:far", coords: offset(12) });
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [far, near],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(got?.id, "mp:near");
});

test("a real rating outranks mere proximity (inert today, correct if ratings land)", () => {
  const nearUnrated = poi({ id: "mp:near", coords: offset(1) });
  const fartherRated = poi({ id: "mp:rated", coords: offset(12), rating: 4.6 });
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [nearUnrated, fartherRated],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(got?.id, "mp:rated");
});

test("prefers a row that will RENDER over a nearer blank one (the atlas_oddities defect)", () => {
  const nearBlank = poi({ id: "mp:blank", coords: offset(1) });
  const fartherRich = poi({ id: "mp:rich", coords: offset(15), hasPhoto: true, hasDescription: true });
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [nearBlank, fartherRich],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(got?.id, "mp:rich");
});

test("richness is a preference, NOT a gate — a blank row still beats no stop", () => {
  const onlyBlank = poi({ id: "mp:blank" });
  const got = pickAnchorStop({
    anchor: ANCHOR,
    pool: [onlyBlank],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(got?.id, "mp:blank");
});

test("selection is deterministic — same inputs, same pick", () => {
  const pool = [poi({ id: "mp:1", coords: offset(3) }), poi({ id: "mp:2", coords: offset(4) })];
  const a = pickAnchorStop({ anchor: ANCHOR, pool, keptRefs: NONE, onCorridor: ALLOW });
  const b = pickAnchorStop({ anchor: ANCHOR, pool, keptRefs: NONE, onCorridor: ALLOW });
  assert.equal(a?.id, b?.id);
});

test("hasStopNearAnchor gates the backfill on real proximity", () => {
  assert.equal(hasStopNearAnchor([offset(2)], ANCHOR), true);
  assert.equal(hasStopNearAnchor([offset(ANCHOR_NEAR_MI + 10)], ANCHOR), false);
  assert.equal(hasStopNearAnchor([], ANCHOR), false);
});

test("the note is strictly positional — it asserts nothing about the place", () => {
  const note = anchorStopNote("Bishop, CA");
  assert.match(note, /Bishop, CA/);
  // No quality/description language that the corpus did not supply.
  assert.doesNotMatch(note, /best|famous|must|worth|great|popular|stunning/i);
});
