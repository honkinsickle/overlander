"use server";

/**
 * Living-plan NL-edit server actions (dev-gated MVP): the app-side of the
 * proven parse → apply → re-run loop (scripts/living-plan-edit.ts). Called
 * from the ReplanSheet behind the Find Nearby suggestion row.
 *
 * SAFETY RAILS (same as the harness, hard):
 *   - Every action refuses unless the env Supabase ref is TEST
 *     (znldzjdatkogdktymtvi) — dev points there via .env.development.local.
 *   - The live trip id `dawson-vancouver-cassiar` is refused outright.
 *   - NEXT_PUBLIC_LIVING_PLAN_EDIT=1 required server-side too (defense in
 *     depth — prod has neither the flag nor the TEST ref).
 *
 * NOTE (deliberate deviation, surfaced not papered over): these actions
 * write `reference_trips` directly instead of via lib/trips/repository.ts.
 * The repo layer has no reference_trips write path on purpose (service-role
 * only); the dev MVP targets the TEST copy there. Productionization moves
 * this to user-owned public.trips rows through the repository layer.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPersistedReferenceTrip } from "@/lib/trips/reference";
import type { Trip } from "@/lib/trips/types";
import { geocode } from "@/lib/routing/geocode";
import { PlaceResolver } from "./resolve";
import {
  parseEditRequest,
  groundParsedEdit,
  applyEdit,
  type GroundedEdit,
} from "./edit";
import type { Anchor, GenerationInput } from "./facts";
import type { ReplanDiff } from "./plan-diff";

const TEST_REF = "znldzjdatkogdktymtvi";
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]);

type RailsFailure = { ok: false; error: string };

/** Flag + TEST-ref + forbidden-id gate. Every action calls this first. */
function checkRails(tripId: string): RailsFailure | null {
  if (process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT !== "1") {
    return { ok: false, error: "Living-plan editing is not enabled." };
  }
  if (FORBIDDEN_IDS.has(tripId)) {
    return { ok: false, error: "This trip is live and cannot be re-planned." };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  if (ref !== TEST_REF) {
    return {
      ok: false,
      error: `Refusing: Supabase ref is ${ref}, not TEST. Point dev at the TEST project.`,
    };
  }
  return null;
}

/** Load the trip + its persisted GenerationInput, or a typed failure. */
async function loadEditableTrip(
  tripId: string,
): Promise<{ trip: Trip; input: GenerationInput } | RailsFailure> {
  const trip = await getPersistedReferenceTrip(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };
  const input = trip.generationInput as GenerationInput | undefined;
  if (!input?.anchors?.length) {
    return {
      ok: false,
      error: "This trip has no persisted generation input — not editable.",
    };
  }
  return { trip, input };
}

export type ParseReplanResult =
  | {
      ok: true;
      kind: "confirm";
      /** What the parse understood, ready for the confirm sheet. */
      place: string;
      date: string;
      targetAnchor: string;
      resolvedName: string;
      anchorDistanceMi: number | null;
      before: Anchor;
      after: Anchor;
    }
  | { ok: true; kind: "unsupported"; reason: string }
  | RailsFailure;

/**
 * PARSE + GROUND + preview-APPLY (no persist, no generation spend): the
 * confirm sheet's data. Sonnet parse + one Google resolve.
 */
export async function parseReplanAction(
  tripId: string,
  request: string,
): Promise<ParseReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const parsed = await parseEditRequest(request, loaded.input);
    if (parsed.type === "unsupported") {
      return { ok: true, kind: "unsupported", reason: parsed.reason };
    }
    if (parsed.targetAnchor === null) {
      return {
        ok: true,
        kind: "unsupported",
        reason: `"${parsed.place}" doesn't match any stop on this trip — adding new stops isn't supported yet.`,
      };
    }
    const anchorCoords = await geocode(parsed.targetAnchor);
    const grounded = await groundParsedEdit(
      parsed,
      new PlaceResolver(),
      anchorCoords,
      anchorCoords,
    );
    const applied = applyEdit(loaded.input, grounded);
    return {
      ok: true,
      kind: "confirm",
      place: parsed.place,
      date: parsed.date,
      targetAnchor: parsed.targetAnchor,
      resolvedName: grounded.resolved.displayName,
      anchorDistanceMi: grounded.anchorDistanceMi,
      before: applied.before,
      after: applied.after,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Parse failed.",
    };
  }
}

/** Rebuild the grounded edit server-side from the confirmed fields — the
 *  client only ever sends back what the parse action returned. */
async function regroundEdit(
  input: GenerationInput,
  place: string,
  date: string,
  targetAnchor: string,
): Promise<GroundedEdit> {
  const anchorCoords = await geocode(targetAnchor);
  return groundParsedEdit(
    { type: "arrive-by", place, date, targetAnchor },
    new PlaceResolver(),
    anchorCoords,
    anchorCoords,
  );
}

export type ReplanResult =
  | { ok: true; diff: ReplanDiff; pendingId: string }
  | RailsFailure;

const pendingId = (tripId: string) => `${tripId}--pending`;

/**
 * The PAID step: re-run the full pipeline with the pinned anchor and stage
 * the result as `<tripId>--pending` on TEST. Nothing touches the trip row
 * itself until applyReplanAction. Several minutes (Opus generation + audit
 * + bake).
 */
export async function replanAction(
  tripId: string,
  place: string,
  date: string,
  targetAnchor: string,
): Promise<ReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const grounded = await regroundEdit(loaded.input, place, date, targetAnchor);
    const { input: editedInput } = applyEdit(loaded.input, grounded);

    // Same pipeline + quality gate as the proven harness rerun.
    const { preComputeFacts } = await import("./facts");
    const { generateAndAudit } = await import("./generate");
    const { bakeGeneratedDays } = await import("./bake");
    const { itineraryToTrip } = await import("./to-trip");
    const { attachHeroPhotos } = await import("@/lib/imagery/destination-photo");
    const { computePlanDiff } = await import("./plan-diff");

    const facts = await preComputeFacts(editedInput);
    const { audited, report, unresolved, dayRoutes } = await generateAndAudit(
      editedInput,
      facts,
    );

    const gate: string[] = [];
    const fabricated = report.droppedPois.filter((d) => d.poiId.startsWith("mp:"));
    if (fabricated.length > 0) gate.push(`${fabricated.length} fabricated ids`);
    const withOvernight = audited.days.filter(
      (d) => d.overnight.name || d.overnight.desc,
    ).length;
    if (withOvernight / audited.days.length < 0.7)
      gate.push(`overnight coverage ${withOvernight}/${audited.days.length}`);
    if (unresolved) gate.push("unresolved structural violations");
    if (gate.length > 0) {
      return {
        ok: false,
        error: `Re-plan failed the quality gate (nothing was changed): ${gate.join("; ")}`,
      };
    }

    const supabase: SupabaseClient = createSupabaseServiceClient();
    const baked = await bakeGeneratedDays(audited, editedInput, supabase, dayRoutes);
    const rePlanned = await attachHeroPhotos(
      itineraryToTrip(tripId, editedInput, facts, audited, baked),
    );

    const diff = computePlanDiff(loaded.trip.days, rePlanned.days, {
      place: targetAnchor,
      date,
    });

    // Stage — the trip row is untouched until Apply.
    const staged = { ...rePlanned, id: pendingId(tripId) };
    const { error } = await supabase.from("reference_trips").upsert({
      id: pendingId(tripId),
      title: rePlanned.title,
      payload: staged,
      source_version: `livingplan-pending@${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) return { ok: false, error: `Staging failed: ${error.message}` };

    return { ok: true, diff, pendingId: pendingId(tripId) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Re-plan failed.",
    };
  }
}

export type ApplyResult = { ok: true } | RailsFailure;

/** Commit the staged re-plan onto the trip row, then drop the staging row. */
export async function applyReplanAction(tripId: string): Promise<ApplyResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("reference_trips")
    .select("payload")
    .eq("id", pendingId(tripId))
    .single();
  if (error || !data) {
    return { ok: false, error: "No staged re-plan found to apply." };
  }
  const payload = { ...(data.payload as Trip), id: tripId };
  const { error: writeErr } = await supabase.from("reference_trips").upsert({
    id: tripId,
    title: payload.title,
    payload,
    source_version: `livingplan-applied@${new Date().toISOString().slice(0, 10)}`,
  });
  if (writeErr) return { ok: false, error: `Apply failed: ${writeErr.message}` };
  await supabase.from("reference_trips").delete().eq("id", pendingId(tripId));
  return { ok: true };
}

/** Keep original: drop the staged row, trip untouched. */
export async function discardReplanAction(tripId: string): Promise<ApplyResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const supabase = createSupabaseServiceClient();
  await supabase.from("reference_trips").delete().eq("id", pendingId(tripId));
  return { ok: true };
}
