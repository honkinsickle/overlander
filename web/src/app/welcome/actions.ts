"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Writes the user's profile row. RLS allows insert only when
 *  auth.uid() === new.id, so a hijacked form post can't impersonate. */
export async function completeWelcome(formData: FormData) {
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const rigName = ((formData.get("rig_name") as string | null) ?? "").trim();
  const rigType = ((formData.get("rig_type") as string | null) ?? "").trim();
  const nextRaw = (formData.get("next") as string | null) ?? "/";
  const next = nextRaw.startsWith("/") ? nextRaw : "/";

  if (!name) {
    redirect(
      `/welcome?error=${encodeURIComponent("Name is required")}&next=${encodeURIComponent(next)}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  }

  const { error } = await supabase.from("users").insert({
    id: user.id,
    name,
    rig_name: rigName || null,
    rig_type: rigType || null,
  });

  if (error) {
    redirect(
      `/welcome?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    );
  }

  redirect(next);
}
