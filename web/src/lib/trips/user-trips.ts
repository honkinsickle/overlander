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
