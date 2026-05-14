import { redirect } from "next/navigation";
import { createDraft } from "@/lib/plan/repository";
import { createUserWizardTrip } from "@/lib/trips/user-trips";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

/**
 * /plan — creates a fresh wizard-backed trip and redirects to its
 * first step.
 *
 * Authed users get a persisted public.trips row (state='draft',
 * reference_id=null) so their wizard progress survives reloads and
 * shows on /trips as a draft card. Anonymous users fall through to
 * the in-memory DRAFTS path (legacy, evaporates on restart) — the
 * Sprint 2 hybrid will gate this behind a sign-in prompt once the
 * migration-on-sign-in handler lands. Until then, an anonymous user
 * who reaches this route still gets a working wizard, just one that
 * doesn't persist.
 */
export default async function PlanEntry() {
  if (isConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const tripId = await createUserWizardTrip();
      if (tripId) redirect(`/plan/${tripId}/going`);
      // Fall through to anonymous draft if the insert failed
      // (extremely unlikely under healthy RLS).
    }
  }
  const draft = await createDraft();
  redirect(`/plan/${draft.id}/going`);
}
