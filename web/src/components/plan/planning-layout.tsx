import type { ReactNode } from "react";
import { MessageSquare, MapPin, LogOut } from "lucide-react";
import { PlanningTopbar } from "./planning-topbar";

/**
 * Chrome shared across every /plan/:id/:step route: 80w vertical nav +
 * PLANNING topbar. The children area fills the remaining space; step
 * pages wrap their content in <WizardBackdrop> (which chooses between
 * the scrim-over-entry variant and a full-bleed variant for Results).
 */
export function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-[1133px] h-[744px] bg-bg-base text-text-primary relative overflow-hidden">
      <VerticalNav />
      <div className="flex-1 flex flex-col relative">
        <PlanningTopbar />
        <div className="flex-1 relative">{children}</div>
      </div>
    </div>
  );
}

function VerticalNav() {
  return (
    <aside
      className="w-[80px] h-full flex flex-col items-center justify-between py-4 bg-bg-panel border-r border-border-subtle"
      aria-label="Vertical navigation"
    >
      <div className="flex flex-col gap-6">
        <NavButton icon={MessageSquare} label="Chats" active />
        <NavButton icon={MapPin} label="Trips" />
      </div>
      <NavButton icon={LogOut} label="Sign Out" />
    </aside>
  );
}

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
