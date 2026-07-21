import type { Trip } from "./types";

/**
 * Carry user-authored overlays — node seeds + POI overrides — from the
 * PREVIOUS trip onto a freshly REGENERATED one.
 *
 * Regeneration rebuilds `days` (and the rest of the body) from the generator,
 * which never emits these overlays, so they must be copied forward or they
 * vanish by omission at persist — the exact failure mode that lost
 * routePolyline and per-day coords before. The generated trip wins on all
 * generated content; only the two user-authored fields are carried.
 *
 * The regeneration action MUST route its result through this — that contract
 * is locked by carry-forward.test.ts, not by discipline. Pure.
 */
export function carryUserAuthored(prev: Trip, regenerated: Trip): Trip {
  return {
    ...regenerated,
    nodeSeeds: prev.nodeSeeds ?? regenerated.nodeSeeds,
    placeOverrides: prev.placeOverrides ?? regenerated.placeOverrides,
  };
}

/**
 * Fail-loud guard for the regeneration persist path: throws if `original`
 * carried user-authored overlays that `next` (about to be persisted) lost —
 * i.e. carryUserAuthored() was NOT applied. Dormant until seeds can be created
 * (nothing does yet), then it converts a silent drop into a hard error at the
 * exact persist site, so the carry can't be forgotten when the write-actions
 * slice ships. Call immediately before persisting a regenerated trip.
 */
export function assertUserAuthoredCarried(original: Trip, next: Trip): void {
  const lost: string[] = [];
  if ((original.nodeSeeds?.length ?? 0) > 0 && (next.nodeSeeds?.length ?? 0) === 0) {
    lost.push("nodeSeeds");
  }
  if (
    (original.placeOverrides?.length ?? 0) > 0 &&
    (next.placeOverrides?.length ?? 0) === 0
  ) {
    lost.push("placeOverrides");
  }
  if (lost.length > 0) {
    throw new Error(
      `Regeneration would drop user-authored ${lost.join(" + ")} — ` +
        `wrap the regenerated trip in carryUserAuthored(previous, regenerated) ` +
        `before persisting (see src/lib/trips/carry-forward.ts).`,
    );
  }
}
