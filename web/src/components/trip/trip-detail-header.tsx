"use client";

import { Calendar, Plus, Search } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Centre-column top-of-scroll header — Paper `GPW-0` "Trip-Detail-Header".
 *
 * Three zones stacked at 10px padding, 8px gap, on `--bg-card`:
 *   1. Trip-Hero    GS4-0 · 419×315  (hero image + overlay card w/ title,
 *                                     dates, weather chip)
 *   2. Explore      GRU-0 · EXPLORE label + "Ask about anything" input
 *   3. Itinerary    GQ4-0 · heading + first-day row (route + day + chevron)
 */
export function TripDetailHeader({ trip }: { trip: Trip }) {
  const firstDay = trip.days[0];
  const startDate = new Date(`${trip.startDate}T00:00:00`);
  const endDate = new Date(`${trip.endDate}T00:00:00`);
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
  const dateRange = `${fmt(startDate)}-${fmt(endDate)}`;

  return (
    <section
      className="flex flex-col items-center w-full overflow-clip bg-bg-card"
      style={{ paddingBlock: 20, paddingInline: 10, gap: 8 }}
    >
      <TripHero
        title={trip.title}
        dateRange={dateRange}
        heroImage={trip.heroImage ?? firstDay?.heroImage}
        heroGradient={firstDay?.heroGradient}
        weatherHiF={trip.weatherHiF}
        weatherLoF={trip.weatherLoF}
      />
      <Explore />
    </section>
  );
}

/** Paper GS4-0. Hero image with a 400×99 overlay card containing title,
 *  date row, and a pill-shaped weather chip. */
function TripHero({
  title,
  dateRange,
  heroImage,
  heroGradient,
  weatherHiF,
  weatherLoF,
}: {
  title: string;
  dateRange: string;
  heroImage?: string;
  heroGradient?: string;
  weatherHiF: number;
  weatherLoF: number;
}) {
  return (
    <div className="relative w-[419px] h-[315px] shrink-0">
      {/* Hero image (GSI-0) — 419×290, offset 2/-11 to peek under overlay. */}
      <div
        aria-hidden
        className="absolute w-[419px] h-[290px] bg-cover bg-center"
        style={{
          left: 2,
          top: -11,
          backgroundImage: heroImage
            ? `url(${heroImage})`
            : (heroGradient ??
              "linear-gradient(135deg, #1e3b34 0%, #2d5045 55%, #c8a96e 100%)"),
        }}
      />

      {/* Overlay card (GS5-0) — 400×99 at left:13 top:219, bg --bg-panel @ 90%. */}
      <div
        className="absolute flex items-center rounded-[2px] border-b border-border-mid"
        style={{
          left: 13,
          top: 219,
          width: 400,
          height: 99,
          backgroundColor: "rgba(17,18,20,0.9)",
          boxShadow: "0 2px 3px rgba(0,0,0,0.2)",
          gap: 2,
        }}
      >
        {/* Title column (GS9-0): 295w · px 18 · py 23 · gap 2 · flex-col. */}
        <div
          className="flex flex-col items-start shrink-0"
          style={{ width: 295, paddingInline: 18, paddingBlock: 23, gap: 2 }}
        >
          <h2
            className="truncate"
            style={{
              fontSize: "24px",
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
            style={{ gap: 6, height: 22, paddingRight: 18 }}
          >
            <Calendar
              className="w-[14px] h-[14px] shrink-0 text-text-muted"
              strokeWidth={1.5}
            />
            <span
              className="flex-1"
              style={{
                fontSize: "14px",
                lineHeight: "18px",
                fontFamily: "var(--ff-sans)",
                fontWeight: 400,
                color: "var(--text-muted)",
              }}
            >
              {dateRange}
            </span>
          </div>
        </div>

        {/* Weather chip (GS6-0) — pill · bg --bg-panel @ 80% · border subtle. */}
        <div
          className="flex items-center justify-center rounded-full border border-border-subtle"
          style={{
            paddingBlock: 6,
            paddingInline: 12,
            gap: 6,
            backgroundColor: "rgba(17,18,20,0.8)",
          }}
        >
          <span style={{ fontSize: 11, lineHeight: "14px" }}>☀</span>
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
  );
}

/** Paper GRU-0 — EXPLORE heading + 400×46 focus-styled ask input. */
function Explore() {
  return (
    <div
      className="flex flex-col justify-between w-fit shrink-0 bg-bg-card border-b border-border-subtle"
      style={{
        paddingTop: 9,
        paddingBottom: 30,
        paddingLeft: 12,
        paddingRight: 20,
        height: 124,
      }}
    >
      {/* EXPLORE label — Space Grotesk 16/33 · tracking 0.19em · amber-light. */}
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-display)",
          fontSize: "16px",
          lineHeight: "33px",
          letterSpacing: "0.19em",
          color: "var(--amber-light)",
        }}
      >
        EXPLORE
      </span>

      {/* Ask input (GRV-0) — 400×46 · radius 4 · input-surface-filled
       *  · focused input-border-focus border + 3px ring. */}
      <button
        type="button"
        className="flex items-center justify-center w-[400px] h-[46px] rounded shrink-0"
        style={{
          paddingInline: 14,
          gap: 10,
          backgroundColor: "var(--input-surface-filled)",
          border: "1px solid var(--input-border-focus)",
          boxShadow: "0 0 0 3px rgba(167,204,253,0.18)",
        }}
      >
        <Plus className="w-[14px] h-[14px] text-text-muted" strokeWidth={1.5} />
        <span
          className="flex-1 text-left"
          style={{
            fontSize: "14px",
            lineHeight: "18px",
            fontFamily: "var(--ff-sans)",
            fontWeight: 400,
            color: "#B3B3B3",
          }}
        >
          Ask about anything
        </span>
        <Search
          className="w-[14px] h-[14px] text-text-muted"
          strokeWidth={1.5}
        />
      </button>
    </div>
  );
}

