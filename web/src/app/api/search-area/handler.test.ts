/**
 * search-area handler — the resolvePlaces() delegate, through the dependency seam.
 *
 * No network, no DB, no env: `resolvePlaces` is faked via `deps`. The route
 * (route.ts) has no tests of its own because it is a thin wrapper around this
 * module (parse/validate + cache + response shape); the behaviour lives here.
 *
 * The handler cut over to resolvePlaces() unconditionally 2026-09-03 — the
 * SEARCH_AREA_USE_RESOLVER flag and the pre-cutover live/federated/merge body
 * were removed after TEST parity was verified. So this covers ONE path:
 * resolvePlaces() bbox scope, with NO limit and NO enrich.
 *
 * The tiering test drives the REAL resolvePlaces (with faked internal deps) so
 * the Verified/Unverified sort is exercised end-to-end through the handler, not
 * stubbed. Unit-level tier classification is in resolve-places.test.ts; live
 * end-to-end is verify-search-area-wired.ts.
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
 *  it returns `mp:<uuid>` ids and a real `verified` tier. */
function realContractHydrate(dsByUuid: Record<string, DescSource>) {
  return async (ids: string[]): Promise<BrowsePlace[]> =>
    ids.map((id) =>
      mapMasterPlaceRow(federatedRow(id, dsByUuid[id] ?? null), "camping"),
    );
}

/** resolvePlaces stubbed inert; override in the test that cares. */
function deps(over: Partial<SearchAreaDeps> = {}): SearchAreaDeps {
  return {
    resolvePlaces: async () => ({
      places: [],
      counts: { live: 0, federated: 0, deduped: 0 },
      failedSources: [],
    }),
    ...over,
  };
}

test("calls resolvePlaces with bbox scope, forwards q+categories, passes NEITHER limit NOR enrich", async () => {
  let input: ResolvePlacesInput | null = null;
  await resolveSearchArea(
    { bbox: BBOX, q: null, categories: ["campground", "rv_park"], debug: true },
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

test("free-text is forwarded as scope.query", async () => {
  let input: ResolvePlacesInput | null = null;
  await resolveSearchArea(
    { bbox: BBOX, q: "hot springs", categories: null, debug: false },
    deps({
      resolvePlaces: async (i) => {
        input = i;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  const got = input as ResolvePlacesInput | null;
  assert.equal(got?.scope.kind === "bbox" ? got.scope.query : null, "hot springs");
});

test("returns resolvePlaces output; counts mapped to {live, federated} (deduped dropped)", async () => {
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: false },
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

test("a contained corpus failure surfaces failedSources + message (debug on)", async () => {
  const out = await resolveSearchArea(
    { bbox: BBOX, q: "x", categories: null, debug: true },
    deps({
      resolvePlaces: async () => ({
        places: [place("gpl/live-1")],
        counts: { live: 1, federated: 0, deduped: 0 },
        failedSources: ["corpus"],
        sourceErrors: { corpus: "typesense down" },
      }),
    }),
  );
  assert.deepEqual(out.failedSources, ["corpus"]);
  assert.match(out.sourceErrors.corpus, /typesense down/);
  assert.equal(out.places.length, 1); // live survived
});

test("Verified/Unverified tiering works end-to-end through the REAL resolvePlaces", async () => {
  // deps.resolvePlaces delegates to the REAL resolvePlaces with faked internal
  // deps (real-contract hydrate → real mapMasterPlaceRow), so the tier sort is
  // genuinely exercised, not stubbed.
  const out = await resolveSearchArea(
    { bbox: BBOX, q: null, categories: ["campground"], debug: false },
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

test("#254 category set is forwarded verbatim to the resolver (no facility/recreation_area injected)", async () => {
  let input: ResolvePlacesInput | null = null;
  const camping254 = ["campground", "dispersed_camping", "rv_park", "camping_cabin"];
  await resolveSearchArea(
    { bbox: BBOX, q: null, categories: camping254, debug: false },
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
