/**
 * Cross-day node-seed resolution (spec § node-stack model).
 *
 * A user-authored NodeSeed is positioned by RE-PROJECTING its coords onto the
 * route every derivation — never by a stored day/mile — so it survives day
 * boundaries moving on regeneration. This module owns that projection and the
 * cross-day arbitration; deriveCorridorCities only splices the result in.
 *
 * The out-and-back / loop rule (the ambiguity Day 6 Stewart→Salmon
 * Glacier→Stewart raises): a seed's coords can project onto more than one
 * day's line. The winner is the day whose route the seed sits CLOSEST to —
 * minimum perpendicular offset. Days are scanned in trip order and a later day
 * only wins on a STRICT improvement, so an exact tie keeps the EARLIER day.
 * Chosen over "first match" (would attach a seed to a day it's 14 mi off over
 * one it's on) and over a day hint (day identity is regenerated output — a hint
 * would reintroduce the exact fragility seeds exist to avoid). Within a single
 * day, alongRouteMiles already collapses an out-and-back's double pass to one
 * nearest projection (the outbound pass, scanned first), so a seed yields at
 * most one node per day.
 *
 * A seed that projects onto NO day within the corridor buffer is reported
 * `resolved:false` — dormant, not silently dropped (silent loss is the class
 * of bug this signal exists to prevent).
 *
 * Pure, no I/O.
 */
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import type { LngLat } from "@/lib/routing/route-between";
import type { NodeSeed, SeedResolution } from "@/lib/trips/types";
import { DEFAULT_CORRIDOR_PARAMS, type PositionedSeed } from "./derive";

export function resolveSeeds(input: {
  /** Sliceable day lines, IN TRIP ORDER (order decides tie-breaks). */
  days: { id: string; line: LngLat[] }[];
  seeds: NodeSeed[];
  /** On-corridor gate — a seed must project within this many miles of a day's
   *  route to attach to it. Defaults to the shared corridor buffer. */
  bufferMi?: number;
}): { byDay: Map<string, PositionedSeed[]>; resolutions: SeedResolution[] } {
  const buffer = input.bufferMi ?? DEFAULT_CORRIDOR_PARAMS.bufferMi;
  const days = input.days.filter((d) => d.line.length >= 2);
  const byDay = new Map<string, PositionedSeed[]>();
  const resolutions: SeedResolution[] = [];

  for (const seed of input.seeds) {
    if (days.length === 0) {
      resolutions.push({ seedId: seed.id, resolved: false, reason: "no-days" });
      continue;
    }

    let best: { dayId: string; miles: number; offset: number } | null = null;
    for (const day of days) {
      const r = alongRouteMiles(seed.coords, day.line);
      if (!r || r.offsetMi > buffer) continue; // off this day's corridor
      // Strict-less-than: an exact offset tie keeps the earlier (already-set) day.
      if (!best || r.offsetMi < best.offset) {
        best = { dayId: day.id, miles: r.miles, offset: r.offsetMi };
      }
    }

    if (!best) {
      resolutions.push({
        seedId: seed.id,
        resolved: false,
        reason: "off-corridor",
      });
      continue;
    }

    const positioned: PositionedSeed = {
      id: seed.id,
      name: seed.name,
      coords: seed.coords,
      milesFromStart: best.miles,
    };
    const arr = byDay.get(best.dayId);
    if (arr) arr.push(positioned);
    else byDay.set(best.dayId, [positioned]);

    resolutions.push({
      seedId: seed.id,
      resolved: true,
      dayId: best.dayId,
      milesFromStart: best.miles,
      offsetMi: best.offset,
    });
  }

  return { byDay, resolutions };
}
