import { notFound } from "next/navigation";
import { VerticalNav } from "@/components/chrome/vertical-nav";
import { DaySidebar } from "@/components/trip/day-sidebar";
import { MapColumn } from "@/components/trip/map-column";
import { getTrip } from "@/lib/trips/repository";

/**
 * Active-trip layout — vnav + 3-column body (day sidebar · detail · map).
 *
 * Target widths at 1113w body (per styleguide.md "Itinerary slide-up"):
 *   Day Sidebar 215 · Detail Panel 440 · Map Area 458
 *
 * Container-driven: fills whatever parent gives it (viewport for the
 * full-page route, future slideup shell for the modal-intercepted route,
 * future full-screen map if that ships).
 *
 * Children rely on the parent's `align-items: stretch` (flex default) for
 * full-height sizing; `h-full` would be unreliable here because the
 * parent's height is flex-derived rather than explicit.
 *
 * The day sidebar and map column live in the layout so they persist
 * across center-column navigation (e.g. opening /trip/:id/ask only
 * swaps the children slot).
 */
export default async function TripLayout(props: LayoutProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return (
    <div className="flex w-full h-[100dvh] bg-bg-base text-text-primary overflow-hidden">
      <VerticalNav />
      <aside className="w-[215px] shrink-0 overflow-hidden" aria-label="Days">
        <DaySidebar tripId={trip.id} days={trip.days} />
      </aside>
      <section className="w-[440px] bg-bg-panel border-r border-border-subtle overflow-y-auto shrink-0">
        {props.children}
      </section>
      <section className="flex-1 min-w-0 relative overflow-hidden" aria-label="Map">
        <MapColumn tripId={trip.id} days={trip.days} />
      </section>
    </div>
  );
}
