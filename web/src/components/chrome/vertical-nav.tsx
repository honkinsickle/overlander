import { MapPin, MessageSquare } from "lucide-react";
import { ProfileMenu } from "./profile-menu";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Vertical Nav — Paper `AEP-0` (code-aligned).
 *
 * 80px column · bg --bg-nav-btn · right border --border-subtle.
 * Chats (default active) / Trips up top, profile (or sign-in) pinned to
 * the bottom.
 *
 * Used by PlanningLayout (home + wizard steps) and the trip-view layout.
 * Server component — loads the user from Supabase so the menu renders
 * with no client-side flicker.
 */
export async function VerticalNav({ active = "chats" }: { active?: NavItem }) {
  const user = await loadUser();

  return (
    <aside
      className="w-[80px] h-full flex flex-col items-center justify-between py-4 bg-bg-nav-btn border-r border-border-subtle shrink-0"
      aria-label="Vertical navigation"
    >
      <div className="flex flex-col gap-6">
        <NavButton
          icon={MessageSquare}
          label="Chats"
          active={active === "chats"}
        />
        <NavButton icon={MapPin} label="Trips" active={active === "trips"} />
      </div>
      <ProfileMenu user={user} />
    </aside>
  );
}

async function loadUser(): Promise<{
  name: string;
  avatarUrl: string | null;
} | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const name =
      profile?.name ??
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Account";
    const avatarUrl =
      (user.user_metadata?.avatar_url as string | undefined) ?? null;
    return { name, avatarUrl };
  } catch {
    return null;
  }
}

export type NavItem = "chats" | "trips";

function NavButton({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={[
          "w-10 h-10 flex items-center justify-center rounded",
          active ? "bg-bg-tab-active text-amber" : "text-text-primary",
        ].join(" ")}
      >
        <Icon className="w-5 h-5" />
      </div>
      <span className="font-sans text-[11px] text-text-primary">{label}</span>
    </div>
  );
}
