"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import type { Trip } from "@/lib/trips/types";

/**
 * Full-page (`/trip/[id]`) day rail. Wires `DayColumnPlanner` as the day
 * SELECTOR on the full-page surface, mirroring the slideup: the selected
 * day drives the corridor column (`FullPageDayDetail`) and the map.
 *
 * State crosses the layout/page server-component boundary through the
 * `?day=` URL param — `history.replaceState` on select, read back via
 * `useSearchParams` (Next keeps them in sync without an RSC refetch). This
 * is the same channel `MapColumn` reads, so a day click also flies the
 * map. `trip:activeDay` is re-emitted for the event-based listeners
 * (e.g. FindNearbyPanel) that tracked the slideup's selection.
 */
export function FullPageDayRail({ trip }: { trip: Trip }) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const activeDayId =
    queried && trip.days.some((d) => d.id === queried) ? queried : null;

  const setDay = useCallback((dayId: string | null) => {
    const url = new URL(window.location.href);
    if (dayId) url.searchParams.set("day", dayId);
    else url.searchParams.delete("day");
    window.history.replaceState(null, "", url.toString());
    if (dayId) {
      window.dispatchEvent(
        new CustomEvent("trip:activeDay", {
          detail: { id: dayId, source: "column" },
        }),
      );
    }
  }, []);

  // Overview nav (Overview / Guides / Places): drop back to the Overview
  // state and scroll its column to the section. selectedDayId → null and
  // the scroll batch into the same commit cycle; the section is mounted by
  // the time the rAF callback fires.
  const scrollToSection = useCallback(
    (anchor: "overview" | "guides" | "places") => {
      setDay(null);
      requestAnimationFrame(() => {
        document
          .getElementById(anchor)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [setDay],
  );

  return (
    <DayColumnPlanner
      tripId={trip.id}
      days={trip.days}
      activeDayId={activeDayId}
      onSelectDay={(id) => setDay(id)}
      onSelectOverview={() => setDay(null)}
      onScrollTo={scrollToSection}
    />
  );
}
