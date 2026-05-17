"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as repo from "./repository";
import * as trips from "@/lib/trips/repository";
import type {
  GoingData,
  Pace,
  PlanLocation,
  PlanWith,
  StopsData,
  VehicleData,
  InterestsData,
  WizardSlices,
} from "./types";
import { PACE_BOUNDS } from "./types";
import type { Day, Trip, Waypoint } from "@/lib/trips/types";
import {
  isUserTripId,
  getUserTrip,
  writeWizardSlice,
} from "@/lib/trips/user-trips";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ALL_CHIP_IDS } from "./interests";
import { suggestionsForChips } from "./suggestions";
import { newDraftId } from "./store";
import { nextHref } from "./nav";
import { geocode } from "@/lib/routing/geocode";
import { routeBetween } from "@/lib/routing/route-between";
import { segmentByPace } from "@/lib/routing/segment-by-pace";
import { encodePolyline } from "@/lib/routing/polyline";
import { buildDaySuggestions } from "@/lib/routing/day-suggestions";

// Fallback pace when the wizard didn't capture one (e.g. drafts saved
// pre-Phase-B). The wizard's PaceInput defaults to 6 hrs/day; this
// matches so old drafts get the same shape as new ones.
const DEFAULT_PACE_HOURS = 6;
const METERS_PER_MILE = 1609.34;

function addDaysIso(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function paceToSegmentInput(
  pace: Pace | undefined,
): { maxDurationS: number } | { maxDistanceM: number } {
  if (!pace) return { maxDurationS: DEFAULT_PACE_HOURS * 3600 };
  if (pace.kind === "hours") return { maxDurationS: pace.value * 3600 };
  return { maxDistanceM: pace.value * METERS_PER_MILE };
}

/** Build a PlanLocation from a labeled form input + the autocomplete's
 *  hidden `${name}Lat`/`${name}Lng` companions. If both coord fields
 *  are numeric, store them — the wizard's autocomplete picker fills
 *  them on select, letting finalize skip a redundant geocode call. */
function planLocationFromFormFields(
  label: string,
  formData: FormData,
  name: string,
): PlanLocation {
  const latRaw = String(formData.get(`${name}Lat`) ?? "");
  const lngRaw = String(formData.get(`${name}Lng`) ?? "");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (latRaw && lngRaw && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { label, lat, lng };
  }
  return { label };
}

/** Resolve a PlanLocation to `[lng, lat]`. Prefers the picker-supplied
 *  coords; falls back to geocoding the label. */
async function resolveCoords(loc: PlanLocation): Promise<[number, number]> {
  if (typeof loc.lat === "number" && typeof loc.lng === "number") {
    return [loc.lng, loc.lat];
  }
  return geocode(loc.label);
}

/** Resolve start/end coords (preferring picker-supplied ones, else
 *  geocoding the labels), route between them, segment by the chosen
 *  pace, and return the route-aware fields (days, startCoords,
 *  routePolyline, endDate). Returns null on any failure — caller falls
 *  back to the old single-day skeleton. */
async function buildRouteAwareDays(args: {
  startLocation: PlanLocation;
  destination: PlanLocation;
  startDate: string;
  pace?: Pace;
  roundTrip?: boolean;
}): Promise<{
  days: Day[];
  startCoords: [number, number];
  routePolyline: string;
  endDate: string;
} | null> {
  try {
    console.log(
      `[finalize] geocoding: "${args.startLocation.label}" → "${args.destination.label}"`,
    );
    const [startCoords, endCoords] = await Promise.all([
      resolveCoords(args.startLocation),
      resolveCoords(args.destination),
    ]);
    console.log(
      `[finalize] coords: ${JSON.stringify(startCoords)} → ${JSON.stringify(endCoords)}`,
    );

    console.log(`[finalize] routing (roundTrip=${!!args.roundTrip})`);
    const route = await routeBetween([startCoords, endCoords], {
      roundTrip: args.roundTrip,
    });
    console.log(
      `[finalize] routed: ${(route.distanceM / 1609.34).toFixed(1)} mi · ${(route.durationS / 3600).toFixed(2)} hrs · ${route.steps.length} steps`,
    );

    const paceInput = paceToSegmentInput(args.pace);
    console.log(`[finalize] segmenting with pace ${JSON.stringify(paceInput)}`);
    const segments = segmentByPace(route, paceInput);
    console.log(`[finalize] segmented into ${segments.length} day(s)`);

    // Resolve suggestions per day in parallel. Each call is itself an
    // internal Promise.all across bbox samples + sources, so this
    // saturates outbound bandwidth — fine for the ≤20 days the
    // pace/route combinations typically produce.
    console.log(`[finalize] querying suggestions for ${segments.length} days`);
    const daySuggestions = await Promise.all(
      segments.map((seg) => buildDaySuggestions(seg)),
    );
    console.log(
      `[finalize] suggestions ready (${daySuggestions.map((d) => d.all.length).join(",")} per day)`,
    );

    const startLabel = args.startLocation.label;
    const endLabel = args.destination.label;
    const days: Day[] = segments.map((seg, i) => ({
      id: `day-${i + 1}`,
      dayNumber: i + 1,
      date: addDaysIso(args.startDate, i),
      label:
        segments.length === 1
          ? `${startLabel} — ${endLabel}`
          : i === 0
            ? `${startLabel} — end of day 1`
            : i === segments.length - 1
              ? `Day ${i + 1} — ${endLabel}`
              : `Day ${i + 1}`,
      coords: seg.endCoord,
      miles: Math.round(seg.distanceM / 1609.34),
      driveHours: Math.round((seg.durationS / 3600) * 10) / 10,
      waypoints: [],
      suggestions: daySuggestions[i].byCategory,
      segmentSuggestions: daySuggestions[i].all,
    }));

    return {
      days,
      startCoords,
      routePolyline: encodePolyline(route.coordinates),
      endDate: addDaysIso(args.startDate, Math.max(0, segments.length - 1)),
    };
  } catch (err) {
    console.log(
      "[finalize] route-aware build failed, falling back:",
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    );
    if (err instanceof Error && err.stack) console.log(err.stack);
    return null;
  }
}

/**
 * Wizard ids are polymorphic:
 *   - UUID  → authed user trip in public.trips (Sprint 1 onward)
 *   - other → anonymous draft in the in-memory DRAFTS map (legacy /
 *             Sprint 2 hybrid path)
 *
 * Every action below dispatches on `isUserTripId(id)`. The DB path
 * writes via `writeWizardSlice` (which composes with the same
 * `updateUserTripPayload` envelope as every other UUID writer); the
 * draft path is the original `repo.save<Slice>` call.
 */

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
  const roundTrip = formData.get("roundTrip") === "on";

  const paceKindRaw = String(formData.get("paceKind") ?? "");
  const paceKind: Pace["kind"] | null =
    paceKindRaw === "hours" || paceKindRaw === "miles" ? paceKindRaw : null;
  const paceValueRaw = String(formData.get("paceValue") ?? "");
  const paceValueNum = Number(paceValueRaw);
  let pace: Pace | undefined;
  if (paceKind && Number.isFinite(paceValueNum) && paceValueNum > 0) {
    const bounds = PACE_BOUNDS[paceKind];
    const clamped = Math.max(bounds.min, Math.min(bounds.max, paceValueNum));
    pace = { kind: paceKind, value: clamped };
  }

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
    startLocation: planLocationFromFormFields(
      startLabel,
      formData,
      "startLocation",
    ),
    destination: planLocationFromFormFields(
      destinationLabel,
      formData,
      "destination",
    ),
    saveStartAsHome,
    planWith,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    pace,
    roundTrip,
  };

  const ok = isUserTripId(draftId)
    ? await writeWizardSlice(draftId, { going: data, currentStep: "vehicle" })
    : await repo.saveGoing(draftId, data);
  if (!ok) return { error: "Trip not found." };

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
  const ok = isUserTripId(draftId)
    ? await writeWizardSlice(draftId, { vehicle: data, currentStep: "interests" })
    : await repo.saveVehicle(draftId, data);
  if (!ok) return { error: "Trip not found." };

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
  const ok = isUserTripId(draftId)
    ? await writeWizardSlice(draftId, { interests: data, currentStep: "stops" })
    : await repo.saveInterests(draftId, data);
  if (!ok) return { error: "Trip not found." };

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
  if (isUserTripId(draftId)) {
    await writeWizardSlice(draftId, {
      stops: await readNextStops(draftId, (s) => ({
        ...s,
        stops: [...s.stops, stop],
      })),
    });
  } else {
    await repo.addPlannedStop(draftId, stop);
  }
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Remove a planned stop and stay on the same step. */
export async function removeStopAction(
  draftId: string,
  stopId: string,
): Promise<void> {
  if (isUserTripId(draftId)) {
    await writeWizardSlice(draftId, {
      stops: await readNextStops(draftId, (s) => ({
        ...s,
        stops: s.stops.filter((p) => p.id !== stopId),
      })),
    });
  } else {
    await repo.removePlannedStop(draftId, stopId);
  }
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Save the avoid-highways toggle + advance. Stops list mutates separately
 *  via addStopAction / removeStopAction which revalidate in place. */
export async function saveStopsAction(
  draftId: string,
  formData: FormData,
): Promise<void> {
  const avoidHighways = formData.get("avoidHighways") === "on";
  if (isUserTripId(draftId)) {
    await writeWizardSlice(draftId, {
      stops: await readNextStops(draftId, (s) => ({ ...s, avoidHighways })),
      currentStep: "loader",
    });
  } else {
    await repo.setAvoidHighways(draftId, avoidHighways);
  }
  revalidatePath(`/plan/${draftId}`, "layout");
  const next = nextHref(draftId, "stops");
  if (next) redirect(next);
}

/** Toggle a Results suggestion in/out of the accepted list. Stays on page. */
export async function toggleSuggestionAction(
  draftId: string,
  suggestionId: string,
): Promise<void> {
  if (isUserTripId(draftId)) {
    const trip = await getUserTrip(draftId);
    if (!trip) return;
    const wizard = (trip.wizard as WizardSlices | undefined) ?? {};
    const current = new Set(wizard.acceptedSuggestionIds ?? []);
    if (current.has(suggestionId)) current.delete(suggestionId);
    else current.add(suggestionId);
    await writeWizardSlice(draftId, {
      acceptedSuggestionIds: Array.from(current),
    });
  } else {
    await repo.toggleAcceptedSuggestion(draftId, suggestionId);
  }
  revalidatePath(`/plan/${draftId}`, "layout");
}

/** Helper for the UUID-path stops mutators. Reads current stops slice,
 *  hands it to the mutator with sensible empty defaults, returns the
 *  new slice for `writeWizardSlice` to merge. Keeps the dispatch
 *  branches in the actions short. */
async function readNextStops(
  tripId: string,
  mutate: (s: StopsData) => StopsData,
): Promise<StopsData> {
  const trip = await getUserTrip(tripId);
  const wizard = (trip?.wizard as WizardSlices | undefined) ?? {};
  const current: StopsData = wizard.stops ?? {
    stops: [],
    avoidHighways: false,
  };
  return mutate(current);
}

/** Result returned by finalizeTripAction. Success carries the finalized
 *  Trip so the client can mount the slideup over the loader page without
 *  a round-trip; failure carries a user-visible error string. */
export type FinalizeResult =
  | { ok: true; tripId: string; trip: Trip }
  | { ok: false; error: string };

/** Promote a wizard draft into an active trip.
 *
 *  UUID path: the trip already exists in public.trips with state='draft'
 *    and an empty days[]. We build day[1] from the wizard slices and
 *    write the payload + DB-level title + state in one update.
 *
 *  Draft path (anonymous, in-memory): the original flow — build a fresh
 *    Trip, insert into the fixtures map, discard the draft.
 *
 *  Returns the finalized Trip; the caller mounts the slideup over the
 *  wizard loader instead of redirecting to /trip/<id>. */
export async function finalizeTripAction(
  draftId: string,
): Promise<FinalizeResult> {
  if (isUserTripId(draftId)) {
    const trip = await getUserTrip(draftId);
    if (!trip) return { ok: false, error: "Trip not found." };
    const wizard = (trip.wizard as WizardSlices | undefined) ?? {};

    const startLocation: PlanLocation = wizard.going?.startLocation ?? {
      label: trip.startLocation || "Start",
    };
    const destination: PlanLocation = wizard.going?.destination ?? {
      label: trip.endLocation || "Destination",
    };
    const start = startLocation.label;
    const end = destination.label;
    const startDate = wizard.going?.startDate || trip.startDate;

    const routed = await buildRouteAwareDays({
      startLocation,
      destination,
      startDate,
      pace: wizard.going?.pace,
      roundTrip: wizard.going?.roundTrip,
    });

    // Fallback for when geocoding/routing can't produce a real
    // itinerary (e.g. an unrecognized place name, unroutable pair).
    // Mirrors the old single-day skeleton with selected-chip waypoints
    // dumped on Day 1, so the user still ends up on a viewable trip.
    const fallbackWaypoints: Waypoint[] = suggestionsForChips(
      wizard.interests?.selectedChipIds ?? [],
    ).map((s) => ({
      id: `wp-${s.slug}`,
      slug: s.slug,
      category: s.category,
      title: s.title,
      subtitle: "Day 1",
      description: s.description,
      tip: s.tip,
      stats: [
        { label: "DETOUR", value: "+0 mi" },
        { label: "STOP TIME", value: "~30 min" },
        { label: "ETA", value: "—" },
      ],
    }));

    const newTitle = `${start} to ${end}`;
    const updatedPayload: Trip = routed
      ? {
          ...trip,
          // Convention from forked trips: payload.id/title are
          // placeholders; DB id + DB title are authoritative.
          id: "",
          title: "Untitled Trip",
          startDate,
          endDate: routed.endDate,
          startLocation: start,
          endLocation: end,
          startCoords: routed.startCoords,
          routePolyline: routed.routePolyline,
          days: routed.days,
        }
      : {
          ...trip,
          id: "",
          title: "Untitled Trip",
          startDate,
          endDate: wizard.going?.endDate || startDate,
          startLocation: start,
          endLocation: end,
          days: [
            {
              id: "day-1",
              dayNumber: 1,
              date: startDate,
              label: `${start} — ${end}`,
              waypoints: fallbackWaypoints,
            },
          ],
        };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("trips")
      .update({ title: newTitle, state: "active", payload: updatedPayload })
      .eq("id", draftId);
    if (error) return { ok: false, error: "Couldn't save your trip." };

    // The Trip we return uses the DB-authoritative id and title (the
    // payload itself keeps the placeholder id/"Untitled Trip" by
    // convention for forked trips — see updatedPayload above).
    const finalized: Trip = { ...updatedPayload, id: draftId, title: newTitle };
    return { ok: true, tripId: draftId, trip: finalized };
  }

  // Draft path: original anonymous in-memory flow.
  const draft = await repo.getDraft(draftId);
  if (!draft) return { ok: false, error: "Trip draft not found." };

  const tripId = `trip-${newDraftId().slice(0, 8)}`;
  const start = draft.going?.startLocation?.label ?? "Start";
  const end = draft.going?.destination?.label ?? "Destination";
  const selectedChipIds = draft.interests?.selectedChipIds ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const startDate = draft.going?.startDate ?? today;
  const endDate = draft.going?.endDate ?? startDate;

  const waypoints: Waypoint[] = suggestionsForChips(selectedChipIds).map(
    (s) => ({
      id: `wp-${s.slug}`,
      slug: s.slug,
      category: s.category,
      title: s.title,
      subtitle: "Day 1",
      description: s.description,
      tip: s.tip,
      stats: [
        { label: "DETOUR", value: "+0 mi" },
        { label: "STOP TIME", value: "~30 min" },
        { label: "ETA", value: "—" },
      ],
    }),
  );

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
  return { ok: true, tripId, trip };
}
