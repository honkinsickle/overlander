/**
 * User-scoped garage. Vehicles persist across trips — selecting one
 * for a trip stores only the vehicle id on the draft.
 */
export type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  /** Short capability chips shown under the title (e.g. ["OFF-ROAD", "V8", "4WD"]).
   *  DISPLAY only — distinct from `rig.build` (the mod list that drives planner
   *  reasoning). */
  capabilities: string[];
  /** Saved-once expedition rig profile (reference-doc §02). Optional so
   *  pre-existing seeds without a profile still typecheck; the planner falls
   *  back to sensible defaults when absent. NOTE: the garage store is
   *  in-memory today, so "saved" persists only until server restart —
   *  durable persistence lands with the DB-backed garage. */
  rig?: RigProfile;
};

/** Expedition rig profile (reference-doc §02) saved on the garage vehicle. */
export type RigProfile = {
  /** Mods that drive reasoning: lift / tires / armor / winch / fridge /
   *  dual-battery / solar / RTT. */
  build: string[];
  /** Usable fuel range in miles — drives fuel-gap detection. */
  fuelRangeMi: number;
  capability: "mild" | "moderate" | "avoid-hardcore";
  groupSize: string;
  skill: string;
  /** Travel-STYLE preferences (solitude / scenic / photography / simple-camp /
   *  local-food) — distinct from the stop-category interests taxonomy. */
  preferences: string[];
};

/** Convenience formatter. */
export function vehicleTitle(v: Vehicle): string {
  return `${v.year} ${v.make} ${v.model}`;
}

/** Sensible defaults when a garage vehicle has no saved rig profile yet. */
export const DEFAULT_RIG: RigProfile = {
  build: [],
  fuelRangeMi: 300,
  capability: "moderate",
  groupSize: "1–2 travelers",
  skill: "intermediate",
  preferences: [],
};

/** Map a garage vehicle → the pipeline's rig-profile shape (§02). */
export function vehicleToRigProfile(v: Vehicle): RigProfile & { vehicle: string } {
  const rig = v.rig ?? DEFAULT_RIG;
  return { vehicle: vehicleTitle(v), ...rig };
}
