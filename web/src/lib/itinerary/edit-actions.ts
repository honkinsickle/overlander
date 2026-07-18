"use server";

/**
 * Living-plan NL-edit server actions (dev-gated MVP): the app-side of the
 * proven parse → apply → re-run loop (scripts/living-plan-edit.ts). Called
 * from the change-trip composer (and, in Stage 2, its dispatch flow).
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
  applyReschedule,
  applyStayLonger,
  applySkip,
  splitSkipLabels,
  findAnchorIndex,
  ADD_STOP_ABSORB_MI,
  type GroundedEdit,
  type AddStopMode,
} from "./edit";
import {
  cleaveTrip,
  buildTailInput,
  stitchDays,
  stitchPolyline,
  type NowSpec,
  type Cleave,
} from "./partial-replan";
import {
  interpretEdit,
  buildInterpretContext,
  type InterpretResult,
  type ClarifyContext,
} from "./interpret";
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

export type InterpretActionResult =
  | { ok: true; result: InterpretResult }
  | RailsFailure;

/**
 * Open-language intent interpretation (Stage 0/1) — the dedicated change-trip
 * box's front door. Free: one small Sonnet call, no generation, no grounding.
 * Optionally carries a ClarifyContext for the follow-up turn.
 */
export async function interpretEditAction(
  tripId: string,
  text: string,
  clarify?: ClarifyContext,
): Promise<InterpretActionResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const context = buildInterpretContext(loaded.input, loaded.trip.days);
    const result = await interpretEdit(text, context, clarify);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't interpret that.",
    };
  }
}

export type CleaveDisplay =
  | {
      ok: true;
      /** 1-based resume day number. */
      resumeDayNumber: number;
      /** Where you're picking up from (last completed day's end), or the trip
       *  origin when nothing is completed. */
      resumePlace: string;
      resumeDate: string;
      completedCount: number;
      totalDays: number;
      /** True when nothing is completed → a normal whole-trip re-plan. */
      isFullReplan: boolean;
    }
  | RailsFailure;

/**
 * Resolve the "now" cleave for the confirm sheet — free (no routing, no spend,
 * pure day-table math). Date-derived default OR explicit override
 * (atDay / atPlace). Surfaced as "Picking up from Day N — <place>, <date>".
 */
export async function resolveCleaveAction(
  tripId: string,
  now: NowSpec,
): Promise<CleaveDisplay> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const c = cleaveTrip(loaded.trip.days, now);
    return {
      ok: true,
      resumeDayNumber: c.resumeIdx + 1,
      resumePlace: c.syntheticStart?.place ?? loaded.trip.startLocation,
      resumeDate: c.resumeDate,
      completedCount: c.completedDays.length,
      totalDays: loaded.trip.days.length,
      isFullReplan: c.resumeIdx === 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't resolve where you are.",
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
 * Shared PAID step: run the pipeline, quality-gate, bake, diff, and stage as
 * `<tripId>--pending` carrying `signature`. The trip row is never touched
 * here — only applyReplanAction promotes it.
 *
 * When `partial` is set, this is a Google-Maps-recalculate scoped to AHEAD:
 * only the tail (buildTailInput) is regenerated, then stitched onto the frozen
 * completed prefix (days + route polyline), and the diff is scoped to the tail.
 * When absent, the whole `editedInput` is regenerated (original behavior).
 */
async function runGateStage(
  tripId: string,
  editedInput: GenerationInput,
  beforeDays: Trip["days"],
  diffMeta: { place: string; date: string },
  signature: string,
  partial?: { cleave: Cleave; original: Trip },
): Promise<{ ok: true; diff: ReplanDiff } | RailsFailure> {
  const { preComputeFacts } = await import("./facts");
  const { generateAndAudit } = await import("./generate");
  const { bakeGeneratedDays } = await import("./bake");
  const { itineraryToTrip, concatDayRouteCoords } = await import("./to-trip");
  const { attachHeroPhotos } = await import("@/lib/imagery/destination-photo");
  const { computePlanDiff } = await import("./plan-diff");
  const { encodePolyline } = await import("@/lib/routing/polyline");
  const { decodePolyline } = await import("@/lib/routing/point-to-polyline");

  // Partial → generate only the tail; else the full edited input.
  const runInput = partial ? buildTailInput(editedInput, partial.cleave) : editedInput;

  const facts = await preComputeFacts(runInput);
  const { audited, report, unresolved, dayRoutes } = await generateAndAudit(
    runInput,
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
  const baked = await bakeGeneratedDays(audited, runInput, supabase, dayRoutes);
  const generated = await attachHeroPhotos(
    itineraryToTrip(tripId, runInput, facts, audited, baked, dayRoutes),
  );

  let finalTrip = generated;
  if (partial) {
    // Stitch: frozen prefix (verbatim) + recalculated tail.
    const stitchedDays = stitchDays(partial.cleave.completedDays, generated.days);
    // Route: truncate the stored polyline at the resume point, graft the tail.
    const resumeCoords =
      generated.days[0]?.startCoord ?? partial.original.startCoords;
    let stitchedPolyline = generated.routePolyline;
    if (partial.original.routePolyline && resumeCoords) {
      const full = decodePolyline(partial.original.routePolyline);
      const tailCoords = concatDayRouteCoords(dayRoutes);
      stitchedPolyline = encodePolyline(
        stitchPolyline(full, resumeCoords, tailCoords),
      );
    }
    finalTrip = {
      ...generated,
      // Restore the whole-trip head (the tail run's start was the synthetic
      // "now" anchor; the persisted trip still begins at the real origin).
      title: partial.original.title,
      startDate: partial.original.startDate,
      startLocation: partial.original.startLocation,
      startCoords: partial.original.startCoords,
      endDate: editedInput.params.endDate ?? generated.endDate,
      days: stitchedDays,
      routePolyline: stitchedPolyline,
      // Persist the FULL edited input (whole anchor set) + the cleave marker,
      // so the next edit sees the complete trip and re-cleaves from the new now.
      generationInput: {
        ...editedInput,
        completedThrough: {
          dayNumber: partial.cleave.resumeIdx,
          date: partial.cleave.resumeDate,
          endPlace: partial.cleave.syntheticStart?.place ?? null,
        },
      } as unknown as Record<string, unknown>,
    };
  }

  const diff = computePlanDiff(beforeDays, generated.days, diffMeta);

  const staged = {
    ...finalTrip,
    id: pendingId(tripId),
    livingPlanEditSignature: signature,
  };
  const { error } = await supabase.from("reference_trips").upsert({
    id: pendingId(tripId),
    title: finalTrip.title,
    payload: staged,
    source_version: `livingplan-pending@${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) return { ok: false, error: `Staging failed: ${error.message}` };
  return { ok: true, diff };
}

/** Resolve the cleave for a paid run: when `now` is set and something is
 *  completed, returns the partial context (frozen prefix + original) and the
 *  tail-before slice for a tail-scoped diff. Otherwise a whole-trip run. */
function partialContext(
  trip: Trip,
  now?: NowSpec,
): { partial?: { cleave: Cleave; original: Trip }; beforeDays: Trip["days"]; cleave?: Cleave } {
  if (!now) return { beforeDays: trip.days };
  const cleave = cleaveTrip(trip.days, now);
  if (cleave.resumeIdx === 0) return { beforeDays: trip.days, cleave }; // nothing done → full
  return {
    partial: { cleave, original: trip },
    beforeDays: trip.days.slice(cleave.resumeIdx),
    cleave,
  };
}

/**
 * The PAID step for arrive-by: re-run with the pinned anchor, stage as pending.
 * When `now` marks a trip in progress, only the tail is re-planned.
 */
export async function replanAction(
  tripId: string,
  place: string,
  date: string,
  targetAnchor: string,
  now?: NowSpec,
): Promise<ReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const ctx = partialContext(loaded.trip, now);
    // Edit-in-future guard: can't pin a date that's already passed.
    if (ctx.cleave && date < ctx.cleave.resumeDate) {
      return { ok: false, error: `${date} has already passed — you can only change the road ahead.` };
    }
    const grounded = await regroundEdit(loaded.input, place, date, targetAnchor);
    const { input: editedInput } = applyEdit(loaded.input, grounded);
    const signature = editSignature(["arrive-by", targetAnchor, date, now ? "partial" : "full"]);
    const staged = await runGateStage(
      tripId,
      editedInput,
      ctx.beforeDays,
      { place: targetAnchor, date },
      signature,
      ctx.partial,
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
  now?: NowSpec,
): Promise<ReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const { routeBetween } = await import("@/lib/routing/route-between");
    const { alongRouteMiles } = await import("@/lib/routing/point-to-polyline");
    const { geocode } = await import("@/lib/routing/geocode");

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

    const ctx = partialContext(loaded.trip, now);
    // Edit-in-future guard (geometry): the new stop must sit AHEAD of the
    // resume point along the route — you can't add a stop you've driven past.
    if (ctx.cleave && ctx.partial) {
      const resumeCoords = await geocode(ctx.cleave.syntheticStart!.place);
      const resumeAlong =
        alongRouteMiles(resumeCoords, baseRoute.coordinates)?.miles ?? 0;
      if (newAlong.miles < resumeAlong) {
        return {
          ok: false,
          error: `${resolved.place.displayName} is behind you now — you can only add stops on the road ahead.`,
        };
      }
    }

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
    const signature = editSignature(["add-stop", place, mode, now ? "partial" : "full"]);
    const endDate = newEndDate ?? loaded.input.params.endDate ?? "";
    const staged = await runGateStage(
      tripId,
      editedInput,
      ctx.beforeDays,
      { place: resolved.place.displayName, date: endDate },
      signature,
      ctx.partial,
    );
    if (!staged.ok) return staged;
    return { ok: true, diff: staged.diff, editSignature: signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add-stop failed." };
  }
}

/** Resolve a place → coords + its inferred insert position on the route. */
async function resolveInsert(
  input: GenerationInput,
  place: string,
): Promise<{ coords: [number, number]; displayName: string; insertAt: number }> {
  const { routeBetween } = await import("@/lib/routing/route-between");
  const { alongRouteMiles } = await import("@/lib/routing/point-to-polyline");
  const coordsList = await anchorCoords(input);
  const resolved = await new PlaceResolver().resolve(place, coordsList[0]);
  if (resolved.status !== "resolved") {
    throw new Error(`Couldn't find "${place}" (${resolved.status}).`);
  }
  const route = await routeBetween(coordsList);
  const anchorMiles = coordsList.map(
    (c) => (alongRouteMiles(c, route.coordinates) ?? { miles: 0 }).miles,
  );
  const newAlong = alongRouteMiles(resolved.place.coords, route.coordinates) ?? {
    miles: 0,
    offsetMi: 0,
  };
  const pos = inferAddStopPosition(input.anchors, anchorMiles, newAlong);
  return { coords: resolved.place.coords, displayName: resolved.place.displayName, insertAt: pos.insertAt };
}

/** The interpreted edit the composer dispatches. */
export type EditPayload = {
  type: "arrive-by" | "add-stop" | "reschedule" | "skip" | "stay-longer" | "change-end";
  place: string | null;
  date: string | null;
  dwell: number | null;
  nights: number | null;
};

/**
 * DISPATCH (Stage 2): the composer's confirmed interpretation → the right
 * anchor-set mutation → the SAME runGateStage → stage as pending. Reuses the
 * proven diff/apply flow wholesale (applyReplanAction promotes with the
 * editSignature guard). Partial when `now` marks a trip in progress.
 */
export async function executeEditAction(
  tripId: string,
  edit: EditPayload,
  now?: NowSpec,
): Promise<ReplanResult> {
  const railFail = checkRails(tripId);
  if (railFail) return railFail;
  const loaded = await loadEditableTrip(tripId);
  if ("ok" in loaded) return loaded;

  try {
    const ctx = partialContext(loaded.trip, now);
    const resumeDate = ctx.cleave?.resumeDate;

    let editedInput: GenerationInput;
    let signature: string;
    let diffMeta: { place: string; date: string };

    switch (edit.type) {
      case "reschedule": {
        if (!edit.place || !edit.date) return { ok: false, error: "Reschedule needs a place and a date." };
        if (resumeDate && edit.date < resumeDate)
          return { ok: false, error: `${edit.date} has already passed.` };
        const idx = findAnchorIndex(loaded.input.anchors, edit.place);
        let coords: [number, number] = [0, 0];
        let insertAt = 1;
        let name = edit.place;
        if (idx === -1) {
          const r = await resolveInsert(loaded.input, edit.place);
          coords = r.coords; insertAt = r.insertAt; name = r.displayName;
        }
        editedInput = applyReschedule(loaded.input, name, coords, edit.date, insertAt).input;
        signature = editSignature(["reschedule", edit.place, edit.date, now ? "partial" : "full"]);
        diffMeta = { place: name, date: edit.date };
        break;
      }
      case "stay-longer": {
        if (!edit.place) return { ok: false, error: "Stay-longer needs a place." };
        const nights = edit.nights ?? 1;
        const idx = findAnchorIndex(loaded.input.anchors, edit.place);
        let coords: [number, number] = [0, 0];
        let insertAt = 1;
        let name = edit.place;
        if (idx === -1) {
          const r = await resolveInsert(loaded.input, edit.place);
          coords = r.coords; insertAt = r.insertAt; name = r.displayName;
        }
        editedInput = applyStayLonger(loaded.input, name, coords, nights, insertAt).input;
        signature = editSignature(["stay-longer", edit.place, String(nights), now ? "partial" : "full"]);
        diffMeta = { place: name, date: loaded.input.params.endDate ?? "" };
        break;
      }
      case "skip": {
        if (!edit.place) return { ok: false, error: "Skip needs a place." };
        const labels = splitSkipLabels(edit.place);
        editedInput = applySkip(loaded.input, labels).input;
        signature = editSignature(["skip", edit.place, now ? "partial" : "full"]);
        diffMeta = { place: labels.join(" · "), date: loaded.input.params.endDate ?? "" };
        break;
      }
      case "change-end": {
        if (!edit.date) return { ok: false, error: "Change-end needs a date." };
        const next = structuredClone(loaded.input);
        const end = next.anchors[next.anchors.length - 1];
        end.datePin = "fixed";
        end.date = edit.date;
        next.params.endDate = edit.date;
        editedInput = next;
        signature = editSignature(["change-end", edit.date, now ? "partial" : "full"]);
        diffMeta = { place: end.place, date: edit.date };
        break;
      }
      case "arrive-by": {
        if (!edit.place || !edit.date) return { ok: false, error: "Arrive-by needs a place and a date." };
        if (resumeDate && edit.date < resumeDate)
          return { ok: false, error: `${edit.date} has already passed.` };
        // Reuse the reschedule mutation (pin an existing anchor / insert one).
        const idx = findAnchorIndex(loaded.input.anchors, edit.place);
        let coords: [number, number] = [0, 0];
        let insertAt = 1;
        let name = edit.place;
        if (idx === -1) {
          const r = await resolveInsert(loaded.input, edit.place);
          coords = r.coords; insertAt = r.insertAt; name = r.displayName;
        }
        editedInput = applyReschedule(loaded.input, name, coords, edit.date, insertAt).input;
        signature = editSignature(["arrive-by", edit.place, edit.date, now ? "partial" : "full"]);
        diffMeta = { place: name, date: edit.date };
        break;
      }
      case "add-stop": {
        // add-stop keeps its own two-mode flow via addStopAction; the composer
        // routes there directly. This dispatch shouldn't receive it.
        return { ok: false, error: "add-stop is handled by its own two-mode flow." };
      }
      default:
        return { ok: false, error: `Unsupported edit type: ${edit.type}` };
    }

    const staged = await runGateStage(tripId, editedInput, ctx.beforeDays, diffMeta, signature, ctx.partial);
    if (!staged.ok) return staged;
    return { ok: true, diff: staged.diff, editSignature: signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Edit failed." };
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
