"use client";

import { Calendar } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Centre-column top-of-scroll header — Paper N2J-0 → N9W-0.
 *
 * Hero (440×360) with a fit-content overlay card stacking four rows:
 * editorial kicker, title, date row, and trip stats. Weather pill sits
 * to the right.
 */
export function TripDetailHeader({ trip }: { trip: Trip }) {
  const firstDay = trip.days[0];
  const startDate = new Date(`${trip.startDate}T00:00:00`);
  const endDate = new Date(`${trip.endDate}T00:00:00`);
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
  const dateRange = `${fmt(startDate)}-${fmt(endDate)}`;

  const dayCount =
    Math.round(
      (endDate.getTime() - startDate.getTime()) / 86_400_000,
    ) + 1;
  const totalMiles = trip.days.reduce(
    (sum, d) => sum + (d.miles ?? 0),
    0,
  );
  const overnights = Math.max(0, trip.days.length - 1);

  return (
    <section
      className="flex flex-col items-center w-full overflow-clip bg-bg-card"
      style={{ paddingTop: 20, paddingInline: 10 }}
    >
      <TripHero
        title={trip.title}
        kicker={trip.kicker}
        dateRange={dateRange}
        heroImage={trip.heroImage ?? firstDay?.heroImage}
        heroGradient={firstDay?.heroGradient}
        weatherHiF={trip.weatherHiF}
        weatherLoF={trip.weatherLoF}
        dayCount={dayCount}
        totalMiles={totalMiles > 0 ? totalMiles : undefined}
        overnights={overnights}
      />
    </section>
  );
}

function TripHero({
  title,
  kicker,
  dateRange,
  heroImage,
  heroGradient,
  weatherHiF,
  weatherLoF,
  dayCount,
  totalMiles,
  overnights,
}: {
  title: string;
  kicker?: string;
  dateRange: string;
  heroImage?: string;
  heroGradient?: string;
  weatherHiF: number;
  weatherLoF: number;
  dayCount: number;
  totalMiles?: number;
  overnights: number;
}) {
  const stats: string[] = [`${dayCount} DAYS`];
  if (totalMiles) stats.push(`${totalMiles.toLocaleString()} MI`);

  return (
    <div className="flex flex-col items-center w-[440px] h-[360px] overflow-clip shrink-0">
      <div className="relative w-[420px] h-[360px] shrink-0">
        <div
          aria-hidden
          className="absolute w-[419px] h-[290px] bg-cover bg-center"
          style={{
            left: 0,
            top: -11,
            // JSON.stringify wraps the URL in double quotes so any
            // parens / commas / spaces inside (e.g. the Mapbox Static
            // polyline-overlay `path-3+c8a96e-0.9(...)`) don't break
            // CSS's url() parser.
            backgroundImage: heroImage
              ? `url(${JSON.stringify(heroImage)})`
              : (heroGradient ??
                "linear-gradient(135deg, #1e3b34 0%, #2d5045 55%, #c8a96e 100%)"),
          }}
        />

        <div
          className="absolute flex items-center justify-center rounded-[2px] border-b border-border-mid"
          style={{
            left: 10,
            top: 205,
            width: 400,
            backgroundColor: "var(--bg-panel)",
            boxShadow: "0 2px 3px rgba(0,0,0,0.2)",
            gap: 2,
          }}
        >
        <div
          className="flex flex-col items-start shrink-0"
          style={{ width: 295, paddingInline: 18, paddingBlock: 23, gap: 2 }}
        >
          {kicker && (
            <span
              style={{
                fontSize: 13,
                lineHeight: "18px",
                letterSpacing: "0.01em",
                marginBottom: 2,
                color: "var(--amber)",
                fontFamily: "var(--ff-serif)",
                fontStyle: "italic",
              }}
            >
              {kicker}
            </span>
          )}
          <h2
            style={{
              fontSize: 24,
              lineHeight: "29px",
              fontFamily: "var(--ff-sans)",
              fontWeight: 400,
              color: "var(--amber-light)",
              alignSelf: "stretch",
            }}
          >
            {title}
          </h2>
          <div
            className="flex items-center"
            style={{ gap: 6, height: 22, paddingRight: 0, whiteSpace: "nowrap" }}
          >
            <Calendar
              className="w-[18px] h-[18px] shrink-0 text-text-muted"
              strokeWidth={1.75}
            />
            <span
              style={{
                fontSize: 14,
                lineHeight: "18px",
                fontFamily: "var(--ff-sans)",
                fontWeight: 400,
                color: "var(--text-muted)",
                flexShrink: 0,
              }}
            >
              {dateRange}
            </span>
            {stats.map((s) => (
              <span
                key={s}
                className="flex items-center"
                style={{ gap: 6, flexShrink: 0 }}
              >
                <span style={{ opacity: 0.45, color: "var(--text-muted)" }}>
                  ·
                </span>
                <span
                  className="uppercase"
                  style={{
                    fontFamily: "var(--ff-mono)",
                    fontSize: 13,
                    lineHeight: "18px",
                    color: "var(--text-muted)",
                  }}
                >
                  {s}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div
          className="flex items-center justify-center rounded-[20px] border border-border-subtle"
          style={{
            paddingBlock: 6,
            paddingInline: 12,
            gap: 6,
            backgroundColor: "rgba(17,18,20,0.8)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              lineHeight: "14px",
              color: "var(--amber-light)",
            }}
          >
            ☀
          </span>
          <span
            style={{
              fontSize: 11,
              lineHeight: "14px",
              fontFamily: "var(--ff-sans)",
              color: "var(--text-primary)",
            }}
          >
            {weatherHiF}° / {weatherLoF}°F
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}

