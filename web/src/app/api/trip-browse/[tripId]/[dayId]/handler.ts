/**
 * trip-browse day feed — the testable core of GET /api/trip-browse/:tripId/:dayId.
 *
 * The route handler (route.ts) stays a thin wrapper: it validates the category
 * set, owns the LRU cache, runs the fixture fast path, resolves the trip/day
 * geometry, and shapes the `{ source, places }` response. This module owns ONLY
 * the "produce the ranked places" step, behind a dependency seam so all four
 * flag combinations can be unit-tested without network or DB.
 *
 * CUT OVER to `resolvePlaces()` (day-corridor scope) unconditionally 2026-09-03.
 * The `TRIP_BROWSE_USE_RESOLVER` flag is removed; `produceBrowsePlaces` always
 * runs `viaResolver`. Parity with the pre-cutover body was verified on TEST
 * first: identical membership legacy-vs-resolver across CA/OR/UT corridors in
 * both `USE_FEDERATED_POIS` states (the resolver additionally applies the
 * verified-first tier sort — a no-op when federated is off, a reorder of
 * mixed-tier rows when on; design §D2, cutover-plan §4).
 *
 * `USE_FEDERATED_POIS` (existing, default off) is a SEPARATE, orthogonal DATA
 * flag — whether the federated `pois_along_corridor` rows are merged. It stays,
 * wired into the resolver via `include: { federated: useFederated }` (the
 * resolver reads no env).
 *
 * `viaLegacy` is RETAINED as the single-endpoint FALLBACK only: `resolvePlaces`
 * day-corridor requires BOTH endpoints, and a degenerate day (no `dayStart`)
 * cannot be expressed as a corridor — `viaResolver` delegates to `viaLegacy`
 * for that edge rather than 500/empty. It is no longer a flag-selected path.
 *
 * See docs/architecture/resolve-places-day-scoped-browse-cutover-plan.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { googlePlacesSource } from "@/lib/discovery/google-places";
import { mapboxSearchBoxSource } from "@/lib/discovery/mapbox-search-box";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import { resolvePlaces } from "@/lib/places/resolve-places";
import { haversineMi, pointToPolylineMi } from "@/lib/routing/point-to-polyline";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

// ── Fallback constants — used ONLY by the single-endpoint `viaLegacy` fallback
// (the resolver owns the normal path's radii/corridor). Kept local so the
// fallback can never be perturbed by a resolver-side edit; they mirror
// resolvePlaces()'s DEFAULT_RADIUS_KM_BY_CATEGORY / DEFAULT_CORRIDOR_MI /
// DEFAULT_CORRIDOR_LIVE_SOURCES.

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
// Mapbox Search Box heads the list as the fuel-only provider. Google's
// TYPES_BY_CATEGORY.fuel was emptied 2026-08-25 so fuel comes only from
// Mapbox; other categories still come from Google/FSQ/rec-gov/USFS/BLM. Head
// position is for dedupe-canonical (see the mirror comment in resolve-places.ts).
const LIVE_SOURCES = [
  mapboxSearchBoxSource,
  googlePlacesSource,
  recGovSource,
  foursquareSource,
  usfsSource,
  blmSource,
];

/** Dependency seam for tests. Every entry defaults to the real module.
 *  `discover` is used only by the single-endpoint `viaLegacy` fallback; the
 *  normal path goes entirely through `resolvePlaces`. */
export type BrowseDeps = {
  discover: typeof discover;
  resolvePlaces: typeof resolvePlaces;
};

const REAL_DEPS: BrowseDeps = { discover, resolvePlaces };

export type BrowseParams = {
  requested: SlideCategoryKey[];
  /** Previous overnight (or trip start on day 1). Undefined only at the edges. */
  dayStart?: [number, number];
  /** This day's overnight coord. */
  dayEnd?: [number, number];
  /** Endpoints for the live discover bboxes — the route builds this the same
   *  way the pre-cutover body did (this day's coord + previous day's / start).
   *  Used only by the `viaLegacy` single-endpoint fallback. */
  points: [number, number][];
  /** `USE_FEDERATED_POIS`. Gates the federated merge (wired to
   *  `include.federated` on the resolver path; the raw merge on the fallback). */
  useFederated: boolean;
  /** Present iff `useFederated` — created by the route (the anon+JWT client the
   *  corridor RPC runs through). Null otherwise. */
  supabase: SupabaseClient | null;
  signal?: AbortSignal;
};

/** Produce the ranked `BrowsePlace[]` for the day's browse feed — always via
 *  `resolvePlaces()` (day-corridor scope), which delegates to the single-endpoint
 *  `viaLegacy` fallback only for a degenerate day with no `dayStart`. */
export async function produceBrowsePlaces(
  params: BrowseParams,
  deps: BrowseDeps = REAL_DEPS,
): Promise<BrowsePlace[]> {
  return viaResolver(params, deps);
}

// ── resolvePlaces() day-corridor scope ──────────────────────────────────

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

// ── FALLBACK: single-endpoint live discover-fanout (deps injected) ──────
// Reached ONLY from viaResolver when a day lacks `dayStart`/`dayEnd` — the
// resolver's day-corridor scope needs both. This path is LIVE-ONLY: the
// federated `pois_along_corridor` RPC also needs both endpoints, so it could
// never run in this degenerate case (the pre-cutover body short-circuited past
// it too). Not a flag-selected path — the TRIP_BROWSE_USE_RESOLVER flag is gone.

async function viaLegacy(
  params: BrowseParams,
  deps: BrowseDeps,
): Promise<BrowsePlace[]> {
  const { requested, points, dayStart, dayEnd, useFederated, signal } = params;

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
      // Tag live iff USE_FEDERATED_POIS, matching the pre-cutover edge
      // behaviour (federated rows themselves can't be fetched here — see above).
      return useFederated
        ? live.map<BrowsePlace>((p) => ({ ...p, source: "live" as const }))
        : live;
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
