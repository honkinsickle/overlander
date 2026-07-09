"use client";

import { Settings } from "lucide-react";
import type { Day } from "@/lib/trips/types";
import { cn } from "@/lib/utils";

/**
 * Day Column Planner — visual port of Paper "Trip Running — aligned"
 * (rail `A7M-0` → Planner subtree). Reproduces the board's literal
 * geometry (25px section headers, 112px day cards).
 *
 * Selection wiring (Phase 1 of the corridor integration): when the
 * caller passes `activeDayId` + `onSelectDay` / `onSelectOverview`, the
 * rail is the slideup's day-SELECTOR — clicking a day shows that day's
 * corridor view; clicking Overview shows the trip-level state
 * (activeDayId === null). Without those props (legacy /trip/[id]) the
 * rail stays presentational: first day active, clicks inert.
 *
 * Guides / Places to Visit / Trip Settings remain stubbed no-ops.
 *
 * Structure (top → bottom):
 *   - Overview · Guides · Places to Visit · Trip Settings nav headers
 *   - Itinerary header (green/amber, mirrors Overview)
 *   - Day stack: a gutter timeline (d0N code + connector) beside each card
 */

// TODO: wire — Guides / Places to Visit / Trip Settings still inert.
const noop = () => {};

export function DayColumnPlanner({
  tripId,
  days,
  overlay = false,
  activeDayId,
  onSelectDay,
  onSelectOverview,
  onScrollTo,
  activeSection,
}: {
  tripId: string;
  days: Day[];
  /** When true, the column omits its own opaque background + right border —
   *  the slideup caller wraps it in a translucent overlay. Default false for
   *  the legacy /trip/[id] page which provides no wrapper. */
  overlay?: boolean;
  /** Selected day id, or null for the Overview state. Omit entirely
   *  (undefined) for the legacy presentational rendering. */
  activeDayId?: string | null;
  onSelectDay?: (dayId: string) => void;
  onSelectOverview?: () => void;
  /** Switch to Overview and scroll its column to the named section
   *  (#overview / #guides / #places). Wired to all three nav items —
   *  Overview scrolls back to the hero/top. */
  onScrollTo?: (anchor: "overview" | "guides" | "places") => void;
  /** Scroll-spy: the topmost visible Overview section, or null when a day
   *  is selected (the day card highlights instead). Drives which of
   *  Overview / Guides / Places to Visit highlights. */
  activeSection?: "overview" | "guides" | "places" | null;
}) {
  const wired = activeDayId !== undefined;
  // Which nav item highlights: legacy (unwired) always "overview"; a
  // selected day → null (day card wins); Overview → the scroll-spy
  // section (default "overview" until the observer reports).
  const navSection = !wired
    ? "overview"
    : activeDayId === null
      ? (activeSection ?? "overview")
      : null;
  return (
    <aside
      aria-label="Days"
      data-trip-id={tripId}
      className={cn(
        "relative z-20 flex flex-col h-full overflow-hidden",
        overlay ? "w-full" : "w-[183px] border-r border-border-subtle",
      )}
      style={overlay ? undefined : { backgroundColor: "var(--bg-base)" }}
    >
      {/* Nav — Overview is active when no day is selected (or always, in
       *  the legacy presentational rendering). */}
      <NavHeader
        label="Overview"
        tone={navSection === "overview" ? "active" : "idle"}
        height={55}
        fontSize={25}
        onClick={onScrollTo ? () => onScrollTo("overview") : onSelectOverview}
      />
      <NavHeader
        label="Guides"
        tone={navSection === "guides" ? "active" : "idle"}
        activeColor="blue"
        height={50}
        fontSize={20}
        onClick={onScrollTo ? () => onScrollTo("guides") : undefined}
      />
      <NavHeader
        label="Places to Visit"
        tone={navSection === "places" ? "active" : "idle"}
        activeColor="blue"
        height={50}
        fontSize={20}
        onClick={onScrollTo ? () => onScrollTo("places") : undefined}
      />
      <SettingsHeader label="Trip Settings" />

      {/* Itinerary header — same green/amber treatment as Overview, no toggle. */}
      <div
        className="flex items-center justify-between shrink-0 border-b border-border-subtle"
        style={{
          height: 55,
          padding: "10px 16px 10px 17px",
          backgroundColor: "var(--bg-day-active)",
        }}
      >
        <span
          className="font-sans"
          style={{
            fontSize: 25,
            lineHeight: "33px",
            color: "var(--amber-light)",
          }}
        >
          Itinerary
        </span>
      </div>

      {/* Day stack — gutter timeline + cards. Wired: the selected day
       *  renders active. Legacy: first day renders selected. */}
      <nav
        aria-label="Days"
        className="relative flex flex-col flex-1 overflow-y-auto no-scrollbar"
        style={{ backgroundColor: "var(--bg-panel)", paddingTop: 3 }}
      >
        {days.map((day, i) => (
          <DayCard
            key={day.id}
            day={day}
            active={wired ? activeDayId === day.id : i === 0}
            onClick={onSelectDay ? () => onSelectDay(day.id) : undefined}
          />
        ))}
      </nav>
    </aside>
  );
}

/** Top-level nav header. `active` gets the green surface + amber label
 *  (Overview); `idle` is the dark card surface + primary-ink label. */
function NavHeader({
  label,
  tone,
  height,
  fontSize,
  onClick,
  activeColor = "green",
}: {
  label: string;
  tone: "active" | "idle";
  height: number;
  fontSize: number;
  onClick?: () => void;
  /** Active-state treatment. "green" = Overview's amber-on-green header;
   *  "blue" = the day-selected blue (Guides / Places to Visit, so the
   *  section indicator matches the day highlight). */
  activeColor?: "green" | "blue";
}) {
  const active = tone === "active";
  const bg = !active
    ? "var(--bg-card)"
    : activeColor === "blue"
      ? "var(--bg-day-selected)"
      : "var(--bg-day-active)";
  const color = !active
    ? "var(--text-primary)"
    : activeColor === "blue"
      ? "var(--text-primary)"
      : "var(--amber-light)";
  return (
    <button
      type="button"
      onClick={onClick ?? noop}
      className="flex items-center justify-between shrink-0 border-b border-border-subtle"
      style={{
        height,
        padding: "10px 16px 10px 20px",
        backgroundColor: bg,
      }}
    >
      <span className="font-sans" style={{ fontSize, lineHeight: "33px", color }}>
        {label}
      </span>
    </button>
  );
}

/** Trip Settings — gear icon + smaller label, left-packed (per the board). */
function SettingsHeader({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={noop}
      className="flex items-center shrink-0 border-b border-border-subtle"
      style={{
        height: 50,
        gap: 5,
        padding: "10px 16px 10px 20px",
        backgroundColor: "var(--bg-card)",
      }}
    >
      <Settings
        size={18}
        strokeWidth={1.75}
        className="shrink-0"
        style={{ color: "var(--text-primary)" }}
      />
      <span
        className="font-sans"
        style={{ fontSize: 14, lineHeight: "33px", color: "var(--text-primary)" }}
      >
        {label}
      </span>
    </button>
  );
}

/** Day card + its gutter timeline segment. The selected card is an inset,
 *  rounded steel surface; unselected cards fill to the right edge. */
function DayCard({
  day,
  active,
  onClick,
}: {
  day: Day;
  active: boolean;
  onClick?: () => void;
}) {
  const at = new Date(`${day.date}T00:00:00`);
  const weekday = at
    .toLocaleDateString("en-US", { weekday: "short" })
    .slice(0, 2);
  const monthDay = at.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
  const meta =
    day.miles !== undefined && day.driveHours !== undefined
      ? `${day.miles}mi ~ ${day.driveHours}hrs`
      : " ";
  const dcode = `d${String(day.dayNumber).padStart(2, "0")}`;
  const subColor = active ? "var(--type-300)" : "var(--text-muted)";

  return (
    <div className="flex shrink-0" style={{ minHeight: 112 }}>
      {/* Gutter — day code + connector timeline. */}
      <div className="relative shrink-0" style={{ width: 40 }}>
        <span
          className="font-sans absolute"
          style={{
            top: 10,
            left: 4,
            fontSize: 18,
            lineHeight: "16px",
            color: active ? "var(--timeline-active)" : "var(--text-muted)",
          }}
        >
          {dcode}
        </span>
        <Connector active={active} />
      </div>

      {/* Card body. */}
      <button
        type="button"
        onClick={onClick ?? noop}
        data-day-id={day.id}
        className="flex flex-col justify-between text-left shrink-0"
        style={
          active
            ? {
                width: 140,
                minHeight: 112,
                gap: 3,
                padding: "10px 16px 10px 14px",
                borderRadius: 4,
                backgroundColor: "var(--bg-day-selected)",
                borderBottom: "0.5px solid var(--border-day-selected)",
              }
            : {
                flex: "1 1 auto",
                minHeight: 112,
                padding: "10px 16px 10px 14px",
                backgroundColor: "var(--bg-card)",
                borderBottom: "1px solid var(--border-subtle)",
              }
        }
      >
        <span
          className="font-mono"
          style={{
            fontSize: 14,
            lineHeight: "14px",
            letterSpacing: "-0.05em",
            color: subColor,
          }}
        >
          {meta}
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 25,
            lineHeight: active ? "27px" : "33px",
            color: "var(--text-primary)",
          }}
        >
          {weekday} {monthDay}
        </span>
        <span
          className="font-sans whitespace-pre-line"
          style={{ fontSize: 13, lineHeight: "18px", color: subColor }}
        >
          {day.label.replace(/\s*—\s*/g, "\n— ")}
        </span>
      </button>
    </div>
  );
}

/** Vertical connector for the gutter timeline — a start dot plus a line
 *  running down the card. White on the active day, warm-grey otherwise. */
function Connector({ active }: { active: boolean }) {
  const color = active ? "var(--timeline-active)" : "var(--timeline-inactive)";
  return (
    <div className="absolute" style={{ left: 10, top: 32, bottom: 4, width: 4 }}>
      <div
        className="absolute"
        style={{
          top: 0,
          left: 0,
          width: 4,
          height: 4,
          borderRadius: 100,
          backgroundColor: color,
        }}
      />
      <div
        className="absolute"
        style={{ top: 2, left: 1.5, bottom: 0, width: 1, backgroundColor: color }}
      />
    </div>
  );
}
