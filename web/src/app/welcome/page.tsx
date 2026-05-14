import { redirect } from "next/navigation";
import { completeWelcome } from "./actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";

type Search = { next?: string; error?: string };

export default async function WelcomePage(props: {
  searchParams: Promise<Search>;
}) {
  const { next, error } = await props.searchParams;
  const nextPath = next && next.startsWith("/") ? next : "/";

  if (!isConfigured()) {
    redirect("/auth/sign-in?error=supabase_not_configured");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent("/welcome")}`);
  }

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) redirect(nextPath);

  const defaultName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-base text-text-primary px-6 py-12">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="font-mono text-[11px] tracking-[0.18em] text-amber uppercase">
            Welcome aboard
          </p>
          <h1 className="font-display text-3xl leading-tight">
            Let's get you set up.
          </h1>
          <p className="font-sans text-sm text-text-secondary">
            A few details so we can introduce you to the road.
          </p>
        </header>

        <form action={completeWelcome} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={nextPath} />

          <Field
            label="Your name"
            name="name"
            defaultValue={defaultName}
            required
            placeholder="Sam"
          />
          <Field
            label="Rig name"
            name="rig_name"
            placeholder="Old Blue"
            hint="Optional. What you call your vehicle."
          />
          <Field
            label="Rig type"
            name="rig_type"
            placeholder="4Runner · rooftop tent"
            hint="Optional. Make, model, setup — anything useful."
          />

          {error && (
            <p className="font-mono text-[11px] text-red-400">
              {decodeURIComponent(error)}
            </p>
          )}

          <button
            type="submit"
            className="h-11 rounded bg-amber text-bg-base font-sans text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Hit the road
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-text-secondary">
        {label}
        {required && <span className="text-amber"> *</span>}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="h-10 px-3 rounded bg-bg-panel border border-border-subtle text-text-primary font-sans text-sm focus:outline-none focus:border-amber"
      />
      {hint && (
        <span className="font-sans text-[11px] text-text-secondary">{hint}</span>
      )}
    </label>
  );
}
