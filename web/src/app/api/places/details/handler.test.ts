/**
 * places/details handler — both flag states, through the dependency seam.
 *
 * No network: `placeDetails` / `enrichByGoogleId` and the cache are all faked.
 * The route (route.ts) has no tests of its own because it is a thin wrapper
 * (parse/validate + cache + `{ details }` shape); the behaviour lives here.
 *
 *   - flag OFF → `viaLegacy`: the pre-cutover inline batched fetch loop.
 *   - flag ON  → `viaResolver`: cache-misses delegated to `enrichByGoogleId()`.
 *
 * The centrepiece is the PARITY pair: OFF and ON must produce the SAME `details`
 * map AND leave the cache in the SAME state for the same inputs. That is the
 * flag-off-is-unchanged proof (plus the flag-on-matches proof) at unit level.
 *
 * Run: cd web && npx tsx --test src/app/api/places/details/handler.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchDetailsMap, type CacheOps, type PlaceDetailsDeps } from "./handler";
import type { PlaceRich } from "@/lib/discovery/google-places";

const A = "ChIJ_a";
const B = "ChIJ_b";
const C = "ChIJ_c";

/** In-memory cache with the route's envelope semantics + call spies. */
function makeCache(seed: Record<string, PlaceRich | null> = {}) {
  const store = new Map<string, PlaceRich | null>(Object.entries(seed));
  const gets: string[] = [];
  const sets: [string, PlaceRich | null][] = [];
  const ops: CacheOps = {
    get: (id) => {
      gets.push(id);
      return store.has(id) ? { hit: true, value: store.get(id) ?? null } : null;
    },
    set: (id, value) => {
      sets.push([id, value]);
      store.set(id, value);
    },
  };
  return { ops, store, gets, sets };
}

function deps(over: Partial<PlaceDetailsDeps> = {}): PlaceDetailsDeps {
  return {
    placeDetails: async () => null,
    enrichByGoogleId: async () => ({}),
    ...over,
  };
}

/** A resolver-contract fake: INCLUDE `{}`, OMIT `null` — exactly what the real
 *  `enrichByGoogleId` does — driven by a per-id scenario map. */
function fakeEnrich(scenario: Record<string, PlaceRich | null>) {
  return async (ids: string[]): Promise<Record<string, PlaceRich>> => {
    const out: Record<string, PlaceRich> = {};
    for (const id of ids) {
      const v = scenario[id];
      if (v) out[id] = v;
    }
    return out;
  };
}

// ── FLAG OFF: the pre-cutover loop ──────────────────────────────────────

test("flag off: fetches via placeDetails; includes resolved (incl {}), omits null", async () => {
  const scenario: Record<string, PlaceRich | null> = {
    [A]: { rating: 4.5 },
    [B]: {}, // resolved-empty
    [C]: null, // failed
  };
  const { ops } = makeCache();
  let enrichCalls = 0;
  const details = await fetchDetailsMap(
    [A, B, C],
    { useResolver: false, cache: ops },
    deps({
      placeDetails: async (id) => scenario[id],
      enrichByGoogleId: async (ids) => {
        enrichCalls += 1;
        return fakeEnrich(scenario)(ids);
      },
    }),
  );
  assert.deepEqual(new Set(Object.keys(details)), new Set([A, B])); // C omitted
  assert.deepEqual(details[A], { rating: 4.5 });
  assert.deepEqual(details[B], {});
  assert.equal(enrichCalls, 0, "flag off must NOT call enrichByGoogleId");
});

test("flag off: a cached id is not re-fetched; a null is negatively cached", async () => {
  const { ops, store } = makeCache({ [A]: { rating: 3 }, [B]: null });
  let fetched: string[] = [];
  const details = await fetchDetailsMap(
    [A, B, C],
    { useResolver: false, cache: ops },
    deps({
      placeDetails: async (id) => {
        fetched.push(id);
        return null; // C resolves to null
      },
    }),
  );
  assert.deepEqual(fetched, [C], "only the uncached id is fetched");
  assert.deepEqual(details, { [A]: { rating: 3 } }); // B cached-null omitted, C null omitted
  assert.equal(store.get(C), null); // C negatively cached
});

// ── FLAG ON: delegate to enrichByGoogleId ───────────────────────────────

test("flag on: delegates misses to enrichByGoogleId, NOT placeDetails", async () => {
  const scenario: Record<string, PlaceRich | null> = { [A]: { rating: 4 }, [B]: {} };
  let placeCalls = 0;
  let enrichArg: string[] | null = null;
  const { ops } = makeCache();
  const details = await fetchDetailsMap(
    [A, B],
    { useResolver: true, cache: ops },
    deps({
      placeDetails: async (id) => {
        placeCalls += 1;
        return scenario[id];
      },
      enrichByGoogleId: async (ids) => {
        enrichArg = ids;
        return fakeEnrich(scenario)(ids);
      },
    }),
  );
  assert.equal(placeCalls, 0, "flag on must NOT call placeDetails directly");
  assert.deepEqual(enrichArg, [A, B]);
  assert.deepEqual(details, { [A]: { rating: 4 }, [B]: {} });
});

test("flag on: a miss omitted by enrichByGoogleId (null) is cached as null", async () => {
  const { ops, store, sets } = makeCache();
  const details = await fetchDetailsMap(
    [A, B],
    { useResolver: true, cache: ops },
    deps({
      // A resolves; B fails (absent from the returned map).
      enrichByGoogleId: fakeEnrich({ [A]: { rating: 4 }, [B]: null }),
    }),
  );
  assert.deepEqual(details, { [A]: { rating: 4 } }); // B omitted
  assert.equal(store.get(B), null); // negative cache preserved
  assert.ok(
    sets.some(([id, v]) => id === B && v === null),
    "B must be cache-set to null",
  );
});

test("flag on: a cached id is served from cache; enrichByGoogleId only gets misses", async () => {
  const { ops } = makeCache({ [A]: { rating: 3 } });
  let enrichArg: string[] | null = null;
  const details = await fetchDetailsMap(
    [A, B],
    { useResolver: true, cache: ops },
    deps({
      enrichByGoogleId: async (ids) => {
        enrichArg = ids;
        return fakeEnrich({ [B]: { rating: 5 } })(ids);
      },
    }),
  );
  assert.deepEqual(enrichArg, [B], "only the uncached id reaches enrichByGoogleId");
  assert.deepEqual(details, { [A]: { rating: 3 }, [B]: { rating: 5 } });
});

test("flag on: no misses → enrichByGoogleId is not called", async () => {
  const { ops } = makeCache({ [A]: { rating: 1 }, [B]: {} });
  let enrichCalls = 0;
  const details = await fetchDetailsMap(
    [A, B],
    { useResolver: true, cache: ops },
    deps({
      enrichByGoogleId: async (ids) => {
        enrichCalls += 1;
        return fakeEnrich({})(ids);
      },
    }),
  );
  assert.equal(enrichCalls, 0);
  assert.deepEqual(details, { [A]: { rating: 1 }, [B]: {} });
});

// ── PARITY: OFF and ON agree on details AND cache state ──────────────────

test("PARITY: flag off and on produce the SAME details map for the same inputs", async () => {
  const scenario: Record<string, PlaceRich | null> = {
    [A]: { rating: 4.5, reviewCount: 10 },
    [B]: {}, // resolved-empty
    [C]: null, // failed
  };
  const ids = [A, B, C];

  const off = makeCache();
  const offDetails = await fetchDetailsMap(
    ids,
    { useResolver: false, cache: off.ops },
    deps({ placeDetails: async (id) => scenario[id] }),
  );

  const on = makeCache();
  const onDetails = await fetchDetailsMap(
    ids,
    { useResolver: true, cache: on.ops },
    deps({ enrichByGoogleId: fakeEnrich(scenario) }),
  );

  assert.deepEqual(onDetails, offDetails);
  // Non-vacuous: the shared result actually carries data + the {} + the omit.
  assert.deepEqual(offDetails, { [A]: { rating: 4.5, reviewCount: 10 }, [B]: {} });
});

test("PARITY: flag off and on leave the cache in the SAME state", async () => {
  const scenario: Record<string, PlaceRich | null> = {
    [A]: { rating: 4.5 },
    [B]: {},
    [C]: null,
  };
  const ids = [A, B, C];

  const off = makeCache();
  await fetchDetailsMap(
    ids,
    { useResolver: false, cache: off.ops },
    deps({ placeDetails: async (id) => scenario[id] }),
  );

  const on = makeCache();
  await fetchDetailsMap(
    ids,
    { useResolver: true, cache: on.ops },
    deps({ enrichByGoogleId: fakeEnrich(scenario) }),
  );

  assert.deepEqual(
    Object.fromEntries(on.store),
    Object.fromEntries(off.store),
  );
  // Both must have written all three (incl. the negative cache for C).
  assert.deepEqual(Object.fromEntries(off.store), {
    [A]: { rating: 4.5 },
    [B]: {},
    [C]: null,
  });
});
