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

// TODO(living-plan intelligent-parse tier): distinguish "be at X on <date>"
// (pin ARRIVAL — current behavior; Stewart 7/19 → glacier day 7/20) from
// "do X on <date>" (the activity day itself lands on the date). Both parse
// to arrive-by today; the audit's "any day at the place" check accepts
// either, so the distinction needs a parse-level intent field + a stricter
// apply (e.g. pin the dwell day, not just presence).
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
  | {
      type: "add-stop";
      /** The place to add, as the user named it. Its route position is
       *  INFERRED (inferAddStopPosition) — the user gives no "between X and
       *  Y" hint. */
      place: string;
      /** Nights requested at the new stop: "add Barkerville" → 0 (visit);
       *  "add a night in Barkerville" → 1. */
      dwell: number;
    }
  | { type: "unsupported"; reason: string };

/** Flat wire shape — the union is narrowed in code after validation. */
const PARSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["arrive-by", "add-stop", "unsupported"] },
    place: { type: ["string", "null"] },
    date: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    },
    targetAnchor: { type: ["string", "null"] },
    /** Nights at an added stop (add-stop only); null otherwise. */
    dwell: { type: ["integer", "null"] },
    reason: { type: ["string", "null"] },
  },
  required: ["type", "place", "date", "targetAnchor", "dwell", "reason"],
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
- "add-stop": the traveler wants to ADD a NEW place to the trip ("add Barkerville", "stop at Liard Hot Springs", "add a night in Jasper"). Emit the place as named and dwell = nights requested (0 for a plain visit, 1+ if they ask to stay/overnight). Do NOT infer a date or a position — the system places it on the route automatically. Set date and targetAnchor to null.
  - Only use add-stop when the place is NOT already an anchor. If they name an existing anchor with a date, that's arrive-by.
- If the request is not one of the above (or is ambiguous beyond guessing), emit type "unsupported" with a short reason.
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
    type: "arrive-by" | "add-stop" | "unsupported";
    place: string | null;
    date: string | null;
    targetAnchor: string | null;
    dwell: number | null;
    reason: string | null;
  };

  if (raw.type === "unsupported") {
    return { type: "unsupported", reason: raw.reason ?? "unsupported request" };
  }
  if (raw.type === "add-stop") {
    if (!raw.place) {
      throw new ItineraryGenerationError(
        `Parse emitted add-stop with no place: ${text}`,
        "bad_output",
      );
    }
    return {
      type: "add-stop",
      place: raw.place,
      dwell: Math.max(0, raw.dwell ?? 0),
    };
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

// ─────────────────────────────────────────────────────────────────────────
// ADD-STOP: infer where a newly-named place slots on the route, then insert
// it as a waypoint anchor. The user names only the place; position + fit are
// inferred.
// ─────────────────────────────────────────────────────────────────────────

/** Perpendicular offset (mi) beyond which a place is "far off your route" —
 *  we still allow it, but the UI must CONFIRM ("X is N mi off — add anyway?")
 *  rather than silently bending the route by a giant reroute. Chosen above a
 *  legitimate day-trip spur (Barkerville is 35 mi off) and above the audit's
 *  corridor guard band (60–120 mi), so only genuinely off-corridor places
 *  (200 mi+) trip it. */
export const ADD_STOP_OFFSET_FLAG_MI = 100;

/** Added drive miles at/under which the detour is assumed to tuck into an
 *  existing day (no scheduling tradeoff, no mode choice). Above it, adding
 *  the stop needs room → the two-mode choice. A dwell request always forces
 *  the choice regardless (a night is a whole day). */
export const ADD_STOP_ABSORB_MI = 40;

export type InferredPosition = {
  /** Insert the new anchor at this index in the anchors array (it lands
   *  BETWEEN anchors[insertAt-1] and anchors[insertAt]). */
  insertAt: number;
  /** The two anchors it slots between (place labels), for the confirm sheet. */
  prevAnchor: string;
  nextAnchor: string;
  /** Along-route miles of the new place's projection onto the current route. */
  alongMiles: number;
  /** Perpendicular distance from the place to the route — the spur/off-route
   *  signal. */
  offsetMi: number;
  /** True when offsetMi exceeds the flag threshold — UI should confirm. */
  farOffRoute: boolean;
};

/**
 * Infer the sequence position of a new place: project it onto the current
 * anchor-chain route and insert it after the last anchor it's past
 * (along-route). Pure geometry — `routeCoords` is the decoded polyline from
 * `routeBetween`, `anchorAlongMiles` the along-route mile of each existing
 * anchor (both computed by the caller via `alongRouteMiles`).
 */
export function inferAddStopPosition(
  anchors: Anchor[],
  anchorAlongMiles: number[],
  newAlong: { miles: number; offsetMi: number },
): InferredPosition {
  // First anchor whose along-route position is beyond the new place → insert
  // before it. Never before the start or after the end (those are endpoint
  // moves, not inserts) — clamp into [1, anchors.length-1]. findIndex → -1
  // means the place is past the LAST anchor: clamp to insert before the end.
  let insertAt = anchorAlongMiles.findIndex((m) => m > newAlong.miles);
  if (insertAt === -1) insertAt = anchors.length - 1; // past the end
  else if (insertAt < 1) insertAt = 1; // before the start
  return {
    insertAt,
    prevAnchor: anchors[insertAt - 1].place,
    nextAnchor: anchors[insertAt].place,
    alongMiles: Math.round(newAlong.miles),
    offsetMi: Math.round(newAlong.offsetMi * 10) / 10,
    farOffRoute: newAlong.offsetMi > ADD_STOP_OFFSET_FLAG_MI,
  };
}

/** How adding the stop resolves a scheduling conflict.
 *   - "adjust": keep the fixed dates; the pipeline compresses to fit.
 *   - "add-days": push the end anchor + endDate by `addDays` so nothing
 *     compresses. */
export type AddStopMode = "adjust" | "add-days";

export type AppliedAddStop = {
  input: GenerationInput;
  /** The inserted anchor. */
  added: Anchor;
  insertAt: number;
  mode: AddStopMode;
  /** For "add-days": the new end date (else null). */
  newEndDate: string | null;
};

/** Add `n` days to an ISO date (UTC, no TZ drift). */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Insert the new place as a waypoint anchor and express the chosen mode as a
 * GenerationInput mutation. Pure.
 *   - "adjust": insert only; all date pins (incl. the fixed end) unchanged →
 *     the same window absorbs the detour by re-pacing (the audit's fixed-anchor
 *     + leg-over-cap checks do the honoring, or refuse if infeasible).
 *   - "add-days": insert AND push the end anchor's date + params.endDate by
 *     `addDays` → headroom absorbs the detour, nothing before it compresses.
 */
export function applyAddStop(
  input: GenerationInput,
  place: string,
  coords: [number, number],
  dwell: number,
  insertAt: number,
  mode: AddStopMode,
  addDays = 1,
): AppliedAddStop {
  const next: GenerationInput = structuredClone(input);
  const added: Anchor = {
    place,
    role: "waypoint",
    datePin: "flexible",
    date: null,
    dwell,
    note: null,
    coords,
  };
  next.anchors.splice(insertAt, 0, added);

  let newEndDate: string | null = null;
  if (mode === "add-days") {
    const end = next.anchors[next.anchors.length - 1];
    if (end.date) end.date = addDaysISO(end.date, addDays);
    if (next.params.endDate) {
      next.params.endDate = addDaysISO(next.params.endDate, addDays);
      newEndDate = next.params.endDate;
    }
  }
  return { input: next, added: structuredClone(added), insertAt, mode, newEndDate };
}

// ─────────────────────────────────────────────────────────────────────────
// RESCHEDULE / SKIP / STAY-LONGER — anchor-set mutations, then the same
// runGateStage pipeline. Pure; the action resolves coords/positions and runs.
// ─────────────────────────────────────────────────────────────────────────

/** Index of the anchor matching `place` (loose name match), or -1. */
export function findAnchorIndex(anchors: Anchor[], place: string): number {
  const norm = (s: string) => s.trim().toLowerCase();
  const p = norm(place);
  return anchors.findIndex((a) => {
    const q = norm(a.place);
    return q === p || q.includes(p) || p.includes(q);
  });
}

export type SingleAnchorEdit = {
  input: GenerationInput;
  /** The anchor after the edit (inserted or mutated), for the confirm/diff. */
  anchor: Anchor;
  /** True when a NEW anchor was inserted (the place wasn't already one). */
  inserted: boolean;
};

/**
 * RESCHEDULE: pin a place to a fixed date. If it's already an anchor, set its
 * date; if it's a pacing city (not an anchor), INSERT it as a fixed-date
 * waypoint at `insertAt` — promoting the generator's soft choice to a hard
 * date-pin the re-run must honor. Pure.
 */
export function applyReschedule(
  input: GenerationInput,
  place: string,
  coords: [number, number],
  date: string,
  insertAt: number,
): SingleAnchorEdit {
  const next = structuredClone(input);
  const idx = findAnchorIndex(next.anchors, place);
  if (idx !== -1) {
    const a = next.anchors[idx];
    a.datePin = "fixed";
    a.date = date;
    return { input: next, anchor: structuredClone(a), inserted: false };
  }
  const added: Anchor = { place, role: "waypoint", datePin: "fixed", date, dwell: 0, note: null, coords };
  next.anchors.splice(insertAt, 0, added);
  return { input: next, anchor: structuredClone(added), inserted: true };
}

/**
 * STAY-LONGER: add `nights` at a place. If it's an anchor, bump its dwell; if
 * it's a pacing city, insert it as a dwelled (flexible-date) waypoint. Pure.
 */
export function applyStayLonger(
  input: GenerationInput,
  place: string,
  coords: [number, number],
  nights: number,
  insertAt: number,
): SingleAnchorEdit {
  const next = structuredClone(input);
  const idx = findAnchorIndex(next.anchors, place);
  if (idx !== -1) {
    const a = next.anchors[idx];
    a.dwell += nights;
    return { input: next, anchor: structuredClone(a), inserted: false };
  }
  const added: Anchor = { place, role: "waypoint", datePin: "flexible", date: null, dwell: nights, note: null, coords };
  next.anchors.splice(insertAt, 0, added);
  return { input: next, anchor: structuredClone(added), inserted: true };
}

export type AppliedSkip = {
  input: GenerationInput;
  /** Anchors removed (place labels), if any were anchors. */
  removed: string[];
  /** Labels added to params.avoid (pacing cities can't be removed from the
   *  anchor set — the generator is told to avoid them). */
  avoided: string[];
};

/**
 * SKIP: drop places from the trip. An anchor match is removed outright (never
 * the start/end); anything else is added to params.avoid so the re-run doesn't
 * route through it. `labels` may be several places (a fuzzy "boring middle").
 * Pure.
 */
export function applySkip(input: GenerationInput, labels: string[]): AppliedSkip {
  const next = structuredClone(input);
  const removed: string[] = [];
  const avoided: string[] = [];
  for (const label of labels) {
    const idx = findAnchorIndex(next.anchors, label);
    const isEndpoint =
      idx !== -1 && (next.anchors[idx].role === "start" || next.anchors[idx].role === "end");
    if (idx !== -1 && !isEndpoint) {
      removed.push(next.anchors[idx].place);
      next.anchors.splice(idx, 1);
    } else {
      // Pacing city (or an endpoint we won't remove) → tell the generator to
      // skip it via the avoid list.
      if (!next.params.avoid.some((a) => a.toLowerCase() === label.toLowerCase())) {
        next.params.avoid.push(label);
        avoided.push(label);
      }
    }
  }
  return { input: next, removed, avoided };
}
