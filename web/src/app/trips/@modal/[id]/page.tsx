import { notFound } from "next/navigation";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { TripSlideupBody } from "@/components/trip/trip-slideup-body";
import { getTrip } from "@/lib/trips/repository";

/** Parallel `modal` slot for /trips/[id]. Mounts the slideup over the
 *  /trips list (kept persistent by app/trips/layout.tsx). Closing via
 *  ✕/ESC/backdrop calls `router.back()` from SlideupShell, which the
 *  App Router resolves to /trips (modal slot → default.tsx → null).
 *  PHASE chip is hidden for /trips entries — un-phased user trips
 *  (brief §7). */
export default async function TripsModalSlideup(
  props: PageProps<"/trips/[id]">,
) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return (
    <SlideupShell trip={trip} hidePhase>
      <TripSlideupBody trip={trip} />
    </SlideupShell>
  );
}
