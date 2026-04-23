import { notFound } from "next/navigation";
import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetail } from "@/components/trip/day-detail";
import { MapColumn } from "@/components/trip/map-column";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { getTrip } from "@/lib/trips/repository";

/**
 * Intercepting modal for `/trip/[id]`.
 *
 * Active on soft navigations from `/` — the home page stays mounted
 * behind the sheet and `router.back()` restores it without a refetch.
 * A direct visit or refresh falls through to the non-intercepted
 * `app/trip/[id]/page.tsx` full-page route.
 *
 * Column widths match Paper `GHR-0` (Slideup): 215 · 440 · 458 = 1113.
 * The dashboard's 80px vnav is omitted here.
 */
export default async function SlideupTripPage(
  props: PageProps<"/trip/[id]">,
) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return (
    <SlideupShell trip={trip}>
      <DayColumnPlanner tripId={trip.id} days={trip.days} />
      <section className="w-[440px] bg-bg-panel border-r border-border-subtle overflow-y-auto shrink-0">
        <DayDetail trip={trip} />
      </section>
      <section
        className="flex-1 min-w-0 relative overflow-hidden"
        aria-label="Map"
      >
        <MapColumn tripId={trip.id} days={trip.days} />
      </section>
    </SlideupShell>
  );
}
