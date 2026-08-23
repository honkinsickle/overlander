/**
 * `resolvePlaces()` — the single place-data entry point.
 *
 * Step 2 of docs/decisions/2026-08-21-place-data-resolver-consolidation.md.
 * Full design, and the nine flagged divergences between the endpoints it is
 * meant to eventually replace: docs/architecture/resolve-places-design.md.
 *
 * ⚠ ADDITIVE AND NOT YET LOAD-BEARING. Nothing imports this from `src/app` or
 * `src/components`. `/api/search-area`, `/api/trip-browse/:tripId/:dayId` and
 * `POST /api/places/details` are untouched and remain the live paths. Cutting a
 * surface over is a later ADR step and a separate decision — several of the
 * divergences in §2 of the design doc are user-visible and unresolved.
 *
 * WHAT IT DOES. One signature over three scopes — by id, by bbox (+ optional
 * free text / categories), or by day corridor — fanning out to the LIVE
 * adapters and the FEDERATED corpus concurrently, merging on a CANONICAL id
 * (see ./place-id), and returning `BrowsePlace[]` unchanged.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - no cache. ADR step 4 puts one shared cache on the client, keyed by
 *     canonical id. A server cache here would be a second, competing one, and
 *     the three endpoints' cache grains don't reconcile anyway (design §D6).
 *   - no env reads. `USE_FEDERATED_POIS`-style gating is the caller's, via
 *     `include`.
 *   - no trip/day lookup. `day-corridor` takes coordinates, not a tripId — a
 *     place service should not couple to the trip repository or its RLS.
 *   - no read of step 1's new master_place columns (rating/review_count/
 *     price_tier/photo_url). Neither underlying reader selects them yet;
 *     widening them is a change to shared code other callers use.
 */

import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "@/lib/discovery/types";
import { bboxFromCoords, discover, sameSpot } from "@/lib/discovery/discovery";
import {
  googlePlacesSource,
  googleTextSearchSource,
  placeDetails,
  type PlaceRich,
} from "@/lib/discovery/google-places";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import { search } from "@/lib/search";
import { hydratePlacesByIds } from "@/lib/trip-browse/hydrate";
import { fetchFederatedPois } from "@/lib/trip-browse/federated";
import {
  haversineMi,
  pointToPolylineMi,
} from "@/lib/routing/point-to-polyline";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalizePlaceId,
  googlePlaceIdOf,
  parsePlaceId,
  partitionPlaceIds,
} from "./place-id";

export type Coord = [number, number];
export type Bbox = [west: number, south: number, east: number, north: number];

// ── Verification tier ────────────────────────────────────────────────

export type VerificationTier = "verified" | "unverified";

/** Classify a federated place's verification tier from its description_source.
 *  - 'source' or 'llm' → verified (real or LLM-grounded description)
 *  - 'template', null, or undefined → unverified
 *  Live-sourced places are always verified (they come from real APIs). */
export function classifyVerificationTier(
  descriptionSource: "source" | "template" | "llm" | null | undefined,
): VerificationTier {
  return descriptionSource === "source" || descriptionSource === "llm"
    ? "verified"
    : "unverified";
}

/** Stable sort: verified places first, original order preserved within
 *  each tier. */
export function sortByVerificationTier(places: BrowsePlace[]): BrowsePlace[] {
  return places.slice().sort((a, b) => {
    const av = a.verified === "verified" ? 0 : 1;
    const bv = b.verified === "verified" ? 0 : 1;
    return av - bv;
  });
}

/** A place is suggestable (eligible for proactive trip-stop recommendation)
 *  only when verified. Unverified places are still fully searchable and
 *  manually addable. */
export function isSuggestable(place: BrowsePlace): boolean {
  return place.verified === "verified";
}

// ── Scope ─────────────────────────────────────────────────────────────

export type ResolveScope =
  /** By id. Mixed forms welcome — `mp:<uuid>`, bare uuid, `gpl/<id>` — they
   *  are partitioned by what they actually denote (see place-id). */
  | { kind: "ids"; ids: string[] }
  /** Viewport / corpus-wide. `categories` is the corpus `primary_category`
   *  vocabulary, matching /api/search-area (design §D1). */
  | {
      kind: "bbox";
      bbox: Bbox;
      query?: string;
      categories?: string[];
    }
  /** One day's corridor. `categories` is the SlideCategoryKey vocabulary,
   *  matching /api/trip-browse (design §D1). Coordinates, not a tripId. */
  | {
      kind: "day-corridor";
      start: Coord;
      end: Coord;
      categories: SlideCategoryKey[];
      bufferMeters?: number;
      corridorMi?: number;
      radiusKmByCategory?: Partial<Record<SlideCategoryKey, number>>;
      /** Required for the federated half — the anon+JWT client the corridor
       *  RPC is called through. Omit to run live-only. */
      supabase?: SupabaseClient;
    };

export type ResolvePlacesInput = {
  scope: ResolveScope;
  /** Disable either half. Defaults: both on. This is how a caller reproduces
   *  `USE_FEDERATED_POIS = false` without the resolver reading env. */
  include?: { live?: boolean; federated?: boolean };
  /** Graft live Google Place Details onto places carrying a `placeId`.
   *  DEFAULT OFF. Date Detail is the one caller expected to pass `true` —
   *  it auto-hydrates on open today (POST /api/places/details), and this
   *  flag preserves that behavior at cutover. Search and day-scoped browse
   *  should NOT pass it (they never auto-hydrated). See design §D3. */
  enrich?: boolean;
  /** Also dedupe across the live/federated boundary with the existing
   *  `sameSpot()` heuristic. DEFAULT OFF — neither endpoint does this today. */
  crossSourceDedupe?: boolean;
  /** Post-merge cap. No cursor/offset — nothing paginates today (design §D5). */
  limit?: number;
  /** Live adapter list + order. Order is load-bearing (design §D4). */
  liveSources?: WaypointSource[];
  /** Include per-source error text. Off by default: a Supabase error can name
   *  table internals, matching /api/search-area's debug gate. */
  includeErrorDetail?: boolean;
  signal?: AbortSignal;
  /** Dependency seam for tests. Every entry defaults to the real module. */
  deps?: Partial<ResolveDeps>;
};

export type ResolvePlacesResult = {
  places: BrowsePlace[];
  counts: { live: number; federated: number; deduped: number };
  /** Sources that THREW. A source returning nothing cleanly is not a failure —
   *  same distinction /api/search-area draws. */
  failedSources: string[];
  sourceErrors?: Record<string, string>;
};

// ── Dependency seam ───────────────────────────────────────────────────

export type ResolveDeps = {
  discover: typeof discover;
  search: typeof search;
  hydratePlacesByIds: typeof hydratePlacesByIds;
  fetchFederatedPois: typeof fetchFederatedPois;
  placeDetails: typeof placeDetails;
};

const REAL_DEPS: ResolveDeps = {
  discover,
  search,
  hydratePlacesByIds,
  fetchFederatedPois,
  placeDetails,
};

// ── Defaults, mirrored from the endpoints ─────────────────────────────

/** /api/search-area's category fanout order. NOT the same order as
 *  trip-browse's — see design §D4; both are preserved rather than merged. */
export const DEFAULT_BBOX_LIVE_SOURCES: WaypointSource[] = [
  googlePlacesSource,
  foursquareSource,
  recGovSource,
  usfsSource,
  blmSource,
];

/** /api/trip-browse's order. foursquare and rec-gov are swapped relative to
 *  the above; whichever comes first supplies the canonical title when Google
 *  has no result for a place. */
export const DEFAULT_CORRIDOR_LIVE_SOURCES: WaypointSource[] = [
  googlePlacesSource,
  recGovSource,
  foursquareSource,
  usfsSource,
  blmSource,
];

/** Corpus primary_category → live slide bucket, for the categories Google
 *  honestly covers. Copied from /api/search-area's route-local map so this
 *  service does not import from a route handler. ⚠ It is NOT the inverse of
 *  SLIDE_TO_PRIMARY_CATEGORY — see design §D1. Kept in sync by hand; if the
 *  route's copy changes, this one must too. */
export const LIVE_SLIDE_FOR_PRIMARY: Record<string, SlideCategoryKey> = {
  cafe: "food", restaurant: "food", fast_food_restaurant: "food", diner: "food",
  american_restaurant: "food", italian_restaurant: "food",
  mexican_restaurant: "food", chinese_restaurant: "food",
  indian_restaurant: "food", french_restaurant: "food",
  brazilian_restaurant: "food", taco_restaurant: "food",
  pizza_restaurant: "food", hamburger_restaurant: "food",
  chicken_restaurant: "food", breakfast_restaurant: "food",
  family_restaurant: "food", fine_dining_restaurant: "food",
  steak_house: "food", sandwich_shop: "food", bar_and_grill: "food",
  gastropub: "food", brewpub: "food",
  gas_station: "fuel", truck_stop: "fuel",
  campground: "camping", rv_park: "camping", camping_cabin: "camping",
  hotel: "overnight", motel: "overnight", resort_hotel: "overnight",
  viewpoint: "scenic", peak: "scenic", mountain_peak: "scenic",
  scenic_spot: "scenic",
  museum: "oddity", art_gallery: "oddity", historical_landmark: "oddity",
};

/** Per-category live search radius, from /api/trip-browse. */
export const DEFAULT_RADIUS_KM_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  food: 5, scenic: 15, oddity: 25, overnight: 15, camping: 50, fuel: 10,
  attraction: 15, interest: 15, urban: 10,
};

const DEFAULT_CORRIDOR_MI = 10;
const DEFAULT_FEDERATED_BUFFER_M = 16000;
const DEFAULT_TYPESENSE_LIMIT = 24;
/** Concurrent Place Details lookups during enrichment. Mirrors the batching
 *  posture of POST /api/places/details: batches sequential, ids concurrent. */
const ENRICH_BATCH = 40;

// ── Helpers ───────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Stamp canonical id, provenance, and verification tier. `source` is set
 *  UNCONDITIONALLY, unlike either endpoint — design §D7.
 *  Live-sourced places are always verified. Federated places derive their
 *  tier from either: (a) the `descriptionSources` map (bbox scope, keyed on
 *  master_place uuid from Typesense hits), or (b) a `verified` field already
 *  set on the place by `mapMasterPlaceRow` (corridor scope, from the RPC's
 *  description_source column). */
function stamp(
  p: BrowsePlace,
  origin: "live" | "master_place",
  descriptionSources?: Map<string, "source" | "template" | "llm" | null>,
): BrowsePlace {
  const id = canonicalizePlaceId(p.id);
  let verified: VerificationTier;
  if (origin === "live") {
    verified = "verified";
  } else if (p.verified) {
    // Already set by mapMasterPlaceRow (corridor path) — preserve it.
    verified = p.verified;
  } else {
    // Derive from the Typesense description_source map (bbox path).
    verified = classifyVerificationTier(descriptionSources?.get(p.id) ?? null);
  }
  return { ...p, id, source: origin, verified };
}

/** Graft PlaceRich onto a place without overwriting anything it already has.
 *  `??` not `=`: a corpus value the place already carries wins over the live
 *  one, matching how the existing hydrate merge sites behave. */
function applyRich(p: BrowsePlace, rich: PlaceRich): BrowsePlace {
  return {
    ...p,
    ...(p.rating === undefined && rich.rating !== undefined ? { rating: rich.rating } : {}),
    ...(p.reviewCount === undefined && rich.reviewCount !== undefined
      ? { reviewCount: rich.reviewCount }
      : {}),
    ...(p.priceTier === undefined && rich.priceTier !== undefined
      ? { priceTier: rich.priceTier }
      : {}),
    ...(p.photoUrl === undefined && rich.photoUrl !== undefined
      ? { photoUrl: rich.photoUrl }
      : {}),
    ...(rich.hours && !p.stats.some((s) => s.label === "HOURS")
      ? { stats: [...p.stats, { label: "HOURS", value: rich.hours }] }
      : {}),
  };
}

// ── The service ───────────────────────────────────────────────────────

export async function resolvePlaces(
  input: ResolvePlacesInput,
): Promise<ResolvePlacesResult> {
  const deps: ResolveDeps = { ...REAL_DEPS, ...input.deps };
  const wantLive = input.include?.live !== false;
  const wantFederated = input.include?.federated !== false;

  const failedSources = new Set<string>();
  const sourceErrors: Record<string, string> = {};
  const noteError = (sourceId: string, error: unknown): void => {
    failedSources.add(sourceId);
    sourceErrors[sourceId] =
      error instanceof Error ? error.message : String(error);
  };

  /** Run one half. A throw contributes [] and a named failure — never rejects
   *  the whole resolve, so one dead source can't blank the other half. */
  const half = async (
    name: string,
    enabled: boolean,
    run: () => Promise<BrowsePlace[]>,
  ): Promise<BrowsePlace[]> => {
    if (!enabled) return [];
    try {
      return await run();
    } catch (err) {
      noteError(name, err);
      return [];
    }
  };

  const scope = input.scope;

  /** description_source by raw place id, populated by the federated path
   *  when Typesense search results are available. */
  const descriptionSources = new Map<string, "source" | "template" | "llm" | null>();

  const [live, federated] = await Promise.all([
    half("live", wantLive, () => resolveLive(scope, input, deps, noteError)),
    half("corpus", wantFederated, () =>
      resolveFederated(scope, input, deps, descriptionSources)),
  ]);

  // ── Merge ───────────────────────────────────────────────────────────
  // Live first, so live wins an id tie — matching /api/search-area's order.
  const liveStamped = live.map((p) => stamp(p, "live"));
  const fedStamped = federated.map((p) =>
    stamp(p, "master_place", descriptionSources));

  const byCanonical = new Map<string, BrowsePlace>();
  for (const p of [...liveStamped, ...fedStamped]) {
    if (!byCanonical.has(p.id)) byCanonical.set(p.id, p);
  }
  let merged = [...byCanonical.values()];
  const afterIdDedupe = merged.length;

  // Optional cross-source physical dedupe. Reuses the EXISTING sameSpot
  // heuristic (category + ~80m + fuzzy name) rather than a second one.
  if (input.crossSourceDedupe) {
    const kept: BrowsePlace[] = [];
    for (const p of merged) {
      if (!kept.some((k) => sameSpot(k, p))) kept.push(p);
    }
    merged = kept;
  }

  // ── day-corridor post-filter: corridor, then distance-from-start sort ──
  if (scope.kind === "day-corridor") {
    const corridorMi = scope.corridorMi ?? DEFAULT_CORRIDOR_MI;
    const segment: Coord[] = [scope.start, scope.end];
    merged = merged
      .map((p) => ({
        place: p,
        off: pointToPolylineMi(p.coords, segment),
        fromStart: haversineMi(p.coords, scope.start),
      }))
      .filter((s) => s.off <= corridorMi)
      .sort((a, b) => a.fromStart - b.fromStart)
      .map((s) => s.place);
  }

  // ── Verification-tier sort: verified first, then unverified ─────────
  // Applied AFTER corridor distance sort / cross-source dedupe, so within
  // each tier the existing sort order (distance, relevance) is preserved.
  merged = sortByVerificationTier(merged);

  if (typeof input.limit === "number" && input.limit >= 0) {
    merged = merged.slice(0, input.limit);
  }

  if (input.enrich) {
    merged = await enrichPlaces(merged, deps, input.signal);
  }

  const result: ResolvePlacesResult = {
    places: merged,
    counts: {
      live: liveStamped.length,
      federated: fedStamped.length,
      deduped: liveStamped.length + fedStamped.length - afterIdDedupe,
    },
    failedSources: [...failedSources],
  };
  if (input.includeErrorDetail && failedSources.size > 0) {
    result.sourceErrors = sourceErrors;
  }
  return result;
}

// ── LIVE half ─────────────────────────────────────────────────────────

async function resolveLive(
  scope: ResolveScope,
  input: ResolvePlacesInput,
  deps: ResolveDeps,
  noteError: (id: string, err: unknown) => void,
): Promise<BrowsePlace[]> {
  if (scope.kind === "ids") {
    // By-id has no live *discovery* path — the adapters are all bbox-shaped.
    // The one live by-id capability is Google Place Details, and it returns
    // enrichment fragments, not places (design §D3). So an `ids` resolve
    // carrying Google ids yields nothing live here; those ids are served as
    // enrichment when `enrich` is on.
    return [];
  }

  if (scope.kind === "bbox") {
    const sources = input.liveSources ?? DEFAULT_BBOX_LIVE_SOURCES;
    if (scope.query) {
      // Free-text → Google searchText only. Same restriction the endpoint has.
      return deps.discover({
        bboxes: [scope.bbox],
        categories: [],
        sources: input.liveSources ?? [googleTextSearchSource],
        textQuery: scope.query,
        signal: input.signal,
        onSourceError: noteError,
      });
    }
    const slideKeys = Array.from(
      new Set(
        (scope.categories ?? [])
          .map((c) => LIVE_SLIDE_FOR_PRIMARY[c])
          .filter((k): k is SlideCategoryKey => Boolean(k)),
      ),
    );
    // Every requested primary is overland-only → federated-only, not an error.
    if (slideKeys.length === 0) return [];
    return deps.discover({
      bboxes: [scope.bbox],
      categories: slideKeys,
      sources,
      signal: input.signal,
      onSourceError: noteError,
    });
  }

  // day-corridor: one discover() per slide key, bboxes around both endpoints.
  const sources = input.liveSources ?? DEFAULT_CORRIDOR_LIVE_SOURCES;
  const radii = { ...DEFAULT_RADIUS_KM_BY_CATEGORY, ...scope.radiusKmByCategory };
  const endpoints: Coord[] = [scope.start, scope.end];
  const perCategory = await Promise.all(
    scope.categories.map(async (slideKey) => {
      const places = await deps.discover({
        bboxes: endpoints.map((p) => bboxFromCoords(p, radii[slideKey])),
        categories: [slideKey],
        sources,
        signal: input.signal,
        onSourceError: noteError,
      });
      // Stamp the requested bucket, as the endpoint does — a result found
      // under `scenic` is a scenic card.
      return places.map<BrowsePlace>((p) => ({ ...p, category: slideKey }));
    }),
  );
  return perCategory.flat();
}

// ── FEDERATED half ────────────────────────────────────────────────────

async function resolveFederated(
  scope: ResolveScope,
  input: ResolvePlacesInput,
  deps: ResolveDeps,
  descriptionSources: Map<string, "source" | "template" | "llm" | null>,
): Promise<BrowsePlace[]> {
  if (scope.kind === "ids") {
    const { masterPlaceUuids } = partitionPlaceIds(scope.ids);
    if (masterPlaceUuids.length === 0) return [];
    return deps.hydratePlacesByIds(masterPlaceUuids);
  }

  if (scope.kind === "bbox") {
    const hits = await deps.search({
      query: scope.query ?? "*",
      categories: scope.categories ?? undefined,
      bbox: scope.bbox,
      limit: input.limit ?? DEFAULT_TYPESENSE_LIMIT,
    });
    if (hits.length === 0) return [];
    for (const h of hits) {
      descriptionSources.set(h.id, h.description_source ?? null);
    }
    return deps.hydratePlacesByIds(hits.map((h) => h.id));
  }

  // day-corridor — one RPC per slide key, as the endpoint does.
  if (!scope.supabase) return [];
  const supabase = scope.supabase;
  const perCategory = await Promise.all(
    scope.categories.map((slideKey) =>
      deps.fetchFederatedPois({
        supabase,
        slideKey,
        start: scope.start,
        end: scope.end,
        bufferMeters: scope.bufferMeters ?? DEFAULT_FEDERATED_BUFFER_M,
        signal: input.signal,
      }),
    ),
  );
  return perCategory.flat();
}

// ── Enrichment (the /api/places/details role) ──────────────────────────

async function enrichPlaces(
  places: BrowsePlace[],
  deps: ResolveDeps,
  signal?: AbortSignal,
): Promise<BrowsePlace[]> {
  // Which places can be enriched: anything whose canonical id resolves to a
  // Google place, or a federated row carrying `placeId`.
  const idFor = (p: BrowsePlace): string | null =>
    googlePlaceIdOf(parsePlaceId(p.id)) ?? (p.placeId ? p.placeId : null);

  const wanted = Array.from(
    new Set(places.map(idFor).filter((g): g is string => Boolean(g))),
  );
  if (wanted.length === 0) return places;

  const rich = new Map<string, PlaceRich>();
  for (const batch of chunk(wanted, ENRICH_BATCH)) {
    await Promise.all(
      batch.map(async (gid) => {
        // A null (missing key / network / non-OK) simply leaves the place
        // un-enriched. Deliberately NOT cached here — the resolver holds no
        // cache, so it also can't reproduce the 15-minute negative-cache trap.
        const r = await deps.placeDetails(gid, signal);
        if (r) rich.set(gid, r);
      }),
    );
  }

  return places.map((p) => {
    const gid = idFor(p);
    const r = gid ? rich.get(gid) : undefined;
    return r ? applyRich(p, r) : p;
  });
}

/** Re-exported so a caller can build ids without a second import. */
export type { SourceResult };
