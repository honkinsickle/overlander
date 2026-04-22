"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * Renders wizard-step chrome (scenic entry-behind + scrim + centered
 * children) for most /plan/:id/:step routes. Steps that need full-bleed
 * content (Results) render children as-is.
 */
export function WizardBackdrop({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  if (segment === "results") {
    return <div className="absolute inset-0">{children}</div>;
  }
  return (
    <>
      <EntryBehind />
      <Scrim />
      <div className="absolute inset-0 flex items-center justify-center p-6 overflow-y-auto">
        {children}
      </div>
    </>
  );
}

function EntryBehind() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-60 pointer-events-none select-none"
    >
      <span className="font-mono text-xs tracking-[0.08em] text-text-muted uppercase">
        Overland Trip Planner
      </span>
      <h1 className="font-sans font-bold text-4xl text-text-primary">
        Where to today?
      </h1>
      <p className="max-w-[420px] text-center text-text-muted">
        Hey there, I&rsquo;m here to help you plan your next overland
        expedition. Ask me anything &mdash; destinations, routes, gear, or pit
        stops.
      </p>
    </div>
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
