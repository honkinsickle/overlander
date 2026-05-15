import { getDraft } from "./repository";
import { isUserTripId, getUserTrip } from "@/lib/trips/user-trips";
import type { WizardSlices } from "./types";

/**
 * Polymorphic wizard-state loader.
 *
 * The `/plan/[id]/...` route is shared between authed users (UUID id;
 * state lives in public.trips.payload.wizard) and anonymous drafts
 * (alphanumeric id; state lives in the in-memory DRAFTS map). Each
 * step page calls this once and reads the slice it cares about.
 *
 * Returns null when the id is unknown in both stores — page handlers
 * should `notFound()` on null.
 */
export async function loadWizardState(
  id: string,
): Promise<WizardSlices | null> {
  if (isUserTripId(id)) {
    const trip = await getUserTrip(id);
    if (!trip) return null;
    return (trip.wizard as WizardSlices | undefined) ?? {};
  }
  const draft = await getDraft(id);
  if (!draft) return null;
  return {
    going: draft.going,
    vehicle: draft.vehicle,
    interests: draft.interests,
    stops: draft.stops,
    acceptedSuggestionIds: draft.acceptedSuggestionIds,
  };
}
