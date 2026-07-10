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

  const days = await Promise.all(
    trip.days.map(async (day, i) => {
      const start = i === 0 ? trip.startCoords : trip.days[i - 1].coords;
      const end = day.coords;
      if (!start || !end) return day;
      try {
        const { data, error } = await supabase.rpc("pois_along_corridor", {
          p_route: { type: "LineString", coordinates: [start, end] },
          p_buffer_m: 16000,
          p_categories: null,
        });
        if (error || !data) return day;
        const seen = new Set((day.segmentSuggestions ?? []).map((p) => p.id));
        const corpus = (data as MasterPlaceRow[])
          .filter((r) => !isSuppressedCategory(r.primary_category))
          .map((r) =>
            mapMasterPlaceRow(r, primaryCategoryToSlideKey(r.primary_category)),
          )
          .filter((p) => !seen.has(p.id));
        if (corpus.length === 0) return day;
        return {
          ...day,
          segmentSuggestions: [...(day.segmentSuggestions ?? []), ...corpus],
        };
      } catch {
        return day;
      }
    }),
  );
  return { ...trip, days };
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
