"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { useLegDirections } from "@/lib/directions/use-leg-directions";
import {
  buildStepDistanceIndex,
  currentStepIndex,
  stepNearestCoord,
} from "@/lib/directions/current-step";
import {
  formatLegDuration,
  formatStepDistance,
  maneuverIcon,
} from "@/lib/directions/maneuver-icon";
import { useUserLocation } from "@/lib/location/use-user-location";

const OFF_ROUTE_THRESHOLD_MI = 0.25;

/** Custom-event detail shape for `trip:openDirections`. Optional
 *  `waypointCoord` lets a WaypointDetail's Directions button open the
 *  panel and scroll to the step closest to that waypoint. */
type OpenDetail = { waypointCoord?: [number, number] };

/** Slide-up panel anchored to the bottom of the map column. Listens
 *  for `trip:openDirections` and `trip:closeDirections`. Fetches
 *  Mapbox turn-by-turn for the active day's leg on open, highlights
 *  the user's current step from GPS, and scrolls to a waypoint-
 *  contextual step when triggered from a waypoint card. */
export function DirectionsPanel({
  legStart,
  legEnd,
  legLabel,
  dayNumber,
}: {
  legStart: [number, number] | null;
  legEnd: [number, number] | null;
  legLabel?: string;
  dayNumber?: number;
}) {
  const [open, setOpen] = useState(false);
  const [scrollToCoord, setScrollToCoord] = useState<
    [number, number] | null
  >(null);
  // Only request directions while the panel is open — saves a Mapbox
  // call on every page load for users who never tap the directions
  // icon. Cache inside the hook makes reopen-instant either way.
  const fetchStart = open ? legStart : null;
  const fetchEnd = open ? legEnd : null;
  const status = useLegDirections(fetchStart, fetchEnd);
  const { position } = useUserLocation();

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Remembers the last step we auto-scrolled to. Keeps GPS-update
   *  re-runs from re-scrolling and cancelling each other (and from
   *  fighting the user's manual scroll). Reset on close. */
  const lastScrolledRef = useRef<number | null>(null);

  // Cumulative-distance index is shared between GPS matching and the
  // "scroll to step nearest waypoint" path. Recomputed only when the
  // underlying steps change.
  const distIndex = useMemo(() => {
    if (status.kind !== "ready") return null;
    return buildStepDistanceIndex(status.data.steps);
  }, [status]);

  // Current step from GPS (null when no GPS / no steps yet).
  const current = useMemo(() => {
    if (!position || status.kind !== "ready" || !distIndex) return null;
    return currentStepIndex(position, status.data.steps, distIndex);
  }, [position, status, distIndex]);

  const closePanel = () => {
    setOpen(false);
    setScrollToCoord(null);
    lastScrolledRef.current = null;
  };

  // Open/close from anywhere in the trip surface.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenDetail>).detail ?? {};
      setOpen(true);
      setScrollToCoord(detail.waypointCoord ?? null);
    };
    const onClose = () => closePanel();
    window.addEventListener("trip:openDirections", onOpen);
    window.addEventListener("trip:closeDirections", onClose);
    return () => {
      window.removeEventListener("trip:openDirections", onOpen);
      window.removeEventListener("trip:closeDirections", onClose);
    };
  }, []);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-scroll: when opening from a waypoint, scroll to nearest step.
  // Otherwise, keep the current GPS step visible.
  useEffect(() => {
    if (!open || status.kind !== "ready") return;
    let targetIdx: number | null = null;
    if (scrollToCoord) {
      targetIdx = stepNearestCoord(scrollToCoord, status.data.steps);
    } else if (current && current.offRouteMi <= OFF_ROUTE_THRESHOLD_MI) {
      targetIdx = current.index;
    }
    if (targetIdx == null) return;
    if (lastScrolledRef.current === targetIdx) return;
    const row = rowRefs.current[targetIdx];
    const scroller = listRef.current;
    if (!row || !scroller) return;
    // Manual scroll — scrollIntoView confuses which ancestor to scroll
    // in this flex layout, and smooth scrollTo gets cancelled by
    // re-runs of this effect when GPS fires.
    scroller.scrollTop =
      row.offsetTop - scroller.clientHeight / 2 + row.offsetHeight / 2;
    lastScrolledRef.current = targetIdx;
  }, [open, status, current, scrollToCoord]);

  const onStepClick = (coord: [number, number]) => {
    window.dispatchEvent(
      new CustomEvent("trip:flyTo", {
        detail: { coords: coord, zoom: 14 },
      }),
    );
  };

  const offRoute =
    current != null && current.offRouteMi > OFF_ROUTE_THRESHOLD_MI;

  return (
    <div
      data-directions-panel={open ? "open" : "closed"}
      className={`absolute inset-x-0 bottom-0 z-20 transition-transform duration-300 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!open}
    >
      <div className="h-[60vh] max-h-[600px] bg-bg-card border-t border-button-primary-border shadow-2xl flex flex-col">
        <header className="shrink-0 px-4 py-3 border-b border-button-primary-border">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
                {dayNumber != null
                  ? `Day ${dayNumber} · directions`
                  : "Directions"}
              </div>
              <div className="text-sm font-semibold text-text-main truncate">
                {legLabel ?? "—"}
              </div>
              {status.kind === "ready" && (
                <div className="text-xs text-text-muted mt-0.5">
                  {formatStepDistance(status.data.totalDistanceMeters)} ·{" "}
                  {formatLegDuration(status.data.totalDurationSec)}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close directions"
              className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-text-muted hover:text-text-main"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {offRoute && (
            <div className="mt-2 text-[11px] font-mono uppercase tracking-wider text-amber-400">
              Off route · {current!.offRouteMi.toFixed(1)} mi
            </div>
          )}
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {status.kind === "loading" && (
            <div className="p-4 text-sm text-text-muted">
              Loading directions…
            </div>
          )}
          {status.kind === "error" && (
            <div className="p-4 text-sm text-amber-400">
              Couldn&apos;t load directions: {status.message}
            </div>
          )}
          {status.kind === "ready" &&
            status.data.steps.map((step, i) => {
              const Icon = maneuverIcon(step);
              const isCurrent =
                !offRoute && current?.index === i;
              return (
                <button
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  key={i}
                  type="button"
                  onClick={() =>
                    step.coords[0] && onStepClick(step.coords[0])
                  }
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-button-primary-border/40 transition-colors ${
                    isCurrent
                      ? "bg-[#1B2A4A] border-l-2 border-l-[#6EB1FF]"
                      : "hover:bg-bg-nav-btn/40"
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      isCurrent
                        ? "text-[#6EB1FF]"
                        : "text-text-muted"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-main">
                      {step.instruction}
                    </div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-text-muted mt-0.5">
                      {formatStepDistance(step.distanceMeters)}
                      {step.name ? ` · ${step.name}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
