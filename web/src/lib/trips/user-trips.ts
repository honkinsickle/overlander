import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WizardSlices } from "@/lib/plan/types";
import type { Trip } from "./types";
import { isUserTrip } from "./is-user-trip";

/** Thin alias kept for the 15+ server-side `isUserTripId(tripId)` call
 *  sites. Regex lives in `./is-user-trip` so client and server share
 *  one source of truth — see `lib/trips/is-user-trip.ts` for the
 *  preferred API. */
export function isUserTripId(id: string): boolean {
  return isUserTrip(id);
}

/** Fetch a user-owned trip from public.trips. Returns null if there's
 *  no session, the id doesn't belong to the caller, or the row is gone.
 *
 *  Uses the per-request server client so RLS scopes the row to
 *  auth.uid() — no need for an explicit owner_id filter here. */
export async function getUserTrip(id: string): Promise<Trip | null> {
  if (!isConfigured() || !isUserTripId(id)) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trips")
      .select("id, title, payload, reference_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const trip = data.payload as Trip;
    // The DB id is authoritative — the snapshot payload's `id` is
    // still "la-to-deadhorse" because that's what got forked.
    // `referenceId` is surfaced from the DB column so consumers (e.g.
    // DayHeader's "Reset to reference") can detect scratch-built trips.
    return {
      ...trip,
      id: data.id,
      title: data.title,
      referenceId: data.reference_id ?? null,
    };
  } catch {
    return null;
  }
}

/** Create a fresh wizard-backed trip in public.trips for the authed
 *  user. Inserts with state='draft', reference_id=null, empty days[],
 *  and a wizard sub-object pre-stamped with currentStep='going'.
 *  Returns the new trip id, or null on auth / config failure.
 *
 *  The placeholder fields (Untitled Trip, today/today date, empty
 *  start/end location, 0 weather) get filled in by the going step.
 *  Until then, the row shows on /trips as "Untitled Trip · Draft". */
export async function createUserWizardTrip(): Promise<string | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const today = new Date().toISOString().slice(0, 10);
    const wizard: WizardSlices = { currentStep: "going" };
    const payload: Trip = {
      id: "",
      title: "Untitled Trip",
      startDate: today,
      endDate: today,
      startLocation: "",
      endLocation: "",
      weatherHiF: 0,
      weatherLoF: 0,
      days: [],
      wizard,
    };

    const { data, error } = await supabase
      .from("trips")
      .insert({
        owner_id: user.id,
        reference_id: null,
        title: "Untitled Trip",
        state: "draft",
        payload,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

/** Merge a partial wizard slice into `Trip.wizard` for a user trip.
 *  Reuses `updateUserTripPayload` so RLS + the read-modify-write
 *  envelope are identical to other UUID writers.
 *
 *  If the patch includes `going`, top-level `Trip.startLocation` /
 *  `endLocation` / `startDate` / `endDate` are denormalized off it so
 *  the /trips card summary (which reads top-level fields, not the
 *  wizard sub-object) shows the right pair as soon as the user moves
 *  past the going step. */
export async function writeWizardSlice(
  id: string,
  patch: Partial<WizardSlices>,
): Promise<Trip | null> {
  return updateUserTripPayload(id, (trip) => {
    const prev = (trip.wizard as WizardSlices | undefined) ?? {};
    const wizard: WizardSlices = { ...prev, ...patch };
    const next: Trip = { ...trip, wizard };
    if (patch.going) {
      next.startLocation =
        patch.going.startLocation?.label ?? next.startLocation;
      next.endLocation = patch.going.destination?.label ?? next.endLocation;
      next.startDate = patch.going.startDate ?? next.startDate;
      next.endDate = patch.going.endDate ?? next.endDate;
    }
    return next;
  });
}

/** Replace one day of a user trip with the same-id day from the
 *  trip's reference (`public.trips.reference_id` → `reference_trips`).
 *  The day's content (label, waypoints, overnight, weather, notes,
 *  suggestions, hero*, miles, driveHours, dayNumber, date) is cloned
 *  verbatim from reference. Clears `routePolyline` since the route
 *  depends on the day's content. Returns false if the trip has no
 *  reference, the day id doesn't exist in reference, RLS hides the
 *  row, etc.
 *
 *  This is "Reset day to reference" — a user-trust guardrail: "undo
 *  my edits to just this day." Does not restore deleted days; does
 *  not touch surrounding days. */
export async function resetUserTripDayToReference(
  tripId: string,
  dayId: string,
): Promise<boolean> {
  if (!isConfigured() || !isUserTripId(tripId)) return false;
  try {
    const supabase = await createSupabaseServerClient();

    const { data: userRow, error: userErr } = await supabase
      .from("trips")
      .select("id, title, payload, reference_id")
      .eq("id", tripId)
      .maybeSingle();
    if (userErr || !userRow || !userRow.reference_id) return false;

    const { data: refRow, error: refErr } = await supabase
      .from("reference_trips")
      .select("payload")
      .eq("id", userRow.reference_id)
      .maybeSingle();
    if (refErr || !refRow) return false;

    const userPayload = userRow.payload as Trip;
    const refPayload = refRow.payload as Trip;
    const refDay = refPayload.days.find((d) => d.id === dayId);
    if (!refDay) return false;
    if (!userPayload.days.some((d) => d.id === dayId)) return false;

    const next: Trip = {
      ...userPayload,
      days: userPayload.days.map((d) =>
        d.id === dayId ? structuredClone(refDay) : d,
      ),
      routePolyline: undefined,
    };

    const { error: updErr } = await supabase
      .from("trips")
      .update({ payload: next })
      .eq("id", tripId);
    return !updErr;
  } catch {
    return false;
  }
}

/** Read-modify-write a user trip's `payload`. The mutator receives the
 *  trip in the same shape `getUserTrip` returns (DB-side id/title) and
 *  returns the new Trip — or null to abort the write (e.g. "day not
 *  found"). On commit, the payload's own `id`/`title` fields are
 *  restored from the read so we don't overwrite them with DB overrides.
 *  RLS scopes the read + write; `updated_at` ticks via trigger.
 *
 *  Not transactional — read and write are separate round-trips. Fine
 *  for single-owner v1; revisit when co-driver sharing lands. */
export async function updateUserTripPayload(
  id: string,
  mutate: (trip: Trip) => Trip | null,
): Promise<Trip | null> {
  if (!isConfigured() || !isUserTripId(id)) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trips")
      .select("id, title, payload")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;

    const rawPayload = data.payload as Trip;
    const view: Trip = { ...rawPayload, id: data.id, title: data.title };
    const updated = mutate(view);
    if (!updated) return null;

    const writePayload: Trip = {
      ...updated,
      id: rawPayload.id,
      title: rawPayload.title,
    };

    const { error: updErr } = await supabase
      .from("trips")
      .update({ payload: writePayload })
      .eq("id", id);
    if (updErr) return null;

    return updated;
  } catch {
    return null;
  }
}
