"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { EntryScene } from "./entry-scene";

/**
 * Renders wizard-step chrome (entry scene + scrim + centered modal) for
 * most /plan/:id/:step routes. Steps that need full-bleed content
 * (Results) render children as-is.
 */
export function WizardBackdrop({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  if (segment === "results") {
    return <div className="absolute inset-0">{children}</div>;
  }
  return (
    <>
      <EntryScene muted />
      <Scrim />
      <div className="absolute inset-0 flex items-start justify-center pt-[22px] px-6 pb-6 overflow-y-auto">
        {children}
      </div>
    </>
  );
}

function Scrim() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 bg-black/35 pointer-events-none"
    />
  );
}
