"use client";

import { Route } from "lucide-react";

/** Circle "directions" button rendered top-right of the map column,
 *  below the user-location follow button. Click dispatches
 *  `trip:openDirections` which the DirectionsPanel listens for. */
export function DirectionsButton() {
  const onClick = () => {
    window.dispatchEvent(new CustomEvent("trip:openDirections"));
  };
  return (
    <div className="absolute top-[84px] right-[18px] z-10 pointer-events-auto">
      <button
        type="button"
        onClick={onClick}
        aria-label="Open directions"
        title="Directions"
        className="w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-colors bg-bg-nav-btn/90 border border-button-primary-border text-input-border-focus hover:text-text-main"
      >
        <Route className="w-5 h-5" />
      </button>
    </div>
  );
}
