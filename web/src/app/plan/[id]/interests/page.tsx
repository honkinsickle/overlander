import { notFound } from "next/navigation";
import { getDraft } from "@/lib/plan/repository";
import { InterestsForm } from "@/components/plan/interests-form";

export default async function InterestsStep(
  props: PageProps<"/plan/[id]/interests">,
) {
  const { id } = await props.params;
  const draft = await getDraft(id);
  if (!draft) notFound();
  return <InterestsForm draftId={id} defaults={draft.interests} />;
}
