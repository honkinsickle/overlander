/**
 * Partial re-plan (living plan for a trip IN PROGRESS): cleave the trip at
 * "now" into a frozen completed prefix + a re-plannable tail, and derive the
 * tail's GenerationInput so the pipeline regenerates ONLY the remaining days.
 *
 * The pipeline already generates a dated span from a start and honors fixed
 * anchors on their dates (master-prompt: "the trip runs {startDate} →
 * {endDate}, one entry per calendar day … honor every FIXED anchor on its
 * date"). So partial re-plan needs NO new pipeline capability — only a
 * synthesized tail input whose start is the last completed day's end and
 * whose startDate is the ACTUAL resume date.
 *
 * These functions are PURE (no I/O, no LLM, no DB) — the paid tail re-run,
 * confirm step, and stitch are wired on top later.
 *
 * MVP scope: cleave only at day boundaries (no mid-dwell split); coords are
 * left off the synthetic start (preComputeFacts geocodes the label).
 */

import type { Day } from "@/lib/trips/types";
import type { Anchor, GenerationInput } from "./facts";
import { alongRouteMiles, haversineMi } from "@/lib/routing/point-to-polyline";

/** A day's start / end place, parsed from its "Start — End" label. */
export function endPlaceOf(day: Pick<Day, "label">): string {
  const parts = day.label.split("—");
  return (parts[parts.length - 1] ?? day.label).trim();
}
export function startPlaceOf(day: Pick<Day, "label">): string {
  return (day.label.split("—")[0] ?? day.label).trim();
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}
/** Loose place match — "Prince George" vs "Prince George, BC". */
function placeMatches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** Where "now" is. Explicit wins; otherwise date-derived from `today`. */
export type NowSpec = {
  /** Today's ISO date — the date-derived default AND the real resume date. */
  today?: string;
  /** "I'm on day N" (1-based). Overrides date. */
  atDay?: number;
  /** "I'm at <place>" — matched against a day's end (then start) label. */
  atPlace?: string;
};

export type Cleave = {
  /** Days [0 … resumeIdx-1] — frozen, kept verbatim. */
  completedDays: Day[];
  /** First re-plannable day index (the resume day; you're driving it now). */
  resumeIdx: number;
  /** The date the tail starts from — TODAY/stated if given (reality), else
   *  the resume day's originally-planned date. This is the schedule-drift
   *  crux: a behind-schedule trip re-plans the tail from the real date. */
  resumeDate: string;
  /** The synthetic start anchor for the tail (last completed day's end),
   *  or null when nothing is completed (→ a normal full re-plan). */
  syntheticStart: Anchor | null;
};

/** Resolve the resume day index from a NowSpec. Throws on an unmatchable
 *  explicit position (caller surfaces it). */
export function resolveResumeIndex(days: Day[], now: NowSpec): number {
  if (days.length === 0) throw new Error("no days to cleave");

  if (now.atDay != null) {
    // Day N is the resume day → completed through N-1.
    const idx = now.atDay - 1;
    if (idx < 0 || idx >= days.length) {
      throw new Error(`day ${now.atDay} is out of range (1–${days.length})`);
    }
    return idx;
  }

  if (now.atPlace) {
    // "I'm AT X" = you've arrived at X = the day ENDING at X is completed →
    // resume the next day. Fall back to a start-of-day match (you're setting
    // off from X this morning → that day is the resume day).
    const endIdx = days.findIndex((d) => placeMatches(endPlaceOf(d), now.atPlace!));
    if (endIdx !== -1) return endIdx + 1;
    const startIdx = days.findIndex((d) => placeMatches(startPlaceOf(d), now.atPlace!));
    if (startIdx !== -1) return startIdx;
    throw new Error(`"${now.atPlace}" isn't a stop on this trip`);
  }

  if (now.today) {
    // First day whose date is today or later is the resume day; everything
    // strictly before is completed. All past → trip is over.
    const idx = days.findIndex((d) => d.date >= now.today!);
    return idx === -1 ? days.length : idx;
  }

  throw new Error("NowSpec needs one of: today, atDay, atPlace");
}

/**
 * Split the trip at "now". Pure. The resume day is re-plannable (you're on it
 * now); everything before is frozen.
 */
export function cleaveTrip(days: Day[], now: NowSpec): Cleave {
  const resumeIdx = resolveResumeIndex(days, now);
  const completedDays = days.slice(0, resumeIdx);
  // resumeDate: reality (today/stated) wins over the planned date.
  const resumeDate = now.today ?? days[resumeIdx]?.date ?? days[days.length - 1].date;

  const syntheticStart: Anchor | null =
    resumeIdx > 0
      ? {
          place: endPlaceOf(days[resumeIdx - 1]),
          role: "start",
          datePin: "fixed",
          date: resumeDate,
          dwell: 0,
          note: null,
          // coords omitted — preComputeFacts geocodes the label. (Intermediate
          // days don't persist end coords, so we can't lift them here.)
        }
      : null;

  return { completedDays, resumeIdx, resumeDate, syntheticStart };
}

/** Is an existing anchor still AHEAD of the cleave (belongs in the tail)? */
function anchorAhead(a: Anchor, resumeDate: string): boolean {
  if (a.role === "start") return false; // the original start is behind us
  // A fixed/window anchor is behind if its date has passed.
  if (a.datePin !== "flexible" && a.date) return a.date >= resumeDate;
  // Flexible/undated anchor: keep it (MVP). The action layer refines this
  // with along-route position once it has the route geometry; a flexible
  // anchor already physically passed can't be detected from the day table
  // alone (intermediate days carry no coords).
  return true;
}

/**
 * Build the TAIL GenerationInput: synthetic start + anchors still ahead, with
 * startDate = the real resume date and endDate unchanged (fixed end held).
 * Pure. When nothing is completed, returns the full input unchanged.
 */
export function buildTailInput(
  fullInput: GenerationInput,
  cleave: Cleave,
): GenerationInput {
  if (!cleave.syntheticStart) return fullInput;

  const ahead = fullInput.anchors.filter((a) => anchorAhead(a, cleave.resumeDate));
  const anchors: Anchor[] = [cleave.syntheticStart, ...ahead];
  // Guarantee a terminal "end" role (the original end anchor).
  const last = anchors[anchors.length - 1];
  if (last.role !== "end") last.role = "end";

  return {
    ...fullInput,
    anchors,
    params: { ...fullInput.params, startDate: cleave.resumeDate },
    // endDate deliberately unchanged — the fixed end (Vancouver 7/26) still
    // binds the tail; add-days extends it, same as a whole-trip re-plan.
  };
}

/** An edit's position, expressed in payload-pure terms. */
export type EditPosition =
  | { kind: "arrive-by"; date: string; targetDayIndex?: number }
  | { kind: "add-stop"; insertDayIndex: number };

export type FutureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate that an edit lands in the RE-PLANNABLE range [resumeIdx … end].
 * A past/completed edit is rejected — history can't change. Pure.
 */
export function isEditInFuture(cleave: Cleave, edit: EditPosition): FutureCheck {
  if (edit.kind === "arrive-by") {
    if (edit.date < cleave.resumeDate) {
      return { ok: false, reason: `${edit.date} has already passed.` };
    }
    if (edit.targetDayIndex != null && edit.targetDayIndex < cleave.resumeIdx) {
      return { ok: false, reason: "You've already driven past that stop." };
    }
    return { ok: true };
  }
  // add-stop
  if (edit.insertDayIndex < cleave.resumeIdx) {
    return { ok: false, reason: "That stop is behind you now." };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// STITCH: frozen prefix + recalculated tail → the final trip.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stitch the frozen completed days (verbatim) with the re-planned tail days,
 * renumbering the tail to continue the sequence. Tail dates already align
 * (generated from resumeDate); only dayNumber + id are renumbered. Pure.
 */
export function stitchDays(completedDays: Day[], tailDays: Day[]): Day[] {
  const base = completedDays.length;
  const renumberedTail = tailDays.map((d, i) => ({
    ...d,
    dayNumber: base + i + 1,
    id: `day-${base + i + 1}`,
  }));
  return [...completedDays, ...renumberedTail];
}

/** Walk the polyline accumulating road miles; return the vertex index at/just
 *  past `targetMi` (the cut point for the frozen prefix). */
function splitIndexAtMiles(coords: [number, number][], targetMi: number): number {
  if (targetMi <= 0) return 1;
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    acc += haversineMi(coords[i], coords[i + 1]);
    if (acc >= targetMi) return i + 1;
  }
  return coords.length;
}

/**
 * Splice the stored full-trip route geometry at the resume point and graft on
 * the recalculated tail — the Google-Maps "recalculate", scoped to ahead.
 * Truncates `fullCoords` at the projection of `resumeCoords` onto it, then
 * appends `tailCoords` (deduping the boundary vertex). Pure — the action
 * decodes the stored polyline, calls this, and re-encodes.
 */
export function stitchPolyline(
  fullCoords: [number, number][],
  resumeCoords: [number, number],
  tailCoords: [number, number][],
): [number, number][] {
  if (fullCoords.length === 0) return tailCoords;
  const along = alongRouteMiles(resumeCoords, fullCoords);
  const cut = along ? splitIndexAtMiles(fullCoords, along.miles) : fullCoords.length;
  const out = fullCoords.slice(0, cut);
  for (const c of tailCoords) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
  }
  return out;
}
