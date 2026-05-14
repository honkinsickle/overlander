import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

// Paths that must remain reachable even when the user is signed-in but
// hasn't completed onboarding. The OAuth roundtrip lands at /auth/callback;
// /welcome is where we send them next, so neither can redirect to /welcome.
// /api/* needs to return JSON, not an HTML redirect.
const ONBOARDING_EXEMPT_PREFIXES = ["/auth", "/welcome", "/api", "/_next"];

/** Refresh the Supabase session cookie on every navigation, and route
 *  freshly-authenticated users without a profile row to /welcome.
 *
 *  Wired from src/proxy.ts. No-op when env is unmet so the app boots
 *  before Supabase is provisioned. */
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return response;

  const pathname = request.nextUrl.pathname;
  const exempt = ONBOARDING_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
  if (exempt) return response;

  const { data: profile } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    const redirect = NextResponse.redirect(url);
    // Carry any cookies setAll wrote onto `response` (refreshed tokens)
    // onto the redirect — otherwise the browser drops them.
    for (const c of response.cookies.getAll()) {
      redirect.cookies.set(c.name, c.value, c);
    }
    return redirect;
  }

  return response;
}
