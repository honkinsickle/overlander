/**
 * Stage-1 fact pre-compute (spec §8.2, the [ENGINE] block).
 *
 *   anchors + params + rig
 *        │
 *        ▼
 *   geocode anchors → routeBetween(anchor chain) → segmentByPace (baseline
 *   day count) → deriveCorridorCities (city spine) → per-segment corpus fold
 *   (available POIs) → EngineFacts
 *
 * EngineFacts is the GROUND TRUTH fed to the LLM. The model reasons over it
 * (pacing, sequencing, overnight choice) but never invents routes, distances,
 * or POIs — every recommendation must reference a `poolPOIs[].id`.
 *
 * Reuses shipped substrate verbatim: `geocode`, `routeBetween`,
 * `segmentByPace`, `deriveCorridorCities`, and the per-segment corpus fold
 * (`fetchCorpusForSegment`) — the same calls `buildRouteAwareDays` makes.
 */

import { geocode } from "@/lib/routing/geocode";
import { routeBetween } from "@/lib/routing/route-between";
import { segmentByPace } from "@/lib/routing/segment-by-pace";
import { deriveCorridorCities } from "@/lib/corridor/derive";
import { fetchCorpusForSegment } from "@/lib/trips/bake-corridors";
import gazetteer from "@/lib/corridor/data/cities-na.json";
import type { GazetteerCity } from "@/lib/corridor/derive";
import type { CorridorCity } from "@/lib/trips/types";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const METERS_PER_MILE = 1609.34;

export type DatePin = "fixed" | "flexible" | "window";
export type AnchorRole = "start" | "waypoint" | "end";

/** One row of the anchor list (spec §8.1). */
export type Anchor = {
  /** Geocodable place label, e.g. "Dawson City, YT". */
  place: string;
  role: AnchorRole;
  datePin: DatePin;
  /** ISO date; required when datePin is fixed/window. */
  date: string | null;
  /** Dwell days: 0 = pass-through, 1+ = layover. */
  dwell: number;
  /** Short note ("wildlife centerpiece"). */
  note: string | null;
  /** `[lng,lat]` when the user PICKED a real place in the wizard's
   *  autocomplete — used verbatim so an ambiguous label ("Boya Lake, BC")
   *  can't fuzzy-geocode to the wrong place. Falls back to geocode(place)
   *  when absent. */
  coords?: [number, number];
};

/** Trip params (spec §01 / §8.1). */
export type TripParams = {
  startDate: string;
  endDate: string | null;
  budget: "budget" | "mid" | "premium";
  /** Max daily drive in miles → segmentByPace pace. */
  maxDailyDriveMi: number;
  bufferDays: number;
  avoid: string[];
  returnRouting: "shortest" | "scenic" | "same" | "loop";
};

/** Rig profile (spec §02) — normally a saved profile on the user. */
export type RigProfile = {
  vehicle: string;
  build: string[];
  /** Fuel range in miles — drives fuel-gap detection. */
  fuelRangeMi: number;
  capability: "mild" | "moderate" | "avoid-hardcore";
  groupSize: string;
  skill: string;
  preferences: string[];
};

export type GenerationInput = {
  anchors: Anchor[];
  params: TripParams;
  rig: RigProfile;
  /** Optional free-text trip intent/vibe (reference-doc §01 Objective).
   *  Prompt CONTEXT only — the engine never consumes it, so it is not a
   *  preComputeFacts input; it rides along to buildFactsMessage. */
  objective?: string;
};

/** A pooled POI, trimmed to what the LLM needs to reason + reference. */
export type PoolPOI = {
  id: string;
  name: string;
  category: string | null;
  coords: [number, number];
  rating: number | null;
  priceTier: number | null;
  tags: string[] | null;
};

/** One baseline segment from segmentByPace (a pacing seed, not the final day). */
export type BaselineSegment = {
  index: number;
  startCoord: [number, number];
  endCoord: [number, number];
  distanceMi: number;
  driveHours: number;
};

/** The GROUND TRUTH handed to the LLM. */
export type EngineFacts = {
  anchorsResolved: {
    place: string;
    role: AnchorRole;
    datePin: DatePin;
    date: string | null;
    dwell: number;
    note: string | null;
    coords: [number, number];
  }[];
  route: {
    totalMi: number;
    totalDriveHours: number;
    /** segmentByPace's minimum feasible driving-day count under the cap. */
    baselineDriveDays: number;
    segments: BaselineSegment[];
  };
  corridorCities: CorridorCity[];
  poolPOIs: PoolPOI[];
};

function toPoolPOI(p: BrowsePlace): PoolPOI {
  return {
    id: p.id,
    name: p.title,
    category: p.category ?? null,
    coords: p.coords,
    rating: p.rating ?? null,
    priceTier: p.priceTier ?? null,
    tags: p.overlanderTags ?? null,
  };
}

/**
 * Pre-compute the engine facts for a set of anchors + params.
 *
 * Throws on unroutable input or a missing Mapbox token (surfaced to the
 * caller — a generation with no route is meaningless). The corpus fold fails
 * soft: a POI-less pool still yields a valid (if sparse) grounding.
 */
export async function preComputeFacts(
  input: GenerationInput,
): Promise<EngineFacts> {
  const { anchors, params } = input;
  if (anchors.length < 2) {
    throw new Error("preComputeFacts needs at least 2 anchors (start + end)");
  }

  // 1. Resolve the anchor chain: use the coords the user PICKED in the
  //    autocomplete verbatim; geocode the label only as a fallback.
  const coords = await Promise.all(
    anchors.map(async (a) => {
      if (a.coords) return a.coords;
      const [lng, lat] = await geocode(a.place);
      return [lng, lat] as [number, number];
    }),
  );

  // 2. Route through the full anchor chain (via-stops = intermediate anchors).
  const route = await routeBetween(coords);

  // 3. Baseline day count under the max-daily-drive cap (a sanity seed —
  //    the LLM does the real day structuring honoring anchors + dwell).
  const segments = segmentByPace(route, {
    maxDistanceM: params.maxDailyDriveMi * METERS_PER_MILE,
  });

  // 4. Derive the available city spine over the whole anchor route.
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const corridorCities =
    deriveCorridorCities({
      line: route.coordinates,
      start: { name: first.place, coords: coords[0] },
      end: { name: last.place, coords: coords[coords.length - 1] },
      gazetteer: gazetteer as GazetteerCity[],
    }) ?? [];

  // 5. Fold the corpus per baseline segment (same 2-point corridor query the
  //    shipped bake/wizard paths use), dedupe into a single pool.
  const supabase = createSupabaseServiceClient();
  const perSegment = await Promise.all(
    segments.map((seg) =>
      fetchCorpusForSegment(seg.startCoord, seg.endCoord, supabase),
    ),
  );
  const byId = new Map<string, PoolPOI>();
  for (const seg of perSegment) {
    for (const p of seg) {
      if (!byId.has(p.id)) byId.set(p.id, toPoolPOI(p));
    }
  }

  return {
    anchorsResolved: anchors.map((a, i) => ({
      place: a.place,
      role: a.role,
      datePin: a.datePin,
      date: a.date,
      dwell: a.dwell,
      note: a.note,
      coords: coords[i],
    })),
    route: {
      totalMi: route.distanceM / METERS_PER_MILE,
      totalDriveHours: route.durationS / 3600,
      baselineDriveDays: segments.length,
      segments: segments.map((s) => ({
        index: s.index,
        startCoord: s.startCoord,
        endCoord: s.endCoord,
        distanceMi: s.distanceM / METERS_PER_MILE,
        driveHours: s.durationS / 3600,
      })),
    },
    corridorCities,
    poolPOIs: [...byId.values()],
  };
}
