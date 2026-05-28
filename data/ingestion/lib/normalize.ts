/**
 * Shared normalization helpers used by all source ingesters.
 *
 * Each source has its own mapping table (e.g. OSM tag → canonical category).
 * Helpers here are cross-source: name cleanup, boolean coercion, etc.
 */

/**
 * Lowercase, collapse whitespace, strip leading/trailing punctuation.
 * Used as a pre-step before similarity comparison.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Title-Case a display name. Lowercase everything, capitalize the first letter
 * of each whitespace-delimited word.
 *
 * Used at RIDB ingest time because RIDB facility/recarea names often arrive
 * in screaming caps ("JUMBO ROCKS CAMPGROUND"). Spec corollary from the JT
 * smoke test ER findings: RIDB needs Title-Case normalization before writing
 * source_record.name and source_record.normalized_payload.canonical_name.
 *
 * Known edge cases (deferred): acronyms ("RV", "USFS"), small words
 * ("of", "the", "and"), hyphenation rules. v1 keeps it simple; week-2
 * polish can add a small-words list if the data warrants.
 */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(\p{L})/gu, (m) => m.toUpperCase());
}

/**
 * Strip common POI suffixes that vary by source.
 *   "Joshua Tree National Park Campground" → "Joshua Tree National Park"
 * Used to make name similarity more forgiving across sources.
 */
const STRIPPABLE_SUFFIXES = [
  "campground",
  "cg",
  "rv park",
  "park",
  "trailhead",
  "rest area",
  "service area",
  "gas station",
  "fuel",
];

export function stripCommonSuffixes(name: string): string {
  let out = name.trim();
  for (const suffix of STRIPPABLE_SUFFIXES) {
    const re = new RegExp(`\\s*${suffix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`, "i");
    out = out.replace(re, "");
  }
  return out.trim();
}

/**
 * Coerce OSM-style "yes"/"no"/"limited" strings into a boolean | "limited".
 * Returns null if the value isn't recognizable.
 */
export function coerceYesNo(value: unknown): boolean | "limited" | null {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (["yes", "true", "1", "available"].includes(v)) return true;
  if (["no", "false", "0", "unavailable"].includes(v)) return false;
  if (["limited", "partial", "sometimes"].includes(v)) return "limited";
  return null;
}

/**
 * Drop null/undefined values from an object. Used before persisting
 * normalized payloads so we don't write `{ phone: null }` everywhere.
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
