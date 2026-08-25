/**
 * Integration proof for the overnight→spine-tile link (#279), the piece the
 * pure-helper tests do NOT cover: that `bakeGeneratedDays` actually reads
 * `day.audit.overnightRef`, finds the matching tile among the day's baked
 * tiles, and flags it `isOvernight`. This is the wiring a live TEST audit of
 * post-#279 payloads showed was NOT taking effect (isOvernight absent on every
 * tile) — so this locks that the wired path sets it.
 *
 * Drives the REAL `bakeGeneratedDays` with a fake `pois_along_corridor` client
 * and a `dayRoutes` entry (coords + polyline) so no geocode / routeBetween /
 * network fires. The overnight here is a POOL-HIT (its corpus id is the ref) —
 * the exact case the Silver Strand / Granite Flat payloads were.
 *
 * Run: npx tsx --test src/lib/itinerary/bake-overnight-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bakeGeneratedDays } from "./bake";
import type { ItineraryOutput, DayPlan, DayAudit } from "./schema";
import type { GenerationInput } from "./facts";
import type { DayRoute } from "./audit";

const OVERNIGHT_UUID = "11111111-1111-1111-1111-111111111111";
const OVERNIGHT_TILE_ID = `mp:${OVERNIGHT_UUID}`;

// A remote (mid-Pacific) corridor so `deriveCorridorCities` finds no gazetteer
// city — the tile can't be stripped as node-identical, isolating the marking.
const START: [number, number] = [-140, 35];
const MID: [number, number] = [-140, 35.5];
const END: [number, number] = [-140, 36];

/** One `pois_along_corridor` row → one corpus tile with id `mp:<uuid>`. */
function fakeClient(rows: Array<Record<string, unknown>>) {
  return {
    rpc: async (name: string) =>
      name === "pois_along_corridor"
        ? { data: rows, error: null }
        : { data: null, error: null },
  } as unknown as Parameters<typeof bakeGeneratedDays>[2];
}

function corpusRow(id: string, name: string, coords: [number, number]) {
  return {
    id,
    canonical_name: name,
    primary_category: "campground",
    lng: coords[0],
    lat: coords[1],
    prominence_score: 0.5,
    mvum_corridor: null,
    overlander_tags: null,
    amenities: null,
    hours: null,
    contact: null,
    access: null,
    services: null,
    capacity: null,
    seasonality: null,
    cell_signal: null,
    geometry_polygon: null,
    description: "beachfront sites",
    attribution: null,
  };
}

function day(overnightName: string | null, overnightRef: string | null): DayPlan {
  const audit: DayAudit = {
    distanceConfidence: "measured",
    statedDistanceMi: 50,
    statedDriveHours: 1,
    flags: [],
    resolvedPlaces: [],
    overnightRef,
  };
  return {
    n: 1,
    date: "2026-08-25",
    startPlace: "Start",
    endPlace: "End",
    type: "drive",
    distanceMi: 50,
    driveHours: 1,
    weather: "clear",
    rationale: "test",
    keyStops: [],
    overnight: { name: overnightName, desc: null, type: "camp", rationale: "beachfront sites" },
    logistics: "",
    obligations: [],
    audit,
  };
}

const DAY_ROUTES: DayRoute[] = [
  { n: 1, startCoord: START, endCoord: END, polyline: [START, MID, END] },
];
const INPUT = {} as unknown as GenerationInput; // bake never reads `input`

test("bakeGeneratedDays flags the overnight's corpus tile isOvernight when overnightRef matches", async () => {
  const audited = {
    days: [day("Silver Strand Campground", OVERNIGHT_TILE_ID)],
  } as unknown as ItineraryOutput;

  const baked = await bakeGeneratedDays(
    audited,
    INPUT,
    fakeClient([corpusRow(OVERNIGHT_UUID, "Silver Strand Campground", MID)]),
    DAY_ROUTES,
  );

  const marked = baked[0].segmentSuggestions.filter((t) => t.isOvernight);
  assert.equal(marked.length, 1, "exactly one tile flagged isOvernight");
  assert.equal(marked[0].id, OVERNIGHT_TILE_ID);
  assert.equal(marked[0].curated, true, "featured on the spine, not demoted");
});

test("bakeGeneratedDays flags NOTHING when overnightRef is null (desc-only fallback)", async () => {
  const audited = {
    days: [day(null, null)],
  } as unknown as ItineraryOutput;

  const baked = await bakeGeneratedDays(
    audited,
    INPUT,
    fakeClient([corpusRow(OVERNIGHT_UUID, "Silver Strand Campground", MID)]),
    DAY_ROUTES,
  );

  assert.equal(
    baked[0].segmentSuggestions.filter((t) => t.isOvernight).length,
    0,
    "no tile is flagged when there is no overnight ref",
  );
});
