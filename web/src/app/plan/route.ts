import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUserWizardTrip } from "@/lib/trips/user-trips";
import { newDraftId } from "@/lib/plan/store";
import { readDrafts, writeDraftsToResponse } from "@/lib/plan/cookie-store";
import type { DraftTrip } from "@/lib/plan/types";

/**
 * GET /plan — mint a fresh wizard-backed trip and redirect to its
 * first step.
 *
 * Authed users get a persisted public.trips row (state='draft',
 * reference_id=null) so their wizard progress survives reloads and
 * shows on /trips as a draft card. Anonymous users fall through to
 * the cookie-backed draft path so wizard state survives across
 * serverless lambda hops on Vercel.
 *
 * This is a Route Handler (not a Server Component) because the anon
 * path writes a `Set-Cookie` header before redirecting — Server
 * Components can read cookies but not write them.
 */
export async function GET(req: Request) {
  if (isConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const tripId = await createUserWizardTrip();
      if (tripId) {
        return NextResponse.redirect(
          new URL(`/plan/${tripId}/going`, req.url),
        );
      }
      // Fall through to anon cookie path if the insert failed.
    }
  }

  // Anon path: mint a draft id, add it to the cookie-stored map, and
  // set the cookie on the redirect response. We can't go through the
  // `next/headers` cookies() API here because its mutations don't
  // attach to a manually-built NextResponse.
  const id = newDraftId();
  const draft: DraftTrip = {
    id,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  const drafts = await readDrafts();
  drafts[id] = draft;

  const response = NextResponse.redirect(
    new URL(`/plan/${id}/going`, req.url),
  );
  writeDraftsToResponse(response, drafts);
  return response;
}
