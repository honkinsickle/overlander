/**
 * Default OfflinePhase generator. Returns an array of phases covering
 * the entire trip in N-day chunks. Doesn't persist anything; sessions
 * 3+ let the user merge/split/edit the result before saving.
 *
 * Defaults follow the ADR: 7 days per phase, 25 mi buffer, max zoom 13.
 */

import type { OfflinePhase, Trip } from "@/lib/trips/types";

export type SuggestDefaultPhasesOptions = {
  /** Days per phase. Default 7 (week-aligned). */
  daysPerPhase?: number;
  /** Buffer width per phase in miles. Default 25. */
  bufferMi?: number;
  /** Highest zoom level included. Default 13 (z=14 unaffordable per ADR). */
  maxZoom?: number;
};

export function suggestDefaultPhases(
  trip: Trip,
  options: SuggestDefaultPhasesOptions = {},
): OfflinePhase[] {
  const daysPerPhase = options.daysPerPhase ?? 7;
  const bufferMi = options.bufferMi ?? 25;
  const maxZoom = options.maxZoom ?? 13;

  if (daysPerPhase < 1) {
    throw new Error(`daysPerPhase must be >= 1 (got ${daysPerPhase})`);
  }
  if (trip.days.length === 0) return [];

  // Sort by dayNumber so phases align with the trip's logical sequence
  // even if `trip.days` were stored out of order.
  const sortedDays = [...trip.days].sort((a, b) => a.dayNumber - b.dayNumber);
  const now = new Date().toISOString();

  const phases: OfflinePhase[] = [];
  for (let i = 0; i < sortedDays.length; i += daysPerPhase) {
    const chunk = sortedDays.slice(i, i + daysPerPhase);
    const weekNum = phases.length + 1;
    const startNum = chunk[0].dayNumber;
    const endNum = chunk[chunk.length - 1].dayNumber;
    phases.push({
      id: `phase-w${weekNum}`,
      label:
        startNum === endNum
          ? `Week ${weekNum}: Day ${startNum}`
          : `Week ${weekNum}: Days ${startNum}–${endNum}`,
      dayIds: chunk.map((d) => d.id),
      bufferMi,
      maxZoom,
      primedPolylineHash: null,
      primedTilesetVersion: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return phases;
}
