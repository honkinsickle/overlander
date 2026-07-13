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
  /** The regional-eats narrative woven through the trip (generated trips).
   *  Surfaced in the Overview's Food section. */
  foodThread?: string;
  /** True for trips produced by the itinerary generator (YoTrippin). Gates
   *  generated-only UI — e.g. the day-level reasoned briefing card in the
   *  corridor view — so reference/fork trips stay unchanged. */
  generated?: boolean;
  days: Day[];
  /** Slug or null. Populated by `getUserTrip` from the DB column on
   *  public.trips. Slug-keyed reference trips (la-to-deadhorse) have
   *  this undefined — they ARE the reference. User trips forked from a
   *  reference carry the reference's slug here; trips planned from
   *  scratch via the wizard have it null. Drives whether the
   *  "Reset to reference" affordance is offered. */
  referenceId?: string | null;
  /** Wizard state captured during /plan/[id]/* flow. Present only for
   *  trips created via the wizard. Shape follows `WizardSlices` in
   *  lib/plan/types.ts; stored loose here (Record) to avoid a circular
   *  type import between lib/trips and lib/plan. */
  wizard?: Record<string, unknown>;
  /** Offline tile-cache phases (default 7-day chunks). Travels with the
   *  trip across devices; prime status (downloaded/not) lives per-device
   *  in IndexedDB keyed by (tripId, phaseId). See
   *  docs/decisions/2026-05-21-offline-tile-caching-architecture.md. */
  offlinePhases?: OfflinePhase[];
};

/**
 * Offline tile-cache phase. Identifies a contiguous range of days
 * whose Mapbox tiles can be downloaded as a unit for offline use.
 *
 * Implementation type is named `OfflinePhase` to disambiguate from
 * the UI "Phase 01" terminology used in slideup-shell.tsx — same word,
 * different concept. The ADR refers to this concept as "Phase".
 */
export type OfflinePhase = {
  /** Stable id across edits, e.g. "phase-w1". */
  id: string;
  /** User-facing label, e.g. "Week 1: Days 1–7". */
  label: string;
  /** References `Day.id` values from this trip. */
  dayIds: string[];
  /** Buffer width around the phase route, miles. Default 25. */
  bufferMi: number;
  /** Highest zoom level included in the prime. Default 13. */
  maxZoom: number;
  /** Set at prime time; compared against current geometry to detect
   *  trip edits that invalidate the cached tiles. `null` = never primed. */
  primedPolylineHash: string | null;
  /** Mapbox tileset version captured at prime success, e.g. "streetsv8".
   *  Mirrors the suffix on the phase's Cache Storage bucket and the IDB
   *  record so drift detection covers tileset bumps in addition to
   *  polyline edits. `null` until first prime. */
  primedTilesetVersion: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

export type Day = {
  id: string;
  dayNumber: number;
  /** ISO date. */
  date: string;
  /** Human-readable span (e.g. "Seattle, WA — Mount Rainier NP"). */
  label: string;
  /** `[lng, lat]` of the *end* of this day (overnight stop). Used to chain
   *  route geometry across days — Day N's `coords` is Day N+1's start. */
  coords?: [number, number];
  /** `[lng, lat]` of the *start* of this day. The map flies here when the
   *  day is active (so Day 1 lands at the trip origin, not the overnight).
   *  Optional for backward compatibility with trips finalized before this
   *  field existed — MapColumn falls back to `trip.startCoords` for Day 1
   *  and to `coords` otherwise. */
  startCoord?: [number, number];
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
   *  `resolveSuggestions` at trip-load (Alaska reference trip) or by the
   *  wizard finalize action (user-built trips). Categories with no match
   *  are absent. */
  suggestions?: Partial<Record<import("@/lib/trip-browse/places").SlideCategoryKey, import("@/lib/trip-browse/places").BrowsePlace>>;
  /** Flat list of all places discovered along this day's route segment
   *  during wizard finalize (Foursquare + RIDB, 25-mi radius sampled
   *  along the polyline). Capped at a reasonable size to keep the
   *  payload manageable. Intended for a future "browse the day" sheet
   *  on the trip page — until then this is the source of truth that
   *  `suggestions` (one per category) was picked from. */
  segmentSuggestions?: import("@/lib/trip-browse/places").BrowsePlace[];
  /** Ordered corridor of geographic city nodes for this day (Start →
   *  intermediates → End), computed at finalize by the corridor
   *  derivation (docs/corridor-cities-spec.md). Optional per spec
   *  decision F: trips finalized before this existed lack it, and the
   *  v4 view falls back to a degraded two-node Start→End corridor. */
  corridorCities?: CorridorCity[];
};

/**
 * One node in a day's corridor spine — a geographic city anchor with an
 * along-route position and clustered place references. Persisted in
 * trips.payload under each Day. See docs/corridor-cities-spec.md §1.
 */
export type CorridorCity = {
  /** Stable slug, e.g. "los-angeles-ca". Identity for placeId grouping,
   *  cross-day references, and city-scoped "Explore more" discovery. */
  id: string;
  /** Display label, e.g. "Los Angeles, CA". */
  name: string;
  /** Role of this node: the day's origin, an intermediate pass-through
   *  city, or the overnight/end city. */
  kind: "start" | "corridor" | "end";
  /** `[lng, lat]` anchor on/near the day's route slice. */
  coords: [number, number];
  /** ALONG-ROUTE cumulative miles from the day's start node (0 for
   *  start). Projected onto the route polyline — NOT straight-line and
   *  NOT Waypoint.routeOffsetMi (perpendicular offset). Monotonically
   *  non-decreasing across the ordered array. */
  milesFromStart: number;
  /** Ids of places clustered under this node, in display order.
   *  References BrowsePlace.id (Day.segmentSuggestions) and/or
   *  Waypoint.id (Day.waypoints) — reference, not nest; resolve against
   *  the day's place pool at render. */
  placeIds: string[];
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
  /** "If you stop here" simulator block. Every field is optional: the
   *  browse/search path supplies only the real detour (`addsTime`), while
   *  the trip-waypoint path fills the rest. The detail panel renders each
   *  field only when present, so absent = hidden, never fabricated. */
  simulator?: {
    stopTime?: string;
    entryCost?: string;
    addsTime?: string;
    newEtaPlace?: string;
    plannedEta?: string;
    withStopEta?: string;
    sunset?: string;
    /** "Day N unaffected" footer (omit to hide). */
    unaffectedNote?: string;
  };
  /** Category-themed factual block under the description (e.g.
   *  "Geology Notes" for Scenic, "Cultural" for Urban). */
  factualNote?: { label: string; text: string };
  /** Logistics grid — hours / entry / address / phone / website. */
  logistics?: {
    hours?: string;
    entry?: string;
    address?: string;
    phone?: string;
    website?: string;
  };
  /** Community section — rating + review count + tip bullets. `tips` and
   *  `lastVerified` are optional: the browse/search path surfaces only a
   *  real rating/review count and omits them (no real source to back them). */
  community?: {
    rating: number;
    reviewCount: number;
    tips?: string[];
    lastVerified?: string;
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
