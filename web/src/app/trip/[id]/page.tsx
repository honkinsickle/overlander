import { notFound } from "next/navigation";
import { DayDetail } from "@/components/trip/day-detail";
import { getTrip } from "@/lib/trips/repository";

export default async function TripPage(props: PageProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return <DayDetail trip={trip} />;
}
