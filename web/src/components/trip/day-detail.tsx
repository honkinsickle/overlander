"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { DayHeader } from "@/components/trip/day-header";
import { DayDetailHero } from "@/components/trip/day-detail-hero";
import { SuggestedSection } from "@/components/trip/suggested-section";
import { TripDetailHeader } from "@/components/trip/trip-detail-header";
import { WaypointCard } from "@/components/trip/waypoint-card";
import type { Trip, Day } from "@/lib/trips/types";

const SCROLL_TRIGGER = 100;

/**
 * Centre-column Day Detail — stacks all days into one long scroll.
 *
 * Each day renders the Paper GDB-0 / GDH-0 card with its four zones:
 *   1. Day Section Header  GDI-0 (440×80)
 *   2. Day Detail Hero wrapper GDL-0 → Hero GDM-0 (404×175)
 *   3. WAY POINTS label GDQ-0
 *   4. Waypoints list GDR-0 · rows GDS-0
 *
 * Each day section is anchored (`id="day-<dayId>"`). The DaySidebar emits
 * `?day=<id>` links and this component scrolls the matching section into
 * view when the param changes. The initial scroll is instant; subsequent
 * changes use smooth scrolling.
 */
export function DayDetail({ trip }: { trip: Trip }) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // While a programmatic smooth scroll is in flight, the scroll-spy must
  // NOT rewrite ?day= mid-flight — otherwise the active-id flips through
  // every intermediate section, and the scroll effect re-targets each,
  // which cancels the smooth scroll and produces the "stops at each day"
  // feel the user reported.
  const programmaticScrollRef = useRef(false);

  // Scroll the centre to a requested day — fired once on mount if
  // `?day=` is in the URL (deep link), and on every sidebar click via
  // the `trip:activeDay` custom event (emitted with source: "sidebar").
  const scrollToDay = (id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `#day-${CSS.escape(id)}`,
    );
    if (!el) return;
    const offset = el.offsetTop - container.scrollTop;
    if (offset >= 0 && offset <= SCROLL_TRIGGER) return;
    const smooth = didInitialScroll.current;
    if (smooth) programmaticScrollRef.current = true;
    el.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
    didInitialScroll.current = true;
    if (!smooth) return;
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 600);
  };

  // Deep-link scroll on mount.
  useEffect(() => {
    if (queried) scrollToDay(queried);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar click → scroll via the trip:activeDay event.
  useEffect(() => {
    const onSidebar = (e: Event) => {
      const detail = (
        e as CustomEvent<{ id: string; source?: string }>
      ).detail;
      if (!detail?.id || detail.source !== "sidebar") return;
      scrollToDay(detail.id);
    };
    window.addEventListener("trip:activeDay", onSidebar);
    return () => window.removeEventListener("trip:activeDay", onSidebar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Overview row click → scroll to the anchor (e.g. top of the scroll
  // container for the TripDetailHeader / EXPLORE section).
  useEffect(() => {
    const onScrollTo = (e: Event) => {
      const anchor = (e as CustomEvent<{ anchor: string }>).detail?.anchor;
      const container = scrollRef.current;
      if (!container) return;
      if (anchor === "top") {
        programmaticScrollRef.current = true;
        container.scrollTo({ top: 0, behavior: "smooth" });
        // clear ?day= since the scroll-spy suppresses during programmatic scroll
        const url = new URL(window.location.href);
        url.searchParams.delete("day");
        window.history.replaceState(null, "", url);
        setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 600);
      }
    };
    window.addEventListener("trip:scrollTo", onScrollTo);
    return () => window.removeEventListener("trip:scrollTo", onScrollTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-spy: update the active day without touching Next's router.
  // `history.replaceState` keeps the URL bar in sync for share/reload,
  // and a custom event lets the sidebar follow the scroll without an
  // RSC refetch (router.replace in this spot previously caused hundreds
  // of chunk requests during scroll).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let lastEmitted: string | null = null;
    let ticking = false;

    const update = () => {
      ticking = false;
      if (programmaticScrollRef.current) return;
      const sections = root.querySelectorAll<HTMLElement>(
        'section[id^="day-"]',
      );
      let currentId: string | null = null;
      for (const s of sections) {
        if (s.offsetTop - root.scrollTop <= SCROLL_TRIGGER) {
          currentId = s.id.replace(/^day-/, "");
        }
      }
      if (!currentId || currentId === lastEmitted) return;
      lastEmitted = currentId;
      const url = new URL(window.location.href);
      url.searchParams.set("day", currentId);
      window.history.replaceState(null, "", url);
      window.dispatchEvent(
        new CustomEvent("trip:activeDay", { detail: { id: currentId } }),
      );
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [trip.id]);

  const totalStops = trip.days.reduce((n, d) => n + d.waypoints.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <TripDetailHeader trip={trip} />
        <div
          className="uppercase bg-bg-card"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 16,
            lineHeight: "24px",
            fontWeight: 600,
            letterSpacing: "0.19em",
            color: "var(--amber-light)",
            paddingInline: 17,
            paddingBlock: 6,
          }}
        >
          Itinerary
        </div>
        {trip.days.map((day, i) => (
          <DaySection
            key={day.id}
            trip={trip}
            day={day}
            extra={i < 2 ? <SuggestedSection dayNumber={i + 1} /> : null}
          />
        ))}
      </div>

      {/* SUPPLEMENTAL (not in GDB-0) — footer */}
      <footer className="h-[65px] flex items-center justify-between px-5 border-t border-border-subtle shrink-0 bg-bg-panel">
        <span className="text-text-muted font-mono text-xs">
          {totalStops} stops
        </span>
        <Link
          href={`/trip/${trip.id}/ask`}
          className="px-4 py-2 rounded text-text-primary bg-button-primary hover:bg-button-primary-hover border border-button-primary-border"
        >
          Open Ask →
        </Link>
      </footer>
    </div>
  );
}

function DaySection({
  trip,
  day,
  hideHeader = false,
  extra,
}: {
  trip: Trip;
  day: Day;
  hideHeader?: boolean;
  extra?: React.ReactNode;
}) {
  // `last:min-h-full` guarantees the final day can scroll to the top of
  // the viewport even if its content is shorter than the scroll container.
  return (
    <section id={`day-${day.id}`} className="scroll-mt-0 last:min-h-full">
      {/* ── Day Detail Card (GDH-0) ─────────────────────────── */}
      <article className="flex flex-col items-stretch bg-bg-card">
        {!hideHeader && (
          <div className="sticky top-0 z-10">
            <DayHeader tripId={trip.id} day={day} />
          </div>
        )}

        {/* Hero wrapper (GDL-0) */}
        <div className="flex justify-center pt-[14px]">
          <DayDetailHero day={day} />
        </div>

        {/* 📍 WAYPOINTS sub-label (N98-0) — Space Mono 13/18, muted,
         *  0.14em tracking. */}
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--ff-mono)",
            fontSize: 13,
            lineHeight: "18px",
            letterSpacing: "0.14em",
            color: "var(--text-muted)",
            paddingInline: 15,
            paddingTop: 16,
            paddingBottom: 10,
          }}
        >
          📍 Waypoints
        </div>

        {/* Waypoints list (GDR-0) — flex-col with 10px inline padding,
         *  no frame of its own (rows carry their own top borders). */}
        <div className="flex flex-col px-[10px]">
          {day.waypoints.map((wp) => (
            <WaypointCard key={wp.id} tripId={trip.id} waypoint={wp} />
          ))}
        </div>

        {/* Add Waypoints button (N8F-0) — full-width muted button,
         *  borders on top + bottom from the waypoint list rhythm. */}
        <div
          className="flex items-stretch justify-center border-b border-border-subtle bg-bg-card"
          style={{
            paddingTop: 34,
            paddingBottom: 14,
            paddingLeft: 10,
            paddingRight: 16,
          }}
        >
          <button
            type="button"
            className="flex items-center justify-center gap-2 rounded-sm border"
            style={{
              height: 36,
              width: "80%",
              transform: "translate(15px, -20%)",
              backgroundColor: "var(--cat-urban-bg)",
              borderColor: "var(--cat-urban)",
            }}
          >
            <span
              style={{
                fontSize: 14,
                lineHeight: "18px",
                fontFamily: "var(--ff-sans)",
                color: "#FFFFFF",
              }}
            >
              Add Waypoints
            </span>
            <ArrowRight
              className="w-3 h-3 shrink-0"
              strokeWidth={1.75}
              color="#FFFFFF"
            />
          </button>
        </div>

        {extra}
      </article>
      {/* ── End Day Detail Card ─────────────────────────────── */}
    </section>
  );
}
