import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetail } from "@/components/trip/day-detail";
import { MapColumn } from "@/components/trip/map-column";
import { MapDetailOverlay } from "@/components/trip/map-detail-overlay";
import type { Trip } from "@/lib/trips/types";

/**
 * The 3-column body rendered inside `SlideupShell` for both entry
 * points: the `@modal/(.)trip/[id]` intercept and the wizard-finalize
 * mount. Column widths match Paper `GHR-0`: 215 · 440 · 458 = 1113.
 */
export function TripSlideupBody({ trip }: { trip: Trip }) {
  return (
    <>
      <DayColumnPlanner tripId={trip.id} days={trip.days} />
      <section className="w-[440px] bg-bg-panel border-r border-border-subtle overflow-y-auto shrink-0">
        <DayDetail trip={trip} />
      </section>
      <section
        className="flex-1 min-w-0 relative overflow-hidden"
        aria-label="Map"
      >
        <MapColumn
          tripId={trip.id}
          days={trip.days}
          startCoords={trip.startCoords}
          routePolyline={trip.routePolyline}
        />
        <MapDetailOverlay />
      </section>
    </>
  );
}
