"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured, isTestOnlyBypassAllowed } from "@/lib/supabase/env";

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

/**
 * TEST-ONLY dev convenience: sign in as the seeded `seed-owner@overlander.test`
 * user by password. Exists because Google OAuth isn't an enabled provider on
 * TEST Supabase (`/auth/v1/settings` returns email-only — measured 2026-08-24),
 * so the only production sign-in method can't complete against TEST and
 * blocks basic dev workflows.
 *
 * ⚠ MUST NEVER RUN AGAINST PROD. Gated STRUCTURALLY by
 * `isTestOnlyBypassAllowed()` (see `lib/supabase/env.ts`): both the Supabase
 * URL must match the TEST project exactly AND `NODE_ENV !== "production"`.
 * Both fail closed on any missing/wrong/unexpected value. If either gate
 * fails the action returns a sign-in error rather than proceeding — and
 * even if both gates were somehow bypassed, `seed-owner@overlander.test`
 * doesn't exist on PROD Supabase, so the credential would simply be
 * rejected by GoTrue. Belt + suspenders + backup gate.
 *
 * The credentials here are the TEST-only fixture credentials seeded by
 * `web/scripts/seed-test-user.ts` (password is a hardcoded TEST fixture
 * per that script's `PW` const, NOT a real secret) — same pair used by
 * `mint-dev-session.ts` for cookie-injection sign-in.
 *
 * Decision doc: `docs/decisions/2026-08-25-test-only-signin-bypass.md`.
 */
export async function signInAsSeedTestUser(formData: FormData) {
  if (!isTestOnlyBypassAllowed()) {
    // Structural refusal — fires when either gate fails (wrong Supabase
    // URL OR production build). Route back to the sign-in screen with an
    // error so the user sees why they can't use it, rather than a silent
    // no-op that looks like the button just doesn't work.
    redirect(
      `/auth/sign-in?error=${encodeURIComponent("test_bypass_not_allowed")}`,
    );
  }
  if (!isConfigured()) {
    redirect("/auth/sign-in?error=supabase_not_configured");
  }

  const next = (formData.get("next") as string | null) ?? "/";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: "seed-owner@overlander.test",
    password: "seed-pw-manual-edit-8471",
  });
  if (error) {
    redirect(
      `/auth/sign-in?error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(next);
}
