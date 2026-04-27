"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Day } from "@/lib/trips/types";
import { cn } from "@/lib/utils";

/**
 * Day Column Planner — Paper `GTM-0` (code-aligned).
 *
 * 215w column with two collapsible sections:
 *   - Overview (Explore · Places to visit)
 *   - Itinerary (stack of Day Cards)
 *
 * The Itinerary day list is the same Day Card shape as the original
 * `DaySidebar` (Paper AH0-0): active selection drives `?day=` via
 * `history.replaceState` + a `trip:activeDay` custom event, so no
 * Next router round-trip (see DayDetail / WaypointCard notes).
 */
export function DayColumnPlanner({
  tripId,
  days,
}: {
  tripId: string;
  days: Day[];
}) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const [spyActiveId, setSpyActiveId] = useState<string | null>(null);
  const activeId =
    spyActiveId && days.some((d) => d.id === spyActiveId)
      ? spyActiveId
      : queried && days.some((d) => d.id === queried)
        ? queried
        : days[0]?.id;

  useEffect(() => {
    const onSpy = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setSpyActiveId(id);
    };
    window.addEventListener("trip:activeDay", onSpy);
    return () => window.removeEventListener("trip:activeDay", onSpy);
  }, []);

  useEffect(() => {
    setSpyActiveId(null);
  }, [queried]);

  const [overviewOpen, setOverviewOpen] = useState(true);
  const [itineraryOpen, setItineraryOpen] = useState(true);

  // Collapse Overview automatically when the user clicks into Itinerary
  // (picks a day). Re-expand when they return to Explore (spy cleared).
  useEffect(() => {
    setOverviewOpen(!(spyActiveId || queried));
  }, [spyActiveId, queried]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitial = useRef(false);
  const [spacerHeight, setSpacerHeight] = useState(0);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const compute = () => {
      const cards = root.querySelectorAll<HTMLElement>("a[data-day-id]");
      const last = cards[cards.length - 1];
      if (!last) return;
      const spacerNode = root.lastElementChild as HTMLElement | null;
      const currentSpacer =
        spacerNode && spacerNode !== last ? spacerNode.offsetHeight : 0;
      const contentH = root.scrollHeight - currentSpacer;
      const needed = Math.max(
        0,
        last.offsetTop + root.clientHeight - contentH,
      );
      setSpacerHeight((prev) => (prev === needed ? prev : needed));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(root);
    return () => ro.disconnect();
  }, [days, itineraryOpen]);

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `a[data-day-id="${activeId}"]`,
    );
    if (!el) return;
    scrollRef.current.scrollTop = el.offsetTop;
    didInitial.current = true;
  }, [activeId, spacerHeight]);

  return (
    <aside
      aria-label="Days"
      className="relative z-20 flex flex-col w-[215px] h-full overflow-hidden bg-bg-base border-r border-border-subtle"
      style={{
        backgroundColor: "#0C0D0F",
        boxShadow: "8px 0 24px rgba(0,0,0,0.45)",
      }}
    >
      {/* Overview (collapsible) — Paper GTN-0/GTT-0. Label is amber-light
       *  while the user is in Overview; drops to muted once they click
       *  out into the Itinerary / a day card. */}
      <SectionHeader
        label="Overview"
        open={overviewOpen}
        onToggle={() => setOverviewOpen((v) => !v)}
        tone={spyActiveId || queried ? "muted" : "active"}
      />
      {overviewOpen && (
        <div className="flex flex-col bg-bg-card border-b border-border-subtle shrink-0 pr-4">
          <OverviewRow
            label="Explore"
            active={!spyActiveId && !queried}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("trip:scrollTo", {
                  detail: { anchor: "top" },
                }),
              );
              setSpyActiveId(null);
            }}
          />
          <OverviewRow label="Places to visit" />
        </div>
      )}

      {/* Itinerary (collapsible) — Paper GUH-0 + day cards GTZ-0..
       *  Label brightens to `engaged` (#B9B7B7) once the user selects a
       *  day; still `muted` by default. */}
      <SectionHeader
        label="Itinerary"
        open={itineraryOpen}
        onToggle={() => setItineraryOpen((v) => !v)}
        tone={spyActiveId || queried ? "engaged" : "muted"}
      />
      {itineraryOpen && (
        <nav
          ref={scrollRef}
          aria-label="Days"
          className="relative flex flex-col flex-1 overflow-y-auto bg-bg-panel"
        >
          {days.map((day) => (
            <DayCard
              key={day.id}
              tripId={tripId}
              day={day}
              isActive={Boolean(
                (spyActiveId || queried) && day.id === activeId,
              )}
            />
          ))}
          <div
            className="shrink-0"
            style={{ height: spacerHeight }}
            aria-hidden
          />
        </nav>
      )}
    </aside>
  );
}

/** Paper GTN-0 / GUH-0 — 215×55 sticky section header with a label and
 *  a 36×36 toggle affordance. Label colour distinguishes states. */
function SectionHeader({
  label,
  open,
  onToggle,
  tone,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  tone: "active" | "engaged" | "muted";
}) {
  const color =
    tone === "active"
      ? "var(--amber-light)"
      : tone === "engaged"
        ? "#B9B7B7"
        : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center justify-between w-full h-[55px] py-2.5 pl-5 pr-4 shrink-0 border-b border-border-subtle"
      style={{ backgroundColor: "#0D0E0F" }}
    >
      <span
        className="font-sans font-normal"
        style={{ fontSize: 30, lineHeight: "33px", color }}
      >
        {label}
      </span>
      <Chevron open={open} tone={tone} />
    </button>
  );
}

/** Toggle affordance — Paper GUM-0 (filled, active) / GUS-0 (outlined).
 *  Rotates 0↔180 on open to feel like a disclosure caret. */
function Chevron({
  open,
  tone,
}: {
  open: boolean;
  tone: "active" | "engaged" | "muted";
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <span
      aria-hidden
      className={cn(
        "flex items-center justify-center w-9 h-9 rounded",
        tone === "active"
          ? "bg-white/10"
          : "border border-[rgba(167,204,253,0.12)]",
      )}
    >
      <Icon
        className="w-4 h-4"
        strokeWidth={1.75}
        style={{ color: "var(--text-muted)" }}
      />
    </span>
  );
}

/** Paper GUV-0 / GUW-0 — 215×50 row, 20px inline padding. Active row
 *  uses `--bg-day-active` green + `--amber-dark` bottom border + amber
 *  label; inactive rows are muted. */
function OverviewRow({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center w-full h-[50px] pl-5 pr-0 text-left",
        active && "bg-bg-day-active border-b border-amber-dark",
      )}
    >
      <span
        className="font-sans"
        style={{
          fontSize: 21,
          lineHeight: "41px",
          color: active ? "var(--amber-light)" : "var(--text-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </button>
  );
}

/** Day Card — Paper AH0-0 geometry (same as DaySidebar). Emits a
 *  `trip:activeDay` event on click instead of going through Next's
 *  router to avoid re-triggering the slideup intercept. */
function DayCard({
  tripId,
  day,
  isActive,
}: {
  tripId: string;
  day: Day;
  isActive: boolean;
}) {
  const weekday = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
  });
  const monthDay = new Date(`${day.date}T00:00:00`).toLocaleDateString(
    "en-US",
    { month: "numeric", day: "numeric" },
  );

  const select = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("day", day.id);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(
      new CustomEvent("trip:activeDay", {
        detail: { id: day.id, source: "sidebar" },
      }),
    );
  };

  return (
    <button
      type="button"
      onClick={select}
      aria-current={isActive ? "page" : undefined}
      data-day-id={day.id}
      data-trip-id={tripId}
      className={cn(
        "group flex flex-col justify-between text-left w-full h-[112px] pt-2.5 pr-4 pb-2.5 pl-5 border-b",
        isActive
          ? "bg-bg-day-active border-b-2 border-amber-dark"
          : "bg-bg-card border-border-subtle hover:border-border-mid",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-sans text-[14px] leading-[14px]",
            isActive
              ? "text-text-primary"
              : "text-text-muted group-hover:text-text-primary",
          )}
        >
          {day.miles !== undefined && day.driveHours !== undefined
            ? `${day.miles} mi | ${day.driveHours} hrs`
            : "\u00A0"}
        </span>
        <span
          className={cn(
            "font-sans text-[13px] leading-4",
            isActive
              ? "text-text-primary"
              : "text-text-muted group-hover:text-text-primary",
          )}
        >
          Day {String(day.dayNumber).padStart(2, "0")}
        </span>
      </div>

      <div
        className={cn(
          "font-sans text-[30px] leading-[33px]",
          isActive
            ? "text-amber-light"
            : "text-text-muted group-hover:text-text-primary",
        )}
      >
        {weekday} {monthDay}
      </div>

      <div
        className={cn(
          "font-sans text-[13px] leading-[18px] whitespace-pre-line",
          isActive
            ? "text-text-primary"
            : "text-text-muted group-hover:text-text-primary",
        )}
      >
        {day.label.replace(/\s*—\s*/g, " —\n")}
      </div>
    </button>
  );
}
