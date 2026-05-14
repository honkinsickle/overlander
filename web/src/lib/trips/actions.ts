"use server";

import { revalidatePath } from "next/cache";
import * as repo from "./repository";
import { addedPlaceToWaypoint, type AddedPlace } from "./added-place";

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
  if (!updated) return { ok: false, error: "Overnight not found." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}

export async function addWaypointAction(
  tripId: string,
  dayId: string,
  place: AddedPlace,
): Promise<ActionResult> {
  if (!place?.id || !place?.title) {
    return { ok: false, error: "Missing place." };
  }
  const waypoint = addedPlaceToWaypoint(place);
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
  const ok = await repo.removeWaypoint(tripId, dayId, waypointId);
  if (!ok) return { ok: false, error: "Could not remove stop." };
  revalidatePath(`/trip/${tripId}`);
  return { ok: true };
}
