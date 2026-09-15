/**
 * Pin of the Week — Nano Banana image-prompt composer.
 *
 * Builds the render brief for one place: the reusable brand style (style-guide
 * IMAGE_STYLE_BRIEF) + the exact, grounded caption-bar text this post must show.
 * The real place photo (photo_url) is passed as the hero reference image so the
 * generated post is anchored to the actual location, not an invented scene.
 */

import type { EvaluatedCandidate } from "./eligibility.ts";
import { BRAND, PHOTO_TREATMENT_BRIEF } from "./style-guide.ts";

export interface ImagePromptSpec {
  prompt: string;
  /** The real place photo — anchors the render (image-to-image). */
  referenceImageUrls: string[];
  aspectRatio: string;
  dimensions: { width: number; height: number };
  /** The exact text the compositor draws (never the model), so nothing is invented. */
  overlayText: {
    title: string;
    subline: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  campground: "Campground",
  recreation_area: "Recreation Area",
  viewpoint: "Viewpoint",
  park_feature: "Park Feature",
  oddity: "Roadside Oddity",
  visitor_center: "Visitor Center",
  trailhead: "Trailhead",
  restaurant: "Eats",
  diner: "Eats",
  peak: "Peak",
  mountain_peak: "Peak",
  monument: "Monument",
  spring: "Hot Spring",
  park: "Park",
  picnic_area: "Picnic Area",
};

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// 2-letter code → full name, for the "State, Country" second line. US states only
// (the featured corpus is US-scoped; no Canadian regions).
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
/**
 * The post's second line: "Full State Name, USA" (e.g. "California, USA").
 * Grounded — if the state is absent it returns ""; if the code is unmapped it
 * returns the raw value rather than inventing a name/country.
 */
export function regionLine(state: string | null): string {
  if (!state) return "";
  const code = state.trim().toUpperCase();
  if (US_STATES[code]) return `${US_STATES[code]}, USA`;
  return state.trim();
}

export function composeImagePrompt(candidate: EvaluatedCandidate): ImagePromptSpec {
  // Second line under the title: "State, Country". The category is no longer
  // shown here — it lives in the brand frame's label — so this is purely the
  // region. Grounded via regionLine (real or absent, never invented).
  const subline = regionLine(candidate.state);

  // Text carried to the deterministic compositor — NOT sent to the model.
  // The title is the real place name straight from the SELECT row. (The brand
  // wordmark + verified badge live in the real header asset composited on top.)
  const overlayText = {
    title: candidate.canonical_name,
    subline,
  };

  return {
    prompt: PHOTO_TREATMENT_BRIEF,
    referenceImageUrls: candidate.photo_url ? [candidate.photo_url] : [],
    aspectRatio: BRAND.aspectRatio,
    dimensions: { ...BRAND.dimensions },
    overlayText,
  };
}
