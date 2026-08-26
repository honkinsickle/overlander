import { deriveCorridorCities, type GazetteerCity } from "./derive";
import defaultGazetteer from "./data/gazetteer";
import { haversineMi } from "@/lib/routing/point-to-polyline";
import type { CorridorCity } from "@/lib/trips/types";

/**
 * The ONE per-day corridor-spine derivation, shared by the WRITE-time render
 * (`bake.ts`) and the backfill AUDIT (`audit.ts`).
 *
 * WHY THIS EXISTS. The audit used to draw its backfill anchors from
 * `facts.corridorCities`, which `preComputeFacts` derives over the WHOLE route
 * — coarse, well-spaced cities only (the `maxNodes`/`minSpacingMi` cap thins a
 * long route hard). The itinerary, meanwhile, RENDERS a finer per-day spine
 * that `bake.ts` derives over each day's shorter segment. A city on the day
 * spine but dropped from the whole-route spine (measured: Oceanside ~38mi from
 * San Diego; Arvin ~16mi from Bakersfield) was therefore a visible node the
 * backfill never even considered — `pickBackfillStops` was never called for it.
 *
 * Routing both bake and the audit through this single function keeps the two
 * spines from drifting apart again the way the whole-route/per-day split did.
 * `deriveCorridorCities` is pure and takes the gazetteer as a param; this
 * wrapper binds the bundled gazetteer (overridable for tests) and coalesces the
 * null "no corridor" result to `[]`.
 */
export function deriveDayCorridor(
  line: [number, number][],
  start: { name: string; coords: [number, number] },
  end: { name: string; coords: [number, number] },
  gazetteer: GazetteerCity[] = defaultGazetteer as GazetteerCity[],
): CorridorCity[] {
  return deriveCorridorCities({ line, start, end, gazetteer }) ?? [];
}

/** One backfill anchor: a day-start or a mid-corridor city, in travel order. */
export type DayAnchorCity = {
  coords: [number, number];
  label: string;
  kind: "start" | "corridor";
};

/**
 * The backfill anchor list for ONE day: the start anchor first, then each
 * per-day corridor city the day passes, in travel order.
 *
 * Mid-corridor cities within `nearMi` of EITHER endpoint are dropped — the
 * start is its own anchor and the end node hosts the overnight, so a curated
 * stop there is closer to duplication than coverage (the same endpoint rule the
 * audit has always applied; it is what correctly excludes a city like Arvin
 * that sits within `ANCHOR_NEAR_MI` of the day's end). Absent/short polyline or
 * no end coord ⇒ just the start anchor, exactly as before.
 *
 * Shared by the interest-guarantee backfill AND the fuel backfill so the two
 * cannot diverge on which cities are eligible.
 */
export function dayCorridorAnchors(
  input: {
    line: [number, number][] | null;
    startCoord: [number, number];
    endCoord: [number, number] | null;
    startPlace: string;
    endPlace: string;
    nearMi: number;
  },
  gazetteer?: GazetteerCity[],
): DayAnchorCity[] {
  const { line, startCoord, endCoord, startPlace, endPlace, nearMi } = input;
  const start: DayAnchorCity = { coords: startCoord, label: startPlace, kind: "start" };
  if (!line || line.length < 2 || !endCoord) return [start];

  const endpoints: [number, number][] = [startCoord, endCoord];
  const corridor = deriveDayCorridor(
    line,
    { name: startPlace, coords: startCoord },
    { name: endPlace, coords: endCoord },
    gazetteer,
  )
    .filter((c) => c.kind === "corridor")
    .filter((c) => !endpoints.some((e) => haversineMi(c.coords, e) <= nearMi))
    .sort((a, b) => a.milesFromStart - b.milesFromStart)
    .map((c) => ({ coords: c.coords, label: c.name, kind: "corridor" as const }));

  return [start, ...corridor];
}
