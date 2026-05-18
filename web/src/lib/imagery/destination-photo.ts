import type { SourceResult } from "@/lib/discovery/types";
import { enrichWithMapillary } from "@/lib/discovery/mapillary";

/**
 * Best-effort photo URL for a trip destination.
 *
 * Cascade (cheapest + most-likely-to-hit first):
 *
 *   1. Wikipedia REST summary by label ("Tacoma, WA" → "Tacoma,
 *      Washington" → `originalimage`). Catches every named city and
 *      landmark with a Wikipedia article. Auth-free.
 *   2. Mapillary street-level imagery near `coords`. Used when the
 *      label isn't a Wikipedia article (small unnamed crossroads).
 *      Currently flaky in preflight; cascade falls through on failure.
 *
 * Returns `null` if no source produced an image — caller should fall
 * back to a Mapbox-Static map snapshot so the hero is never blank.
 *
 * Note: this is intentionally separate from `enrichWithWikipedia` in
 * `lib/discovery/wikipedia.ts`. That enricher geosearches a 500 m
 * radius, which is right for narrowly-targeted landmark suggestions
 * but misses for city-level destinations (article centroid is too
 * far from the route's coords). Label-based REST lookup nails the
 * city article directly.
 */
export async function destinationPhotoFor(
  label: string,
  coords: [number, number],
): Promise<string | null> {
  // Stage 1 — Wikipedia by label.
  const wiki = await wikipediaPhotoByLabel(label);
  if (wiki) return wiki;

  // Stage 2 — Mapillary nearby street-level.
  const synth: SourceResult = {
    sourceId: "fixture",
    externalId: `dest:${label}`,
    coords,
    category: "scenic",
    title: label,
  };
  try {
    await enrichWithMapillary([synth]);
  } catch {
    // swallow
  }
  return synth.photoUrl ?? null;
}

type WikipediaSummary = {
  type?: string;
  title?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
};

const WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary";

/** Try Wikipedia's REST summary endpoint for the given city label.
 *  Converts "Tacoma, WA" → "Tacoma, Washington" since Wikipedia
 *  articles use full state names. */
async function wikipediaPhotoByLabel(label: string): Promise<string | null> {
  const title = expandStateCode(label);
  if (!title) return null;
  try {
    const res = await fetch(`${WIKI_REST}/${encodeURIComponent(title)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as WikipediaSummary;
    if (json.type === "disambiguation") return null;
    return json.originalimage?.source ?? json.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

const STATE_CODES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

function expandStateCode(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/^([^,]+),\s*([A-Z]{2})$/);
  if (!m) return trimmed;
  const full = STATE_CODES[m[2].toUpperCase()];
  return full ? `${m[1].trim()}, ${full}` : trimmed;
}
