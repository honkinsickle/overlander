"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown } from "lucide-react";
import { LocationBrowseCard } from "./location-browse-card";
import { computeCardStats } from "@/lib/trip-browse/card-stats";
import { slideCategoryToBrowseCategory } from "@/lib/trip-browse/palette";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { Day } from "@/lib/trips/types";

type FetchKey = "oddity" | "food" | "scenic" | "camping";

const FETCH_CATEGORIES: FetchKey[] = ["scenic", "food", "oddity", "camping"];

async function fetchTopPhotoPlace(
  tripId: string,
  dayId: string,
  slideKey: SlideCategoryKey,
  signal: AbortSignal,
): Promise<BrowsePlace | null> {
  const res = await fetch(
    `/api/trip-browse/${encodeURIComponent(tripId)}/${encodeURIComponent(dayId)}?category=${slideKey}`,
    { signal },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { places?: BrowsePlace[] };
  const photoFirst = (data.places ?? []).find(
    (p) => p.photoUrl && p.description && p.title,
  );
  return photoFirst ?? null;
}

type SuggestionEntry = { place: BrowsePlace; slideKey: FetchKey };

export function SuggestedSection({
  tripId,
  day,
  isActive,
}: {
  tripId: string;
  day: Day;
  /** True when this day is the one the user is scrolled to in DayDetail.
   *  Gates the trip:suggestedResults dispatch so only one day's places
   *  are pinned on the map at a time — multiple sections rendering pre-
   *  resolved data would otherwise stomp on each other. */
  isActive: boolean;
}) {
  // Server-side `resolveSuggestions` runs at trip-load and attaches the
  // top photo-bearing place per slide category to `day.suggestions`. When
  // at least one category resolved, render synchronously and skip the
  // client-side fetch. When the server returned nothing (empty object or
  // missing), fall through to the lazy fetch so the gap can be filled.
  const hasPreResolved =
    day.suggestions && Object.keys(day.suggestions).length > 0;
  const preResolved = hasPreResolved
    ? FETCH_CATEGORIES.map((c) => {
        const place = day.suggestions?.[c];
        return place ? { place, slideKey: c } : null;
      }).filter((e): e is SuggestionEntry => e !== null)
    : null;

  const [suggestions, setSuggestions] = useState<SuggestionEntry[] | null>(
    preResolved,
  );
  const sectionRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(hasPreResolved);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    // Once observed in view, keep mounted — no need to re-watch.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    // Skip client-side fetch when the server pre-resolved at least one
    // category for this day. Empty `suggestions: {}` falls through to a
    // lazy fetch on scroll.
    if (!inView || hasPreResolved) return;
    const ctrl = new AbortController();
    let cancelled = false;
    setSuggestions(null);

    Promise.all(
      FETCH_CATEGORIES.map((c) =>
        fetchTopPhotoPlace(tripId, day.id, c, ctrl.signal).then(
          (place) => (place ? { place, slideKey: c } : null),
          () => null,
        ),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setSuggestions(entries.filter((e): e is SuggestionEntry => e !== null));
    });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [inView, tripId, day.id, hasPreResolved]);

  // When this day becomes active, kick the fetch even if intersection
  // hasn't fired yet — otherwise the map dots wouldn't appear until the
  // user scrolled this section into the rootMargin window.
  useEffect(() => {
    if (isActive) setInView(true);
  }, [isActive]);

  // Publish this day's suggestions to the map. Only the active section
  // dispatches — see isActive comment on the props. On routeReady we
  // re-dispatch in case the map mounted after the first dispatch (race
  // between SuggestedSection's effect and MapColumn's listener
  // registration on initial slideup mount). Unmount of the active
  // section clears the layer.
  useEffect(() => {
    if (!isActive || !suggestions || suggestions.length === 0) return;
    const places = suggestions.map((s) => ({
      coords: s.place.coords,
      title: s.place.title,
      id: s.place.id,
      category: slideCategoryToBrowseCategory(s.slideKey),
    }));
    const dispatch = () => {
      window.dispatchEvent(
        new CustomEvent("trip:suggestedResults", { detail: { places } }),
      );
    };
    dispatch();
    window.addEventListener("trip:routeReady", dispatch);
    return () => {
      window.removeEventListener("trip:routeReady", dispatch);
      window.dispatchEvent(
        new CustomEvent("trip:suggestedResults", {
          detail: { places: [] },
        }),
      );
    };
  }, [isActive, suggestions]);

  const openDetailFor = (place: BrowsePlace) => () => {
    const hoursStat = place.stats.find(
      (s) => /hours|open/i.test(s.label) && !/always/i.test(s.value),
    );
    window.dispatchEvent(
      new CustomEvent("trip:flyTo", {
        detail: { coords: place.coords, name: place.title },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("trip:openDetail", {
        detail: {
          place: {
            id: place.id,
            title: place.title,
            photoUrl: place.photoUrl,
            dayNumber: day.dayNumber,
            dayId: day.id,
            coords: place.coords,
            description: place.description,
            pills: place.pills.map((p) => p.label),
            hours: hoursStat?.value,
            address: place.placeInfo.address || undefined,
            phone: place.placeInfo.phone?.display,
            website: place.placeInfo.website?.display,
            dataSources: place.mention.secondary,
          },
        },
      }),
    );
  };

  const loading = inView && suggestions === null;
  const empty = inView && suggestions !== null && suggestions.length === 0;

  return (
    <section
      ref={sectionRef}
      className="flex flex-col"
      style={{
        width: 420,
        marginInline: "auto",
        marginTop: 13,
        gap: 8,
        paddingBottom: 12,
        backgroundColor: "#25365D54",
        border: "1px solid #3D3C3C",
        borderRadius: 15,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls={`suggested-body-${day.id}`}
        className="sticky z-[5] flex items-center justify-center w-full border-0 cursor-pointer"
        style={{
          top: 130,
          height: 70,
          paddingInline: 13,
          paddingTop: 8,
          paddingBottom: 0,
          backgroundColor: "#1B2230",
          borderTopLeftRadius: 15,
          borderTopRightRadius: 15,
        }}
      >
        <span
          className="uppercase"
          style={{
            fontSize: 16,
            lineHeight: "24px",
            fontFamily: "var(--ff-display)",
            letterSpacing: "0.19em",
            color: "#FFFFFF",
          }}
        >
          Suggested Stops Day {day.dayNumber}
        </span>
        <ChevronDown
          aria-hidden
          className="ml-2"
          style={{
            width: 20,
            height: 20,
            color: "#FFFFFF",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
          strokeWidth={2}
        />
      </button>

      {!collapsed && (
        <div
          id={`suggested-body-${day.id}`}
          className="flex flex-col items-center"
          style={{ gap: 12 }}
        >
          <DayBriefingCard day={day} />
          {loading && <SuggestionSkeletons />}
          {suggestions &&
            suggestions.map((s) => {
              const stats = computeCardStats(s.place, {
                category: s.slideKey,
                dayCoords: day.coords,
                dayStartCoords: day.startCoord,
                dayLabel: day.label,
                dayNumber: day.dayNumber,
                dayDate: day.date,
              });
              return (
                <LocationBrowseCard
                  key={`${s.slideKey}-${s.place.id}`}
                  place={s.place}
                  category={slideCategoryToBrowseCategory(s.slideKey)}
                  dayNumber={day.dayNumber}
                  width={410}
                  stats={stats}
                  onAdd={(e?: MouseEvent) => {
                    e?.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("trip:toggleAdded", {
                        detail: {
                          placeId: s.place.id,
                          dayId: day.id,
                          dayNumber: day.dayNumber,
                          place: s.place,
                        },
                      }),
                    );
                  }}
                  onOpen={(e?: MouseEvent) => {
                    e?.stopPropagation();
                    openDetailFor(s.place)();
                  }}
                  onMore={(e?: MouseEvent) => {
                    e?.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("trip:openMore", {
                        detail: { placeId: s.place.id, dayId: day.id },
                      }),
                    );
                  }}
                />
              );
            })}
          {empty && <EmptyState />}
        </div>
      )}
    </section>
  );
}

function SuggestionSkeletons() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-[410px] rounded-[4px] overflow-clip border border-border-subtle"
          style={{
            height: 270,
            backgroundColor: "#161819BF",
          }}
        >
          <div
            style={{
              height: 130,
              backgroundImage:
                "linear-gradient(120deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.4s ease-in-out infinite",
            }}
          />
          <div style={{ padding: 12 }}>
            <div
              style={{
                height: 18,
                width: "55%",
                marginBottom: 8,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.06)",
              }}
            />
            <div
              style={{
                height: 14,
                width: "85%",
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            />
          </div>
        </div>
      ))}
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </>
  );
}

function DayBriefingCard({ day }: { day: Day }) {
  const hasContent = day.description || day.weather || (day.notes && day.notes.length > 0);
  if (!hasContent) return null;
  const route = [day.miles && `${day.miles} mi`, day.driveHours && `${day.driveHours} hrs`]
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
              <span style={{ fontFamily: "var(--ff-sans)", fontSize: 13, color: "#CFCFCF" }}>
                Depart · {day.weather.departure}
              </span>
            )}
            {day.weather.arrival && (
              <span style={{ fontFamily: "var(--ff-sans)", fontSize: 13, color: "#CFCFCF" }}>
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
                <span style={{ color: "var(--amber)", fontSize: 13, lineHeight: "20px" }}>
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

function EmptyState() {
  return (
    <div
      className="w-[410px] rounded-[4px] flex items-center justify-center"
      style={{
        height: 80,
        backgroundColor: "rgba(255,255,255,0.03)",
        border: "1px dashed rgba(255,255,255,0.12)",
        fontFamily: "var(--ff-sans)",
        fontSize: 13,
        color: "rgba(255,255,255,0.5)",
      }}
    >
      No suggestions found along today's route yet.
    </div>
  );
}
