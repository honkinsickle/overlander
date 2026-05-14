"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

type Result = { ok: true } | { ok: false; error: string };

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
