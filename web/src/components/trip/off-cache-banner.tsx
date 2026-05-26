"use client";

import { CloudOff, X } from "lucide-react";
import type mapboxgl from "mapbox-gl";
import { useViewportCoverage } from "@/lib/offline/use-viewport-coverage";
import { isUserTrip } from "@/lib/trips/is-user-trip";
import type { OfflinePhase, Trip } from "@/lib/trips/types";

/**
 * Top-of-map banner shown when the visible area isn't covered by any
 * primed phase. CTA opens the OfflinePanel via the
 * `trip:openOfflinePanel` custom event; an optional `phaseId` in the
 * event detail lets the panel scroll/highlight that row (handled by
 * SlideupShell + OfflinePanel in C6).
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
  // banners — see the !isUserTrip note below for why reference trips
  // get a hard early-return rather than relying on the natural
  // "no-phases" fallthrough.
  const { status, suggestedPhase, dismissed, dismiss } = useViewportCoverage(
    map,
    trip,
  );

  if (!map) return null;
  // Reference trips (slug ids like "la-to-deadhorse") can't host
  // offlinePhases — `setOfflinePhasesAction` rejects non-UUID ids —
  // and the OfflinePanel + `trip:openOfflinePanel` event listener are
  // both gated on `isUserTrip` in SlideupShell. Without this gate the
  // banner would surface "no-phases" on reference trips with a CTA
  // whose dispatched event has no listener to receive it.
  if (!isUserTrip(trip)) return null;
  if (status === "covered") return null;
  if (dismissed) return null;

  const onCta = () => {
    window.dispatchEvent(
      new CustomEvent("trip:openOfflinePanel", {
        detail: suggestedPhase ? { phaseId: suggestedPhase.id } : undefined,
      }),
    );
  };

  return (
    <div className="absolute top-4 right-20 z-20 max-w-[440px] pointer-events-auto">
      <div className="flex items-center gap-3 rounded-lg bg-bg-card/95 border border-border-mid px-3 py-2.5 shadow-lg backdrop-blur-sm">
        <CloudOff className="w-4 h-4 shrink-0 text-amber-light" />
        <p className="flex-1 font-sans text-[12px] leading-[16px] text-text-primary">
          {bodyText(status)}
        </p>
        <button
          type="button"
          onClick={onCta}
          className="inline-flex items-center h-7 px-3 rounded-full bg-amber text-bg-base font-sans text-[11px] font-semibold hover:opacity-90 shrink-0"
        >
          {ctaText(status, suggestedPhase)}
        </button>
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

function ctaText(
  status: "uncovered" | "no-phases",
  suggestedPhase: OfflinePhase | null,
): string {
  if (status === "no-phases") return "Set up offline";
  if (suggestedPhase) {
    // TODO(phase-editing): assumes default `suggestDefaultPhases` label
    // format "Week N: Days X–Y" — splitting on ":" gives "Week N" cleanly.
    // When phase editing ships and labels can be user-edited (no colon,
    // arbitrary text), tighten this — either store a separate short
    // label on OfflinePhase or truncate by character count.
    return `Prime ${suggestedPhase.label.split(":")[0]}`;
  }
  return "Open offline panel";
}
