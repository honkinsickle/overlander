/**
 * Split a routed `Route` (from route-between.ts) into day-sized segments
 * that respect a user's daily driving pace. Pure function — no IO, no
 * Mapbox calls.
 *
 * Used by the wizard's `loader` finalize step to produce the initial
 * N-day breakdown of a user-built trip. Re-segmenting after user
 * adjustments (drag a day endpoint, hit "end of day" early/late) is a
 * future operation: call `routeBetween` for the remaining sub-route,
 * then `segmentByPace` again.
 *
 * Boundary rule: **split mid-step at the limit.** Mapbox emits steps as
 * coarse, atomic turn-by-turn instructions ("Continue on I-5 N for 519
 * mi"). Including or excluding whole steps produces wildly uneven days
 * on long-highway routes, so when a step would push us past the limit
 * we walk its `geometry` polyline and slice it at the coordinate that
 * lands closest to the limit using haversine distance. The remainder
 * becomes the first step of the next day.
 *
 * Edge cases:
 *  - A step with <2 coords can't be split — falls back to "force
 *    include whole step on the current day."
 *  - A route whose total stays under the limit returns one day.
 *  - A very long step at a small pace yields multiple synthesized
 *    sub-step days from that one Mapbox step.
 */

import type { LngLat, Route, RouteStep } from "./route-between";

export type Pace = {
  /** Hard cap on driving seconds per day. */
  maxDurationS?: number;
  /** Hard cap on driving meters per day. */
  maxDistanceM?: number;
};

export type DaySegment = {
  /** 1-based for display. */
  index: number;
  /** Geojson `[lng, lat]` of where this day's driving starts. */
  startCoord: LngLat;
  /** Geojson `[lng, lat]` of where this day's driving ends (i.e. where
   *  the user sleeps). */
  endCoord: LngLat;
  /** Distance driven this day in meters. */
  distanceM: number;
  /** Driving duration this day in seconds. */
  durationS: number;
  /** Decoded polyline for this day's slice of the trip. */
  coordinates: LngLat[];
  /** The route steps that fell in this day, in driving order. May
   *  include synthesized split-step fragments when a Mapbox step
   *  spanned a day boundary. */
  steps: RouteStep[];
};

export class SegmentByPaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentByPaceError";
  }
}

/** Split `route` into day-sized segments under the given pace cap. */
export function segmentByPace(route: Route, pace: Pace): DaySegment[] {
  const hasDuration = typeof pace.maxDurationS === "number";
  const hasDistance = typeof pace.maxDistanceM === "number";
  if (hasDuration === hasDistance) {
    throw new SegmentByPaceError(
      "segmentByPace requires exactly one of maxDurationS or maxDistanceM",
    );
  }
  const limit = (hasDuration ? pace.maxDurationS : pace.maxDistanceM) as number;
  if (!(limit > 0)) {
    throw new SegmentByPaceError(`pace limit must be > 0, got ${limit}`);
  }
  if (!route.steps.length) {
    throw new SegmentByPaceError("route has no steps");
  }

  const valueOf = (s: RouteStep): number =>
    hasDuration ? s.durationS : s.distanceM;

  const days: RouteStep[][] = [];
  let currentDay: RouteStep[] = [];
  let runningTotal = 0;
  let i = 0;
  let pending: RouteStep | null = null;

  while (i < route.steps.length || pending) {
    const step = pending ?? route.steps[i];
    if (!pending) i++;
    pending = null;

    const stepValue = valueOf(step);
    if (runningTotal + stepValue <= limit) {
      currentDay.push(step);
      runningTotal += stepValue;
      continue;
    }

    // This step would push us past the limit. Try to split it at the
    // exact limit so the day lands on it. `splitStep` returns
    // `[before, after]` where `before` fills out the current day.
    const targetWithinStep = limit - runningTotal;
    const [before, after] = splitStep(step, targetWithinStep, hasDistance);

    if (before.geometry.length === 0) {
      // Step had no usable geometry to split on (Mapbox sometimes emits
      // zero-length turn steps). Include whole step on current day,
      // then close the day.
      currentDay.push(step);
      days.push(currentDay);
      currentDay = [];
      runningTotal = 0;
      continue;
    }

    currentDay.push(before);
    days.push(currentDay);
    currentDay = [];
    runningTotal = 0;
    if (after.geometry.length > 0 && (after.distanceM > 0 || after.durationS > 0)) {
      pending = after;
    }
  }

  if (currentDay.length > 0) {
    days.push(currentDay);
  }

  return days.map((steps, idx) => buildDay(steps, idx + 1));
}

/** Earth-surface distance between two `[lng, lat]` points in meters. */
function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Slice a route step at the coordinate closest to `targetWithinStep`
 *  units (seconds if !byDistance, meters if byDistance) from its start.
 *  Returns `[before, after]`. If the step has too few geometry coords
 *  to split, returns `before` with empty geometry — caller should fall
 *  back to including the whole step. */
function splitStep(
  step: RouteStep,
  targetWithinStep: number,
  byDistance: boolean,
): [RouteStep, RouteStep] {
  const geo = step.geometry;
  if (geo.length < 2) {
    return [
      { distanceM: 0, durationS: 0, geometry: [] },
      step,
    ];
  }

  // Convert the target into meters so we can walk haversine distance
  // along the geometry. For duration-based pace we assume uniform speed
  // within the step (Mapbox's `step.distance / step.duration`).
  const targetM = byDistance
    ? targetWithinStep
    : step.distanceM * (targetWithinStep / step.durationS);

  let cum = 0;
  let splitIdx = geo.length - 1;
  let beforeDistanceM = step.distanceM;
  for (let i = 1; i < geo.length; i++) {
    const seg = haversine(geo[i - 1], geo[i]);
    const next = cum + seg;
    if (next >= targetM) {
      // Pick whichever side of this segment is closer to the target.
      if (Math.abs(cum - targetM) <= Math.abs(next - targetM)) {
        splitIdx = i - 1;
        beforeDistanceM = cum;
      } else {
        splitIdx = i;
        beforeDistanceM = next;
      }
      break;
    }
    cum = next;
  }

  // splitIdx of 0 means "split immediately"; treat as no-split.
  if (splitIdx <= 0) {
    return [
      { distanceM: 0, durationS: 0, geometry: [] },
      step,
    ];
  }

  // Duration scales proportionally with achieved distance. (Mapbox
  // steps have one speed inside them, so distance-ratio === duration-
  // ratio.)
  const fraction = step.distanceM > 0 ? beforeDistanceM / step.distanceM : 0;
  const beforeDurationS = step.durationS * fraction;

  const before: RouteStep = {
    distanceM: beforeDistanceM,
    durationS: beforeDurationS,
    geometry: geo.slice(0, splitIdx + 1),
  };
  const after: RouteStep = {
    distanceM: step.distanceM - beforeDistanceM,
    durationS: step.durationS - beforeDurationS,
    geometry: geo.slice(splitIdx),
  };
  return [before, after];
}

/** Materialize one DaySegment from a sequence of (possibly synthesized)
 *  route steps. */
function buildDay(steps: RouteStep[], oneBasedIndex: number): DaySegment {
  let distanceM = 0;
  let durationS = 0;
  for (const s of steps) {
    distanceM += s.distanceM;
    durationS += s.durationS;
  }

  // Merge step geometries into one polyline for the day, deduping the
  // seam point where consecutive steps share an endpoint.
  const coordinates: LngLat[] = [];
  for (const s of steps) {
    if (!s.geometry.length) continue;
    if (coordinates.length === 0) {
      coordinates.push(...s.geometry);
      continue;
    }
    const lastEmitted = coordinates[coordinates.length - 1];
    const firstNew = s.geometry[0];
    const seamMatches =
      lastEmitted[0] === firstNew[0] && lastEmitted[1] === firstNew[1];
    coordinates.push(...(seamMatches ? s.geometry.slice(1) : s.geometry));
  }

  return {
    index: oneBasedIndex,
    startCoord: coordinates[0],
    endCoord: coordinates[coordinates.length - 1],
    distanceM,
    durationS,
    coordinates,
    steps,
  };
}
