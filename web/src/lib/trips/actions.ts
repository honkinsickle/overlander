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
