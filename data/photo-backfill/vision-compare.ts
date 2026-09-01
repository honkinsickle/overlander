/**
 * Vision comparison of a stored candidate photo against a live Google
 * reference photo, using Claude (Opus 5). Returns a structured verdict on
 * whether the two images depict the SAME physical place.
 *
 * Both images are passed inline (base64). The Google image is live-fetched by
 * the caller and is never persisted — this module only reads it into the API
 * request. Auth: ANTHROPIC_API_KEY (borrowed from web/.env.local by the driver;
 * TEST Supabase creds stay in data/.env — this module touches no DB).
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return _client;
}

export type Verdict = {
  verdict: "match" | "no_match" | "ambiguous";
  confidence: "high" | "medium" | "low";
  reasoning: string;
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "reasoning"],
  properties: {
    verdict: { type: "string", enum: ["match", "no_match", "ambiguous"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: { type: "string" },
  },
} as const;

type ImageInput = { base64: string; mediaType: string };

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

/** Best-effort JSON extraction (tolerates code fences / stray prose). */
function parseVerdict(raw: string): Verdict {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const o = JSON.parse(s) as Record<string, unknown>;
  const verdict = String(o.verdict);
  const confidence = String(o.confidence);
  if (!["match", "no_match", "ambiguous"].includes(verdict)) throw new Error(`bad verdict: ${verdict}`);
  return {
    verdict: verdict as Verdict["verdict"],
    confidence: (["high", "medium", "low"].includes(confidence) ? confidence : "low") as Verdict["confidence"],
    reasoning: String(o.reasoning ?? "").slice(0, 2000),
  };
}

export async function compareToGoogle(args: {
  placeName: string;
  candidateSource: string; // e.g. "wikimedia_commons_geo" / "nps"
  candidate: ImageInput;
  google: ImageInput;
}): Promise<Verdict> {
  const prompt =
    `You are verifying whether a stored photo actually depicts a specific real-world place, ` +
    `by comparing it against a reference photo of that place.\n\n` +
    `Place: "${args.placeName}" (a campground / camping area in California).\n` +
    `Image 1 is the CANDIDATE photo (source: ${args.candidateSource}).\n` +
    `Image 2 is a REFERENCE photo of the same named place from Google.\n\n` +
    `Question: do Image 1 and Image 2 depict the SAME physical place?\n` +
    `- "match": they clearly show the same campground/site — same recognizable structures, signage, ` +
    `rock formations, water body, or distinctive setting. A campground entrance sign that names the place counts as a match.\n` +
    `- "no_match": they show different places, OR Image 1 is clearly not this place (a generic/unrelated ` +
    `landscape, a different location, a map, diagram, or logo).\n` +
    `- "ambiguous": you genuinely cannot tell — both are generic forest/desert/water with nothing distinctive to tie them together, ` +
    `or the reference itself is unclear.\n\n` +
    `Judge the actual image content, not captions. Reply with the JSON verdict only.`;

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1 (candidate):" },
          { type: "image", source: { type: "base64", media_type: args.candidate.mediaType as "image/jpeg", data: args.candidate.base64 } },
          { type: "text", text: "Image 2 (Google reference):" },
          { type: "image", source: { type: "base64", media_type: args.google.mediaType as "image/jpeg", data: args.google.base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (resp.stop_reason === "refusal") throw new Error("vision compare refused");
  return parseVerdict(textOf(resp.content as Array<{ type: string; text?: string }>));
}
