/**
 * Simple before/after plan diff for the re-plan approval sheet (living-plan
 * MVP): compares the two day tables and summarizes what changed — the pinned
 * target, whether the trip endpoints held, layover count, and which overnight
 * stops appeared/disappeared. Pure + test-locked; the fancy per-day ripple
 * view is a later tier.
 */

import type { Day } from "@/lib/trips/types";

export type ReplanDiff = {
  pinned: { place: string; date: string };
  endpointsHeld: { start: boolean; end: boolean };
  layovers: { before: number; after: number };
  /** Overnight stops present after but not before (by day-end place). */
  stopsAdded: string[];
  /** Overnight stops present before but not after. */
  stopsRemoved: string[];
  /** The re-planned day table, for the sheet's listing. */
  days: { date: string; miles: number; label: string }[];
};

type DayLite = Pick<Day, "date" | "miles" | "label">;

/** A day's end place — the overnight — from its "Start — End" label. */
function endPlace(d: DayLite): string {
  const parts = d.label.split("—");
  return (parts[parts.length - 1] ?? d.label).trim();
}

/** Layover = a day that ends where it starts (out-and-back or 0-mi rest). */
function isLayover(d: DayLite): boolean {
  const parts = d.label.split("—").map((s) => s.trim());
  return parts.length === 2 && parts[0] === parts[1];
}

export function computePlanDiff(
  before: DayLite[],
  after: DayLite[],
  pinned: { place: string; date: string },
): ReplanDiff {
  const beforeStops = new Set(before.map(endPlace));
  const afterStops = new Set(after.map(endPlace));

  return {
    pinned,
    endpointsHeld: {
      start: before[0]?.date === after[0]?.date,
      end: before[before.length - 1]?.date === after[after.length - 1]?.date,
    },
    layovers: {
      before: before.filter(isLayover).length,
      after: after.filter(isLayover).length,
    },
    stopsAdded: [...afterStops].filter((s) => !beforeStops.has(s)),
    stopsRemoved: [...beforeStops].filter((s) => !afterStops.has(s)),
    days: after.map((d) => ({ date: d.date, miles: d.miles ?? 0, label: d.label })),
  };
}
