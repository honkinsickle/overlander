/**
 * Expedition-wizard input model + mappers (the UI front door for the merged
 * YoTrippin generation pipeline). Every field traces to reference-doc
 * §01/§02/§03 or the pipeline's `GenerationInput` — no invented fields.
 *
 * The wizard collects an ExpeditionForm; `expeditionToGenerationInput` maps it
 * to exactly what `preComputeFacts`/`generateAndAudit` consume.
 */

import type {
  Anchor,
  GenerationInput,
  RigProfile as PipelineRigProfile,
  TripParams,
} from "@/lib/itinerary/facts";
import type { RigProfile } from "@/lib/vehicles/types";

/** One row of the destinations list (reference-doc §01 start/end + §03 events).
 *  "window" from spec §8.1 is intentionally dropped — a window needs a date
 *  RANGE that `Anchor.date` (single string) can't express (future schema add). */
export type ExpeditionDestination = {
  /** Geocodable city/destination text. */
  place: string;
  /** FIXED = hard schedule anchor; flexible = the planner may place it. */
  datePin: "fixed" | "flexible";
  /** ISO date; used only when datePin === "fixed". */
  date: string | null;
  /** 0 = pass-through, 1+ = layover days. */
  dwell: number;
  note: string | null;
};

/** The full wizard payload. */
export type ExpeditionForm = {
  /** Ordered 2–8 destinations. First = start, last = end, middle = waypoints. */
  destinations: ExpeditionDestination[];
  // Trip params (§01)
  startDate: string;
  /** Binds to the end destination's FIXED date (same value). */
  endDate: string;
  /** Free-text trip intent/vibe (§01 Objective) → prompt context only. */
  objective: string;
  budget: TripParams["budget"];
  maxDailyDriveMi: number;
  bufferDays: number;
  avoid: string[];
  returnRouting: TripParams["returnRouting"];
  // Rig (§02) — vehicle from the garage + its (possibly overridden) rig profile.
  vehicleId: string;
  vehicleTitle: string;
  rig: RigProfile;
};

/** Reference-doc §01 Avoid chips. */
export const AVOID_OPTIONS = [
  "rock-crawl",
  "tolls",
  "ferries",
  "rushed legs",
] as const;

/** Reference-doc §02 Build mods (distinct from Vehicle.capabilities). */
export const BUILD_OPTIONS = [
  "lift",
  "tires",
  "armor",
  "winch",
  "fridge",
  "dual-battery",
  "solar",
  "RTT",
] as const;

/** Reference-doc §02 travel-style Preferences. */
export const PREFERENCE_OPTIONS = [
  "solitude",
  "scenic",
  "photography",
  "simple-camp",
  "local-food",
] as const;

/** Map the wizard form → the pipeline's GenerationInput. Pure; no I/O. */
export function expeditionToGenerationInput(
  form: ExpeditionForm,
): GenerationInput {
  const last = form.destinations.length - 1;
  const anchors: Anchor[] = form.destinations.map((d, i) => ({
    place: d.place.trim(),
    role: i === 0 ? "start" : i === last ? "end" : "waypoint",
    datePin: d.datePin,
    date: d.datePin === "fixed" ? d.date : null,
    dwell: d.dwell,
    note: d.note?.trim() ? d.note.trim() : null,
  }));

  const params: TripParams = {
    startDate: form.startDate,
    endDate: form.endDate || null,
    budget: form.budget,
    maxDailyDriveMi: form.maxDailyDriveMi,
    bufferDays: form.bufferDays,
    avoid: form.avoid,
    returnRouting: form.returnRouting,
  };

  const rig: PipelineRigProfile = {
    vehicle: form.vehicleTitle,
    build: form.rig.build,
    fuelRangeMi: form.rig.fuelRangeMi,
    capability: form.rig.capability,
    groupSize: form.rig.groupSize,
    skill: form.rig.skill,
    preferences: form.rig.preferences,
  };

  return {
    anchors,
    params,
    rig,
    objective: form.objective.trim() || undefined,
  };
}

/** Validation — surfaced to the user before a (paid) generation runs. */
export function validateExpeditionForm(form: ExpeditionForm): string | null {
  if (form.destinations.length < 2) return "Add at least a start and an end destination.";
  if (form.destinations.some((d) => !d.place.trim())) return "Every destination needs a place.";
  if (form.destinations.some((d) => d.datePin === "fixed" && !d.date))
    return "A FIXED destination needs a date.";
  if (!form.startDate) return "Set a start date.";
  if (!form.endDate) return "Set an end date.";
  if (form.startDate > form.endDate) return "End date must be after the start date.";
  if (!(form.maxDailyDriveMi > 0)) return "Max daily drive must be positive.";
  if (!form.vehicleId) return "Pick a vehicle.";
  return null;
}

// ── Gate + safety ─────────────────────────────────────────────────────

/** The wizard is gated OFF by default (dev-only opt-in). Set
 *  `ENABLE_PLANNER_WIZARD=true` in the dev env to expose it. Prod never sets
 *  it, so merging never ships a live generate button (matches the dormant
 *  pipeline). Server-only (reads process.env). */
export function isExpeditionWizardEnabled(): boolean {
  return process.env.ENABLE_PLANNER_WIZARD === "true";
}

/** TEST project ref — the ONLY project the wizard may persist to. */
export const TEST_PROJECT_REF = "znldzjdatkogdktymtvi";
export const KNOWN_PROJECT_REFS: Record<string, string> = {
  nqzeywzcowujzyegxbsr: "PROD",
  [TEST_PROJECT_REF]: "TEST",
};

/** Extract the Supabase project ref the app is currently pointed at. */
export function currentProjectRef(): { ref: string; label: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  return { ref, label: KNOWN_PROJECT_REFS[ref] ?? "UNKNOWN" };
}
