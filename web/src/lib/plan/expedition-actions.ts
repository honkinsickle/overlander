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
import { enqueueResolvedPlaces } from "@/lib/itinerary/ingest";
import { bakeGeneratedDays } from "@/lib/itinerary/bake";
import { itineraryToTrip } from "@/lib/itinerary/to-trip";
import { attachHeroPhotos } from "@/lib/imagery/destination-photo";
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
    // Real per-day + trip hero photos (Wikipedia/Commons by destination
    // name) so a generated trip renders place photos, not blank heroes.
    const trip = await attachHeroPhotos(
      itineraryToTrip(tripId, input, facts, audited, baked, dayRoutes),
    );

    const { error } = await supabase.from("reference_trips").upsert({
      id: tripId,
      title: trip.title,
      payload: trip,
      source_version: `yotrippin-wizard@${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) return { ok: false, error: `Persist failed: ${error.message}` };

    // Corpus feedback (spec §8.3): enqueue this generation's tier-2 live-resolved
    // places as google_resolved source_records so a later `materialize` can
    // promote them (self-densifying). Only reachable on TEST — the guard at the
    // top of this action refuses any non-TEST project. Non-fatal: a corpus-write
    // failure must never fail the user's generation.
    const resolvedPlaces = audited.days.flatMap((d) => d.audit?.resolvedPlaces ?? []);
    if (resolvedPlaces.length > 0) {
      try {
        const enq = await enqueueResolvedPlaces(resolvedPlaces, supabase);
        if (enq.errors.length > 0) console.warn("[ingest] google_resolved partial:", enq);
      } catch (e) {
        console.warn("[ingest] google_resolved enqueue failed (non-fatal):", e);
      }
    }

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
