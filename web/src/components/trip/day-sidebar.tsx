"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Day } from "@/lib/trips/types";
import { cn } from "@/lib/utils";

/**
 * Day sidebar — stack of Day Cards (Paper AH0-0).
 *
 * Active day is driven by `?day=<dayId>` search param. If none is set,
 * the first day is implicitly active so deep links without the param
 * still land on something sensible.
 *
 * Day Card layout (per AH0-0):
 *   - Top row: `95 mi | 2.3 hrs` (left) · `Day 01` (right)
 *   - Big date: "Fri 5/29" (Barlow bold)
 *   - Route segment below: "Seattle, WA — Mount Rainier NP"
 *
 * States:
 *   - Default: panel-inherited bg, text-muted meta, text-primary date
 *   - Hover:   bg-card + border-mid (row divider upgraded)
 *   - Active:  bg-day-active (green) + amber-dark bottom rule +
 *              amber-light date + text-primary meta/route
 *
 * Divider between cards: border-subtle by default; replaced by amber-dark
 * on the active card's own bottom rule.
 */
export function DaySidebar({
  tripId,
  days,
}: {
  tripId: string;
  days: Day[];
}) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  // Scroll-spy in DayDetail broadcasts via window events so it doesn't
  // have to round-trip through the router. Local state tracks both the
  // URL value (on navigation) and those broadcasts (on scroll).
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

  // Reset spy tracking when ?day= changes via a real navigation.
  useEffect(() => {
    setSpyActiveId(null);
  }, [queried]);
  const navRef = useRef<HTMLElement>(null);
  const didInitial = useRef(false);
  // Spacer height so the last day card can always scroll to the top:
  // needs to be `nav height − card height` so that scrollTop == last's
  // offsetTop is reachable. Cards are fixed 112; nav height varies with
  // viewport, so we recompute on resize.
  const [spacerHeight, setSpacerHeight] = useState(0);

  // Spacer sizing: we want `max scrollTop >= last.offsetTop` so the last
  // card can pin to the top. That means `scrollHeight >= last.offsetTop +
  // clientHeight`. Derive `needed` by subtracting the current spacer so
  // we measure the real content height (avoids the naive
  // `clientHeight − lastHeight` formula which underestimates when cards
  // have borders/gaps).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const compute = () => {
      const cards = nav.querySelectorAll<HTMLElement>("a[data-day-id]");
      const last = cards[cards.length - 1];
      if (!last) return;
      const spacerNode = nav.lastElementChild as HTMLElement | null;
      const currentSpacer =
        spacerNode && spacerNode !== last ? spacerNode.offsetHeight : 0;
      const contentH = nav.scrollHeight - currentSpacer;
      const needed = Math.max(
        0,
        last.offsetTop + nav.clientHeight - contentH,
      );
      setSpacerHeight((prev) => (prev === needed ? prev : needed));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [days]);

  // Keep the active day pinned at the top of the sidebar scroll. Uses
  // useLayoutEffect + explicit scrollTop assignment (not scrollIntoView,
  // which Chrome caps short when the trailing spacer is empty, and not
  // scrollTo with {behavior: smooth} which got cancelled by the effect
  // re-running on search-param renders).
  useLayoutEffect(() => {
    if (!activeId || !navRef.current) return;
    const el = navRef.current.querySelector<HTMLElement>(
      `a[data-day-id="${activeId}"]`,
    );
    if (!el) return;
    navRef.current.scrollTop = el.offsetTop;
    didInitial.current = true;
  }, [activeId, spacerHeight]);

  return (
    <nav
      ref={navRef}
      aria-label="Days"
      className="relative flex flex-col bg-bg-panel overflow-y-auto h-full"
    >
      {days.map((day) => (
        <DayCard
          key={day.id}
          tripId={tripId}
          day={day}
          isActive={day.id === activeId}
        />
      ))}
      <div
        className="shrink-0"
        style={{ height: spacerHeight }}
        aria-hidden
      />
    </nav>
  );
}

/**
 * Day Card — Paper AH0-0, applied from `get_computed_styles`:
 *   215×112 fixed · justify-between · padding 10/16/10/20 (asymmetric)
 *   Default: bg-card + 1px border-subtle bottom · muted text
 *   Hover:   bg-card + 1px border-mid bottom · text brightens to primary
 *   Active:  bg-day-active + 2px amber-dark bottom · amber-light date
 *
 * Typography:
 *   Meta "95 mi | 2.3 hrs"  Barlow 400 · 14 / 14
 *   "Day 01" label          Barlow 400 · 13 / 16
 *   Big date                Barlow 400 · 30 / 33   (regular, not bold)
 *   Route                   Barlow 400 · 13 / 18   (wraps to 2 lines)
 */
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
  const monthDay = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });

  const selectDay = () => {
    // Avoid Next's router — a soft nav to /trip/:id?day=... re-triggers
    // the @modal intercept on the full page. Keep the URL in sync via
    // history.replaceState and broadcast a `trip:activeDay` event so
    // DayDetail scrolls and other listeners can react.
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
      onClick={selectDay}
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
      {/* Top row — meta + Day label, baseline-aligned */}
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

      {/* Big date — Barlow 400 (regular), 30 / 33 */}
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

      {/* Route — force line break after the em-dash so the segment
       *  reads "City, ST —\nCity, ST" per Paper AH0-0 content. */}
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
