import type { DirectionStep } from "./use-leg-directions";
import {
  haversineMi,
  projectPointToPolyline,
} from "@/lib/routing/point-to-polyline";

const METERS_PER_MI = 1609.344;

/** Cumulative arc-length lookup precomputed once per directions payload.
 *  For each step i, holds the route-distance (mi) at the step's START.
 *  Plus the full concatenated route polyline used for projection. */
export type StepDistanceIndex = {
  startMi: number[];
  totalMi: number;
  flatPath: [number, number][];
  /** For each coord in `flatPath`, the cumulative mile mark at that
   *  vertex from the start of the route. Lets us convert a vertex index
   *  back to a route-distance, which then maps to a step. */
  vertexMi: number[];
};

/** Walk the steps once to build the cumulative distance + flat-path
 *  lookup. Caller stores this alongside the directions payload so we
 *  don't recompute on every GPS callback. */
export function buildStepDistanceIndex(
  steps: DirectionStep[],
): StepDistanceIndex {
  const startMi: number[] = [];
  const flatPath: [number, number][] = [];
  const vertexMi: number[] = [];
  let cumMi = 0;
  for (let i = 0; i < steps.length; i++) {
    startMi.push(cumMi);
    const s = steps[i];
    const stepMi = s.distanceMeters / METERS_PER_MI;
    // Build a continuous polyline. Skip the first coord of every step
    // after the first — it matches the previous step's last coord.
    for (let j = 0; j < s.coords.length; j++) {
      if (i > 0 && j === 0) continue;
      const c = s.coords[j];
      if (flatPath.length === 0) {
        flatPath.push(c);
        vertexMi.push(cumMi);
      } else {
        const prev = flatPath[flatPath.length - 1];
        const segMi = haversineMi(prev, c);
        cumMi += segMi;
        flatPath.push(c);
        vertexMi.push(cumMi);
      }
    }
    // If the step had no geometry coords for some reason, still advance
    // by the reported distance so subsequent steps line up.
    if (s.coords.length === 0) {
      cumMi += stepMi;
    }
  }
  return { startMi, totalMi: cumMi, flatPath, vertexMi };
}

/** Find which step the user is currently in, based on their GPS coord.
 *  Projects the GPS point onto the concatenated route polyline, computes
 *  the cumulative mile mark of the projection, and binary-searches the
 *  step whose [startMi, nextStartMi) range contains it.
 *
 *  Returns `offRouteMi` so the panel can show an "off-route" banner. */
export function currentStepIndex(
  gps: [number, number],
  steps: DirectionStep[],
  index: StepDistanceIndex,
): { index: number; offRouteMi: number } {
  if (steps.length === 0 || index.flatPath.length === 0) {
    return { index: 0, offRouteMi: Infinity };
  }
  const proj = projectPointToPolyline(gps, index.flatPath);
  if (!proj) return { index: 0, offRouteMi: Infinity };

  // Find the path segment whose midpoint is closest to the projected
  // coord — that segment's cumulative-mile mark gives us the user's
  // along-route distance. Cheaper than re-running the projection math;
  // we already know it landed *somewhere* on flatPath.
  const p = proj.coord;
  let bestVertex = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < index.flatPath.length; i++) {
    const v = index.flatPath[i];
    const dx = v[0] - p[0];
    const dy = v[1] - p[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestVertex = i;
    }
  }
  const userMi = index.vertexMi[bestVertex];

  // Locate the step that owns this mile mark. startMi is monotonically
  // non-decreasing, so a linear scan is fine for typical step counts
  // (~50-200). Could binary search if a leg ever pushes 1000+ steps.
  let stepIdx = 0;
  for (let i = 0; i < index.startMi.length; i++) {
    if (userMi >= index.startMi[i]) stepIdx = i;
    else break;
  }
  return { index: stepIdx, offRouteMi: proj.distanceMi };
}

/** For the "open from waypoint" path: find the step whose start coord
 *  is closest to the waypoint's coord. Used to auto-scroll the panel
 *  to a contextual position rather than always landing on step 0. */
export function stepNearestCoord(
  target: [number, number],
  steps: DirectionStep[],
): number {
  let bestIdx = 0;
  let bestMi = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const first = steps[i].coords[0];
    if (!first) continue;
    const d = haversineMi(target, first);
    if (d < bestMi) {
      bestMi = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
