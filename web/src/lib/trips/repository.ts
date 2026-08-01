import type { SupabaseClient } from "@supabase/supabase-js";
import { TRIPS, ensureAlaskaUpgraded } from "./fixtures";
import { getPersistedReferenceTrip, getReferenceTrip } from "./reference";
import {
  getUserTrip,
  isUserTripId,
  resetUserTripDayToReference,
  updateUserTripPayload,
  TRIP_CONFLICT,
  type TripConflict,
} from "./user-trips";
import { recomputeDay, type DayDerived } from "./recompute-day";
import * as curated from "./curated-place";
import {
  buildSplitStructure,
  rescopeTripOverlays,
  type SplitPoint,
} from "./split-day";
import { rebuildRoutePolyline } from "./route-rebuild";
import { resolveCorridorCities } from "./resolve-corridor-cities";
import type { LngLat, Route } from "@/lib/routing/route-between";
import type {
  Day,
  OvernightSelection,
  Trip,
  Waypoint,
} from "./types";

/** Injectable deps for the collapsed waypoint writers. `client` drives the
 *  read + guarded write under a caller-supplied (e.g. seeded-JWT) Supabase
 *  client; `route` overrides the Mapbox call inside `recomputeDay` for
 *  offline/deterministic verification. Both default to production behavior. */
type WaypointDeps = {
  client?: SupabaseClient;
  route?: (coords: LngLat[]) => Promise<Route>;
};

/** Compute a day's derived values (miles / driveHours / corridorCities) AS THEY
 *  WILL BE after `editDay` is applied — so a caller can persist the edit and its
 *  derived values in ONE guarded write (STEP 3: no torn intermediate a
 *  concurrent edit can straddle, no separate abandon-class second writer).
 *  Returns null when the day can't be routed — a Mapbox failure or unroutable
 *  day — and the caller then persists the edit alone (best-effort derived,
 *  exactly as the old decoupled recompute behaved: a routing hiccup never
 *  blocks the user's edit). */
async function deriveAfterDayEdit(
  tripId: string,
  dayId: string,
  editDay: (day: Day) => void,
  deps: WaypointDeps,
): Promise<DayDerived | null> {
  try {
    const current = isUserTripId(tripId)
      ? await getUserTrip(tripId, deps.client)
      : await getTrip(tripId);
    if (!current) return null;
    const postEdit = structuredClone(current);
    const day = postEdit.days.find((d) => d.id === dayId);
    if (!day) return null;
    editDay(day);
    return await recomputeDay(postEdit, dayId, { route: deps.route });
  } catch {
    return null;
  }
}

/** Apply precomputed derived values onto a day, in place. Null derived (routing
 *  failed) → leave the day's existing values stale (best-effort). Non-null →
 *  set all three, including `corridorCities: undefined` (a stale corridor
 *  describes the pre-edit route; clients fall back per spec decision F). */
function applyDerivedToDay(day: Day, derived: DayDerived | null): void {
  if (!derived) return;
  day.miles = derived.miles;
  day.driveHours = derived.driveHours;
  day.corridorCities = derived.corridorCities;
}

/**
 * Server-side trip repository. Async by design so callers don't
 * have to change when this module's impl swaps to a real API.
 *
 *   - Slug ids (e.g. "la-to-deadhorse") → in-memory fixtures
 *   - UUID ids → public.trips (forked user trips, RLS-scoped)
 */

export async function getTrip(id: string): Promise<Trip | null> {
  // User-owned trips (UUID) → DB under RLS.
  if (isUserTripId(id)) return getUserTrip(id);
  // THE FLIP (2026-07-25): reference trips serve DB-FIRST — `reference_trips`
  // is the source of truth, not the in-memory fixture (resolving the docs-say-
  // DB-first / code-was-fixture-first contradiction). la-to-deadhorse keeps the
  // snapshot-backed reader (committed-snapshot fallback + per-process memo);
  // every other reference slug reads `reference_trips` directly (null on miss
  // → 404). See docs/decisions for the migration record.
  if (id === "la-to-deadhorse") return getReferenceTrip(id);
  const ref = await getPersistedReferenceTrip(id);
  if (ref) return ref;
  // Anon wizard trips (`trip-<8char>`) live only in the in-memory store and are
  // NOT reference trips — resolve them last so a DB reference row always wins,
  // but an in-progress anon draft still renders.
  return TRIPS[id] ?? null;
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

/** Append a waypoint to a day AND its recomputed derived values in ONE write.
 *  Idempotent on waypoint id — re-adding the same id returns null (nothing
 *  changed). Clears the trip's `routePolyline` so the map redraws the route.
 *
 *  STEP 3 collapse: derived (miles/driveHours/corridorCities) is computed for
 *  the post-add day BEFORE the single guarded write and applied inside the same
 *  mutate — no separate `applyDayDerived` write spanning the Mapbox call. A
 *  routing failure yields null derived and the waypoint still persists (the
 *  edit is never blocked by a Mapbox hiccup). `retry`: by-id append composes,
 *  and derived is a deterministic function of the day, so re-applying it on a
 *  conflict-retry is safe (may be one generation stale, never torn). */
export async function addWaypoint(
  tripId: string,
  dayId: string,
  waypoint: Waypoint,
  deps: WaypointDeps = {},
): Promise<Waypoint | null> {
  const derived = await deriveAfterDayEdit(
    tripId,
    dayId,
    (day) => {
      if (!day.waypoints.some((wp) => wp.id === waypoint.id)) {
        day.waypoints.push(waypoint);
      }
    },
    deps,
  );
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(
      tripId,
      (trip) => {
        const next = structuredClone(trip);
        const day = next.days.find((d) => d.id === dayId);
        if (!day) return null;
        if (day.waypoints.some((wp) => wp.id === waypoint.id)) return null;
        day.waypoints.push(waypoint);
        applyDerivedToDay(day, derived);
        next.routePolyline = undefined;
        return next;
      },
      { onConflict: "retry", client: deps.client },
    );
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
  applyDerivedToDay(day, derived);
  trip.routePolyline = undefined;
  return waypoint;
}

/** Remove a waypoint by id from a day AND its recomputed derived values in ONE
 *  write. Returns true if removed, false if trip/day/waypoint not found. Clears
 *  `routePolyline`. Same STEP 3 collapse as `addWaypoint`: derived precomputed
 *  for the post-remove day, applied in the single guarded write; a routing
 *  failure still persists the removal. `retry`: by-id removal composes. */
export async function removeWaypoint(
  tripId: string,
  dayId: string,
  waypointId: string,
  deps: WaypointDeps = {},
): Promise<boolean> {
  const derived = await deriveAfterDayEdit(
    tripId,
    dayId,
    (day) => {
      const idx = day.waypoints.findIndex((wp) => wp.id === waypointId);
      if (idx !== -1) day.waypoints.splice(idx, 1);
    },
    deps,
  );
  if (isUserTripId(tripId)) {
    const updated = await updateUserTripPayload(
      tripId,
      (trip) => {
        const next = structuredClone(trip);
        const day = next.days.find((d) => d.id === dayId);
        if (!day) return null;
        const idx = day.waypoints.findIndex((wp) => wp.id === waypointId);
        if (idx === -1) return null;
        day.waypoints.splice(idx, 1);
        applyDerivedToDay(day, derived);
        next.routePolyline = undefined;
        return next;
      },
      { onConflict: "retry", client: deps.client },
    );
    return updated !== null;
  }
  const trip = TRIPS[tripId];
  if (!trip) return false;
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return false;
  const idx = day.waypoints.findIndex((wp) => wp.id === waypointId);
  if (idx === -1) return false;
  day.waypoints.splice(idx, 1);
  applyDerivedToDay(day, derived);
  trip.routePolyline = undefined;
  return true;
}

/** Move a curated POI (a `segmentSuggestions` entry — OVERLAY, not a routed
 *  waypoint) from one day to another. GEOMETRY-FREE: no Mapbox, no `routePolyline`
 *  touch — the pure move + overlay rescope (`curated.moveCuratedPlace`) then a pure
 *  `resolveCorridorCities` re-bake, all inside ONE guarded write. `retry`: the
 *  by-id splice composes. UUID user trips only — reference/slug trips are read-only
 *  templates (no edit control renders on them). Returns false if not found. */
export async function moveCuratedPlace(
  tripId: string,
  fromDayId: string,
  toDayId: string,
  placeId: string,
  deps: { client?: SupabaseClient } = {},
): Promise<boolean> {
  if (!isUserTripId(tripId)) return false;
  const updated = await updateUserTripPayload(
    tripId,
    (trip) => {
      const moved = curated.moveCuratedPlace(trip, fromDayId, toDayId, placeId);
      return moved ? resolveCorridorCities(moved) : null;
    },
    { onConflict: "retry", client: deps.client },
  );
  return updated !== null;
}

/** Remove a curated POI (a `segmentSuggestions` entry) from a day. Same
 *  geometry-free, rescope-then-rebake, single guarded write as `moveCuratedPlace`.
 *  UUID user trips only. Returns false if not found. */
export async function removeCuratedPlace(
  tripId: string,
  dayId: string,
  placeId: string,
  deps: { client?: SupabaseClient } = {},
): Promise<boolean> {
  if (!isUserTripId(tripId)) return false;
  const updated = await updateUserTripPayload(
    tripId,
    (trip) => {
      const removed = curated.removeCuratedPlace(trip, dayId, placeId);
      return removed ? resolveCorridorCities(removed) : null;
    },
    { onConflict: "retry", client: deps.client },
  );
  return updated !== null;
}

export type SplitDayResult =
  | {
      ok: true;
      halfAId: string;
      halfBId: string;
      /** Which half (if any) fell back to straight-line miles + null driveHours
       *  because its leg was unroutable — reported, never swallowed. */
      fellBack: { halfA: boolean; halfB: boolean };
    }
  | {
      ok: false;
      reason:
        | "not-user-trip"
        | "not-found"
        | "day-not-found"
        | "conflict"
        | "write-failed";
    };

/**
 * Subdivide a leg: cut day `dayId` (A→B) at interior point `split` into two
 * sequential days A→M and M→B. All days after B keep their exact endpoints; the
 * tail renumbers `day-N → day-N+1` and redates `+1`. Two `recomputeDay` calls
 * (one per half, with the unroutable→Haversine fallback), a full parallel
 * `routePolyline` rebuild, and a SINGLE guarded write.
 *
 * `onConflict: "refuse"` — this is a positional/structural rewrite (insert +
 * renumber), which a blind retry could tear; a concurrent edit returns a conflict
 * rather than risking a torn insert. Geometry is precomputed OUTSIDE the write
 * (STEP-3 collapse); under `refuse` the write lands only when the version still
 * matches the snapshot the geometry was computed against, so it is never stale.
 * UUID user trips only.
 */
export async function splitDay(
  tripId: string,
  dayId: string,
  split: SplitPoint,
  deps: {
    client?: SupabaseClient;
    route?: (coords: LngLat[]) => Promise<Route>;
  } = {},
): Promise<SplitDayResult> {
  if (!isUserTripId(tripId)) return { ok: false, reason: "not-user-trip" };
  const current = await getUserTrip(tripId, deps.client);
  if (!current) return { ok: false, reason: "not-found" };

  const structured = buildSplitStructure(current, dayId, split);
  if (!structured) return { ok: false, reason: "day-not-found" };
  const { trip: staged, halfAId, halfBId } = structured;

  // Precompute geometry OUTSIDE the guarded write (STEP-3 collapse).
  const rc = { route: deps.route, unroutableFallback: true } as const;
  const derivedA = await recomputeDay(staged, halfAId, rc);
  const derivedB = await recomputeDay(staged, halfBId, rc);
  applyDerivedToDay(staged.days.find((d) => d.id === halfAId)!, derivedA);
  applyDerivedToDay(staged.days.find((d) => d.id === halfBId)!, derivedB);
  // Rescope overlays AFTER both halves have their rebuilt corridorCities.
  const withOverlays = rescopeTripOverlays(staged);
  const routePolyline = await rebuildRoutePolyline(withOverlays, {
    route: deps.route,
  });

  const fellBack = {
    halfA: derivedA?.fellBack ?? false,
    halfB: derivedB?.fellBack ?? false,
  };
  if (fellBack.halfA || fellBack.halfB) {
    const legs = [fellBack.halfA && halfAId, fellBack.halfB && halfBId]
      .filter(Boolean)
      .join(", ");
    console.warn(
      `[splitDay] unroutable leg(s) ${legs} — straight-line miles, driveHours=null`,
    );
  }

  const written = await updateUserTripPayload(
    tripId,
    (fresh) => {
      const s = buildSplitStructure(fresh, dayId, split);
      if (!s) return null;
      applyDerivedToDay(s.trip.days.find((d) => d.id === halfAId)!, derivedA);
      applyDerivedToDay(s.trip.days.find((d) => d.id === halfBId)!, derivedB);
      const rescoped = rescopeTripOverlays(s.trip);
      rescoped.routePolyline = routePolyline;
      return rescoped;
    },
    { onConflict: "refuse", client: deps.client },
  );
  if (written === TRIP_CONFLICT) return { ok: false, reason: "conflict" };
  if (!written) return { ok: false, reason: "write-failed" };
  return { ok: true, halfAId, halfBId, fellBack };
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
