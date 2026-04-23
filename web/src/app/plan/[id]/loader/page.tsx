import { notFound } from "next/navigation";
import { PlanningCard } from "@/components/plan/planning-card";
import { LoaderPanel } from "@/components/plan/loader-panel";
import { getDraft } from "@/lib/plan/repository";
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
  const draft = await getDraft(id);
  if (!draft) notFound();

  return (
    <PlanningCard
      displayStep={STEP_DISPLAY_NUMBER.loader}
      title="Hang tight while we find the best stops"
    >
      <LoaderPanel draftId={id} />
    </PlanningCard>
  );
}
