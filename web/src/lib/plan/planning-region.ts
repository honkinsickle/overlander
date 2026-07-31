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
 * returns the admin region in the response we already parse.
 *
 * HOW OFTEN IS `region_code` ACTUALLY PRESENT? Measured on 2026-07-31: present
 * on all 26 features returned by six live forward queries. That is six
 * well-known US city names, NOT the whole `country=us,ca&types=place` space, so
 * it does not establish a rate. It matters because the filter is strict-refuse:
 * an untagged feature is dropped SILENTLY, with no error and no log. If places
 * start going missing from the dropdown, an absent `region_code` is the first
 * thing to check — there will be no other signal.
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
 *
 * A TYPE PREDICATE, not a plain boolean, so the narrowing is the compiler's job
 * rather than a comment's. The caller in `location-autocomplete.tsx` needs a
 * non-null code after the check; with a boolean return that needed an `as`
 * assertion, which would have silently kept compiling if this contract ever
 * loosened. Note the predicate narrows the ARGUMENT only — it says nothing
 * about the object the code was read from.
 */
export function isInPlanningRegion(
  regionCode: string | null | undefined,
): regionCode is PlanningRegionCode {
  return regionCode != null && ALLOWED.has(regionCode);
}
