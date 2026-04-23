"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as repo from "./repository";
import * as trips from "@/lib/trips/repository";
import type {
  GoingData,
  PlanWith,
  VehicleData,
  InterestsData,
} from "./types";
import type { Trip, Waypoint } from "@/lib/trips/types";
import { ALL_CHIP_IDS } from "./interests";
import { getSuggestion } from "./suggestions";
import { newDraftId } from "./store";
import { nextHref } from "./nav";

/**
 * Server Actions for planning-flow mutations.
 * Each action validates FormData, persists the slice, and either returns
 * a form-state error or redirects to the next step.
 */

export type FormState = { error: string | null };

export async function saveGoingAction(
  draftId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const startLabel = String(formData.get("startLocation") ?? "").trim();
  const destinationLabel = String(formData.get("destination") ?? "").trim();
  const saveStartAsHome = formData.get("saveStartAsHome") === "on";
  const planWithRaw = String(formData.get("planWith") ?? "automagically");
  const planWith: PlanWith =
    planWithRaw === "explore" ? "explore" : "automagically";
  const startDate = String(formData.get("datesStart") ?? "").trim();
  const endDate = String(formData.get("datesEnd") ?? "").trim();

  if (!startLabel) {
    return { error: "Enter a starting point." };
  }
  if (!destinationLabel) {
    return { error: "Enter a destination." };
  }
  if (startDate && endDate && startDate > endDate) {
    return { error: "End date must be on or after the start date." };
  }

  const data: GoingData = {
    startLocation: { label: startLabel },
    destination: { label: destinationLabel },
    saveStartAsHome,
    planWith,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };

  const draft = await repo.saveGoing(draftId, data);
  if (!draft) return { error: "Draft not found." };

  revalidatePath(`/plan/${draftId}`, "layout");
  const next = nextHref(draftId, "going");
  if (next) redirect(next);
  return { error: null };
}

export async function saveVehicleAction(
  draftId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // HTML forms submit multiple same-name checkboxes as repeated values.
  const vehicleIds = formData.getAll("vehicleIds").map(String).filter(Boolean);
  const milesRaw = String(formData.get("milesPerDay") ?? "").trim();

  if (vehicleIds.length === 0) {
    return { error: "Pick at least one vehicle." };
  }

  let milesPerDay: number | undefined;
  if (milesRaw) {
    const n = Number(milesRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: "Miles per day must be a positive number." };
    }
    milesPerDay = Math.round(n);
  }

  const data: VehicleData = { vehicleIds, milesPerDay };
  const draft = await repo.saveVehicle(draftId, data);
  if (!draft) return { error: "Draft not found." };

  revalidatePath(`/plan/${draftId}`, "layout");
  const next = nextHref(draftId, "vehicle");
  if (next) redirect(next);
  return { error: null };
}

export async function saveInterestsAction(
  draftId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Accept zero or more selections; this step is optional. Unknown ids
  // are silently dropped to prevent URL-param injection.
  const raw = formData.getAll("chipIds").map(String);
  const selectedChipIds = raw.filter((id) => ALL_CHIP_IDS.has(id));

  const data: InterestsData = { selectedChipIds };
  const draft = await repo.saveInterests(draftId, data);
  if (!draft) return { error: "Draft not found." };

  revalidatePath(`/plan/${draftId}`, "layout");
  const next = nextHref(draftId, "interests");
  if (next) redirect(next);
  return { error: null };
}

/** Add a freeform-text must-stop waypoint and stay on the same step. */
export async function addStopAction(
  draftId: string,
  formData: FormData,
): Promise<void> {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  if (label.length > 100) return;

  const stop = {
    id: `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label,
  };
  await repo.addPlannedStop(draftId, stop);
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Remove a planned stop and stay on the same step. */
export async function removeStopAction(
  draftId: string,
  stopId: string,
): Promise<void> {
  await repo.removePlannedStop(draftId, stopId);
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Save the avoid-highways toggle + advance. Stops list mutates separately
 *  via addStopAction / removeStopAction which revalidate in place. */
export async function saveStopsAction(
  draftId: string,
  formData: FormData,
): Promise<void> {
  const avoidHighways = formData.get("avoidHighways") === "on";
  await repo.setAvoidHighways(draftId, avoidHighways);
  revalidatePath(`/plan/${draftId}`, "layout");
  const next = nextHref(draftId, "stops");
  if (next) redirect(next);
}

/** Toggle a Results suggestion in/out of the accepted list. Stays on page. */
export async function toggleSuggestionAction(
  draftId: string,
  suggestionId: string,
): Promise<void> {
  await repo.toggleAcceptedSuggestion(draftId, suggestionId);
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Promote the draft into a real Trip + redirect to /trip/:newTripId.
 *  Discards the draft afterwards. */
export async function finalizeTripAction(draftId: string): Promise<void> {
  const draft = await repo.getDraft(draftId);
  if (!draft) return;

  const tripId = `trip-${newDraftId().slice(0, 8)}`;
  const start = draft.going?.startLocation?.label ?? "Start";
  const end = draft.going?.destination?.label ?? "Destination";
  const accepted = draft.acceptedSuggestionIds ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const startDate = draft.going?.startDate ?? today;
  const endDate = draft.going?.endDate ?? startDate;

  const waypoints: Waypoint[] = accepted
    .map((id) => getSuggestion(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      id: `wp-${s.slug}`,
      slug: s.slug,
      category: s.category,
      title: s.title,
      subtitle: "Day 1",
      description: s.description,
      tip: s.tip,
      stats: [
        { label: "DETOUR",    value: "+0 mi" },
        { label: "STOP TIME", value: "~30 min" },
        { label: "ETA",       value: "—" },
      ],
    }));

  const trip: Trip = {
    id: tripId,
    title: `${start} to ${end}`,
    startDate,
    endDate,
    startLocation: start,
    endLocation: end,
    weatherHiF: 72,
    weatherLoF: 55,
    days: [
      {
        id: "day-1",
        dayNumber: 1,
        date: startDate,
        label: `${start} — ${end}`,
        waypoints,
      },
    ],
  };

  await trips.createTrip(trip);
  await repo.discardDraft(draftId);
  redirect(`/trip/${tripId}`);
}
