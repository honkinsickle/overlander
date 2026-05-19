import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUserWizardTrip } from "@/lib/trips/user-trips";
import { newDraftId } from "@/lib/plan/store";
import { writeDraftsToResponse } from "@/lib/plan/cookie-store";
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

  // Anon path: mint a draft id and write a fresh single-entry cookie.
  // We REPLACE rather than merge — anon users only have one in-flight
  // wizard, and merging caused a Vercel-only failure mode where the
  // cookie accumulated multiple ids and the URL ended up pointing at
  // one that hadn't merged correctly on the response chain. Old drafts
  // are abandoned on each /plan visit; that's fine since the wizard
  // can't be resumed mid-flow from a different tab anyway.
  //
  // (Reads still tolerate the legacy multi-draft cookie via the
  // most-recent fallback in `repository.ts/getDraft`.)
  const id = newDraftId();
  const draft: DraftTrip = {
    id,
    status: "draft",
    createdAt: new Date().toISOString(),
  };

  const response = NextResponse.redirect(
    new URL(`/plan/${id}/going`, req.url),
  );
  writeDraftsToResponse(response, { [id]: draft });
  return response;
}
