"use server";

/**
 * The wizard's server-side entry point into the merged YoTrippin pipeline:
 *   form → GenerationInput → preComputeFacts → generateAndAudit →
 *   bakeGeneratedDays → itineraryToTrip → persist → tripId.
 *
 * SAFETY (hard requirements):
 *   - GATED: refuses unless ENABLE_PLANNER_WIZARD=true (dev opt-in).
 *   - TEST-ONLY: refuses to persist unless the app is pointed at the TEST
 *     project — a generation can NEVER write to prod, even if the route were
 *     somehow reached with a prod-configured env.
 */

import { preComputeFacts } from "@/lib/itinerary/facts";
import { generateAndAudit, ItineraryGenerationError } from "@/lib/itinerary/generate";
import { bakeGeneratedDays } from "@/lib/itinerary/bake";
import { itineraryToTrip } from "@/lib/itinerary/to-trip";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  currentProjectRef,
  expeditionToGenerationInput,
  isExpeditionWizardEnabled,
  validateExpeditionForm,
  type ExpeditionForm,
} from "./expedition";

export type GenerateResult =
  | { ok: true; tripId: string; days: number; note?: string }
  | { ok: false; error: string };

export async function generateExpeditionTripAction(
  form: ExpeditionForm,
): Promise<GenerateResult> {
  // Gate.
  if (!isExpeditionWizardEnabled()) {
    return { ok: false, error: "The planner wizard is disabled (set ENABLE_PLANNER_WIZARD=true)." };
  }

  // TEST-only guard — the single most important safety check.
  const { ref, label } = currentProjectRef();
  if (label !== "TEST") {
    return {
      ok: false,
      error: `Refusing to run: the app is pointed at ${label} (${ref}), not TEST. Point dev at the TEST project before generating.`,
    };
  }

  const invalid = validateExpeditionForm(form);
  if (invalid) return { ok: false, error: invalid };

  const input = expeditionToGenerationInput(form);

  try {
    const facts = await preComputeFacts(input);
    const { audited, dayRoutes, unresolved } = await generateAndAudit(input, facts);

    const supabase = createSupabaseServiceClient();
    const baked = await bakeGeneratedDays(audited, input, supabase, dayRoutes);

    // Unique id per generation so the operator can compare runs in TEST.
    const tripId = `expedition-${Date.now().toString(36)}`;
    const trip = itineraryToTrip(tripId, input, facts, audited, baked);

    const { error } = await supabase.from("reference_trips").upsert({
      id: tripId,
      title: trip.title,
      payload: trip,
      source_version: `yotrippin-wizard@${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) return { ok: false, error: `Persist failed: ${error.message}` };

    return {
      ok: true,
      tripId,
      days: trip.days.length,
      note: unresolved
        ? "Generated, but some anchors couldn't be fully reconciled — review the plan."
        : undefined,
    };
  } catch (err) {
    if (err instanceof ItineraryGenerationError) {
      return { ok: false, error: `Generation failed (${err.code}): ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown generation error.",
    };
  }
}
