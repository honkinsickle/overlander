/**
 * Pin of the Week — caption composer.
 *
 * Format (from the task brief; no repo brief exists — see docs/content/
 * pin-of-the-week.md): HOOK first, RATING as payoff, CTA last.
 *
 * ⚠ DEVIATION — "rating as payoff": master_place carries NO numeric rating
 * (rating/review_count are NULL corpus-wide, verified). We cannot honestly show
 * a star rating. The payoff instead uses the real verification signal: an
 * official source (NPS / Recreation.gov) contributed data, and/or prominence.
 * This keeps the "payoff" slot but grounds it in something real. Flagged, not
 * dropped.
 *
 * GROUNDING: every fact in the caption comes from the place row. The body is a
 * verbatim excerpt of the real description; nothing is invented. The optional
 * LLM mode rewrites tone only and is instructed to add no new facts.
 */

import type { EvaluatedCandidate } from "./eligibility.ts";
import { BRAND } from "./style-guide.ts";

export interface PinCaption {
  hook: string;
  body: string;
  payoff: string;
  cta: string;
  hashtags: string[];
  /** The full caption text, assembled. */
  text: string;
  meta: {
    generatedBy: "template" | "llm";
    verificationBasis: string;
  };
}

const CATEGORY_HOOKS: Record<string, (name: string, state: string | null) => string> = {
  campground: (n) => `Your next basecamp is sorted. 🏕️ ${n}.`,
  recreation_area: (n) => `Big country, wide open. ${n}.`,
  viewpoint: (n) => `The view is the whole point. 📍 ${n}.`,
  park_feature: (n) => `Add this one to the list. ${n}.`,
  oddity: (n) => `File this under "wait, that's real." ${n}.`,
  visitor_center: (n) => `Start here, then get lost. ${n}.`,
  trailhead: (n) => `Boots on. Trail out. ${n}.`,
  restaurant: (n) => `Worth the detour. 🍽️ ${n}.`,
  diner: (n) => `Worth the detour. 🍽️ ${n}.`,
  peak: (n) => `Look up. Way up. ⛰️ ${n}.`,
  mountain_peak: (n) => `Look up. Way up. ⛰️ ${n}.`,
  monument: (n) => `History you can pull over for. ${n}.`,
  spring: (n) => `Nature's own soak. ♨️ ${n}.`,
  park: (n) => `Room to roam. ${n}.`,
  picnic_area: (n) => `Pull over, unpack, stay a while. ${n}.`,
};

function defaultHook(name: string, state: string | null): string {
  return state ? `This week's pin: ${name}, ${state}. 📌` : `This week's pin: ${name}. 📌`;
}

/** First 1–2 sentences of the real description, trimmed to a caption-friendly length. */
export function excerptDescription(description: string, maxLen = 300): string {
  const clean = description.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > maxLen && out.length > 0) break;
    out += s;
  }
  out = out.trim() || clean.slice(0, maxLen).trim();
  if (out.length > maxLen) out = out.slice(0, maxLen - 1).trimEnd() + "…";
  return out;
}

function statePhrase(state: string | null): string {
  return state ? ` in ${state}` : "";
}

/** The "rating as payoff" line, grounded in the real verification signal. */
export function payoffLine(candidate: EvaluatedCandidate): { line: string; basis: string } {
  const official = candidate.signals.officialSources;
  const labelMap: Record<string, string> = { nps: "the National Park Service", ridb: "Recreation.gov" };
  if (official.length > 0) {
    const names = official.map((s) => labelMap[s] ?? s);
    const joined =
      names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
    return {
      line: `✅ Yo Trippin Verified — data cross-checked against ${joined}.`,
      basis: `official sources: ${official.join(", ")}`,
    };
  }
  return {
    line: `✅ Yo Trippin Verified — a standout${statePhrase(candidate.state)} by our prominence score.`,
    basis: `prominence_score: ${candidate.prominence_score}`,
  };
}

function hashtagsFor(candidate: EvaluatedCandidate): string[] {
  const base = ["#overlanding", "#vanlife", "#yotrippin", "#pinoftheweek", "#getoutside"];
  const cat: Record<string, string> = {
    campground: "#camping",
    recreation_area: "#publiclands",
    viewpoint: "#scenicviews",
    trailhead: "#hiking",
    peak: "#mountains",
    mountain_peak: "#mountains",
    spring: "#hotsprings",
    restaurant: "#roadtripeats",
    diner: "#roadtripeats",
  };
  const stateTag: Record<string, string> = {
    CA: "#california",
    OR: "#oregon",
    WA: "#washington",
    NV: "#nevada",
    UT: "#utah",
    AZ: "#arizona",
  };
  const tags = [...base];
  if (cat[candidate.primary_category]) tags.push(cat[candidate.primary_category]);
  if (candidate.state && stateTag[candidate.state]) tags.push(stateTag[candidate.state]);
  return tags;
}

/** Deterministic, fully-grounded caption. No external calls. */
export function composeCaption(candidate: EvaluatedCandidate): PinCaption {
  const hookFn = CATEGORY_HOOKS[candidate.primary_category];
  const hook = hookFn ? hookFn(candidate.canonical_name, candidate.state) : defaultHook(candidate.canonical_name, candidate.state);
  const body = excerptDescription(candidate.description ?? "");
  const { line: payoff, basis } = payoffLine(candidate);
  const cta = `📍 Save this pin for your next trip and plan the route with ${BRAND.name}. Where would you park up? 👇`;
  const hashtags = hashtagsFor(candidate);
  const text = [hook, body, payoff, cta, hashtags.join(" ")].join("\n\n");
  return {
    hook,
    body,
    payoff,
    cta,
    hashtags,
    text,
    meta: { generatedBy: "template", verificationBasis: basis },
  };
}

/**
 * Optional: rewrite the hook + body into brand voice via the Anthropic SDK,
 * constrained to add NO new facts. Falls back to the template caption if no
 * ANTHROPIC_API_KEY is set. The payoff, CTA, and hashtags are kept from the
 * (grounded) template so the "rating as payoff / CTA last" structure is exact.
 */
export async function composeCaptionLLM(candidate: EvaluatedCandidate): Promise<PinCaption> {
  const base = composeCaption(candidate);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return base;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const prompt = [
    `You write Instagram captions for "${BRAND.name}", an overlanding / road-trip brand.`,
    `Voice: punchy, warm, adventurous, a little wry. Lower-case-friendly, emoji sparingly.`,
    ``,
    `Rewrite ONLY the HOOK (line 1) and the BODY (a short blurb) for this place.`,
    `STRICT RULE: use ONLY the facts below. Invent nothing — no ratings, no features,`,
    `no superlatives that aren't supported by the description.`,
    ``,
    `PLACE: ${candidate.canonical_name}`,
    `CATEGORY: ${candidate.primary_category}`,
    `STATE: ${candidate.state ?? "unknown"}`,
    `REAL DESCRIPTION (source of truth): ${candidate.description}`,
    ``,
    `Return strict JSON: {"hook": "...", "body": "..."} — hook <= 120 chars, body <= 300 chars.`,
  ].join("\n");

  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return base;
  const match = textBlock.text.match(/\{[\s\S]*\}/);
  if (!match) return base;
  let parsed: { hook?: string; body?: string };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return base;
  }
  const hook = parsed.hook?.trim() || base.hook;
  const body = parsed.body?.trim() || base.body;
  const text = [hook, body, base.payoff, base.cta, base.hashtags.join(" ")].join("\n\n");
  return { ...base, hook, body, text, meta: { ...base.meta, generatedBy: "llm" } };
}
