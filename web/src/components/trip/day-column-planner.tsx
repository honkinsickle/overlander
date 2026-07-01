"use client";

import { Settings } from "lucide-react";
import type { Day } from "@/lib/trips/types";
import { cn } from "@/lib/utils";

/**
 * Day Column Planner — visual port of Paper "Trip Running — aligned"
 * (rail `A7M-0` → Planner subtree). Reproduces the board's literal
 * geometry (183w column, 25px section headers, 112px day cards).
 *
 * Static / presentational only. Nav toggles and day-card selection are
 * stubbed no-ops — navigation, links, and the itinerary/add-to-day data
 * flow are wired in a separate pass.
 *
 * Structure (top → bottom):
 *   - Overview · Guides · Places to Visit · Trip Settings nav headers
 *   - Itinerary header (green/amber, mirrors Overview)
 *   - Day stack: a gutter timeline (d0N code + connector) beside each card
 */

// TODO: wire — interactions are intentionally inert until the linking pass.
const noop = () => {};

export function DayColumnPlanner({
  tripId,
  days,
  overlay = false,
}: {
  tripId: string;
  days: Day[];
  /** When true, the column omits its own opaque background + right border —
   *  the slideup caller wraps it in a translucent overlay. Default false for
   *  the legacy /trip/[id] page which provides no wrapper. */
  overlay?: boolean;
}) {
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
      {/* Nav — Overview is the primary/active section (green + amber). */}
      <NavHeader label="Overview" tone="active" height={55} fontSize={25} />
      <NavHeader label="Guides" tone="idle" height={50} fontSize={20} />
      <NavHeader label="Places to Visit" tone="idle" height={50} fontSize={20} />
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

      {/* Day stack — gutter timeline + cards. First day renders selected. */}
      <nav
        aria-label="Days"
        className="relative flex flex-col flex-1 overflow-y-auto no-scrollbar"
        style={{ backgroundColor: "var(--bg-panel)", paddingTop: 3 }}
      >
        {days.map((day, i) => (
          <DayCard key={day.id} day={day} active={i === 0} />
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
}: {
  label: string;
  tone: "active" | "idle";
  height: number;
  fontSize: number;
}) {
  const active = tone === "active";
  return (
    <button
      type="button"
      onClick={noop}
      className="flex items-center justify-between shrink-0 border-b border-border-subtle"
      style={{
        height,
        padding: "10px 16px 10px 20px",
        backgroundColor: active ? "var(--bg-day-active)" : "var(--bg-card)",
      }}
    >
      <span
        className="font-sans"
        style={{
          fontSize,
          lineHeight: "33px",
          color: active ? "var(--amber-light)" : "var(--text-primary)",
        }}
      >
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
function DayCard({ day, active }: { day: Day; active: boolean }) {
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
    <div className="flex shrink-0" style={{ height: 112 }}>
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
        onClick={noop}
        data-day-id={day.id}
        className="flex flex-col justify-between text-left shrink-0"
        style={
          active
            ? {
                width: 140,
                height: 112,
                gap: 3,
                padding: "10px 16px 10px 14px",
                borderRadius: 4,
                backgroundColor: "var(--bg-day-selected)",
                borderBottom: "0.5px solid var(--border-day-selected)",
              }
            : {
                flex: "1 1 auto",
                height: 112,
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
          {day.label.replace(/\s*—\s*/g, " —\n")}
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
