/**
 * search-area fanout — the testable core of GET /api/search-area.
 *
 * The route handler (route.ts) stays a thin wrapper: it parses/validates, owns
 * the LRU cache and the debug gate, and shapes the response. This module owns
 * ONLY the "produce the merged result set" step, behind a dependency seam so it
 * is unit-testable without network or DB — by delegating to `resolvePlaces()`.
 *
 * CUT OVER to `resolvePlaces()` unconditionally 2026-09-03. The
 * `SEARCH_AREA_USE_RESOLVER` flag and the pre-cutover inline live/federated/merge
 * body are removed. Parity with the legacy body was verified on TEST before
 * removal: identical corpus+live membership across CA/OR/UT × representative
 * category sets (incl. the Auto/Repair car_repair/car_wash class); the resolver
 * additionally applies the verified-first tier sort, which reorders only
 * mixed-tier corpus rows — its intended behaviour (design §D2, cutover-plan §4).
 * See docs/architecture/resolve-places-search-cutover-plan.md.
 */
import { resolvePlaces } from "@/lib/places/resolve-places";
import type { BrowsePlace } from "@/lib/trip-browse/places";

/** Dependency seam for tests. Defaults to the real module. */
export type SearchAreaDeps = {
  resolvePlaces: typeof resolvePlaces;
};

const REAL_DEPS: SearchAreaDeps = { resolvePlaces };

export type SearchAreaParams = {
  bbox: [number, number, number, number];
  q: string | null;
  categories: string[] | null;
  signal?: AbortSignal;
  /** Gates per-source error detail, mirroring the route's debug gate. */
  debug: boolean;
};

/** The route shapes its JSON response around this. `counts` is kept at
 *  `{live, federated}` — the resolver's extra `deduped` count is dropped (the
 *  client ignores `counts` entirely). */
export type SearchAreaOutcome = {
  places: BrowsePlace[];
  counts: { live: number; federated: number };
  failedSources: string[];
  sourceErrors: Record<string, string>;
};

export async function resolveSearchArea(
  params: SearchAreaParams,
  deps: SearchAreaDeps = REAL_DEPS,
): Promise<SearchAreaOutcome> {
  const { bbox, q, categories, signal, debug } = params;
  const r = await deps.resolvePlaces({
    scope: {
      kind: "bbox",
      bbox,
      query: q ?? undefined,
      categories: categories ?? undefined,
    },
    // NO limit — the route leaves the merged live+federated set uncapped; only
    // the Typesense half caps, at resolveFederated's DEFAULT_TYPESENSE_LIMIT
    // (same 24 the pre-cutover route used). Passing limit would newly truncate
    // the merge. NO enrich — Search must not auto-hydrate (#257). Both are
    // resolvePlaces defaults, so this is "don't opt in".
    includeErrorDetail: debug,
    signal,
  });
  return {
    places: r.places,
    counts: { live: r.counts.live, federated: r.counts.federated },
    failedSources: r.failedSources,
    sourceErrors: r.sourceErrors ?? {},
  };
}
