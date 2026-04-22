import { redirect } from "next/navigation";
import { createDraft } from "@/lib/plan/repository";

/**
 * /plan — creates a fresh draft trip and redirects to its first step.
 * Called when a user clicks "Start a trip" from the dashboard.
 */
export default async function PlanEntry() {
  const draft = await createDraft();
  redirect(`/plan/${draft.id}/going`);
}
