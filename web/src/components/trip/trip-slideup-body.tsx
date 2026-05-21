import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetail } from "@/components/trip/day-detail";
import { MakeItMineCta } from "@/components/trip/make-it-mine-cta";
import { MapColumn } from "@/components/trip/map-column";
import { MapDetailOverlay } from "@/components/trip/map-detail-overlay";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Trip } from "@/lib/trips/types";

// TODO(scope): duplicated from app/trip/[id]/layout.tsx. Extract to a
// shared module if a second reference trip ever lands.
const REFERENCE_TRIP_IDS = new Set(["la-to-deadhorse"]);

/**
 * The 3-column body rendered inside `SlideupShell` for both entry
 * points: the `@modal/(.)trip/[id]` intercept and the wizard-finalize
 * mount. Column widths match Paper `GHR-0`: 215 · 440 · 458 = 1113.
 */
export async function TripSlideupBody({ trip }: { trip: Trip }) {
  const isReference = REFERENCE_TRIP_IDS.has(trip.id);
  const isAuthed = isReference ? await checkAuthed() : false;

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
        {isReference && (
          <MakeItMineCta
            referenceId={trip.id}
            isAuthed={isAuthed}
            returnPath={`/trip/${trip.id}`}
          />
        )}
      </section>
    </>
  );
}

async function checkAuthed(): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}
