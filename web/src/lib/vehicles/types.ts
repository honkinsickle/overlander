/**
 * User-scoped garage. Vehicles persist across trips — selecting one
 * for a trip stores only the vehicle id on the draft.
 */
export type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  /** Short capability chips shown under the title (e.g. ["OFF-ROAD", "V8", "4WD"]). */
  capabilities: string[];
};

/** Convenience formatter. */
export function vehicleTitle(v: Vehicle): string {
  return `${v.year} ${v.make} ${v.model}`;
}
