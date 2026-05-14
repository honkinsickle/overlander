import { notFound } from "next/navigation";
import { loadWizardState } from "@/lib/plan/load";
import { GoingForm } from "@/components/plan/going-form";

export default async function GoingStep(
  props: PageProps<"/plan/[id]/going">,
) {
  const { id } = await props.params;
  const state = await loadWizardState(id);
  if (!state) notFound();
  return <GoingForm draftId={id} defaults={state.going} />;
}
