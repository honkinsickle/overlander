import type { ReactNode } from "react";
import { VerticalNav } from "@/components/chrome/vertical-nav";
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
