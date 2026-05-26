"use client";

import { CloudOff, X } from "lucide-react";
import type mapboxgl from "mapbox-gl";
import { useViewportCoverage } from "@/lib/offline/use-viewport-coverage";
import { isUserTrip } from "@/lib/trips/is-user-trip";
import type { Trip } from "@/lib/trips/types";

/**
 * Top-of-map banner shown when the visible area isn't covered by any
 * primed phase. Surfaces awareness only — the "Open offline panel" CTA
 * lives in the DayColumnPlanner footer (always visible, single place
 * to act). Banner dismiss is local-session.
 *
 * Renders nothing when:
 *  - status is "covered"
 *  - user has dismissed the banner this session (resets on phase
 *    identity change or slideup close+reopen)
 *  - mapInstance is absent (banner has nothing to react to)
 */
export function OffCacheBanner({
  map,
  trip,
}: {
  map: mapboxgl.Map | null;
  trip: Trip;
}) {
  // Hook runs unconditionally (Rules of Hooks). Bail to null after the
  // hook call for reference trips, covered viewports, or user-dismissed
  // banners.
  const { status, dismissed, dismiss } = useViewportCoverage(map, trip);

  if (!map) return null;
  if (!isUserTrip(trip)) return null;
  if (status === "covered") return null;
  if (dismissed) return null;

  return (
    <div className="absolute top-4 right-20 z-20 max-w-[440px] pointer-events-auto">
      <div className="flex items-center gap-3 rounded-lg bg-bg-card/95 border border-border-mid px-3 py-2.5 shadow-lg backdrop-blur-sm">
        <CloudOff className="w-4 h-4 shrink-0 text-amber-light" />
        <p className="flex-1 font-sans text-[12px] leading-[16px] text-text-primary">
          {bodyText(status)}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss off-cache banner"
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:bg-white/[0.04] shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function bodyText(status: "uncovered" | "no-phases"): string {
  if (status === "no-phases") {
    return "This trip has no offline maps yet.";
  }
  return "This area isn't downloaded for offline use.";
}

