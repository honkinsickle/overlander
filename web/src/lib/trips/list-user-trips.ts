import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Trip } from "./types";

export type UserTripSummary = {
  id: string;
  title: string;
  state: "draft" | "active" | "logged";
  referenceId: string | null;
  updatedAt: string;
  // Subset pulled from payload for card render. The full Trip stays in
  // payload — we hydrate the rest on the trip page.
  startDate: string;
  endDate: string;
  startLocation: string;
  endLocation: string;
  heroImage?: string;
  dayCount: number;
};

/** List the authed user's trips. RLS scopes to auth.uid() === owner_id,
 *  so the server client (cookie-backed) is the right tool here — no
 *  service role needed. */
export async function listUserTrips(): Promise<UserTripSummary[]> {
  if (!isConfigured()) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trips")
      .select("id, title, state, reference_id, updated_at, payload")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => {
      const p = row.payload as Trip;
      return {
        id: row.id,
        title: row.title,
        state: row.state as UserTripSummary["state"],
        referenceId: row.reference_id,
        updatedAt: row.updated_at,
        startDate: p.startDate,
        endDate: p.endDate,
        startLocation: p.startLocation,
        endLocation: p.endLocation,
        heroImage: p.heroImage,
        dayCount: p.days?.length ?? 0,
      };
    });
  } catch {
    return [];
  }
}
