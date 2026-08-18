import { test } from "node:test";
import assert from "node:assert/strict";
import { browsePlaceToWaypoint, type CardCtx, type CardStats } from "./card-stats";
import type { BrowsePlace } from "./places";

/** Minimal valid BrowsePlace — every required field filled, every optional
 *  field left off unless a case needs it. */
function place(extra: Partial<BrowsePlace> = {}): BrowsePlace {
  return {
    id: "mp:11111111-1111-1111-1111-111111111111",
    coords: [-122.68, 45.52],
    photoAlt: "Test Place",
    title: "Test Place",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "Add to day",
    ...extra,
  };
}

const ctx: CardCtx = {
  category: "camping",
  dayNumber: 3,
  dayRelative: true,
};

const stats: CardStats = {
  dayTag: "Day 3 / 2.0 mi off",
  cost: { hero: "Adds 12m" },
};

// Task 3 — logistics.hours: per docs/architecture/place-render-model.md §9
// and the pipeline-trace addendum, this is already fetched (PlaceRich.hours)
// and grafted onto the synthesized Waypoint's logistics.hours by
// day-detail-corridor-column.tsx's synth() (:739-741, not touched by this
// pass — already correct). This test locks in browsePlaceToWaypoint's own
// half: hours sourced from a place.stats HOURS entry (the pre-graft value
// synth() starts from before layering the live rich.hours on top).
test("logistics.hours sourced from place.stats HOURS entry", () => {
  const wp = browsePlaceToWaypoint(
    place({ stats: [{ label: "HOURS", value: "Mon-Fri 9a-5p" }] }),
    ctx,
    stats,
  );
  assert.equal(wp.logistics?.hours, "Mon-Fri 9a-5p");
});

test("no HOURS stat → logistics.hours undefined (no fabrication)", () => {
  const wp = browsePlaceToWaypoint(place(), ctx, stats);
  assert.equal(wp.logistics?.hours, undefined);
});

// Task 4 — priceTier: this proves the DOWNSTREAM half (browsePlaceToWaypoint
// already correctly turns place.priceTier into logistics.entry /
// simulator.entryCost via priceTierToEntry — it always did). The bug this
// task fixes is upstream of this function: day-detail-corridor-column.tsx's
// synth() and hydratePlaces() never grafted rich.priceTier onto the
// BrowsePlace/CorridorPlace in the first place, so `place.priceTier` here
// was always undefined for a real corpus tile. See
// docs/architecture/place-pipeline-trace.md §3.
test("priceTier → logistics.entry as repeated $ signs", () => {
  const wp = browsePlaceToWaypoint(place({ priceTier: 2 }), ctx, stats);
  assert.equal(wp.logistics?.entry, "$$");
});

test("priceTier → simulator.entryCost (day-relative only)", () => {
  const wp = browsePlaceToWaypoint(place({ priceTier: 3 }), ctx, stats);
  assert.equal(wp.simulator?.entryCost, "$$$");
});

test("no priceTier → no entry line (never a fabricated price)", () => {
  const wp = browsePlaceToWaypoint(place(), ctx, stats);
  assert.equal(wp.logistics?.entry, undefined);
  assert.equal(wp.simulator?.entryCost, undefined);
});

// Amenities shape translation — this is the last gap in the amenities chain
// per docs/architecture/place-pipeline-trace-amenities-addendum.md: the
// corpus's merged amenities field is a boolean-keyed presence map (per
// normalizeOsm() in data/ingestion/sources/osm.ts), but the slideup reads
// Waypoint.amenities: string[] (display labels). amenitiesToLabels (private
// to card-stats.ts, exercised here through browsePlaceToWaypoint per this
// file's existing convention — priceTierToEntry above is tested the same
// indirect way) is the translator. Each test below isolates one aspect of
// the translator itself; the "real corpus tile" test at the end is the
// integration-level check that the whole path wires end to end.

test("all 6 known amenity keys true → all 6 labels, in the translator's declared order", () => {
  const wp = browsePlaceToWaypoint(
    place({
      amenities: {
        water: true,
        toilet: true,
        shower: true,
        dump_station: true,
        fire_ring: true,
        picnic: true,
      },
    }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, [
    "Water",
    "Toilet",
    "Shower",
    "Dump Station",
    "Fire Ring",
    "Picnic Area",
  ]);
});

test("a single true key → only that label", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { shower: true } }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Shower"]);
});

test("false and absent keys are both omitted — never a 'No X' label", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { water: true, toilet: false } }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Water"]);
});

// Qualifier suffixes — written only by coerceCampgroundAmenities
// (data/ingestion/sources/nps.ts) via a sibling `${key}_qualifier` key.
// This is new behavior added after the original amenities-render-shape fix
// (f85bbcb) — the "NPS amenities gap" scoping report predicted
// amenitiesToLabels would need NO changes to close the NPS gap; adding
// qualifier support (per Adam's decision to keep, not collapse, the
// seasonal distinction) revises that prediction.

test("a seasonal qualifier appends '(seasonal)' to the label", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { water: true, water_qualifier: "seasonal" } }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Water (seasonal)"]);
});

test("a non_potable qualifier appends '(non-potable)' to the label", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { water: true, water_qualifier: "non_potable" } }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Water (non-potable)"]);
});

test("no qualifier key (the year-round/default case) → bare label, no suffix", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { toilet: true } }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Toilet"]);
});

test("a qualifier on a key that isn't itself true is ignored (no dangling '(seasonal)' with no base label)", () => {
  const wp = browsePlaceToWaypoint(
    place({ amenities: { water: false, water_qualifier: "seasonal" } }),
    ctx,
    stats,
  );
  assert.equal(wp.amenities, undefined);
});

test("mixed qualified and unqualified keys in the same object", () => {
  const wp = browsePlaceToWaypoint(
    place({
      amenities: {
        dump_station: true,
        dump_station_qualifier: "seasonal",
        toilet: true,
        water: true,
        water_qualifier: "non_potable",
      },
    }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, [
    "Water (non-potable)",
    "Toilet",
    "Dump Station (seasonal)",
  ]);
});

test("end to end: a real backfilled NPS campground's amenities produce correct qualifier labels", () => {
  // The exact output of coerceCampgroundAmenities (data/ingestion/sources/
  // nps.ts) for the real TEST record fixture in nps.test.ts's "a real full
  // record" case — hardcoded here rather than imported (web/ doesn't import
  // from data/ at runtime, and this keeps the test self-contained), but
  // traceable back to that exact record's raw amenities.
  const wp = browsePlaceToWaypoint(
    place({
      title: "A real NPS campground (post-normalization)",
      amenities: {
        dump_station: true,
        dump_station_qualifier: "seasonal",
        toilet: true, // mixed seasonal+year-round entries → year-round wins, no qualifier
        water: true,
        water_qualifier: "seasonal",
      },
    }),
    ctx,
    stats,
  );
  assert.deepEqual(wp.amenities, ["Water (seasonal)", "Toilet", "Dump Station (seasonal)"]);
});

test("amenities: null → amenities undefined (section hidden, not an empty array)", () => {
  const wp = browsePlaceToWaypoint(place({ amenities: null }), ctx, stats);
  assert.equal(wp.amenities, undefined);
});

test("amenities: {} (all keys absent) → amenities undefined", () => {
  const wp = browsePlaceToWaypoint(place({ amenities: {} }), ctx, stats);
  assert.equal(wp.amenities, undefined);
});

test("no amenities field at all → amenities undefined (no fabrication)", () => {
  const wp = browsePlaceToWaypoint(place(), ctx, stats);
  assert.equal(wp.amenities, undefined);
});

test("unrecognized keys (e.g. bc_parks' array shape, out of scope/inert today) are ignored, not fabricated into labels", () => {
  // NPS's amenities now normalize to this same canonical shape upstream
  // (coerceCampgroundAmenities, data/ingestion/sources/nps.ts) — this case
  // now stands in for any OTHER out-of-scope raw shape reaching this
  // function unexpectedly, not NPS specifically. Revises this test's
  // original framing from the "amenities gap" scoping report.
  const wp = browsePlaceToWaypoint(
    place({
      amenities: {
        camping_types: ["RV", "Tent"],
        facilities: ["Toilet"],
      },
    }),
    ctx,
    stats,
  );
  assert.equal(wp.amenities, undefined);
});

test("end to end: a real corpus tile's amenities reach Waypoint.amenities as display labels", () => {
  // Shape a federated/corpus BrowsePlace would actually carry post-merge —
  // mapMasterPlaceRow passes master_place.amenities through unchanged
  // (federated.ts), so this is resolve_field()'s output shape, not a
  // synthetic one.
  const corpusPlace = place({
    id: "mp:22222222-2222-2222-2222-222222222222",
    title: "Kingman Field Office Dispersed Site",
    overlanderTags: ["blm_land", "dispersed_camping_likely"],
    amenities: { water: true, fire_ring: true, toilet: false },
  });
  const wp = browsePlaceToWaypoint(corpusPlace, ctx, stats);
  assert.deepEqual(wp.amenities, ["Water", "Fire Ring"]);
});
