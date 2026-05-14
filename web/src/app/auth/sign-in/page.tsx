import { redirect } from "next/navigation";
import { signInWithGoogle } from "../actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

type Search = { next?: string; error?: string };

export default async function SignInPage(props: {
  searchParams: Promise<Search>;
}) {
  const { next, error } = await props.searchParams;
  const nextPath = next && next.startsWith("/") ? next : "/";

  if (isConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(nextPath);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-base text-text-primary px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] tracking-[0.18em] text-amber uppercase">
            Overlander
          </p>
          <h1 className="font-display text-4xl leading-tight">
            Plan the long way home.
          </h1>
          <p className="font-sans text-sm text-text-secondary">
            Sign in to fork the reference trip and start your own.
          </p>
        </div>

        <form action={signInWithGoogle} className="w-full">
          <input type="hidden" name="next" value={nextPath} />
          <button
            type="submit"
            className="w-full h-11 rounded bg-text-primary text-bg-base font-sans text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-3"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>

        {error && (
          <p className="font-mono text-[11px] text-red-400 max-w-xs">
            {error === "supabase_not_configured"
              ? "Auth isn't configured in this environment yet."
              : decodeURIComponent(error)}
          </p>
        )}

        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary/70">
          Google · only sign-in method for v1
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.9 2.2 2.8 6.3 2.8 11.5S6.9 20.8 12 20.8c6.9 0 9.5-4.8 9.5-7.4 0-.5 0-.8-.1-1.2H12z"
      />
    </svg>
  );
}
