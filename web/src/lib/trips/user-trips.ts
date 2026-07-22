import type { SupabaseClient } from "@supabase/supabase-js";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WizardSlices } from "@/lib/plan/types";
import type { Trip } from "./types";
import { isUserTrip } from "./is-user-trip";

/** Distinct, UI-renderable message a `onConflict:"refuse"` caller surfaces when
 *  the trip moved under the read. NOT the generic "could not save". */
export const TRIP_CHANGED_ERROR =
  "This trip changed elsewhere — reload and redo.";
/** Sentinel returned by `updateUserTripPayload(…, {onConflict:"refuse"})` on a
 *  version conflict — distinct from `null` (mutate aborted / not found / write
 *  failed). Only "refuse" callers can receive it (see the overloads). */
export const TRIP_CONFLICT: unique symbol = Symbol("trip-version-conflict");
export type TripConflict = typeof TRIP_CONFLICT;

/** Optimistic-concurrency retry budget: real conflicts are two-tab/double-tap,
 *  not sustained contention, so a small bound is plenty. */
const MAX_WRITE_ATTEMPTS = 3;

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
): Promise<Trip | TripConflict | null> {
  // refuse: a per-key merge composes only when keys differ, and nothing
  // enforces that — so a same-key concurrent edit would be silently dropped by
  // a retry. Surface the conflict instead.
  return updateUserTripPayload(
    id,
    (trip) => {
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
    },
    { onConflict: "refuse" },
  );
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
): Promise<boolean | TripConflict> {
  if (!isConfigured() || !isUserTripId(tripId)) return false;
  try {
    const supabase = await createSupabaseServerClient();

    // Locate the reference day BEFORE the guarded write, then swap it in via
    // updateUserTripPayload — one RMW implementation, one version guard (this
    // used to do its own unconditional update, which would clobber guarded
    // writes). The day swap is an absolute set → refuse on conflict.
    const { data: userRow } = await supabase
      .from("trips")
      .select("reference_id")
      .eq("id", tripId)
      .maybeSingle();
    if (!userRow?.reference_id) return false;

    const { data: refRow } = await supabase
      .from("reference_trips")
      .select("payload")
      .eq("id", userRow.reference_id)
      .maybeSingle();
    if (!refRow) return false;
    const refDay = (refRow.payload as Trip).days.find((d) => d.id === dayId);
    if (!refDay) return false;

    const result = await updateUserTripPayload(
      tripId,
      (trip) => {
        if (!trip.days.some((d) => d.id === dayId)) return null;
        return {
          ...trip,
          days: trip.days.map((d) =>
            d.id === dayId ? structuredClone(refDay) : d,
          ),
          routePolyline: undefined,
        };
      },
      { onConflict: "refuse", client: supabase },
    );
    if (result === TRIP_CONFLICT) return TRIP_CONFLICT;
    return result !== null;
  } catch {
    return false;
  }
}

/** Optimistically-concurrent read-modify-write of a user trip's `payload`.
 *  The mutator receives the trip in `getUserTrip`'s shape (DB-side id/title)
 *  and returns the new Trip — or null to abort. `id`/`title` are restored from
 *  the read on commit. RLS scopes the read+write.
 *
 *  The write is guarded on `version` (.eq("version", v), version→v+1). A
 *  same-`version` concurrent write commits first → our update matches 0 rows
 *  → `onConflict` decides:
 *    - "retry"   — re-read fresh version+payload, re-run mutate (COMPOSES; only
 *                  safe for by-id/idempotent mutators). Exhaustion (3) → null.
 *    - "refuse"  — return TRIP_CONFLICT (a caller surfaces TRIP_CHANGED_ERROR).
 *                  For absolute-set/index mutators where retry would silently
 *                  drop the other edit and still return success.
 *    - "abandon" — return the read view (success, no write). For best-effort
 *                  derived writes whose value is stale by definition on conflict.
 *  `onConflict` is REQUIRED — a later mutator must classify itself, not inherit
 *  a data-losing default. `client` is injectable so tests drive the real
 *  function under a seeded JWT (defaults to the per-request server client). */
export async function updateUserTripPayload(
  id: string,
  mutate: (trip: Trip) => Trip | null,
  opts: { onConflict: "retry" | "abandon"; client?: SupabaseClient },
): Promise<Trip | null>;
export async function updateUserTripPayload(
  id: string,
  mutate: (trip: Trip) => Trip | null,
  opts: { onConflict: "refuse"; client?: SupabaseClient },
): Promise<Trip | TripConflict | null>;
export async function updateUserTripPayload(
  id: string,
  mutate: (trip: Trip) => Trip | null,
  opts: { onConflict: "retry" | "refuse" | "abandon"; client?: SupabaseClient },
): Promise<Trip | TripConflict | null> {
  if (!isConfigured() || !isUserTripId(id)) return null;
  try {
    const supabase = opts.client ?? (await createSupabaseServerClient());
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const { data, error } = await supabase
        .from("trips")
        .select("id, title, payload, version")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;

      const v = data.version as number;
      const rawPayload = data.payload as Trip;
      const view: Trip = { ...rawPayload, id: data.id, title: data.title };
      const updated = mutate(view);
      if (!updated) return null;

      const writePayload: Trip = {
        ...updated,
        id: rawPayload.id,
        title: rawPayload.title,
      };

      const { data: rows, error: updErr } = await supabase
        .from("trips")
        .update({ payload: writePayload, version: v + 1 })
        .eq("id", id)
        .eq("version", v)
        .select("id");
      if (updErr) return null;
      if ((rows?.length ?? 0) > 0) return updated; // wrote our row

      // 0 rows → version moved under us. Policy decides.
      if (opts.onConflict === "abandon") return view; // success, no write
      if (opts.onConflict === "refuse") return TRIP_CONFLICT;
      // "retry" → loop: re-read fresh version+payload, re-run mutate.
    }
    return null; // retry exhausted — same failure contract as before
  } catch {
    return null;
  }
}
