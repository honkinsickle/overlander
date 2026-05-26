"use client";

import { CloudOff, X } from "lucide-react";
import type mapboxgl from "mapbox-gl";
import { useViewportCoverage } from "@/lib/offline/use-viewport-coverage";
import { isUserTrip } from "@/lib/trips/is-user-trip";
import type { Trip } from "@/lib/trips/types";

/**
 * Bottom-of-map banner shown when the visible area isn't covered by
 * any primed phase. CTA opens the OfflinePanel via the
 * `trip:openOfflinePanel` custom event; SlideupShell's listener handles
 * the mount.
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
  const { status, dismissed, dismiss } = useViewportCoverage(map, trip);

  if (!map) return null;
  if (!isUserTrip(trip)) return null;
  if (status === "covered") return null;
  if (dismissed) return null;

  const onCta = () => {
    window.dispatchEvent(new CustomEvent("trip:openOfflinePanel"));
  };

  return (
    <div className="absolute bottom-4 left-4 right-20 z-20 pointer-events-auto">
      <div className="flex items-center gap-3 rounded-lg bg-bg-card/95 border border-border-mid px-4 py-3 shadow-lg backdrop-blur-sm">
        <CloudOff className="w-5 h-5 shrink-0 text-amber-light" />
        <p className="flex-1 font-sans text-[14px] leading-[18px] text-text-primary">
          {bodyText(status)}
        </p>
        <button
          type="button"
          onClick={onCta}
          className="inline-flex items-center h-9 px-4 rounded-full font-sans text-[13px] font-semibold text-white shrink-0 hover:opacity-90 transition-opacity"
          style={{ backgroundColor: "var(--button-primary)" }}
        >
          Open Offline Maps
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss off-cache banner"
          className="flex items-center justify-center w-8 h-8 rounded-md text-text-muted hover:bg-white/[0.04] shrink-0"
        >
          <X className="w-4 h-4" />
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

