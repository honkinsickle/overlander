import { notFound } from "next/navigation";
import { TripView } from "@/components/trip/trip-view";
import { getTrip } from "@/lib/trips/repository";

export default async function TripPage(props: PageProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return <TripView trip={trip} />;
}
