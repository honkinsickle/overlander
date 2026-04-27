"use client";

import type { ReactNode } from "react";
import { EntryScene } from "./entry-scene";

/**
 * Renders wizard-step chrome (entry scene + scrim + centered modal) for
 * /plan/:id/:step routes.
 */
export function WizardBackdrop({ children }: { children: ReactNode }) {
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
