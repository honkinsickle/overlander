"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  useLegDirections,
  type DirectionStep,
} from "@/lib/directions/use-leg-directions";
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

/** Width of the panel — spans the left planning region (day column +
 *  day detail / browse), leaving the map clear on the right. Matches the
 *  Paper "Slideup · Directions Active" frame. */
const PANEL_WIDTH = 660;

/** Custom-event detail shape for `trip:openDirections`. Optional
 *  `waypointCoord` lets a WaypointDetail's Directions button open the
 *  panel and scroll to the step closest to that waypoint. */
type OpenDetail = { waypointCoord?: [number, number] };

/** "1530" sec → "25:30"; "24" sec → "0:24". Minutes:seconds for the
 *  short "to turn" countdown on the active maneuver. */
function formatTurnTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/** Live "from now" arrival clock, e.g. "7:34 PM". The web client has no
 *  planned departure time, so this is the ETA if you left now — the same
 *  basis any directions view uses. Not a stored/planned value. */
function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Destination city from a leg label like "Los Angeles, CA — St. George,
 *  UT" → "St. George, UT". Falls back to the whole label. */
function destFromLabel(label?: string): string | null {
  if (!label) return null;
  const parts = label.split(/—|–|-{1,2}|→/).map((s) => s.trim());
  const last = parts[parts.length - 1];
  return last || label;
}

/** Renders the Lucide maneuver icon for a step. Declared at module level
 *  so the icon component isn't created during the panel's render. */
function StepIcon({
  step,
  className,
  strokeWidth,
  style,
}: {
  step: DirectionStep;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  // createElement (not <Icon/>) keeps the lint rule that forbids creating
  // components during render happy — maneuverIcon returns one of several
  // static Lucide components based on the maneuver type/modifier.
  return createElement(maneuverIcon(step), { className, strokeWidth, style });
}

/**
 * Active-day turn-by-turn panel, repositioned to slide up over the LEFT
 * planning region (day column / day detail / browse) and surface ABOVE
 * the browse (z-40) and detail (z-30) panels — previously it rendered as
 * a bottom sheet at z-20, hidden behind them. The map stays clear on the
 * right. Layout follows the Paper "Directions Active" frame: a single
 * meta line + leg title, an amber active-maneuver card, then the UP NEXT
 * list and an arrive row.
 *
 * Listens for `trip:openDirections` / `trip:closeDirections`. Fetches
 * Mapbox turn-by-turn for the active day's leg on open, highlights the
 * user's current step from GPS, and scrolls to a waypoint-contextual step
 * when triggered from a waypoint card.
 */
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
  const [scrollToCoord, setScrollToCoord] = useState<[number, number] | null>(
    null,
  );
  // Time captured when the panel opens — the basis for the live arrival
  // ETA. Stamped in the open handler (not during render) so the render
  // stays pure.
  const [openedAtMs, setOpenedAtMs] = useState<number | null>(null);
  // Only request directions while the panel is open — saves a Mapbox call
  // on every page load for users who never tap the directions icon. Cache
  // inside the hook makes reopen-instant either way.
  const fetchStart = open ? legStart : null;
  const fetchEnd = open ? legEnd : null;
  const status = useLegDirections(fetchStart, fetchEnd);
  const { position } = useUserLocation();

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Remembers the last step we auto-scrolled to so GPS-update re-runs
   *  don't fight the user's manual scroll. Reset on close. */
  const lastScrolledRef = useRef<number | null>(null);

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
      setOpenedAtMs(Date.now());
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

  const offRoute =
    current != null && current.offRouteMi > OFF_ROUTE_THRESHOLD_MI;

  // The active maneuver is the GPS-matched step, or the first step when
  // there's no usable GPS fix (the common web-planning case).
  const activeIdx =
    !offRoute && current != null ? current.index : 0;

  // Auto-scroll the UP NEXT list to a waypoint-contextual step when opened
  // from a waypoint card.
  useEffect(() => {
    if (!open || status.kind !== "ready") return;
    if (!scrollToCoord) return;
    const targetIdx = stepNearestCoord(scrollToCoord, status.data.steps);
    if (targetIdx == null || lastScrolledRef.current === targetIdx) return;
    const row = rowRefs.current[targetIdx];
    const scroller = listRef.current;
    if (!row || !scroller) return;
    scroller.scrollTop =
      row.offsetTop - scroller.clientHeight / 2 + row.offsetHeight / 2;
    lastScrolledRef.current = targetIdx;
  }, [open, status, scrollToCoord]);

  const onStepClick = (coord?: [number, number]) => {
    if (!coord) return;
    window.dispatchEvent(
      new CustomEvent("trip:flyTo", { detail: { coords: coord, zoom: 14 } }),
    );
  };

  const ready = status.kind === "ready" ? status.data : null;
  const steps = ready?.steps ?? [];
  const activeStep: DirectionStep | undefined = steps[activeIdx];

  // Remaining drive time from the active step → live arrival ETA, anchored
  // to the time the panel opened (kept pure for render).
  const remainingSec = steps
    .slice(activeIdx)
    .reduce((sum, s) => sum + s.durationSec, 0);
  const eta =
    ready && openedAtMs != null
      ? formatClock(new Date(openedAtMs + remainingSec * 1000))
      : null;
  const dest = destFromLabel(legLabel);

  // UP NEXT rows = steps after the active one. Cumulative distance from the
  // active position to each maneuver, with the per-step length on the
  // right. The final arrive maneuver renders as its own row.
  const upNext = steps.slice(activeIdx + 1).map((step, k) => {
    const idx = activeIdx + 1 + k;
    const cumMeters = steps
      .slice(activeIdx, idx)
      .reduce((sum, s) => sum + s.distanceMeters, 0);
    return { step, idx, cumMeters };
  });
  const lastIdx = steps.length - 1;

  return (
    <div
      data-directions-panel={open ? "open" : "closed"}
      className="fixed inset-0 z-50 pointer-events-none"
      aria-hidden={!open}
    >
      <aside
        aria-label="Directions"
        style={{
          width: PANEL_WIDTH,
          transform: open ? "translateY(0)" : "translateY(100%)",
          transitionProperty: "transform",
          transitionDuration: "300ms",
          transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)",
          backgroundColor: "var(--bg-card)",
          borderTop: "2px solid var(--button-primary-border)",
          borderRight: "1px solid var(--border-subtle)",
        }}
        className="absolute top-[68px] bottom-0 left-0 flex flex-col shadow-2xl pointer-events-auto"
      >
        {/* Header — single meta line + leg title + close */}
        <header
          className="shrink-0 flex items-start gap-3"
          style={{
            padding: "16px 12px 14px 20px",
            borderBottom: "1px solid rgba(77,170,255,0.32)",
          }}
        >
          <div className="flex-1 min-w-0">
            <div
              className="uppercase"
              style={{
                fontFamily: "var(--ff-mono)",
                fontSize: 11,
                lineHeight: "16px",
                letterSpacing: "0.14em",
                color: "var(--amber)",
              }}
            >
              {dayNumber != null ? `Directions · Day ${dayNumber}` : "Directions"}
              {ready
                ? ` · ${formatStepDistance(ready.totalDistanceMeters)} · ${formatLegDuration(ready.totalDurationSec)}${eta ? ` · arrives ${eta}` : ""}`
                : ""}
            </div>
            <div
              className="truncate"
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 24,
                lineHeight: "30px",
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {legLabel ?? "Directions"}
            </div>
            {offRoute && (
              <div
                className="uppercase"
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  color: "var(--amber-dark)",
                  marginTop: 6,
                }}
              >
                Off route · {current!.offRouteMi.toFixed(1)} mi
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={closePanel}
            aria-label="Close directions"
            className="shrink-0 flex items-center justify-center w-[60px] h-[60px] rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.3)", color: "var(--text-primary)" }}
          >
            <X className="w-7 h-7" strokeWidth={1.75} />
          </button>
        </header>

        {status.kind === "loading" && (
          <div className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>
            Loading directions…
          </div>
        )}
        {status.kind === "error" && (
          <div className="p-5 text-sm" style={{ color: "var(--amber-dark)" }}>
            Couldn&apos;t load directions: {status.message}
          </div>
        )}

        {ready && activeStep && (
          <>
            {/* Active maneuver card */}
            <button
              type="button"
              onClick={() => onStepClick(activeStep.coords[0])}
              className="shrink-0 flex items-center gap-4 text-left"
              style={{
                padding: "16px 20px",
                backgroundColor: "rgba(200,169,110,0.10)",
                borderTop: "1px solid rgba(200,169,110,0.30)",
                borderBottom: "1px solid rgba(200,169,110,0.30)",
                borderLeft: "3px solid var(--amber)",
              }}
            >
              <div
                className="shrink-0 flex items-center justify-center rounded-md"
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: "var(--amber-dark)",
                }}
              >
                <StepIcon
                  step={activeStep}
                  className="w-8 h-8 text-white"
                  strokeWidth={2}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--ff-mono)",
                    fontSize: 12,
                    letterSpacing: "0.12em",
                    color: "var(--amber)",
                  }}
                >
                  In {formatStepDistance(activeStep.distanceMeters)}
                </div>
                <div
                  style={{
                    fontFamily: "var(--ff-sans)",
                    fontSize: 19,
                    lineHeight: "24px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginTop: 2,
                  }}
                >
                  {activeStep.instruction}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  style={{
                    fontFamily: "var(--ff-display)",
                    fontSize: 22,
                    lineHeight: "24px",
                    fontWeight: 600,
                    color: "var(--amber)",
                  }}
                >
                  {formatTurnTime(activeStep.durationSec)}
                </div>
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--ff-mono)",
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    color: "var(--text-muted)",
                  }}
                >
                  to turn
                </div>
              </div>
            </button>

            {/* UP NEXT label */}
            <div
              className="shrink-0 uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                letterSpacing: "0.16em",
                color: "var(--text-muted)",
                padding: "16px 20px 8px",
              }}
            >
              Up next
            </div>

            {/* UP NEXT list */}
            <div ref={listRef} className="flex-1 overflow-y-auto no-scrollbar">
              {upNext.map(({ step, idx, cumMeters }) => {
                const isArrive = idx === lastIdx && step.type === "arrive";
                return (
                  <button
                    ref={(el) => {
                      rowRefs.current[idx] = el;
                    }}
                    key={idx}
                    type="button"
                    onClick={() => onStepClick(step.coords[0])}
                    className="w-full flex items-start gap-3.5 text-left transition-colors hover:bg-white/[0.03]"
                    style={{
                      padding: "13px 20px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      className="shrink-0 flex items-center justify-center"
                      style={{ width: 28, height: 28, marginTop: 1 }}
                    >
                      <StepIcon
                        step={step}
                        className="w-5 h-5"
                        strokeWidth={1.75}
                        style={{
                          color: isArrive ? "var(--amber)" : "var(--text-muted)",
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="uppercase"
                        style={{
                          fontFamily: "var(--ff-mono)",
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          color: "var(--text-muted)",
                        }}
                      >
                        {isArrive
                          ? `In ${formatStepDistance(cumMeters)}${dayNumber != null ? ` · Day ${dayNumber} end` : ""}`
                          : `In ${formatStepDistance(cumMeters)}`}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--ff-sans)",
                          fontSize: 14,
                          lineHeight: "19px",
                          color: "var(--text-primary)",
                          marginTop: 2,
                        }}
                      >
                        {isArrive && dest
                          ? `Arrive at ${dest}`
                          : step.instruction}
                      </div>
                    </div>
                    <div
                      className="shrink-0 uppercase"
                      style={{
                        fontFamily: "var(--ff-mono)",
                        fontSize: 11,
                        letterSpacing: "0.06em",
                        color: isArrive ? "var(--amber)" : "var(--text-muted)",
                        marginTop: 1,
                      }}
                    >
                      {isArrive && eta
                        ? eta
                        : formatStepDistance(step.distanceMeters)}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
