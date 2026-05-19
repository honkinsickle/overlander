import { newDraftId } from "./store";
import { readDrafts, writeDrafts } from "./cookie-store";
import type {
  DraftTrip,
  GoingData,
  VehicleData,
  InterestsData,
  StopsData,
  PlannedStop,
} from "./types";

/**
 * Draft-trip repository. Anon wizard state lives in a cookie
 * (`__plan_drafts`) so it survives across serverless lambda hops on
 * Vercel — the legacy `globalThis.__draftStore` map evaporated between
 * requests in production. See `cookie-store.ts` for limits and layout.
 *
 * Reads work in any server context; writes only work in Server Actions
 * and Route Handlers. Authed users still go through the Supabase path
 * in `lib/trips/user-trips.ts`, not this module.
 */

export async function createDraft(): Promise<DraftTrip> {
  const id = newDraftId();
  const draft: DraftTrip = {
    id,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  const drafts = await readDrafts();
  drafts[id] = draft;
  await writeDrafts(drafts);
  return draft;
}

export async function getDraft(id: string): Promise<DraftTrip | null> {
  const drafts = await readDrafts();
  if (drafts[id]) return drafts[id];
  // Fallback: the URL's draft id can diverge from the cookie's stored id
  // when the user hits /plan more than once in a session and the second
  // mint doesn't merge properly onto the response cookie (observed on
  // Vercel). When there's exactly one draft in the cookie, fall back to
  // it — the user clearly has a single in-flight wizard. Returns null
  // for the genuinely-mismatched case (multiple drafts, none matching).
  const ids = Object.keys(drafts);
  if (ids.length === 1) return drafts[ids[0]];
  return null;
}

export async function saveGoing(
  id: string,
  data: GoingData,
): Promise<DraftTrip | null> {
  return mutateDraft(id, (draft) => {
    draft.going = data;
  });
}

export async function saveVehicle(
  id: string,
  data: VehicleData,
): Promise<DraftTrip | null> {
  return mutateDraft(id, (draft) => {
    draft.vehicle = data;
  });
}

export async function saveInterests(
  id: string,
  data: InterestsData,
): Promise<DraftTrip | null> {
  return mutateDraft(id, (draft) => {
    draft.interests = data;
  });
}

export async function saveStops(
  id: string,
  data: StopsData,
): Promise<DraftTrip | null> {
  return mutateDraft(id, (draft) => {
    draft.stops = data;
  });
}

/** Append a planned stop to the draft. Returns the appended stop. */
export async function addPlannedStop(
  id: string,
  stop: PlannedStop,
): Promise<PlannedStop | null> {
  const drafts = await readDrafts();
  const draft = drafts[id];
  if (!draft) return null;
  const existing: StopsData = draft.stops ?? {
    stops: [],
    avoidHighways: false,
  };
  existing.stops = [...existing.stops, stop];
  draft.stops = existing;
  await writeDrafts(drafts);
  return stop;
}

/** Remove a planned stop by id. Returns true if removed. */
export async function removePlannedStop(
  id: string,
  stopId: string,
): Promise<boolean> {
  const drafts = await readDrafts();
  const draft = drafts[id];
  if (!draft?.stops) return false;
  const before = draft.stops.stops.length;
  draft.stops.stops = draft.stops.stops.filter((s) => s.id !== stopId);
  const removed = draft.stops.stops.length < before;
  if (removed) await writeDrafts(drafts);
  return removed;
}

/** Toggle the avoid-highways preference. */
export async function setAvoidHighways(
  id: string,
  value: boolean,
): Promise<boolean> {
  const drafts = await readDrafts();
  const draft = drafts[id];
  if (!draft) return false;
  draft.stops = {
    stops: draft.stops?.stops ?? [],
    avoidHighways: value,
  };
  await writeDrafts(drafts);
  return true;
}

/** Toggle a Results-step suggestion on/off the accepted list. */
export async function toggleAcceptedSuggestion(
  id: string,
  suggestionId: string,
): Promise<string[] | null> {
  const drafts = await readDrafts();
  const draft = drafts[id];
  if (!draft) return null;
  const current = new Set(draft.acceptedSuggestionIds ?? []);
  if (current.has(suggestionId)) current.delete(suggestionId);
  else current.add(suggestionId);
  draft.acceptedSuggestionIds = Array.from(current);
  await writeDrafts(drafts);
  return draft.acceptedSuggestionIds;
}

export async function discardDraft(id: string): Promise<boolean> {
  const drafts = await readDrafts();
  if (!drafts[id]) return false;
  delete drafts[id];
  await writeDrafts(drafts);
  return true;
}

/** Shared read-modify-write helper used by the save* functions. */
async function mutateDraft(
  id: string,
  mutator: (draft: DraftTrip) => void,
): Promise<DraftTrip | null> {
  const drafts = await readDrafts();
  const draft = drafts[id];
  if (!draft) return null;
  mutator(draft);
  await writeDrafts(drafts);
  return draft;
}
