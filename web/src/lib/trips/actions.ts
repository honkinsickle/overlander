"use server";

import { revalidatePath } from "next/cache";
import * as repo from "./repository";

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
