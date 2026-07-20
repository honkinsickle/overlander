/**
 * Manual-edit day reorder (local, unpersisted). Pure logic: move a day, then
 * renumber + redate by position and work out which days need their
 * miles/driveHours re-routed. The caller runs the async `routeBetween` for
 * `toRecompute` and merges the results with `applyRecompute`.
 *
 * Model (established in the living-plan investigation): a day's END is its own
 * overnight (travels with the day when it moves); its START is wherever the
 * PREVIOUS day now ends (position 0 starts at the trip origin). So reordering
 * only changes STARTS — a day's drive is re-routed iff its chain-start moved.
 * Dwell days (own start city == end city) hold excursion miles that a
 * city-to-city route can't reproduce, so they carry forward unchanged.
 */

import type { Day } from "@/lib/trips/types";

type LngLat = [number, number];

/** Add `n` days to an ISO date (UTC, no TZ drift). */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Move item `from` → `to`. Pure. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function nodeCoord(day: Day, kind: "start" | "end"): LngLat | null {
  return day.corridorCities?.find((n) => n.kind === kind)?.coords ?? null;
}

function coordEq(a: LngLat | null, b: LngLat | null): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** A dwell/layover day — its own start city equals its end city, so its miles
 *  are an excursion, not a city-to-city drive. Reorder carries them forward. */
export function isDwellDay(day: Day): boolean {
  return coordEq(nodeCoord(day, "start"), nodeCoord(day, "end")) &&
    nodeCoord(day, "start") !== null;
}

/** dayId → the day's START coord in this ordering: position 0 starts at the
 *  trip origin, every other day starts where the previous day ended. */
function chainStarts(
  days: Day[],
  origin: LngLat | null,
): Map<string, LngLat | null> {
  const m = new Map<string, LngLat | null>();
  for (let i = 0; i < days.length; i++) {
    m.set(days[i].id, i === 0 ? origin : nodeCoord(days[i - 1], "end"));
  }
  return m;
}

export type RecomputeReq = { id: string; start: LngLat; end: LngLat };

export type ReorderResult = {
  /** Reordered days with dayNumber + date reassigned by position. `id` and
   *  content (incl. the pre-move miles) are untouched — miles are refreshed
   *  by the caller after routing `toRecompute`. */
  reordered: Day[];
  /** Non-dwell days whose chain-start moved → need a routeBetween recompute. */
  toRecompute: RecomputeReq[];
};

/**
 * Move a day and reassign numbers/dates by position; return the days that need
 * re-routing. Pure.
 *   - dayNumber = position + 1; date = startDate + position days (each day,
 *     dwell included, consumes one calendar day — same rule as the numbers).
 *   - `id` is kept stable (selection + drag identity key off it).
 *   - a day is queued for recompute iff its chain-start moved AND it isn't a
 *     dwell day AND both endpoints resolve; everything else carries forward.
 */
export function reorderDays(
  days: Day[],
  from: number,
  to: number,
  startDate: string,
  origin: LngLat | null,
): ReorderResult {
  const moved = moveItem(days, from, to);
  const oldStart = chainStarts(days, origin);
  const newStart = chainStarts(moved, origin);

  const reordered: Day[] = moved.map((d, i) => ({
    ...d,
    dayNumber: i + 1,
    date: addDaysISO(startDate, i),
  }));

  const toRecompute: RecomputeReq[] = [];
  for (const d of reordered) {
    if (isDwellDay(d)) continue; // excursion miles — carry forward
    const start = newStart.get(d.id) ?? null;
    const end = nodeCoord(d, "end");
    if (!start || !end) continue; // unroutable — carry forward
    if (!coordEq(start, oldStart.get(d.id) ?? null)) {
      toRecompute.push({ id: d.id, start, end });
    }
  }
  return { reordered, toRecompute };
}

/** Merge recomputed miles/driveHours (by id) onto the reordered days. A leg
 *  that failed to route (no miles) leaves the day's existing numbers. */
export function applyRecompute(
  days: Day[],
  results: { id: string; miles?: number; driveHours?: number }[],
): Day[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return days.map((d) => {
    const r = byId.get(d.id);
    return r && r.miles !== undefined
      ? { ...d, miles: r.miles, driveHours: r.driveHours }
      : d;
  });
}
