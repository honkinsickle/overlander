import { CalendarClock } from "lucide-react";
import {
  daysUntil,
  loadFixedEvents,
  urgencyFor,
  type Urgency,
} from "@/lib/events/parse-fixed-events";

const URGENCY_STYLES: Record<
  Urgency,
  { dot: string; text: string; border: string; bg: string; label: string }
> = {
  red: {
    dot: "#FA6B6B",
    text: "#FA6B6B",
    border: "rgba(250,107,107,0.45)",
    bg: "rgba(250,107,107,0.08)",
    label: "URGENT",
  },
  yellow: {
    dot: "#F6C744",
    text: "#F6C744",
    border: "rgba(246,199,68,0.45)",
    bg: "rgba(246,199,68,0.08)",
    label: "SOON",
  },
  green: {
    dot: "#7DD18E",
    text: "#7DD18E",
    border: "rgba(125,209,142,0.40)",
    bg: "rgba(125,209,142,0.06)",
    label: "ON TRACK",
  },
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * Reads §03 of `planning/reference/alaska-v3.md` server-side, filters to
 * the next 3 fixed events from today, and renders them with countdown
 * pills color-coded by urgency (red <7d, yellow <30d, green otherwise).
 *
 * Server component — file read happens on each render, so editing the
 * markdown surfaces immediately in dev.
 */
export async function UpcomingEventsCard() {
  const events = await loadFixedEvents();
  const today = new Date();
  const upcoming = events
    .map((e) => ({ ...e, days: daysUntil(e.date, today) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  return (
    <div
      className="absolute top-6 left-6 right-6 max-w-[420px] rounded-md p-4 shadow-2xl"
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock
          className="w-4 h-4 text-amber"
          strokeWidth={1.75}
        />
        <span
          className="font-mono uppercase"
          style={{
            fontSize: "10px",
            letterSpacing: "2px",
            color: "var(--text-muted)",
          }}
        >
          Upcoming Events
        </span>
      </div>

      {upcoming.length === 0 ? (
        <p
          className="font-sans text-text-muted"
          style={{ fontSize: 12, lineHeight: "18px" }}
        >
          No upcoming fixed events.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {upcoming.map((e) => {
            const style = URGENCY_STYLES[urgencyFor(e.days)];
            const dateLabel = DATE_FMT.format(new Date(`${e.date}T00:00:00`));
            return (
              <li
                key={`${e.date}-${e.location}`}
                className="flex items-start gap-3 rounded-md p-3"
                style={{
                  backgroundColor: style.bg,
                  border: `1px solid ${style.border}`,
                }}
              >
                <div
                  className="flex flex-col items-center justify-center shrink-0 rounded-md"
                  style={{
                    width: 56,
                    paddingBlock: 6,
                    backgroundColor: "rgba(0,0,0,0.25)",
                    border: `1px solid ${style.border}`,
                  }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 18,
                      lineHeight: "22px",
                      fontWeight: 700,
                      color: style.text,
                    }}
                  >
                    {e.days}
                  </span>
                  <span
                    className="font-mono uppercase"
                    style={{
                      fontSize: 9,
                      lineHeight: "12px",
                      letterSpacing: "1.5px",
                      color: style.text,
                      opacity: 0.8,
                    }}
                  >
                    {e.days === 1 ? "DAY" : "DAYS"}
                  </span>
                </div>

                <div className="flex flex-col flex-1 min-w-0 gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-sans truncate"
                      style={{
                        fontSize: 14,
                        lineHeight: "18px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {e.location}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full"
                      style={{
                        width: 6,
                        height: 6,
                        backgroundColor: style.dot,
                      }}
                    />
                    <span
                      className="font-mono uppercase"
                      style={{
                        fontSize: 10,
                        letterSpacing: "1.5px",
                        color: style.text,
                      }}
                    >
                      {style.label}
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      · {dateLabel}
                    </span>
                  </div>
                  <p
                    className="font-sans line-clamp-2"
                    style={{
                      fontSize: 12,
                      lineHeight: "17px",
                      color: "var(--text-muted)",
                    }}
                  >
                    {e.notes}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
