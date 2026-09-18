import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  createContainer,
  publish,
  toJpeg,
  waitForContainer,
  type FetchLike,
  type PublishDeps,
} from "./publish-instagram.ts";

function pngFixture(w = 120, h = 150): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c8a96e";
  ctx.fillRect(0, 0, w, h);
  return canvas.toBuffer("image/png");
}

interface Call {
  url: string;
  method: string;
  params: URLSearchParams | null;
  auth: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A stand-in for Instagram plus the staging bucket. Records every call so the
 * tests can assert on what was SENT, not merely that nothing threw.
 */
function fakeDeps(opts: { status?: string; publishFails?: boolean } = {}): {
  deps: PublishDeps;
  calls: Call[];
  uploaded: string[];
  removed: string[];
} {
  const calls: Call[] = [];
  const uploaded: string[] = [];
  const removed: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: u,
      method: init?.method ?? "GET",
      params: init?.body instanceof URLSearchParams ? init.body : null,
      auth: headers.Authorization ?? null,
    });
    // media_publish must be matched BEFORE me/media — one is a prefix of the other.
    if (u.includes("/me/media_publish")) {
      return opts.publishFails ? json({ error: { message: "publish refused" } }, 400) : json({ id: "MEDIA1" });
    }
    if (u.includes("/me/media")) return json({ id: "CONTAINER1" });
    if (u.includes("status_code")) return json({ status_code: opts.status ?? "FINISHED" });
    throw new Error(`unexpected url ${u}`);
  }) as FetchLike;
  return {
    calls,
    uploaded,
    removed,
    deps: {
      fetch: fetchImpl,
      async upload(path) {
        uploaded.push(path);
        return `https://public.example/${path}`;
      },
      async remove(path) {
        removed.push(path);
      },
    },
  };
}

describe("toJpeg", () => {
  it("re-encodes to JPEG, because Instagram accepts nothing else", async () => {
    const jpeg = await toJpeg(pngFixture());
    // SOI marker — the file really is a JPEG, not a PNG with a new name.
    expect(jpeg.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("preserves dimensions exactly — resizing is what costs the art its edges", async () => {
    const jpeg = await toJpeg(pngFixture(1080, 1350));
    const { loadImage } = await import("@napi-rs/canvas");
    const decoded = await loadImage(jpeg);
    expect([decoded.width, decoded.height]).toEqual([1080, 1350]);
  });
});

describe("createContainer", () => {
  it("sends the caption for a post and sets no media_type", async () => {
    const { deps, calls } = fakeDeps();
    await createContainer(deps, "TOK", "https://public.example/a.jpg", "post", "hello world");
    expect(calls[0].params?.get("caption")).toBe("hello world");
    expect(calls[0].params?.get("media_type")).toBeNull();
    expect(calls[0].params?.get("image_url")).toBe("https://public.example/a.jpg");
  });

  it("sets media_type=STORIES and drops any caption — stories have no caption field", async () => {
    const { deps, calls } = fakeDeps();
    await createContainer(deps, "TOK", "https://public.example/a.jpg", "story", "hello world");
    expect(calls[0].params?.get("media_type")).toBe("STORIES");
    expect(calls[0].params?.get("caption")).toBeNull();
  });

  it("carries the token in a header, never in the url", async () => {
    const { deps, calls } = fakeDeps();
    await createContainer(deps, "SECRET-TOKEN", "https://public.example/a.jpg", "post");
    expect(calls[0].auth).toBe("Bearer SECRET-TOKEN");
    expect(calls.every((c) => !c.url.includes("SECRET-TOKEN"))).toBe(true);
  });

  it("surfaces Instagram's own message when the call is rejected", async () => {
    const deps: PublishDeps = {
      fetch: (async () => json({ error: { message: "missing permission" } }, 400)) as FetchLike,
      upload: async () => "https://public.example/a.jpg",
      remove: async () => {},
    };
    await expect(createContainer(deps, "TOK", "https://public.example/a.jpg", "post")).rejects.toThrow(
      /missing permission/,
    );
  });
});

describe("waitForContainer", () => {
  it("returns once Instagram reports FINISHED", async () => {
    const { deps } = fakeDeps({ status: "FINISHED" });
    await expect(waitForContainer(deps, "TOK", "C1")).resolves.toBeUndefined();
  });

  it("throws on ERROR rather than retrying a terminal state", async () => {
    const { deps, calls } = fakeDeps({ status: "ERROR" });
    await expect(waitForContainer(deps, "TOK", "C1")).rejects.toThrow(/could not process/);
    expect(calls).toHaveLength(1);
  });

  it("gives up after the configured number of checks", async () => {
    const { deps, calls } = fakeDeps({ status: "IN_PROGRESS" });
    await expect(
      waitForContainer(deps, "TOK", "C1", { attempts: 3, delayMs: 0 }),
    ).rejects.toThrow(/still IN_PROGRESS after 3 checks/);
    expect(calls).toHaveLength(3);
  });
});

describe("publish", () => {
  it("stages, publishes, then removes the staged object", async () => {
    const { deps, uploaded, removed } = fakeDeps();
    const result = await publish(
      { token: "TOK", png: pngFixture(), kind: "post", caption: "c", objectPath: "boulder/post.jpg" },
      deps,
    );
    expect(result.mediaId).toBe("MEDIA1");
    expect(uploaded).toEqual(["boulder/post.jpg"]);
    expect(removed).toEqual(["boulder/post.jpg"]);
  });

  it("removes the staged object even when publishing fails", async () => {
    const { deps, removed } = fakeDeps({ publishFails: true });
    await expect(
      publish({ token: "TOK", png: pngFixture(), kind: "post", objectPath: "boulder/post.jpg" }, deps),
    ).rejects.toThrow(/publish refused/);
    // The whole point of the finally: a failed publish must not leave a public
    // url of a half-published render behind.
    expect(removed).toEqual(["boulder/post.jpg"]);
  });

  it("a dry run builds the container and never calls media_publish", async () => {
    const { deps, calls, removed } = fakeDeps();
    const result = await publish(
      { token: "TOK", png: pngFixture(), kind: "post", objectPath: "boulder/post.jpg", dryRun: true },
      deps,
    );
    expect(result.containerId).toBe("CONTAINER1");
    expect(result.mediaId).toBeNull();
    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
    expect(removed).toEqual(["boulder/post.jpg"]);
  });

  it("reports a failed cleanup without failing the publish", async () => {
    const { deps } = fakeDeps();
    const result = await publish(
      { token: "TOK", png: pngFixture(), kind: "post", objectPath: "boulder/post.jpg" },
      { ...deps, remove: async () => { throw new Error("bucket unreachable"); } },
    );
    expect(result.mediaId).toBe("MEDIA1");
    expect(result.cleanupError).toMatch(/bucket unreachable/);
  });

  it("refuses without a token instead of calling Instagram", async () => {
    const { deps, uploaded } = fakeDeps();
    await expect(
      publish({ token: "", png: pngFixture(), kind: "post", objectPath: "boulder/post.jpg" }, deps),
    ).rejects.toThrow(/IG_ACCESS_TOKEN/);
    expect(uploaded).toEqual([]);
  });
});
