/**
 * The planning region — the ONLY place the six-state list lives.
 *
 * Trip creation is restricted to these states. Widening or narrowing the
 * region should be a one-line diff here; nothing else should hardcode a state
 * code. Consumed by `location-autocomplete.tsx` (to filter suggestions before
 * they render) and `validateExpeditionForm` (the server-side backstop).
 *
 * WHY REGION CODES AND NOT A BOUNDING BOX. A box over these six states also
 * contains the whole of Idaho, western Montana, western Wyoming, and a strip of
 * Baja/Sonora — Idaho sits entirely inside it. (It does NOT meaningfully
 * contain Colorado or New Mexico: Utah's and Arizona's eastern border is the
 * Four Corners meridian at −109.045°, which is exactly CO's and NM's western
 * border.) A box is the wrong instrument, and it is unnecessary — Mapbox
 * already returns the admin region on every suggestion.
 *
 * WHY NO GEO DEPENDENCY. Resolving coords → state would need polygon data plus
 * a point-in-polygon library in `web/`, which has neither and would need
 * approval per CLAUDE.md. The region arrives in the geocoding response we
 * already parse; this module just stops it being thrown away.
 */

/** ISO 3166-2 subdivision codes, without the `US-` prefix — the shape Mapbox
 *  Geocoding v6 returns in `properties.context.region.region_code`. */
export const PLANNING_REGION_CODES = [
  "CA",
  "NV",
  "UT",
  "AZ",
  "WA",
  "OR",
] as const;

export type PlanningRegionCode = (typeof PLANNING_REGION_CODES)[number];

const ALLOWED = new Set<string>(PLANNING_REGION_CODES);

/** Full names, in the order shown to the user. Display only. */
export const PLANNING_REGION_NAMES =
  "California, Nevada, Utah, Arizona, Washington and Oregon";

/**
 * Is this region code inside the planning region?
 *
 * STRICT BY DESIGN: a null/absent code is NOT in region. We only admit a place
 * we can positively prove is in one of the six states — an unproven place is
 * refused rather than assumed. The alternative (admit when unknown) would let
 * anything Mapbox failed to tag through the filter and the backstop both.
 *
 * Deliberately does NOT accept a full state name. `region_code` is the only
 * value read anywhere in this feature, so no name→code mapping table exists —
 * see the note on `regionCode` in `location-autocomplete.tsx` for why the
 * label's `?? region.name` fallback is display-only and never reaches here.
 */
export function isInPlanningRegion(regionCode: string | null | undefined): boolean {
  return regionCode != null && ALLOWED.has(regionCode);
}
