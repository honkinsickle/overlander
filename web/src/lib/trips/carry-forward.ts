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
