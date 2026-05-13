import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

/** Refresh the Supabase session cookie on every navigation. Without this
 *  the access token expires and the user gets logged out mid-session.
 *  Wired up from middleware.ts at the repo root (created in Day 2).
 *
 *  No-op when env is unmet so the app boots before Supabase is provisioned. */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the session so token refreshes hit setAll. Authorization checks
  // (and any redirect-to-/welcome wiring) belong to Day 2 — keep this lean.
  await supabase.auth.getUser();

  return response;
}
