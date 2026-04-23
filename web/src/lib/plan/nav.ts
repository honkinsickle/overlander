import { PLAN_STEPS, type PlanStep } from "./types";

/** URL helper for a given step in a draft. */
export function stepHref(draftId: string, step: PlanStep): string {
  return `/plan/${draftId}/${step}`;
}

/** Previous step URL for the Back button, or null at step 1. */
export function backHref(draftId: string, step: PlanStep): string | null {
  const i = PLAN_STEPS.indexOf(step);
  if (i <= 0) return null;
  return stepHref(draftId, PLAN_STEPS[i - 1]);
}

/** Next step URL for the Continue button, or null at the final step. */
export function nextHref(draftId: string, step: PlanStep): string | null {
  const i = PLAN_STEPS.indexOf(step);
  if (i < 0 || i >= PLAN_STEPS.length - 1) return null;
  return stepHref(draftId, PLAN_STEPS[i + 1]);
}
