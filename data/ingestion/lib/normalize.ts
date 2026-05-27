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
