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
    kicker: string;
    brand: string;
    title: string;
    subline: string;
    verified: string;
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

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function composeImagePrompt(candidate: EvaluatedCandidate): ImagePromptSpec {
  const label = categoryLabel(candidate.primary_category);
  const subline = candidate.state ? `${label} · ${candidate.state}` : label;
  const verified = candidate.signals.hasOfficialSource ? "✓ Yo Trippin Verified" : "Yo Trippin Pick";

  // Text carried to the deterministic compositor — NOT sent to the model.
  // The title is the real place name straight from the SELECT row.
  const overlayText = {
    kicker: "PIN OF THE WEEK",
    brand: BRAND.name,
    title: candidate.canonical_name,
    subline,
    verified,
  };

  return {
    prompt: PHOTO_TREATMENT_BRIEF,
    referenceImageUrls: candidate.photo_url ? [candidate.photo_url] : [],
    aspectRatio: BRAND.aspectRatio,
    dimensions: { ...BRAND.dimensions },
    overlayText,
  };
}
