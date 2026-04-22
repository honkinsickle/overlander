import { TRIPS } from "./fixtures";
import type { Trip, Day, Waypoint, OvernightSelection } from "./types";

/**
 * Server-side trip repository. Async by design so callers don't
 * have to change when this module's impl swaps to a real API.
 */

export async function getTrip(id: string): Promise<Trip | null> {
  return TRIPS[id] ?? null;
}

/** Look up a waypoint anywhere in a trip by slug. */
export async function getWaypoint(
  tripId: string,
  slug: string,
): Promise<Waypoint | null> {
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
  const trip = TRIPS[tripId];
  if (!trip) return {};
  const out: Record<string, Waypoint> = {};
  for (const day of trip.days) {
    for (const wp of day.waypoints) out[wp.slug] = wp;
  }
  return out;
}

// ── Mutations ─────────────────────────────────────────────────────────
// In-memory mutation of the fixture object. Survives the process but
// resets on server restart. Swap for a real store by replacing these
// bodies and keeping the signatures intact.

/** Update a day's `label`. Returns the updated day, or null if not found. */
export async function renameDay(
  tripId: string,
  dayId: string,
  label: string,
): Promise<Day | null> {
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
  const trip = TRIPS[tripId];
  if (!trip) return false;
  const idx = trip.days.findIndex((d) => d.id === dayId);
  if (idx === -1) return false;
  trip.days.splice(idx, 1);
  return true;
}

/** Promote an overnight (from selected or alternatives) to `selected`.
 *  Returns the updated selection, or null if anything wasn't found. */
export async function pickOvernight(
  tripId: string,
  dayId: string,
  overnightId: string,
): Promise<OvernightSelection | null> {
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
