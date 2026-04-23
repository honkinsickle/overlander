/**
 * Draft trip — the in-progress planning workflow.
 * Filled in step-by-step; promoted to a full `Trip` on completion.
 *
 * Each step's data is optional until that step is saved; the workflow
 * decides validity per step (rather than at the type level) so users
 * can jump back and forth.
 */

export type PlanWith = "automagically" | "explore";

export type PlanLocation = {
  /** Freeform text entered by the user. Geocoding deferred. */
  label: string;
  /** Future: populated by the geocoding pipeline. */
  lat?: number;
  lng?: number;
};

export type GoingData = {
  startLocation?: PlanLocation;
  destination?: PlanLocation;
  saveStartAsHome?: boolean;
  planWith: PlanWith;
  /** ISO date strings, `YYYY-MM-DD`. */
  startDate?: string;
  endDate?: string;
};

export type VehicleData = {
  /** References to user-scoped Vehicle records. */
  vehicleIds: string[];
  /** Trip-level preference — affects planner pacing. */
  milesPerDay?: number;
};

export type InterestsData = {
  /** Flat set of selected chip IDs from the interests taxonomy. */
  selectedChipIds: string[];
};

/** User-pinned must-stop waypoint. `meta` and `category` populate via
 *  geocoding later; for now we just store the freeform label. */
export type PlannedStop = {
  id: string;
  label: string;
  meta?: string;
  category?: import("@/components/primitives/detail-card").Category;
};

export type StopsData = {
  /** User-pinned waypoints before the planner runs. */
  stops: PlannedStop[];
  avoidHighways: boolean;
};

export type DraftStatus = "draft" | "complete";

export type DraftTrip = {
  id: string;
  status: DraftStatus;
  createdAt: string;
  going?: GoingData;
  vehicle?: VehicleData;
  interests?: InterestsData;
  stops?: StopsData;
  /** Suggestion ids the user added on the Results step. Populated on
   *  demand as the user toggles "+ ADD TO TRIP" on each card. */
  acceptedSuggestionIds?: string[];
};

/** The step id is the URL segment and the storage key. */
export const PLAN_STEPS = [
  "going",
  "vehicle",
  "interests",
  "stops",
  "loader",
  "results",
] as const;

export type PlanStep = (typeof PLAN_STEPS)[number];

/** Display numbering. Step 01 is the Entry ("Where to today?") which
 *  redirects into this flow. Paper's original 04 slot is omitted so
 *  numbering is contiguous 02–07 across 7 total steps. */
export const STEP_DISPLAY_NUMBER: Record<PlanStep, number> = {
  going: 2,
  vehicle: 3,
  interests: 4,
  stops: 5,
  loader: 6,
  results: 7,
};

export const STEP_TITLE: Record<PlanStep, string> = {
  going: "Where are you going?",
  vehicle: "What are you driving?",
  interests: "What type of stops are you interested in?",
  stops: "Any must-stop waypoints?",
  loader: "Planning your trip…",
  results: "Your trip",
};

// Paper numbers the flow as 02–08 (step 01 is the Entry screen). We keep
// that denominator here even though code collapses the original 04 slot.
export const TOTAL_DISPLAY_STEPS = 8;

export function nextStep(step: PlanStep): PlanStep | null {
  const i = PLAN_STEPS.indexOf(step);
  return i >= 0 && i < PLAN_STEPS.length - 1 ? PLAN_STEPS[i + 1] : null;
}

export function previousStep(step: PlanStep): PlanStep | null {
  const i = PLAN_STEPS.indexOf(step);
  return i > 0 ? PLAN_STEPS[i - 1] : null;
}
