/**
 * Living-plan INTENT INTERPRETER (Stage 0 prototype) — the widening of
 * parseEditRequest from "recognize a few verb shapes" to "understand open
 * natural language." ONE Sonnet call reads free text against the trip and
 * returns a discriminated intent: an edit (with params + any position/now
 * hints), a single clarifying question, or unsupported. The per-type
 * executors (arrive-by / add-stop / reschedule / skip / stay-longer /
 * change-end) are deterministic downstream steps this dispatches to — this is
 * ONE interpreter → N executors, not a router above N parsers.
 *
 * Parse-only: no generation, no grounding, no spend beyond the one small call.
 * The strict schema is tiny (nowhere near the itinerary grammar ceiling).
 */

import { ItineraryGenerationError } from "./generate";
import type { GenerationInput } from "./facts";
import type { Day } from "@/lib/trips/types";

const MODEL = "claude-sonnet-5";

export type EditType =
  | "arrive-by"
  | "add-stop"
  | "reschedule"
  | "skip"
  | "stay-longer"
  | "change-end";

export type InterpretResult =
  | {
      kind: "edit";
      type: EditType;
      /** The place the edit targets or adds (as named). */
      place: string | null;
      /** ISO date, relative dates resolved against the trip window. */
      date: string | null;
      /** EXACT anchor string when the edit binds to an existing anchor. */
      targetAnchor: string | null;
      /** add-stop nights (0 = pass-through visit). */
      dwell: number | null;
      /** stay-longer extra nights. */
      nights: number | null;
      /** add-stop position hint the user stated ("between PG and Vancouver"). */
      betweenStart: string | null;
      betweenEnd: string | null;
      /** Position/now extraction: a named place ("I'm at Stewart") … */
      nowPlace: string | null;
      /** … or "from here" / "where I am now" (resolve to current position). */
      fromHere: boolean;
      /** Human-readable echo of a FUZZY reading, for the confirm sheet to show
       *  before spending ("an extra day around Smithers"). Null when literal. */
      interpretation: string | null;
    }
  | { kind: "clarify"; question: string; partial: string | null }
  | { kind: "unsupported"; reason: string };

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["edit", "clarify", "unsupported"] },
    // Allowed values enforced by the prompt + validated in code — a nullable
    // field can't carry an enum in the strict-schema compiler.
    type: { type: ["string", "null"] },
    place: { type: ["string", "null"] },
    date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    targetAnchor: { type: ["string", "null"] },
    dwell: { type: ["integer", "null"] },
    nights: { type: ["integer", "null"] },
    betweenStart: { type: ["string", "null"] },
    betweenEnd: { type: ["string", "null"] },
    nowPlace: { type: ["string", "null"] },
    fromHere: { type: "boolean" },
    interpretation: { type: ["string", "null"] },
    question: { type: ["string", "null"] },
    partial: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
  required: [
    "kind", "type", "place", "date", "targetAnchor", "dwell", "nights",
    "betweenStart", "betweenEnd", "nowPlace", "fromHere", "interpretation",
    "question", "partial", "reason",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You interpret a traveler's free-text request to change their road trip into ONE structured intent. You are the INTENT layer; concrete grounding (geocoding, routing, scheduling) happens downstream — your job is to read WHAT they want and flag when you can't.

Edit types:
- "arrive-by": be at an EXISTING anchor/stop by a date. place + date; targetAnchor = the exact anchor string.
- "add-stop": add a NEW place not currently on the trip. place; dwell = nights (0 = just visit). If they state a position ("between X and Y"), set betweenStart/betweenEnd; otherwise leave null (position is inferred downstream).
- "reschedule": move WHEN they're at an existing place (anchor OR a day-stop) to a date. place + date. If no date is given, you CANNOT reschedule — emit clarify "Reschedule <place> to when?".
- "skip": drop existing stop(s). place = ONLY the concrete place name(s), comma-separated — NO prose, NO parentheticals. Put any descriptive reading ("the interior stretch between X and Y") in "interpretation", never in "place".
- "stay-longer": add nights at an existing place. place + nights (default 1 for "a day"/"longer").
- "change-end": move the trip's end date (earlier/later). place = the end place; date = the new end date (resolve "a day earlier" against the current end).

Position / now extraction (any type): if they say "from here" / "where I am now", set fromHere=true. If they name their current location ("I'm at Stewart"), set nowPlace. These are hints for partial re-planning downstream.

FUZZY references — PROPOSE FIRST, ask only when truly stuck: if a place/stretch is vague ("the mountains", "the boring middle", "somewhere cool"), and you have a CONFIDENT single best read from the trip context, emit the EDIT with your concrete reading in "interpretation" (e.g. "skip Green Lake → Marble Canyon, the Cariboo interior", "an extra day around Smithers"). The confirm step shows this reading so the user can correct it — the proposal IS the confirmation, so make the call. Only emit clarify when it's a GENUINE multi-way fork with no clear winner (e.g. three equally-plausible mountain stretches). Propose-when-confident; ask-when-truly-ambiguous.

CLARIFY: use ONLY when (a) a REQUIRED param is missing and cannot be reasonably inferred (a reschedule with no date), or (b) a fuzzy reference is a genuine multi-way fork with no confident winner. Emit kind="clarify" with ONE short question (the single most-blocking gap) and a "partial" note of what you understood. Ask ONE thing, not a batch. Prefer a proposal with "interpretation" over a question whenever you can make a confident call.

UNSUPPORTED: if it isn't a trip change at all, kind="unsupported" with a short reason.

Always resolve relative dates against the trip window. Set every unused field to null (fromHere defaults false).`;

/** Build the trip-context block the interpreter grounds against. */
export function buildInterpretContext(input: GenerationInput, days: Day[]): string {
  const anchorLines = input.anchors.map(
    (a) => `  - "${a.place}" (${a.role}, ${a.datePin}${a.date ? " " + a.date : ""}, dwell ${a.dwell})`,
  );
  const dayLines = days.map((d) => `  d${d.dayNumber} ${d.date}: ${d.label}`);
  return [
    `Trip window: ${input.params.startDate} → ${input.params.endDate ?? "open"}`,
    "Anchors (the fixed skeleton):",
    ...anchorLines,
    "Days (the generated plan — most are pacing choices, not anchors):",
    ...dayLines,
  ].join("\n");
}

export type ClarifyContext = {
  originalText: string;
  turns: { question: string; answer: string }[];
};

export async function interpretEdit(
  text: string,
  context: string,
  clarify?: ClarifyContext,
): Promise<InterpretResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ItineraryGenerationError("ANTHROPIC_API_KEY is not set.", "missing_key");
  }
  const sdkSpecifier = "@anthropic-ai/sdk";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any;
  try {
    Anthropic = (await import(sdkSpecifier)).default;
  } catch {
    throw new ItineraryGenerationError("@anthropic-ai/sdk not installed.", "missing_sdk");
  }
  const client = new Anthropic();

  const clarifyBlock = clarify
    ? [
        "",
        `This is a follow-up. Original request: "${clarify.originalText}"`,
        ...clarify.turns.map((t) => `You asked: "${t.question}" — they answered: "${t.answer}"`),
        "Now produce the COMPLETE intent (do not ask the same thing again).",
      ].join("\n")
    : "";

  const userMessage = [
    context,
    "",
    `Request: "${text}"`,
    clarifyBlock,
  ].join("\n");

  let message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    throw new ItineraryGenerationError(
      `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
      "api_error",
    );
  }

  const raw = JSON.parse(
    message.content?.find((b: { type: string }) => b.type === "text")?.text ?? "{}",
  );

  if (raw.kind === "clarify") {
    return { kind: "clarify", question: raw.question ?? "Could you clarify?", partial: raw.partial ?? null };
  }
  if (raw.kind === "unsupported") {
    return { kind: "unsupported", reason: raw.reason ?? "Not a trip change." };
  }
  return {
    kind: "edit",
    type: raw.type,
    place: raw.place ?? null,
    date: raw.date ?? null,
    targetAnchor: raw.targetAnchor ?? null,
    dwell: raw.dwell ?? null,
    nights: raw.nights ?? null,
    betweenStart: raw.betweenStart ?? null,
    betweenEnd: raw.betweenEnd ?? null,
    nowPlace: raw.nowPlace ?? null,
    fromHere: raw.fromHere ?? false,
    interpretation: raw.interpretation ?? null,
  };
}
