import { notFound } from "next/navigation";
import { MapColumn } from "@/components/trip/map-column";
import { getTrip } from "@/lib/trips/repository";

/**
 * Split-column layout for a trip.
 *
 * 80 (vertical nav) · 440 (center column) · 613 (map column) = 1133
 * Fixed 1133×744 canvas for now to match the prototype.
 *
 * The map column is rendered here so it persists across center-column
 * navigation (e.g. opening /trip/:id/ask only swaps children).
 *
 * Waypoint detail fetches on demand via /api/trips/:id/waypoints/:slug
 * when the URL's `?panel=waypoint&id=<slug>` search params change.
 */
export default async function TripLayout(props: LayoutProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return (
    <div className="flex w-[1133px] h-[744px] bg-bg-base text-text-primary">
      <aside
        className="w-[80px] h-full bg-bg-panel border-r border-border-subtle"
        aria-label="Vertical navigation"
      />
      <section className="w-[440px] h-full bg-bg-panel border-r border-border-subtle overflow-y-auto">
        {props.children}
      </section>
      <section className="flex-1 h-full" aria-label="Map">
        <MapColumn tripId={trip.id} />
      </section>
    </div>
  );
}
