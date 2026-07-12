import { notFound } from "next/navigation";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { TripSlideupBody } from "@/components/trip/trip-slideup-body";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTrip } from "@/lib/trips/repository";

// Reference trips that expose the "Make it mine" fork CTA. Mirrors the
// intercepting slideup route (@modal/(.)trip/[id]).
const REFERENCE_TRIP_IDS = new Set(["la-to-deadhorse"]);

/**
 * Direct-visit / shared-URL trip surface.
 *
 * Next intercepting routes only catch SOFT (client) navigations, so a
 * shared link — a hard nav / refresh — falls through here instead of the
 * `@modal/(.)trip/[id]` slideup. A wizard-generated trip renders in the
 * slideup because the wizard `router.push`es into it (soft nav); a shared
 * reference-trip URL never got that treatment and used to land on a
 * separate full-page composition.
 *
 * To make a shared trip URL display IDENTICALLY to a soft-nav (same
 * slideup: map background + rail + corridor spine + tiles + briefing),
 * this route mounts the canonical slideup surface directly — the same
 * `SlideupShell` + `TripSlideupBody` the intercept and the /trips modal
 * use. Dismiss lands on /trips (a cold visit has no underlying page to
 * `router.back()` to).
 */
export default async function TripPage(props: PageProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  const isReference = REFERENCE_TRIP_IDS.has(trip.id);
  const isAuthed = isReference ? await checkAuthed() : false;

  return (
    <SlideupShell trip={trip} closeHref="/trips">
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
