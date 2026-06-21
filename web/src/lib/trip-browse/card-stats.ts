import type { Category } from "@/components/primitives/detail-card";
import type { Waypoint } from "@/lib/trips/types";
import { pointToPolylineMi } from "@/lib/routing/point-to-polyline";
import type { BrowsePlace, SlideCategoryKey } from "./places";

/**
 * Per-card stats for the browse-panel `LocationCard`. Computes detour
 * distance/time to the place from the day's endpoint, an "Adds X" total
 * (detour out-and-back + a category-typical stop), an entry-cost line,
 * and a recomputed "new ETA at <next anchor>" string.
 *
 * Reliability / rating / review-count are deterministic from the
 * place's `id` so the same card renders consistently across requests
 * without needing real backing data.
 *
 * Designed for the panel — not for the slide-up overlay (which has its
 * own enrichment in `lib/trips/enrich.ts`).
 */

export type CardCtx = {
  category: SlideCategoryKey;
  /** End-of-day coords from the trip's Day. Falls back here if
   *  `dayStartCoords` isn't available for the perpendicular calc. */
  dayCoords?: [number, number];
  /** Start-of-day coords (previous day's overnight, or trip startCoords
   *  for Day 1). With both endpoints we compute perpendicular distance
   *  from the day-start → day-end line — which matches what a real
   *  detour costs for a place ON the route. */
  dayStartCoords?: [number, number];
  /** Day label, e.g. "Whitefish, MT — Banff, AB". Used to derive the
   *  next anchor name for the "new ETA at X" line. */
  dayLabel?: string;
  dayNumber: number;
  /** ISO date for the day, used for sunset/eta sanity. Optional. */
  dayDate?: string;
  /** True only when the ctx day IS the day this result belongs to (in-day
   *  browse). The detour/"Adds X" simulator is a day-relative concept, so it
   *  renders only when this holds. Top-level area search runs against the
   *  ACTIVE day (not the result's), so it leaves this false and the detour is
   *  suppressed rather than shown against the wrong route. */
  dayRelative?: boolean;
};

export type CardStats = {
  /** Pre-formatted "Day N / X.X mi off" eyebrow. */
  dayTag: string;
  cost: {
    /** "Adds <time>" — the real out-and-back detour driving time. Shown on
     *  near-route browse cards; suppressed on corpus-wide search. */
    hero: string;
  };
};

/** Drive speed assumption for converting detour miles → minutes. Real
 *  road geometry varies — this is a uniform heuristic for the demo. */
const AVG_MPH = 42;
/** Stretch straight-line distance to account for actual road routing. */
const ROAD_FACTOR = 1.4;

/** Haversine distance in miles. */
function distanceMi(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

/** Perpendicular distance (mi) from a place to the day's route segment.
 *  Uses the day-start → day-end polyline when both endpoints are
 *  available; falls back to haversine-to-dayEnd, then 0 if neither.
 *  Multiplied by ROAD_FACTOR by callers since the real off-route drive
 *  is longer than the great-circle line. */
function offRouteMi(p: [number, number], ctx: CardCtx): number {
  if (ctx.dayStartCoords && ctx.dayCoords) {
    return pointToPolylineMi(p, [ctx.dayStartCoords, ctx.dayCoords]);
  }
  if (ctx.dayCoords) return distanceMi(p, ctx.dayCoords);
  return 0;
}

/** Detour primitives used by the new Browse Location Card pill. Same
 *  math as `computeCardStats` but exposed as raw numbers so callers can
 *  format/threshold themselves. */
export function computeDetour(
  place: BrowsePlace,
  ctx: CardCtx,
): { miles: number; minutes: number } {
  const miles = offRouteMi(place.coords, ctx) * ROAD_FACTOR;
  const minutes = Math.round((miles / AVG_MPH) * 60);
  return { miles, minutes };
}

export function computeCardStats(
  place: BrowsePlace,
  ctx: CardCtx,
): CardStats {
  // Detour: perpendicular distance from the day's route segment ×
  // ROAD_FACTOR. Falls back to haversine-to-dayEnd if start coords
  // are unavailable; 0 if neither.
  const detourMi = offRouteMi(place.coords, ctx) * ROAD_FACTOR;
  const detourMin = Math.round((detourMi / AVG_MPH) * 60);
  // "Adds X" = the real out-and-back detour driving time only. No heuristic
  // stop minutes are added on top — we surface only the geometry we can
  // actually compute, never an invented visit duration.
  const addsMin = detourMin * 2;

  // Detour mile display: 1 decimal under 10mi, integer otherwise.
  const detourMiDisplay =
    detourMi < 10 ? detourMi.toFixed(1) : String(Math.round(detourMi));

  return {
    dayTag: `Day ${ctx.dayNumber} / ${detourMiDisplay} mi off`,
    cost: {
      hero: `Adds ${formatMinutes(addsMin)}`,
    },
  };
}

// ── Slide-up synth ────────────────────────────────────────────────
// The browse-panel slide-up overlay reads its rich sections from a
// `Waypoint` shape. Browse results aren't trip waypoints, so we project the
// BrowsePlace onto that shape. Every field here is REAL data off the source
// result or computed geometry — never a category-canned placeholder. Fields
// with no real backing are simply omitted, so the panel renders them empty.

const SLIDE_TO_TRIP_CATEGORY: Record<SlideCategoryKey, Category> = {
  scenic: "scenic",
  food: "food",
  oddity: "oddity",
  camping: "camping",
  overnight: "hotel",
  fuel: "fuel",
  attraction: "attraction",
  interest: "interest",
  urban: "urban",
};

/** Real price tier ($–$$$$) from the source (Google live), or undefined. */
function priceTierToEntry(tier?: 1 | 2 | 3 | 4): string | undefined {
  return tier ? "$".repeat(tier) : undefined;
}

/** Display labels for known provenance source identifiers. Keyed by the
 *  lowercased token so it normalizes BOTH the federated path's raw pipeline
 *  ids (attribution values: "ridb", "osm", "nps", …) AND the live discovery
 *  path's acronym labels ("NPS", "USFS", "BLM"), so both render the same
 *  readable product name. Display-only — the underlying provenance values are
 *  untouched. An unknown token is shown as-is; we never invent a label. */
const SOURCE_DISPLAY_LABELS: Record<string, string> = {
  ridb: "Recreation.gov",
  "recreation.gov": "Recreation.gov",
  osm: "OpenStreetMap",
  openstreetmap: "OpenStreetMap",
  nps: "National Park Service",
  usfs: "U.S. Forest Service",
  blm: "Bureau of Land Management",
  padus: "Protected Areas Database (PAD-US)",
  parks_canada: "Parks Canada",
  bc_parks: "BC Parks",
  alberta_parks: "Alberta Parks",
  google: "Google",
  foursquare: "Foursquare",
  wikipedia: "Wikipedia",
  ioverlander: "iOverlander",
};

/** Map a single provenance token to its readable label, or return it
 *  unchanged when unknown (honest passthrough — never a fabricated name). */
function prettySourceLabel(token: string): string {
  return SOURCE_DISPLAY_LABELS[token.toLowerCase()] ?? token;
}

/** Real provenance chips from the place's source labels. `mention.secondary`
 *  is the actual joined source list the discovery/federated pipeline already
 *  computed ("Google · OpenStreetMap", "ridb · osm", …). Splits it back into
 *  chips, drops any "+N more" tail, and maps known source ids to readable
 *  labels (display-only); returns [] when absent. */
function realDataSources(place: BrowsePlace): string[] {
  const raw = place.mention?.secondary ?? "";
  return raw
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\+\d+\s+more$/i.test(s))
    .map(prettySourceLabel);
}

/** Build a slide-up-ready Waypoint from a BrowsePlace + the stats we
 *  already compute for its card. Lets the slide-up render identically
 *  whether opened from a trip waypoint or a browse result — but carries only
 *  real, source-backed fields; everything unbacked is omitted (hidden). */
export function browsePlaceToWaypoint(
  place: BrowsePlace,
  ctx: CardCtx,
  stats: CardStats,
): Waypoint {
  const tripCategory = SLIDE_TO_TRIP_CATEGORY[ctx.category];
  const detourMatch = stats.dayTag.match(/([\d.]+)\s+mi/);
  // Detour / route-offset are day-relative — only meaningful when the ctx day
  // IS the result's day (in-day browse). Suppressed on top-level area search.
  const routeOffsetMi =
    ctx.dayRelative && detourMatch ? parseFloat(detourMatch[1]) : undefined;
  const addsMatch = stats.cost.hero.match(/Adds\s+(\S+)/);
  const entry = priceTierToEntry(place.priceTier);
  // Federated rows carry real overland tags (land status / managing agency /
  // camping policy — e.g. "federal_land", "dispersed_camping_likely"); live
  // Google/OSM results have none. These read as descriptors, so they home in
  // the Tags pills only. There is no real amenities (facilities) signal, so
  // the Amenities section is left unset and simply does not render.
  const realTags =
    place.overlanderTags && place.overlanderTags.length > 0
      ? place.overlanderTags
      : undefined;
  const dataSources = realDataSources(place);

  return {
    id: place.id,
    slug: place.id,
    category: tripCategory,
    title: place.title,
    subtitle: stats.dayTag,
    description: place.description,
    stats: [],
    photoUrl: place.photoUrl,
    ...(realTags ? { tags: realTags } : {}),
    routeOffsetMi,
    // "If you stop here" simulator = the real out-and-back detour. It is a
    // day-relative concept, so it carries ONLY on in-day browse; on area
    // search (active-day ctx, not the result's) the whole card is omitted
    // rather than show a detour against the wrong route. No arrival times /
    // schedule rows / "Day N unaffected" — those had no real routing source.
    ...(ctx.dayRelative && addsMatch
      ? {
          simulator: {
            addsTime: addsMatch[1],
            ...(entry ? { entryCost: entry } : {}),
          },
        }
      : {}),
    logistics: {
      hours: place.stats.find((s) => s.label === "HOURS")?.value,
      ...(entry ? { entry } : {}),
      address: place.placeInfo?.address || undefined,
      phone: place.placeInfo?.phone?.display,
      website: place.placeInfo?.website?.display,
    },
    // Community renders only with a REAL rating from the source (Google live).
    // Review count flows through when present; tips and "last verified" are
    // dropped entirely — no real source backs them.
    ...(typeof place.rating === "number"
      ? {
          community: {
            rating: place.rating,
            reviewCount:
              typeof place.reviewCount === "number" ? place.reviewCount : 0,
          },
        }
      : {}),
    ...(dataSources.length > 0 ? { dataSources } : {}),
  };
}
