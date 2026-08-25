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
  pickGuaranteedStop,
  GUARANTEE_CATEGORIES,
  hasStopNearAnchor,
  anchorStopNote,
  ANCHOR_NEAR_MI,
  pickBackfillStops,
  anchorIsBare,
  corridorStopNote,
  MAX_BACKFILLS_PER_DAY,
  isCityTautology,
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

// ── Multi-anchor (mid-corridor) coverage ────────────────────────────────
// The start-anchor gates above are inherited unchanged by pickBackfillStops;
// these cover only what the multi-anchor layer ADDS — cap, order, dedupe.

const FAR: [number, number] = [-117.0, 37.363]; // ~76mi east of ANCHOR

function anchorAt(coords: [number, number], label: string, kind: "start" | "corridor") {
  return { coords, label, kind };
}

test("fills a mid-corridor city, not just the start", () => {
  const atFar = poi({ id: "mp:far", coords: FAR });
  const picks = pickBackfillStops({
    anchors: [anchorAt(FAR, "Oceanside, CA", "corridor")],
    pool: [atFar],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].kind, "corridor");
  assert.equal(picks[0].anchorLabel, "Oceanside, CA");
});

test("CAPS machine picks per day so key stops stay a signal", () => {
  // Four bare anchors, each with its own qualifying candidate.
  const anchors = [
    anchorAt(ANCHOR, "Start", "start"),
    anchorAt(offset(40), "City A", "corridor"),
    anchorAt(offset(80), "City B", "corridor"),
    anchorAt(offset(120), "City C", "corridor"),
  ];
  const pool = [
    poi({ id: "mp:s", coords: ANCHOR }),
    poi({ id: "mp:a", coords: offset(40) }),
    poi({ id: "mp:b", coords: offset(80) }),
    poi({ id: "mp:c", coords: offset(120) }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW });
  assert.equal(picks.length, MAX_BACKFILLS_PER_DAY);
});

test("when the cap bites it keeps the EARLIEST anchors — an empty morning beats an empty afternoon", () => {
  const anchors = [
    anchorAt(ANCHOR, "Start", "start"),
    anchorAt(offset(40), "Early", "corridor"),
    anchorAt(offset(80), "Late", "corridor"),
  ];
  const pool = [
    poi({ id: "mp:s", coords: ANCHOR }),
    poi({ id: "mp:early", coords: offset(40) }),
    poi({ id: "mp:late", coords: offset(80) }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW });
  assert.deepEqual(picks.map((p) => p.poi.id), ["mp:s", "mp:early"]);
});

test("never features the same POI twice across anchors on one day", () => {
  // One shared candidate sits within range of two adjacent anchors.
  const shared = poi({ id: "mp:shared", coords: offset(2) });
  const picks = pickBackfillStops({
    anchors: [anchorAt(ANCHOR, "A", "corridor"), anchorAt(offset(4), "B", "corridor")],
    pool: [shared],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.equal(picks.length, 1, "the second anchor must not re-pick the first's POI");
});

test("a corridor city with nothing qualifying stays BARE — no padding", () => {
  const picks = pickBackfillStops({
    anchors: [anchorAt(FAR, "Barren, CA", "corridor")],
    pool: [poi({ id: "mp:elsewhere", coords: ANCHOR })], // in range of ANCHOR, not FAR
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.deepEqual(picks, []);
});

test("a bare anchor is skipped without consuming a cap slot", () => {
  const anchors = [
    anchorAt(FAR, "Barren", "corridor"),          // nothing nearby
    anchorAt(ANCHOR, "Served", "corridor"),       // has a candidate
    anchorAt(offset(40), "AlsoServed", "corridor"),
  ];
  const pool = [poi({ id: "mp:1", coords: ANCHOR }), poi({ id: "mp:2", coords: offset(40) })];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW });
  assert.deepEqual(picks.map((p) => p.poi.id), ["mp:1", "mp:2"]);
});

test("anchorIsBare is the inverse of coverage, on the same radius", () => {
  assert.equal(anchorIsBare([offset(2)], ANCHOR), false);
  assert.equal(anchorIsBare([offset(ANCHOR_NEAR_MI + 10)], ANCHOR), true);
  assert.equal(anchorIsBare([], ANCHOR), true);
});

test("corridor and start notes are distinguishable, both strictly positional", () => {
  const start = anchorStopNote("San Diego, CA");
  const corridor = corridorStopNote("Oceanside, CA");
  assert.notEqual(start, corridor);
  assert.match(corridor, /Oceanside, CA/);
  assert.doesNotMatch(corridor, /best|famous|must|worth|great|popular|stunning/i);
});

test("REFUSES a candidate that is just the anchor city itself (the Carson City case)", () => {
  const cityRow = poi({ id: "mp:city", name: "Carson City, Nevada", category: "scenic" });
  const picks = pickBackfillStops({
    anchors: [anchorAt(ANCHOR, "Carson City, NV", "corridor")],
    pool: [cityRow],
    keptRefs: NONE,
    onCorridor: ALLOW,
  });
  assert.deepEqual(picks, []);
});

test("tautology guard is exact, not substring — 'Riverside Park' survives near Riverside", () => {
  assert.equal(isCityTautology("Carson City, Nevada", "Carson City, NV"), true);
  assert.equal(isCityTautology("Carson City", "Carson City, NV"), true);
  assert.equal(isCityTautology("Riverside Park", "Riverside, CA"), false);
  assert.equal(isCityTautology("Top Gun House", "Oceanside, CA"), false);
});

// ── Interest-category guarantee selector (decision D-B, per-city) ────────
// The guarantee is a SIBLING to the opener, not a replacement — same gates and
// rank, but a WIDER category gate (adds `urban`) filtered to what the user
// selected and this anchor is still missing.

/** A guaranteed-stop input with sensible defaults (a `scenic` guarantee). */
function G(over: Partial<Parameters<typeof pickGuaranteedStop>[0]> = {}) {
  return {
    anchor: ANCHOR,
    pool: [] as PoolPOI[],
    keptRefs: NONE,
    onCorridor: ALLOW,
    missingCategories: new Set(["scenic"]),
    ...over,
  };
}

test("GUARANTEE_CATEGORIES is the 6 pool-side categories — wider than the opener set", () => {
  assert.ok(GUARANTEE_CATEGORIES.has("urban"), "urban is the whole point of the wider gate");
  for (const c of ["scenic", "food", "oddity", "attraction", "camping"]) {
    assert.ok(GUARANTEE_CATEGORIES.has(c));
  }
  for (const c of ["interest", "fuel", "overnight"]) {
    assert.ok(!GUARANTEE_CATEGORIES.has(c), `${c} must stay out of the pool guarantee gate`);
  }
});

test("guarantee: picks a candidate whose category is outstanding at the anchor", () => {
  const got = pickGuaranteedStop(G({ pool: [poi({ id: "mp:sc", category: "scenic" })] }));
  assert.equal(got?.id, "mp:sc");
});

test("guarantee: returns null when nothing is outstanding here (empty missing set)", () => {
  const got = pickGuaranteedStop(
    G({ pool: [poi({ category: "scenic" })], missingCategories: new Set() }),
  );
  assert.equal(got, null);
});

test("guarantee: admits `urban` — the gate difference from the opener", () => {
  const town = poi({ id: "mp:u", name: "Old Town District", category: "urban" });
  // The opener refuses urban (a town under its own node is a tautology) ...
  assert.equal(
    pickAnchorStop({ anchor: ANCHOR, pool: [town], keptRefs: NONE, onCorridor: ALLOW }),
    null,
  );
  // ... but a user-selected urban guarantee surfaces a distinct urban POI.
  const got = pickGuaranteedStop(G({ pool: [town], missingCategories: new Set(["urban"]) }));
  assert.equal(got?.id, "mp:u");
});

test("guarantee: refuses interest/fuel/overnight even when named outstanding", () => {
  for (const category of ["interest", "fuel", "overnight"]) {
    const got = pickGuaranteedStop(
      G({ pool: [poi({ category })], missingCategories: new Set([category]) }),
    );
    assert.equal(got, null, `${category} is not a pool guarantee category`);
  }
});

test("guarantee: only the outstanding category qualifies — a food row won't satisfy a scenic miss", () => {
  const got = pickGuaranteedStop(
    G({ pool: [poi({ category: "food" })], missingCategories: new Set(["scenic"]) }),
  );
  assert.equal(got, null);
});

test("guarantee: inherits the shared gates — dedupe, proximity, onCorridor, tautology", () => {
  assert.equal(
    pickGuaranteedStop(G({ pool: [poi({ id: "mp:sc", category: "scenic" })], keptRefs: new Set(["mp:sc"]) })),
    null,
    "deduped by id",
  );
  assert.equal(
    pickGuaranteedStop(G({ pool: [poi({ category: "scenic", coords: offset(ANCHOR_NEAR_MI + 10) })] })),
    null,
    "beyond the proximity gate",
  );
  assert.equal(
    pickGuaranteedStop(G({ pool: [poi({ category: "scenic" })], onCorridor: () => false })),
    null,
    "rejected by the corridor guard",
  );
  assert.equal(
    pickGuaranteedStop(
      G({
        pool: [poi({ id: "mp:c", name: "Carson City, Nevada", category: "urban" })],
        anchorLabel: "Carson City, NV",
        missingCategories: new Set(["urban"]),
      }),
    ),
    null,
    "a town is not the thing to see in itself, even for urban",
  );
});

// ── Two-phase contention: guarantee wins the cap first (Option A) ────────

function guaranteedAnchor(
  coords: [number, number],
  label: string,
  kind: "start" | "corridor",
  missing: string[],
) {
  return { coords, label, kind, missingCategories: new Set(missing) };
}

test("guarantee wins the cap before an opener does (Option A)", () => {
  // One slot, one anchor missing `scenic`, and both a scenic and an opener
  // candidate nearby. The guarantee must claim the slot.
  const anchors = [guaranteedAnchor(ANCHOR, "Start", "start", ["scenic"])];
  const pool = [
    poi({ id: "mp:opener", category: "attraction", coords: offset(1) }),
    poi({ id: "mp:scenic", category: "scenic", coords: offset(2) }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [], max: 1 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].poi.id, "mp:scenic");
  assert.equal(picks[0].guaranteed, true);
  assert.equal(picks[0].category, "scenic");
});

test("per-city: the same category is guaranteed at EACH city passed (D-B density)", () => {
  const anchors = [
    guaranteedAnchor(ANCHOR, "City A", "corridor", ["scenic"]),
    guaranteedAnchor(FAR, "City B", "corridor", ["scenic"]),
  ];
  const pool = [
    poi({ id: "mp:a", category: "scenic", coords: offset(1) }),
    poi({ id: "mp:b", category: "scenic", coords: FAR }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [] });
  assert.equal(picks.length, 2);
  assert.deepEqual(picks.map((p) => p.poi.id).sort(), ["mp:a", "mp:b"]);
  assert.ok(picks.every((p) => p.guaranteed && p.category === "scenic"));
});

test("guarantee and opener share ONE cap — guarantee takes a slot, opener fills the rest", () => {
  const anchors = [
    guaranteedAnchor(ANCHOR, "Start", "start", ["scenic"]),
    guaranteedAnchor(FAR, "City", "corridor", []), // bare, no guarantee
  ];
  const pool = [
    poi({ id: "mp:scenic", category: "scenic", coords: offset(1) }),
    poi({ id: "mp:opener", category: "attraction", coords: FAR }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [] });
  assert.equal(picks.length, 2);
  assert.equal(picks.find((p) => p.guaranteed)?.poi.id, "mp:scenic");
  assert.equal(picks.find((p) => !p.guaranteed)?.poi.id, "mp:opener");
});

test("an anchor served by a guarantee is NOT also given an opener", () => {
  const anchors = [guaranteedAnchor(ANCHOR, "Start", "start", ["scenic"])];
  const pool = [
    poi({ id: "mp:scenic", category: "scenic", coords: offset(1) }),
    poi({ id: "mp:attr", category: "attraction", coords: offset(2) }),
  ];
  const picks = pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [] });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].poi.id, "mp:scenic");
});

test("keptCoords suppresses an opener on a covered anchor (the moved bare check)", () => {
  const anchors = [{ coords: ANCHOR, label: "Start", kind: "start" as const }];
  const pool = [poi({ id: "mp:x", category: "scenic", coords: offset(1) })];
  // A kept stop sits within the radius → the anchor is covered → no opener.
  assert.deepEqual(
    pickBackfillStops({ anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [offset(2)] }),
    [],
  );
  // Kept stop too far → the anchor is bare → the opener fires.
  const bare = pickBackfillStops({
    anchors, pool, keptRefs: NONE, onCorridor: ALLOW,
    keptCoords: [offset(ANCHOR_NEAR_MI + 10)],
  });
  assert.equal(bare.length, 1);
  assert.equal(bare[0].poi.id, "mp:x");
});

test("includeOpeners:false runs the guarantee phase alone", () => {
  const anchors = [
    guaranteedAnchor(ANCHOR, "Start", "start", ["scenic"]),
    guaranteedAnchor(FAR, "City", "corridor", []),
  ];
  const pool = [
    poi({ id: "mp:scenic", category: "scenic", coords: offset(1) }),
    poi({ id: "mp:opener", category: "attraction", coords: FAR }),
  ];
  const picks = pickBackfillStops({
    anchors, pool, keptRefs: NONE, onCorridor: ALLOW, keptCoords: [], includeOpeners: false,
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].poi.id, "mp:scenic");
  assert.equal(picks[0].guaranteed, true);
});
