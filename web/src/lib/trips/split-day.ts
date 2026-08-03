/**
 * Subdivide-a-leg (structural day split) — the PURE core. Cut day X (A→B) at an
 * interior point M into two sequential days A→M and M→B; all days after B keep
 * their exact endpoints. No Mapbox, no DB — data in, data out. The repository
 * wrapper (`splitDay`) drives the geometry (recomputeDay ×2, routePolyline
 * rebuild) around this and does the single guarded write.
 *
 * PARTITION (directive 1). Tiles are split by the along-corridor predicate, NOT
 * re-queried from the DB — a re-query would lose the day's tier-2 curated tiles,
 * which cannot be re-fetched because bake cannot re-run. Each tile projects onto
 * the original day's start→end CHORD (the same API-free ordering proxy
 * recompute-day.ts uses for waypoints); a tile with along-mile `<= mSplit` goes
 * to A, else B. Total function over the tile set → zero loss, zero duplication.
 *
 * AUTHORED CONTENT stays with half A (description, weather, notes, overnight,
 * heroImage, suggestions); half B is SPARSE — a note written for one leg is not
 * true of the other, and we never duplicate or fabricate. LABELS are the one
 * exception to "stays with A": each half's label is derived from its ACTUAL
 * endpoints (`start — M`, `M — end`), because `recomputeDay` parses `day.label`
 * to name the corridor spine — a label naming B on a day that now ends at M would
 * both lie and mis-derive the spine. (Flagged deviation; see PR.)
 *
 * RENUMBER + REDATE (directive). The existing tail shifts `day-N → day-N+1` and
 * `date + 1`; B slots into the vacated N+1. A keeps its id, number, and date.
 * Positional ids only — no uuid minting (that is the unbuilt dayAssignment work).
 */
import type { Trip, Day } from "./types";
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import { addDaysISO } from "./reorder-days";
import { rescopeOverlays } from "@/lib/corridor/rescope-overlays";

type LngLat = [number, number];

/** One offered split point plus where along the day it falls (for the picker). */
export type SplitCandidate = { point: SplitPoint; atMile: number };

export type SplitEligibility = {
  /** Interior stops the day can be cut at, ordered start→end. Empty ⇒ un-splittable. */
  candidates: SplitCandidate[];
  /** The day's start→end length in miles — positioning context for the picker. */
  dayMiles: number;
  /** Null when the day is splittable; otherwise the reason to show on the DISABLED
   *  "Split this day" kebab item (rather than opening an overlay just to say no). */
  disabledReason: string | null;
};

const SPLIT_NO_ROUTE = "This day has no route to split.";
const SPLIT_IS_LAYOVER = "A rest day can't be split.";
const SPLIT_NO_INTERIOR_STOP = "No stop on this day to split at.";

/**
 * Which of a day's OWN stops can serve as a split point — and, when none can, why
 * "Split this day" is disabled. A split needs an INTERIOR cut: a stop that projects
 * strictly between the day's start and end along the start→end chord (the same
 * API-free proxy `buildSplitStructure` partitions on). A stop at an endpoint, and a
 * zero-length (layover) day, yield nothing. Stop-sourced only — no geocoding — so a
 * day with no interior stop is honestly un-splittable here, not silently broken.
 *
 * Pure. The eligibility test the disabled-kebab and the picker both read from.
 */
export function splitEligibility(trip: Trip, dayId: string): SplitEligibility {
  const empty = (disabledReason: string): SplitEligibility => ({
    candidates: [],
    dayMiles: 0,
    disabledReason,
  });
  const i = trip.days.findIndex((d) => d.id === dayId);
  if (i === -1) return empty(SPLIT_NO_ROUTE);
  const day = trip.days[i];
  const end = day.coords;
  const start =
    day.startCoord ?? (i === 0 ? trip.startCoords : trip.days[i - 1].coords);
  if (!start || !end) return empty(SPLIT_NO_ROUTE);
  if (start[0] === end[0] && start[1] === end[1]) return empty(SPLIT_IS_LAYOVER);
  const chord: LngLat[] = [start, end];
  const L = alongRouteMiles(end, chord)?.miles ?? 0;
  if (L <= 0) return empty(SPLIT_IS_LAYOVER);

  const EPS = 1e-6;
  const seen = new Set<string>();
  const candidates: SplitCandidate[] = [];
  const stops: { coords?: LngLat; name: string }[] = [
    ...day.waypoints.map((w) => ({ coords: w.coords, name: w.title })),
    ...(day.segmentSuggestions ?? []).map((p) => ({ coords: p.coords, name: p.title })),
  ];
  for (const s of stops) {
    if (!s.coords) continue;
    const m = alongRouteMiles(s.coords, chord)?.miles ?? 0;
    if (m <= EPS || m >= L - EPS) continue; // endpoint or outside → not interior
    const key = `${s.coords[0]},${s.coords[1]}`;
    if (seen.has(key)) continue; // one candidate per location
    seen.add(key);
    candidates.push({ point: { coords: s.coords, name: s.name }, atMile: Math.round(m) });
  }
  candidates.sort((a, b) => a.atMile - b.atMile);
  return {
    candidates,
    dayMiles: Math.round(L),
    disabledReason: candidates.length === 0 ? SPLIT_NO_INTERIOR_STOP : null,
  };
}

/** The interior cut point. `coords` drives routing + partition; `name` names both
 *  halves' shared endpoint. */
export type SplitPoint = { coords: LngLat; name: string };

export type SplitStructure = { trip: Trip; halfAId: string; halfBId: string };

/** A day's stop POOL ids (segmentSuggestions ∪ suggestions ∪ waypoints) — the
 *  membership set rescopeOverlays checks. Parallel to curated-place.ts. */
function poolIds(day: Day): string[] {
  return [
    ...(day.segmentSuggestions ?? []).map((p) => p.id),
    ...Object.values(day.suggestions ?? {})
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => p.id),
    ...day.waypoints.map((w) => w.id),
  ];
}

/**
 * Re-scope the trip's overlays against its day layout, dropping entries whose
 * stop no longer has a valid home. MUST run AFTER `recomputeDay` has rebuilt both
 * halves' `corridorCities` — the node ids it checks come from them; running it on
 * the freshly-split (node-less) halves would drop every overlay on the split day.
 * Pool membership comes from the post-split arrays. Pure.
 */
export function rescopeTripOverlays(next: Trip): Trip {
  const { placeRanks, placeOverrides } = rescopeOverlays(
    {
      placeRanks: next.placeRanks ?? {},
      placeOverrides: next.placeOverrides ?? [],
    },
    next.days.map((d) => ({
      placeIds: poolIds(d),
      nodeIds: (d.corridorCities ?? []).map((c) => c.id),
    })),
  );
  return { ...next, placeRanks, placeOverrides };
}

/**
 * Build the post-split day structure. Returns the trip with A→M / M→B and the
 * renumbered tail, plus the two halves' ids — but with NO geometry yet (the
 * halves' miles/driveHours/corridorCities are cleared; the caller fills them via
 * recomputeDay, THEN calls `rescopeTripOverlays`). Returns null if the day isn't
 * found or lacks the coords needed to split.
 */
export function buildSplitStructure(
  trip: Trip,
  dayId: string,
  split: SplitPoint,
): SplitStructure | null {
  const next = structuredClone(trip);
  const idx = next.days.findIndex((d) => d.id === dayId);
  if (idx === -1) return null;
  const day = next.days[idx];
  const end = day.coords;
  const start =
    day.startCoord ?? (idx === 0 ? next.startCoords : next.days[idx - 1].coords);
  if (!start || !end) return null; // can't split a day with no start/end coord

  // Along-corridor partition predicate over the API-free start→end chord.
  const chord: LngLat[] = [start, end];
  const mSplit = alongRouteMiles(split.coords, chord)?.miles ?? 0;
  const along = (c?: LngLat): number =>
    c ? alongRouteMiles(c, chord)?.miles ?? 0 : 0;
  // A tile/waypoint goes to B iff it projects strictly past M; ties and
  // coord-less tiles stay with A (the authored half). Total → zero loss/dup.
  const toB = (c?: LngLat): boolean => !!c && along(c) > mSplit;

  const tiles = day.segmentSuggestions ?? [];
  const aTiles = tiles.filter((t) => !toB(t.coords));
  const bTiles = tiles.filter((t) => toB(t.coords));
  const aWaypoints = day.waypoints.filter((w) => !toB(w.coords));
  const bWaypoints = day.waypoints.filter((w) => toB(w.coords));

  const parts = day.label.split(" — ");
  const startName = parts[0];
  const endName = parts.length > 1 ? parts[parts.length - 1] : day.label;

  // Half A — mutate the original day in place; authored content stays.
  day.coords = split.coords; // A now ends at M
  day.label = `${startName} — ${split.name}`;
  day.waypoints = aWaypoints;
  day.segmentSuggestions = aTiles;
  // Clear stale A→B geometry — recomputeDay refills; a null result then leaves
  // an honest two-node fallback, never the wrong pre-split figures.
  delete day.miles;
  delete day.driveHours;
  delete day.corridorCities;

  // Half B — sparse. No description/weather/notes/overnight/heroImage/suggestions.
  const halfB: Day = {
    id: `day-${day.dayNumber + 1}`,
    dayNumber: day.dayNumber + 1,
    date: addDaysISO(day.date, 1),
    label: `${split.name} — ${endName}`,
    startCoord: split.coords,
    coords: end,
    waypoints: bWaypoints,
    segmentSuggestions: bTiles,
  };

  // Shift the existing tail (day-N → day-N+1, date +1) BEFORE inserting B, so B
  // slots cleanly into the vacated number. A keeps its id/number/date.
  for (let i = idx + 1; i < next.days.length; i++) {
    next.days[i].dayNumber += 1;
    next.days[i].id = `day-${next.days[i].dayNumber}`;
    next.days[i].date = addDaysISO(next.days[i].date, 1);
  }
  next.days.splice(idx + 1, 0, halfB);

  return { trip: next, halfAId: day.id, halfBId: halfB.id };
}
