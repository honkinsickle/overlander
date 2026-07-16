/**
 * Living-plan NL editing (Stage 3 MVP): parse a natural-language steering
 * request against a trip's persisted `GenerationInput`, ground the named
 * place, and apply it as an ANCHOR EDIT. The edited input then re-runs the
 * EXISTING pipeline (preComputeFacts → generateAndAudit → bakeGeneratedDays
 * → persist) — this module never touches generation itself, so the strict
 * itinerary schema (at the grammar ceiling) is untouched; the parse uses its
 * own tiny schema.
 *
 *   "arrive at Salmon Glacier on the 19th"
 *     → PARSE  { type:"arrive-by", place:"Salmon Glacier", date:"2026-07-19",
 *                targetAnchor:"Stewart, British Columbia" }
 *     → GROUND place via PlaceResolver (Google, trip-biased) + sanity-check
 *       the place actually sits near the target anchor
 *     → APPLY  target anchor: datePin flexible → fixed <date>
 */

import type { Anchor, GenerationInput } from "./facts";
import type { PlaceResolver, ResolvedName } from "./resolve";
import { ItineraryGenerationError } from "./generate";

/** Small + fast — parsing one sentence into a typed edit, not reasoning. */
const PARSE_MODEL = "claude-sonnet-5";

export type ParsedEdit =
  | {
      type: "arrive-by";
      /** The place as the user named it (may not be an anchor — e.g. Salmon
       *  Glacier is the Stewart anchor's excursion). */
      place: string;
      /** ISO date resolved against the trip window ("the 19th" → 2026-07-19). */
      date: string;
      /** EXACT `place` string of the anchor this edit binds to, or null when
       *  no existing anchor covers the request. */
      targetAnchor: string | null;
    }
  | { type: "unsupported"; reason: string };

/** Flat wire shape — the union is narrowed in code after validation. */
const PARSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["arrive-by", "unsupported"] },
    place: { type: ["string", "null"] },
    date: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    },
    targetAnchor: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
  required: ["type", "place", "date", "targetAnchor", "reason"],
  additionalProperties: false,
} as const;

function anchorLine(a: Anchor): string {
  const date =
    a.datePin === "flexible" ? "flexible" : `${a.datePin} ${a.date ?? "?"}`;
  return `- "${a.place}" (${a.role}, ${date}, dwell ${a.dwell}${a.note ? `) — ${a.note}` : ")"}`;
}

const PARSE_SYSTEM = `You parse a traveler's natural-language steering request against their road-trip plan into ONE structured edit.

Rules:
- "arrive-by": the traveler wants to BE at a place by/on a date. Emit the place as they named it, the date as ISO (resolve relative dates like "the 19th" against the trip window), and targetAnchor = the EXACT place string of the one anchor the request binds to.
- A request may name a place that is not itself an anchor but belongs to one (an excursion or note on an anchor) — bind it to that anchor.
- targetAnchor must be copied VERBATIM from the anchor list, or null if no anchor covers the request's place.
- If the request is not an arrive-by edit (or is ambiguous beyond guessing), emit type "unsupported" with a short reason.
- Set unused fields to null.`;

/**
 * Parse one NL request into a typed edit. LLM call (PARSE_MODEL) with a tiny
 * strict schema; the trip's anchors + window are the grounding context.
 */
export async function parseEditRequest(
  request: string,
  input: GenerationInput,
): Promise<ParsedEdit> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ItineraryGenerationError(
      "ANTHROPIC_API_KEY is not set — required to parse edit requests.",
      "missing_key",
    );
  }
  // Same dynamic-import rationale as generate.ts: keep the SDK out of the
  // static build graph.
  const sdkSpecifier = "@anthropic-ai/sdk";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any;
  try {
    Anthropic = (await import(sdkSpecifier)).default;
  } catch {
    throw new ItineraryGenerationError(
      "@anthropic-ai/sdk is not installed — run `npm install -w web @anthropic-ai/sdk`.",
      "missing_sdk",
    );
  }
  const client = new Anthropic();

  const userMessage = [
    `Trip window: ${input.params.startDate} → ${input.params.endDate ?? "open-ended"}`,
    "Anchors:",
    ...input.anchors.map(anchorLine),
    "",
    `Request: "${request}"`,
  ].join("\n");

  let message;
  try {
    message = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: 1024,
      output_config: {
        format: { type: "json_schema", schema: PARSE_SCHEMA },
      },
      system: PARSE_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    throw new ItineraryGenerationError(
      `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
      "api_error",
    );
  }

  const text = message.content?.find(
    (b: { type: string }) => b.type === "text",
  )?.text;
  if (!text) {
    throw new ItineraryGenerationError(
      "Parse returned no text block.",
      "bad_output",
    );
  }
  const raw = JSON.parse(text) as {
    type: "arrive-by" | "unsupported";
    place: string | null;
    date: string | null;
    targetAnchor: string | null;
    reason: string | null;
  };

  if (raw.type === "unsupported") {
    return { type: "unsupported", reason: raw.reason ?? "unsupported request" };
  }
  if (!raw.place || !raw.date) {
    throw new ItineraryGenerationError(
      `Parse emitted arrive-by with missing place/date: ${text}`,
      "bad_output",
    );
  }
  if (
    raw.targetAnchor !== null &&
    !input.anchors.some((a) => a.place === raw.targetAnchor)
  ) {
    throw new ItineraryGenerationError(
      `Parse targetAnchor "${raw.targetAnchor}" is not an anchor place.`,
      "bad_output",
    );
  }
  return {
    type: "arrive-by",
    place: raw.place,
    date: raw.date,
    targetAnchor: raw.targetAnchor,
  };
}

export type GroundedEdit = {
  edit: Extract<ParsedEdit, { type: "arrive-by" }>;
  /** The request's place, grounded via Google (real place_id + coords). */
  resolved: ResolvedName;
  /** Straight-line miles from the resolved place to the target anchor —
   *  the "did we bind to the right anchor?" sanity signal. */
  anchorDistanceMi: number | null;
};

function haversineMi(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Ground the parsed place with the shared resolver and, when the edit bound
 * to an anchor, measure how far the place sits from it (caller decides what
 * distance is suspicious — an excursion like Salmon Glacier↔Stewart is ~15mi;
 * a mis-bind across the route would be hundreds).
 */
export async function groundParsedEdit(
  edit: Extract<ParsedEdit, { type: "arrive-by" }>,
  resolver: PlaceResolver,
  /** Bias for the text search — trip route centroid or start. */
  biasCoords: [number, number],
  /** `[lng,lat]` of the target anchor when known (geocoded by the caller). */
  targetAnchorCoords?: [number, number],
): Promise<GroundedEdit> {
  const r = await resolver.resolve(edit.place, biasCoords);
  if (r.status !== "resolved") {
    throw new ItineraryGenerationError(
      `Could not ground "${edit.place}" (${r.status}).`,
      "bad_output",
    );
  }
  return {
    edit,
    resolved: r.place,
    anchorDistanceMi: targetAnchorCoords
      ? Math.round(haversineMi(r.place.coords, targetAnchorCoords) * 10) / 10
      : null,
  };
}

export type AppliedEdit = {
  /** Deep-copied input with the edit applied — ready for preComputeFacts. */
  input: GenerationInput;
  before: Anchor;
  after: Anchor;
};

/**
 * Apply an arrive-by edit as an anchor mutation: pin the target anchor's
 * date (datePin → "fixed"). Pure — returns a new GenerationInput.
 */
export function applyEdit(
  input: GenerationInput,
  grounded: GroundedEdit,
): AppliedEdit {
  const { edit } = grounded;
  if (edit.targetAnchor === null) {
    // MVP scope: edits must bind to an existing anchor. Inserting NEW anchors
    // (a place the plan never visited) is a later, bigger move — it changes
    // the route, not just the schedule.
    throw new ItineraryGenerationError(
      `"${edit.place}" doesn't bind to any existing anchor — inserting new anchors is not supported yet.`,
      "bad_output",
    );
  }
  const idx = input.anchors.findIndex((a) => a.place === edit.targetAnchor);
  if (idx === -1) {
    throw new ItineraryGenerationError(
      `Target anchor "${edit.targetAnchor}" not found.`,
      "bad_output",
    );
  }
  const next: GenerationInput = structuredClone(input);
  const before = structuredClone(input.anchors[idx]);
  const anchor = next.anchors[idx];
  anchor.datePin = "fixed";
  anchor.date = edit.date;
  return { input: next, before, after: structuredClone(anchor) };
}
