import { notFound } from "next/navigation";
import { PlanningCard } from "@/components/plan/planning-card";
import { LoaderPanel } from "@/components/plan/loader-panel";
import { loadWizardState } from "@/lib/plan/load";
import { STEP_DISPLAY_NUMBER } from "@/lib/plan/types";

/**
 * /plan/[id]/loader — "Hang tight while we find the best stops".
 * Simulated progress: auto-advances to /plan/[id]/results after ~10s.
 * No Back/Continue — the panel drives its own redirect.
 */
export default async function LoaderStep(
  props: PageProps<"/plan/[id]/loader">,
) {
  const { id } = await props.params;
  const state = await loadWizardState(id);
  if (!state) notFound();

  return (
    <PlanningCard
      displayStep={STEP_DISPLAY_NUMBER.loader}
      title="Hang tight while we find the best stops"
    >
      <LoaderPanel draftId={id} />
    </PlanningCard>
  );
}
