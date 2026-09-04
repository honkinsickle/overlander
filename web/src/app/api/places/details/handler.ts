/**
 * places/details enrichment — the testable core of POST /api/places/details.
 *
 * The route handler (route.ts) stays a thin wrapper: it parses/validates, owns
 * the 15-minute in-process cache, and shapes the `{ details }` response. This
 * module owns ONLY the "id → PlaceRich" production step, behind a dependency
 * seam + injected cache ops so it is unit-testable without network.
 *
 * CUT OVER to resolvePlaces()'s `enrichByGoogleId()` capability (#263)
 * unconditionally 2026-09-03. The `DATE_DETAIL_USE_RESOLVER` flag and the
 * pre-cutover inline `placeDetails` batch loop are removed. Parity with the
 * legacy loop was verified on TEST first: identical `{ placeId: PlaceRich }`
 * maps (including the `category` field) for real Google place_ids across
 * CA/OR/UT — both paths are pure Google Place Details passthroughs, so there is
 * no category→source divergence possible here (design §D3, cutover-plan §3).
 *
 * The cache STAYS at the route — `enrichByGoogleId` is cache-less by design
 * (this is cutover-plan option 1, NOT ADR step 4's shared cache). The
 * concurrency ceiling is preserved: `enrichByGoogleId` batches at its own
 * `ENRICH_BATCH = 40`, the same value the old local `BATCH_SIZE` held.
 */
import { enrichByGoogleId } from "@/lib/places/resolve-places";
import type { PlaceRich } from "@/lib/discovery/google-places";

/** Dependency seam for tests. Defaults to the real module. */
export type PlaceDetailsDeps = {
  enrichByGoogleId: typeof enrichByGoogleId;
};

const REAL_DEPS: PlaceDetailsDeps = { enrichByGoogleId };

/** The route's per-id cache, injected so the branch and tests can drive it.
 *  `get` returns a hit envelope (value may be `null` — the negative cache) or
 *  `null` on miss; `set` stores `PlaceRich | null`. */
export type CacheOps = {
  get: (id: string) => { hit: true; value: PlaceRich | null } | null;
  set: (id: string, value: PlaceRich | null) => void;
};

export type FetchDetailsOpts = {
  signal?: AbortSignal;
  cache: CacheOps;
};

/**
 * Produce the `{ [placeId]: PlaceRich }` map the route returns. A resolved
 * entry — INCLUDING a resolved-empty `{}` — is present; a `null` (missing key /
 * network / non-OK) is omitted from the map but cached (negative cache).
 *
 * Cache-misses are delegated to `enrichByGoogleId()`; the 15-min cache stays at
 * the route (that capability is cache-less).
 */
export async function fetchDetailsMap(
  placeIds: string[],
  opts: FetchDetailsOpts,
  deps: PlaceDetailsDeps = REAL_DEPS,
): Promise<Record<string, PlaceRich>> {
  // Cache first (the cache stays at the route — enrichByGoogleId is cache-less).
  const resolved = new Map<string, PlaceRich | null>();
  const misses: string[] = [];
  for (const id of placeIds) {
    const cached = opts.cache.get(id);
    if (cached) resolved.set(id, cached.value);
    else misses.push(id);
  }

  if (misses.length > 0) {
    const fetched = await deps.enrichByGoogleId(misses, { signal: opts.signal });
    for (const id of misses) {
      // enrichByGoogleId INCLUDES resolved-empty `{}` and OMITS `null`. So a
      // miss absent from `fetched` resolved to null → cache it as null to
      // preserve the negative cache the endpoint has always written.
      const value = Object.prototype.hasOwnProperty.call(fetched, id)
        ? fetched[id]
        : null;
      opts.cache.set(id, value);
      resolved.set(id, value);
    }
  }

  // Assemble in caller order: present iff the resolved value is truthy — `{}`
  // (resolved-empty) rides through; only `null` stays out.
  const details: Record<string, PlaceRich> = {};
  for (const id of placeIds) {
    const v = resolved.get(id);
    if (v) details[id] = v;
  }
  return details;
}
