/**
 * search-area handler — both flag states, through the dependency seam.
 *
 * No network, no DB, no env: every dependency is faked via `deps`. The route
 * (route.ts) has no tests of its own because it is a thin wrapper around this
 * module (parse/validate + cache + response shape); the behaviour lives here.
 *
 *   - flag OFF → the exact pre-cutover live/federated/merge body.
 *   - flag ON  → resolvePlaces(), with NO limit and NO enrich.
 *
 * The flag-ON tiering test drives the REAL resolvePlaces (with faked internal
 * deps) so the Verified/Unverified sort is exercised end-to-end through the
 * handler, not stubbed. Unit-level tier classification is in
 * resolve-places.test.ts; live end-to-end is verify-search-area-wired.ts.
 *
 * Run: cd web && npx tsx --test src/app/api/search-area/handler.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSearchArea, type SearchAreaDeps } from "./handler";
import {
  resolvePlaces as realResolvePlaces,
  type ResolvePlacesInput,
} from "@/lib/places/resolve-places";
import {
  mapMasterPlaceRow,
  type MasterPlaceRow,
} from "@/lib/trip-browse/federated";
import type { BrowsePlace } from "@/lib/trip-browse/places";

const BBOX: [number, number, number, number] = [-124, 44, -121, 46.5];
const UUID = "531b1c71-96f2-4002-bc4e-cc1b6db49dc1";
const UUID2 = "7af6a3d1-3a16-479c-926e-3eee7a2ba65c";
const UUID3 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function place(id: string, extra: Partial<BrowsePlace> = {}): BrowsePlace {
  return {
    id,
    coords: [-122.68, 45.52],
    photoAlt: "P",
    title: "P",
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

type DescSource = "source" | "template" | "llm" | null;

/** A federated row shaped as the export view / RPC hands it to
 *  mapMasterPlaceRow — carries description_source, which drives the tier. */
function federatedRow(uuid: string, description_source: DescSource): MasterPlaceRow {
  return {
    id: uuid,
    canonical_name: `place-${uuid.slice(0, 4)}`,
    primary_category: "campground",
    lng: -122.68,
    lat: 45.52,
    prominence_score: 0,
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
    description: null,
    attribution: null,
    description_source,
  };
}

/** Real-contract fake hydrate: runs ids through the REAL mapMasterPlaceRow, so
 *  it returns `mp:<uuid>` ids and a real `verified` tier (the same helper shape
 *  resolve-places.test.ts uses). */
function realContractHydrate(dsByUuid: Record<string, DescSource>) {
  return async (ids: string[]): Promise<BrowsePlace[]> =>
    ids.map((id) =>
      mapMasterPlaceRow(federatedRow(id, dsByUuid[id] ?? null), "camping"),
    );
}

/** All deps stubbed inert; override what a test cares about. */
function deps(over: Partial<SearchAreaDeps> = {}): SearchAreaDeps {
  return {
    discover: async () => [],
    search: async () => [],
    hydratePlacesByIds: async () => [],
    resolvePlaces: async () => ({
      places: [],
      counts: { live: 0, federated: 0, deduped: 0 },
      failedSources: [],
    }),
    ...over,
  };
}

// ── FLAG OFF: preserves the pre-cutover body ────────────────────────────

test("flag off: free-text routes live to Google text search and searches corpus with q", async () => {
  let discoverArg: Record<string, unknown> | null = null;
  let searchArg: Record<string, unknown> | null = null;
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "hot springs", categories: null, debug: false, useResolver: false },
    deps({
      discover: async (a) => {
        discoverArg = a as unknown as Record<string, unknown>;
        return [place("gpl/x", { title: "Live" })];
      },
      search: async (p) => {
        searchArg = p as unknown as Record<string, unknown>;
        return [{ id: UUID } as never];
      },
      hydratePlacesByIds: async () => [place(`mp:${UUID}`, { title: "Fed" })],
    }),
  );
  // Cast to the declared union (mutation happens in a callback, so CFA would
  // otherwise narrow these to `null`).
  const dArg = discoverArg as Record<string, unknown> | null;
  const sArg = searchArg as Record<string, unknown> | null;
  assert.equal(dArg?.textQuery, "hot springs");
  assert.deepEqual(dArg?.categories, []);
  assert.equal(sArg?.query, "hot springs");
  // live then federated
  assert.deepEqual(out.places.map((p) => p.title), ["Live", "Fed"]);
  assert.deepEqual(out.counts, { live: 1, federated: 1 });
});

test("flag off: category tiles fan out live over the mapped slide keys", async () => {
  let discoverArg: { categories?: unknown; sources?: unknown[] } | null = null;
  await resolveSearchArea(
    {
      bbox: BBOX,
      q: null,
      categories: ["campground", "rv_park"],
      debug: false,
      useResolver: false,
    },
    deps({
      discover: async (a) => {
        discoverArg = a as unknown as { categories?: unknown; sources?: unknown[] };
        return [];
      },
    }),
  );
  // campground + rv_park both map to the 'camping' slide bucket (deduped).
  const dArg = discoverArg as { categories?: unknown; sources?: unknown[] } | null;
  assert.deepEqual(dArg?.categories, ["camping"]);
  // The 6-source fanout order is preserved (mapbox added 2026-08-25 as the
  // fuel-only provider; it's still in the list even when categories don't
  // include fuel — its own query() short-circuits to [] in that case).
  assert.equal((dArg?.sources ?? []).length, 6);
});

test("flag off: an all-overland category set makes NO live call, federated still runs", async () => {
  let discoverCalls = 0;
  let searchCalls = 0;
  await resolveSearchArea(
    {
      bbox: BBOX,
      q: null,
      // dispersed_camping/water have no LIVE_SLIDE_FOR_PRIMARY entry.
      categories: ["dispersed_camping", "water"],
      debug: false,
      useResolver: false,
    },
    deps({
      discover: async () => {
        discoverCalls++;
        return [];
      },
      search: async () => {
        searchCalls++;
        return [];
      },
    }),
  );
  assert.equal(discoverCalls, 0);
  assert.equal(searchCalls, 1);
});

test("flag off: merge is live-then-federated, first occurrence per id wins", async () => {
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: false, useResolver: false },
    deps({
      discover: async () => [place("dup", { title: "Live-dup" }), place("live-only")],
      search: async () => [{ id: "dup" } as never],
      hydratePlacesByIds: async () => [place("dup", { title: "Fed-dup" })],
    }),
  );
  const dup = out.places.filter((p) => p.id === "dup");
  assert.equal(dup.length, 1);
  assert.equal(dup[0].title, "Live-dup"); // live kept
  assert.equal(out.places.length, 2);
});

test("flag off: a federated throw is contained as 'corpus' with a message; live still returns", async () => {
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: true, useResolver: false },
    deps({
      discover: async () => [place("live-1")],
      search: async () => {
        throw new Error("typesense down");
      },
    }),
  );
  assert.deepEqual(out.failedSources, ["corpus"]);
  assert.match(out.sourceErrors.corpus, /typesense down/);
  assert.equal(out.places.length, 1); // live survived
});

// ── FLAG ON: resolvePlaces(), no limit, no enrich ───────────────────────

test("flag on: calls resolvePlaces with bbox scope, forwards q+categories, passes NEITHER limit NOR enrich", async () => {
  let input: ResolvePlacesInput | null = null;
  await resolveSearchArea(
    {
      bbox: BBOX,
      q: null,
      categories: ["campground", "rv_park"],
      debug: true,
      useResolver: true,
    },
    deps({
      resolvePlaces: async (i) => {
        input = i;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  const got = input as ResolvePlacesInput | null;
  assert.equal(got?.scope.kind, "bbox");
  assert.deepEqual(
    got?.scope.kind === "bbox" ? got.scope.categories : null,
    ["campground", "rv_park"],
  );
  assert.equal(got?.scope.kind === "bbox" ? got.scope.query : "x", undefined);
  // The two load-bearing findings from the plan:
  assert.equal(got?.limit, undefined, "must NOT pass limit");
  assert.equal(got?.enrich, undefined, "must NOT pass enrich (#257)");
  assert.equal(got?.includeErrorDetail, true); // debug gate forwarded
});

test("flag on: does not touch discover / search / hydrate directly", async () => {
  let touched = 0;
  await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: false, useResolver: true },
    deps({
      discover: async () => {
        touched++;
        return [];
      },
      search: async () => {
        touched++;
        return [];
      },
      hydratePlacesByIds: async () => {
        touched++;
        return [];
      },
      resolvePlaces: async () => ({
        places: [place("mp:1")],
        counts: { live: 0, federated: 1, deduped: 0 },
        failedSources: [],
      }),
    }),
  );
  assert.equal(touched, 0);
});

test("flag on: returns resolvePlaces output; counts mapped to {live, federated} (deduped dropped)", async () => {
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: false, useResolver: true },
    deps({
      resolvePlaces: async () => ({
        places: [place("mp:1", { title: "A" })],
        counts: { live: 2, federated: 3, deduped: 1 },
        failedSources: ["corpus"],
      }),
    }),
  );
  assert.deepEqual(out.places.map((p) => p.title), ["A"]);
  assert.deepEqual(out.counts, { live: 2, federated: 3 });
  assert.deepEqual(Object.keys(out.counts).sort(), ["federated", "live"]); // no deduped
  assert.deepEqual(out.failedSources, ["corpus"]);
});

test("flag on: Verified/Unverified tiering works end-to-end through the REAL resolvePlaces", async () => {
  // deps.resolvePlaces delegates to the REAL resolvePlaces with faked internal
  // deps (real-contract hydrate → real mapMasterPlaceRow), so the tier sort is
  // genuinely exercised, not stubbed.
  const out = await resolveSearchArea(
    { bbox: BBOX, q: null, categories: ["campground"], debug: false, useResolver: true },
    deps({
      resolvePlaces: (i) =>
        realResolvePlaces({
          ...i,
          include: { live: false }, // corpus-only, deterministic
          deps: {
            search: async () => [
              { id: UUID } as never, // template → unverified
              { id: UUID2 } as never, // source → verified
              { id: UUID3 } as never, // llm → verified
            ],
            hydratePlacesByIds: realContractHydrate({
              [UUID]: "template",
              [UUID2]: "source",
              [UUID3]: "llm",
            }),
          },
        }),
    }),
  );
  // Verified (source, llm) first, unverified (template) last — and real mp: ids.
  assert.deepEqual(
    out.places.map((p) => p.verified),
    ["verified", "verified", "unverified"],
  );
  assert.deepEqual(
    out.places.map((p) => p.id),
    [`mp:${UUID2}`, `mp:${UUID3}`, `mp:${UUID}`],
  );
});

test("flag on: #254 category set is forwarded verbatim to the resolver (no facility/recreation_area injected)", async () => {
  let input: ResolvePlacesInput | null = null;
  const camping254 = ["campground", "dispersed_camping", "rv_park", "camping_cabin"];
  await resolveSearchArea(
    { bbox: BBOX, q: null, categories: camping254, debug: false, useResolver: true },
    deps({
      resolvePlaces: async (i) => {
        input = i;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  const got = input as ResolvePlacesInput | null;
  const cats = got?.scope.kind === "bbox" ? got.scope.categories : null;
  assert.deepEqual(cats, camping254);
  assert.ok(!cats?.includes("facility"));
  assert.ok(!cats?.includes("recreation_area"));
});
