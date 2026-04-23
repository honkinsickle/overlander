import { notFound } from "next/navigation";
import { PlanningLayout } from "@/components/plan/planning-layout";
import { WizardBackdrop } from "@/components/plan/wizard-backdrop";
import { getDraft } from "@/lib/plan/repository";

/**
 * /plan/[id] layout — validates the draft id once and renders the shared
 * chrome (vnav, topbar). The backdrop switches between wizard-card
 * (scrim + centered) and full-bleed (Results) based on the URL segment.
 */
export default async function PlanLayout(props: LayoutProps<"/plan/[id]">) {
  const { id } = await props.params;
  const draft = await getDraft(id);
  if (!draft) notFound();

  return (
    <PlanningLayout>
      <WizardBackdrop>{props.children}</WizardBackdrop>
    </PlanningLayout>
  );
}
