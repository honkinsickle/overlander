import { TRIPS, ensureAlaskaUpgraded } from "./fixtures";
import { getPersistedReferenceTrip } from "./reference";
import {
  getUserTrip,
  isUserTripId,
  resetUserTripDayToReference,
  updateUserTripPayload,
  TRIP_CONFLICT,
  type TripConflict,
} from "./user-trips";
import type {
  CorridorCity,
  Day,
  OvernightSelection,
  Trip,
  Waypoint,
} from "./types";

/**
 * Server-side trip repository. Async by design so callers don't
 * have to change when this module's impl swaps to a real API.
 *
 *   - Slug ids (e.g. "la-to-deadhorse") → in-memory fixtures
 *   - UUID ids → public.trips (forked user trips, RLS-scoped)
 */

export async function getTrip(id: string): Promise<Trip | null> {
  if (id === "la-to-deadhorse") await ensureAlaskaUpgraded();
  if (TRIPS[id]) return TRIPS[id];
  if (isUserTripId(id)) return getUserTrip(id);
  // Generated/persisted reference trips (e.g. a YoTrippin itinerary upserted
  // into reference_trips). Null on miss — unknown ids still 404.
  return getPersistedReferenceTrip(id);
}

/** Look up a waypoint anywhere in a trip by slug. */
export async function getWaypoint(
  tripId: string,
  slug: string,
): Promise<Waypoint | null> {
  if (tripId === "la-to-deadhorse") await ensureAlaskaUpgraded();
  const trip = TRIPS[tripId];
  if (!trip) return null;
  for (const day of trip.days) {
    const hit = day.waypoints.find((w) => w.slug === slug);
    if (hit) return hit;
  }
  return null;
}

export async function listOvernightAlternatives(
  tripId: string,
  dayId: string,
): Promise<OvernightSelection | null> {
  if (tripId === "la-to-deadhorse") await ensureAlaskaUpgraded();
  const trip = TRIPS[tripId];
  if (!trip) return null;
  const day = trip.days.find((d) => d.id === dayId);
  return day?.overnight ?? null;
}

/** Flat {slug: waypoint} map — useful to pass to client components
 *  that need to render detail for any slug via search params. */
export async function getWaypointsBySlug(
  tripId: string,
): Promise<Record<string, Waypoint>> {
  if (tripId === "la-to-deadhorse") await ensureAlaskaUpgraded();
  const trip = TRIPS[tripId];
  if (!trip) return {};
  const out: Record<string, Waypoint> = {};
  for (const day of trip.days) {
    for (const wp of day.waypoints) out[wp.slug] = wp;
  }
  return out;
}

// ── Mutations ─────────────────────────────────────────────────────────
// Each mutator dispatches on `isUserTripId`:
//   - UUID → read-modify-write on public.trips.payload via RLS-scoped
//     server client. Persists across restarts.
//   - slug → in-memory mutation of the fixture object. Survives the
//     process but resets on server restart.
// The fixture path's semantics are mirrored exactly in the UUID path —
// no renumbering or date recomputation on delete (M3 territory).

/** Update a day's `label`. Returns the updated day, or null if not found. */
export async function renameDay(
  tripId: string,
  dayId: string,
  label: string,
): Promise<Day | TripConflict | null> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(
      tripId,
      (trip) => {
        const next = structuredClone(trip);
        const day = next.days.find((d) => d.id === dayId);
        if (!day) return null;
        day.label = label;
        return next;
      },
      { onConflict: "refuse" }, // absolute set of day.label
    );
    if (updated === TRIP_CONFLICT) return TRIP_CONFLICT;
    return updated?.days.find((d) => d.id === dayId) ?? null;
  }
  const day = TRIPS[tripId]?.days.find((d) => d.id === dayId);
  if (!day) return null;
  day.label = label;
  return day;
}

/** Remove a day. Returns true if deleted, false if trip/day not found. */
export async function removeDay(
  tripId: string,
  dayId: string,
): Promise<boolean> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(tripId, (trip) => {
      const next = structuredClone(trip);
      const idx = next.days.findIndex((d) => d.id === dayId);
      if (idx === -1) return null;
      next.days.splice(idx, 1);
      return next;
    }, { onConflict: "retry" }); // by-id removal composes
    return updated !== null;
  }
  if (tripId === "la-to-deadhorse") await ensureAlaskaUpgraded();
  const trip = TRIPS[tripId];
  if (!trip) return false;
  const idx = trip.days.findIndex((d) => d.id === dayId);
  if (idx === -1) return false;
  trip.days.splice(idx, 1);
  return true;
}

/** Append a waypoint to a day. Idempotent on waypoint id — re-adding
 *  the same id returns null (nothing changed). Clears the trip's
 *  `routePolyline` so the map redraws the route on next render. */
export async function addWaypoint(
  tripId: string,
  dayId: string,
  waypoint: Waypoint,
): Promise<Waypoint | null> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(tripId, (trip) => {
      const next = structuredClone(trip);
      const day = next.days.find((d) => d.id === dayId);
      if (!day) return null;
      if (day.waypoints.some((wp) => wp.id === waypoint.id)) return null;
      day.waypoints.push(waypoint);
      next.routePolyline = undefined;
      return next;
    }, { onConflict: "retry" }); // by-id append composes
    return (
      updated?.days
        .find((d) => d.id === dayId)
        ?.waypoints.find((wp) => wp.id === waypoint.id) ?? null
    );
  }
  const trip = TRIPS[tripId];
  if (!trip) return null;
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return null;
  if (day.waypoints.some((wp) => wp.id === waypoint.id)) return null;
  day.waypoints.push(waypoint);
  trip.routePolyline = undefined;
  return waypoint;
}

/** Remove a waypoint by id from a day. Returns true if removed, false
 *  if trip/day/waypoint not found. Clears `routePolyline`. */
export async function removeWaypoint(
  tripId: string,
  dayId: string,
  waypointId: string,
): Promise<boolean> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(tripId, (trip) => {
      const next = structuredClone(trip);
      const day = next.days.find((d) => d.id === dayId);
      if (!day) return null;
      const idx = day.waypoints.findIndex((wp) => wp.id === waypointId);
      if (idx === -1) return null;
      day.waypoints.splice(idx, 1);
      next.routePolyline = undefined;
      return next;
    }, { onConflict: "retry" }); // by-id removal composes
    return updated !== null;
  }
  const trip = TRIPS[tripId];
  if (!trip) return false;
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return false;
  const idx = day.waypoints.findIndex((wp) => wp.id === waypointId);
  if (idx === -1) return false;
  day.waypoints.splice(idx, 1);
  trip.routePolyline = undefined;
  return true;
}

/** Apply edit-time recomputed derived values to one day (Phase 0 —
 *  see lib/trips/recompute-day.ts). Sets `miles` / `driveHours` and
 *  REPLACES `corridorCities` (including with undefined: a stale
 *  corridor describes the pre-edit route; clients fall back per spec
 *  decision F). Does not touch `routePolyline` — the edit mutator
 *  already cleared it. */
export async function applyDayDerived(
  tripId: string,
  dayId: string,
  derived: {
    miles: number;
    driveHours: number;
    corridorCities?: CorridorCity[];
  },
): Promise<boolean> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(tripId, (trip) => {
      const next = structuredClone(trip);
      const day = next.days.find((d) => d.id === dayId);
      if (!day) return null;
      day.miles = derived.miles;
      day.driveHours = derived.driveHours;
      day.corridorCities = derived.corridorCities;
      return next;
    }, { onConflict: "abandon" }); // best-effort; a conflict means this derived is stale
    return updated !== null;
  }
  const day = TRIPS[tripId]?.days.find((d) => d.id === dayId);
  if (!day) return false;
  day.miles = derived.miles;
  day.driveHours = derived.driveHours;
  day.corridorCities = derived.corridorCities;
  return true;
}

/** Reset a single day in a user trip back to its reference content.
 *  UUID-only: slug trips ARE the reference, nothing to reset. Returns
 *  false if the trip has no `reference_id`, the day id doesn't exist
 *  in either trip, or the write fails. */
export async function resetDayToReference(
  tripId: string,
  dayId: string,
): Promise<boolean | TripConflict> {
  if (!isUserTripId(tripId)) return false;
  return resetUserTripDayToReference(tripId, dayId);
}

/** Promote an overnight (from selected or alternatives) to `selected`.
 *  Returns the updated selection, or null if anything wasn't found. */
export async function pickOvernight(
  tripId: string,
  dayId: string,
  overnightId: string,
): Promise<OvernightSelection | TripConflict | null> {
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(
      tripId,
      (trip) => {
        const next = structuredClone(trip);
        const day = next.days.find((d) => d.id === dayId);
        if (!day?.overnight) return null;
        const all = [day.overnight.selected, ...day.overnight.alternatives];
        const picked = all.find((o) => o.id === overnightId);
        if (!picked) return null;
        const rest = all.filter((o) => o.id !== overnightId);
        day.overnight = { selected: picked, alternatives: rest };
        return next;
      },
      { onConflict: "refuse" }, // absolute set of day.overnight
    );
    if (updated === TRIP_CONFLICT) return TRIP_CONFLICT;
    return updated?.days.find((d) => d.id === dayId)?.overnight ?? null;
  }
  const day = TRIPS[tripId]?.days.find((d) => d.id === dayId);
  if (!day?.overnight) return null;
  const all = [day.overnight.selected, ...day.overnight.alternatives];
  const picked = all.find((o) => o.id === overnightId);
  if (!picked) return null;
  const rest = all.filter((o) => o.id !== overnightId);
  day.overnight = { selected: picked, alternatives: rest };
  return day.overnight;
}

/** Insert a fully-formed Trip into the store. Used by the planning
 *  finalize step to promote a draft into a real Trip. Returns the trip. */
export async function createTrip(trip: Trip): Promise<Trip> {
  TRIPS[trip.id] = trip;
  return trip;
}
