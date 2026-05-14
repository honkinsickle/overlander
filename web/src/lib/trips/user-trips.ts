import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Trip } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserTripId(id: string): boolean {
  return UUID_RE.test(id);
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
      .select("id, title, payload")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const trip = data.payload as Trip;
    // The DB id is authoritative — the snapshot payload's `id` is
    // still "la-to-deadhorse" because that's what got forked.
    return { ...trip, id: data.id, title: data.title };
  } catch {
    return null;
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
