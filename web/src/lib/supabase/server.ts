import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireUrlAndAnon, requireServiceRole } from "./env";

/** Per-request Supabase client for Server Components, Server Actions,
 *  and Route Handlers. Reads the session out of Next.js cookies and
 *  writes refreshed tokens back when the call site allows it (Server
 *  Actions and Route Handlers do; Server Components do not — those
 *  attempts are swallowed silently because middleware handles refresh
 *  for the request lifetime). */
export async function createSupabaseServerClient() {
  const { url, anon } = requireUrlAndAnon();
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — middleware already refreshed
          // the session for this request; ignore.
        }
      },
    },
  });
}

/** Service-role client. Bypasses RLS — never expose to the browser.
 *  Used by the seed script and any future server-only admin tasks. */
export function createSupabaseServiceClient(): SupabaseClient {
  const { url, service } = requireServiceRole();
  return createPlainClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
