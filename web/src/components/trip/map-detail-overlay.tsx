"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const TRANSITION_MS = 280;

type DetailPlace = {
  id: string;
  title: string;
  photoUrl?: string;
  dayNumber?: number;
};

type SheetState = "closed" | "peek" | "half" | "expanded";

/** Cycle order driven by the grabber tap. */
const NEXT_STATE: Record<Exclude<SheetState, "closed">, Exclude<SheetState, "closed">> = {
  peek: "half",
  half: "expanded",
  expanded: "peek",
};

/**
 * Slide-up overlay anchored to the map column. Mounts inside the map
 * section so its height is relative to the column, not the viewport.
 *
 * Three states: closed (offscreen) · half (50% of map column) · expanded
 * (top sits 4px below the slideup header). Opens on `trip:openDetail`
 * (dispatched by the LocationCard's DETAILS button) into `half`; tapping
 * the grabber toggles between `half` and `expanded`. Closes on Escape,
 * the X button, or another `trip:openDetail` with `{ place: null }`.
 */
export function MapDetailOverlay() {
  const [place, setPlace] = useState<DetailPlace | null>(null);
  const [sheet, setSheet] = useState<SheetState>("closed");
  // Mirror of CategoryBrowsePanel's addedIds — kept in sync via the
  // `trip:addedSync` event so the CTA label and dim state stay correct
  // even when the user toggled from the cards rather than the panel.
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const isAdded = place ? addedIds.has(place.id) : false;

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ place: DetailPlace | null }>).detail;
      const next = detail?.place ?? null;
      setPlace(next);
      setSheet(next ? "half" : "closed");
    };
    window.addEventListener("trip:openDetail", onOpen);
    return () => window.removeEventListener("trip:openDetail", onOpen);
  }, []);

  useEffect(() => {
    const onSync = (e: Event) => {
      const ids = (e as CustomEvent<{ addedIds: string[] }>).detail?.addedIds;
      if (Array.isArray(ids)) setAddedIds(new Set(ids));
    };
    window.addEventListener("trip:addedSync", onSync);
    return () => window.removeEventListener("trip:addedSync", onSync);
  }, []);

  useEffect(() => {
    if (sheet === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSheet("closed");
        setPlace(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  // Sheet height is fixed at "full map column minus 4px" so the expanded
  // state (translateY 0) lands exactly 4px under the slideup header.
  // - half: 50% + 100px so the resting position sits lower in the column
  // - peek: leaves only 25px of the panel showing at the bottom
  const translateY =
    sheet === "closed"
      ? "100%"
      : sheet === "peek"
        ? // Add the 5px bottom-offset back so 25px is actually visible
          // above the map column edge.
          "calc(100% - 30px)"
        : sheet === "half"
          ? "calc(50% + 100px)"
          : "0";

  return (
    <aside
      aria-label="Location detail"
      aria-hidden={sheet === "closed"}
      style={{
        width: 448,
        height: "calc(100% - 4px)",
        transform: `translateY(${translateY})`,
        transitionProperty: "transform",
        transitionDuration: `${TRANSITION_MS}ms`,
        transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
        backgroundColor: "#1A1A1A",
        borderTop: "0.5px solid rgba(255,255,255,0.18)",
        borderLeft: "0.5px solid rgba(255,255,255,0.12)",
        borderRight: "0.5px solid rgba(255,255,255,0.12)",
        borderTopLeftRadius: 10,
        borderTopRightRadius: 10,
        boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
      }}
      className="absolute bottom-[-5px] right-[5px] z-30 flex flex-col overflow-hidden"
    >
      {/* Hit zone for tap-to-toggle between half and expanded. The visible
       *  grabber pill sits inside; the button covers a 24px-tall band so
       *  the affordance is easy to hit. */}
      <button
        type="button"
        aria-label="Cycle detail size"
        onClick={() =>
          setSheet((s) => (s === "closed" ? s : NEXT_STATE[s]))
        }
        className="absolute top-0 left-0 right-0 h-6 z-10 flex items-start justify-center pt-1.5"
      >
        <span
          aria-hidden
          className="w-10 h-1 rounded-full bg-border-mid"
        />
      </button>
      <button
        type="button"
        aria-label="Close detail"
        onClick={() => {
          setSheet("closed");
          setPlace(null);
        }}
        className="absolute top-4 right-6 z-20 flex items-center justify-center w-8 h-8 rounded-md bg-black/40 hover:bg-black/60"
      >
        <X className="w-4 h-4 text-white" strokeWidth={1.75} />
      </button>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {place ? (
          <TrappersDetailPanel
            place={place}
            isAdded={isAdded}
            onToggleAdded={() =>
              window.dispatchEvent(
                new CustomEvent("trip:toggleAdded", {
                  detail: { placeId: place.id },
                }),
              )
            }
          />
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Scenic / Sights & Landmarks detail panel. Same structural skeleton as
 * Paper canonical `1FGH-0` (the Food/Trapper's variant), but re-tinted
 * to the Scenic palette and populated with park-themed copy. Title +
 * hero photo are driven by `place`; everything else is canonical.
 */
function TrappersDetailPanel({
  place,
  isAdded,
  onToggleAdded,
}: {
  place: DetailPlace;
  isAdded: boolean;
  onToggleAdded: () => void;
}) {
  return (
    <article className="flex flex-col items-center bg-[#1A1A1A]">
      {/* Hero — 458×150 with bottom gradient + Day chip top-left */}
      <div className="relative w-full h-[150px] shrink-0 overflow-hidden">
        {place.photoUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${place.photoUrl})` }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #1A2B3F 0%, #24354F 100%)",
            }}
          />
        )}
        <div
          className="absolute bottom-0 inset-x-0 h-12"
          style={{
            backgroundImage:
              "linear-gradient(0deg, rgba(20,20,20,0.85) 0%, rgba(20,20,20,0) 100%)",
          }}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col self-stretch items-stretch px-6 pt-5 pb-8">
        {/* Title row + pills + reliability + route */}
        <div className="flex flex-col gap-3 mb-4">
          <h2
            style={{
              fontFamily: "var(--font-barlow-condensed), var(--ff-sans)",
              fontSize: 26,
              lineHeight: "26px",
              fontWeight: 700,
              fontStretch: "condensed",
              letterSpacing: "0.01em",
              color: "#A6C9F9",
            }}
          >
            {place.title}
          </h2>

          <div className="flex items-center flex-wrap gap-1.5">
            {["National Park", "Scenic Vista", "Hiking"].map((label) => (
              <span
                key={label}
                className="rounded-sm py-[5px] px-2.5"
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 11,
                  lineHeight: 1,
                  color: "#A6C9F9",
                  backgroundColor: "rgba(166,201,249,0.12)",
                  border: "1px solid rgba(166,201,249,0.32)",
                }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Reliability — 88 / GOOD RELIABILITY / computed from 3 sources */}
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center justify-center rounded-sm w-8 h-8 shrink-0"
              style={{
                backgroundColor: "rgba(255,255,255,0.10)",
                border: "0.5px solid #F68A0D",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 14,
                  lineHeight: "16px",
                  fontWeight: 700,
                  color: "#FF8E05",
                }}
              >
                88
              </span>
            </div>
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.08em",
                color: "#FF8E05",
              }}
            >
              Good reliability /
            </span>
            <span
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "16px",
                color: "#817A6D",
              }}
            >
              computed from 3 sources
            </span>
          </div>

          {/* Route eyebrow */}
          <div className="flex flex-col gap-[5px]">
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "14px",
                letterSpacing: "0.14em",
                color: "#98AC64",
              }}
            >
              Route
            </span>
            <span
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.02em",
                color: "var(--amber)",
              }}
            >
              Day 14 · 0.4 mi on route
            </span>
          </div>
        </div>

        {/* Simulator card — IF YOU STOP HERE. Dims when this place is
         *  already added so the panel matches the card grid state. */}
        <div
          className="flex flex-col rounded-sm gap-2 self-stretch py-[22px] px-[22px]"
          style={{
            backgroundColor: "rgba(89,97,93,0.21)",
            opacity: isAdded ? 0.45 : 1,
            filter: isAdded ? "grayscale(0.6)" : "none",
            transition: "opacity 200ms ease, filter 200ms ease",
          }}
        >
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 14,
              lineHeight: "14px",
              letterSpacing: "0.14em",
              color: "#A6C9F9",
            }}
          >
            If you stop here
          </span>

          <div className="flex items-center gap-1.5">
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 13,
                lineHeight: "16px",
                letterSpacing: "0.06em",
                color: "var(--amber)",
              }}
            >
              Stop time: 1h
            </span>
            <span
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "16px",
                fontWeight: 500,
                color: "#86897E",
              }}
            >
              |
            </span>
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 13,
                lineHeight: "16px",
                letterSpacing: "0.06em",
                color: "var(--amber)",
              }}
            >
              $30 entry · Daily
            </span>
          </div>

          <span
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 24,
              lineHeight: "30px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "#FFFFFF",
            }}
          >
            Adds 1h28m
          </span>

          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 13,
              lineHeight: "16px",
              letterSpacing: "0.06em",
              color: "#98AC65",
            }}
          >
            new ETA at Klamath Falls
          </span>

          <ScheduleRow
            label="Planned"
            value="8:18pm"
            barColor="#A89C90"
            textColor="#A89C90"
            fillPct={78}
          />
          <ScheduleRow
            label="With stop"
            value="8:43pm"
            barColor="var(--amber)"
            textColor="var(--amber)"
            fillPct={100}
          />
          <div className="flex items-center">
            <span
              className="w-[87px] shrink-0"
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 15,
                lineHeight: "18px",
                color: "var(--amber)",
              }}
            >
              Sunset
            </span>
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 14,
                lineHeight: "18px",
                color: "var(--amber)",
              }}
            >
              9:02pm
            </span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span
              className="rounded-full w-1.5 h-1.5 shrink-0"
              style={{ backgroundColor: "#98AC64" }}
            />
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "14px",
                letterSpacing: "0.12em",
                color: "#899B5E",
              }}
            >
              Day 15 unaffected
            </span>
          </div>

          <div
            className="flex justify-center pt-[19px]"
            style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}
          >
            <button
              type="button"
              onClick={onToggleAdded}
              className="flex items-center justify-center h-10 rounded-sm px-6"
              style={{
                backgroundColor: "#24354F",
                border: "1px solid #A6C9F9",
                cursor: "pointer",
              }}
            >
              <span
                className="uppercase"
                style={{
                  fontFamily: "var(--ff-display)",
                  fontSize: 14,
                  lineHeight: "16px",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: "var(--text-primary)",
                }}
              >
                {isAdded ? "Added" : `Add to Day ${place.dayNumber ?? 14}`}
              </span>
            </button>
          </div>
        </div>

        <Divider />

        <Section label="Description">
          <p
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
              lineHeight: "21px",
              color: "#A89C90",
            }}
          >
            Massive caldera lake formed when Mount Mazama collapsed 7,700 years
            ago — the deepest lake in the United States at 1,949 feet. The
            Rim Drive loop circles the rim with 30+ pullouts, vista trails,
            and access to Wizard Island via boat tour.
          </p>
          <div
            className="mt-2.5 flex flex-col rounded-sm py-2.5 px-3 gap-1.5"
            style={{
              backgroundColor: "#232323",
              border: "1px solid #5A5A5A",
            }}
          >
            <span
              className="uppercase"
              style={{
                fontFamily: "var(--ff-mono)",
                fontSize: 12,
                lineHeight: "14px",
                letterSpacing: "0.14em",
                color: "#B7B4B2",
              }}
            >
              Geology Notes
            </span>
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 12,
                lineHeight: "19px",
                color: "#A89C90",
              }}
            >
              Crater Lake&apos;s caldera formed in a single catastrophic
              eruption 7,700 years ago. Designated a National Park in 1902,
              the country&apos;s 5th oldest, and one of the world&apos;s
              clearest large lakes.
            </span>
          </div>
        </Section>

        <Divider />

        <Section label="Logistics">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2.5">
              <LogisticsCell
                label="Hours"
                value="Daily · sunrise to sunset"
                labelColor="#98AC64"
              />
              <LogisticsCell
                label="Entry"
                value="$30 / vehicle · 7-day pass"
                labelColor="#98AC64"
              />
            </div>
            <div className="flex gap-2.5">
              <LogisticsCell label="Phone" value="(541) 594-3000" />
              <LogisticsCell
                label="Website"
                value="nps.gov/crla"
                valueColor="#A6C9F9"
              />
            </div>
          </div>
        </Section>

        <Divider />

        <Section label="Community">
          <div className="flex items-center gap-2">
            <div
              className="w-16 h-1 rounded-sm overflow-hidden shrink-0"
              style={{ backgroundColor: "#1E1E1E" }}
            >
              <div
                className="h-full rounded-sm"
                style={{ width: "96%", backgroundColor: "var(--amber)" }}
              />
            </div>
            <span
              style={{
                fontFamily: "var(--ff-mono)",
                fontSize: 12,
                lineHeight: "16px",
                color: "var(--amber)",
              }}
            >
              4.5
            </span>
            <span
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 12,
                lineHeight: "16px",
                color: "#8A8070",
              }}
            >
              (320)
            </span>
          </div>
          {[
            "Rim Drive opens late June through October — check status before arriving",
            "Best light for photos: first 2 hours after sunrise from Watchman Overlook",
          ].map((tip) => (
            <div key={tip} className="flex gap-2 mt-1.5">
              <span
                className="shrink-0"
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 16,
                  lineHeight: "20px",
                  color: "var(--amber)",
                }}
              >
                ▸
              </span>
              <span
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "#8A8070",
                }}
              >
                {tip}
              </span>
            </div>
          ))}
          <span
            className="mt-2.5 block"
            style={{
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              color: "var(--text-muted)",
            }}
          >
            Last verified: Apr 2026
          </span>
        </Section>

        <Divider />

        <Section label="Amenities">
          <div className="flex flex-wrap gap-1.5">
            {["Hiking trails", "Visitor center", "Restrooms", "Boat tours"].map((a) => (
              <span
                key={a}
                className="rounded-sm py-0.5 px-2"
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 12,
                  lineHeight: "16px",
                  color: "#6A8A6A",
                  backgroundColor: "#141A14",
                  border: "1px solid #2A2A2A",
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </Section>

        <Divider />

        <Section label="Data Sources">
          <div className="flex flex-wrap gap-1">
            {["NPS.gov", "AllTrails", "OSM"].map((s) => (
              <span
                key={s}
                className="rounded-sm py-px px-1.5"
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 12,
                  lineHeight: "16px",
                  letterSpacing: "0.06em",
                  color: "var(--text-muted)",
                  backgroundColor: "#141414",
                  border: "1px solid #222222",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </Section>
      </div>
    </article>
  );
}

function ScheduleRow({
  label,
  value,
  barColor,
  textColor,
  fillPct,
}: {
  label: string;
  value: string;
  barColor: string;
  textColor: string;
  fillPct: number;
}) {
  return (
    <div className="flex items-center">
      <span
        className="w-[87px] shrink-0"
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 15,
          lineHeight: "18px",
          color: textColor,
        }}
      >
        {label}
      </span>
      <div
        className="w-[188px] rounded-sm overflow-hidden h-1 shrink-0"
        style={{ backgroundColor: "#1E1E1E" }}
      >
        <div
          className="h-full rounded-sm"
          style={{ width: `${fillPct}%`, backgroundColor: barColor }}
        />
      </div>
      <span
        className="ml-3"
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 14,
          lineHeight: "18px",
          color: textColor,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 self-stretch">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-display)",
          fontSize: 14,
          lineHeight: "14px",
          letterSpacing: "0.14em",
          color: "var(--amber-dark)",
        }}
      >
        {label}
      </span>
      {children}
    </section>
  );
}

function LogisticsCell({
  label,
  value,
  labelColor = "#A89C90",
  valueColor = "#A89C90",
}: {
  label: string;
  value: string;
  labelColor?: string;
  valueColor?: string;
}) {
  return (
    <div
      className="flex-1 flex flex-col gap-1.5 px-3"
      style={{ borderLeft: "1px solid #484848" }}
    >
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-mono)",
          fontSize: 12,
          lineHeight: "14px",
          letterSpacing: "0.14em",
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 12,
          lineHeight: "16px",
          color: valueColor,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="h-px self-stretch shrink-0 my-4"
      style={{ backgroundColor: "#484848" }}
    />
  );
}
