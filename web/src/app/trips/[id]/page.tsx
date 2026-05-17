import type { Metadata } from "next";
import { getTrip } from "@/lib/trips/repository";

/** /trips/[id] children slot. The slideup is rendered by the
 *  app/trips/@modal/[id]/page.tsx parallel slot; the children slot
 *  exists so the URL is a valid route (and so refreshes/deeplinks
 *  resolve the layout's children placeholder, not a 404).
 *
 *  Owns the tab-title metadata for /trips/[id] per brief §7. */
export async function generateMetadata(
  props: PageProps<"/trips/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  const trip = await getTrip(id);
  return {
    title: trip ? `${trip.title} · Overlander` : "Overlander",
  };
}

export default function TripsIdPlaceholder() {
  return null;
}
