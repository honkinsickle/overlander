/**
 * Pin of the Week — caption templates (pure).
 *
 * The IG caption is one of 12 fixed templates, interpolating {place},
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

/** The 12 templates, verbatim; index i == template number i+1. */
export const CAPTION_TEMPLATES: readonly string[] = [
  "Three hours out. The next stop is a coin flip. Not this time. {place} is on your list. {category} · {state}. Checked before you roll in. Get every verified spot in your inbox. Link in bio.",
  "Some pins lie. You've pulled up to a \"campsite\" with a locked gate. We've all been there. {place} won't do that to you. {category} · {state}. Get every verified spot in your inbox. Link in bio.",
  "Can't fix your flat. You've got that handled. We handle the next stop. {place} is a good one. {category} · {state}. Get every verified spot in your inbox. Link in bio.",
  "Most \"hidden gems\" are a parking lot with a sign. This one isn't. {place}. {category} · {state}. Worth the stop. Get the next one in your inbox. Link in bio.",
  "The other guy's still refreshing a map. You're already parked at {place}. {category} · {state}. Checked before you rolled in. Get every verified spot in your inbox. Link in bio.",
  "You're pulling into {place}. The other guy's still refreshing a map. {category} · {state}. Be the one who already knows. Link in bio for every verified spot.",
  "Skip the fourteen tabs. No stale forum posts. No two-star reviews from 2019. Just {place}. {category} · {state}. Get every verified spot in your inbox. Link in bio.",
  "Your road trip list just got one stop longer. {place}. {category} in {state}. Get every verified spot in your inbox. Link in bio.",
  "Most spots don't make our list. {place} did. {category} · {state}. Get the ones that make it in your inbox. Link in bio.",
  "One bar left. Then none. Good thing you already know about {place}. {category} · {state}. Checked before you roll in. Get every verified spot in your inbox. Link in bio.",
  "Dusk is no time to guess. {place} · {category} · {state}. Checked before you roll in. Get every verified spot in your inbox. Link in bio.",
  "The kind of spot you only hear around a campfire. {place}. {category} in {state}. Now you don't need the campfire. Get every verified spot in your inbox. Link in bio.",
] as const;

export const TEMPLATE_COUNT = CAPTION_TEMPLATES.length;

export interface CaptionFields {
  place: string;
  category: string;
  state: string;
}

export interface Caption {
  templateNumber: number; // 1..12
  text: string;
  fields: CaptionFields;
}

/**
 * Interpolate {place}/{category}/{state}. Only these three tokens are replaced.
 *
 * When state is missing, the {state} segment is dropped together with its
 * leading separator so the caption never renders a dangling "· ." / "in ." /
 * ", .". Across the 12 templates {state} is always preceded by one of " · ",
 * " in ", or ", " — this removes that unit, leaving clean prose (e.g.
 * "Campground · CA" → "Campground", "pick in CA." → "pick.").
 */
export function interpolate(template: string, f: CaptionFields): string {
  let t = template;
  if (f.state.trim() === "") {
    t = t.replace(/(?: · | in |, )\{state\}/g, "");
  }
  return t
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

/** Build the caption for a place using template `templateNumber` (1..12). */
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
