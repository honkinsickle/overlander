import { notFound } from "next/navigation";
import { loadWizardState } from "@/lib/plan/load";
import { listVehicles } from "@/lib/vehicles/repository";
import { VehicleForm } from "@/components/plan/vehicle-form";

export default async function VehicleStep(
  props: PageProps<"/plan/[id]/vehicle">,
) {
  const { id } = await props.params;
  const [state, vehicles] = await Promise.all([
    loadWizardState(id),
    listVehicles(),
  ]);
  if (!state) notFound();
  return (
    <VehicleForm draftId={id} defaults={state.vehicle} vehicles={vehicles} />
  );
}
