"use client";

import { useEffect, useState } from "react";
import { Navigation, X } from "lucide-react";
import type { Waypoint } from "@/lib/trips/types";

const TRANSITION_MS = 280;

/** Maps directions URL to the REAL place, origin defaulting to the device's
 *  current location (we omit `origin`, so Google fills in "Your location").
 *  Destination is the place's real coordinates; for live Google results
 *  (id `gpl/<placeId>`) we also pass the Google `place_id` so the pin snaps
 *  to the exact listing. Used only for top-level search results, where the
 *  day route never reaches the place. Returns null when there are no coords. */
function buildDirectionsUrl(place: DetailPlace): string | null {
  const coord = place.waypoint?.coords ?? place.coords;
  if (!coord) return null;
  const [lng, lat] = coord;
  const params = new URLSearchParams({
    api: "1",
    destination: `${lat},${lng}`,
  });
  if (place.id.startsWith("gpl/")) {
    params.set("destination_place_id", place.id.slice("gpl/".length));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Shared inner content (icon + label) for the Directions action, used by
 *  both the in-app-panel <button> and the external-maps <a> variants. */
function DirectionsButtonContent() {
  return (
    <>
      <Navigation
        className="w-[18px] h-[18px]"
        strokeWidth={2}
        style={{ color: "var(--text-primary)" }}
      />
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-display)",
          fontSize: 14,
          lineHeight: "16px",
          fontWeight: 600,
          letterSpacing: "0.1em",
          color: "var(--text-primary)",
        }}
      >
        Directions
      </span>
    </>
  );
}

/** The slide-up's source-of-truth shape. Browse-panel cards only carry
 *  a subset (id/title/photoUrl/description); trip waypoints carry the
 *  full enriched Waypoint shape via `waypoint`. The panel renders
 *  whichever fields are present and hides the rest. */
type DetailPlace = {
  id: string;
  title: string;
  photoUrl?: string;
  dayNumber?: number;
  dayId?: string;
  coords?: [number, number];
  description?: string;
  /** When opened from a trip waypoint, the full enriched record is
   *  passed through so all the rich detail sections can render. */
  waypoint?: Waypoint;
  /** Whether this place is on the active day's route. `false` only for
   *  top-level area-search results (which run against the active day, not
   *  the result's). Gates the Directions button: in-day/on-route opens the
   *  in-app day-directions panel; a search result routes externally to the
   *  place. Absent → treated as on-route. */
  dayRelative?: boolean;
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
    sheet === "peek"
      ? // Add the 5px bottom-offset back so 25px is actually visible
        // above the map column edge.
        "calc(100% - 30px)"
      : sheet === "half"
        ? "calc(50% + 100px)"
        : "0";

  // Unmount entirely when closed. The translateY-only hide left the
  // <aside>, grabber, and Close-detail X in the DOM, and when another
  // overlay (e.g. the directions panel) was open simultaneously the
  // aside would visibly leak — see bug repro: open detail → open
  // directions → close detail → empty container with X persists.
  // Trade-off: the 280ms slide-down close animation is dropped; close
  // is now instant. Open animation still plays.
  if (sheet === "closed") return null;

  return (
    <aside
      aria-label="Location detail"
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
                  detail: {
                    placeId: place.id,
                    dayId: place.dayId,
                    dayNumber: place.dayNumber,
                    place,
                  },
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
 * Paper canonical `1FGH-0`, re-tinted to the Scenic palette. All
 * metadata (pills, reliability, simulator, logistics, community,
 * amenities, sources) is read from `place.waypoint` when present;
 * sections fall back to placeholders or hide when fields are missing.
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
  const wp = place.waypoint;
  const tags = wp?.tags ?? [];
  const reliability = wp?.reliability;
  const sim = wp?.simulator;
  const factual = wp?.factualNote;
  const logistics = wp?.logistics;
  const community = wp?.community;
  const amenities = wp?.amenities ?? [];
  const sources = wp?.dataSources ?? [];
  const description = wp?.description ?? place.description;
  const photoUrl = wp?.photoUrl ?? place.photoUrl;
  const dayNumberLabel = place.dayNumber ?? wp?.subtitle?.match(/Day\s+(\d+)/)?.[1];
  const routeOffset = wp?.routeOffsetMi;
  const bookingStatus = wp?.bookingStatus ?? [];
  // Directions button behavior is chosen by whether the place is on the
  // active day's route:
  //  - on-route / in-day  → open the in-app day-directions panel, scrolled
  //    to the step nearest this place (the day route passes through it);
  //  - top-level search result (dayRelative === false) → route externally to
  //    the real place, since the day route never reaches it.
  // Absent flag → treated as on-route (trip waypoints, suggestions, etc.).
  const directionsCoord = place.waypoint?.coords ?? place.coords;
  const directionsToPlaceUrl =
    place.dayRelative === false ? buildDirectionsUrl(place) : null;

  return (
    <article className="flex flex-col items-center bg-[#1A1A1A]">
      {/* Hero — 458×150 with bottom gradient */}
      <div className="relative w-full h-[150px] shrink-0 overflow-hidden">
        {photoUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${photoUrl})` }}
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

          {tags.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5">
              {tags.map((label) => (
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
          )}

          {bookingStatus.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {bookingStatus.map((b) => {
                const isBooked = /^booked|confirmed/i.test(b.status);
                const isWarn = /not yet|waitlist/i.test(b.status);
                const accent = isBooked
                  ? "#7DD18E"
                  : isWarn
                    ? "#F6C744"
                    : "#A89C90";
                return (
                  <div
                    key={b.permitName}
                    className="flex items-center gap-2 rounded-sm py-1.5 px-2.5"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.04)",
                      border: `1px solid ${accent}55`,
                    }}
                  >
                    <span
                      className="rounded-full shrink-0"
                      style={{
                        width: 6,
                        height: 6,
                        backgroundColor: accent,
                      }}
                    />
                    <span
                      className="uppercase shrink-0"
                      style={{
                        fontFamily: "var(--ff-display)",
                        fontSize: 11,
                        lineHeight: "14px",
                        letterSpacing: "0.12em",
                        color: accent,
                      }}
                    >
                      {b.status}
                    </span>
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "var(--ff-sans)",
                        fontSize: 12,
                        lineHeight: "14px",
                        color: "var(--text-muted)",
                      }}
                    >
                      · {b.permitName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {reliability && (
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
                  {reliability.score}
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
                {reliability.label} /
              </span>
              <span
                style={{
                  fontFamily: "var(--ff-display)",
                  fontSize: 12,
                  lineHeight: "16px",
                  color: "#817A6D",
                }}
              >
                computed from {reliability.sourceCount} source
                {reliability.sourceCount === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {dayNumberLabel != null && routeOffset != null && (
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
                Day {dayNumberLabel} · {routeOffset.toFixed(1)} mi on route
              </span>
            </div>
          )}
        </div>

        {/* Primary action — Directions. Behavior is context-gated above:
         *  search results route externally to the place; on-route places open
         *  the in-app day-directions panel scrolled to this place. Always
         *  present (every place has coordinates). */}
        {directionsToPlaceUrl ? (
          <a
            href={directionsToPlaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 self-stretch rounded-sm h-12 mb-4"
            style={{
              backgroundColor: "var(--button-primary)",
              border: "1px solid var(--button-primary-border)",
              cursor: "pointer",
            }}
          >
            <DirectionsButtonContent />
          </a>
        ) : (
          directionsCoord && (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("trip:openDirections", {
                    detail: { waypointCoord: directionsCoord },
                  }),
                )
              }
              className="flex items-center justify-center gap-2 self-stretch rounded-sm h-12 mb-4"
              style={{
                backgroundColor: "var(--button-primary)",
                border: "1px solid var(--button-primary-border)",
                cursor: "pointer",
              }}
            >
              <DirectionsButtonContent />
            </button>
          )
        )}

        {/* Simulator card — IF YOU STOP HERE. Hidden when no simulator
         *  data is available (browse-panel BrowsePlace path). */}
        {sim && (
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

            {(sim.stopTime || sim.entryCost) && (
              <div className="flex items-center gap-1.5">
                {sim.stopTime && (
                  <span
                    style={{
                      fontFamily: "var(--ff-sans)",
                      fontSize: 13,
                      lineHeight: "16px",
                      letterSpacing: "0.06em",
                      color: "var(--amber)",
                    }}
                  >
                    Stop time: {sim.stopTime}
                  </span>
                )}
                {sim.stopTime && sim.entryCost && (
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
                )}
                {sim.entryCost && (
                  <span
                    style={{
                      fontFamily: "var(--ff-sans)",
                      fontSize: 13,
                      lineHeight: "16px",
                      letterSpacing: "0.06em",
                      color: "var(--amber)",
                    }}
                  >
                    {sim.entryCost}
                  </span>
                )}
              </div>
            )}

            {/* Hero "Adds X" + eta eyebrow read as one unit — wrap them
             *  in a tight inner column so the parent's gap-2 doesn't
             *  open a gap between the two. The arrival clause renders only
             *  when a real arrival time exists (trip-waypoint path); browse
             *  results have only the detour, so they show "to your day". */}
            {sim.addsTime && (
              <div className="flex flex-col gap-0">
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
                  Adds {sim.addsTime}
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
                  to your day
                  {sim.newEtaPlace && sim.withStopEta
                    ? `. You'd arrive at ${sim.newEtaPlace} at ${sim.withStopEta}`
                    : ""}
                </span>
              </div>
            )}

            {sim.plannedEta && (
              <ScheduleRow
                label="Planned"
                value={sim.plannedEta}
                barColor="#A89C90"
                textColor="#A89C90"
                fillPct={78}
              />
            )}
            {sim.withStopEta && (
              <ScheduleRow
                label="With stop"
                value={sim.withStopEta}
                barColor="var(--amber)"
                textColor="var(--amber)"
                fillPct={100}
              />
            )}
            {sim.sunset && (
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
                  {sim.sunset}
                </span>
              </div>
            )}

            {sim.unaffectedNote && (
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
                  {sim.unaffectedNote}
                </span>
              </div>
            )}

            <div
              className="flex justify-center gap-2 pt-[19px]"
              style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}
            >
              {/* Directions moved to the always-present primary button at the
               *  top of the panel; this row keeps the contextual Add action. */}
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
                  {isAdded
                    ? "Added"
                    : dayNumberLabel != null
                      ? `Add to Day ${dayNumberLabel}`
                      : "Add to trip"}
                </span>
              </button>
            </div>
          </div>
        )}

        {description && (
          <>
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
                {description}
              </p>
              {factual && (
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
                    {factual.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--ff-sans)",
                      fontSize: 12,
                      lineHeight: "19px",
                      color: "#A89C90",
                    }}
                  >
                    {factual.text}
                  </span>
                </div>
              )}
            </Section>
          </>
        )}

        {logistics &&
          (logistics.hours ||
            logistics.entry ||
            logistics.address ||
            logistics.phone ||
            logistics.website) && (
            <>
              <Divider />
              <Section label="Logistics">
                <div className="flex flex-col gap-4">
                  {(logistics.hours || logistics.entry) && (
                    <div className="flex gap-2.5">
                      {logistics.hours && (
                        <LogisticsCell
                          label="Hours"
                          value={logistics.hours}
                          labelColor="#98AC64"
                        />
                      )}
                      {logistics.entry && (
                        <LogisticsCell
                          label="Entry"
                          value={logistics.entry}
                          labelColor="#98AC64"
                        />
                      )}
                    </div>
                  )}
                  {logistics.address && (
                    <LogisticsCell label="Address" value={logistics.address} />
                  )}
                  {(logistics.phone || logistics.website) && (
                    <div className="flex gap-2.5">
                      {logistics.phone && (
                        <LogisticsCell label="Phone" value={logistics.phone} />
                      )}
                      {logistics.website && (
                        <LogisticsCell
                          label="Website"
                          value={logistics.website}
                          valueColor="#A6C9F9"
                        />
                      )}
                    </div>
                  )}
                </div>
              </Section>
            </>
          )}

        {community && (
          <>
            <Divider />
            <Section label="Community">
              <div className="flex items-center gap-2">
                <div
                  className="w-16 h-1 rounded-sm overflow-hidden shrink-0"
                  style={{ backgroundColor: "#1E1E1E" }}
                >
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.min(100, Math.round((community.rating / 5) * 100))}%`,
                      backgroundColor: "var(--amber)",
                    }}
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
                  {community.rating.toFixed(1)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--ff-sans)",
                    fontSize: 12,
                    lineHeight: "16px",
                    color: "#8A8070",
                  }}
                >
                  ({community.reviewCount.toLocaleString()})
                </span>
              </div>
              {community.tips?.map((tip) => (
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
              {community.lastVerified && (
                <span
                  className="mt-2.5 block"
                  style={{
                    fontFamily: "var(--ff-mono)",
                    fontSize: 12,
                    lineHeight: "16px",
                    color: "var(--text-muted)",
                  }}
                >
                  Last verified: {community.lastVerified}
                </span>
              )}
            </Section>
          </>
        )}

        {amenities.length > 0 && (
          <>
            <Divider />
            <Section label="Amenities">
              <div className="flex flex-wrap gap-1.5">
                {amenities.map((a) => (
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
          </>
        )}

        {sources.length > 0 && (
          <>
            <Divider />
            <Section label="Data Sources">
              <div className="flex flex-wrap gap-1">
                {sources.map((s) => (
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
          </>
        )}
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
