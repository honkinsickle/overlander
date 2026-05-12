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
  /** Short narrative of the day's drive (route, road, key transitions). */
  description?: string;
  /** Forecast strings for departure and arrival points (e.g. "75-82F dry"). */
  weather?: { departure?: string; arrival?: string };
  /** Practical notes — fuel cadence, supply tips, backup plans, etc. */
  notes?: string[];
  /** Pre-resolved top photo-bearing place per slide category. Populated by
   *  `resolveSuggestions` at trip-load so the SuggestedSection can render
   *  without a client-side fetch. Categories with no match are absent. */
  suggestions?: Partial<Record<import("@/lib/trip-browse/places").SlideCategoryKey, import("@/lib/trip-browse/places").BrowsePlace>>;
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

  // ── Detail-panel fields ──────────────────────────────────────
  // All optional so existing fixtures keep rendering. Backfilled
  // for the Alaska trip via `enrichWaypoint` at module load.

  /** Hero photo for the detail panel. Falls back to a category
   *  gradient when absent. */
  photoUrl?: string;
  /** `[lng, lat]` — when present, a marker is dropped on the map at
   *  this point and clicking it opens the slide-up. */
  coords?: [number, number];
  /** Pill row under the title (e.g. ["National Park", "Scenic Vista"]). */
  tags?: string[];
  /** Reliability score box (0–100) + caption. */
  reliability?: { score: number; label: string; sourceCount: number };
  /** Distance from the route line (e.g. 0.4 = "0.4 mi on route"). */
  routeOffsetMi?: number;
  /** "If you stop here" simulator block. */
  simulator?: {
    stopTime: string;
    entryCost?: string;
    addsTime: string;
    newEtaPlace: string;
    plannedEta: string;
    withStopEta: string;
    sunset?: string;
    /** "Day N unaffected" footer (omit to hide). */
    unaffectedNote?: string;
  };
  /** Category-themed factual block under the description (e.g.
   *  "Geology Notes" for Scenic, "Cultural" for Urban). */
  factualNote?: { label: string; text: string };
  /** Logistics grid — hours / entry / phone / website. */
  logistics?: {
    hours?: string;
    entry?: string;
    phone?: string;
    website?: string;
  };
  /** Community section — rating + review count + tip bullets. */
  community?: {
    rating: number;
    reviewCount: number;
    tips: string[];
    lastVerified: string;
  };
  /** Amenity tag chips. */
  amenities?: string[];
  /** Data-source attribution chips at the bottom. */
  dataSources?: string[];

  /** Booking status sourced from §08 of the reference doc via §03's
   *  `Permit Ref` linkage. Only populated for waypoints that anchor a
   *  fixed-date event. Format: "Not Yet Booked" / "Booked" / etc. */
  bookingStatus?: { permitName: string; status: string }[];
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
  /** Populated by `resolveOvernights` at trip-load: a best-match record
   *  from USFS / Recreation.gov / Foursquare / OSM. Slide-up enrichment.
   *  Optional — dispersed sites and obscure dispersed pulls won't match. */
  enriched?: {
    description?: string;
    photoUrl?: string;
    address?: string;
    phone?: string;
    website?: string;
    coords?: [number, number];
    sources: string[];
  };
};
