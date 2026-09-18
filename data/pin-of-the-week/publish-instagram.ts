/**
 * Pin of the Day — publish a built post or story to Instagram through the API.
 *
 * Replaces the hand-driven browser flow. Four facts about Instagram's
 * content-publishing API shape everything here `[measured 2026-09-17, account
 * yotrippin.app, Instagram API with Instagram Login]`:
 *
 *   - **Instagram fetches the image itself.** There is no upload endpoint, so a
 *     render has to sit at a PUBLIC url for the length of the call. That is the
 *     only reason the `ig-publish` bucket exists; the object is removed again as
 *     soon as the call returns, success or failure.
 *   - **JPEG only.** The pipeline writes PNG, so every publish re-encodes. The
 *     re-encode uses @napi-rs/canvas, already a dependency for the compositor —
 *     no new package.
 *   - **Publishing is TWO calls**: create a container, then publish it. A
 *     container on its own puts NOTHING on the account and expires in 24h. That
 *     is what makes `dryRun` a real test of the credential rather than a no-op —
 *     it exercises the permission, the staging url and Instagram's own fetch of
 *     the image, and stops one call short of going live.
 *   - **The token goes in a header, never the query string**, so it cannot end
 *     up in a shell history, a log line or an error message.
 *
 * The STORY published here is `story.png` (1080x1920), NOT `story-web.png`. The
 * 1080x2340 padding exists only to survive Instagram's BROWSER composer, which
 * sizes the image to the window and bakes that shape in; the API takes the 9:16
 * render as-is. So the API path is the one place the padding is not wanted.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://graph.instagram.com/v23.0";

/**
 * The public bucket renders are staged in, on the TEST project. Objects live for
 * the length of one publish call, so a project wipe costs nothing.
 */
export const BUCKET = "ig-publish";

export type FetchLike = typeof fetch;

/** The two seams: the network, and somewhere public to stage a file. */
export interface PublishDeps {
  fetch: FetchLike;
  /** Stage `jpeg` at `path`; return the url Instagram will fetch it from. */
  upload: (path: string, jpeg: Buffer) => Promise<string>;
  remove: (path: string) => Promise<void>;
}

export type PublishKind = "post" | "story";

export interface PublishOptions {
  token: string;
  /** The PNG a build wrote — `image.png` for a post, `story.png` for a story. */
  png: Buffer;
  kind: PublishKind;
  /** Ignored for a story: Instagram stories carry no caption. */
  caption?: string;
  /** Object name inside the bucket. Uniquify it — an upsert would overwrite. */
  objectPath: string;
  /** Build the container and stop, publishing nothing. */
  dryRun?: boolean;
  /** Container-readiness polling. Defaults are fine; exists to keep tests fast. */
  poll?: { attempts?: number; delayMs?: number };
}

export interface PublishResult {
  containerId: string;
  /** null on a dry run — the container was built and deliberately not published. */
  mediaId: string | null;
  /**
   * Set when the staged object could not be deleted afterwards. The publish still
   * succeeded; this only means a JPEG was left in the bucket.
   */
  cleanupError?: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Re-encode a PNG render as JPEG, unscaled.
 *
 * Quality 90 rather than 100: the renders are flat brand chrome over a photo,
 * where 100 buys file size and no visible fidelity. Dimensions are preserved
 * exactly — resizing is what cost the logo and place name their edges in the
 * browser flow, and there is no reason to repeat it here.
 */
export async function toJpeg(png: Buffer, quality = 90): Promise<Buffer> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toBuffer("image/jpeg", quality);
}

/**
 * POST to the Graph API and return its parsed body.
 *
 * Meta answers a rejected call with HTTP 400 AND a descriptive `error.message`,
 * so both are surfaced: the status alone reads as a network problem when it is
 * really a missing permission or a url Instagram could not fetch.
 */
async function graphPost(
  deps: PublishDeps,
  token: string,
  path: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await deps.fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: params,
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { message?: string } | undefined;
    throw new Error(`Instagram ${path} failed: HTTP ${res.status} — ${err?.message ?? "no message"}`);
  }
  return body;
}

/**
 * Create an unpublished media container. Nothing appears on the account.
 *
 * A story sets `media_type=STORIES` and carries NO caption — Instagram stories
 * have no caption field, so passing one is silently dropped rather than
 * rendered, which would read as a lost caption.
 */
export async function createContainer(
  deps: PublishDeps,
  token: string,
  imageUrl: string,
  kind: PublishKind,
  caption?: string,
): Promise<string> {
  const params = new URLSearchParams({ image_url: imageUrl });
  if (kind === "story") params.set("media_type", "STORIES");
  else if (caption) params.set("caption", caption);
  const body = await graphPost(deps, token, "me/media", params);
  const id = body.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`Instagram returned no container id: ${JSON.stringify(body)}`);
  }
  return id;
}

/**
 * Wait until Instagram has finished fetching and processing the staged image.
 *
 * Images came back FINISHED on the first poll in the 2026-09-17 probe, but the
 * status is not documented as synchronous, and publishing an unfinished
 * container fails. Polling costs one cheap GET in the normal case.
 *
 * ERROR and EXPIRED both throw: they are terminal, and retrying them would only
 * delay the failure.
 */
export async function waitForContainer(
  deps: PublishDeps,
  token: string,
  containerId: string,
  poll?: { attempts?: number; delayMs?: number },
): Promise<void> {
  const attempts = poll?.attempts ?? 10;
  const delayMs = poll?.delayMs ?? 1000;
  let last = "unknown";
  for (let i = 0; i < attempts; i++) {
    const res = await deps.fetch(`${GRAPH}/${containerId}?fields=status_code`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { status_code?: string; error?: { message?: string } };
    if (!res.ok) {
      throw new Error(`container status failed: HTTP ${res.status} — ${body.error?.message ?? "no message"}`);
    }
    last = body.status_code ?? "unknown";
    if (last === "FINISHED") return;
    if (last === "ERROR" || last === "EXPIRED") {
      throw new Error(`Instagram could not process the image (status ${last})`);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`container was still ${last} after ${attempts} checks`);
}

/** The second call — this is the one that makes the post public. */
export async function publishContainer(
  deps: PublishDeps,
  token: string,
  containerId: string,
): Promise<string> {
  const body = await graphPost(
    deps,
    token,
    "me/media_publish",
    new URLSearchParams({ creation_id: containerId }),
  );
  const id = body.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`Instagram published but returned no media id: ${JSON.stringify(body)}`);
  }
  return id;
}

/**
 * Stage → container → (publish) → unstage.
 *
 * The staged object is removed in a `finally`, so a FAILED publish cannot leave
 * a public url of a half-published render behind — that litter is exactly what
 * this bucket is meant to avoid. A removal failure never masks a successful
 * publish: it is reported as `cleanupError` rather than thrown.
 */
export async function publish(opts: PublishOptions, deps: PublishDeps): Promise<PublishResult> {
  if (!opts.token) throw new Error("IG_ACCESS_TOKEN is not set");
  const jpeg = await toJpeg(opts.png);
  const imageUrl = await deps.upload(opts.objectPath, jpeg);
  const result: PublishResult = { containerId: "", mediaId: null };
  try {
    result.containerId = await createContainer(deps, opts.token, imageUrl, opts.kind, opts.caption);
    await waitForContainer(deps, opts.token, result.containerId, opts.poll);
    if (!opts.dryRun) {
      result.mediaId = await publishContainer(deps, opts.token, result.containerId);
    }
  } finally {
    try {
      await deps.remove(opts.objectPath);
    } catch (e) {
      result.cleanupError = errText(e);
    }
  }
  return result;
}

/** Wire the staging seam to the `ig-publish` bucket on the configured project. */
export function supabaseDeps(client: SupabaseClient, fetchImpl: FetchLike = fetch): PublishDeps {
  return {
    fetch: fetchImpl,
    async upload(path, jpeg) {
      const up = await client.storage
        .from(BUCKET)
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw new Error(`staging upload failed: ${up.error.message}`);
      const { data } = client.storage.from(BUCKET).getPublicUrl(path);
      if (!data.publicUrl) throw new Error("staging upload produced no public url");
      return data.publicUrl;
    },
    async remove(path) {
      const rm = await client.storage.from(BUCKET).remove([path]);
      if (rm.error) throw new Error(`staged object not removed: ${rm.error.message}`);
    },
  };
}
