import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WizardSlices, PlanStep } from "@/lib/plan/types";
import type { Trip } from "./types";
import { TRIPS } from "./fixtures";

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
  /** Wizard-step deeplink for draft cards. Drafts on /trips link to
   *  /plan/<id>/<wizardStep> so the user lands back on the step they
   *  left off. Active / logged trips ignore this field. */
  wizardStep?: PlanStep;
};

/** List the authed user's trips. RLS scopes to auth.uid() === owner_id,
 *  so the server client (cookie-backed) is the right tool here — no
 *  service role needed.
 *
 *  TEST MODE: when there is no Supabase session (sign-in disabled),
 *  fall back to the in-memory anon trip store so /trips still shows
 *  trips created via the anonymous wizard path. Anon trip ids are
 *  `trip-<8-char>` and are scoped to the dev server's lifetime. */
export async function listUserTrips(): Promise<UserTripSummary[]> {
  if (!isConfigured()) return listAnonTrips();
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return listAnonTrips();

    const { data, error } = await supabase
      .from("trips")
      .select("id, title, state, reference_id, updated_at, payload")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => {
      const p = row.payload as Trip;
      const wizard = p.wizard as WizardSlices | undefined;
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
        wizardStep: wizard?.currentStep,
      };
    });
  } catch {
    return [];
  }
}

/** In-memory list of anon-created trips (test mode). Skips reference
 *  trips (slug ids like "la-to-deadhorse") — those have their own
 *  surface via the home-page CTA. */
function listAnonTrips(): UserTripSummary[] {
  return Object.entries(TRIPS)
    .filter(([id]) => id.startsWith("trip-"))
    .map(([id, p]) => ({
      id,
      title: p.title,
      state: "active" as const,
      referenceId: null,
      updatedAt: p.startDate,
      startDate: p.startDate,
      endDate: p.endDate,
      startLocation: p.startLocation,
      endLocation: p.endLocation,
      heroImage: p.heroImage,
      dayCount: p.days?.length ?? 0,
    }))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}
