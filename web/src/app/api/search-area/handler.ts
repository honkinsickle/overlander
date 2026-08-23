/**
 * search-area fanout — the testable core of GET /api/search-area.
 *
 * The route handler (route.ts) stays a thin wrapper: it parses/validates,
 * owns the LRU cache and the debug gate, and shapes the response. This module
 * owns ONLY the "produce the merged result set" step, behind a dependency seam
 * (mirroring resolve-places.ts) so BOTH flag states can be unit-tested without
 * network or DB.
 *
 * `SEARCH_AREA_USE_RESOLVER` (route-level, default off) selects the path:
 *   - OFF → `viaLegacy`: the exact live/federated/merge body the route ran
 *     before the cutover — byte-for-byte current production behaviour.
 *   - ON  → `viaResolver`: `resolvePlaces()` (bbox scope). Per the cutover
 *     plan: NO `limit` (the resolver would newly cap the merged set) and NO
 *     `enrich` (Search must not auto-hydrate, #257).
 *
 * See docs/architecture/resolve-places-search-cutover-plan.md.
 */
import { discover } from "@/lib/discovery/discovery";
import {
  googlePlacesSource,
  googleTextSearchSource,
} from "@/lib/discovery/google-places";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import { search } from "@/lib/search";
import { hydratePlacesByIds } from "@/lib/trip-browse/hydrate";
import {
  resolvePlaces,
  // Single-sourced: the same corpus-primary → slide-bucket map resolvePlaces
  // uses, so the legacy path and the resolver path can never drift (the
  // duplicate copy that used to live in this route is gone). D1 in the design.
  LIVE_SLIDE_FOR_PRIMARY,
} from "@/lib/places/resolve-places";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

/** Typesense page size for the corpus half — unchanged from the pre-cutover
 *  route. NOT passed to resolvePlaces as `limit` (that would also cap the
 *  merged set); resolveFederated defaults to the same 24 internally. */
const LIMIT = 24;

/** Dependency seam for tests. Every entry defaults to the real module. */
export type SearchAreaDeps = {
  discover: typeof discover;
  search: typeof search;
  hydratePlacesByIds: typeof hydratePlacesByIds;
  resolvePlaces: typeof resolvePlaces;
};

const REAL_DEPS: SearchAreaDeps = {
  discover,
  search,
  hydratePlacesByIds,
  resolvePlaces,
};

export type SearchAreaParams = {
  bbox: [number, number, number, number];
  q: string | null;
  categories: string[] | null;
  signal?: AbortSignal;
  /** Gates per-source error detail, mirroring the route's debug gate. */
  debug: boolean;
  /** `SEARCH_AREA_USE_RESOLVER`. false → legacy body; true → resolvePlaces(). */
  useResolver: boolean;
};

/** The route shapes its JSON response around this. `counts` is kept at
 *  `{live, federated}` in BOTH paths so the response shape is identical
 *  regardless of flag state (the resolver's extra `deduped` count is dropped;
 *  the client ignores `counts` entirely). */
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
  return params.useResolver
    ? viaResolver(params, deps)
    : viaLegacy(params, deps);
}

// ── ON: resolvePlaces() ─────────────────────────────────────────────────

async function viaResolver(
  params: SearchAreaParams,
  deps: SearchAreaDeps,
): Promise<SearchAreaOutcome> {
  const { bbox, q, categories, signal, debug } = params;
  const r = await deps.resolvePlaces({
    scope: {
      kind: "bbox",
      bbox,
      query: q ?? undefined,
      categories: categories ?? undefined,
    },
    // NO limit — the route caps only the Typesense half today and leaves the
    // merged set uncapped; passing limit would truncate the merge. NO enrich —
    // Search must not auto-hydrate (#257). Both are resolvePlaces defaults, so
    // this is "don't opt in".
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

// ── OFF: the legacy body, verbatim (deps-injected) ──────────────────────

async function viaLegacy(
  params: SearchAreaParams,
  deps: SearchAreaDeps,
): Promise<SearchAreaOutcome> {
  const { bbox, q, categories, signal } = params;

  const failedSources = new Set<string>();
  const sourceErrors: Record<string, string> = {};
  const noteError = (sourceId: string, error: unknown): void => {
    failedSources.add(sourceId);
    sourceErrors[sourceId] = error instanceof Error ? error.message : String(error);
  };

  // ── LIVE half ──────────────────────────────────────────────────────
  const livePromise: Promise<BrowsePlace[]> = (async () => {
    try {
      if (q) {
        // Free-text → Google searchText only (FSQ has no text path).
        return await deps.discover({
          bboxes: [bbox],
          categories: [],
          sources: [googleTextSearchSource],
          textQuery: q,
          signal,
          onSourceError: noteError,
        });
      }
      // Category tiles → searchNearby fanout, mapped to the buckets Google
      // covers. Overland-only categories drop out here (federated-only).
      const slideKeys = Array.from(
        new Set(
          (categories ?? [])
            .map((c) => LIVE_SLIDE_FOR_PRIMARY[c])
            .filter((k): k is SlideCategoryKey => Boolean(k)),
        ),
      );
      if (slideKeys.length === 0) return [];
      return await deps.discover({
        bboxes: [bbox],
        categories: slideKeys,
        sources: [
          googlePlacesSource,
          foursquareSource,
          recGovSource,
          usfsSource,
          blmSource,
        ],
        signal,
        onSourceError: (id) => failedSources.add(id),
      });
    } catch (err) {
      console.warn("[search-area] live discovery failed:", err);
      return [];
    }
  })();

  // ── FEDERATED half ─────────────────────────────────────────────────
  const federatedPromise: Promise<BrowsePlace[]> = (async () => {
    try {
      const hits = await deps.search({
        query: q ?? "*",
        categories: categories ?? undefined,
        bbox,
        limit: LIMIT,
      });
      if (hits.length === 0) return [];
      return await deps.hydratePlacesByIds(hits.map((h) => h.id));
    } catch (err) {
      console.error("[search-area] FEDERATED_DOWN", err);
      noteError("corpus", err);
      return [];
    }
  })();

  const [live, federated] = await Promise.all([livePromise, federatedPromise]);

  // Merge — distinct id namespaces (live `gpl/…`/`osm/…`, federated `mp:…`)
  // so a cross-source dedupe isn't needed; guard against accidental dupes by
  // keeping first occurrence.
  const seen = new Set<string>();
  const places: BrowsePlace[] = [];
  for (const p of [...live, ...federated]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    places.push(p);
  }

  return {
    places,
    counts: { live: live.length, federated: federated.length },
    failedSources: [...failedSources],
    sourceErrors,
  };
}
