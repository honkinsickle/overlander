/**
 * places/details handler — the enrichByGoogleId() delegate, through the seam.
 *
 * No network: `enrichByGoogleId` and the cache are faked. The route (route.ts)
 * has no tests of its own because it is a thin wrapper (parse/validate + cache +
 * `{ details }` shape); the behaviour lives here.
 *
 * The handler cut over to `enrichByGoogleId()` unconditionally 2026-09-03 — the
 * `DATE_DETAIL_USE_RESOLVER` flag and the pre-cutover inline `placeDetails` loop
 * were removed after TEST parity was verified. So this covers ONE path:
 * cache-first, then delegate misses to `enrichByGoogleId`, preserving the
 * include-`{}` / omit-and-negatively-cache-`null` semantics.
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

test("delegates misses to enrichByGoogleId; includes resolved (incl {}), omits null", async () => {
  const scenario: Record<string, PlaceRich | null> = {
    [A]: { rating: 4.5 },
    [B]: {}, // resolved-empty rides through
    [C]: null, // failed → omitted
  };
  let enrichArg: string[] | null = null;
  const { ops } = makeCache();
  const details = await fetchDetailsMap(
    [A, B, C],
    { cache: ops },
    deps({
      enrichByGoogleId: async (ids) => {
        enrichArg = ids;
        return fakeEnrich(scenario)(ids);
      },
    }),
  );
  assert.deepEqual(enrichArg, [A, B, C]);
  assert.deepEqual(new Set(Object.keys(details)), new Set([A, B])); // C omitted
  assert.deepEqual(details[A], { rating: 4.5 });
  assert.deepEqual(details[B], {}); // resolved-empty present
});

test("a miss omitted by enrichByGoogleId (null) is cached as null", async () => {
  const { ops, store, sets } = makeCache();
  const details = await fetchDetailsMap(
    [A, B],
    { cache: ops },
    // A resolves; B fails (absent from the returned map).
    deps({ enrichByGoogleId: fakeEnrich({ [A]: { rating: 4 }, [B]: null }) }),
  );
  assert.deepEqual(details, { [A]: { rating: 4 } }); // B omitted
  assert.equal(store.get(B), null); // negative cache preserved
  assert.ok(
    sets.some(([id, v]) => id === B && v === null),
    "B must be cache-set to null",
  );
});

test("a cached id is served from cache; enrichByGoogleId only gets misses", async () => {
  const { ops } = makeCache({ [A]: { rating: 3 } });
  let enrichArg: string[] | null = null;
  const details = await fetchDetailsMap(
    [A, B],
    { cache: ops },
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

test("a cached null is served (omitted) without re-fetching", async () => {
  const { ops } = makeCache({ [A]: null });
  let enrichCalls = 0;
  const details = await fetchDetailsMap(
    [A],
    { cache: ops },
    deps({
      enrichByGoogleId: async (ids) => {
        enrichCalls += 1;
        return fakeEnrich({})(ids);
      },
    }),
  );
  assert.equal(enrichCalls, 0, "a cached-null id is a hit, not a miss");
  assert.deepEqual(details, {}); // cached null omitted from the map
});

test("no misses → enrichByGoogleId is not called", async () => {
  const { ops } = makeCache({ [A]: { rating: 1 }, [B]: {} });
  let enrichCalls = 0;
  const details = await fetchDetailsMap(
    [A, B],
    { cache: ops },
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

test("preserves caller order in the returned map", async () => {
  const { ops } = makeCache();
  const details = await fetchDetailsMap(
    [C, A, B],
    { cache: ops },
    deps({ enrichByGoogleId: fakeEnrich({ [A]: { rating: 4 }, [B]: { rating: 5 }, [C]: { rating: 3 } }) }),
  );
  assert.deepEqual(Object.keys(details), [C, A, B]);
});

test("preserves caller order across INTERLEAVED cache hits and misses", async () => {
  // C is cached (hit), A and B are misses — the returned map must still be in
  // caller order [C, A, B], not hits-then-misses. Order is reassembled over the
  // original id list independent of cache state.
  const { ops } = makeCache({ [C]: { rating: 3 } });
  const details = await fetchDetailsMap(
    [C, A, B],
    { cache: ops },
    deps({ enrichByGoogleId: fakeEnrich({ [A]: { rating: 4 }, [B]: { rating: 5 } }) }),
  );
  assert.deepEqual(Object.keys(details), [C, A, B]);
});
