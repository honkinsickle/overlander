import type { Category } from "@/components/primitives/detail-card";

export type Trip = {
  id: string;
  title: string;
  /** ISO dates. */
  startDate: string;
  endDate: string;
  startLocation: string;
  endLocation: string;
  /** `[lng, lat]` of the trip's starting point. Each day's `coords`
   *  represents the *end* of that day, so without this the route line
   *  starts at Day 1's destination instead of the origin city. */
  startCoords?: [number, number];
  /** Pre-baked road-following geometry for the full trip route,
   *  encoded as a Google polyline (precision 5, ~1m). Computed offline
   *  by `scripts/prebake-routes.mjs`. When present, MapColumn decodes
   *  and draws this directly, skipping the Mapbox Directions API. Set
   *  to `undefined` after a mutation (e.g. `addWaypoint`) to force a
   *  live re-fetch. */
  routePolyline?: string;
  heroImage?: string;
  weatherHiF: number;
  weatherLoF: number;
  /** Editorial kicker rendered above the title, Crimson Text italic. */
  kicker?: string;
  days: Day[];
};

export type Day = {
  id: string;
  dayNumber: number;
  /** ISO date. */
  date: string;
  /** Human-readable span (e.g. "Seattle, WA — Mount Rainier NP"). */
  label: string;
  /** `[lng, lat]` the map flies to when this day is active. */
  coords?: [number, number];
  /** Total driving miles for the day (sidebar stat). */
  miles?: number;
  /** Estimated driving hours for the day (sidebar stat). */
  driveHours?: number;
  /** Optional hero image URL. If absent, `heroGradient` drives the panel. */
  heroImage?: string;
  /** CSS `background` value used when `heroImage` is absent (Paper's
   *  "Gradient fallback" variant from Day Detail Hero G85-0). */
  heroGradient?: string;
  /** Space Mono caption overlayed bottom-left on the hero
   *  (e.g. `MOJAVE DESERT · I-15 N · DAY 01`). */
  heroCaption?: string;
  /** Optional amber-colored compass tag overlayed top-right on the hero
   *  (e.g. `↑ NORTHBOUND`). */
  heroTag?: string;
  waypoints: Waypoint[];
  overnight?: OvernightSelection;
};

export type Waypoint = {
  id: string;
  /** URL-safe identifier used in search params. */
  slug: string;
  category: Category;
  title: string;
  /** Short context (e.g. "Day 1 · 165 mi from Los Angeles"). */
  subtitle: string;
  description: string;
  /** Optional `↳`-style tip rendered amber. */
  tip?: string;
  stats: { label: string; value: string }[];
};

export type OvernightSelection = {
  selected: Overnight;
  alternatives: Overnight[];
};

export type Overnight = {
  id: string;
  name: string;
  /** "Dispersed" | "State park" | "NPS" | etc. */
  type: string;
  detourMiles: number;
  /** Cost summary (e.g. "free", "$15 showers", "$30/night"). */
  cost: string;
  notes?: string;
};
