/**
 * Mapbox Directions wrapper. Returns a routed polyline + total distance/
 * duration + per-step distance/duration/geometry between two or more
 * coordinates. The per-step data is the foundation for the
 * distance-per-day segmentation work (see Diary/2026-05-15-shape-
 * distance-per-day.md).
 *
 * Universal — works in server and client contexts (uses fetch + the
 * NEXT_PUBLIC_MAPBOX_TOKEN env var which is shipped to both).
 *
 * Scope of this module: simple ≤25-coord routes (Mapbox's per-request
 * cap). Sufficient for point-to-point trips with a small number of
 * named via-stops. For larger waypoint sequences (e.g. baking the
 * 66-day Alaska reference trip) use scripts/prebake-routes.mjs which
 * implements chunking + recursive split-on-unroutable.
 */

export type LngLat = [number, number];

export type RouteStep = {
  /** Distance of this step in meters. */
  distanceM: number;
  /** Driving duration of this step in seconds. */
  durationS: number;
  /** Geojson `[lng, lat]` coordinates traced by this step. */
  geometry: LngLat[];
};

export type Route = {
  /** Full route geometry as `[lng, lat]` pairs, decoded geojson. */
  coordinates: LngLat[];
  /** Total distance in meters across all legs. */
  distanceM: number;
  /** Total driving duration in seconds across all legs. */
  durationS: number;
  /** Per-step distance/duration/geometry, flattened across legs in
   *  travel order. Use these to split the route by miles or by
   *  duration. */
  steps: RouteStep[];
};

export type RouteBetweenOptions = {
  /** Append `coords[0]` as a final destination so the route returns to
   *  start. Matches the wizard's round-trip toggle. */
  roundTrip?: boolean;
};

export class RouteBetweenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RouteBetweenError";
  }
}

const MAPBOX_DRIVING = "https://api.mapbox.com/directions/v5/mapbox/driving";
const MAPBOX_COORD_LIMIT = 25;

/** Resolve start→end (and any inline via-stops) to a routed polyline +
 *  per-step distance/duration data. Throws on missing token, malformed
 *  input, HTTP errors, or unroutable inputs. */
export async function routeBetween(
  coords: LngLat[],
  opts: RouteBetweenOptions = {},
): Promise<Route> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    throw new RouteBetweenError("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
  }

  const all = opts.roundTrip && coords.length >= 1 ? [...coords, coords[0]] : coords;
  if (all.length < 2) {
    throw new RouteBetweenError(
      `routeBetween needs at least 2 coordinates, got ${all.length}`,
    );
  }
  if (all.length > MAPBOX_COORD_LIMIT) {
    throw new RouteBetweenError(
      `routeBetween supports up to ${MAPBOX_COORD_LIMIT} coordinates per call ` +
        `(got ${all.length}). For larger sequences use scripts/prebake-routes.mjs.`,
    );
  }

  const path = all.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url =
    `${MAPBOX_DRIVING}/${path}` +
    `?geometries=geojson&overview=full&steps=true&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new RouteBetweenError(
      `Mapbox Directions HTTP ${res.status}`,
      res.status,
    );
  }

  const json = (await res.json()) as MapboxDirectionsResponse;
  const route = json.routes?.[0];
  if (!route || !route.geometry?.coordinates?.length) {
    throw new RouteBetweenError(
      "Mapbox returned no routes (unroutable input — e.g. point off-road, " +
        "in water, or in a region without driving network)",
    );
  }

  const steps: RouteStep[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      steps.push({
        distanceM: step.distance,
        durationS: step.duration,
        geometry: step.geometry?.coordinates ?? [],
      });
    }
  }

  return {
    coordinates: route.geometry.coordinates,
    distanceM: route.distance,
    durationS: route.duration,
    steps,
  };
}

type MapboxDirectionsResponse = {
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates?: LngLat[] };
    legs?: {
      steps?: {
        distance: number;
        duration: number;
        geometry?: { coordinates?: LngLat[] };
      }[];
    }[];
  }[];
};
