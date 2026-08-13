import type { Trip } from "./types";
import { resolveCorridorCities } from "./resolve-corridor-cities";
import { isConfigured } from "@/lib/supabase/env";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  mapMasterPlaceRow,
  primaryCategoryToSlideKey,
  isSuppressedCategory,
  type MasterPlaceRow,
} from "@/lib/trip-browse/federated";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import {
  decodePolyline,
  haversineMi,
  alongRouteMiles,
} from "@/lib/routing/point-to-polyline";

/** The cookie-backed server client both the reference serve and the fork
 *  route already hold. Typed off `createSupabaseServerClient` so callers
 *  pass exactly what they have — no @supabase/supabase-js generic drift. */
type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** True when a payload already carries a derived spine. The fork route
 *  copies such a source VERBATIM (no re-derive); only spine-less legacy
 *  sources get baked. Mirrors reference.ts `withCorridors`'s serve guard. */
export function hasBakedCorridors(trip: Trip): boolean {
  return trip.days.some((d) => d.corridorCities != null);
}

/** True when the corpus fold already ran — `segmentSuggestions` carries
 *  `mp:` corpus tiles. Lets the serve path skip re-folding a reseeded
 *  reference (the fold would fire ~66 RPCs to add nothing, deduped). */
function hasBakedCorpusTiles(trip: Trip): boolean {
  return trip.days.some((d) =>
    (d.segmentSuggestions ?? []).some(
      (p) => typeof p.id === "string" && p.id.startsWith("mp:"),
    ),
  );
}

/** Strip baked corridor artifacts so a reseed re-bakes from clean input
 *  (re-runnable after a derivation change — the fold/serve skip-guards key
 *  off these markers, so a reseed must clear them first). Drops
 *  `corridorCities` and the folded `mp:` corpus; preserves authored data. */
export function stripBakedCorridors(trip: Trip): Trip {
  return {
    ...trip,
    days: trip.days.map((d) => {
      const next = { ...d };
      delete next.corridorCities;
      next.segmentSuggestions = (d.segmentSuggestions ?? []).filter(
        (p) => !(typeof p.id === "string" && p.id.startsWith("mp:")),
      );
      return next;
    }),
  };
}

/**
 * Per-day polyline slices for the union fetch below — a forward-cursor walk
 * over `trip.routePolyline`, mirroring `resolveCorridorCities`'s PASS 1
 * (resolve-corridor-cities.ts) exactly: same cumulative-mile table, same
 * `idxAtMile` binary search, same end-projection cap (`day.miles * 1.5 +
 * 25`), same "day can't be sliced → null, cursor doesn't advance" rule.
 *
 * NOT calling `resolveCorridorCities` directly — it returns a whole `Trip`
 * with derived `corridorCities`/bucketed tiles, not the raw per-day slice
 * array this needs. `idxAtMile` is a private closure inside that file (not
 * exported), so the walk is reproduced here rather than imported; if the
 * slicing math there changes, this needs the same change. A future
 * extraction (export a shared `sliceDayFromPolyline` helper) would remove
 * the duplication — not done here to keep this change scoped to the fold.
 *
 * Computed as a single synchronous pre-pass (no `await` anywhere in this
 * function) specifically so the stateful `cursor` walks in strict day order
 * BEFORE `foldFederatedCorridorSupply`'s `Promise.all` below starts firing
 * concurrent per-day RPC calls — a stateful cursor threaded through
 * concurrent async callbacks would not be safe to reason about.
 */
function sliceDayPolylines(trip: Trip): ([number, number][] | null)[] {
  if (!trip.routePolyline) return trip.days.map(() => null);
  const line = decodePolyline(trip.routePolyline);
  if (line.length < 2) return trip.days.map(() => null);

  const cumMi: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cumMi.push(cumMi[i - 1] + haversineMi(line[i - 1], line[i]));
  }
  const idxAtMile = (mi: number, from: number): number => {
    const target = cumMi[from] + mi;
    let lo = from;
    let hi = cumMi.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumMi[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let cursor = 0;
  return trip.days.map((day, i) => {
    const startCoord =
      day.startCoord ??
      (i === 0 ? trip.startCoords : trip.days[i - 1].coords);
    const endCoord = day.coords;
    if (!startCoord || !endCoord) return null;
    const window = line.slice(cursor);
    if (window.length < 2) return null;
    const a = alongRouteMiles(startCoord, window);
    if (!a) return null;
    const endCapIdx = day.miles
      ? idxAtMile(a.miles + day.miles * 1.5 + 25, cursor)
      : line.length - 1;
    const endWindow = line.slice(cursor, endCapIdx + 1);
    if (endWindow.length < 2) return null;
    const b = alongRouteMiles(endCoord, endWindow);
    if (!b || b.miles <= a.miles) return null;
    const iA = idxAtMile(a.miles, cursor);
    const iB = idxAtMile(b.miles, cursor);
    if (iB - iA < 1) return null;
    const daySlice = line.slice(iA, iB + 1);
    cursor = iB;
    return daySlice;
  });
}

/**
 * Fold federated master_place POIs into each day's `segmentSuggestions`
 * (flag `USE_FEDERATED_CORRIDOR`). Extracted verbatim from reference.ts's
 * private `withFederatedCorridorSupply` so the SAME fold runs at two call
 * sites: the reference serve (live-at-serve) and the fork route
 * (bake-at-create). The only change is the supabase client is INJECTED —
 * the reference serve news up its own, the fork route reuses its
 * per-request client.
 *
 * Corpus is essentials-only (no ratings/photos); tiles render
 * name/category/description with a placeholder image and no stars until
 * the P3 client hydrate grafts live fields. Fails soft — any per-day RPC
 * error leaves that day untouched.
 *
 * UNION FETCH (2026-08-12): a straight start→end chord's 16 km buffer
 * misses POIs where the road curves away from it (see
 * `fetchCorpusForPolyline`'s docstring — the Cassiar fuel pumps are the
 * canonical case). Every day additionally fetches along its own polyline
 * slice at the SAME buffer/category filter (both calls route through
 * `fetchCorpusForPolyline`, so there is nothing to keep in sync) and unions
 * the results by `BrowsePlace.id` (the `mp:<master_place.id>` prefixed id
 * both fetches already return — the RPC's raw row id is `id`, mapped to
 * `mp:${id}` by `mapMasterPlaceRow` inside `fetchCorpusForPolyline` before
 * either fetch returns). Chord tiles are kept unconditionally; the polyline
 * fetch only ADDS ids not already present — never removes a chord tile.
 *
 * Polyline failure degrades to the chord-only result at TWO possible
 * scopes, both guarded: a per-day polyline FETCH failure (the RPC call
 * itself throwing) drops only that day back to chord-only, logged per day;
 * a polyline SLICING failure (`sliceDayPolylines` throwing, before any
 * per-day work starts) drops the WHOLE TRIP back to chord-only for every
 * day — same effect a missing `routePolyline` already has — logged once.
 * Neither failure mode ever removes a tile the pre-union fold would have
 * kept; both only forfeit the polyline-sourced addition.
 */
export async function foldFederatedCorridorSupply(
  trip: Trip,
  supabase: ServerClient,
): Promise<Trip> {
  if (process.env.USE_FEDERATED_CORRIDOR !== "true") return trip;
  if (!isConfigured()) return trip;
  // Serve fold-skip: a reseeded (baked) reference already carries the folded
  // mp: corpus. Re-folding would fire ~66 RPCs to add nothing (deduped), so
  // skip. A reseed strips these markers first (stripBakedCorridors), so the
  // bake-time fold still runs.
  if (hasBakedCorpusTiles(trip)) return trip;

  // Synchronous pre-pass — see sliceDayPolylines' docstring for why this
  // must run before the concurrent Promise.all below, not inside it.
  // Defense-in-depth, matching the per-day fetch catch below: none of
  // decodePolyline/haversineMi/alongRouteMiles currently throw (verified —
  // they degrade to NaN/null on malformed input, never throw), but this
  // function's whole-trip failure mode has no other guard, and every other
  // fetch path in this file is explicitly try/caught. On failure, fall back
  // to chord-only for every day (the same shape a missing routePolyline
  // already produces) rather than let the whole fold throw.
  let sliceByIdx: ([number, number][] | null)[];
  try {
    sliceByIdx = sliceDayPolylines(trip);
  } catch (err) {
    console.warn(`[fold] polyline slicing failed for trip ${trip.id}:`, err);
    sliceByIdx = trip.days.map(() => null);
  }

  const days = await Promise.all(
    trip.days.map(async (day, i) => {
      const start = i === 0 ? trip.startCoords : trip.days[i - 1].coords;
      const end = day.coords;
      if (!start || !end) return day;
      const seen = new Set((day.segmentSuggestions ?? []).map((p) => p.id));
      const chordCorpus = (
        await fetchCorpusForSegment(start, end, supabase)
      ).filter((p) => !seen.has(p.id));

      const byId = new Map(chordCorpus.map((p) => [p.id, p]));
      const slice = sliceByIdx[i];
      if (slice) {
        try {
          const polylineCorpus = await fetchCorpusForPolyline(slice, supabase);
          for (const p of polylineCorpus) {
            if (!seen.has(p.id) && !byId.has(p.id)) byId.set(p.id, p);
          }
        } catch (err) {
          // Defense-in-depth: fetchCorpusForPolyline already fails soft
          // (returns [] on any RPC error, never throws) — this catch is for
          // an unexpected failure in that contract. Either way the chord
          // result in `byId` is untouched; this day just doesn't gain the
          // polyline supply this run.
          console.warn(`[fold] polyline fetch failed for day ${day.dayNumber}:`, err);
        }
      }
      const corpus = [...byId.values()];

      if (corpus.length === 0) return day;
      return {
        ...day,
        segmentSuggestions: [...(day.segmentSuggestions ?? []), ...corpus],
      };
    }),
  );
  return { ...trip, days };
}

/**
 * Fetch the essentials-only master_place corpus within the corridor buffer
 * of a single [start,end] segment, mapped to BrowsePlace. Shared by the
 * per-day fold above and the wizard-finalize corpus merge
 * (buildRouteAwareDays). Fails soft — returns [] on any RPC error.
 */
export async function fetchCorpusForSegment(
  start: [number, number],
  end: [number, number],
  supabase: ServerClient,
): Promise<BrowsePlace[]> {
  return fetchCorpusForPolyline([start, end], supabase);
}

/**
 * Same corridor query as {@link fetchCorpusForSegment} but along an arbitrary
 * polyline. A straight 2-point chord's 16 km buffer misses POIs where the
 * road curves away from it by >16 km (the Cassiar fuel pumps are the canonical
 * case). Passing the ACTUAL route geometry (even downsampled) buffers the road
 * itself, so on-corridor POIs are caught. Fails soft → [] on any RPC error.
 */
export async function fetchCorpusForPolyline(
  coordinates: [number, number][],
  supabase: ServerClient,
): Promise<BrowsePlace[]> {
  try {
    const { data, error } = await supabase.rpc("pois_along_corridor", {
      p_route: { type: "LineString", coordinates },
      p_buffer_m: 16000,
      p_categories: null,
    });
    if (error || !data) return [];
    return (data as MasterPlaceRow[])
      .filter((r) => !isSuppressedCategory(r.primary_category))
      .map((r) =>
        mapMasterPlaceRow(r, primaryCategoryToSlideKey(r.primary_category)),
      );
  } catch {
    return [];
  }
}

/**
 * Bake corridors into a payload at trip-creation time (fork). Fold corpus
 * → `segmentSuggestions`, then derive the spine + bucket places — the same
 * two steps, in the same order, that the reference serve runs
 * (`withCorridors(await withFederatedCorridorSupply(...))`), but persisted
 * into the new trip's stored payload instead of computed per-serve.
 *
 * This is what makes a user trip EDITABLE: the edit machinery
 * (recomputeDay / add-waypoint) operates on stored `corridorCities`, so a
 * baked fork behaves exactly like a wizard-finalize trip. The reference
 * trip derives at serve precisely because it is read-only.
 *
 * `resolveCorridorCities` needs `trip.routePolyline`; fresh forks carry it
 * (it lives in `reference_trips.payload`). If it were absent the resolver
 * returns the trip unchanged — a safe no-op, never a throw.
 */
export async function bakeCorridors(
  trip: Trip,
  supabase: ServerClient,
): Promise<Trip> {
  const folded = await foldFederatedCorridorSupply(trip, supabase);
  return resolveCorridorCities(folded);
}
