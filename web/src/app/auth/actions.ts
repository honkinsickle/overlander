"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

/** Kick off Google OAuth. Redirects to Google's consent screen; Supabase
 *  hands the user back to /auth/callback?code=... with the auth code. */
export async function signInWithGoogle(formData: FormData) {
  if (!isConfigured()) {
    redirect("/auth/sign-in?error=supabase_not_configured");
  }

  const next = (formData.get("next") as string | null) ?? "/";
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const callback = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback },
  });

  if (error || !data.url) {
    redirect(`/auth/sign-in?error=${encodeURIComponent(error?.message ?? "oauth_failed")}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
