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
import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import { isInPlanningRegion, PLANNING_REGION_NAMES } from "./planning-region";

/** One row of the destinations list (reference-doc §01 start/end + §03 events).
 *  "window" from spec §8.1 is intentionally dropped — a window needs a date
 *  RANGE that `Anchor.date` (single string) can't express (future schema add). */
export type ExpeditionDestination = {
  /** Geocodable city/destination text. */
  place: string;
  /** `[lng,lat]` bound when the user PICKED a suggestion or entered raw
   *  coordinates — null when the field holds unresolved freeform text. */
  coords: [number, number] | null;
  /** Mapbox region code ("CA", "OR", …) from the picked suggestion, null for
   *  unresolved freeform text OR a manually-entered coordinate (see
   *  `manualCoords`). Historically `coords != null` implied `region != null`
   *  — that invariant now has one deliberate exception: manual coordinate
   *  entry sets `coords` with `region` staying null.
   *
   *  DROPPED AT THE PIPELINE BOUNDARY, deliberately: `expeditionToGenerationInput`
   *  builds each `Anchor` field by field and does not copy this, so the region
   *  never reaches `GenerationInput` or anything under `lib/itinerary/`. It
   *  exists to be checked before generation, not to be planned with. */
  region: string | null;
  /** True when `coords` came from hand-entered lat/lng rather than a resolved
   *  Mapbox suggestion. Exempts this destination from the planning-region
   *  gate in `validateExpeditionForm` — a deliberate testing-scope choice,
   *  not a general "coords implies in-region" claim. See
   *  `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`. */
  manualCoords: boolean;
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
  /** Trip end date. Reaches the pipeline as `TripParams.endDate`, independently
   *  of any anchor's `datePin` — the start and end destinations carry no date
   *  pin of their own (the wizard hides the toggle for them and normalizes both
   *  to flexible/null), because the trip's date range already pins them. */
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
  /** Interest-Category-Chips (`docs/specs/interest-category-chips.md`, §11
   *  step 3, PR #287). Categories the user asks the trip to guarantee, using
   *  the `SlideCategoryKey` vocabulary end-to-end (Decision A: `overnight`,
   *  not `hotel`). Empty/absent = no guarantees.
   *
   *  Wired end-to-end as of 2026-09-01: `fuel` via fuel-live-resolve.ts; the
   *  pool-side categories via the audit's anchor-backfill (granularity decided
   *  D-B per-city, ADR 2026-08-25); and, filtered to GUARANTEE_CATEGORIES, into
   *  the generation prompt itself (ADR 2026-09-01, PR #287 blocker H). The
   *  earlier "only fuel is wired / others are D-blocked" note here was stale on
   *  both counts. */
  guaranteedCategories?: SlideCategoryKey[];
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
  "photography",
  "simple-camp",
  "local-food",
] as const;

/**
 * Drop preferences a saved rig carries that the wizard no longer offers.
 *
 * `scenic` was retired here (spec `docs/specs/interest-category-chips.md` §7 —
 * it duplicates the Interest Categories chips). Retiring an option is not
 * self-cleaning: `ChipGroup` renders only `options`, so a retired value stays
 * in `rig.preferences` state, is written back on save, and — because
 * `buildFactsMessage` serialises the whole `rig` object into the LLM payload —
 * keeps reaching the model. The user can neither see nor untick it.
 *
 * Filtering to the current option set on load makes the removal actually take
 * effect, and covers any future retirement rather than just this one.
 */
export function normalizePreferences(preferences: readonly string[]): string[] {
  const allowed = PREFERENCE_OPTIONS as readonly string[];
  return preferences.filter((p) => allowed.includes(p));
}

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
    ...(d.coords ? { coords: d.coords } : {}),
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
    guaranteedCategories: form.guaranteedCategories,
  };
}

/** Validation — surfaced to the user before a (paid) generation runs.
 *  The unresolved-destination check is CORRECTNESS: a freeform label the user
 *  didn't pick from the list can fuzzy-geocode to the wrong place. */
export function validateExpeditionForm(form: ExpeditionForm): string | null {
  if (form.destinations.length < 2) return "Add at least a start and an end destination.";
  if (form.destinations.some((d) => !d.place.trim())) return "Every destination needs a place.";
  if (form.destinations.some((d) => !d.coords))
    return "Pick each destination from the suggestions so it resolves to a real place.";
  // Planning region. This runs on BOTH sides: the wizard calls it to gate the
  // submit control, and `generateExpeditionTripAction` calls it server-side
  // before any spend — which is what makes it a real backstop rather than a
  // client-side courtesy. A Server Action is a POST to the page, so the page's
  // own gating does not cover it (same reasoning as the flag and getUser
  // guards there).
  //
  // Reached only for destinations that already have coords, and coords are
  // only ever set by picking a filtered suggestion — so in practice this
  // catches a hand-crafted POST, not a user.
  //
  // EXCEPT manual coordinate entry (`manualCoords: true`), which deliberately
  // skips this check — see docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md.
  const outOfRegion = form.destinations.find(
    (d) => !d.manualCoords && !isInPlanningRegion(d.region),
  );
  if (outOfRegion)
    return `Trip planning currently covers ${PLANNING_REGION_NAMES}. "${outOfRegion.place.trim()}" is outside that region.`;
  if (form.destinations.some((d) => d.datePin === "fixed" && !d.date))
    return "A FIXED destination needs a date.";
  if (!form.startDate) return "Set a start date.";
  if (!form.endDate) return "Set an end date.";
  if (form.startDate > form.endDate) return "End date must be on or after the start date.";
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
