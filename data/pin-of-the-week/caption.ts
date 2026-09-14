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
  "yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "Some pins lie. yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "Can't fix your flat. But yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "No countdown, no fanfare — yoTrippin! just found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "The other guy's still refreshing a map. yoTrippin! Found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "Skip the fourteen tabs. yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "One more for the list. yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
  "Plenty don't make it. yoTrippin! found {place} so you don't have to guess. {category} · {state} — one less gamble on your next run. Didn't ask where you were headed, just knew you'd need this. Snack stop, bathroom break, good spot — covered. Pin it, and maybe tell people about it later. Every verified spot, straight to your inbox — link in bio.",
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

/**
 * Interpolate {place}/{category}/{state}. Only these three tokens are replaced.
 *
 * When state is missing, the {state} segment is dropped together with its
 * leading separator so the caption never renders a dangling "· ." / "in ." /
 * ", .". Across the 8 templates {state} is always preceded by one of " · ",
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
