import { notFound } from "next/navigation";
import { PlanningLayout } from "@/components/plan/planning-layout";
import { WizardBackdrop } from "@/components/plan/wizard-backdrop";
import { loadWizardState } from "@/lib/plan/load";

/**
 * /plan/[id] layout — validates the wizard id once and renders the
 * shared chrome (vnav, topbar). The id is polymorphic — UUID → authed
 * user trip in public.trips; otherwise → anonymous DRAFTS map.
 * `loadWizardState` handles both stores.
 */
export default async function PlanLayout(props: LayoutProps<"/plan/[id]">) {
  const { id } = await props.params;
  const state = await loadWizardState(id);
  if (!state) notFound();

  return (
    <PlanningLayout>
      <WizardBackdrop>{props.children}</WizardBackdrop>
    </PlanningLayout>
  );
}
