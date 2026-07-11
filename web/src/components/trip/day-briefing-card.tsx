import type { Day } from "@/lib/trips/types";

/**
 * Day-level reasoned fill — the LLM's briefing, weather, overnight, and
 * notes (logistics + obligations) for one day. Rendered both in the legacy
 * full-page `SuggestedSection` and, as the day-level header, in the slideup's
 * `DayDetailCorridor` above the spine + tiles — so a generated day reads as
 * one cohesive corridor day (route + reasoning) on the canonical surface.
 *
 * Style: Space Grotesk (`--ff-display`) section labels, Barlow (`--ff-sans`)
 * body, Space Mono (`--ff-mono`) route stat, amber accents.
 */
export function DayBriefingCard({ day }: { day: Day }) {
  const hasContent =
    day.description || day.weather || (day.notes && day.notes.length > 0);
  if (!hasContent) return null;
  const route = [
    day.miles && `${day.miles} mi`,
    day.driveHours && `${day.driveHours} hrs`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="w-[410px] rounded-[4px] overflow-clip border border-border-subtle"
      style={{ backgroundColor: "#161819BF", padding: 16 }}
    >
      <div className="flex flex-col" style={{ gap: 12 }}>
        <div className="flex flex-col" style={{ gap: 4 }}>
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 11,
              lineHeight: "14px",
              letterSpacing: "0.16em",
              color: "var(--amber-dark)",
            }}
          >
            Day {day.dayNumber} Briefing
          </span>
          <span
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 16,
              lineHeight: "22px",
              fontWeight: 700,
              color: "#FFFFFF",
            }}
          >
            {day.label}
          </span>
          {route && (
            <span
              style={{
                fontFamily: "var(--ff-mono)",
                fontSize: 12,
                lineHeight: "16px",
                color: "var(--amber)",
              }}
            >
              {route}
            </span>
          )}
        </div>

        {day.description && (
          <p
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
              lineHeight: "20px",
              color: "#CFCFCF",
            }}
          >
            {day.description}
          </p>
        )}

        {day.weather && (day.weather.departure || day.weather.arrival) && (
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                letterSpacing: "0.14em",
                color: "#98AC64",
              }}
            >
              Weather
            </span>
            {day.weather.departure && (
              <span
                style={{ fontFamily: "var(--ff-sans)", fontSize: 13, color: "#CFCFCF" }}
              >
                Depart · {day.weather.departure}
              </span>
            )}
            {day.weather.arrival && (
              <span
                style={{ fontFamily: "var(--ff-sans)", fontSize: 13, color: "#CFCFCF" }}
              >
                Arrive · {day.weather.arrival}
              </span>
            )}
          </div>
        )}

        {day.overnight && (
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                letterSpacing: "0.14em",
                color: "#98AC64",
              }}
            >
              Camping
            </span>
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 13,
                lineHeight: "20px",
                color: "#CFCFCF",
              }}
            >
              {day.overnight.selected.name}
              {day.overnight.selected.cost && ` · ${day.overnight.selected.cost}`}
            </span>
            {day.overnight.selected.notes && (
              <span
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "#8A8A8A",
                }}
              >
                {day.overnight.selected.notes}
              </span>
            )}
          </div>
        )}

        {day.notes && day.notes.length > 0 && (
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                letterSpacing: "0.14em",
                color: "#98AC64",
              }}
            >
              Notes
            </span>
            {day.notes.map((note, i) => (
              <div key={i} className="flex gap-2">
                <span
                  style={{ color: "var(--amber)", fontSize: 13, lineHeight: "20px" }}
                >
                  ↳
                </span>
                <span
                  style={{
                    fontFamily: "var(--ff-sans)",
                    fontSize: 13,
                    lineHeight: "20px",
                    color: "#CFCFCF",
                  }}
                >
                  {note}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
