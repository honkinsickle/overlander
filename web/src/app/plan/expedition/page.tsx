import { notFound, redirect } from "next/navigation";
import { ExpeditionWizard } from "@/components/plan/expedition-wizard";
import { isExpeditionWizardEnabled } from "@/lib/plan/expedition";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listVehicles } from "@/lib/vehicles/repository";

/**
 * Expedition planner wizard — the UI front door for the YoTrippin generation
 * pipeline. GATED: 404s unless ENABLE_PLANNER_WIZARD=true, so it's dev-only
 * opt-in and never exposed on prod (matches the dormant pipeline). The server
 * action it calls also refuses to persist anywhere but the TEST project.
 *
 * SIGN-IN REQUIRED. Generation must produce an OWNED trip
 * (`docs/decisions/2026-07-27-generation-requires-sign-in.md`), so the page is
 * gated. The redirect shape matches the canonical gate in `app/trips/layout.tsx`
 * — the same `/auth/sign-in?next=…` convention used across the app.
 *
 * ORDER MATTERS: the flag check runs FIRST so a disabled wizard still 404s for
 * everyone. Gating on auth first would leak the route's existence to signed-out
 * users — a redirect to sign-in says "this exists", a 404 says nothing.
 *
 * This page gate does NOT cover the server action. Per `web/src/proxy.ts`'s own
 * comment, Server Actions are POSTs to the page they live on, so a session that
 * lapses between render and submit still reaches the action — which carries its
 * own `getUser()` check. Both halves are required.
 */
export default async function ExpeditionPlannerPage() {
  if (!isExpeditionWizardEnabled()) notFound();

  // `createSupabaseServerClient` throws via `requireUrlAndAnon` when the env is
  // missing, so check configuration first — same ordering as `trips/layout.tsx`.
  if (!isConfigured()) {
    redirect("/auth/sign-in?error=supabase_not_configured");
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/sign-in?next=/plan/expedition");
  }

  const vehicles = await listVehicles();
  return (
    <main className="min-h-screen bg-base">
      <ExpeditionWizard vehicles={vehicles} />
    </main>
  );
}
