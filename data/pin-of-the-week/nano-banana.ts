/**
 * Pin of the Week — Nano Banana render adapter.
 *
 * "Nano Banana" is Google's Gemini image model (gemini-2.5-flash-image). No
 * image-generation pipeline exists in this repo (verified), so this is the
 * net-new adapter. It performs an image-to-image render: the real place photo
 * is sent as the hero reference alongside the composed brand prompt.
 *
 * It renders ONLY when an API key is configured (GEMINI_API_KEY or
 * GOOGLE_API_KEY). Without a key it returns a dry-run result so the rest of the
 * pipeline (caption + prompt/spec artifacts) still runs and is reviewable — the
 * key is intentionally NOT required to exercise the pipeline.
 */

import type { ImagePromptSpec } from "./image-prompt.ts";

const MODEL = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export interface RenderResult {
  rendered: boolean;
  /** PNG bytes when rendered. */
  bytes?: Buffer;
  mimeType?: string;
  reason?: string;
}

async function fetchImageAsInlineData(url: string): Promise<{ mimeType: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reference image fetch failed (${res.status}) for ${url}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buf.toString("base64") };
}

export async function renderNanoBanana(spec: ImagePromptSpec): Promise<RenderResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      rendered: false,
      reason:
        "no GEMINI_API_KEY / GOOGLE_API_KEY set — dry run. Caption + image prompt/spec were written; " +
        "set a key to render the branded image.",
    };
  }

  const parts: Array<Record<string, unknown>> = [{ text: spec.prompt }];
  for (const url of spec.referenceImageUrls) {
    const inline = await fetchImageAsInlineData(url);
    parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
  }

  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // imageConfig.aspectRatio forces the output shape. Without it the model
    // inherits the (landscape) reference photo's aspect and ignores the
    // "Portrait 4:5" prompt text — verified 2026-09-10 (got 1184x864).
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { imageConfig: { aspectRatio: spec.aspectRatio } },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Nano Banana render failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  const imgPart = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!imgPart?.inlineData?.data) {
    return { rendered: false, reason: "Nano Banana returned no image part" };
  }
  return {
    rendered: true,
    bytes: Buffer.from(imgPart.inlineData.data, "base64"),
    mimeType: imgPart.inlineData.mimeType ?? "image/png",
  };
}
