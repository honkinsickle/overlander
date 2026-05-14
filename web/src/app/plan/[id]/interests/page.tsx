import { notFound } from "next/navigation";
import { loadWizardState } from "@/lib/plan/load";
import { InterestsForm } from "@/components/plan/interests-form";

export default async function InterestsStep(
  props: PageProps<"/plan/[id]/interests">,
) {
  const { id } = await props.params;
  const state = await loadWizardState(id);
  if (!state) notFound();
  return <InterestsForm draftId={id} defaults={state.interests} />;
}
