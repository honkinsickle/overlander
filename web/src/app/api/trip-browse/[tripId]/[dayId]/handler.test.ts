/**
 * trip-browse handler — the resolvePlaces() delegate + the single-endpoint
 * fallback, through the dependency seam.
 *
 * No network, no DB: `discover` / `fetchFederatedPois` / `resolvePlaces` are all
 * faked. The route (route.ts) has no tests of its own because it is a thin
 * wrapper (validate + cache + fixture + `{ source, places }` shape); the
 * behaviour lives here.
 *
 * The handler cut over to resolvePlaces() unconditionally 2026-09-03 — the
 * TRIP_BROWSE_USE_RESOLVER flag is gone. `USE_FEDERATED_POIS` remains as the
 * orthogonal DATA flag, wired to `include.federated`. `viaLegacy` is retained
 * ONLY as the fallback for a degenerate day with no `dayStart` (resolvePlaces
 * day-corridor needs both endpoints).
 *
 * The (federated-on) tier test drives the REAL resolvePlaces (with faked
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
    useFederated: false,
    supabase: null,
    ...over,
  };
}

// ── FALLBACK: degenerate day with no dayStart → viaLegacy ────────────────
// The only path that still reaches the pre-cutover body. Fixtures sit on END
// (the one endpoint) so the single-point corridor filter keeps them.

test("fallback (no dayStart, federated off): live-only, untagged; resolvePlaces NOT called", async () => {
  let resolverCalls = 0;
  const out = await produceBrowsePlaces(
    params({ dayStart: undefined, useFederated: false }),
    deps({
      discover: async () => [place("L1", END)],
      resolvePlaces: async () => {
        resolverCalls += 1;
        return { places: [], counts: { live: 0, federated: 0, deduped: 0 }, failedSources: [] };
      },
    }),
  );
  assert.deepEqual(out.map((p) => p.id), ["L1"]);
  assert.equal(out[0].source, undefined, "fallback leaves live untagged when federated off");
  assert.equal(resolverCalls, 0, "resolvePlaces not called without both endpoints");
});

test("fallback (no dayStart, federated on): tags live source:'live'; no federated merge (needs both endpoints)", async () => {
  const out = await produceBrowsePlaces(
    params({ dayStart: undefined, useFederated: true, supabase: FAKE_SB }),
    deps({
      discover: async () => [place("L1", END)],
    }),
  );
  const live = out.find((p) => p.id === "L1");
  assert.equal(live?.source, "live", "live tagged when federated on");
  // The corridor RPC can't run without both endpoints, so no master_place rows.
  assert.equal(out.filter((p) => p.source === "master_place").length, 0);
});

// ── resolvePlaces() day-corridor — routing + the include.federated wiring ─

test("federated off: resolvePlaces day-corridor, include.federated=false, NO supabase in scope", async () => {
  let input: ResolvePlacesInput | null = null;
  let liveCalls = 0;
  await produceBrowsePlaces(
    params({ useFederated: false, supabase: null }),
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

test("federated on: include.federated=true AND the supabase client is in scope; enrich never opted in", async () => {
  let input: ResolvePlacesInput | null = null;
  await produceBrowsePlaces(
    params({ useFederated: true, supabase: FAKE_SB }),
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
  // enrich is never opted into (day-scoped browse, like Search).
  assert.equal(got?.enrich, undefined);
});

test("returns resolvePlaces().places verbatim", async () => {
  const out = await produceBrowsePlaces(
    params(),
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

// ── the one behaviour change — Verified before Unverified ────────────────

test("federated on: verified sorts before unverified end-to-end through REAL resolvePlaces", async () => {
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
    params({ useFederated: true, supabase: FAKE_SB }),
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

test("federated on contrast: with only VERIFIED rows, order is pure distance-from-start", async () => {
  // Sanity/negative-control: when the tier is uniform the sort is the legacy
  // distance sort — near before far — so the tier sort above isn't a fluke of
  // some fixed ordering.
  const near = place("mp:N", [-122.0, 45.05], { source: "master_place", verified: "verified" });
  const far = place("mp:F", [-122.0, 45.45], { source: "master_place", verified: "verified" });
  const out = await produceBrowsePlaces(
    params({ useFederated: true, supabase: FAKE_SB }),
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
