import { notFound } from "next/navigation";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { TripSlideupBody } from "@/components/trip/trip-slideup-body";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTrip } from "@/lib/trips/repository";

// TODO(scope): duplicated from app/trip/[id]/layout.tsx. Extract to a
// shared module if a second reference trip ever lands.
const REFERENCE_TRIP_IDS = new Set(["la-to-deadhorse"]);

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

  const isReference = REFERENCE_TRIP_IDS.has(trip.id);
  const isAuthed = isReference ? await checkAuthed() : false;

  return (
    <SlideupShell trip={trip}>
      <TripSlideupBody
        trip={trip}
        isReference={isReference}
        isAuthed={isAuthed}
      />
    </SlideupShell>
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
