"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import {
  PLAN_STEPS,
  STEP_DISPLAY_NUMBER,
  TOTAL_DISPLAY_STEPS,
  type PlanStep,
} from "@/lib/plan/types";

/**
 * Reads the active step from the URL via the layout segment. Lives in the
 * shared /plan/[id]/layout.tsx so navigating between steps doesn't remount
 * the vnav / topbar chrome.
 */
export function PlanningTopbar() {
  const segment = useSelectedLayoutSegment();
  const step: PlanStep | undefined =
    segment && (PLAN_STEPS as readonly string[]).includes(segment)
      ? (segment as PlanStep)
      : undefined;
  const displayStep = step ? STEP_DISPLAY_NUMBER[step] : undefined;

  return (
    <header className="h-[60px] flex items-center justify-between px-6 border-b border-border-subtle bg-bg-topbar">
      <span className="font-sans font-bold text-xl tracking-wide text-text-primary">
        PLANNING
      </span>
      {displayStep !== undefined && (
        <span className="section-label text-xs text-text-primary">
          STEP {String(displayStep).padStart(2, "0")} /{" "}
          {String(TOTAL_DISPLAY_STEPS).padStart(2, "0")}
        </span>
      )}
    </header>
  );
}
