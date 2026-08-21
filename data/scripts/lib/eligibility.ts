/**
 * Shared STRONG/WEAK/NONE eligibility bucketing logic, used by both
 * measure-llm-eligibility.ts and measure-eligibility-full-corpus.ts.
 * Extracted so a fix to the bucketing rules lands once, not twice — the
 * two scripts previously carried independently-duplicated copies of this
 * logic, which is exactly how the has_real_description bug (below) could
 * have been fixed in one and silently left stale in the other.
 *
 * Terminology note: the codebase has no `facets` column. source_record has
 * `normalized_payload` (jsonb; per-source cleaned shape) and `raw_payload`
 * (jsonb; verbatim source). The OSM ingester's normalizeOsm() at
 * data/ingestion/sources/osm.ts:307-364 DISCARDS the raw `tags{}` dict —
 * so wikipedia / wikidata / historic_name / operator / cuisine / heritage
 * exist for OSM rows only in raw_payload.tags, never in normalized_payload.
 * computeSignals probes both.
 */

// Strict per the ask's exemplars: keys that carry LLM-usable descriptive
// content, not category markers. Excludes tourism/natural/amenity/leisure
// (already captured by inferred_category), ele (bare number), and access
// tags like surface/wheelchair (useful but not the "descriptive text" the
// ask calls out). The 5+-raw-tags fallback catches rich OSM rows that lack
// any of these keys.
export const MEANINGFUL_OSM_KEYS = new Set([
  "description", "note",
  "historic_name", "historic:name", "heritage",
  "operator",
  "cuisine",
  "name:en", "alt_name",
  "wikipedia", "wikidata",
]);

/**
 * Minimum trimmed character length for normalized_payload.description to
 * count as real content, not a templated placeholder. Derived from a direct
 * sample of real RIDB/USFS/NPS rows on TEST (2026-08-18), not guessed:
 *
 *   Observed JUNK (all excluded by this threshold):
 *     "To Be Updated"                          14 chars  (RIDB facility — literal placeholder)
 *     "DAM POINT (Picnic Site)"                23 chars  (USFS — name + templated category suffix)
 *     "Donner Summit Day Use Area"              26 chars  (USFS — bare name restatement)
 *     "CALAMUT LAKE (Trailhead)"                25 chars  (USFS — same template pattern)
 *     "Trailhead and Day Use Area."             36 chars  (RIDB — generic boilerplate, unrelated to the place's own name)
 *     "SOUTH WALDO (NORTH) (Trailhead)"          32 chars  (USFS)
 *     ""                                         0 chars  (RIDB campground — non-null, empty string)
 *
 *   Observed REAL CONTENT (all included), shortest first:
 *     "Informal Sno-Park with limited parking"  38 chars  (USFS — terse but a real, specific fact; borderline, EXCLUDED at 40 — see note below)
 *     "Woodland Lake Park Picnic Site, restroom available."  51 chars (USFS)
 *     "Small Parking Lot, east of Redhills VC..." 161 chars (NPS)
 *     "Canyonlands Backcountry Office..."        187 chars (RIDB visitor_center)
 *     ... up to 3000-5000+ char rich HTML prose (NPS/RIDB visitor_center, campground, recreation_area)
 *
 * The junk ceiling (36 chars) and the real-content floor (38 chars) sit
 * only 2 chars apart — no length threshold can perfectly separate this one
 * pair. 40 was chosen to sit just above the junk ceiling, accepting that
 * one specific 38-char borderline-real case is conservatively excluded
 * (false negative) rather than risk letting templated junk (false
 * positive) through. Every USFS "NAME (Category)" templated example
 * observed was well under 40 chars, so this single threshold also
 * incidentally excludes that pattern without needing a separate
 * name-comparison check.
 */
export const DESCRIPTION_MIN_LENGTH = 40;

export type SRSignals = {
  has_website: boolean;
  has_phone: boolean;
  has_hours: boolean;
  has_wikipedia: boolean;
  has_wikidata: boolean;
  meaningful_tag_count: number;
  raw_tag_count: number;
  /** normalized_payload.description is a non-null string, trimmed length
   *  >= DESCRIPTION_MIN_LENGTH. See that constant's comment for the real
   *  samples this threshold was derived from. */
  has_real_description: boolean;
  /** normalized_payload.directions is a non-null string, trimmed length
   *  >= DESCRIPTION_MIN_LENGTH (same threshold, reused — real driving
   *  directions and a real description are both "real prose", junk at the
   *  same short lengths). Populated by usfs.ts (`directions`) and, as of
   *  2026-08-20, ridb.ts's `normalizeFacility` (`facility.FacilityDirections`
   *  → `directions`) — found via the 2026-08-20 NONE-bucket characterization
   *  pass (docs/measurements/2026-08-20-none-bucket-characterization.md §5).
   *  Deliberately a distinct signal from has_real_description, not folded
   *  into it: a place can have real turn-by-turn directions with no prose
   *  about what the place actually is, or vice versa — they're different
   *  content, not different phrasings of the same fact. */
  has_real_directions: boolean;
};

/** Per-source_record signal computation. Pure — no DB access. */
export function computeSignals(normalized_payload: unknown, raw_payload: unknown): SRSignals {
  const np = (normalized_payload ?? {}) as Record<string, any>;
  const rp = (raw_payload ?? {}) as Record<string, any>;
  const contact = np.contact ?? {};
  const npHours = np.hours ?? np.opening_hours;
  // Raw tag dict lives at different paths per source:
  //   OSM: raw_payload.element.tags (key-value dict from Overpass)
  //   NPS: raw_payload.place.tags (array of theme labels — not a dict)
  //   RIDB / USFS / PAD-US / google_resolved: no key-value tag dict
  // Only OSM's shape supports the "5+ keys" or "high-signal key" test.
  const rawTags: Record<string, unknown> =
    (rp.element?.tags && typeof rp.element.tags === "object" && !Array.isArray(rp.element.tags))
      ? rp.element.tags
      : (rp.tags && typeof rp.tags === "object" && !Array.isArray(rp.tags)) ? rp.tags : {};
  const rawTagKeys = Object.keys(rawTags);
  let meaningful = 0;
  for (const k of rawTagKeys) if (MEANINGFUL_OSM_KEYS.has(k)) meaningful++;

  const description = np.description;
  const hasRealDescription =
    typeof description === "string" && description.trim().length >= DESCRIPTION_MIN_LENGTH;

  const directions = np.directions;
  const hasRealDirections =
    typeof directions === "string" && directions.trim().length >= DESCRIPTION_MIN_LENGTH;

  return {
    has_website: !!(contact.website ?? np.website ?? (rawTags as any).website ?? (rawTags as any).url),
    has_phone: !!(contact.phone ?? np.phone ?? (rawTags as any).phone),
    has_hours: !!(
      (typeof npHours === "string" && npHours.length > 0) ||
      (npHours && typeof npHours === "object" && Object.keys(npHours).length > 0) ||
      (rawTags as any).opening_hours
    ),
    has_wikipedia: !!(np.wikipedia ?? (rawTags as any).wikipedia),
    has_wikidata: !!(np.wikidata ?? (rawTags as any).wikidata),
    meaningful_tag_count: meaningful,
    raw_tag_count: rawTagKeys.length,
    has_real_description: hasRealDescription,
    has_real_directions: hasRealDirections,
  };
}

/** OR-reduced signals across every active source_record linked to one
 *  master_place — what the STRONG/WEAK/NONE bucket decision is made from. */
export type AggregatedSignals = {
  has_wikipedia: boolean;
  has_website: boolean;
  has_hours: boolean;
  has_phone: boolean;
  has_meaningful: boolean;
  has_real_description: boolean;
  has_real_directions: boolean;
};

export function emptyAggregatedSignals(): AggregatedSignals {
  return {
    has_wikipedia: false,
    has_website: false,
    has_hours: false,
    has_phone: false,
    has_meaningful: false,
    has_real_description: false,
    has_real_directions: false,
  };
}

export function foldSignalsInto(agg: AggregatedSignals, sr: SRSignals): void {
  agg.has_wikipedia ||= sr.has_wikipedia || sr.has_wikidata;
  agg.has_website ||= sr.has_website;
  agg.has_hours ||= sr.has_hours;
  agg.has_phone ||= sr.has_phone;
  agg.has_meaningful ||= (sr.meaningful_tag_count >= 1) || (sr.raw_tag_count >= 5);
  agg.has_real_description ||= sr.has_real_description;
  agg.has_real_directions ||= sr.has_real_directions;
}

/**
 * STRONG qualifies on wikipedia OR website OR meaningful OSM tags OR a real
 * description. has_real_description is folded in here, not given its own
 * tier: a populated, substantial description is the actual target content
 * this measurement exists to find, not a proxy signal that content might be
 * reachable (which is what wikipedia/website/tags are — external references
 * or raw keywords, not inline prose). A place that already has one doesn't
 * need LLM generation at all, which is a strictly stronger case than "has
 * raw material that might produce a good description" — so it belongs in
 * the same tier as the other "this place doesn't need work" signals, not a
 * new one above or below it.
 */
export function isStrong(s: AggregatedSignals): boolean {
  return s.has_wikipedia || s.has_website || s.has_meaningful || s.has_real_description || s.has_real_directions;
}

export function isWeak(s: AggregatedSignals): boolean {
  return !isStrong(s) && (s.has_phone || s.has_hours);
}

export function bucketOf(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
  if (isStrong(s)) return "STRONG";
  if (isWeak(s)) return "WEAK";
  return "NONE";
}
