"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { DayHeader } from "@/components/trip/day-header";
import { DayDetailHero } from "@/components/trip/day-detail-hero";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const activeId =
    queried && trip.days.some((d) => d.id === queried)
      ? queried
      : trip.days[0]?.id;
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // While a programmatic smooth scroll is in flight, the scroll-spy must
  // NOT rewrite ?day= mid-flight — otherwise the active-id flips through
  // every intermediate section, and the scroll effect re-targets each,
  // which cancels the smooth scroll and produces the "stops at each day"
  // feel the user reported.
  const programmaticScrollRef = useRef(false);

  // Sidebar click / deep link → scroll active day into view. Skip when
  // the section is already in its "active" band near the top (that's
  // where the scroll-spy lives, so it would be a redundant 0–100px jump).
  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const container = scrollRef.current;
    const el = container.querySelector<HTMLElement>(
      `#day-${CSS.escape(activeId)}`,
    );
    if (!el) return;
    const offset = el.offsetTop - container.scrollTop;
    if (offset >= 0 && offset <= SCROLL_TRIGGER) return;
    const smooth = didInitialScroll.current;
    if (smooth) {
      programmaticScrollRef.current = true;
    }
    el.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
    didInitialScroll.current = true;
    if (!smooth) return;
    // Browser smooth scroll duration isn't exposed — clear a little after
    // the typical 300–500ms so scroll-spy picks back up for manual scroll.
    const tid = setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 600);
    return () => clearTimeout(tid);
  }, [activeId]);

  // Scroll-spy: as the user scrolls, update ?day= so the sidebar
  // highlight follows. Trigger sits just below the 80px sticky header.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let lastId: string | null = null;
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
      if (!currentId || currentId === lastId) return;
      lastId = currentId;
      router.replace(`/trip/${trip.id}?day=${currentId}`, { scroll: false });
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [trip.id, trip.days, router]);

  const totalStops = trip.days.reduce((n, d) => n + d.waypoints.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {trip.days.map((day) => (
          <DaySection key={day.id} trip={trip} day={day} />
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

function DaySection({ trip, day }: { trip: Trip; day: Day }) {
  // `last:min-h-full` guarantees the final day can scroll to the top of
  // the viewport even if its content is shorter than the scroll container.
  return (
    <section id={`day-${day.id}`} className="scroll-mt-0 last:min-h-full">
      {/* ── Day Detail Card (GDH-0) ─────────────────────────── */}
      <article className="flex flex-col items-stretch bg-bg-card">
        <div className="sticky top-0 z-10">
          <DayHeader tripId={trip.id} day={day} />
        </div>

        {/* Hero wrapper (GDL-0) */}
        <div className="flex justify-center pt-[14px]">
          <DayDetailHero day={day} />
        </div>

        {/* WAY POINTS label (GDQ-0) — pure white, 6px letter-spacing */}
        <div
          className="h-[50px] pt-[17px] pr-[18px] pb-[10px] pl-[18px] uppercase"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: "13px",
            lineHeight: "16px",
            letterSpacing: "6px",
            color: "#FFFFFF",
          }}
        >
          WAY POINTS
        </div>

        {/* Waypoints list (GDR-0) — flex-col with 10px inline padding,
         *  no frame of its own (rows carry their own top borders). */}
        <div className="flex flex-col px-[10px]">
          {day.waypoints.map((wp) => (
            <WaypointCard key={wp.id} tripId={trip.id} waypoint={wp} />
          ))}
        </div>
      </article>
      {/* ── End Day Detail Card ─────────────────────────────── */}
    </section>
  );
}
