"use client";

import { MapPinPlus } from "lucide-react";

/**
 * Trip Action FAB — "Add stop here" extended pill. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md §2.3 + §3, Decision 3).
 *
 * Blue (#1F5E8E) — matches Suggestion Card v2's "Add to Day N" CTAs.
 * Original brief had it amber; switched to blue during the v2 build to
 * keep amber reserved for measurement chips, not action.
 *
 * Trigger handler is a stub this round (Search Active is the natural
 * follow-up: tapping FAB opens Search Active with "ADDING TO Day N"
 * scope pre-set).
 */
export function TripActionFab() {
  return (
    <button
      type="button"
      aria-label="Add stop here"
      disabled
      className="absolute bottom-6 right-6 z-30 flex items-center gap-2.5 h-[56px] pl-[18px] pr-[22px] rounded-full font-sans text-[14px] font-semibold text-white disabled:opacity-90 disabled:cursor-not-allowed"
      style={{
        background: "#1F5E8E",
        letterSpacing: "0.02em",
        boxShadow:
          "0 6px 16px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.25)",
      }}
    >
      <MapPinPlus className="w-5 h-5" strokeWidth={2.25} />
      Add stop here
    </button>
  );
}
