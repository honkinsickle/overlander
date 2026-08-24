/**
 * trip-browse day feed — the testable core of GET /api/trip-browse/:tripId/:dayId.
 *
 * The route handler (route.ts) stays a thin wrapper: it validates the category
 * set, owns the LRU cache, runs the fixture fast path, resolves the trip/day
 * geometry, and shapes the `{ source, places }` response. This module owns ONLY
 * the "produce the ranked places" step, behind a dependency seam so all four
 * flag combinations can be unit-tested without network or DB.
 *
 * TWO independent, orthogonal flags (see the cutover plan §3):
 *   - `TRIP_BROWSE_USE_RESOLVER` (new, default off) selects the CODE PATH:
 *       OFF → `viaLegacy`: the pre-cutover discover-fanout body, verbatim.
 *       ON  → `viaResolver`: `resolvePlaces()` day-corridor scope.
 *   - `USE_FEDERATED_POIS` (existing, default off) selects the DATA: whether the
 *     federated `pois_along_corridor` rows are merged. It is wired into the
 *     resolver path via `include: { federated: useFederated }`, so both flags
 *     stay independent and all four combinations preserve today's behaviour.
 *
 * See docs/architecture/resolve-places-day-scoped-browse-cutover-plan.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { googlePlacesSource } from "@/lib/discovery/google-places";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import { fetchFederatedPois } from "@/lib/trip-browse/federated";
import { resolvePlaces } from "@/lib/places/resolve-places";
import { haversineMi, pointToPolylineMi } from "@/lib/routing/point-to-polyline";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

// ── Legacy constants — copied verbatim from the pre-cutover route so the
// flag-OFF path is byte-for-byte unchanged. They mirror resolvePlaces()'s
// day-corridor defaults (DEFAULT_RADIUS_KM_BY_CATEGORY / DEFAULT_CORRIDOR_MI /
// DEFAULT_FEDERATED_BUFFER_M / DEFAULT_CORRIDOR_LIVE_SOURCES), verified
// byte-identical in the cutover plan — kept local rather than folded so the
// legacy path can never be perturbed by a resolver-side edit.

const RADIUS_KM_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  food: 5,
  scenic: 15,
  oddity: 25,
  overnight: 15,
  camping: 50,
  fuel: 10,
  attraction: 15,
  interest: 15,
  urban: 10,
};
const CORRIDOR_MI = 10;
const FEDERATED_BUFFER_M = 16000;
const LIVE_SOURCES = [
  googlePlacesSource,
  recGovSource,
  foursquareSource,
  usfsSource,
  blmSource,
];

/** Dependency seam for tests. Every entry defaults to the real module. */
export type BrowseDeps = {
  discover: typeof discover;
  fetchFederatedPois: typeof fetchFederatedPois;
  resolvePlaces: typeof resolvePlaces;
};

const REAL_DEPS: BrowseDeps = { discover, fetchFederatedPois, resolvePlaces };

export type BrowseParams = {
  requested: SlideCategoryKey[];
  /** Previous overnight (or trip start on day 1). Undefined only at the edges. */
  dayStart?: [number, number];
  /** This day's overnight coord. */
  dayEnd?: [number, number];
  /** Endpoints for the live discover bboxes — the route builds this the same
   *  way the pre-cutover body did (this day's coord + previous day's / start). */
  points: [number, number][];
  /** `TRIP_BROWSE_USE_RESOLVER`. false → legacy body; true → resolvePlaces(). */
  useResolver: boolean;
  /** `USE_FEDERATED_POIS`. Gates the federated merge in BOTH paths. */
  useFederated: boolean;
  /** Present iff `useFederated` — created by the route (the anon+JWT client the
   *  corridor RPC runs through). Null otherwise. */
  supabase: SupabaseClient | null;
  signal?: AbortSignal;
};

/** Produce the ranked `BrowsePlace[]` for the day's browse feed. */
export async function produceBrowsePlaces(
  params: BrowseParams,
  deps: BrowseDeps = REAL_DEPS,
): Promise<BrowsePlace[]> {
  return params.useResolver
    ? viaResolver(params, deps)
    : viaLegacy(params, deps);
}

// ── ON: resolvePlaces() day-corridor scope ──────────────────────────────

async function viaResolver(
  params: BrowseParams,
  deps: BrowseDeps,
): Promise<BrowsePlace[]> {
  const { dayStart, dayEnd, requested, useFederated, supabase, signal } = params;
  // day-corridor needs BOTH endpoints. The legacy body degrades to a
  // single-point corridor when dayStart is absent (a day with no previous
  // coord and no trip start); the resolver can't express that, so fall back to
  // the legacy path for that edge rather than 500/empty.
  if (!dayStart || !dayEnd) return viaLegacy(params, deps);

  const r = await deps.resolvePlaces({
    scope: {
      kind: "day-corridor",
      start: dayStart,
      end: dayEnd,
      categories: requested,
      // Pass the client only when federated is on; without it the federated
      // half returns [] anyway, but include.federated below is the real gate.
      ...(useFederated && supabase ? { supabase } : {}),
    },
    // The one line that keeps USE_FEDERATED_POIS orthogonal: the resolver reads
    // no env, so the route's flag decides whether the federated half runs.
    include: { federated: useFederated },
    // NO enrich — day-scoped browse never auto-hydrated (like Search, unlike
    // Date Detail). resolvePlaces defaults enrich off, so this is "don't opt in".
    signal,
  });
  return r.places;
}

// ── OFF: the pre-cutover discover-fanout body, verbatim (deps injected) ──

async function viaLegacy(
  params: BrowseParams,
  deps: BrowseDeps,
): Promise<BrowsePlace[]> {
  const { requested, points, dayStart, dayEnd, useFederated, supabase, signal } =
    params;

  // Fan out one discover() per category in parallel.
  const perCategory = await Promise.all(
    requested.map(async (slideKey) => {
      const bboxes = points.map((p) =>
        bboxFromCoords(p, RADIUS_KM_BY_CATEGORY[slideKey]),
      );
      const places = await deps.discover({
        bboxes,
        categories: [slideKey],
        sources: LIVE_SOURCES,
        signal,
      });
      const live = places.map<BrowsePlace>((p) => ({ ...p, category: slideKey }));

      // Flag OFF: byte-for-byte the legacy path — untagged live results.
      if (!useFederated) return live;

      // Flag ON: tag live origin, then merge federated RPC rows alongside.
      const liveTagged = live.map<BrowsePlace>((p) => ({
        ...p,
        source: "live" as const,
      }));
      if (!supabase || !dayStart || !dayEnd) return liveTagged;
      const federated = await deps.fetchFederatedPois({
        supabase,
        slideKey,
        start: dayStart,
        end: dayEnd,
        bufferMeters: FEDERATED_BUFFER_M,
        signal,
      });
      return [...liveTagged, ...federated];
    }),
  );
  const merged = perCategory.flat();

  // Cross-category de-dupe by id (keep first occurrence).
  const seen = new Set<string>();
  const unique: BrowsePlace[] = [];
  for (const p of merged) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  // Filter to within CORRIDOR_MI of today's segment; sort by distance from
  // day-start ascending.
  const daySegment: [number, number][] =
    dayStart && dayEnd
      ? [dayStart, dayEnd]
      : dayEnd
        ? [dayEnd]
        : dayStart
          ? [dayStart]
          : [];
  const scored = unique
    .map((p) => ({
      place: p,
      milesOffRoute:
        daySegment.length > 0 ? pointToPolylineMi(p.coords, daySegment) : 0,
      fromStart: dayStart ? haversineMi(p.coords, dayStart) : Infinity,
    }))
    .filter((s) => s.milesOffRoute <= CORRIDOR_MI);
  scored.sort((a, b) => a.fromStart - b.fromStart);
  return scored.map((s) => s.place);
}
