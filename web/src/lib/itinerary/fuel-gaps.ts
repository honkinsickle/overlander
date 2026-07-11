/**
 * Mechanical fuel-gap computation (spec §8.5 / §8.3 Tier 1).
 *
 * Projects the corridor's real fuel POIs onto the route, then measures the
 * stretches between consecutive fuel opportunities. A stretch that
 * approaches or exceeds the rig's fuel range is a gap — computed from data,
 * never from the LLM's memory of where gas stations are.
 *
 * Geometry: uses the stored route polyline when present; falls back to the
 * corridor-city spine (always in EngineFacts) so the audit runs even on
 * facts captured before the polyline was stored.
 */

import type { EngineFacts } from "./facts";
import type { FuelGap } from "./schema";

const MI_PER_DEG_LAT = 69.093;

/** Haversine-free equirectangular miles — fine at these scales for
 *  ordering fuel stops along a corridor. */
function approxMiles(a: [number, number], b: [number, number]): number {
  const latMid = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dLat = (b[1] - a[1]) * MI_PER_DEG_LAT;
  const dLng = (b[0] - a[0]) * MI_PER_DEG_LAT * Math.cos(latMid);
  return Math.hypot(dLat, dLng);
}

/** A polyline with a known cumulative-mile position at each vertex. */
type MileMarkedLine = { coord: [number, number]; mi: number }[];

/** Build a mile-marked spine from the corridor cities (ordered, each with
 *  milesFromStart). Start (0) and end (route.totalMi) bookend it. */
function spineLine(facts: EngineFacts): MileMarkedLine {
  const line: MileMarkedLine = [];
  const startCoord = facts.anchorsResolved[0]?.coords;
  if (startCoord) line.push({ coord: startCoord, mi: 0 });
  for (const c of facts.corridorCities) {
    line.push({ coord: c.coords, mi: c.milesFromStart });
  }
  const endCoord = facts.anchorsResolved[facts.anchorsResolved.length - 1]?.coords;
  if (endCoord) line.push({ coord: endCoord, mi: facts.route.totalMi });
  // Ensure monotonic by mile.
  return line.sort((a, b) => a.mi - b.mi);
}

/** Project a point onto the mile-marked line: return the cumulative miles of
 *  the nearest vertex (coarse but sufficient for gap ordering). */
function projectMiles(coord: [number, number], line: MileMarkedLine): number {
  let best = line[0];
  let bestD = Infinity;
  for (const v of line) {
    const d = approxMiles(coord, v.coord);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best.mi;
}

export type ComputedFuelGap = FuelGap & {
  /** Along-route miles where the gap begins / ends. */
  fromMi: number;
  toMi: number;
  /** True when the gap meets or exceeds the rig's usable range (critical),
   *  vs merely crossing the comfort margin. */
  exceedsRange: boolean;
};

/**
 * Compute the fuel-scarce stretches for a trip.
 *
 * Fuel opportunities = the route start town (mi 0) + every fuel POI in the
 * pool + the end town (totalMi). A gap is any stretch between consecutive
 * opportunities that crosses the comfort margin (75% of range); it's
 * critical when it meets or exceeds the full range.
 */
export function computeFuelGaps(
  facts: EngineFacts,
  fuelRangeMi: number,
): ComputedFuelGap[] {
  const line = spineLine(facts);
  const total = facts.route.totalMi;
  const comfort = fuelRangeMi * 0.75;

  const fuelPositions = facts.poolPOIs
    .filter((p) => p.category === "fuel")
    .map((p) => ({ name: p.name, mi: projectMiles(p.coords, line) }));

  // Fuel opportunities along the route, in order. Start and end towns are
  // assumed fuelable (they're anchor settlements).
  const stops = [
    { name: `${facts.anchorsResolved[0]?.place ?? "Start"} (start)`, mi: 0 },
    ...fuelPositions,
    {
      name: `${facts.anchorsResolved[facts.anchorsResolved.length - 1]?.place ?? "End"} (end)`,
      mi: total,
    },
  ].sort((a, b) => a.mi - b.mi);

  const gaps: ComputedFuelGap[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    const gapMi = to.mi - from.mi;
    if (gapMi < comfort) continue;
    const exceedsRange = gapMi >= fuelRangeMi;
    gaps.push({
      segment: `${from.name} → ${to.name}`,
      gapMi: Math.round(gapMi),
      exceedsRange,
      fromMi: Math.round(from.mi),
      toMi: Math.round(to.mi),
      action: exceedsRange
        ? `${Math.round(gapMi)} mi exceeds the ${fuelRangeMi}-mi range — carry a jerry can and fill at every opportunity.`
        : `${Math.round(gapMi)} mi is within range but past the comfort margin — top off before ${to.name}.`,
    });
  }
  return gaps;
}
