import { LogOut, MapPin, MessageSquare } from "lucide-react";

/**
 * Vertical Nav — Paper `AEP-0` (code-aligned).
 *
 * 80px column · bg --bg-nav-btn · right border --border-subtle.
 * Chats (default active) / Trips up top, Sign Out pinned to the bottom.
 *
 * Used by PlanningLayout (home + wizard steps) and the trip-view layout.
 */
export function VerticalNav({ active = "chats" }: { active?: NavItem }) {
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
      <NavButton icon={LogOut} label="Sign Out" />
    </aside>
  );
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
