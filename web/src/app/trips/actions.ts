"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const MAX_TITLE = 120;

export type TripState = "draft" | "active" | "logged";
const VALID_STATES: ReadonlySet<TripState> = new Set(["draft", "active", "logged"]);

export async function setTripState(id: string, state: TripState): Promise<Result> {
  if (!isConfigured()) return { ok: false, error: "Auth isn't configured." };
  if (!VALID_STATES.has(state)) return { ok: false, error: "Invalid state." };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("trips")
    .update({ state }, { count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  if (count === 0) return { ok: false, error: "Not found or not yours." };

  revalidatePath("/trips");
  revalidatePath(`/trip/${id}`);
  return { ok: true };
}

export async function renameTrip(id: string, title: string): Promise<Result> {
  if (!isConfigured()) return { ok: false, error: "Auth isn't configured." };

  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: "Title can't be empty." };
  if (trimmed.length > MAX_TITLE) {
    return { ok: false, error: `Keep it under ${MAX_TITLE} characters.` };
  }

  const supabase = await createSupabaseServerClient();
  // RLS scopes update to auth.uid() === owner_id — no manual auth check needed.
  const { error, count } = await supabase
    .from("trips")
    .update({ title: trimmed }, { count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  if (count === 0) return { ok: false, error: "Not found or not yours." };

  revalidatePath("/trips");
  revalidatePath(`/trip/${id}`);
  return { ok: true };
}

export async function deleteTrip(id: string): Promise<Result> {
  if (!isConfigured()) return { ok: false, error: "Auth isn't configured." };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("trips")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  if (count === 0) return { ok: false, error: "Not found or not yours." };

  revalidatePath("/trips");
  return { ok: true };
}

/** Duplicate a user trip into a sibling row. The copy keeps the source
 *  trip's `reference_id` (so "Reset day to reference" still works on
 *  the copy), starts in `draft` state regardless of source state, and
 *  prefixes the title with "Copy of ". RLS scopes the source read and
 *  the insert is gated by auth.uid() === owner_id, so callers can only
 *  duplicate their own trips. Returns the new trip id. */
export async function duplicateTrip(
  id: string,
): Promise<Result<{ id: string }>> {
  if (!isConfigured()) return { ok: false, error: "Auth isn't configured." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to duplicate trips." };

  const { data: source, error: readErr } = await supabase
    .from("trips")
    .select("title, payload, reference_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !source) {
    return { ok: false, error: "Not found or not yours." };
  }

  const baseTitle = `Copy of ${source.title}`;
  const title =
    baseTitle.length > MAX_TITLE ? baseTitle.slice(0, MAX_TITLE) : baseTitle;

  const { data: inserted, error: insertErr } = await supabase
    .from("trips")
    .insert({
      owner_id: user.id,
      reference_id: source.reference_id,
      title,
      state: "draft",
      payload: source.payload,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message ?? "Could not duplicate." };
  }

  revalidatePath("/trips");
  return { ok: true, data: { id: inserted.id } };
}
