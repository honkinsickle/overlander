import { notFound } from "next/navigation";
import { getDraft } from "@/lib/plan/repository";
import { GoingForm } from "@/components/plan/going-form";

export default async function GoingStep(
  props: PageProps<"/plan/[id]/going">,
) {
  const { id } = await props.params;
  const draft = await getDraft(id);
  if (!draft) notFound();
  return <GoingForm draftId={id} defaults={draft.going} />;
}
