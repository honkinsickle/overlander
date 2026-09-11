/**
 * Pin of the Week — caption templates (pure).
 *
 * The IG caption is one of 8 fixed templates, interpolating {place},
 * {category}, {state} from the selected place. The caption text goes into the
 * caption output (caption.txt / caption.json) — it is NOT burned into the
 * composited image (the image shows only the place name + "Category · State").
 *
 * {category} uses the humanized label (e.g. "Campground", "Park Feature") — the
 * same one shown on the image subline — because the raw enum ("park_feature")
 * reads unnaturally inside these sentences.
 */

import type { EvaluatedCandidate } from "./eligibility.ts";
import { categoryLabel } from "./image-prompt.ts";

/** The 8 templates, verbatim; index i == template number i+1. */
export const CAPTION_TEMPLATES: readonly string[] = [
  "We verified {place} so you don't have to guess. {category} · {state}. Want the full route notes before you go? Link in bio to get every verified spot straight to your inbox.",
  "{place} almost didn't make the list — here's why it did. Verified {category} pick in {state}. We send the ones that actually make the cut to our mailing list first. Join up via the link in bio.",
  "Not every spot with a pin on a map is actually worth the drive. {place} is. {category} · {state} — Yo Trippin verified. Get next week's pick before it's posted — sign up at the link in bio.",
  "This week's verified stop: {place}. {category}, {state}. We're building a list of every spot we've verified — sign up at the link in bio to get it as it grows.",
  "{place} — checked, confirmed, worth it. {category} · {state}. Skip the guesswork on your next trip. Join the mailing list (link in bio) for verified stops delivered straight to you.",
  "Here's what 'verified' actually means: {place}. {category} in {state}, checked before it made the feed. Want these before everyone else? Get on the list — link in bio.",
  "Adding {place} to the verified list. {category} · {state}. We're building the definitive verified-spot database for overlanders — get early access via the mailing list, link in bio.",
  "{place}: one of the ones that made the cut. {category}, {state}. Not every submission gets verified. The ones that do go straight to our mailing list first — link in bio to join.",
] as const;

export const TEMPLATE_COUNT = CAPTION_TEMPLATES.length;

export interface CaptionFields {
  place: string;
  category: string;
  state: string;
}

export interface Caption {
  templateNumber: number; // 1..8
  text: string;
  fields: CaptionFields;
}

/** Interpolate {place}/{category}/{state}. Only these three tokens are replaced. */
export function interpolate(template: string, f: CaptionFields): string {
  return template
    .replace(/\{place\}/g, f.place)
    .replace(/\{category\}/g, f.category)
    .replace(/\{state\}/g, f.state);
}

export function captionFields(candidate: EvaluatedCandidate): CaptionFields {
  return {
    place: candidate.canonical_name,
    category: categoryLabel(candidate.primary_category),
    state: candidate.state ?? "",
  };
}

/** Build the caption for a place using template `templateNumber` (1..8). */
export function buildCaption(candidate: EvaluatedCandidate, templateNumber: number): Caption {
  if (!Number.isInteger(templateNumber) || templateNumber < 1 || templateNumber > TEMPLATE_COUNT) {
    throw new Error(`caption template must be an integer 1-${TEMPLATE_COUNT}`);
  }
  const fields = captionFields(candidate);
  return { templateNumber, text: interpolate(CAPTION_TEMPLATES[templateNumber - 1], fields), fields };
}

/**
 * Least-recently-used rotation: given recent template numbers (MOST RECENT
 * FIRST), return the template that was used longest ago (never-used first),
 * tie-broken by lowest number. This guarantees no immediate repeat and cycles
 * evenly through all templates.
 */
export function pickLruTemplate(recentMostRecentFirst: number[]): number {
  let best = 1;
  let bestRecency = -1; // higher = less recently used
  for (let t = 1; t <= TEMPLATE_COUNT; t++) {
    const idx = recentMostRecentFirst.indexOf(t);
    const recency = idx === -1 ? Number.POSITIVE_INFINITY : idx;
    if (recency > bestRecency) {
      bestRecency = recency;
      best = t;
    }
  }
  return best;
}
