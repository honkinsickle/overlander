/**
 * Locks the Mapbox Search Box category-endpoint source shape + guards.
 *
 * Adam's task (2026-08-25): swap fuel discovery from Google Places to Mapbox
 * Search Box in the resolvePlaces() unification. The general web-client browse
 * surfaces (B: /api/trip-browse, C: /api/search-area) route fuel through this
 * source, other categories continue on `googlePlacesSource`.
 *
 * Run: cd web && npx tsx --test src/lib/discovery/mapbox-search-box.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  featureToSourceResult,
  buildFuelCategoryUrl,
  createMapboxSearchBoxSource,
  mapboxSearchBoxSource,
  type MapboxCategoryFeature,
} from "./mapbox-search-box";

const BBOX: [number, number, number, number] = [-120, 36, -119, 37];
const TOKEN = "test-token";

function fakeFeature(overrides: Partial<MapboxCategoryFeature> = {}): MapboxCategoryFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-119.5, 36.5] },
    properties: {
      mapbox_id: "dXJuOm1ieHBvaTphYmMxMjM",
      name: "Chevron",
      feature_type: "poi",
      full_address: "123 Main St, Fresno, CA",
      poi_category: ["gas_station"],
      poi_category_ids: ["gas_station"],
    },
    ...overrides,
  };
}

// ── URL builder ────────────────────────────────────────────────────

test("buildFuelCategoryUrl: emits Mapbox Search Box category endpoint with bbox + limit + token", () => {
  const url = buildFuelCategoryUrl(BBOX, TOKEN);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://api.mapbox.com/search/searchbox/v1/category/gas_station");
  assert.equal(u.searchParams.get("bbox"), "-120,36,-119,37");
  assert.equal(u.searchParams.get("access_token"), TOKEN);
  assert.equal(u.searchParams.get("limit"), "25");
});

// ── Feature parser ─────────────────────────────────────────────────

test("featureToSourceResult: maps a full feature to a fuel SourceResult with sourceId=mapbox", () => {
  const r = featureToSourceResult(fakeFeature());
  assert.equal(r.sourceId, "mapbox");
  assert.equal(r.category, "fuel");
  assert.equal(r.externalId, "dXJuOm1ieHBvaTphYmMxMjM");
  assert.deepEqual(r.coords, [-119.5, 36.5]); // [lng, lat] preserved
  assert.equal(r.title, "Chevron");
  assert.equal(r.address, "123 Main St, Fresno, CA");
});

test("featureToSourceResult: falls back to address when full_address missing", () => {
  const r = featureToSourceResult(
    fakeFeature({
      properties: {
        mapbox_id: "x",
        name: "Shell",
        feature_type: "poi",
        address: "500 Broadway",
        poi_category: ["gas_station"],
        poi_category_ids: ["gas_station"],
      },
    }),
  );
  assert.equal(r.address, "500 Broadway");
});

test("featureToSourceResult: no address on either field → address undefined (never fabricated)", () => {
  const r = featureToSourceResult(
    fakeFeature({
      properties: {
        mapbox_id: "y",
        name: "Independent Gas",
        feature_type: "poi",
        poi_category: ["gas_station"],
        poi_category_ids: ["gas_station"],
      },
    }),
  );
  assert.equal(r.address, undefined);
});

// ── Category-filter guard ──────────────────────────────────────────

test("query returns [] for non-fuel categories (this source is fuel-only today)", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () => {
      throw new Error("fetch must NOT be called when the request has no fuel");
    },
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: ["food", "scenic"] });
  assert.deepEqual(r, []);
});

test("query returns [] with categories=[]", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () => {
      throw new Error("fetch must NOT be called on empty categories");
    },
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: [] });
  assert.deepEqual(r, []);
});

// ── No-token guard ─────────────────────────────────────────────────

test("query returns [] when the Mapbox token is unset (no fetch)", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () => {
      throw new Error("fetch must NOT be called without a token");
    },
    tokenFn: () => undefined,
  });
  const r = await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.deepEqual(r, []);
});

// ── HTTP failure paths ─────────────────────────────────────────────

test("query returns [] when Mapbox returns non-OK", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () =>
      new Response("boom", { status: 500, statusText: "Internal Server Error" }),
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.deepEqual(r, []);
});

test("query returns [] when fetch throws (network error)", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () => {
      throw new Error("network down");
    },
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.deepEqual(r, []);
});

// ── Happy path ─────────────────────────────────────────────────────

test("query returns SourceResult[] with sourceId=mapbox for a valid response", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            fakeFeature(),
            fakeFeature({
              properties: {
                mapbox_id: "second",
                name: "76 Station",
                feature_type: "poi",
                full_address: "1 Freeway Rd",
                poi_category: ["gas_station"],
                poi_category_ids: ["gas_station"],
              },
              geometry: { type: "Point", coordinates: [-119.7, 36.7] },
            }),
          ],
        }),
        { status: 200 },
      ),
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.equal(r.length, 2);
  assert.equal(r[0].sourceId, "mapbox");
  assert.equal(r[0].title, "Chevron");
  assert.equal(r[0].category, "fuel");
  assert.equal(r[1].title, "76 Station");
  assert.deepEqual(r[1].coords, [-119.7, 36.7]);
});

test("query passes the bbox + token through to fetch verbatim", async () => {
  let calledUrl: string | null = null;
  const source = createMapboxSearchBoxSource({
    fetchImpl: async (input) => {
      calledUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200 },
      );
    },
    tokenFn: () => TOKEN,
  });
  await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.ok(calledUrl, "expected fetch to be called");
  const u = new URL(calledUrl!);
  assert.equal(u.searchParams.get("bbox"), "-120,36,-119,37");
  assert.equal(u.searchParams.get("access_token"), TOKEN);
});

test("query handles an empty features[] response gracefully", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200 },
      ),
    tokenFn: () => TOKEN,
  });
  const r = await source.query({ bbox: BBOX, categories: ["fuel"] });
  assert.deepEqual(r, []);
});

// ── Auto/Repair: primary-category routing (2026-09-03) ─────────────

/** Records every category id the source fetches, returning one feature each. */
function recordingSource(catsHit: string[]) {
  return createMapboxSearchBoxSource({
    fetchImpl: async (input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      // .../v1/category/<id>
      const id = url.pathname.split("/").pop()!;
      catsHit.push(id);
      return new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            fakeFeature({
              properties: {
                mapbox_id: `mb-${id}`,
                name: `result-${id}`,
                feature_type: "poi",
                poi_category: [id],
                poi_category_ids: [id],
              },
            }),
          ],
        }),
        { status: 200 },
      );
    },
    tokenFn: () => TOKEN,
  });
}

test("query with no primaryCategories falls back to gas_station (day-corridor behaviour preserved)", async () => {
  const hits: string[] = [];
  const r = await recordingSource(hits).query({ bbox: BBOX, categories: ["fuel"] });
  assert.deepEqual(hits, ["gas_station"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].category, "fuel");
});

test("query routes car_repair → auto_repair and car_wash → car_wash (NOT repair_shop)", async () => {
  const hits: string[] = [];
  const r = await recordingSource(hits).query({
    bbox: BBOX,
    categories: ["fuel"],
    primaryCategories: ["car_repair", "car_wash"],
  });
  assert.deepEqual(hits.sort(), ["auto_repair", "car_wash"]);
  assert.ok(!hits.includes("repair_shop"), "repair_shop must never be queried");
  assert.ok(!hits.includes("gas_station"), "an auto request must not hit gas_station");
  // Auto results carry the fuel parent category (no car_repair slide key).
  assert.equal(r.length, 2);
  assert.ok(r.every((p) => p.category === "fuel"));
});

test("query routes car_repair alone → auto_repair only", async () => {
  const hits: string[] = [];
  await recordingSource(hits).query({
    bbox: BBOX,
    categories: ["fuel"],
    primaryCategories: ["car_repair"],
  });
  assert.deepEqual(hits, ["auto_repair"]);
});

test("query with gas primaries hits gas_station only (fuel behaviour unchanged)", async () => {
  const hits: string[] = [];
  await recordingSource(hits).query({
    bbox: BBOX,
    categories: ["fuel"],
    primaryCategories: ["gas_station", "truck_stop", "ev_charging"],
  });
  assert.deepEqual(hits, ["gas_station"]);
});

test("query still returns [] for a non-fuel slide key even when primaries are auto", async () => {
  const source = createMapboxSearchBoxSource({
    fetchImpl: async () => {
      throw new Error("fetch must NOT be called for a non-fuel slide key");
    },
    tokenFn: () => TOKEN,
  });
  const r = await source.query({
    bbox: BBOX,
    categories: ["food"],
    primaryCategories: ["car_repair"],
  });
  assert.deepEqual(r, []);
});

// ── Default export ─────────────────────────────────────────────────

test("mapboxSearchBoxSource: default export has id=mapbox and a query() method", () => {
  assert.equal(mapboxSearchBoxSource.id, "mapbox");
  assert.equal(typeof mapboxSearchBoxSource.query, "function");
});
