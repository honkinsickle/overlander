"use server";

import { revalidatePath } from "next/cache";
import * as repo from "./repository";
import { addedPlaceToWaypoint, type AddedPlace } from "./added-place";
import {
  isUserTripId,
  updateUserTripPayload,
  TRIP_CONFLICT,
  TRIP_CHANGED_ERROR,
} from "./user-trips";
import { checkNotFrozen } from "@/lib/itinerary/rails";
import type { SplitPoint } from "./split-day";
import type { OfflinePhase } from "./types";

/**
 * Server Actions for trip mutations.
 *
 * Each action returns a discriminated union so callers handle errors
 * without throwing. Actions call `revalidatePath` on success so any
 * RSC tree under /trip/:id re-fetches on the next render.
 */

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function renameDayAction(
  tripId: string,
  dayId: string,
  rawLabel: string,
): Promise<ActionResult> {
  const label = rawLabel.trim();
  if (!label) return { ok: false, error: "Day label cannot be empty." };
  if (label.length > 120) {
    return { ok: false, error: "Day label must be under 120 characters." };
  }
  const day = await repo.renameDay(tripId, dayId, label);
  if (day === TRIP_CONFLICT) return { ok: false, error: TRIP_CHANGED_ERROR };
  if (!day) return { ok: false, error: "Day not found." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function deleteDayAction(
  tripId: string,
  dayId: string,
): Promise<ActionResult> {
  const ok = await repo.removeDay(tripId, dayId);
  if (!ok) return { ok: false, error: "Day not found." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function moveCuratedPlaceAction(
  tripId: string,
  fromDayId: string,
  toDayId: string,
  placeId: string,
): Promise<ActionResult> {
  // PROPERTY guard only — frozen trip refused, user-trip edits keep working.
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  if (fromDayId === toDayId) return { ok: false, error: "Already on that day." };
  // Geometry-free: curated POIs are overlay (segmentSuggestions), not routed
  // waypoints — the guarded write moves the entry, rescopes overlays, re-bakes
  // the spine. No Mapbox. (Moved stop lands unranked+unpinned on the new day.)
  const ok = await repo.moveCuratedPlace(tripId, fromDayId, toDayId, placeId);
  if (!ok) return { ok: false, error: "Could not move place." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function removeCuratedPlaceAction(
  tripId: string,
  dayId: string,
  placeId: string,
): Promise<ActionResult> {
  // PROPERTY guard only — frozen trip refused, user-trip edits keep working.
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  const ok = await repo.removeCuratedPlace(tripId, dayId, placeId);
  if (!ok) return { ok: false, error: "Could not remove place." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function pickOvernightAction(
  tripId: string,
  dayId: string,
  overnightId: string,
): Promise<ActionResult> {
  const updated = await repo.pickOvernight(tripId, dayId, overnightId);
  if (updated === TRIP_CONFLICT) return { ok: false, error: TRIP_CHANGED_ERROR };
  if (!updated) return { ok: false, error: "Overnight not found." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function addWaypointAction(
  tripId: string,
  dayId: string,
  place: AddedPlace,
): Promise<ActionResult> {
  // PROPERTY guard only (not the phase guards): this is a shipped user-trip path,
  // so the frozen PROD trip is refused everywhere, but legitimate user-trip edits
  // keep working in prod. See rails.ts.
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  if (!place?.id || !place?.title) {
    return { ok: false, error: "Missing place." };
  }
  const waypoint = addedPlaceToWaypoint(place);
  // STEP 3: repo.addWaypoint persists the waypoint AND its recomputed derived
  // values in one guarded write — no separate best-effort recompute pass.
  const added = await repo.addWaypoint(tripId, dayId, waypoint);
  if (!added) return { ok: false, error: "Could not add stop." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function removeWaypointAction(
  tripId: string,
  dayId: string,
  waypointId: string,
): Promise<ActionResult> {
  // PROPERTY guard only — frozen trip refused, user-trip edits keep working.
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  // STEP 3: derived recompute folded into the single guarded removeWaypoint write.
  const ok = await repo.removeWaypoint(tripId, dayId, waypointId);
  if (!ok) return { ok: false, error: "Could not remove stop." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

/** Shared reason → user message for the structural day-insert actions (split +
 *  rest day). Both repository results carry the identical reason union. Note there
 *  is NO explicit `getUser()` here — as with `addWaypointAction`, ownership is
 *  enforced at the repo write by the RLS-scoped client (an anon or non-owner caller
 *  reads null and surfaces "not-found"), so no shipped mutation action gates on the
 *  session directly. (The handoff's "getUser()" describes intent, not the pattern.) */
function dayInsertError(
  reason: "not-user-trip" | "not-found" | "day-not-found" | "conflict" | "write-failed",
): string {
  switch (reason) {
    case "not-user-trip":
      return "You can only edit your own trips.";
    case "not-found":
      return "Trip not found.";
    case "day-not-found":
      return "Day not found.";
    case "conflict":
      return TRIP_CHANGED_ERROR;
    case "write-failed":
      return "Could not save. Please try again.";
  }
}

/** Split a day at an interior point into two sequential days (A→M, M→B). The
 *  `split` point is a stop the caller already has on the day, so the common path
 *  needs no geocoding. PROPERTY guard only — a structural rewrite must never touch
 *  the frozen PROD trip. `fellBack` is surfaced so the UI can warn when a half's
 *  leg was unroutable (straight-line miles, no drive time). */
export async function splitDayAction(
  tripId: string,
  dayId: string,
  split: SplitPoint,
): Promise<ActionResult<{ halfAId: string; halfBId: string; fellBack: { halfA: boolean; halfB: boolean } }>> {
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  if (!split?.name || !Array.isArray(split.coords) || split.coords.length !== 2) {
    return { ok: false, error: "Pick a point to split at." };
  }
  const result = await repo.splitDay(tripId, dayId, split);
  if (!result.ok) return { ok: false, error: dayInsertError(result.reason) };
  revalidatePath(`/trip/${tripId}`);
  return {
    ok: true,
    data: { halfAId: result.halfAId, halfBId: result.halfBId, fellBack: result.fellBack },
  };
}

/** Insert a rest day (layover) after `dayId`, at that day's overnight stop. Zero
 *  route calls; the layover carries nearby corpus suggestions (distance-ranked).
 *  PROPERTY guard only — a structural insert must never touch the frozen PROD trip.
 *  `suggestionCount` is surfaced so the UI can note how many nearby POIs were found
 *  (zero is legitimate on a sparse-corpus stop). */
export async function insertRestDayAction(
  tripId: string,
  dayId: string,
): Promise<ActionResult<{ restDayId: string; suggestionCount: number }>> {
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  const result = await repo.insertRestDay(tripId, dayId);
  if (!result.ok) return { ok: false, error: dayInsertError(result.reason) };
  revalidatePath(`/trip/${tripId}`);
  return {
    ok: true,
    data: { restDayId: result.restDayId, suggestionCount: result.suggestionCount },
  };
}

export async function resetDayToReferenceAction(
  tripId: string,
  dayId: string,
): Promise<ActionResult> {
  const ok = await repo.resetDayToReference(tripId, dayId);
  if (ok === TRIP_CONFLICT) return { ok: false, error: TRIP_CHANGED_ERROR };
  if (!ok) {
    return {
      ok: false,
      error: "Could not reset day. Trip may not have a reference.",
    };
  }
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

/** Replace `trip.payload.offlinePhases` with the supplied array. Used by
 *  the offline panel's "Set up offline cache" empty-state CTA, which
 *  posts the output of `suggestDefaultPhases(trip)`. Session 3 doesn't
 *  edit phases after setup; later sessions may add merge/split actions. */
export async function setOfflinePhasesAction(
  tripId: string,
  phases: OfflinePhase[],
): Promise<ActionResult<OfflinePhase[]>> {
  if (!isUserTripId(tripId)) {
    return { ok: false, error: "Offline maps are only available for your own trips." };
  }
  if (!Array.isArray(phases)) {
    return { ok: false, error: "Invalid phases payload." };
  }
  const updated = await updateUserTripPayload(
    tripId,
    (trip) => ({ ...trip, offlinePhases: phases }),
    { onConflict: "refuse" }, // whole-array replace — retry would drop a concurrent phase edit
  );
  if (updated === TRIP_CONFLICT) return { ok: false, error: TRIP_CHANGED_ERROR };
  if (!updated) return { ok: false, error: "Could not save phases." };
  revalidatePath(`/trips/${tripId}`);
  return { ok: true, data: updated.offlinePhases ?? [] };
}

/** Stamp the polyline hash + tileset version onto a single phase at
 *  prime-success time. The hash lets a future trip edit surface as
 *  "needs re-priming" cross-device; per-device prime status still lives
 *  in IndexedDB (see prime-status-db.ts). */
export async function setOfflinePhaseHashAction(
  tripId: string,
  phaseId: string,
  hash: string,
  tilesetVersion: string,
): Promise<ActionResult> {
  if (!isUserTripId(tripId)) {
    return { ok: false, error: "Offline maps are only available for your own trips." };
  }
  if (!hash || !tilesetVersion) {
    return { ok: false, error: "Missing hash or tileset version." };
  }
  const now = new Date().toISOString();
  const updated = await updateUserTripPayload(tripId, (trip) => {
    const phases = trip.offlinePhases;
    if (!phases) return null;
    const idx = phases.findIndex((p) => p.id === phaseId);
    if (idx === -1) return null;
    const nextPhases = phases.slice();
    nextPhases[idx] = {
      ...nextPhases[idx],
      primedPolylineHash: hash,
      primedTilesetVersion: tilesetVersion,
      updatedAt: now,
    };
    return { ...trip, offlinePhases: nextPhases };
  }, { onConflict: "retry" }); // per-phase stamp on a found id — composes
  if (!updated) return { ok: false, error: "Phase not found." };
  revalidatePath(`/trips/${tripId}`);
  return { ok: true };
}
