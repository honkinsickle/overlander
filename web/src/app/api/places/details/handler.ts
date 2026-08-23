/**
 * places/details enrichment — the testable core of POST /api/places/details.
 *
 * The route handler (route.ts) stays a thin wrapper: it parses/validates, owns
 * the 15-minute in-process cache, and shapes the `{ details }` response. This
 * module owns ONLY the "id → PlaceRich" production step, behind a dependency
 * seam + injected cache ops (mirroring the search-area cutover) so BOTH flag
 * states can be unit-tested without network.
 *
 * `DATE_DETAIL_USE_RESOLVER` (route-level, default off) selects the path:
 *   - OFF → `viaLegacy`: the exact pre-cutover inline batched fetch loop —
 *     byte-for-byte current production behaviour.
 *   - ON  → `viaResolver`: cache-misses are delegated to `enrichByGoogleId()`
 *     (the resolver capability from #263). The cache STAYS at the route because
 *     `enrichByGoogleId` is cache-less by design — this is option 1 of the
 *     cutover plan, NOT the ADR-step-4 shared-cache work.
 *
 * Both paths produce the SAME `details` map and leave the cache in the SAME
 * state (verified by tests). See
 * docs/architecture/resolve-places-date-detail-cutover-plan.md.
 */
import { placeDetails, type PlaceRich } from "@/lib/discovery/google-places";
import { enrichByGoogleId } from "@/lib/places/resolve-places";
import { BATCH_SIZE, chunk } from "./batch";

/** Dependency seam for tests. Every entry defaults to the real module. */
export type PlaceDetailsDeps = {
  placeDetails: typeof placeDetails;
  enrichByGoogleId: typeof enrichByGoogleId;
};

const REAL_DEPS: PlaceDetailsDeps = { placeDetails, enrichByGoogleId };

/** The route's per-id cache, injected so both branches share it and tests can
 *  drive it. `get` returns a hit envelope (value may be `null` — the negative
 *  cache) or `null` on miss; `set` stores `PlaceRich | null`. */
export type CacheOps = {
  get: (id: string) => { hit: true; value: PlaceRich | null } | null;
  set: (id: string, value: PlaceRich | null) => void;
};

export type FetchDetailsOpts = {
  /** `DATE_DETAIL_USE_RESOLVER`. false → legacy loop; true → enrichByGoogleId(). */
  useResolver: boolean;
  signal?: AbortSignal;
  cache: CacheOps;
};

/**
 * Produce the `{ [placeId]: PlaceRich }` map the route returns. A resolved
 * entry — INCLUDING a resolved-empty `{}` — is present; a `null` (missing key /
 * network / non-OK) is omitted from the map but cached (negative cache). Both
 * flag states honour this identically.
 */
export async function fetchDetailsMap(
  placeIds: string[],
  opts: FetchDetailsOpts,
  deps: PlaceDetailsDeps = REAL_DEPS,
): Promise<Record<string, PlaceRich>> {
  return opts.useResolver
    ? viaResolver(placeIds, opts, deps)
    : viaLegacy(placeIds, opts, deps);
}

// ── OFF: the pre-cutover inline loop, verbatim (deps + cache injected) ───

async function viaLegacy(
  placeIds: string[],
  opts: FetchDetailsOpts,
  deps: PlaceDetailsDeps,
): Promise<Record<string, PlaceRich>> {
  const details: Record<string, PlaceRich> = {};
  // Batches run SEQUENTIALLY; ids inside a batch run concurrently — holds the
  // fan-out at BATCH_SIZE concurrent upstream calls while serving every id.
  for (const batch of chunk(placeIds, BATCH_SIZE)) {
    await Promise.all(
      batch.map(async (id) => {
        const cached = opts.cache.get(id);
        const rich = cached
          ? cached.value
          : await deps.placeDetails(id, opts.signal);
        if (!cached) opts.cache.set(id, rich);
        // `{}` (resolved-empty) rides through; only `null` stays out. See the
        // long note in route.ts / batch.ts on why `{}` must be surfaced.
        if (rich) details[id] = rich;
      }),
    );
  }
  return details;
}

// ── ON: delegate cache-misses to the resolver's enrichByGoogleId() ──────

async function viaResolver(
  placeIds: string[],
  opts: FetchDetailsOpts,
  deps: PlaceDetailsDeps,
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
      // preserve the negative cache the legacy path also writes.
      const value = Object.prototype.hasOwnProperty.call(fetched, id)
        ? fetched[id]
        : null;
      opts.cache.set(id, value);
      resolved.set(id, value);
    }
  }

  // Assemble in caller order: present iff the resolved value is truthy — the
  // same `if (rich)` gate the legacy path applies.
  const details: Record<string, PlaceRich> = {};
  for (const id of placeIds) {
    const v = resolved.get(id);
    if (v) details[id] = v;
  }
  return details;
}
