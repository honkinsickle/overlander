import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Trip } from "./types";

export type ReferenceTripSummary = {
  id: string;
  title: string;
  startLocation: string;
  endLocation: string;
  startDate: string;
  endDate: string;
  heroImage?: string;
  dayCount: number;
};

/** Read the canonical reference trips for the `/trips` page header.
 *  `reference_trips` has an RLS `using (true)` policy, so the
 *  cookie-backed server client works even for anon (we still gate
 *  /trips on auth at the page level). */
export async function listReferenceTrips(): Promise<ReferenceTripSummary[]> {
  if (!isConfigured()) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("reference_trips")
      .select("id, title, payload");
    if (error || !data) return [];
    return data.map((row) => {
      const p = row.payload as Trip;
      return {
        id: row.id,
        title: row.title,
        startLocation: p.startLocation,
        endLocation: p.endLocation,
        startDate: p.startDate,
        endDate: p.endDate,
        heroImage: p.heroImage,
        dayCount: p.days?.length ?? 0,
      };
    });
  } catch {
    return [];
  }
}
