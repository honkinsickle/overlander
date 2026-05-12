"use client";

import { useEffect, useRef, useState } from "react";
import { WaypointCard } from "@/components/trip/waypoint-card";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import type { Day, Waypoint } from "@/lib/trips/types";

async function fetchFuel(
  tripId: string,
  dayId: string,
  signal: AbortSignal,
): Promise<BrowsePlace | null> {
  const res = await fetch(
    `/api/trip-browse/${encodeURIComponent(tripId)}/${encodeURIComponent(dayId)}?category=fuel`,
    { signal },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { places?: BrowsePlace[] };
  return (data.places ?? []).find((p) => p.title) ?? null;
}

function placeToWaypoint(day: Day, place: BrowsePlace): Waypoint {
  const hoursStat = place.stats.find((s) => /hours|open/i.test(s.label));
  return {
    id: `fuel-${day.id}-${place.id}`,
    slug: place.id,
    category: "fuel",
    title: place.title,
    subtitle: `Day ${day.dayNumber} · Refuel`,
    description:
      place.description ||
      `${place.title} — refuel along today's route.`,
    stats: place.stats,
    coords: place.coords,
    photoUrl: place.photoUrl,
    tags: place.pills.map((p) => p.label),
    logistics: {
      hours: hoursStat?.value,
      phone: place.placeInfo.phone?.display,
      website: place.placeInfo.website?.display,
    },
    dataSources: [place.mention.secondary],
  };
}

export function FuelStopCard({ tripId, day }: { tripId: string; day: Day }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [place, setPlace] = useState<BrowsePlace | null | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
    if (!inView) return;
    const ctrl = new AbortController();
    let cancelled = false;
    fetchFuel(tripId, day.id, ctrl.signal).then(
      (p) => {
        if (!cancelled) setPlace(p);
      },
      () => {
        if (!cancelled) setPlace(null);
      },
    );
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [inView, tripId, day.id]);

  if (place === null) return null;
  return (
    <div ref={ref}>
      {place === undefined ? (
        <FuelSkeleton />
      ) : (
        <WaypointCard tripId={tripId} waypoint={placeToWaypoint(day, place)} />
      )}
    </div>
  );
}

function FuelSkeleton() {
  return (
    <div
      className="w-full border-t border-border-subtle"
      style={{
        height: 88,
        backgroundImage:
          "linear-gradient(120deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
