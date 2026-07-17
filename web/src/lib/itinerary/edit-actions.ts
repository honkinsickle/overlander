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
  inferAddStopPosition,
  applyAddStop,
  ADD_STOP_ABSORB_MI,
  type GroundedEdit,
  type AddStopMode,
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
  | {
      ok: true;
      kind: "add-stop";
      place: string;
      resolvedName: string;
      dwell: number;
      /** Inferred sequence position — which two stops it slots between. */
      prevAnchor: string;
      nextAnchor: string;
      alongMiles: number;
      offsetMi: number;
      /** True → offset over threshold; UI must confirm ("far off route"). */
      farOffRoute: boolean;
      /** Detour cost of re-routing through the new stop. */
      addedMi: number;
      addedHours: number;
      /** True → adding it needs room; offer the two-mode choice. False →
       *  absorbs into an existing day, no choice. */
      needsChoice: boolean;
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
    if (parsed.type === "add-stop") {
      return await previewAddStop(loaded.input, parsed.place, parsed.dwell);
    }
    if (parsed.targetAnchor === null) {
      return {
        ok: true,
        kind: "unsupported",
        reason: `"${parsed.place}" doesn't match any stop on this trip. Try "add ${parsed.place}" to add it as a new stop.`,
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
  | { ok: true; diff: ReplanDiff; editSignature: string }
  | RailsFailure;

const pendingId = (tripId: string) => `${tripId}--pending`;

/** A stable fingerprint of the confirmed edit. Stored on the staged pending
 *  row and re-checked at apply time so a stale/foreign pending row can never
 *  be silently promoted onto the trip (the latent bug behind the unexplained
 *  22:26 write). */
function editSignature(parts: string[]): string {
  return parts.join("|");
}

/** Resolve every anchor to coords (picked coords win; geocode the label
 *  otherwise) — the base for routing + along-route projection. */
async function anchorCoords(input: GenerationInput): Promise<[number, number][]> {
  return Promise.all(
    input.anchors.map(async (a) =>
      a.coords ? a.coords : ((await geocode(a.place)) as [number, number]),
    ),
  );
}

/**
 * Cheap, no-spend preview for "add <place>": resolve the place, infer its
 * route position, price the detour, and classify whether it needs the
 * two-mode choice. Only routing + one resolve — no generation.
 */
async function previewAddStop(
  input: GenerationInput,
  place: string,
  dwell: number,
): Promise<ParseReplanResult> {
  const { routeBetween } = await import("@/lib/routing/route-between");
  const { alongRouteMiles } = await import("@/lib/routing/point-to-polyline");

  const coords = await anchorCoords(input);
  const resolved = await new PlaceResolver().resolve(place, coords[0]);
  if (resolved.status !== "resolved") {
    return {
      ok: true,
      kind: "unsupported",
      reason: `Couldn't find "${place}" (${resolved.status}).`,
    };
  }
  const newCoords = resolved.place.coords;

  const baseRoute = await routeBetween(coords);
  const alongOf = (c: [number, number]) =>
    alongRouteMiles(c, baseRoute.coordinates) ?? { miles: 0, offsetMi: 0 };
  const anchorMiles = coords.map((c) => alongOf(c).miles);
  const pos = inferAddStopPosition(input.anchors, anchorMiles, alongOf(newCoords));

  // Detour cost: re-route through the inserted point.
  const withCoords = [
    ...coords.slice(0, pos.insertAt),
    newCoords,
    ...coords.slice(pos.insertAt),
  ];
  const detour = await routeBetween(withCoords);
  const M = 1609.34;
  const addedMi = Math.round((detour.distanceM - baseRoute.distanceM) / M);
  const addedHours =
    Math.round(((detour.durationS - baseRoute.durationS) / 3600) * 10) / 10;

  // A dwell (a whole night) always needs room; otherwise the detour needs the
  // choice only when it's more than a day can quietly absorb.
  const needsChoice = dwell > 0 || addedMi > ADD_STOP_ABSORB_MI;

  return {
    ok: true,
    kind: "add-stop",
    place,
    resolvedName: resolved.place.displayName,
    dwell,
    prevAnchor: pos.prevAnchor,
    nextAnchor: pos.nextAnchor,
    alongMiles: pos.alongMiles,
    offsetMi: pos.offsetMi,
    farOffRoute: pos.farOffRoute,
    addedMi,
    addedHours,
    needsChoice,
  };
}

/**
 * Shared PAID tail: run the pipeline on `editedInput`, quality-gate, bake,
 * diff vs `beforeDays`, and stage as `<tripId>--pending` carrying `signature`.
 * The trip row is never touched here — only applyReplanAction promotes it.
 */
async function runGateStage(
  tripId: string,
  editedInput: GenerationInput,
  beforeDays: Trip["days"],
  diffMeta: { place: string; date: string },
  signature: string,
): Promise<{ ok: true; diff: ReplanDiff } | RailsFailure> {
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
    itineraryToTrip(tripId, editedInput, facts, audited, baked, dayRoutes),
  );
  const diff = computePlanDiff(beforeDays, rePlanned.days, diffMeta);

  const staged = {
    ...rePlanned,
    id: pendingId(tripId),
    livingPlanEditSignature: signature,
  };
  const { error } = await supabase.from("reference_trips").upsert({
    id: pendingId(tripId),
    title: rePlanned.title,
    payload: staged,
    source_version: `livingplan-pending@${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) return { ok: false, error: `Staging failed: ${error.message}` };
  return { ok: true, diff };
}

/**
 * The PAID step for arrive-by: re-run with the pinned anchor, stage as pending.
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
    const signature = editSignature(["arrive-by", targetAnchor, date]);
    const staged = await runGateStage(
      tripId,
      editedInput,
      loaded.trip.days,
      { place: targetAnchor, date },
      signature,
    );
    if (!staged.ok) return staged;
    return { ok: true, diff: staged.diff, editSignature: signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Re-plan failed." };
  }
}

/**
 * The PAID step for add-stop: insert the new waypoint under the chosen mode
 * ("adjust" = fixed dates, compress; "add-days" = end +1, headroom), re-run,
 * stage as pending. Position is re-inferred server-side (client never sends
 * a route position).
 */
export async function addStopAction(
  tripId: string,
  place: string,
  mode: AddStopMode,
): Promise<ReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const { routeBetween } = await import("@/lib/routing/route-between");
    const { alongRouteMiles } = await import("@/lib/routing/point-to-polyline");

    const coords = await anchorCoords(loaded.input);
    const resolved = await new PlaceResolver().resolve(place, coords[0]);
    if (resolved.status !== "resolved") {
      return { ok: false, error: `Couldn't find "${place}" (${resolved.status}).` };
    }
    const newCoords = resolved.place.coords;
    const baseRoute = await routeBetween(coords);
    const anchorMiles = coords.map(
      (c) => (alongRouteMiles(c, baseRoute.coordinates) ?? { miles: 0 }).miles,
    );
    const newAlong = alongRouteMiles(newCoords, baseRoute.coordinates) ?? {
      miles: 0,
      offsetMi: 0,
    };
    const pos = inferAddStopPosition(loaded.input.anchors, anchorMiles, newAlong);

    // dwell isn't re-parsed here — the confirm sheet already captured it; the
    // MVP re-infers position but treats dwell as 0 (a plain visit). A dwelled
    // add would thread dwell through the action args; deferred.
    const { input: editedInput, newEndDate } = applyAddStop(
      loaded.input,
      resolved.place.displayName,
      newCoords,
      0,
      pos.insertAt,
      mode,
    );
    const signature = editSignature(["add-stop", place, mode]);
    const endDate = newEndDate ?? loaded.input.params.endDate ?? "";
    const staged = await runGateStage(
      tripId,
      editedInput,
      loaded.trip.days,
      { place: resolved.place.displayName, date: endDate },
      signature,
    );
    if (!staged.ok) return staged;
    return { ok: true, diff: staged.diff, editSignature: signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add-stop failed." };
  }
}

export type ApplyResult = { ok: true } | RailsFailure;

/**
 * Commit the staged re-plan onto the trip row, then drop the staging row.
 * GUARD: the staged row must carry the SAME edit signature the caller
 * confirmed — otherwise a stale/foreign pending row is refused (never
 * silently promoted). This is the fix for the class of unintended writes.
 */
export async function applyReplanAction(
  tripId: string,
  expectedSignature: string,
): Promise<ApplyResult> {
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
  const stagedPayload = data.payload as Trip & { livingPlanEditSignature?: string };
  if (stagedPayload.livingPlanEditSignature !== expectedSignature) {
    return {
      ok: false,
      error:
        "The staged re-plan doesn't match the change you confirmed — refusing to apply. Re-run the change.",
    };
  }
  // Strip the staging-only marker before it lands on the trip row.
  const { livingPlanEditSignature: _sig, ...clean } = stagedPayload;
  const payload = { ...clean, id: tripId };
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
