import { notFound } from "next/navigation";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { TripSlideupBody } from "@/components/trip/trip-slideup-body";
import { getTrip } from "@/lib/trips/repository";

/**
 * Intercepting modal for `/trip/[id]`.
 *
 * Active on soft navigations from `/` — the home page stays mounted
 * behind the sheet and `router.back()` restores it without a refetch.
 * A direct visit or refresh falls through to the non-intercepted
 * `app/trip/[id]/page.tsx` full-page route.
 */
export default async function SlideupTripPage(
  props: PageProps<"/trip/[id]">,
) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return (
    <SlideupShell trip={trip}>
      <TripSlideupBody trip={trip} />
    </SlideupShell>
  );
}
