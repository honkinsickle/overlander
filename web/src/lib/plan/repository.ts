import { DRAFTS, newDraftId } from "./store";
import type {
  DraftTrip,
  GoingData,
  VehicleData,
  InterestsData,
  StopsData,
  PlannedStop,
} from "./types";

/**
 * Draft-trip repository.
 * Sync impls internally but async API to keep callers (RSC + actions +
 * route handlers) uniform — swap for a DB without touching callers.
 */

export async function createDraft(): Promise<DraftTrip> {
  const id = newDraftId();
  const draft: DraftTrip = {
    id,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  DRAFTS[id] = draft;
  return draft;
}

export async function getDraft(id: string): Promise<DraftTrip | null> {
  return DRAFTS[id] ?? null;
}

export async function saveGoing(
  id: string,
  data: GoingData,
): Promise<DraftTrip | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  draft.going = data;
  return draft;
}

export async function saveVehicle(
  id: string,
  data: VehicleData,
): Promise<DraftTrip | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  draft.vehicle = data;
  return draft;
}

export async function saveInterests(
  id: string,
  data: InterestsData,
): Promise<DraftTrip | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  draft.interests = data;
  return draft;
}

export async function saveStops(
  id: string,
  data: StopsData,
): Promise<DraftTrip | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  draft.stops = data;
  return draft;
}

/** Append a planned stop to the draft. Returns the appended stop. */
export async function addPlannedStop(
  id: string,
  stop: PlannedStop,
): Promise<PlannedStop | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  const existing: StopsData = draft.stops ?? {
    stops: [],
    avoidHighways: false,
  };
  existing.stops = [...existing.stops, stop];
  draft.stops = existing;
  return stop;
}

/** Remove a planned stop by id. Returns true if removed. */
export async function removePlannedStop(
  id: string,
  stopId: string,
): Promise<boolean> {
  const draft = DRAFTS[id];
  if (!draft?.stops) return false;
  const before = draft.stops.stops.length;
  draft.stops.stops = draft.stops.stops.filter((s) => s.id !== stopId);
  return draft.stops.stops.length < before;
}

/** Toggle the avoid-highways preference. */
export async function setAvoidHighways(
  id: string,
  value: boolean,
): Promise<boolean> {
  const draft = DRAFTS[id];
  if (!draft) return false;
  draft.stops = {
    stops: draft.stops?.stops ?? [],
    avoidHighways: value,
  };
  return true;
}

/** Toggle a Results-step suggestion on/off the accepted list. */
export async function toggleAcceptedSuggestion(
  id: string,
  suggestionId: string,
): Promise<string[] | null> {
  const draft = DRAFTS[id];
  if (!draft) return null;
  const current = new Set(draft.acceptedSuggestionIds ?? []);
  if (current.has(suggestionId)) current.delete(suggestionId);
  else current.add(suggestionId);
  draft.acceptedSuggestionIds = Array.from(current);
  return draft.acceptedSuggestionIds;
}

export async function discardDraft(id: string): Promise<boolean> {
  if (!DRAFTS[id]) return false;
  delete DRAFTS[id];
  return true;
}
