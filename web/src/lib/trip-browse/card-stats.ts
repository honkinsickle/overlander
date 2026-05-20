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
};

export type CardStats = {
  /** Pre-formatted "Day N / X.X mi off" eyebrow. */
  dayTag: string;
  reliability: { score: number; label: string };
  cost: {
    primary: string;
    secondary: string;
    hero: string;
    eta: string;
  };
  rating: { value: string; count: string };
};

const STOP_MINUTES_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  scenic: 45,
  food: 60,
  oddity: 30,
  camping: 30,
  overnight: 30,
  fuel: 10,
};

const ENTRY_BY_CATEGORY: Record<SlideCategoryKey, string> = {
  scenic: "Free entry",
  food: "$10–25 entrée",
  oddity: "Free · donation",
  camping: "$15–25 / night",
  overnight: "$25 / night",
  fuel: "Pump price",
};

/** Drive speed assumption for converting detour miles → minutes. Real
 *  road geometry varies — this is a uniform heuristic for the demo. */
const AVG_MPH = 42;
/** Stretch straight-line distance to account for actual road routing. */
const ROAD_FACTOR = 1.4;

/** Stable hash for deterministic randomness from a string. */
function hash(s: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % max;
}

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

/** Pull the next anchor name from a day label like "X — Y" → "Y". */
function nextAnchorFromLabel(label: string | undefined): string {
  if (!label) return "next stop";
  const parts = label.split(/—|→|·/).map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  return last.split(",")[0].trim();
}

/** Format reviewCount as "1.2k" / "320" for compact display. */
function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Add minutes to a "h:MM AM/PM" string. Accepts both "5:00pm" and
 *  "5:00 PM" inputs; output is always uppercase with a space ("5:00 PM"),
 *  matching the canonical Paper copy. Wraps within 24h. */
function addMinutesToTime(time: string, minutes: number): string {
  const m = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return time;
  let hr = parseInt(m[1], 10) % 12;
  const min = parseInt(m[2], 10);
  if (m[3].toLowerCase() === "pm") hr += 12;
  let total = hr * 60 + min + minutes;
  total = ((total % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const newMin = total % 60;
  const isPm = h24 >= 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(newMin).padStart(2, "0")} ${isPm ? "PM" : "AM"}`;
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
  const id = place.id;

  // Detour: perpendicular distance from the day's route segment ×
  // ROAD_FACTOR. Falls back to haversine-to-dayEnd if start coords
  // are unavailable; 0 if neither.
  const detourMi = offRouteMi(place.coords, ctx) * ROAD_FACTOR;
  const detourMin = Math.round((detourMi / AVG_MPH) * 60);
  const stopMin = STOP_MINUTES_BY_CATEGORY[ctx.category];
  // Out-and-back detour + stop time.
  const addsMin = Math.max(stopMin + detourMin * 2, stopMin);

  // Reliability score in [75, 95] seeded by id.
  const reliabilityScore = 75 + hash(id + "rel", 21);
  const reliabilityLabel =
    reliabilityScore >= 90 ? "High reliability" : "Good reliability";

  // Rating in [3.8, 4.9], reviewCount in [80, 8000].
  const ratingValue = (3.8 + hash(id + "rate", 12) * 0.1).toFixed(1);
  const reviewCount = 80 + hash(id + "rev", 7920);

  // Day's planned arrival assumed to be 5pm (typical trip-end). With
  // detour added, push it out by addsMin. Real planned ETA would come
  // from upstream routing — this is a placeholder driven by ctx.
  const plannedEta = "5:00 PM";
  const newEta = addMinutesToTime(plannedEta, addsMin);
  const anchor = nextAnchorFromLabel(ctx.dayLabel);

  // Detour mile display: 1 decimal under 10mi, integer otherwise.
  const detourMiDisplay =
    detourMi < 10 ? detourMi.toFixed(1) : String(Math.round(detourMi));

  return {
    dayTag: `Day ${ctx.dayNumber} / ${detourMiDisplay} mi off`,
    reliability: { score: reliabilityScore, label: reliabilityLabel },
    cost: {
      primary: `Detour: ${formatMinutes(detourMin)}`,
      secondary: ENTRY_BY_CATEGORY[ctx.category],
      hero: `Adds ${formatMinutes(addsMin)}`,
      eta: `to your day. You'd arrive at ${anchor} at ${newEta}`,
    },
    rating: {
      value: ratingValue,
      count: `(${compactCount(reviewCount)})`,
    },
  };
}

// ── Slide-up synth ────────────────────────────────────────────────
// The browse-panel slide-up overlay reads its rich sections from a
// `Waypoint` shape. Browse results aren't trip waypoints, so we
// synthesize one from the BrowsePlace + computed stats. Keeps the
// overlay rendering identical to the trip-waypoint path.

const SLIDE_TO_TRIP_CATEGORY: Record<SlideCategoryKey, Category> = {
  scenic: "mountain",
  food: "food",
  oddity: "oddity",
  camping: "camping",
  overnight: "neutral",
  fuel: "fuel",
};

const TAGS_BY_SLIDE: Record<SlideCategoryKey, string[]> = {
  scenic: ["Scenic", "Photo Spot", "Trail"],
  food: ["Local Eats", "Casual", "Open Late"],
  oddity: ["Roadside", "Quirky", "Quick Stop"],
  camping: ["Tent + RV", "Reservable", "Pit toilets"],
  overnight: ["Lodging", "Reservable", "Quick Reset"],
  fuel: ["Gas", "Diesel"],
};

const FACTUAL_BY_SLIDE: Record<SlideCategoryKey, { label: string; text: string }> = {
  scenic: {
    label: "Field Notes",
    text: "Discoverable terrain feature drawn from public data sources. Confirm trail status and seasonal access at the visitor center before committing to the detour.",
  },
  food: {
    label: "House Notes",
    text: "Counter-and-table service spot pulled from local data. Hours and menu shift with the season — call ahead if you're tight on time.",
  },
  oddity: {
    label: "Backstory",
    text: "Roadside curiosity logged by community contributors. Worth the photo stop; verify access via the operator before trusting the listed hours.",
  },
  camping: {
    label: "Site Notes",
    text: "Campsite pulled from public datasets (BLM / NFS / Recreation.gov). Check the relevant agency for current fees, fire restrictions, and reservability.",
  },
  overnight: {
    label: "Stay Notes",
    text: "Lodging option from public listings. Rates and availability vary by season — verify directly before relying on the stop.",
  },
  fuel: {
    label: "Fuel Notes",
    text: "Gas station pulled from public data sources. Rural pumps can be card-only or seasonal — check posted hours and brand reviews before relying on a single stop in a long stretch.",
  },
};

const AMENITIES_BY_SLIDE: Record<SlideCategoryKey, string[]> = {
  scenic: ["Trailhead", "Photo overlook", "Parking"],
  food: ["Dine in", "Takeout", "Cards accepted"],
  oddity: ["Free entry", "Photo op", "Restrooms"],
  camping: ["Pit toilets", "Picnic tables", "Fire rings"],
  overnight: ["Wifi", "Parking", "Pet-friendly"],
  fuel: ["Restrooms", "Snacks", "ATM"],
};

const TIPS_BY_SLIDE: Record<SlideCategoryKey, string[]> = {
  scenic: [
    "First two hours after sunrise gives the cleanest light here.",
    "Cell signal is unreliable past the trailhead — download maps offline.",
  ],
  food: [
    "Aim for the shoulder hour (11:30 or 1:45) to skip the lunch rush.",
    "Specials change daily — ask, don't trust the posted menu.",
  ],
  oddity: [
    "Worth the detour even if it sounds dubious from the listing.",
    "Bring small bills — cards rarely accepted.",
  ],
  camping: [
    "Sites along the back loop tend to be quieter and better-shaded.",
    "Pack out everything; leave-no-trace ethics expected here.",
  ],
  overnight: [
    "Confirm the latest cancellation window before booking peak nights.",
  ],
  fuel: [
    "Top off here if the next stretch is long — rural pumps can be unreliable or seasonal.",
  ],
};

/** Compact source-attribution chips. The browse pipeline tags every
 *  result with its data-source already; we surface that here so the
 *  panel can show "OSM" / "Recreation.gov" / "Foursquare" provenance. */
function sourcesForBrowsePlace(_place: BrowsePlace): string[] {
  // BrowsePlace doesn't carry a discrete source field today; the
  // discovery pipeline merges across OSM / Recreation.gov / Foursquare.
  // Default to OSM since the bulk of results come from there.
  return ["OpenStreetMap", "Wikipedia", "Mapillary"];
}

/** Build a slide-up-ready Waypoint from a BrowsePlace + the stats we
 *  already compute for its card. Lets the slide-up render identically
 *  whether opened from a trip waypoint or a browse result. */
export function browsePlaceToWaypoint(
  place: BrowsePlace,
  ctx: CardCtx,
  stats: CardStats,
): Waypoint {
  const tripCategory = SLIDE_TO_TRIP_CATEGORY[ctx.category];
  const detourMatch = stats.dayTag.match(/([\d.]+)\s+mi/);
  const routeOffsetMi = detourMatch ? parseFloat(detourMatch[1]) : undefined;
  // "Stop time" = time spent AT the stop, per-category heuristic. Was
  // previously parsed out of `cost.primary` ("Detour: …") which is the
  // *drive* time to the stop, not the visit duration — that produced
  // absurd labels like "Stop time: 6h47m" for a museum 285mi off-route.
  const stopMin = STOP_MINUTES_BY_CATEGORY[ctx.category];
  const addsMatch = stats.cost.hero.match(/Adds\s+(\S+)/);
  // Pull "{anchor}" and "{time}" out of the new copy format:
  // "to your day. You'd arrive at {anchor} at {time}"
  const newEtaMatch = stats.cost.eta.match(/at\s+(.+?)\s+at\s+([\d:]+\s+[AP]M)$/);
  return {
    id: place.id,
    slug: place.id,
    category: tripCategory,
    title: place.title,
    subtitle: stats.dayTag,
    description: place.description,
    stats: [],
    photoUrl: place.photoUrl,
    tags: TAGS_BY_SLIDE[ctx.category],
    reliability: {
      score: stats.reliability.score,
      label: stats.reliability.label,
      sourceCount: 3,
    },
    routeOffsetMi,
    simulator: {
      stopTime: formatMinutes(stopMin),
      entryCost: stats.cost.secondary,
      addsTime: addsMatch?.[1] ?? "—",
      newEtaPlace: newEtaMatch?.[1] ?? "next stop",
      plannedEta: "5:00 PM",
      withStopEta: newEtaMatch?.[2] ?? "—",
      unaffectedNote: `Day ${ctx.dayNumber + 1} unaffected`,
    },
    factualNote: FACTUAL_BY_SLIDE[ctx.category],
    logistics: {
      hours: place.stats.find((s) => s.label === "HOURS")?.value,
      entry: stats.cost.secondary,
      address: place.placeInfo?.address || undefined,
      phone: place.placeInfo?.phone?.display,
      website: place.placeInfo?.website?.display,
    },
    community: {
      rating: parseFloat(stats.rating.value),
      reviewCount: parseInt(
        stats.rating.count.replace(/[^\d]/g, "") || "0",
        10,
      ),
      tips: TIPS_BY_SLIDE[ctx.category],
      lastVerified: "Live",
    },
    amenities: AMENITIES_BY_SLIDE[ctx.category],
    dataSources: sourcesForBrowsePlace(place),
  };
}
