import { notFound } from "next/navigation";
import { getDraft } from "@/lib/plan/repository";
import { listVehicles } from "@/lib/vehicles/repository";
import { VehicleForm } from "@/components/plan/vehicle-form";

export default async function VehicleStep(
  props: PageProps<"/plan/[id]/vehicle">,
) {
  const { id } = await props.params;
  const [draft, vehicles] = await Promise.all([
    getDraft(id),
    listVehicles(),
  ]);
  if (!draft) notFound();
  return (
    <VehicleForm draftId={id} defaults={draft.vehicle} vehicles={vehicles} />
  );
}
