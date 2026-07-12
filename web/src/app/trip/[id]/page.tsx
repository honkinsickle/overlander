import { notFound } from "next/navigation";
import { FullPageDayDetail } from "@/components/trip/full-page-day-detail";
import { getTrip } from "@/lib/trips/repository";

export default async function TripPage(props: PageProps<"/trip/[id]">) {
  const { id } = await props.params;
  const trip = await getTrip(id);
  if (!trip) notFound();

  return <FullPageDayDetail trip={trip} />;
}
