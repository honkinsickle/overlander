/**
 * trip-browse handler — all four flag combinations, through the dependency seam.
 *
 * No network, no DB: `discover` / `fetchFederatedPois` / `resolvePlaces` are all
 * faked. The route (route.ts) has no tests of its own because it is a thin
 * wrapper (validate + cache + fixture + `{ source, places }` shape); the
 * behaviour lives here.
 *
 * Two orthogonal flags → four combinations:
 *   (off, off) legacy live-only  ·  (off, on) legacy live+federated
 *   (on,  off) resolvePlaces federated-off  ·  (on, on) resolvePlaces federated-on
 *
 * The (on, on) case additionally drives the REAL resolvePlaces (with faked
 * internal deps) to prove the Verified-before-Unverified sort end-to-end — the
 * one behaviour change the cutover plan flagged.
 *
 * Run: `npm run -w web test`. Passing this file's literal path to `--test`
 * collects zero tests — see the note in the sibling route.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  produceBrowsePlaces,
  type BrowseDeps,
  type BrowseParams,
} from "./handler";
import {
  resolvePlaces as realResolvePlaces,
  type ResolvePlacesInput,
} from "@/lib/places/resolve-places";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

// A vertical day segment; all fixture places sit ON it (0 mi off-route) so the
// real corridor filter keeps them. `points` mirrors the route: [dayEnd, dayStart].
const START: [number, number] = [-122.0, 45.0];
const END: [number, number] = [-122.0, 45.5];
const POINTS: [number, number][] = [END, START];
const FAKE_SB = {} as unknown as SupabaseClient;

function place(
  id: string,
  coords: [number, number],
  extra: Partial<BrowsePlace> = {},
): BrowsePlace {
  return {
    id,
    coords,
    category: "scenic",
    photoAlt: "P",
    title: id,
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

function deps(over: Partial<BrowseDeps> = {}): BrowseDeps {
  return {
    discover: async () => [],
    fetchFederatedPois: async () => [],
    resolvePlaces: async () => ({
      places: [],
      counts: { live: 0, federated: 0, deduped: 0 },
      failedSources: [],
    }),
    ...over,
  };
}

function params(over: Partial<BrowseParams> = {}): BrowseParams {
  return {
    requested: ["scenic"] as SlideCategoryKey[],
    dayStart: START,
    dayEnd: END,
    points: POINTS,
    useResolver: false,
    useFederated: false,
    supabase: null,
    ...over,
  };
}

// ── FLAG OFF (legacy body) ──────────────────────────────────────────────

test("(off, off): legacy live-only, untagged, no federated / no resolver call", async () => {
  let fedCalls = 0;
  let resolverCalls = 0;
  const out = await produceBrowsePlaces(
    params({ useResolver: false, useFederated: false }),
    deps({
      discover: async () => [place("L1", START)],
      fetchFederatedPois: async () => {
        fedCalls += 1;
        return [];
      },
      resolvePlaces: async () => {
        resolverCalls += 1;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  assert.deepEqual(out.map((p) => p.id), ["L1"]);
  assert.equal(out[0].source, undefined, "legacy off leaves live untagged");
  assert.equal(fedCalls, 0);
  assert.equal(resolverCalls, 0);
});

test("(off, on): legacy tags live source:'live' and merges federated", async () => {
  let fedCalls = 0;
  const out = await produceBrowsePlaces(
    params({ useResolver: false, useFederated: true, supabase: FAKE_SB }),
    deps({
      discover: async () => [place("L1", START)],
      fetchFederatedPois: async () => {
        fedCalls += 1;
        return [place("mp:F1", END, { source: "master_place" })];
      },
    }),
  );
  assert.equal(fedCalls, 1, "federated merged when USE_FEDERATED_POIS on");
  const live = out.find((p) => p.id === "L1");
  assert.equal(live?.source, "live", "live tagged when federated on");
  assert.ok(out.some((p) => p.id === "mp:F1"), "federated row present");
});

// ── FLAG ON (resolvePlaces) — routing + the include.federated wiring ─────

test("(on, off): resolvePlaces day-corridor, include.federated=false, NO supabase in scope", async () => {
  let input: ResolvePlacesInput | null = null;
  let liveCalls = 0;
  await produceBrowsePlaces(
    params({ useResolver: true, useFederated: false, supabase: null }),
    deps({
      discover: async () => {
        liveCalls += 1;
        return [];
      },
      resolvePlaces: async (i) => {
        input = i;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  const got = input as ResolvePlacesInput | null;
  assert.equal(got?.scope.kind, "day-corridor");
  assert.equal(got?.include?.federated, false, "USE_FEDERATED_POIS off → federated:false");
  assert.equal(
    got?.scope.kind === "day-corridor" ? got.scope.supabase : "x",
    undefined,
    "no client passed when federated off",
  );
  if (got?.scope.kind === "day-corridor") {
    assert.deepEqual(got.scope.start, START);
    assert.deepEqual(got.scope.end, END);
    assert.deepEqual(got.scope.categories, ["scenic"]);
  }
  assert.equal(liveCalls, 0, "resolver path must not call discover directly");
});

test("(on, on): include.federated=true AND the supabase client is in scope", async () => {
  let input: ResolvePlacesInput | null = null;
  await produceBrowsePlaces(
    params({ useResolver: true, useFederated: true, supabase: FAKE_SB }),
    deps({
      resolvePlaces: async (i) => {
        input = i;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  const got = input as ResolvePlacesInput | null;
  assert.equal(got?.include?.federated, true);
  assert.equal(
    got?.scope.kind === "day-corridor" ? got.scope.supabase : null,
    FAKE_SB,
  );
  // Orthogonality proof: enrich is never opted into (day-scoped browse, like Search).
  assert.equal(got?.enrich, undefined);
});

test("(on): returns resolvePlaces().places verbatim", async () => {
  const out = await produceBrowsePlaces(
    params({ useResolver: true }),
    deps({
      resolvePlaces: async () => ({
        places: [place("A", START), place("B", END)],
        counts: { live: 1, federated: 1, deduped: 0 },
        failedSources: [],
      }),
    }),
  );
  assert.deepEqual(out.map((p) => p.id), ["A", "B"]);
});

test("(on) with missing dayStart falls back to the legacy body", async () => {
  let liveCalls = 0;
  let resolverCalls = 0;
  await produceBrowsePlaces(
    params({ useResolver: true, dayStart: undefined }),
    deps({
      discover: async () => {
        liveCalls += 1;
        return [];
      },
      resolvePlaces: async () => {
        resolverCalls += 1;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  assert.equal(liveCalls, 1, "degrades to legacy discover when dayStart absent");
  assert.equal(resolverCalls, 0, "resolvePlaces not called without both endpoints");
});

// ── (on, on): the one behaviour change — Verified before Unverified ──────

test("(on, on): verified sorts before unverified end-to-end through REAL resolvePlaces", async () => {
  // deps.resolvePlaces delegates to the REAL resolvePlaces with faked internal
  // deps so the day-corridor merge + corridor filter + tier sort all run.
  // Unverified is CLOSER to start, verified is FARTHER — so if the tier sort
  // works, the verified (farther) one must still come first (tier beats distance).
  const unverifiedNear = place("mp:U", [-122.0, 45.05], {
    source: "master_place",
    verified: "unverified",
  });
  const verifiedFar = place("mp:V", [-122.0, 45.45], {
    source: "master_place",
    verified: "verified",
  });
  const out = await produceBrowsePlaces(
    params({ useResolver: true, useFederated: true, supabase: FAKE_SB }),
    deps({
      resolvePlaces: (i) =>
        realResolvePlaces({
          ...i,
          deps: {
            discover: async () => [],
            fetchFederatedPois: async () => [unverifiedNear, verifiedFar],
          },
        }),
    }),
  );
  assert.deepEqual(
    out.map((p) => p.id),
    ["mp:V", "mp:U"],
    "verified-far ranks before unverified-near (tier beats distance)",
  );
});

test("(on, on) contrast: with only VERIFIED rows, order is pure distance-from-start", async () => {
  // Sanity/negative-control: when the tier is uniform the sort is the legacy
  // distance sort — near before far — so the tier sort above isn't a fluke of
  // some fixed ordering.
  const near = place("mp:N", [-122.0, 45.05], { source: "master_place", verified: "verified" });
  const far = place("mp:F", [-122.0, 45.45], { source: "master_place", verified: "verified" });
  const out = await produceBrowsePlaces(
    params({ useResolver: true, useFederated: true, supabase: FAKE_SB }),
    deps({
      resolvePlaces: (i) =>
        realResolvePlaces({
          ...i,
          deps: {
            discover: async () => [],
            fetchFederatedPois: async () => [far, near], // deliberately far-first
          },
        }),
    }),
  );
  assert.deepEqual(out.map((p) => p.id), ["mp:N", "mp:F"], "near before far when tier is uniform");
});
