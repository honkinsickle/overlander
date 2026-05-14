import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/env";

/** OAuth landing. Supabase redirects here with ?code=... after Google
 *  consents; we exchange it for a session cookie and bounce to `next`.
 *
 *  Cookies are set directly on the response we return, NOT via
 *  `next/headers`. Cookies written through `cookies()` from a Route
 *  Handler don't reliably propagate onto a `NextResponse.redirect()`
 *  built by hand, so the session would silently vanish between this
 *  request and the next one. Setting on the explicit response object
 *  is the canonical Supabase SSR pattern. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";

  if (!isConfigured()) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=supabase_not_configured`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=missing_code`);
  }

  // Build the response up-front so the supabase client can write
  // refreshed-session cookies onto it.
  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/sign-in?error=${encodeURIComponent(error.message)}`,
    );
  }

  // First-time users go straight to /welcome instead of the proxy
  // double-hop. Build a *new* response that points there and copy the
  // session cookies set on the original `response`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) {
      const welcome = NextResponse.redirect(
        `${origin}/welcome?next=${encodeURIComponent(next)}`,
      );
      for (const c of response.cookies.getAll()) {
        welcome.cookies.set(c.name, c.value, c);
      }
      return welcome;
    }
  }

  return response;
}
